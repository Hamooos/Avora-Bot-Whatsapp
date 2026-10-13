'use strict';

const crypto = require('crypto');

// --- Incoming webhook helpers ---

// Verifies Meta's X-Hub-Signature-256 header (HMAC-SHA256 of the raw body with the app secret).
function verifySignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret || !rawBody || typeof signatureHeader !== 'string') return false;
  const [algo, received] = signatureHeader.split('=');
  if (algo !== 'sha256' || !received || !/^[0-9a-f]{64}$/i.test(received)) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received.toLowerCase(), 'hex'));
}

// Flattens a webhook payload into a list of incoming messages.
// Each item: { id, from, timestamp, type, text, name }
function extractMessages(body) {
  const out = [];
  if (!body || body.object !== 'whatsapp_business_account') return out;
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const names = new Map((value.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of value.messages || []) {
        let text = null;
        if (m.type === 'text') text = m.text?.body ?? null;
        else if (m.type === 'button') text = m.button?.text ?? null;
        else if (m.type === 'interactive') {
          text = m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null;
        }
        out.push({ id: m.id, from: m.from, timestamp: m.timestamp, type: m.type, text, name: names.get(m.from) });
      }
    }
  }
  return out;
}

// --- Outgoing (Graph API) ---

function createWhatsAppClient({ token, phoneNumberId, graphVersion = 'v23.0', dryRun = false, fetchImpl = globalThis.fetch, logger }) {
  const log = logger || { info() {}, warn() {}, error() {} };
  const url = `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`;

  async function post(payload, to) {
    if (dryRun) {
      log.info('whatsapp_dry_run', { to, type: payload.type || 'status' });
      return { ok: true, dryRun: true };
    }
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        log.error('whatsapp_send_failed', { to, status: res.status, code: data?.error?.code });
        return { ok: false, status: res.status, code: data?.error?.code };
      }
      return { ok: true, id: data?.messages?.[0]?.id };
    } catch (err) {
      // Never crash on a failed send (guide: log failures but don't crash).
      log.error('whatsapp_send_error', { to, error: err?.message });
      return { ok: false, error: err?.message };
    }
  }

  return {
    sendText(to, body) {
      return post({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: false, body } }, to);
    },
    // Template messages (needed outside the 24h window). Templates must be approved by Meta first.
    sendTemplate(to, name, { language = 'he', components = [] } = {}) {
      return post({ messaging_product: 'whatsapp', to, type: 'template', template: { name, language: { code: language }, components } }, to);
    },
    markRead(messageId) {
      return post({ messaging_product: 'whatsapp', status: 'read', message_id: messageId }, undefined);
    },
  };
}

module.exports = { verifySignature, extractMessages, createWhatsAppClient };
