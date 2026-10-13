'use strict';

// Prices from docs/SALES_GUIDE_KNOWLEDGE.md. Used ONLY until the first successful
// site sync - the live site is the source of truth (CHANGES_v1.1 §1).
const DOCS_FALLBACK_PRICES = Object.freeze({ 1: 189, 2: 315, 3: 439 });

// Bundle discount vs. buying the same number of single units at the current single
// price, rounded DOWN to a whole number (CHANGES_v1.1 §2).
function bundleDiscountPercent(single, bundle, qty) {
  if (!(single > 0) || !(bundle > 0) || !(qty > 1)) return null;
  const pct = Math.floor((1 - bundle / (single * qty)) * 100 + 1e-9);
  return pct > 0 ? pct : null;
}

/**
 * @param {{1:number, 2:number, 3:number}} prices
 * @param {'site'|'docs'} source
 */
function buildPricing(prices, source) {
  const p1 = prices[1];
  const p2 = prices[2];
  const p3 = prices[3];
  const discounts = { 2: bundleDiscountPercent(p1, p2, 2), 3: bundleDiscountPercent(p1, p3, 3) };
  // No per-device or "the third one costs X" figures: they are shekel savings in disguise (CHANGES_v1.1 §2).
  return {
    prices: { 1: p1, 2: p2, 3: p3 },
    discounts,
    allowedPrices: [p1, p2, p3].filter((x) => typeof x === 'number' && x > 0),
    allowedPercents: [discounts[2], discounts[3]].filter((x) => typeof x === 'number'),
    source,
  };
}

function formatPrice(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

const DEFAULT_PRICING = buildPricing(DOCS_FALLBACK_PRICES, 'docs');

module.exports = { DOCS_FALLBACK_PRICES, DEFAULT_PRICING, bundleDiscountPercent, buildPricing, formatPrice };
