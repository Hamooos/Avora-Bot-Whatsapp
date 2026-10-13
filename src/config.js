'use strict';

// All secrets come from environment variables only. Never log these values.
function loadConfig(env = process.env) {
  const bool = (v, dflt = false) => (v === undefined || v === '' ? dflt : /^(1|true|yes)$/i.test(v));
  const num = (v, dflt) => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? dflt : Number(v));

  return {
    port: Number(env.PORT) || 3000,
    isProduction: env.NODE_ENV === 'production',
    whatsapp: {
      token: env.WHATSAPP_TOKEN || '',
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
      verifyToken: env.WHATSAPP_VERIFY_TOKEN || '',
      appSecret: env.WHATSAPP_APP_SECRET || '',
      graphVersion: env.WHATSAPP_GRAPH_VERSION || 'v23.0',
      // When true, outgoing WhatsApp messages are logged instead of sent.
      dryRun: bool(env.WHATSAPP_DRY_RUN, false),
    },
    ownerNumber: env.OWNER_WHATSAPP_NUMBER || '',
    // Optional: name of a Meta-approved utility template used to alert the owner
    // when the 24h customer-service window with the owner's number is closed.
    ownerNotifyTemplate: env.OWNER_NOTIFY_TEMPLATE || '',
    anthropic: {
      apiKey: env.ANTHROPIC_API_KEY || '',
      model: env.CLAUDE_MODEL || 'claude-sonnet-5-5',
      effort: env.CLAUDE_EFFORT || 'low',
      maxTokens: Number(env.CLAUDE_MAX_TOKENS) || 2000,
    },
    shopify: {
      store: env.SHOPIFY_STORE || '',
      accessToken: env.SHOPIFY_ACCESS_TOKEN || '',
      // Dev Dashboard apps (2026+): no permanent token - client credentials grant, refreshed automatically
      clientId: env.SHOPIFY_CLIENT_ID || '',
      clientSecret: env.SHOPIFY_CLIENT_SECRET || '',
      apiVersion: env.SHOPIFY_API_VERSION || '2026-07',
    },
    // Live-site sync (CHANGES_v1.1 §1)
    site: {
      baseUrl: env.SITE_URL || 'https://avora-il.com',
      syncHours: num(env.SITE_SYNC_HOURS, 6),
      cacheFile: env.SITE_CACHE_FILE ?? 'data/site-cache.json',
    },
    // After a hand-off (CHANGES_v1.1 §6)
    handoffQuietMinutes: num(env.HANDOFF_QUIET_MINUTES, 120),
    maxReassurancesPerDay: num(env.HANDOFF_MAX_REASSURANCES_PER_DAY, 3),
    // Newsletter coupon may be mentioned only when the owner enables it (CHANGES_v1.1 §2).
    couponEnabled: bool(env.NEWSLETTER_COUPON_ENABLED, false),
    // Marketing (abandoned cart) is intentionally OFF in v1. See src/marketing/.
    marketingEnabled: false,
  };
}

// Returns the names (never values) of required variables that are missing.
function missingRequired(config) {
  const missing = [];
  if (!config.whatsapp.token) missing.push('WHATSAPP_TOKEN');
  if (!config.whatsapp.phoneNumberId) missing.push('WHATSAPP_PHONE_NUMBER_ID');
  if (!config.whatsapp.verifyToken) missing.push('WHATSAPP_VERIFY_TOKEN');
  if (!config.whatsapp.appSecret) missing.push('WHATSAPP_APP_SECRET');
  if (!config.ownerNumber) missing.push('OWNER_WHATSAPP_NUMBER');
  if (!config.anthropic.apiKey) missing.push('ANTHROPIC_API_KEY');
  if (!config.shopify.store) missing.push('SHOPIFY_STORE');
  if (!config.shopify.accessToken && !(config.shopify.clientId && config.shopify.clientSecret)) missing.push('SHOPIFY_ACCESS_TOKEN or SHOPIFY_CLIENT_ID+SHOPIFY_CLIENT_SECRET');
  return missing;
}

module.exports = { loadConfig, missingRequired };
