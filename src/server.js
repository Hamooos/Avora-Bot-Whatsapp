'use strict';

const express = require('express');
const { verifySignature, extractMessages } = require('./whatsapp');

/**
 * Express app: GET /health, GET /webhook (Meta verification), POST /webhook (messages).
 * @param {object} deps
 * @param {string} deps.verifyToken
 * @param {string} deps.appSecret
 * @param {{handle: Function}} deps.handler
 */
function createApp({ verifyToken, appSecret, handler, logger }) {
  const log = logger || { info() {}, warn() {}, error() {} };
  const app = express();
  app.disable('x-powered-by');

  // Keep the raw body - the signature is computed over the exact bytes Meta sent.
  app.use(express.json({
    limit: '1mb',
    verify: (req, _res, buf) => { req.rawBody = buf; },
  }));

  app.get('/health', (_req, res) => res.json({ status: 'ok', version: (process.env.RAILWAY_GIT_COMMIT_SHA || 'local').slice(0, 7) }));

  app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (verifyToken && mode === 'subscribe' && token === verifyToken && typeof challenge === 'string') {
      log.info('webhook_verified', {});
      return res.status(200).type('text/plain').send(challenge);
    }
    log.warn('webhook_verify_failed', {});
    return res.sendStatus(403);
  });

  app.post('/webhook', (req, res) => {
    if (!verifySignature(req.rawBody, req.get('x-hub-signature-256'), appSecret)) {
      log.warn('webhook_bad_signature', {});
      return res.sendStatus(401);
    }
    // Answer Meta immediately; process in the background.
    res.sendStatus(200);
    const messages = extractMessages(req.body);
    for (const msg of messages) {
      Promise.resolve(handler.handle(msg)).catch((err) => log.error('handler_error', { error: err?.message }));
    }
  });

  // Malformed JSON and other errors: don't leak details.
  app.use((err, _req, res, _next) => {
    log.warn('http_error', { error: err?.type || err?.message });
    res.sendStatus(err?.status && err.status < 500 ? err.status : 500);
  });

  return app;
}

module.exports = { createApp };
