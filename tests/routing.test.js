'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMessageHandler, detect, NON_TEXT_REPLY } = require('../src/router');
const { createHandoffService } = require('../src/handoff');
const { InMemoryConversationStore } = require('../src/memory/store');
const { mockWhatsApp, silentLogger, siteSnapshot } = require('./helpers');
const { checkReply } = require('../src/compliance');
const { reassuranceText, TOPICS } = require('../src/handoffState');
const { emptySnapshot } = require('../src/siteSync');
const { loadConfig } = require('../src/config');

const OWNER = '972509999999';
const CUSTOMER = '972501234567';

// Agent stub: returns a fixed reply and records what it got.
function stubAgent(reply = 'מכשיר אחד עולה 189 ₪.', handoffs = []) {
  const calls = [];
  return { calls, async respond(args) { calls.push(args); return { reply, handoffs, fallback: false, violations: [] }; } };
}

// A controllable clock. Default start: Tuesday 2026-10-13 10:00 Israel time (a support day).
function clock(start = Date.parse('2026-10-13T07:00:00Z')) {
  let t = start;
  return { now: () => t, advance: (minutes) => { t += minutes * 60 * 1000; } };
}

function setup({ agent = stubAgent(), rateLimit, site = siteSnapshot(), time = clock(), quiet, maxPerDay } = {}) {
  const whatsapp = mockWhatsApp();
  const store = new InMemoryConversationStore({ now: time.now });
  const handoff = createHandoffService({ whatsapp, ownerNumber: OWNER, logger: silentLogger, now: time.now });
  const handler = createMessageHandler({
    agent, whatsapp, handoff, store, ownerNumber: OWNER, logger: silentLogger, rateLimit, now: time.now,
    getSite: () => site, handoffQuietMinutes: quiet, maxReassurancesPerDay: maxPerDay,
  });
  return { whatsapp, store, handoff, handler, agent, time };
}

let seq = 0;
const msg = (text, extra = {}) => ({ id: `wamid.${++seq}`, from: CUSTOMER, type: 'text', text, ...extra });
const toCustomer = (wa) => wa.sent.filter((s) => s.to === CUSTOMER);
const HANDOFF_AGENT = () => stubAgent('בטח 🙏 העברתי את הבקשה לצוות שלנו, והם יחזרו אליך בהקדם.', [{ category: 'cancel_refund', summary: 'רוצה להחזיר' }]);
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

test('hand-offs requested by the model are sent to the owner; the next message is only forwarded', async () => {
  const { handler, whatsapp, agent } = setup({ agent: stubAgent('העברתי לצוות, נחזור אליך בהקדם.', [{ category: 'order_issue', summary: 'חבילה לא הגיעה' }]) });
  await handler.handle(msg('החבילה לא הגיעה'));
  const r = await handler.handle(msg('נו??'));
  assert.equal(r.action, 'forwarded_to_owner');
  assert.equal(agent.calls.length, 1);
  const owner = toOwner(whatsapp);
  assert.equal(owner.length, 2);
  assert.match(owner[0].body, /חבילה לא הגיעה/);
  assert.equal(owner[1].body, '💬 +972501234567: נו??');
  assert.equal(toCustomer(whatsapp).length, 1);
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

// --- v1.1 §6: quiet after a hand-off, reassurance only after a long wait ---

test('after a hand-off: quiet before HANDOFF_QUIET_MINUTES, one reassurance at/after it, then the timer restarts', async () => {
  const { handler, whatsapp, agent, time } = setup({ agent: HANDOFF_AGENT() });
  await handler.handle(msg('אני רוצה להחזיר את המכשיר'));
  assert.equal(agent.calls.length, 1);

  time.advance(10);
  assert.equal((await handler.handle(msg('הלו?'))).action, 'forwarded_to_owner');
  time.advance(109); // 119 min since the hand-off
  assert.equal((await handler.handle(msg('יש מישהו?'))).action, 'forwarded_to_owner');
  assert.equal(toCustomer(whatsapp).length, 1, 'no reply while quiet');

  time.advance(1); // 120 min
  const r = await handler.handle(msg('???'));
  assert.equal(r.action, 'reassured');
  assert.equal(r.reply, 'קיבלנו, הפנייה שלך לגבי ההחזר או הביטול אצל הצוות, ונחזור אליך בהקדם 🙏');
  assert.equal(toCustomer(whatsapp).at(-1).body, r.reply);

  time.advance(30); // the quiet timer restarted at the reassurance
  assert.equal((await handler.handle(msg('נו'))).action, 'forwarded_to_owner');
  time.advance(90);
  assert.equal((await handler.handle(msg('נו נו'))).action, 'reassured');
  assert.equal(agent.calls.length, 1, 'the agent is never called during the hand-off');
  // Every customer message during the hand-off reached the owner.
  for (const t of ['הלו?', 'יש מישהו?', '???', 'נו', 'נו נו']) {
    assert.ok(toOwner(whatsapp).some((s) => s.body === `💬 +972501234567: ${t}`), t);
  }
});

test('at most HANDOFF_MAX_REASSURANCES_PER_DAY reassurances per day; the count resets the next day', async () => {
  const { handler, time } = setup({ agent: HANDOFF_AGENT(), quiet: 60, maxPerDay: 2 });
  await handler.handle(msg('אני רוצה לבטל את ההזמנה'));
  const actions = [];
  for (let i = 0; i < 4; i++) { time.advance(60); actions.push((await handler.handle(msg(`עוד ${i}`))).action); }
  assert.deepEqual(actions, ['reassured', 'reassured', 'forwarded_to_owner', 'forwarded_to_owner']);
  time.advance(24 * 60);
  assert.equal((await handler.handle(msg('מחר'))).action, 'reassured');
});

test('an owner SEND clears the hand-off; RESUME clears it too and the bot answers again', async () => {
  const { handler, whatsapp, agent, store, time } = setup({ agent: HANDOFF_AGENT() });
  await handler.handle(msg('אני רוצה להחזיר את המכשיר'));
  await handler.handle({ id: 'own1', from: OWNER, type: 'text', text: 'SEND 0501234567 היי, כאן אבורה - נטפל בזה היום.' });
  assert.equal((await store.getMeta(CUSTOMER)).handoff, null);
  assert.equal(toCustomer(whatsapp).at(-1).body, 'היי, כאן אבורה - נטפל בזה היום.');

  await handler.handle({ id: 'own2', from: OWNER, type: 'text', text: 'RESUME 0501234567' });
  time.advance(5);
  const r = await handler.handle(msg('תודה רבה'));
  assert.equal(r.action, 'replied');
  assert.equal(agent.calls.length, 2);
});

test('RESUME alone (no SEND) also clears an open hand-off', async () => {
  const { handler, store } = setup({ agent: HANDOFF_AGENT() });
  await handler.handle(msg('אני רוצה לבטל את ההזמנה'));
  assert.ok((await store.getMeta(CUSTOMER)).handoff);
  await handler.handle({ id: 'own3', from: OWNER, type: 'text', text: 'RESUME 0501234567' });
  assert.equal((await store.getMeta(CUSTOMER)).handoff, null);
});

test('reassurance outside support days (Fri-Sat) says the team replies on the next working day', async () => {
  const friday = clock(Date.parse('2026-10-16T07:00:00Z')); // Friday 10:00 in Israel
  const { handler, time } = setup({ agent: HANDOFF_AGENT(), time: friday });
  await handler.handle(msg('אני רוצה להחזיר את המכשיר'));
  time.advance(120);
  const r = await handler.handle(msg('?'));
  assert.equal(r.reply, "קיבלנו, הפנייה שלך לגבי ההחזר או הביטול אצל הצוות. הצוות זמין בימים א'-ה', ונחזור אליך ביום העבודה הבא 🙏");
});

test('every reassurance text passes the compliance check', () => {
  const tuesday = Date.parse('2026-10-13T07:00:00Z');
  const saturday = Date.parse('2026-10-17T07:00:00Z');
  for (const category of Object.keys(TOPICS)) {
    for (const t of [tuesday, saturday]) {
      const text = reassuranceText(category, t);
      assert.ok(checkReply(text).ok, `${category}: ${text}`);
    }
  }
});

test('handoff env vars: defaults 120 minutes / 3 per day, overridable', () => {
  const d = loadConfig({});
  assert.equal(d.handoffQuietMinutes, 120);
  assert.equal(d.maxReassurancesPerDay, 3);
  assert.equal(d.couponEnabled, false);
  assert.equal(d.site.baseUrl, 'https://avora-il.com');
  assert.equal(d.site.syncHours, 6);
  const c = loadConfig({ HANDOFF_QUIET_MINUTES: '30', HANDOFF_MAX_REASSURANCES_PER_DAY: '1', NEWSLETTER_COUPON_ENABLED: 'true' });
  assert.equal(c.handoffQuietMinutes, 30);
  assert.equal(c.maxReassurancesPerDay, 1);
  assert.equal(c.couponEnabled, true);
});

// --- v1.1 §5: only a stated wish to return / cancel hands off ---

test('general refund questions do not hand off; a stated wish to return or cancel does', () => {
  for (const t of ['יש החזרים?', 'מה אם זה לא יעזור לי?', 'איך עובדת מדיניות ההחזרים?', 'אפשר לקבל החזר אם זה לא עוזר?']) {
    assert.ok(!detect(t).some((d) => d.category === 'cancel_refund'), `should not hand off: ${t}`);
  }
  for (const t of ['אני רוצה להחזיר את המכשיר', 'אני רוצה החזר כספי', 'אני רוצה לבטל את ההזמנה', 'החלטתי להחזיר', 'תבטלו לי בבקשה']) {
    assert.ok(detect(t).some((d) => d.category === 'cancel_refund'), `should hand off: ${t}`);
  }
});

// --- v1.1 §1: no site data -> fall back to docs and hand off price / policy questions ---

test('site never loaded: price and shipping-detail questions are handed off', async () => {
  const { handler, whatsapp, agent } = setup({ site: emptySnapshot(), agent: stubAgent('מכשיר אחד עולה 189 ₪. אבדוק ואחזור אליך לגבי השאר.') });
  const r = await handler.handle(msg('כמה זה עולה?'));
  assert.deepEqual(r.handoffs.map((h) => h.category), ['unknown_info']);
  assert.match(agent.calls[0].notes[0], /לא נטען מהאתר/);
  assert.equal(toOwner(whatsapp).length, 1);
  assert.ok(detect('יש נקודת איסוף?', emptySnapshot()).length);
  assert.ok(detect('מה תנאי השימוש?', emptySnapshot()).length);
});

test('site loaded: the same questions are answered normally', async () => {
  const site = siteSnapshot({ policies: { shipping: 'טקסט', terms: 'טקסט' } });
  assert.deepEqual(detect('כמה זה עולה?', site), []);
  assert.deepEqual(detect('יש נקודת איסוף?', site), []);
  assert.deepEqual(detect('מה תנאי השימוש?', site), []);
  const { handler, whatsapp } = setup({ site });
  const r = await handler.handle(msg('כמה זה עולה?'));
  assert.deepEqual(r.handoffs, []);
  assert.equal(toOwner(whatsapp).length, 0);
});

test('final check uses the synced prices: an outdated price never reaches the customer', async () => {
  const site = siteSnapshot({ prices: { 1: 199, 2: 330, 3: 459 } });
  const { handler, whatsapp } = setup({ site, agent: stubAgent('מכשיר אחד עולה 189 ₪.') });
  await handler.handle(msg('כמה זה עולה?'));
  assert.doesNotMatch(toCustomer(whatsapp)[0].body, /189/);
});

test('several hand-off reasons in one message produce ONE owner alert with all the reasons', async () => {
  const agent = { async respond() { return { reply: 'תודה על ההודעה 🙏 אבדוק ואחזור אליך בהקדם.', handoffs: [{ category: 'other', summary: 'תקלה טכנית בבוט' }], fallback: true, violations: [] }; } };
  const { handler, whatsapp, store } = setup({ agent, site: emptySnapshot() });
  await handler.handle(msg('כמה זה עולה?'));
  const owner = toOwner(whatsapp);
  assert.equal(owner.length, 1);
  assert.match(owner[0].body, /שאלה שאין לה תשובה/); // the specific category wins over "other"
  assert.match(owner[0].body, /תקלה טכנית בבוט/);
  assert.match(owner[0].body, /לא נטען|זוהה אוטומטית/);
  assert.equal((await store.getMeta(CUSTOMER)).handoff.category, 'unknown_info');
});
