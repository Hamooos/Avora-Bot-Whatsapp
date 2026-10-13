const test = require('node:test');
const assert = require('node:assert');
const { createShopifyClient } = require('../src/shopify');

function mkFetch(log, { tokenTtl = 86399, firstGraphStatus = 200 } = {}) {
  let tokenCalls = 0;
  let graphCalls = 0;
  return async (url, opts) => {
    log.push({ url, headers: opts.headers, body: opts.body });
    if (url.endsWith('/admin/oauth/access_token')) {
      tokenCalls++;
      assert.strictEqual(JSON.parse(opts.body).grant_type, 'client_credentials');
      return { ok: true, status: 200, json: async () => ({ access_token: `tok${tokenCalls}`, expires_in: tokenTtl }) };
    }
    graphCalls++;
    const status = graphCalls === 1 ? firstGraphStatus : 200;
    return { ok: status === 200, status, json: async () => ({ data: { orders: { nodes: [] } } }) };
  };
}
const tokenReqs = (log) => log.filter((x) => x.url.endsWith('/admin/oauth/access_token'));
const graphReqs = (log) => log.filter((x) => x.url.endsWith('/graphql.json'));

test('client credentials: fetches a token, sends it, and caches it', async () => {
  const log = [];
  const c = createShopifyClient({ store: 'avora-il.myshopify.com', clientId: 'id', clientSecret: 'sec', fetchImpl: mkFetch(log), now: () => 0 });
  await c.lookupOrder('1001', '0501234567');
  await c.lookupOrder('1002', '0501234567');
  assert.strictEqual(tokenReqs(log).length, 1);
  assert.strictEqual(graphReqs(log)[0].headers['X-Shopify-Access-Token'], 'tok1');
});

test('client credentials: refreshes after expiry', async () => {
  const log = [];
  let t = 0;
  const c = createShopifyClient({ store: 'avora-il.myshopify.com', clientId: 'id', clientSecret: 'sec', fetchImpl: mkFetch(log, { tokenTtl: 3600 }), now: () => t });
  await c.lookupOrder('1001', '0501234567');
  t = 3600 * 1000;
  await c.lookupOrder('1002', '0501234567');
  assert.strictEqual(tokenReqs(log).length, 2);
});

test('client credentials: a 401 triggers one refresh and retry', async () => {
  const log = [];
  const c = createShopifyClient({ store: 'avora-il.myshopify.com', clientId: 'id', clientSecret: 'sec', fetchImpl: mkFetch(log, { firstGraphStatus: 401 }) });
  await c.lookupOrder('1001', '0501234567');
  assert.strictEqual(graphReqs(log).length, 2);
  assert.strictEqual(graphReqs(log)[1].headers['X-Shopify-Access-Token'], 'tok2');
});

test('a static access token wins and no grant request is made', async () => {
  const log = [];
  const c = createShopifyClient({ store: 'avora-il.myshopify.com', accessToken: 'static', clientId: 'id', clientSecret: 'sec', fetchImpl: mkFetch(log) });
  await c.lookupOrder('1001', '0501234567');
  assert.strictEqual(tokenReqs(log).length, 0);
  assert.strictEqual(log[0].headers['X-Shopify-Access-Token'], 'static');
});
