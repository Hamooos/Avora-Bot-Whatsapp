'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createShopifyClient, describeStatus } = require('../src/shopify');
const { silentLogger } = require('./helpers');

const TOKEN = 'shpat_test_token';

function mockFetch(orders, { status = 200, errors } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts, body: JSON.parse(opts.body) });
    return {
      ok: status >= 200 && status < 300,
      status,
      async json() { return errors ? { errors } : { data: { orders: { nodes: orders } } }; },
    };
  };
  return { fetchImpl, calls };
}

function order(overrides = {}) {
  return {
    name: '#1042',
    createdAt: '2026-10-01T10:00:00Z',
    cancelledAt: null,
    displayFinancialStatus: 'PAID',
    displayFulfillmentStatus: 'UNFULFILLED',
    phone: null,
    customer: { phone: '+972501234567' },
    billingAddress: { phone: '050-123-4567' },
    shippingAddress: null,
    fulfillments: [],
    ...overrides,
  };
}

const client = (fetchImpl) => createShopifyClient({ store: 'avora-il.myshopify.com', accessToken: TOKEN, apiVersion: '2026-07', fetchImpl, logger: silentLogger });

test('finds an order when the number AND the phone match, using the read-only GraphQL endpoint', async () => {
  const { fetchImpl, calls } = mockFetch([order()]);
  const r = await client(fetchImpl).lookupOrder('#1042', '972501234567');
  assert.deepEqual(r, { found: true, order_name: '#1042', status_he: 'ההזמנה התקבלה ונמצאת בהכנה למשלוח.', payment_pending: false, tracking: [] });
  assert.equal(calls[0].url, 'https://avora-il.myshopify.com/admin/api/2026-07/graphql.json');
  assert.equal(calls[0].opts.headers['X-Shopify-Access-Token'], TOKEN);
  assert.equal(calls[0].body.variables.q, 'name:1042');
  assert.doesNotMatch(calls[0].body.query, /mutation/);
});

test('phone formats are matched (+972 / 05x / spaces / dashes)', async () => {
  const { fetchImpl } = mockFetch([order({ customer: null, billingAddress: null, shippingAddress: { phone: '+972 50-123-4567' } })]);
  const r = await client(fetchImpl).lookupOrder('1042', '0501234567');
  assert.equal(r.found, true);
});

test('a different phone gets the same "not found" as a missing order (no enumeration)', async () => {
  const { fetchImpl } = mockFetch([order()]);
  assert.deepEqual(await client(fetchImpl).lookupOrder('1042', '972529999999'), { found: false });
  const empty = mockFetch([]);
  assert.deepEqual(await client(empty.fetchImpl).lookupOrder('9999', '972501234567'), { found: false });
});

test('another order whose number merely contains the digits is not returned', async () => {
  const { fetchImpl } = mockFetch([order({ name: '#10421' })]);
  assert.deepEqual(await client(fetchImpl).lookupOrder('1042', '972501234567'), { found: false });
});

test('shipped order returns tracking; private fields are not passed to the model', async () => {
  const { fetchImpl } = mockFetch([order({
    displayFulfillmentStatus: 'FULFILLED',
    fulfillments: [{ status: 'SUCCESS', displayStatus: 'IN_TRANSIT', trackingInfo: [{ company: 'Israel Post', number: 'RR123456789IL', url: 'https://example.com/t/RR123456789IL' }] }],
  })]);
  const r = await client(fetchImpl).lookupOrder('1042', '972501234567');
  assert.equal(r.status_he, 'ההזמנה נשלחה והיא בדרך.');
  assert.deepEqual(r.tracking, [{ company: 'Israel Post', number: 'RR123456789IL', url: 'https://example.com/t/RR123456789IL' }]);
  assert.equal(JSON.stringify(r).includes('0501234567'), false);
  assert.equal('customer' in r || 'billingAddress' in r, false);
});

test('status descriptions', () => {
  assert.equal(describeStatus(order({ cancelledAt: '2026-10-02T00:00:00Z' })), 'ההזמנה מסומנת כמבוטלת.');
  assert.equal(describeStatus(order({ fulfillments: [{ displayStatus: 'DELIVERED' }] })), 'המשלוח מסומן כנמסר.');
  assert.equal(describeStatus(order({ fulfillments: [{ displayStatus: 'READY_FOR_PICKUP' }] })), 'החבילה מסומנת כמוכנה לאיסוף.');
  assert.equal(describeStatus(order({ displayFinancialStatus: 'REFUNDED' })), 'ההזמנה מסומנת כמזוכה.');
});

test('errors: HTTP 404 -> not found, 401/500 and GraphQL errors throw (agent then hands off)', async () => {
  assert.deepEqual(await client(mockFetch([], { status: 404 }).fetchImpl).lookupOrder('1', '972501234567'), { found: false });
  await assert.rejects(client(mockFetch([], { status: 401 }).fetchImpl).lookupOrder('1', '972501234567'));
  await assert.rejects(client(mockFetch([], { status: 500 }).fetchImpl).lookupOrder('1', '972501234567'));
  await assert.rejects(client(mockFetch([], { errors: [{ message: 'Access denied' }] }).fetchImpl).lookupOrder('1', '972501234567'));
});

test('missing order number or configuration does not call Shopify', async () => {
  const { fetchImpl, calls } = mockFetch([order()]);
  assert.equal((await client(fetchImpl).lookupOrder('', '972501234567')).found, false);
  const unconfigured = createShopifyClient({ store: '', accessToken: '', fetchImpl, logger: silentLogger });
  assert.equal((await unconfigured.lookupOrder('1042', '972501234567')).found, false);
  assert.equal(calls.length, 0);
});
