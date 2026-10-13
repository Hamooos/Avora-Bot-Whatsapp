'use strict';

// The v1.1 owner decisions are written into the system prompt (the compliance checker
// enforces what it can; these tests make sure the instructions themselves are there).

const test = require('node:test');
const assert = require('node:assert/strict');
const { RULES, buildSystemPrompt } = require('../src/agent/systemPrompt');
const { checkReply } = require('../src/compliance');

test('§1: the site block outranks docs/, and sale banners / compare-at prices are never repeated', () => {
  assert.match(RULES, /"אתר - מידע עדכני"/);
  assert.match(RULES, /the site wins/);
  assert.match(RULES, /Never repeat a site-wide sale banner, a compare-at \/ crossed-out price or a newsletter coupon/);
});

test('§2: discounts only as the site-block percentage', () => {
  assert.match(RULES, /ONLY as the percentage given in the site block/);
  assert.match(RULES, /Never a saving in shekels/);
  assert.doesNotMatch(RULES, /61 ₪/);
});

test('§3: the digital guide comes with 2 devices or more', () => {
  assert.match(RULES, /2 devices or more includes the free digital guide "מדריך לנשימה חופשית"/);
});

test('§4: shipping time - default, commitment on request, details from the shipping policy', () => {
  assert.match(RULES, /"בדרך כלל לוקח שבוע עד שבועיים"/);
  assert.match(RULES, /"אנחנו מתחייבים לאספקה עד חודש"/);
  assert.match(RULES, /answer from the shipping policy in the site block/);
  assert.doesNotMatch(RULES, /delivery time and delivery method details/); // no longer a known unknown
  // Both phrasings pass the compliance check.
  assert.ok(checkReply('בדרך כלל לוקח שבוע עד שבועיים, והמשלוח חינם לכל הארץ.').ok);
  assert.ok(checkReply('אנחנו מתחייבים לאספקה עד חודש.').ok);
});

test('§5: general refund wording, steps only on a stated wish, never a link, never hide the 14 days', () => {
  assert.match(RULES, /"יש 30 ימי ניסיון, וההחזרים לפי התנאים במדיניות ההחזרים באתר"/);
  assert.match(RULES, /NEVER promise unconditionally/);
  assert.match(RULES, /WANT to return, get a refund or cancel/);
  assert.match(RULES, /at most 4 steps, no link/);
  assert.match(RULES, /legal 14-day cancellation/);
  assert.doesNotMatch(RULES, /didn't feel a difference -> contact us and get the money back/); // the v1 wording is gone
});

test('§7: never a phone number or a link to a policy page', () => {
  assert.match(RULES, /never send a link to a policy page, a phone number or an email address/);
});

test('the rules block is identical whatever the site says (prompt-cache friendly)', () => {
  assert.equal(buildSystemPrompt()[0].text, RULES);
});

test('persona: מעיין, feminine first person, introduces herself once, honest about being a bot', () => {
  assert.match(RULES, /You are מעיין \(Maayan\)/);
  assert.match(RULES, /FEMININE first person/);
  assert.match(RULES, /Introduce yourself once/);
  assert.match(RULES, /Never claim to be a human/);
});

test('format: paragraphs separated by an empty line, 1-3 emojis, warm acknowledgement first', () => {
  assert.match(RULES, /separated by an EMPTY LINE/);
  assert.match(RULES, /Emojis: 1-3 per message/);
  assert.match(RULES, /Start by acknowledging what the customer feels/);
  // The style example itself passes the compliance check.
  const example = RULES.split('מעיין: "')[1].split('"\n(Never')[0];
  assert.ok(checkReply(example).ok, JSON.stringify(checkReply(example)));
});
