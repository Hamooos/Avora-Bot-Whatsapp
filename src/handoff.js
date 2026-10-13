'use strict';

const CATEGORY_LABELS = {
  human_request: 'ביקש נציג',
  cancel_refund: 'ביטול / החזרה / החזר כספי',
  complaint: 'תלונה / תקלה',
  medical: 'דגל אדום רפואי',
  unknown_info: 'שאלה שאין לה תשובה במסמכים',
  order_issue: 'בעיה בהזמנה',
  other: 'אחר',
};

/**
 * Hand-off to a human: logs the event (masked) and notifies the owner on WhatsApp.
 * Extra notification channels (email, Slack...) can be added with `hooks`.
 */
function createHandoffService({ whatsapp, ownerNumber, ownerNotifyTemplate, logger, hooks = [], now = () => Date.now(), dedupeMs = 60 * 60 * 1000 }) {
  const log = logger || { info() {}, warn() {}, error() {} };
  const recent = new Map(); // `${phone}|${category}` -> timestamp
  const events = [];        // last handoffs, in memory (no message bodies)

  async function notify({ phone, category = 'other', summary = '', customerName }) {
    const key = `${phone}|${category}`;
    const t = now();
    if (recent.has(key) && t - recent.get(key) < dedupeMs) {
      log.info('handoff_deduped', { phone, category });
      return { notified: false, deduped: true };
    }
    recent.set(key, t);
    events.push({ at: new Date(t).toISOString(), phone, category });
    if (events.length > 500) events.shift();
    log.info('handoff', { phone, category });

    for (const hook of hooks) {
      try { await hook({ phone, category, summary }); } catch (err) { log.error('handoff_hook_error', { error: err?.message }); }
    }

    if (!whatsapp || !ownerNumber) {
      log.warn('handoff_owner_not_configured', {});
      return { notified: false };
    }
    const label = CATEGORY_LABELS[category] || category;
    const text = [
      `🔔 העברה לנציג - ${label}`,
      `לקוח: +${phone}${customerName ? ` (${customerName})` : ''}`,
      summary ? `סיכום: ${summary}` : null,
      `לענות דרך הבוט: SEND ${phone} <הודעה>`,
    ].filter(Boolean).join('\n');

    let result = await whatsapp.sendText(ownerNumber, text);
    // Outside the 24h window with the owner, free text fails (Meta error 131047).
    if (!result.ok && ownerNotifyTemplate) {
      result = await whatsapp.sendTemplate(ownerNumber, ownerNotifyTemplate, {
        components: [{ type: 'body', parameters: [{ type: 'text', text: `${label} | +${phone}` }] }],
      });
    }
    if (!result.ok) log.error('handoff_owner_notify_failed', { category, code: result.code });
    return { notified: !!result.ok };
  }

  return { notify, events, CATEGORY_LABELS };
}

module.exports = { createHandoffService, CATEGORY_LABELS };
