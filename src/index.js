'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { loadConfig, missingRequired } = require('./config');
const { createLogger } = require('./logger');
const { createApp } = require('./server');
const { createWhatsAppClient } = require('./whatsapp');
const { createShopifyClient } = require('./shopify');
const { createHandoffService } = require('./handoff');
const { createMessageHandler, createRateLimiter } = require('./router');
const { InMemoryConversationStore } = require('./memory/store');
const { AvoraAgent } = require('./agent/agent');

function main() {
  const config = loadConfig();
  const logger = createLogger({ isProduction: config.isProduction });

  const missing = missingRequired(config);
  if (missing.length) logger.warn('config_missing', { vars: missing.join(',') });

  const whatsapp = createWhatsAppClient({ ...config.whatsapp, logger });
  const shopify = createShopifyClient({ ...config.shopify, logger });
  const store = new InMemoryConversationStore();
  const handoff = createHandoffService({ whatsapp, ownerNumber: config.ownerNumber, ownerNotifyTemplate: config.ownerNotifyTemplate, logger });

  // Max 5 order lookups per customer per hour (stops order-number guessing).
  const lookupAllowed = createRateLimiter({ limit: 5, windowMs: 60 * 60 * 1000 });
  const orderLookup = (orderNumber, phone) => (lookupAllowed(phone)
    ? shopify.lookupOrder(orderNumber, phone)
    : { found: false, error: 'too many lookups - hand off to a human' });

  const agent = new AvoraAgent({
    client: new Anthropic({ apiKey: config.anthropic.apiKey, maxRetries: 3 }),
    model: config.anthropic.model,
    effort: config.anthropic.effort,
    maxTokens: config.anthropic.maxTokens,
    store,
    orderLookup,
    logger,
  });

  const handler = createMessageHandler({ agent, whatsapp, handoff, store, ownerNumber: config.ownerNumber, logger });
  const app = createApp({ verifyToken: config.whatsapp.verifyToken, appSecret: config.whatsapp.appSecret, handler, logger });

  app.listen(config.port, () => {
    logger.info('server_started', { port: config.port, model: config.anthropic.model, dryRun: config.whatsapp.dryRun });
  });
}

if (require.main === module) main();

module.exports = { main };
