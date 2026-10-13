'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMessageHandler, detect, NON_TEXT_REPLY } = require('../src/router');
const { createHandoffService } = require('../src/handoff');
const { InMemoryConversationStore } = require('../src/memory/store');
const { mockWhatsApp, silentLogger } = require('./helpers');

const OWNER = '972509999999';
const CUSTOMER = '972501234567';

// Agent stub: returns a fixed reply and records what it got.
function stubAgent(reply = 'מכשיר אחד עולה 189 ₪.', handoffs = []) {
  const calls = [];
  return { calls, async respond(args) { calls.push(args); return { reply, handoffs, fallback: false, violations: [] }; } };
}

function setup({ agent = stubAgent(), rateLimit } = {}) {
  const whatsapp = mockWhatsApp();
  const store = new InMemoryConversationStore();
  const handoff = createHandoffService({ whatsapp, ownerNumber: OWNER, logger: silentLogger });
  const handler = createMessageHandler({ agent, whatsapp, handoff, store, ownerNumber: OWNER, logger: silentLogger, rateLimit });
  return { whatsapp, store, handoff, handler, agent };
}

let seq = 0;
const msg = (text, extra = {}) => ({ id: `wamid.${++seq}`, from: CUSTOMER, type: 'text', text, ...extra });
const toCustomer = (wa) => wa.sent.filter((s) => s.to === CUSTOMER);
const toOwner = (wa) => wa.sent.filter((s) => s.to === OWNER);

test('a text message goes to the agent and the reply is sent to the customer', async () => {
  const { handler, whatsapp, agent } = setup();
  const r = await handler.handle(msg('כמה זה עולה?'));
  assert.equal(r.action, 'replied');
  assert.equal(agent.calls[0].text, 'כמה זה עולה?');
  assert.deepEqual(toCustomer(whatsapp).map((s) => s.body), ['מכשיר אחד עולה 189 ₪.']);
  assert.equal(toOwner(whatsapp).length, 0);
});

test('duplicate webhook deliveries are processed once', async () => {
  const { handler, agent } = setup();
  const m = msg('היי');
  await handler.handle(m);
  const r = await handler.handle({ ...m });
  assert.equal(r.action, 'duplicate');
  assert.equal(agent.calls.length, 1);
});

test('non-text messages get a short Hebrew reply without calling the agent; reactions are ignored', async () => {
  const { handler, whatsapp, agent } = setup();
  assert.equal((await handler.handle(msg(null, { type: 'audio' }))).action, 'non_text_reply');
  assert.equal((await handler.handle(msg(null, { type: 'reaction' }))).action, 'ignored');
  assert.equal(agent.calls.length, 0);
  assert.deepEqual(toCustomer(whatsapp).map((s) => s.body), [NON_TEXT_REPLY]);
});

test('red flags are detected, passed to the agent as a note, and the owner is notified', async () => {
  const { handler, whatsapp, agent } = setup({ agent: stubAgent('קודם כדאי שרופא יבדוק את זה. העברתי את הפנייה לצוות.') });
  const r = await handler.handle(msg('יש לי דימום מהאף כל בוקר'));
  assert.deepEqual(r.detected, ['medical']);
  assert.match(agent.calls[0].notes[0], /רופא/);
  const owner = toOwner(whatsapp);
  assert.equal(owner.length, 1);
  assert.match(owner[0].body, /דגל אדום רפואי/);
  assert.match(owner[0].body, /\+972501234567/); // the owner needs the real number to call back
});

test('detector covers every hand-off trigger in the brief', () => {
  const cases = {
    medical: ['יש לי חום ואף סתום', 'כאבים חזקים בפנים', 'הפרשה ירוקה מהאף', 'דימום מהאף', 'אשתי אומרת שיש לי הפסקות נשימה בלילה',
      'רק צד אחד סתום כל הזמן', 'זה מתאים לילדים?', 'אני בהריון', 'אני מניקה', 'לבת שלי בת 12'],
    human_request: ['אפשר לדבר עם נציג?', 'אני רוצה בן אדם', 'תתקשרו אליי'],
    cancel_refund: ['אני רוצה לבטל את ההזמנה', 'איך מחזירים את המכשיר?', 'אני רוצה החזר כספי'],
    complaint: ['אתם נוכלים', 'המכשיר לא נדלק', 'הגיע שבור', 'אני אפנה להגנת הצרכן'],
  };
  for (const [category, texts] of Object.entries(cases)) {
    for (const t of texts) assert.ok(detect(t).some((d) => d.category === category), `${category}: "${t}"`);
  }
  // Ordinary questions must not trigger a hand-off.
  for (const t of ['כמה זה עולה?', 'זה כואב?', 'מה אם זה לא יעזור לי?', 'אפשר לשתף עם בן הזוג?', 'אני בן 45, זה מתאים לי?', 'זה מחמם?']) {
    assert.deepEqual(detect(t), [], `false positive: "${t}"`);
  }
});

test('a reply that says "אבדוק ואחזור" always notifies the owner, even if the model did not hand off', async () => {
  const { handler, whatsapp } = setup({ agent: stubAgent('את זמני המשלוח אבדוק ואחזור אליך בהקדם.') });
  const r = await handler.handle(msg('תוך כמה זמן זה מגיע?'));
  assert.deepEqual(r.handoffs.map((h) => h.category), ['unknown_info']);
  assert.equal(toOwner(whatsapp).length, 1);
});

test('hand-offs requested by the model are forwarded to the owner, and repeats are de-duplicated', async () => {
  const { handler, whatsapp } = setup({ agent: stubAgent('העברתי לצוות, נחזור אליך בהקדם.', [{ category: 'order_issue', summary: 'חבילה לא הגיעה' }]) });
  await handler.handle(msg('החבילה לא הגיעה'));
  await handler.handle(msg('נו??'));
  const owner = toOwner(whatsapp);
  assert.equal(owner.length, 1);
  assert.match(owner[0].body, /חבילה לא הגיעה/);
});

test('a non-compliant reply never reaches the customer', async () => {
  const { handler, whatsapp } = setup({ agent: stubAgent('זה מרפא את האף מהלילה הראשון — מובטח!') });
  await handler.handle(msg('זה עובד?'));
  const sent = toCustomer(whatsapp)[0].body;
  assert.doesNotMatch(sent, /מרפא|מובטח|—/);
  assert.match(sent, /אבדוק ואחזור/);
  assert.equal(toOwner(whatsapp).length, 1);
});

test('owner commands: BLOCK / UNBLOCK', async () => {
  const { handler, whatsapp, agent } = setup();
  await handler.handle({ id: 'o1', from: OWNER, type: 'text', text: 'BLOCK 050-123-4567' });
  assert.equal((await handler.handle(msg('היי'))).action, 'blocked');
  await handler.handle({ id: 'o2', from: OWNER, type: 'text', text: 'UNBLOCK 0501234567' });
  assert.equal((await handler.handle(msg('היי'))).action, 'replied');
  assert.equal(agent.calls.length, 1);
  assert.ok(toOwner(whatsapp).some((s) => /בוצע: BLOCK/.test(s.body)));
});

test('owner commands: SEND relays a message and pauses the bot; customer replies are forwarded to the owner', async () => {
  const { handler, whatsapp, agent } = setup();
  await handler.handle({ id: 'o3', from: OWNER, type: 'text', text: 'SEND 0501234567 היי, כאן אבורה. אפשר לעזור?' });
  assert.deepEqual(toCustomer(whatsapp).map((s) => s.body), ['היי, כאן אבורה. אפשר לעזור?']);
  const r = await handler.handle(msg('כן, ההזמנה שלי'));
  assert.equal(r.action, 'forwarded_to_owner');
  assert.equal(agent.calls.length, 0);
  assert.ok(toOwner(whatsapp).some((s) => s.body.includes('כן, ההזמנה שלי')));

  await handler.handle({ id: 'o4', from: OWNER, type: 'text', text: 'RESUME 0501234567' });
  assert.equal((await handler.handle(msg('תודה'))).action, 'replied');
});

test('owner gets help for an unknown command and is never answered by the agent', async () => {
  const { handler, whatsapp, agent } = setup();
  const r = await handler.handle({ id: 'o5', from: OWNER, type: 'text', text: 'מה קורה?' });
  assert.equal(r.action, 'owner_help');
  assert.equal(agent.calls.length, 0);
  assert.match(toOwner(whatsapp)[0].body, /SEND/);
});

test('rate limiting drops floods from one number', async () => {
  let n = 0;
  const { handler, agent } = setup({ rateLimit: () => ++n <= 2 });
  await handler.handle(msg('1'));
  await handler.handle(msg('2'));
  assert.equal((await handler.handle(msg('3'))).action, 'rate_limited');
  assert.equal(agent.calls.length, 2);
});

test('messages from the same customer are processed in order', async () => {
  const order = [];
  const agent = {
    async respond({ text }) {
      await new Promise((r) => setTimeout(r, text === 'ראשונה' ? 30 : 1));
      order.push(text);
      return { reply: 'בסדר', handoffs: [], fallback: false, violations: [] };
    },
  };
  const { handler } = setup({ agent });
  await Promise.all([handler.handle(msg('ראשונה')), handler.handle(msg('שנייה'))]);
  assert.deepEqual(order, ['ראשונה', 'שנייה']);
});
