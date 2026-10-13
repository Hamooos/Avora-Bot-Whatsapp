'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { checkReply, checkContent, sanitizeReply } = require('../src/compliance');
const { AvoraAgent, FALLBACK_REPLY } = require('../src/agent/agent');
const { InMemoryConversationStore } = require('../src/memory/store');
const { scriptedAnthropic, textResponse, toolResponse, silentLogger } = require('./helpers');

const rules = (text) => checkReply(text).violations.map((v) => v.rule);

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

test('prices: only 189 / 315 / 439 (and 61 for the third device)', () => {
  assert.deepEqual(rules('מכשיר אחד 189 ₪, זוג 315 ₪, שלושה 439 ₪ - השלישי יוצא 61 ₪.'), []);
  assert.deepEqual(rules('מכשיר אחד 189 ש"ח.'), []);
  assert.ok(rules('מכשיר אחד 199 ₪.').includes('price'));
  assert.ok(rules('רק היום 149 שקלים!').includes('price'));
  assert.ok(rules('במקום 250 ₪ רק 189 ₪').length > 0);
});

test('no discounts, coupons, regular prices or invented deals', () => {
  for (const t of ['יש 20% הנחה על זוג.', 'קוד קופון AVORA10', 'המחיר הרגיל הוא גבוה יותר', 'יש מבצע השבוע', 'בזוג חוסכים 63 ₪.', 'מחיר רגיל 250']) {
    assert.ok(rules(t).length > 0, `should flag: ${t}`);
  }
  // Research percentages are allowed in a research context.
  assert.deepEqual(rules('במחקר הישראלי 72% דיווחו על שיפור לעומת 24% בדמה.'), []);
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
  // Two sections are intentionally stricter than the site (the bot should rephrase them):
  // "למי זה פחות מתאים" (a negation list split by commas) and the long legal disclaimer.
  const STRICTER = new Set(['למי זה פחות מתאים', 'מידע נוסף והצהרת בטיחות']);
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
  assert.deepEqual(req.system[0].cache_control, { type: 'ephemeral' });
  assert.match(req.system[0].text, /PRODUCT_PAGE_FAQ\.md/);
  assert.match(req.system[0].text, /SALES_GUIDE_KNOWLEDGE\.md/);
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
