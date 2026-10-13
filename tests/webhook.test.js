'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createApp } = require('../src/server');
const { verifySignature, extractMessages } = require('../src/whatsapp');
const { silentLogger } = require('./helpers');

const APP_SECRET = 'test-app-secret';
const VERIFY_TOKEN = 'test-verify-token';

function sign(body, secret = APP_SECRET) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function samplePayload(text = 'כמה זה עולה?') {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WABA_ID',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '972500000000', phone_number_id: 'PNID' },
          contacts: [{ profile: { name: 'דנה' }, wa_id: '972501234567' }],
          messages: [{ from: '972501234567', id: 'wamid.ABC', timestamp: '1760000000', type: 'text', text: { body: text } }],
        },
      }],
    }],
  };
}

async function withServer(handler, fn) {
  const app = createApp({ verifyToken: VERIFY_TOKEN, appSecret: APP_SECRET, handler, logger: silentLogger });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { await new Promise((r) => server.close(r)); }
}

test('GET /health returns ok', async () => {
  await withServer({ handle() {} }, async (base) => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok' });
  });
});

test('GET /webhook echoes the challenge with the right verify token', async () => {
  await withServer({ handle() {} }, async (base) => {
    const res = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=12345`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), '12345');
  });
});

test('GET /webhook rejects a wrong verify token or mode', async () => {
  await withServer({ handle() {} }, async (base) => {
    assert.equal((await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`)).status, 403);
    assert.equal((await fetch(`${base}/webhook?hub.mode=unsubscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1`)).status, 403);
    assert.equal((await fetch(`${base}/webhook`)).status, 403);
  });
});

test('POST /webhook with a valid signature is accepted and the message is handled', async () => {
  const handled = [];
  await withServer({ handle: async (m) => { handled.push(m); } }, async (base) => {
    const body = JSON.stringify(samplePayload());
    const res = await fetch(`${base}/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) }, body });
    assert.equal(res.status, 200);
    await new Promise((r) => setTimeout(r, 20));
  });
  assert.equal(handled.length, 1);
  assert.equal(handled[0].from, '972501234567');
  assert.equal(handled[0].text, 'כמה זה עולה?');
  assert.equal(handled[0].name, 'דנה');
});

test('POST /webhook rejects missing, malformed or wrong signatures', async () => {
  const handled = [];
  await withServer({ handle: async (m) => { handled.push(m); } }, async (base) => {
    const body = JSON.stringify(samplePayload());
    const post = (headers) => fetch(`${base}/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
    assert.equal((await post({})).status, 401);
    assert.equal((await post({ 'x-hub-signature-256': 'sha256=deadbeef' })).status, 401);
    assert.equal((await post({ 'x-hub-signature-256': sign(body, 'other-secret') })).status, 401);
    // Signature of a different body (tampered payload)
    assert.equal((await post({ 'x-hub-signature-256': sign(body + ' ') })).status, 401);
  });
  assert.equal(handled.length, 0);
});

test('verifySignature fails closed when no app secret is configured', () => {
  const body = Buffer.from('{}');
  assert.equal(verifySignature(body, sign('{}'), ''), false);
  assert.equal(verifySignature(body, sign('{}'), APP_SECRET), true);
});

test('extractMessages handles text, button replies, media and status-only payloads', () => {
  const p = samplePayload();
  p.entry[0].changes[0].value.messages.push(
    { from: '972501234567', id: 'w2', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'b1', title: 'כן' } } },
    { from: '972501234567', id: 'w3', type: 'image', image: { id: 'img' } },
  );
  const msgs = extractMessages(p);
  assert.deepEqual(msgs.map((m) => [m.type, m.text]), [['text', 'כמה זה עולה?'], ['interactive', 'כן'], ['image', null]]);

  const statusOnly = { object: 'whatsapp_business_account', entry: [{ changes: [{ value: { statuses: [{ id: 'x', status: 'delivered' }] } }] }] };
  assert.deepEqual(extractMessages(statusOnly), []);
  assert.deepEqual(extractMessages({ object: 'page' }), []);
});
