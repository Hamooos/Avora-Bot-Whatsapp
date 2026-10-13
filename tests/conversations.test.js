'use strict';

// Runs every sample conversation in tests/conversations/ through:
//  1. the compliance check (banned words, dashes, prices, "עד הבית", format), and
//  2. the full pipeline (router -> agent -> tools -> hand-off -> WhatsApp sender)
//     with a recorded model that replays the expected reply and tool calls.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { checkReply } = require('../src/compliance');
const { AvoraAgent } = require('../src/agent/agent');
const { createMessageHandler } = require('../src/router');
const { createHandoffService } = require('../src/handoff');
const { InMemoryConversationStore } = require('../src/memory/store');
const { mockAnthropic, textResponse, toolResponse, mockWhatsApp, silentLogger } = require('./helpers');

const DIR = path.join(__dirname, 'conversations');
const conversations = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()
  .map((f) => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) }));

const CUSTOMER = '972501234567';
const OWNER = '972509999999';

test('there are at least 20 sample conversations covering the required topics', () => {
  assert.ok(conversations.length >= 20, `only ${conversations.length}`);
  const topics = conversations.map((c) => c.id).join(' ');
  for (const needed of ['price', 'bundles', 'how-it-works-short', 'how-it-works-long', 'usage', 'pain', 'cpap', 'polyps', 'pregnancy', 'kids',
    'medical-device', 'spray', 'expensive', 'gimmick', 'reviews', 'shipping', 'delivery-time', 'return', 'cancel', 'order-status', 'angry', 'off-topic']) {
    assert.ok(topics.includes(needed), `missing topic: ${needed}`);
  }
});

for (const c of conversations) {
  test(`compliance: ${c.file}`, () => {
    for (const turn of c.turns) {
      const r = checkReply(turn.bot);
      assert.ok(r.ok, `"${turn.bot}" -> ${JSON.stringify(r.violations)}`);
    }
  });

  test(`pipeline replay: ${c.file}`, async () => {
    // Recorded model: for each turn, optionally a tool call (order lookup / hand-off), then the reply.
    const script = [];
    for (const turn of c.turns) {
      if (turn.tool) script.push(toolResponse(turn.tool.name, turn.tool.input));
      if (turn.handoff && turn.handoff !== 'unknown_info') script.push(toolResponse('handoff_to_human', { category: turn.handoff, summary: c.topic }));
      script.push(textResponse(turn.bot));
    }
    const client = mockAnthropic((_req, i) => script[i]);
    const toolResults = c.turns.filter((t) => t.tool).map((t) => t.tool.result);
    const store = new InMemoryConversationStore();
    const agent = new AvoraAgent({ client, model: 'claude-sonnet-5-5', store, logger: silentLogger, orderLookup: async () => toolResults.shift() });
    const whatsapp = mockWhatsApp();
    const handoff = createHandoffService({ whatsapp, ownerNumber: OWNER, logger: silentLogger });
    const handler = createMessageHandler({ agent, whatsapp, handoff, store, ownerNumber: OWNER, logger: silentLogger });

    for (const [i, turn] of c.turns.entries()) {
      const before = whatsapp.sent.length;
      const r = await handler.handle({ id: `${c.id}-${i}`, from: CUSTOMER, type: 'text', text: turn.customer });
      const sent = whatsapp.sent.slice(before);
      assert.equal(sent.find((s) => s.to === CUSTOMER)?.body, turn.bot, 'customer receives the expected reply');
      const categories = r.handoffs.map((h) => h.category);
      if (turn.handoff) {
        assert.ok(categories.includes(turn.handoff), `expected hand-off ${turn.handoff}, got ${categories}`);
        assert.ok(sent.some((s) => s.to === OWNER), 'owner notified');
      } else {
        assert.deepEqual(categories, [], 'no hand-off expected');
      }
    }
    assert.equal(client.calls.length, script.length, 'all recorded model turns were used');
  });
}
