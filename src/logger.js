'use strict';

const { maskPhone } = require('./phone');

// Minimal structured logger for Railway logs.
// Privacy: never pass message bodies or full phone numbers. Fields named
// "phone"/"to"/"from" are masked automatically; "text"/"body" are dropped in production.
const SENSITIVE_PHONE_KEYS = new Set(['phone', 'to', 'from', 'wa_id', 'owner']);
const BODY_KEYS = new Set(['text', 'body', 'message', 'reply']);

function createLogger({ isProduction = process.env.NODE_ENV === 'production', silent = false } = {}) {
  function scrub(fields) {
    const out = {};
    for (const [k, v] of Object.entries(fields || {})) {
      if (SENSITIVE_PHONE_KEYS.has(k)) out[k] = maskPhone(v);
      else if (BODY_KEYS.has(k)) {
        if (!isProduction) out[k] = v;
        else out[k + 'Length'] = typeof v === 'string' ? v.length : undefined;
      } else out[k] = v;
    }
    return out;
  }

  function write(level, event, fields) {
    if (silent) return;
    const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...scrub(fields) });
    if (level === 'error' || level === 'warn') console.error(line);
    else console.log(line);
  }

  return {
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
  };
}

module.exports = { createLogger };
