'use strict';

// BOT_IGNORE_NUMBERS: numbers the bot never answers - their messages only go to the owner (owner 2026-10-14).

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMessageHandler } = require('../src/router');
const { InMemoryConversationStore } = require('../src/memory/store');

function setup(ignoreNumbers) {
  const sent = [];
  let agentCalls = 0;
  const handler = createMessageHandler({
    agent: { reply: async () => { agentCalls++; return { text: 'היי! כאן מעיין 😊', handoff: null }; } },
    whatsapp: { sendText: async (to, text) => { sent.push({ to, text }); }, markRead: async () => {} },
    handoff: { notify: async () => {} },
    store: new InMemoryConversationStore(),
    ownerNumber: '972500000001',
    ignoreNumbers,
  });
  return { handler, sent, agentCalls: () => agentCalls };
}

test('a number on the ignore list gets no reply and is forwarded to the owner', async () => {
  const { handler, sent, agentCalls } = setup(['0521234567']);
  const r = await handler.handle({ id: 'm1', from: '972521234567', type: 'text', text: 'היי אחי' });
  assert.equal(r.action, 'ignored_number');
  assert.equal(agentCalls(), 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, '972500000001');
  assert.match(sent[0].text, /היי אחי/);
});

test('other numbers are answered as usual', async () => {
  const { handler } = setup(['0521234567']);
  const r = await handler.handle({ id: 'm2', from: '972531112222', type: 'text', text: 'כמה זה עולה?' });
  assert.notEqual(r.action, 'ignored_number');
});
