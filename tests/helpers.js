'use strict';

// Shared test doubles. No network: nothing here talks to Meta, Anthropic or Shopify.

let idSeq = 0;

function textResponse(text) {
  return { id: `msg_${++idSeq}`, role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 10 } };
}

function toolResponse(name, input) {
  return { id: `msg_${++idSeq}`, role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `toolu_${++idSeq}`, name, input }], usage: { input_tokens: 10, output_tokens: 10 } };
}

// A fake Anthropic client. `responder(request, callIndex)` returns the next response.
function mockAnthropic(responder) {
  const calls = [];
  return {
    calls,
    messages: {
      async create(request) {
        // Deep-copy so later mutations of the messages array don't change what we recorded.
        calls.push(JSON.parse(JSON.stringify(request)));
        return responder(request, calls.length - 1);
      },
    },
  };
}

// Returns queued responses in order.
function scriptedAnthropic(responses) {
  return mockAnthropic((_req, i) => {
    const r = responses[i];
    if (!r) throw new Error(`no scripted response #${i}`);
    if (r instanceof Error) throw r;
    return r;
  });
}

function mockWhatsApp() {
  const sent = [];
  return {
    sent,
    async sendText(to, body) { sent.push({ to, body, type: 'text' }); return { ok: true }; },
    async sendTemplate(to, name) { sent.push({ to, name, type: 'template' }); return { ok: true }; },
    async markRead() { return { ok: true }; },
  };
}

const silentLogger = { info() {}, warn() {}, error() {} };

// A site-sync snapshot as if the live site had loaded. Default prices are the ones the
// owner listed in CHANGES_v1.1 (1 = 189, 2 = 315, 3 = 439). Policy texts are only the
// ones a test passes in - nothing here pretends to be the real site wording.
function siteSnapshot({ prices = { 1: 189, 2: 315, 3: 439 }, policies = {}, faq = null, loadedPrices = true } = {}) {
  const { buildPricing, DOCS_FALLBACK_PRICES } = require('../src/pricing');
  const keys = ['refund', 'shipping', 'terms', 'privacy', 'contact'];
  return {
    version: 1,
    loaded: { prices: loadedPrices, faq: !!faq, ...Object.fromEntries(keys.map((k) => [k, !!policies[k]])) },
    pricing: buildPricing(loadedPrices ? prices : DOCS_FALLBACK_PRICES, loadedPrices ? 'site' : 'docs'),
    faq,
    policies,
    updatedAt: {},
  };
}

module.exports = { textResponse, toolResponse, mockAnthropic, scriptedAnthropic, mockWhatsApp, silentLogger, siteSnapshot };
