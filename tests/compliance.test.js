'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { checkReply, checkContent, sanitizeReply } = require('../src/compliance');
const { AvoraAgent, FALLBACK_REPLY } = require('../src/agent/agent');
const { InMemoryConversationStore } = require('../src/memory/store');
const { scriptedAnthropic, textResponse, toolResponse, silentLogger, siteSnapshot } = require('./helpers');
const { buildPricing } = require('../src/pricing');

const rules = (text, opts) => checkReply(text, opts).violations.map((v) => v.rule);

test('banned medical wording is flagged', () => {
  for (const t of [
    'אבורה+ מרפא את האף.',
    'זה ריפוי טבעי לאף.',
    'המכשיר מטפל באלרגיה.',
    'זה טיפול בסינוסיטיס.',
    'זו תרופה טבעית לאף סתום.',
    'זה מחליף את הספריי.',
    'אפשר להחליף את ה-CPAP באבורה+.',
    'כדאי להפסיק את הספריי.',
    'אפשר להפסיק עם ה-CPAP.',
    'זה מכשיר רפואי מתקדם.',
    'זה מונע דלקות.',
    'נשמע שיש לך סינוסיטיס.',
  ]) {
    assert.ok(rules(t).length > 0, `should flag: ${t}`);
  }
});

test('the same words are allowed when negated, as the docs use them', () => {
  for (const t of [
    'אבורה+ אינו טיפול בדום נשימה ואינו מחליף מכשיר CPAP.',
    'הוא לא מטפל בזיהומים או בסינוסיטיס.',
    'אבורה+ לא מחליף את ה-CPAP - ממשיכים לפי הנחיות הרופא.',
    'אל תפסיקו ואל תשנו שום תרופה בלי להתייעץ עם הרופא שלכם.',
    'הוא מכשיר לשימוש ביתי ולא מכשיר רפואי או תרופה.',
    'זה לא מיידי - הרבה אנשים מתחילים לשים לב אחרי שבוע-שבועיים.',
    'זה לא קורה בלילה אחד.',
    'אנחנו לא יכולים להבטיח תוצאה לאף אחד.',
  ]) {
    assert.deepEqual(rules(t), [], `should allow: ${t}`);
  }
});

test('promises and hype are flagged', () => {
  for (const t of ['התוצאה מובטחת.', 'מרגישים מיד הקלה.', 'כבר מהלילה הראשון תנשמו.', 'זה המכשיר הכי טוב בשוק.', 'מכשיר מהפכני!', 'עובד 100%.', 'מחקרים הוכיחו שאבורה+ עובד.']) {
    assert.ok(rules(t).length > 0, `should flag: ${t}`);
  }
});

test('dashes: em-dash and en-dash are flagged, and sanitizeReply fixes them', () => {
  assert.ok(rules('המשלוח חינם לכל הארץ — בלי עלות.').includes('dash'));
  assert.ok(rules('שבוע–שבועיים').includes('dash'));
  assert.equal(sanitizeReply('שבוע–שבועיים — ויותר'), 'שבוע-שבועיים - ויותר');
  assert.deepEqual(rules('שבוע-שבועיים - ויותר'), []);
});

test('prices: only the current 1 / 2 / 3 device prices (default 189 / 315 / 439)', () => {
  assert.deepEqual(rules('מכשיר אחד 189 ₪, זוג 315 ₪, שלושה 439 ₪.'), []);
  assert.deepEqual(rules('מכשיר אחד 189 ש"ח.'), []);
  assert.ok(rules('מכשיר אחד 199 ₪.').includes('price'));
  assert.ok(rules('רק היום 149 שקלים!').includes('price'));
  assert.ok(rules('במקום 250 ₪ רק 189 ₪').length > 0);
  // v1.1: no per-device or "third one costs" figures (shekel savings in disguise).
  assert.ok(rules('השלישי יוצא 61 ₪.').includes('price'));
  assert.ok(rules('בזוג זה 157.50 ₪ למכשיר.').includes('price'));
});

test('prices are validated against the synced site prices, not a hard-coded list', () => {
  const pricing = buildPricing({ 1: 199, 2: 330, 3: 459 }, 'site');
  assert.deepEqual(rules('מכשיר אחד 199 ₪, 2 מכשירים 330 ₪ - חיסכון של 17%.', { pricing }), []);
  assert.ok(rules('מכשיר אחד 189 ₪.', { pricing }).includes('price'));
  assert.ok(rules('2 מכשירים 330 ₪ - חיסכון של 16%.', { pricing }).includes('discount'));
});

test('discounts: allowed only as the computed bundle percentage', () => {
  for (const t of ['2 מכשירים ב-315 ₪ - חיסכון של 16%.', '3 מכשירים ב-439 ₪, הנחה של 22%.', 'בזוג יש חיסכון של 16%, ובשלושה 22%.']) {
    assert.deepEqual(rules(t), [], `should allow: ${t}`);
  }
  for (const t of [
    'יש הנחה על זוג.',              // no %
    'בזוג חוסכים 63 ₪.',            // shekel savings
    'יש 20% הנחה על זוג.',          // wrong %
    'עכשיו 50% הנחה על כל האתר!',   // site-wide banner
    'חיסכון של 16% ועוד 10% בקופון.',
    'קוד קופון AVORA10',
    'יש מבצע השבוע',
    'המחיר הרגיל הוא גבוה יותר',
    'מחיר רגיל 250',
    'המחיר המחוק באתר הוא לא רלוונטי',
  ]) {
    assert.ok(rules(t).length > 0, `should flag: ${t}`);
  }
  // Research percentages are still allowed in a research context.
  assert.deepEqual(rules('במחקר הישראלי 72% דיווחו על שיפור לעומת 24% בדמה.'), []);
  // A % that isn't a bundle discount and isn't research is flagged.
  assert.ok(rules('90% מהאנשים מרגישים שיפור.').includes('discount'));
});

test('coupon: off by default, allowed in wording only when the owner enables it', () => {
  assert.ok(rules('בהרשמה לניוזלטר באתר יש קופון.').includes('discount'));
  assert.deepEqual(rules('בהרשמה לניוזלטר באתר יש קופון.', { couponEnabled: true }), []);
});

test('refunds: never an unconditional money-back promise', () => {
  for (const t of [
    'לא הרגשתם הבדל? מקבלים את הכסף בחזרה.',
    'נחזיר לך את הכסף.',
    'תקבלו את הכסף בחזרה, לפי מדיניות ההחזרים באתר.',
    'יש החזר כספי מלא.',
    'נסו 30 יום בלי סיכון.',
    'אין פה סיכון.',
  ]) {
    assert.ok(rules(t).includes('refund_promise'), `should flag: ${t}`);
  }
  assert.deepEqual(rules('יש 30 ימי ניסיון, וההחזרים לפי התנאים במדיניות ההחזרים באתר.'), []);
});

test('never a phone number, an email or a link to a policy page', () => {
  for (const t of ['אפשר להתקשר ל-055-928-9598.', 'כתבו ל-info@avora-il.com', 'הכל כתוב כאן: https://avora-il.com/policies/refund-policy', 'ראו avora-il.com/policies/shipping-policy']) {
    assert.ok(rules(t).some((r) => r === 'contact_details' || r === 'policy_link'), `should flag: ${t}`);
  }
  // Tracking links and order / tracking numbers are fine.
  assert.deepEqual(rules('מספר מעקב: RR123456789IL\nhttps://example.com/track/RR123456789IL'), []);
  assert.deepEqual(rules('הזמנה #1042 נשלחה.'), []);
});

test('format: refund steps may be a short numbered list (max 4 steps)', () => {
  const steps = 'אפשר, בלי בעיה. בקצרה:\n1. שלב ראשון\n2. שלב שני\n3. שלב שלישי\nהעברתי לצוות, והם יחזרו אליך בהקדם.';
  assert.deepEqual(rules(steps), []);
  const five = 'בקצרה:\n1. א\n2. ב\n3. ג\n4. ד\n5. ה';
  assert.ok(rules(five).includes('too_long'));
  assert.ok(rules('- אחת\n- שתיים\n- שלוש').includes('bullets'));
});

test('shipping: never "עד הבית"; free shipping must be "לכל הארץ"', () => {
  assert.ok(rules('המשלוח חינם עד הבית.').includes('home_delivery'));
  assert.ok(rules('שולחים לכם עד הבית.').includes('home_delivery'));
  assert.ok(rules('המשלוח חינם.').includes('shipping_wording'));
  assert.deepEqual(rules('המשלוח חינם לכל הארץ.'), []);
  assert.deepEqual(rules('המשלוח חינם לכל הארץ, אבל הוא לא מגיע עד הדלת.'), []);
});

test('reviews, testimonials and customer counts are flagged', () => {
  for (const t of ['כבר יש לנו אלפי לקוחות מרוצים.', '500 לקוחות כבר קנו.', 'לקוחה שלנו סיפרה שהיא נושמת סוף סוף.', 'יש לנו ביקורות מעולות.']) {
    assert.ok(rules(t).length > 0, `should flag: ${t}`);
  }
});

test('certifications are a known unknown', () => {
  assert.ok(rules('המכשיר מאושר על ידי משרד הבריאות.').length > 0);
  assert.ok(rules('יש לו CE.').length > 0);
  assert.deepEqual(rules('לגבי אישורים - אבדוק ואחזור אליך.'), []);
});

test('wavelength: 660 only in the context of the study', () => {
  assert.ok(rules('אבורה+ עובד ב-660 ננומטר.').includes('wavelength'));
  assert.deepEqual(rules('המחקר הישראלי השתמש ב-660 ננומטר, ואבורה+ הוא 630-650.'), []);
});

test('format: Hebrew only, at most 4 lines, no bullet walls', () => {
  assert.ok(rules('Hi! The price is 189 ₪ and shipping is free.').includes('not_hebrew'));
  assert.ok(rules('א\nב\nג\nד\nה').includes('too_long'));
  assert.ok(rules('- אחת\n- שתיים\n- שלוש').includes('bullets'));
  assert.ok(rules('א'.repeat(800)).includes('too_long'));
});

test('calibration: the live product-page FAQ wording passes the content rules', () => {
  const faq = fs.readFileSync(path.join(__dirname, '..', 'docs', 'PRODUCT_PAGE_FAQ.md'), 'utf8');
  // Sections that are intentionally stricter than the site (the bot must rephrase them):
  const STRICTER = new Set([
    'למי זה פחות מתאים',          // a negation list split by commas ("הקלה מיידית")
    'מידע נוסף והצהרת בטיחות',    // the long legal disclaimer ("לרפא")
    'מה אם זה לא יעזור לי?',      // unconditional "מקבלים את הכסף" - v1.1 §5 uses the conditional wording
    'מה אם לא ארגיש שיפור?',      // same
    'יש לי עוד שאלה',             // phone number - v1.1 §7 never gives one out
  ]);
  for (const section of faq.split(/^## /m).slice(1)) {
    const [heading, ...body] = section.split('\n');
    if (STRICTER.has(heading.trim())) continue;
    assert.deepEqual(checkContent(body.join('\n')).map((v) => `${v.rule}:${v.match}`), [], heading);
  }
});

// --- The agent with a mocked model ---

function makeAgent(responses, extra = {}) {
  const client = scriptedAnthropic(responses);
  const store = new InMemoryConversationStore();
  const agent = new AvoraAgent({ client, model: 'claude-sonnet-5-5', store, logger: silentLogger, ...extra });
  return { agent, client, store };
}

test('agent: a compliant model reply is returned and saved to memory', async () => {
  const { agent, store, client } = makeAgent([textResponse('מכשיר אחד עולה 189 ₪, והמשלוח חינם לכל הארץ.')]);
  const r = await agent.respond({ phone: '972501234567', text: 'כמה זה עולה?' });
  assert.equal(r.fallback, false);
  assert.equal(r.reply, 'מכשיר אחד עולה 189 ₪, והמשלוח חינם לכל הארץ.');
  assert.equal((await store.getHistory('972501234567')).length, 2);
  // Request shape: model from config, cached system prompt with the docs, tools, effort.
  const req = client.calls[0];
  assert.equal(req.model, 'claude-sonnet-5-5');
  assert.deepEqual(req.system.at(-1).cache_control, { type: 'ephemeral' });
  assert.match(req.system[1].text, /# אתר - מידע עדכני/);
  assert.match(req.system[2].text, /PRODUCT_PAGE_FAQ\.md/);
  assert.match(req.system[2].text, /SALES_GUIDE_KNOWLEDGE\.md/);
  assert.deepEqual(req.tools.map((t) => t.name), ['lookup_order', 'handoff_to_human']);
  assert.deepEqual(req.output_config, { effort: 'low' });
});

test('agent: em-dashes in the model output are fixed before sending', async () => {
  const { agent } = makeAgent([textResponse('הרבה אנשים מתחילים לשים לב אחרי שבוע–שבועיים — אצל כל אחד זה שונה.')]);
  const r = await agent.respond({ phone: '1', text: 'מתי מרגישים?' });
  assert.equal(r.reply, 'הרבה אנשים מתחילים לשים לב אחרי שבוע-שבועיים - אצל כל אחד זה שונה.');
});

test('agent: a non-compliant reply is rewritten once, with the violations explained to the model', async () => {
  const { agent, client } = makeAgent([
    textResponse('המשלוח חינם עד הבית, ואבורה+ מרפא את האף!'),
    textResponse('המשלוח חינם לכל הארץ.'),
  ]);
  const r = await agent.respond({ phone: '1', text: 'המשלוח עולה כסף?' });
  assert.equal(r.reply, 'המשלוח חינם לכל הארץ.');
  const feedback = client.calls[1].messages.at(-1).content;
  assert.match(feedback, /עד הבית/);
  assert.match(feedback, /מרפא/);
});

test('agent: if the rewrite still breaks the rules, the safe fallback is sent and a hand-off is raised', async () => {
  const { agent } = makeAgent([textResponse('זה מרפא.'), textResponse('זה מרפא, מובטח.')]);
  const r = await agent.respond({ phone: '1', text: 'זה עובד?' });
  assert.equal(r.reply, FALLBACK_REPLY);
  assert.equal(r.fallback, true);
  assert.equal(r.handoffs.length, 1);
  assert.ok(checkReply(FALLBACK_REPLY).ok);
});

test('agent: API errors and refusals fall back safely', async () => {
  const err = makeAgent([new Error('overloaded')]);
  const r1 = await err.agent.respond({ phone: '1', text: 'היי' });
  assert.equal(r1.reply, FALLBACK_REPLY);
  const refusal = makeAgent([{ stop_reason: 'refusal', stop_details: { category: null }, content: [], usage: {} }]);
  const r2 = await refusal.agent.respond({ phone: '1', text: 'היי' });
  assert.equal(r2.reply, FALLBACK_REPLY);
  assert.equal(r2.handoffs.length, 1);
});

test('agent: tool loop - handoff_to_human is recorded and the conversation continues', async () => {
  const { agent, client } = makeAgent([
    toolResponse('handoff_to_human', { category: 'human_request', summary: 'ביקש נציג' }),
    textResponse('בטח 🙏 העברתי את הפנייה לצוות שלנו, ומישהו יחזור אליך כאן בהקדם.'),
  ]);
  const r = await agent.respond({ phone: '1', text: 'נציג בבקשה' });
  assert.deepEqual(r.handoffs, [{ category: 'human_request', summary: 'ביקש נציג' }]);
  const toolResult = client.calls[1].messages.at(-1).content[0];
  assert.equal(toolResult.type, 'tool_result');
});

test('agent: lookup_order uses the sender phone by default', async () => {
  const lookups = [];
  const { agent } = makeAgent([
    toolResponse('lookup_order', { order_number: '#1042' }),
    textResponse('הזמנה #1042 נשלחה והיא בדרך 📦'),
  ], { orderLookup: async (n, p) => { lookups.push([n, p]); return { found: true, status_he: 'ההזמנה נשלחה והיא בדרך.', tracking: [] }; } });
  const r = await agent.respond({ phone: '972501234567', text: 'מה עם הזמנה 1042?' });
  assert.deepEqual(lookups, [['#1042', '972501234567']]);
  assert.equal(r.reply, 'הזמנה #1042 נשלחה והיא בדרך 📦');
});

test('agent: router notes are sent to the model but not stored as the customer text', async () => {
  const { agent, client, store } = makeAgent([textResponse('קודם כדאי שרופא יבדוק את זה.')]);
  await agent.respond({ phone: '1', text: 'יש לי חום', notes: ['זוהה דגל אדום רפואי'] });
  assert.match(client.calls[0].messages.at(-1).content, /\[הערת מערכת\] זוהה דגל אדום רפואי/);
  assert.equal((await store.getHistory('1'))[0].content, 'יש לי חום');
});

test('agent: uses the synced site prices for the prompt and the compliance check', async () => {
  const site = siteSnapshot({ prices: { 1: 199, 2: 330, 3: 459 } });
  const { agent, client } = makeAgent([
    textResponse('מכשיר אחד עולה 189 ₪.'),          // old price -> rejected
    textResponse('מכשיר אחד עולה 199 ₪.'),
  ], { getSite: () => site });
  const r = await agent.respond({ phone: '1', text: 'כמה זה עולה?' });
  assert.equal(r.reply, 'מכשיר אחד עולה 199 ₪.');
  assert.match(client.calls[0].system[1].text, /מכשיר אחד: 199 ₪/);
  assert.match(client.calls[1].messages.at(-1).content, /189/);
});
