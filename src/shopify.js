'use strict';

const { samePhone, digitsOnly } = require('./phone');

// Read-only order lookup through the Shopify Admin GraphQL API (scope: read_orders).
// The order is returned only when BOTH the order number and the phone match, so a
// customer can't look up somebody else's order by guessing numbers.

const ORDER_QUERY = `
query OrderStatus($q: String!) {
  orders(first: 5, query: $q) {
    nodes {
      name
      createdAt
      cancelledAt
      displayFinancialStatus
      displayFulfillmentStatus
      phone
      customer { phone }
      billingAddress { phone }
      shippingAddress { phone }
      fulfillments(first: 5) {
        status
        displayStatus
        trackingInfo(first: 3) { company number url }
      }
    }
  }
}`;

const NOT_FOUND = { found: false };

function normalizeOrderNumber(value) {
  return digitsOnly(value).replace(/^0+/, '');
}

// Hebrew status sentence the bot can pass on as-is. No dates, no day counting.
function describeStatus(order) {
  const f = order.fulfillments || [];
  const statuses = f.map((x) => x.displayStatus || x.status);
  if (order.cancelledAt) return 'ההזמנה מסומנת כמבוטלת.';
  if (order.displayFinancialStatus === 'REFUNDED') return 'ההזמנה מסומנת כמזוכה.';
  if (statuses.some((s) => s === 'DELIVERED' || s === 'PICKED_UP')) return 'המשלוח מסומן כנמסר.';
  if (statuses.includes('READY_FOR_PICKUP')) return 'החבילה מסומנת כמוכנה לאיסוף.';
  if (statuses.some((s) => ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'ATTEMPTED_DELIVERY', 'FULFILLED', 'SUCCESS', 'CONFIRMED'].includes(s))
    || order.displayFulfillmentStatus === 'FULFILLED') {
    return 'ההזמנה נשלחה והיא בדרך.';
  }
  if (order.displayFulfillmentStatus === 'PARTIALLY_FULFILLED') return 'חלק מההזמנה כבר נשלח.';
  return 'ההזמנה התקבלה ונמצאת בהכנה למשלוח.';
}

function createShopifyClient({ store, accessToken, apiVersion = '2026-07', fetchImpl = globalThis.fetch, logger }) {
  const log = logger || { info() {}, warn() {}, error() {} };
  const host = String(store || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const url = `https://${host}/admin/api/${apiVersion}/graphql.json`;

  async function lookupOrder(orderNumber, phone) {
    const num = normalizeOrderNumber(orderNumber);
    if (!num) return { found: false, error: 'missing order number' };
    if (!host || !accessToken) return { found: false, error: 'shopify not configured' };

    let res;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
        body: JSON.stringify({ query: ORDER_QUERY, variables: { q: `name:${num}` } }),
      });
    } catch (err) {
      log.error('shopify_request_error', { error: err?.message });
      throw new Error('shopify unavailable');
    }
    if (res.status === 404) return NOT_FOUND;
    if (!res.ok) {
      log.error('shopify_http_error', { status: res.status });
      throw new Error(`shopify http ${res.status}`);
    }
    const data = await res.json();
    if (data.errors) {
      log.error('shopify_graphql_error', { count: data.errors.length });
      throw new Error('shopify graphql error');
    }

    const nodes = data?.data?.orders?.nodes || [];
    const order = nodes.find((o) => normalizeOrderNumber(o.name) === num
      && [o.phone, o.customer?.phone, o.billingAddress?.phone, o.shippingAddress?.phone].some((p) => samePhone(p, phone)));
    if (!order) {
      log.info('shopify_order_not_matched', { candidates: nodes.length });
      return NOT_FOUND;
    }

    const tracking = (order.fulfillments || [])
      .flatMap((f) => f.trackingInfo || [])
      .filter((t) => t.number || t.url)
      .map((t) => ({ company: t.company || null, number: t.number || null, url: t.url || null }));

    return {
      found: true,
      order_name: order.name,
      status_he: describeStatus(order),
      payment_pending: ['PENDING', 'AUTHORIZED', 'PARTIALLY_PAID'].includes(order.displayFinancialStatus),
      tracking,
    };
  }

  return { lookupOrder };
}

module.exports = { createShopifyClient, describeStatus, normalizeOrderNumber, ORDER_QUERY };
