'use strict';

const { buildSystemPrompt } = require('./systemPrompt');
const { TOOL_DEFINITIONS, HANDOFF_CATEGORIES } = require('./tools');
const { checkReply, sanitizeReply } = require('../compliance');
const { emptySnapshot } = require('../siteSync');

// Sent when the model fails, refuses, or can't produce a compliant reply.
const FALLBACK_REPLY = 'תודה על ההודעה 🙏 אבדוק ואחזור אליך בהקדם.';
const SYSTEM_NOTE_PREFIX = '[הערת מערכת]';

class AvoraAgent {
  /**
   * @param {object} opts
   * @param {object} opts.client       Anthropic SDK client (or a mock with messages.create)
   * @param {string} opts.model
   * @param {string} [opts.effort]     output_config.effort; 'none' to omit
   * @param {number} [opts.maxTokens]
   * @param {object} opts.store        ConversationStore
   * @param {Function} [opts.orderLookup] async (orderNumber, phone) => result
   * @param {object} [opts.logger]
   * @param {Function} [opts.getSite]  () => site-sync snapshot (live prices, FAQ, policies)
   * @param {boolean} [opts.couponEnabled]
   */
  constructor({ client, model, effort = 'low', maxTokens = 2000, store, orderLookup, logger, maxToolRounds = 4, maxRewrites = 1, getSite = emptySnapshot, couponEnabled = false }) {
    this.client = client;
    this.model = model;
    this.effort = effort;
    this.maxTokens = maxTokens;
    this.store = store;
    this.orderLookup = orderLookup;
    this.logger = logger || { info() {}, warn() {}, error() {} };
    this.maxToolRounds = maxToolRounds;
    this.maxRewrites = maxRewrites;
    this.getSite = getSite;
    this.couponEnabled = couponEnabled;
  }

  /**
   * Generates the reply to one customer message.
   * @returns {Promise<{reply: string, handoffs: Array<{category: string, summary: string}>, fallback: boolean, violations: Array}>}
   */
  async respond({ phone, text, notes = [] }) {
    const history = await this.store.getHistory(phone);
    const userContent = [text, ...notes.map((n) => `${SYSTEM_NOTE_PREFIX} ${n}`)].join('\n\n');
    const messages = [...history, { role: 'user', content: userContent }];
    const handoffs = [];
    // One site snapshot per customer message: the prompt and the compliance check use the same prices.
    const site = this.getSite();
    const system = buildSystemPrompt({ site, couponEnabled: this.couponEnabled });
    const checkOpts = { pricing: site.pricing, couponEnabled: this.couponEnabled };
    let lastViolations = [];
    let rewrites = 0;
    let toolRounds = 0;

    try {
      for (;;) {
        const response = await this.client.messages.create(this.buildRequest(messages, system));
        this.logUsage(phone, response);

        if (response.stop_reason === 'refusal') {
          this.logger.warn('agent_refusal', { phone, category: response.stop_details?.category });
          return this.fallback(phone, text, handoffs, 'המודל סירב לענות');
        }

        messages.push({ role: 'assistant', content: response.content });

        if (response.stop_reason === 'tool_use') {
          if (++toolRounds > this.maxToolRounds) return this.fallback(phone, text, handoffs, 'יותר מדי קריאות לכלים');
          const results = await this.runTools(response.content, phone, handoffs);
          messages.push({ role: 'user', content: results });
          continue;
        }

        const draft = sanitizeReply(
          response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
        );
        const check = checkReply(draft, checkOpts);
        if (draft && check.ok) {
          await this.store.append(phone, [
            { role: 'user', content: text },
            { role: 'assistant', content: draft },
          ]);
          return { reply: draft, handoffs, fallback: false, violations: [] };
        }

        lastViolations = check.violations;
        this.logger.warn('agent_compliance_violation', {
          phone,
          rules: check.violations.map((v) => v.rule).join(','),
          attempt: rewrites + 1,
        });
        if (rewrites >= this.maxRewrites) break;
        rewrites++;
        const reasons = check.violations.map((v) => `- ${v.message}${v.match ? ` (נמצא: "${v.match}")` : ''}`).join('\n');
        messages.push({
          role: 'user',
          content: `${SYSTEM_NOTE_PREFIX} התשובה הקודמת לא נשלחה ללקוח כי היא מפרה את הכללים:\n${reasons || '- תשובה ריקה'}\nכתבו תשובה חדשה ללקוח שעומדת בכל הכללים. רק את נוסח התשובה, בלי הסברים.`,
        });
      }
    } catch (err) {
      this.logger.error('agent_error', { phone, error: err?.message, status: err?.status });
      return this.fallback(phone, text, handoffs, 'תקלה טכנית בבוט - לא הצלחנו לענות');
    }

    return { ...(await this.fallback(phone, text, handoffs, 'הבוט לא הצליח לנסח תשובה תקינה')), violations: lastViolations };
  }

  buildRequest(messages, system) {
    const req = {
      model: this.model,
      max_tokens: this.maxTokens,
      system,
      tools: TOOL_DEFINITIONS,
      messages,
    };
    if (this.effort && this.effort !== 'none') req.output_config = { effort: this.effort };
    return req;
  }

  async runTools(content, phone, handoffs) {
    const calls = content.filter((b) => b.type === 'tool_use');
    return Promise.all(calls.map(async (call) => {
      try {
        const output = await this.runTool(call, phone, handoffs);
        return { type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(output) };
      } catch (err) {
        this.logger.error('tool_error', { tool: call.name, error: err?.message });
        return { type: 'tool_result', tool_use_id: call.id, is_error: true, content: 'Tool failed. Tell the customer you will check and get back to them, and hand off.' };
      }
    }));
  }

  async runTool(call, phone, handoffs) {
    const input = call.input || {};
    const name = String(call.name || '').toLowerCase();
    if (name === 'handoff_to_human') {
      const category = HANDOFF_CATEGORIES.includes(input.category) ? input.category : 'other';
      handoffs.push({ category, summary: String(input.summary || '').slice(0, 500) });
      return { ok: true, note: 'The team was notified. Tell the customer the team will get back to them.' };
    }
    if (name === 'lookup_order') {
      if (!this.orderLookup) return { found: false, error: 'order lookup is not configured' };
      return this.orderLookup(String(input.order_number || ''), input.phone || phone);
    }
    throw new Error(`unknown tool ${call.name}`);
  }

  async fallback(phone, text, handoffs, reason) {
    const all = handoffs.length ? handoffs : [{ category: 'other', summary: reason }];
    await this.store.append(phone, [
      { role: 'user', content: text },
      { role: 'assistant', content: FALLBACK_REPLY },
    ]);
    return { reply: FALLBACK_REPLY, handoffs: all, fallback: true, violations: [] };
  }

  logUsage(phone, response) {
    const u = response.usage || {};
    this.logger.info('agent_usage', {
      phone,
      stop: response.stop_reason,
      in: u.input_tokens,
      out: u.output_tokens,
      cacheRead: u.cache_read_input_tokens,
      cacheWrite: u.cache_creation_input_tokens,
    });
  }
}

module.exports = { AvoraAgent, FALLBACK_REPLY, SYSTEM_NOTE_PREFIX };
