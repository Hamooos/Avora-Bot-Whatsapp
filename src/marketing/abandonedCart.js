'use strict';

/**
 * Abandoned-cart recovery - PREPARED, NOT ENABLED in v1.
 *
 * Before this may be turned on (Israeli anti-spam law, Meta policy):
 *  1. Explicit marketing consent must be collected and stored per customer
 *     (e.g. a checkbox at checkout saved to the Shopify customer's marketing consent).
 *  2. A marketing template must be approved by Meta (Hebrew, with an opt-out line).
 *  3. A durable store for "already contacted" carts (not a local JSON file - Railway's
 *     disk is not persistent).
 *  4. The Shopify app needs the read_checkouts scope.
 *
 * The functions below are the intended structure; `runAbandonedCartJob` refuses to run
 * unless `enabled` is true AND every recipient has explicit consent.
 */

function hasExplicitMarketingConsent(customer) {
  const state = customer?.smsMarketingConsent?.marketingState || customer?.emailMarketingConsent?.marketingState;
  return state === 'SUBSCRIBED';
}

async function runAbandonedCartJob({ enabled = false, listAbandonedCheckouts, sentStore, whatsapp, templateName, logger }) {
  if (!enabled) {
    logger?.info('abandoned_cart_disabled', {});
    return { sent: 0, skipped: 0, disabled: true };
  }
  if (!templateName) throw new Error('A Meta-approved template name is required');
  const checkouts = await listAbandonedCheckouts();
  let sent = 0;
  let skipped = 0;
  for (const c of checkouts) {
    if (!c.phone || !hasExplicitMarketingConsent(c.customer) || (await sentStore.has(c.id))) { skipped++; continue; }
    const res = await whatsapp.sendTemplate(c.phone, templateName, {});
    if (res.ok) { await sentStore.add(c.id); sent++; } else skipped++;
  }
  return { sent, skipped, disabled: false };
}

module.exports = { runAbandonedCartJob, hasExplicitMarketingConsent };
