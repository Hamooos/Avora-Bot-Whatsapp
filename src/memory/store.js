'use strict';

/**
 * Conversation memory. v1 keeps everything in process memory.
 *
 * Interface (implement the same async methods to swap in Redis / Postgres):
 *   getHistory(phone)        -> Promise<Array<{role: 'user'|'assistant', content: string}>>
 *   append(phone, messages)  -> Promise<void>
 *   clear(phone)             -> Promise<void>
 *   getMeta(phone)           -> Promise<object>   (small per-conversation flags)
 *   setMeta(phone, patch)    -> Promise<object>
 *
 * Privacy / retention: only the phone number, the text of the last messages and small
 * flags are kept. A conversation is deleted after `ttlMs` without activity (default 24h,
 * the length of WhatsApp's customer-service window) and everything is lost on restart.
 */
class InMemoryConversationStore {
  constructor({ maxMessages = 20, ttlMs = 24 * 60 * 60 * 1000, now = () => Date.now() } = {}) {
    this.maxMessages = maxMessages;
    this.ttlMs = ttlMs;
    this.now = now;
    this.data = new Map(); // phone -> { messages, meta, updatedAt }
  }

  entry(phone) {
    this.purgeExpired();
    let e = this.data.get(phone);
    if (!e) {
      e = { messages: [], meta: {}, updatedAt: this.now() };
      this.data.set(phone, e);
    }
    return e;
  }

  async getHistory(phone) {
    const e = this.data.get(phone);
    if (!e || this.now() - e.updatedAt > this.ttlMs) return [];
    return e.messages.map((m) => ({ ...m }));
  }

  async append(phone, messages) {
    const e = this.entry(phone);
    e.messages.push(...messages.map((m) => ({ role: m.role, content: String(m.content) })));
    // Keep the history starting with a user turn.
    while (e.messages.length > this.maxMessages || (e.messages.length && e.messages[0].role !== 'user')) {
      e.messages.shift();
    }
    e.updatedAt = this.now();
  }

  async clear(phone) {
    this.data.delete(phone);
  }

  async getMeta(phone) {
    const e = this.data.get(phone);
    return e ? { ...e.meta } : {};
  }

  async setMeta(phone, patch) {
    const e = this.entry(phone);
    Object.assign(e.meta, patch);
    e.updatedAt = this.now();
    return { ...e.meta };
  }

  purgeExpired() {
    const t = this.now();
    for (const [phone, e] of this.data) {
      if (t - e.updatedAt > this.ttlMs) this.data.delete(phone);
    }
  }
}

module.exports = { InMemoryConversationStore };
