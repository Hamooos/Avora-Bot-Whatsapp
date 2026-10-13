'use strict';

const fs = require('fs');
const path = require('path');
const { parse } = require('node-html-parser');
const { DOCS_FALLBACK_PRICES, buildPricing, formatPrice } = require('./pricing');

// Live-site sync (CHANGES_v1.1 §1). The website is the source of truth for prices,
// the on-page FAQ and the policies. Every part keeps its last good copy: a failed fetch
// or a page we can't parse never replaces good data, it only logs a warning.

const POLICY_PATHS = {
  refund: '/policies/refund-policy',
  shipping: '/policies/shipping-policy',
  terms: '/policies/terms-of-service',
  privacy: '/policies/privacy-policy',
  contact: '/policies/contact-information',
};
const PRODUCT_JSON_PATH = '/products/avora-plus.js';
const PRODUCT_PAGE_PATH = '/products/avora-plus';

const POLICY_TITLES = {
  refund: 'מדיניות החזרים',
  shipping: 'מדיניות משלוחים',
  terms: 'תנאי שימוש',
  privacy: 'מדיניות פרטיות',
  contact: 'פרטי קשר',
};

// Site chrome that must never reach the prompt: header/footer, newsletter popup,
// announcement / sale banners, and crossed-out compare-at prices.
const NOISE_SELECTORS = [
  'script', 'style', 'noscript', 'template', 'svg', 'iframe', 'header', 'footer', 'nav',
  's', 'del', 'strike',
  '[class*="compare"]', '[class*="newsletter"]', '[class*="popup"]', '[class*="modal"]',
  '[class*="announcement"]', '[id*="announcement"]', '[class*="header"]', '[id*="header"]',
  '[class*="footer"]', '[id*="footer"]', '[class*="cart-drawer"]',
];

const MAX_TEXT_CHARS = 12000;

function stripNoise(root) {
  for (const sel of NOISE_SELECTORS) {
    for (const el of root.querySelectorAll(sel)) el.remove();
  }
  return root;
}

// Plain text, one block per line, no URLs / phone numbers / emails (the bot must never
// hand those out, so they don't belong in its context either).
function cleanText(text) {
  return String(text || '')
    .replace(/https?:\/\/\S+|www\.\S+/g, '[קישור]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[אימייל]')
    .replace(/(?<!\d)(?:\+?972[\s-]?|0)\d{1,2}[\s-]?\d{3}[\s-]?\d{3,4}(?!\d)/g, '[טלפון]')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l, i, arr) => l && l !== arr[i - 1])
    .join('\n')
    .slice(0, MAX_TEXT_CHARS);
}

function htmlToText(el) {
  return el ? cleanText(el.structuredText) : '';
}

/** Single-unit price from /products/<handle>.js (Shopify returns cents). */
function parseProductJson(body) {
  const data = typeof body === 'string' ? JSON.parse(body) : body;
  const cents = Number.isFinite(data?.price) ? data.price : data?.variants?.[0]?.price;
  const price = Number(cents) / 100;
  return price > 0 ? price : null;
}

const PRICE_RE = /₪\s*(\d{2,5}(?:[.,]\d{1,2})?)|(\d{2,5}(?:[.,]\d{1,2})?)\s*(?:₪|ש"ח|ש״ח|ש''ח)/g;
const QTY_LABELS = {
  2: /(?<!\d)2\s*(?:מכשירים|יחידות|יח['׳"]?|x|X|×)|שני\s+מכשירים|זוג(?![א-ת])/g,
  3: /(?<!\d)3\s*(?:מכשירים|יחידות|יח['׳"]?|x|X|×)|שלושה\s+מכשירים/g,
};

/**
 * Bundle prices from the product page's quantity-break block. For each quantity label,
 * takes the first price after it that passes a sanity check (more than the single price,
 * less than buying that many singles), which skips compare-at and per-unit figures.
 */
function parseBundlePrices(html, single) {
  if (!(single > 0)) return null;
  const root = stripNoise(parse(html));
  const text = root.structuredText;
  const result = {};
  for (const qty of [2, 3]) {
    const label = QTY_LABELS[qty];
    label.lastIndex = 0;
    let m;
    while (!result[qty] && (m = label.exec(text)) !== null) {
      const window = text.slice(m.index + m[0].length, m.index + m[0].length + 160);
      PRICE_RE.lastIndex = 0;
      let p;
      while ((p = PRICE_RE.exec(window)) !== null) {
        const value = Number((p[1] || p[2]).replace(',', '.'));
        if (value > single && value < single * qty) { result[qty] = value; break; }
      }
    }
  }
  if (!result[2] || !result[3] || !(result[3] > result[2])) return null;
  return result;
}

/** The on-page FAQ: accordion/FAQ blocks if the theme marks them, else the text after "שאלות נפוצות". */
function extractProductFaq(html) {
  const root = stripNoise(parse(html));
  const blocks = root.querySelectorAll('[class*="faq"], [id*="faq"], [class*="accordion"], [class*="collapsible"]');
  // Keep only outermost matches so nested blocks aren't repeated.
  const outer = blocks.filter((el) => !blocks.some((other) => other !== el && isAncestor(other, el)));
  let text = outer.map((el) => el.structuredText).join('\n');
  if (!text.trim()) {
    const all = (root.querySelector('main') || root).structuredText;
    const i = all.indexOf('שאלות נפוצות');
    text = i >= 0 ? all.slice(i) : '';
  }
  const cleaned = cleanText(text);
  return cleaned.length >= 40 ? cleaned : null;
}

function isAncestor(a, b) {
  for (let p = b.parentNode; p; p = p.parentNode) if (p === a) return true;
  return false;
}

/** Policy body: the element with class shopify-policy__body. */
function extractPolicy(html) {
  const root = parse(html);
  const body = root.querySelector('.shopify-policy__body');
  if (!body) return null;
  const text = htmlToText(stripNoise(body));
  return text.length >= 20 ? text : null;
}

function samePrices(a, b) {
  return !!a && !!b && [1, 2, 3].every((q) => a[q] === b[q]);
}

function pricesKey(p) {
  return p ? [1, 2, 3].map((q) => p[q]).join('/') : '';
}

function describePriceChange(oldP, newP) {
  const names = { 1: 'מכשיר אחד', 2: '2 מכשירים', 3: '3 מכשירים' };
  return [1, 2, 3].map((q) => `${names[q]}: ${oldP?.[q] != null ? `${formatPrice(oldP[q])} ₪ -> ` : ''}${formatPrice(newP[q])} ₪`).join(', ');
}

/**
 * @param {object} opts
 * @param {string} [opts.baseUrl]
 * @param {Function} [opts.fetchImpl]
 * @param {string} [opts.cacheFile]       JSON file for the last good copy ('' to disable)
 * @param {number} [opts.intervalMs]      default 6 hours
 * @param {Function} [opts.onPricesChanged] async (oldPrices, newPrices, text) - alert the owner
 */
function createSiteSync({ baseUrl = 'https://avora-il.com', fetchImpl = globalThis.fetch, cacheFile = '', intervalMs = 6 * 60 * 60 * 1000, logger, onPricesChanged, now = () => Date.now(), timeoutMs = 15000 } = {}) {
  const log = logger || { info() {}, warn() {}, error() {} };
  const base = baseUrl.replace(/\/+$/, '');
  let state = {
    prices: null,          // { 1, 2, 3 } from the site
    faq: null,
    policies: {},          // key -> text
    updatedAt: {},         // part -> ISO time of the last good copy
    lastKnownPrices: { ...DOCS_FALLBACK_PRICES },
    alertedPricesKey: '',
  };
  let version = 0;
  let timer = null;

  function loadCache() {
    if (!cacheFile) return;
    try {
      const saved = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      state = { ...state, ...saved, policies: { ...saved.policies }, updatedAt: { ...saved.updatedAt } };
      version++;
      log.info('site_cache_loaded', { parts: Object.keys(state.updatedAt).join(',') });
    } catch (err) {
      if (err.code !== 'ENOENT') log.warn('site_cache_unreadable', { error: err.message });
    }
  }

  function saveCache() {
    if (!cacheFile) return;
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(state, null, 2));
    } catch (err) {
      log.warn('site_cache_write_failed', { error: err.message });
    }
  }

  async function get(pathname) {
    const res = await fetchImpl(base + pathname, {
      headers: { 'User-Agent': 'AvoraWhatsAppBot/1.1 (site-sync)', Accept: pathname.endsWith('.js') ? 'application/json' : 'text/html' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }

  // Fetch + parse one part; returns null (and logs) on any failure.
  async function attempt(part, pathname, parser) {
    try {
      const value = parser(await get(pathname));
      if (value == null) throw new Error('could not parse');
      return value;
    } catch (err) {
      log.warn('site_sync_part_failed', { part, path: pathname, error: err.message });
      return null;
    }
  }

  async function refresh() {
    const stamp = new Date(now()).toISOString();
    const [single, pageHtml, ...policyTexts] = await Promise.all([
      attempt('price_single', PRODUCT_JSON_PATH, parseProductJson),
      attempt('product_page', PRODUCT_PAGE_PATH, (h) => h),
      ...Object.entries(POLICY_PATHS).map(([key, p]) => attempt(key, p, extractPolicy)),
    ]);
    let changed = false;

    if (pageHtml) {
      const faq = extractProductFaq(pageHtml);
      if (faq) {
        if (faq !== state.faq) changed = true;
        state.faq = faq;
        state.updatedAt.faq = stamp;
      } else log.warn('site_sync_part_failed', { part: 'faq', error: 'could not parse' });
    }

    const bundles = single && pageHtml ? parseBundlePrices(pageHtml, single) : null;
    if (single && pageHtml && !bundles) log.warn('site_sync_part_failed', { part: 'bundle_prices', error: 'could not parse' });
    let priceChange = null;
    if (single && bundles) {
      const prices = { 1: single, 2: bundles[2], 3: bundles[3] };
      if (!samePrices(prices, state.prices)) changed = true;
      if (!samePrices(prices, state.lastKnownPrices) && pricesKey(prices) !== state.alertedPricesKey) {
        priceChange = { old: state.lastKnownPrices, new: prices };
        state.alertedPricesKey = pricesKey(prices);
      }
      state.prices = prices;
      state.lastKnownPrices = prices;
      state.updatedAt.prices = stamp;
    }

    Object.keys(POLICY_PATHS).forEach((key, i) => {
      const text = policyTexts[i];
      if (!text) return;
      if (text !== state.policies[key]) changed = true;
      state.policies[key] = text;
      state.updatedAt[key] = stamp;
    });

    if (changed) version++;
    saveCache();
    log.info('site_sync_done', { parts: Object.keys(state.updatedAt).join(','), changed });

    if (priceChange && onPricesChanged) {
      const text = `המחירים באתר השתנו: ${describePriceChange(priceChange.old, priceChange.new)}`;
      try { await onPricesChanged(priceChange.old, priceChange.new, text); } catch (err) { log.error('price_alert_failed', { error: err.message }); }
    }
    return snapshot();
  }

  function snapshot() {
    const pricesLoaded = !!state.prices;
    return {
      version,
      loaded: {
        prices: pricesLoaded,
        faq: !!state.faq,
        ...Object.fromEntries(Object.keys(POLICY_PATHS).map((k) => [k, !!state.policies[k]])),
      },
      pricing: buildPricing(pricesLoaded ? state.prices : state.lastKnownPrices, pricesLoaded ? 'site' : 'docs'),
      faq: state.faq,
      policies: { ...state.policies },
      updatedAt: { ...state.updatedAt },
    };
  }

  async function start() {
    loadCache();
    await refresh().catch((err) => log.error('site_sync_error', { error: err.message }));
    if (intervalMs > 0) {
      timer = setInterval(() => refresh().catch((err) => log.error('site_sync_error', { error: err.message })), intervalMs);
      timer.unref();
    }
    return snapshot();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop, refresh, snapshot, loadCache };
}

/** The "אתר - מידע עדכני" block for the system prompt. */
function renderSiteBlock(snap) {
  const { pricing, loaded } = snap;
  const p = pricing.prices;
  const lines = ['# אתר - מידע עדכני (avora-il.com)', 'Where this block and the documents below disagree, THIS block wins.', ''];
  lines.push(loaded.prices ? '## מחירים נוכחיים באתר' : '## מחירים (מהמסמכים - האתר לא נטען)');
  lines.push(`- מכשיר אחד: ${formatPrice(p[1])} ₪`);
  lines.push(`- 2 מכשירים: ${formatPrice(p[2])} ₪${pricing.discounts[2] ? ` (חיסכון של ${pricing.discounts[2]}%)` : ''}`);
  lines.push(`- 3 מכשירים: ${formatPrice(p[3])} ₪${pricing.discounts[3] ? ` (חיסכון של ${pricing.discounts[3]}%)` : ''}`);
  lines.push('The only discount figures you may use are the percentages above.');
  if (!loaded.prices) {
    lines.push('Site prices could NOT be loaded, so these come from the documents and may be out of date. For any price, discount or bundle question: give these prices, add that the team will confirm, and call handoff_to_human.');
  }
  lines.push('');
  lines.push('## שאלות נפוצות בדף המוצר');
  lines.push(loaded.faq ? snap.faq : '(not loaded - use PRODUCT_PAGE_FAQ.md below)');
  for (const key of Object.keys(POLICY_PATHS)) {
    lines.push('');
    lines.push(`## ${POLICY_TITLES[key]}`);
    lines.push(loaded[key] ? snap.policies[key] : '(not loaded - for questions on this topic say "אבדוק ואחזור אליך" and call handoff_to_human)');
  }
  return lines.join('\n');
}

/** A sync that never loaded anything - used by tests and when the sync is disabled. */
function emptySnapshot() {
  return {
    version: 0,
    loaded: { prices: false, faq: false, ...Object.fromEntries(Object.keys(POLICY_PATHS).map((k) => [k, false])) },
    pricing: buildPricing(DOCS_FALLBACK_PRICES, 'docs'),
    faq: null,
    policies: {},
    updatedAt: {},
  };
}

module.exports = {
  createSiteSync, renderSiteBlock, emptySnapshot,
  parseProductJson, parseBundlePrices, extractProductFaq, extractPolicy, cleanText,
  POLICY_PATHS, PRODUCT_JSON_PATH, PRODUCT_PAGE_PATH,
};
