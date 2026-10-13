'use strict';

// Runs the sample conversations against the REAL Claude API (no WhatsApp, no Shopify:
// order lookups return the recorded results). Writes tests/conversations/live/*.json
// so you can compare the live replies with the expected ones.
//
//   ANTHROPIC_API_KEY=... node scripts/run-conversations-live.js [conversation-id-prefix]

const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { loadConfig } = require('../src/config');
const { AvoraAgent } = require('../src/agent/agent');
const { InMemoryConversationStore } = require('../src/memory/store');
const { detect } = require('../src/router');
const { checkReply } = require('../src/compliance');

async function main() {
  const config = loadConfig();
  if (!config.anthropic.apiKey) {
    console.error('ANTHROPIC_API_KEY is not set - nothing to do.');
    process.exit(1);
  }
  const filter = process.argv[2] || '';
  const dir = path.join(__dirname, '..', 'tests', 'conversations');
  const outDir = path.join(dir, 'live');
  fs.mkdirSync(outDir, { recursive: true });
  const client = new Anthropic({ apiKey: config.anthropic.apiKey, maxRetries: 3 });
  let failures = 0;

  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f.startsWith(filter)).sort()) {
    const conv = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const toolResults = conv.turns.filter((t) => t.tool).map((t) => t.tool.result);
    const agent = new AvoraAgent({
      client,
      model: config.anthropic.model,
      effort: config.anthropic.effort,
      maxTokens: config.anthropic.maxTokens,
      store: new InMemoryConversationStore(),
      orderLookup: async () => toolResults.shift() || { found: false },
    });
    const turns = [];
    console.log(`\n=== ${conv.id} (${conv.topic})`);
    for (const turn of conv.turns) {
      const notes = detect(turn.customer).map((d) => d.note);
      const r = await agent.respond({ phone: '972500000000', text: turn.customer, notes });
      const check = checkReply(r.reply);
      if (!check.ok || r.fallback) failures++;
      console.log(`לקוח: ${turn.customer}\nבוט:  ${r.reply}\n  handoffs=${r.handoffs.map((h) => h.category).join(',') || '-'} compliant=${check.ok}${r.fallback ? ' FALLBACK' : ''}`);
      turns.push({ customer: turn.customer, bot: r.reply, expected: turn.bot, handoffs: r.handoffs, compliant: check.ok, fallback: r.fallback });
    }
    fs.writeFileSync(path.join(outDir, file), JSON.stringify({ id: conv.id, topic: conv.topic, source: `live - ${config.anthropic.model} - ${new Date().toISOString()}`, turns }, null, 2) + '\n');
  }
  console.log(`\nDone. ${failures} non-compliant or fallback replies.`);
  process.exit(failures ? 2 : 0);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
