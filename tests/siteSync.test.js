'use strict';

// Live-site sync (CHANGES_v1.1 §1). Uses the synthetic fixtures in tests/fixtures/site/
// (the real site is not reachable from the test environment).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createSiteSync, renderSiteBlock, emptySnapshot,
  parseProductJson, parseBundlePrices, extractProductFaq, extractPolicy, cleanText,
} = require('../src/siteSync');
const { buildSystemPrompt } = require('../src/agent/systemPrompt');
const { bundleDiscountPercent, buildPricing } = require('../src/pricing');
const { silentLogger } = require('./helpers');

const FIX = path.join(__dirname, 'fixtures', 'site');
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');
const PRODUCT_JSON = read('product.js.json');
const PRODUCT_PAGE = read('product-page.html');
const REFUND = read('refund-policy.html');
const GENERIC = read('generic-policy.html');

function siteFetch(overrides = {}) {
  const calls = [];
  const pages = {
    '/products/avora-plus.js': PRODUCT_JSON,
    '/products/avora-plus': PRODUCT_PAGE,
    '/policies/refund-policy': REFUND,
    '/policies/shipping-policy': GENERIC,
    '/policies/terms-of-service': GENERIC,
    '/policies/privacy-policy': GENERIC,
    '/policies/contact-information': GENERIC,
    ...overrides,
  };
  const fetchImpl = async (url) => {
    const p = new URL(url).pathname;
    calls.push(p);
    const body = pages[p];
    if (body instanceof Error) throw body;
    if (body === undefined || body === 404) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, status: 200, text: async () => body };
  };
  return { fetchImpl, calls, pages };
}

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'avora-site-')), 'site-cache.json');

test('discount % is computed against single units and rounded down', () => {
  assert.equal(bundleDiscountPercent(189, 315, 2), 16);
  assert.equal(bundleDiscountPercent(189, 439, 3), 22);
  assert.equal(bundleDiscountPercent(200, 300, 2), 25);
  assert.equal(bundleDiscountPercent(100, 199, 2), null); // < 1% is not a discount
  assert.deepEqual(buildPricing({ 1: 199, 2: 330, 3: 459 }, 'site').discounts, { 2: 17, 3: 23 });
});

test('single price comes from the product JSON in cents', () => {
  assert.equal(parseProductJson(PRODUCT_JSON), 189);
  assert.equal(parseProductJson({ variants: [{ price: 19950 }] }), 199.5);
  assert.equal(parseProductJson({ price: 0 }), null);
});

test('bundle prices come from the quantity-break block, skipping compare-at and per-unit prices', () => {
  assert.deepEqual(parseBundlePrices(PRODUCT_PAGE, 189), { 2: 315, 3: 439 });
  // Without a sane block nothing is returned (never a guess).
  assert.equal(parseBundlePrices('<main><p>2 מכשירים ₪999</p></main>', 189), null);
  assert.equal(parseBundlePrices(PRODUCT_PAGE, 0), null);
});

test('FAQ and policy text: site chrome, banners, coupons, links, emails and phones are removed', () => {
  const faq = extractProductFaq(PRODUCT_PAGE);
  assert.match(faq, /10 דקות ביום/);
  assert.doesNotMatch(faq, /50%|WELCOME10|קופון|055-000-0000|כל הזכויות/);
  const refund = extractPolicy(REFUND);
  assert.match(refund, /סעיף א/);
  assert.doesNotMatch(refund, /https?:|@|050-000-0000|קופון|פוטר|תפריט/);
  assert.match(refund, /\[קישור\].*\[אימייל\].*\[טלפון\]/);
  assert.equal(extractPolicy('<html><body><p>no policy here</p></body></html>'), null);
  assert.equal(cleanText('a\n\n  b   c\nb   c'), 'a\nb c');
});

test('sync loads everything from the site', async () => {
  const { fetchImpl, calls } = siteFetch();
  const sync = createSiteSync({ fetchImpl, logger: silentLogger, intervalMs: 0 });
  const snap = await sync.refresh();
  assert.equal(calls.length, 7);
  assert.deepEqual(snap.pricing.prices, { 1: 189, 2: 315, 3: 439 });
  assert.deepEqual(snap.pricing.discounts, { 2: 16, 3: 22 });
  assert.equal(snap.pricing.source, 'site');
  assert.ok(Object.values(snap.loaded).every(Boolean));
});

test('a failed fetch keeps the last good copy and logs a warning', async () => {
  const warnings = [];
  const logger = { ...silentLogger, warn: (e, f) => warnings.push([e, f]) };
  const site = siteFetch();
  const sync = createSiteSync({ fetchImpl: site.fetchImpl, logger, intervalMs: 0 });
  await sync.refresh();
  site.pages['/policies/refund-policy'] = new Error('ECONNRESET');
  site.pages['/products/avora-plus'] = 404;
  const snap = await sync.refresh();
  assert.match(snap.policies.refund, /סעיף א/);
  assert.deepEqual(snap.pricing.prices, { 1: 189, 2: 315, 3: 439 });
  assert.match(snap.faq, /10 דקות/);
  assert.ok(warnings.some(([e, f]) => e === 'site_sync_part_failed' && f.part === 'refund'));
  assert.ok(warnings.some(([e, f]) => e === 'site_sync_part_failed' && f.part === 'product_page'));
});

test('the last good copy is saved to disk and loaded on the next start', async () => {
  const cacheFile = tmpFile();
  const first = createSiteSync({ fetchImpl: siteFetch().fetchImpl, cacheFile, logger: silentLogger, intervalMs: 0 });
  await first.start();
  // Second process: the site is down - it still has the data from disk.
  const down = async () => { throw new Error('offline'); };
  const second = createSiteSync({ fetchImpl: down, cacheFile, logger: silentLogger, intervalMs: 0 });
  const snap = await second.start();
  assert.equal(snap.loaded.prices, true);
  assert.equal(snap.loaded.refund, true);
  assert.deepEqual(snap.pricing.prices, { 1: 189, 2: 315, 3: 439 });
});

test('never loaded: falls back to docs prices and marks every part as not loaded', async () => {
  const down = async () => { throw new Error('offline'); };
  const sync = createSiteSync({ fetchImpl: down, logger: silentLogger, intervalMs: 0 });
  const snap = await sync.start();
  assert.equal(snap.pricing.source, 'docs');
  assert.deepEqual(snap.pricing.prices, { 1: 189, 2: 315, 3: 439 });
  assert.ok(Object.values(snap.loaded).every((v) => v === false));
  const block = renderSiteBlock(snap);
  assert.match(block, /האתר לא נטען/);
  assert.match(block, /handoff_to_human/);
});

test('price change alerts the owner once, with old and new prices', async () => {
  const alerts = [];
  const site = siteFetch();
  const sync = createSiteSync({ fetchImpl: site.fetchImpl, logger: silentLogger, intervalMs: 0, onPricesChanged: async (o, n, text) => alerts.push(text) });
  await sync.refresh(); // same as the last known (docs) prices -> no alert
  assert.equal(alerts.length, 0);
  site.pages['/products/avora-plus.js'] = JSON.stringify({ price: 19900 });
  site.pages['/products/avora-plus'] = PRODUCT_PAGE.replace('₪315.00', '₪330.00').replace('₪439.00', '₪459.00').replace(/₪189\.00/g, '₪199.00');
  const snap = await sync.refresh();
  await sync.refresh();
  assert.deepEqual(snap.pricing.prices, { 1: 199, 2: 330, 3: 459 });
  assert.deepEqual(snap.pricing.discounts, { 2: 17, 3: 23 });
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /^המחירים באתר השתנו: /);
  assert.match(alerts[0], /189 ₪ -> 199 ₪/);
  assert.match(alerts[0], /315 ₪ -> 330 ₪/);
});

test('start() schedules a refresh every interval', async () => {
  const site = siteFetch();
  const sync = createSiteSync({ fetchImpl: site.fetchImpl, logger: silentLogger, intervalMs: 20 });
  await sync.start();
  await new Promise((r) => setTimeout(r, 70));
  sync.stop();
  assert.ok(site.calls.length >= 14, `only ${site.calls.length} fetches`);
});

test('system prompt order: rules, then "אתר - מידע עדכני", then docs/', async () => {
  const sync = createSiteSync({ fetchImpl: siteFetch().fetchImpl, logger: silentLogger, intervalMs: 0 });
  const snap = await sync.refresh();
  const blocks = buildSystemPrompt({ site: snap });
  assert.equal(blocks.length, 3);
  assert.match(blocks[0].text, /^You are מעיין \(Maayan\), the customer-service persona of Avora/);
  assert.match(blocks[1].text, /^# אתר - מידע עדכני/);
  assert.match(blocks[1].text, /2 מכשירים: 315 ₪ \(חיסכון של 16%\)/);
  assert.match(blocks[1].text, /3 מכשירים: 439 ₪ \(חיסכון של 22%\)/);
  assert.match(blocks[1].text, /סעיף א/);
  assert.match(blocks[2].text, /<document name="PRODUCT_PAGE_FAQ.md">/);
  assert.deepEqual(blocks[0].cache_control, { type: 'ephemeral' });
  assert.deepEqual(blocks[2].cache_control, { type: 'ephemeral' });
  // Nothing from the site chrome reaches the prompt.
  assert.doesNotMatch(blocks[1].text, /WELCOME10|50%|055-000-0000/);
  // A changed site produces a different prompt; an empty snapshot keeps the docs fallback.
  assert.notEqual(buildSystemPrompt({ site: emptySnapshot() })[1].text, blocks[1].text);
});

test('the coupon rule is only in the prompt when the owner enables it', () => {
  assert.doesNotMatch(buildSystemPrompt()[0].text, /owner has enabled it/);
  assert.match(buildSystemPrompt({ couponEnabled: true })[0].text, /owner has enabled it/);
});
