'use strict';

const { normalizePhone, samePhone } = require('./phone');
const fs = require('fs');
const path = require('path');

function loadIgnoreFile(file, log) {
  if (!file) return [];
  try {
    const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(arr) ? arr.map((n) => normalizePhone(String(n))).filter(Boolean) : [];
  } catch (err) {
    if (err.code !== 'ENOENT') log.warn('ignore_file_read_error', { error: err.message });
    return [];
  }
}
const { checkReply } = require('./compliance');
const { CATEGORY_LABELS } = require('./handoff');
const { decide, newHandoffState } = require('./handoffState');
const { emptySnapshot } = require('./siteSync');

const NON_TEXT_REPLY = 'תודה! כרגע אפשר לענות כאן רק על הודעות כתובות - אפשר לכתוב לנו במילים במה מדובר?';
const IGNORED_TYPES = new Set(['reaction', 'system', 'ephemeral', 'request_welcome']);
const PAUSE_MS = 12 * 60 * 60 * 1000;
const UNKNOWN_PHRASE = /אבדוק ואחזור/;

// Deterministic detectors. They don't write the reply - they make sure the owner is
// notified even if the model forgets, and they tell the model what was detected.
const NB = '(?<![\\u05D0-\\u05EA])';
const NA = '(?![\\u05D0-\\u05EA])';
const DETECTORS = [
  {
    category: 'medical',
    note: 'זוהה דגל אדום רפואי. ענו שקודם כדאי שרופא יבדוק את זה, בלי אבחנה ובלי עצה רפואית, ותגידו שהצוות יחזור אליהם. קראו ל-handoff_to_human.',
    patterns: [
      /(?:יש\s+לי|יש\s+לו|יש\s+לה|עם|קיבלתי|קיבל|קיבלה)\s+(?:גם\s+)?חום|חום\s+גבוה|קדחת/,
      /כאב(?:ים)?\s+(?:\S+\s+)?(?:חזק|חזקים|עז|עזים|נוראי|נוראיים)|כואב(?:ת)?\s+לי\s+(?:מאוד|נורא)/,
      /הפרש(?:ה|ות)\s+(?:\S+\s+)?(?:צבעונית|צבעוניות|ירוקה|ירוקות|צהובה|צהובות|דמית|עם\s+דם)|נזלת\s+(?:ירוקה|צהובה|עם\s+דם)/,
      /דימום|מדמם|מדממת|דם\s+(?:מה|ב)אף/,
      /הפסקות\s+נשימה|מפסיק(?:ה|ים)?\s+לנשום|עוצר(?:ת)?\s+(?:את\s+)?(?:ה)?נשימה/,
      /(?:צד|נחיר)\s+אחד\s+(?:בלבד\s+|רק\s+)?(?:סתום|נסתם|חסום)|סתום\s+(?:רק\s+)?(?:ב|מ)צד\s+אחד/,
      new RegExp(`${NB}(?:[לוהש]{0,2})(?:ילד|ילדה|ילדים|ילדות|תינוק|תינוקת|פעוט|פעוטה)${NA}|(?:הבן|הבת|לבן|לבת)\\s+שלי|${NB}(?:בן|בת)\\s+(?:[1-9]|1[0-7])(?!\\d)`),
      /הריון|היריון|בהריון|בהיריון|מניקה|הנקה|מיניקה/,
    ],
  },
  {
    category: 'human_request',
    note: 'הלקוח ביקש לדבר עם אדם. תגידו שהצוות יחזור אליו בהקדם, וקראו ל-handoff_to_human.',
    patterns: [/נציג|נציגה|בן\s+אדם|בנאדם|אדם\s+אמיתי|מישהו\s+אמיתי|לדבר\s+עם\s+מישהו|מנהל|תתקשרו|שיחזרו\s+אלי|לדבר\s+בטלפון|שיחה\s+טלפונית/],
  },
  {
    category: 'cancel_refund',
    note: 'הלקוח רוצה לבטל / להחזיר / לקבל החזר. ענו בכנות ובלי לנסות לשכנע אותו לוותר: הסבירו בקצרה את השלבים הרלוונטיים לפי מדיניות ההחזרים שבבלוק האתר (ממוספר, עד 4 שלבים, בלי קישור, בלי להבטיח החזר ללא תנאים, בלי להסתיר את זכות הביטול של 14 יום), ותגידו שהצוות יחזור אליו. אם המדיניות לא בבלוק האתר - אל תפרטו שלבים. קראו ל-handoff_to_human.',
    // Only a stated wish to return / cancel. General questions ("יש החזרים?", "מה אם לא יעזור?")
    // get the general answer and must NOT silence the bot with a hand-off (CHANGES_v1.1 §5-6).
    patterns: [
      /(?:רוצה|רוצים|ברצוני|מבקש|מבקשת|מבקשים|אני|נא|הייתי\s+רוצה|החלטתי)\s+(?:\S+\s+)?(?:לבטל|להחזיר|ביטול|החזר|החזרה|זיכוי)/,
      /לבטל\s+את\s+(?:ה)?הזמנה|ביטול\s+(?:ה)?הזמנה|להחזיר\s+את\s+(?:ה)?מכשיר|מחזיר(?:ה|ים)?\s+את\s+(?:ה)?מכשיר|תבטלו/,
    ],
  },
  {
    category: 'complaint',
    note: 'זוהתה תלונה / תקלה / לקוח כועס. הביעו הבנה בקצרה, בלי להתווכח, ותגידו שהצוות יחזור אליו. קראו ל-handoff_to_human.',
    patterns: [
      /תלונה|להתלונן|נוכלים|רמאים|גנבים|עוקץ|הונאה|בושה|זבל|חרא|מזעזע|שערורי|עורך\s+דין|עו"ד|תביעה|לתבוע|משטרה|הגנת\s+הצרכן/,
      /(?:המכשיר|הוא|זה)\s+(?:\S+\s+)?(?:לא\s+נדלק|לא\s+נטען|לא\s+עובד|התקלקל|נשבר|שבור|מקולקל)|הגיע\s+(?:שבור|פגום)|פגום/,
    ],
  },
];

// Questions that need site data which was never loaded (CHANGES_v1.1 §1): hand off.
const SITE_GAPS = [
  { part: 'prices', pattern: /כמה\s+(?:זה\s+|הוא\s+)?עולה|מחיר|₪|שקל|ש"ח|הנחה|חיסכון|מבצע|זוג|שני\s+מכשירים|שלושה\s+מכשירים|כמה\s+מכשירים/ },
  { part: 'shipping', pattern: /נקודת\s+איסוף|איסוף|אקספרס|משלוח\s+מהיר|שליח|מאיפה\s+(?:זה\s+)?(?:נשלח|מגיע|יוצא)|זמן\s+(?:טיפול|הכנה)|דואר/ },
  { part: 'terms', pattern: /תנאי\s+(?:ה)?שימוש|תקנון/ },
  { part: 'privacy', pattern: /פרטיות|המידע\s+שלי|מוחקים\s+את/ },
];
const SITE_GAP_NOTE = 'המידע הזה לא נטען מהאתר כרגע. ענו רק מה שמופיע במסמכים (אם בכלל), תגידו "אבדוק ואחזור אליך", וקראו ל-handoff_to_human.';

function detect(text, site) {
  const t = String(text || '');
  const found = DETECTORS.filter((d) => d.patterns.some((p) => p.test(t))).map((d) => ({ category: d.category, note: d.note }));
  if (site && SITE_GAPS.some((g) => !site.loaded[g.part] && g.pattern.test(t))) {
    found.push({ category: 'unknown_info', note: SITE_GAP_NOTE });
  }
  return found;
}

function createRateLimiter({ limit, windowMs, now = () => Date.now() }) {
  const hits = new Map();
  return function allow(key) {
    const t = now();
    const list = (hits.get(key) || []).filter((x) => t - x < windowMs);
    if (list.length >= limit) { hits.set(key, list); return false; }
    list.push(t);
    hits.set(key, list);
    return true;
  };
}

const OWNER_HELP = [
  'פקודות מנהל:',
  'SEND 0501234567 טקסט - לשלוח ללקוח (סוגר את ההעברה לנציג; הבוט מושתק ללקוח הזה ל-12 שעות)',
  'PAUSE 0501234567 / RESUME 0501234567 - להשתיק / להחזיר את הבוט ללקוח (RESUME גם סוגר העברה לנציג)',
  'BLOCK 0501234567 / UNBLOCK 0501234567 - לחסום / לבטל חסימה',
  'IGNORE 0501234567 / UNIGNORE 0501234567 - להוסיף / להוריד מרשימת "לא לענות" הקבועה (ההודעות שלהם רק מועברות אליך)',
  'IGNORED - להציג את הרשימה',
].join('\n');

/**
 * @param {object} deps
 * @param {Function} [deps.getSite]                 () => site-sync snapshot
 * @param {number} [deps.handoffQuietMinutes]       default 120
 * @param {number} [deps.maxReassurancesPerDay]     default 3
 * @param {boolean} [deps.couponEnabled]
 */
function createMessageHandler({ agent, whatsapp, handoff, store, ownerNumber, logger, now = () => Date.now(), rateLimit,
  getSite = emptySnapshot, handoffQuietMinutes = 120, maxReassurancesPerDay = 3, couponEnabled = false, ignoreNumbers = [],
  ignoreFile = '' }) {
  const log = logger || { info() {}, warn() {}, error() {} };
  const quietOpts = { quietMs: handoffQuietMinutes * 60 * 1000, maxPerDay: maxReassurancesPerDay };
  const seen = new Map(); // message id -> ts (Meta can deliver the same webhook more than once)
  const blocked = new Set();
  // Permanent "don't answer" list = BOT_IGNORE_NUMBERS (env, fixed) + numbers added with IGNORE (saved to ignoreFile).
  const envIgnored = new Set((ignoreNumbers || []).map((n) => normalizePhone(n)).filter(Boolean));
  const savedIgnored = new Set(loadIgnoreFile(ignoreFile, log));
  const isIgnored = (phone) => envIgnored.has(phone) || savedIgnored.has(phone);
  function saveIgnored() {
    if (!ignoreFile) return false;
    try {
      fs.mkdirSync(path.dirname(ignoreFile), { recursive: true });
      fs.writeFileSync(ignoreFile, JSON.stringify([...savedIgnored], null, 1));
      return true;
    } catch (err) {
      log.error('ignore_file_write_error', { error: err?.message });
      return false;
    }
  }
  const queues = new Map(); // phone -> promise chain (one message at a time per customer)
  const allow = rateLimit || createRateLimiter({ limit: 15, windowMs: 10 * 60 * 1000, now });

  function isDuplicate(id) {
    if (!id) return false;
    const t = now();
    for (const [k, ts] of seen) if (t - ts > 24 * 60 * 60 * 1000) seen.delete(k);
    if (seen.has(id)) return true;
    seen.set(id, t);
    return false;
  }

  async function send(to, text) {
    return whatsapp.sendText(to, text);
  }

  async function handleOwnerCommand(msg) {
    const m = /^\s*(BLOCK|UNBLOCK|PAUSE|RESUME|SEND|HELP|IGNORED|IGNORE|UNIGNORE)\b\s*(\+?\d[\d-]{6,18}\d)?\s*([\s\S]*)$/i.exec(msg.text || '');
    if (m && m[1].toUpperCase() === 'IGNORED') {
      const list = [...new Set([...envIgnored, ...savedIgnored])];
      await send(msg.from, list.length ? `רשימת "לא לענות" (${list.length}):\n${list.map((n) => `+${n}`).join('\n')}` : 'רשימת "לא לענות" ריקה.');
      return { action: 'owner_ignored_list' };
    }
    if (!m || m[1].toUpperCase() === 'HELP') {
      await send(msg.from, OWNER_HELP);
      return { action: 'owner_help' };
    }
    const cmd = m[1].toUpperCase();
    const target = normalizePhone(m[2] || '');
    if (!target) {
      await send(msg.from, OWNER_HELP);
      return { action: 'owner_help' };
    }
    switch (cmd) {
      case 'BLOCK': blocked.add(target); break;
      case 'UNBLOCK': blocked.delete(target); break;
      case 'IGNORE': {
        savedIgnored.add(target);
        if (!saveIgnored()) await send(msg.from, 'שימו לב: לא הצלחתי לשמור לקובץ, אז המספר יישאר ברשימה רק עד ההפעלה הבאה של הבוט.');
        break;
      }
      case 'UNIGNORE': {
        savedIgnored.delete(target);
        saveIgnored();
        if (envIgnored.has(target)) await send(msg.from, 'המספר הזה מופיע גם במשתנה BOT_IGNORE_NUMBERS בריילווי - כדי להוריד אותו לגמרי צריך למחוק אותו גם משם.');
        break;
      }
      case 'PAUSE': await store.setMeta(target, { pausedUntil: now() + PAUSE_MS }); break;
      case 'RESUME': await store.setMeta(target, { pausedUntil: 0, handoff: null }); break;
      case 'SEND': {
        const body = (m[3] || '').trim();
        if (!body) { await send(msg.from, OWNER_HELP); return { action: 'owner_help' }; }
        const res = await send(target, body);
        await store.append(target, [{ role: 'user', content: '[הודעה מהצוות נשלחה ללקוח]' }, { role: 'assistant', content: body }]);
        // The owner replied: the hand-off is closed (CHANGES_v1.1 §6).
        await store.setMeta(target, { pausedUntil: now() + PAUSE_MS, handoff: null });
        if (!res.ok) await send(msg.from, 'השליחה נכשלה (ייתכן שעברו 24 שעות מההודעה האחרונה של הלקוח).');
        break;
      }
      default: break;
    }
    log.info('owner_command', { command: cmd, phone: target });
    await send(msg.from, `בוצע: ${cmd} ${target}`);
    return { action: `owner_${cmd.toLowerCase()}`, target };
  }

  async function processCustomerMessage(msg) {
    const phone = msg.from;
    const meta = await store.getMeta(phone);

    const forward = async () => {
      if (ownerNumber) await send(ownerNumber, `💬 +${phone}: ${msg.text || `(הודעה מסוג ${msg.type})`}`);
    };

    if (meta.pausedUntil && meta.pausedUntil > now()) {
      // A human is handling this conversation - forward to the owner, don't answer.
      await forward();
      return { action: 'forwarded_to_owner' };
    }

    if (meta.handoff) {
      // Open hand-off and the owner hasn't replied yet: forward, and reassure only after a long quiet.
      await forward();
      const d = decide(meta.handoff, now(), quietOpts);
      await store.setMeta(phone, { handoff: d.state });
      if (d.action === 'reassure') {
        await send(phone, d.text);
        log.info('handoff_reassurance', { phone, category: meta.handoff.category });
        return { action: 'reassured', reply: d.text };
      }
      return { action: 'forwarded_to_owner' };
    }

    if (!msg.text) {
      await send(phone, NON_TEXT_REPLY);
      return { action: 'non_text_reply', reply: NON_TEXT_REPLY };
    }

    const site = getSite();
    const detected = detect(msg.text, site);
    const result = await agent.respond({ phone, text: msg.text, notes: detected.map((d) => d.note) });

    // Collect hand-offs: from the model, from the router, and from "אבדוק ואחזור" replies.
    const handoffs = [...result.handoffs];
    for (const d of detected) {
      if (!handoffs.some((h) => h.category === d.category)) {
        handoffs.push({ category: d.category, summary: `זוהה אוטומטית: ${CATEGORY_LABELS[d.category]}` });
      }
    }
    if (!handoffs.length && UNKNOWN_PHRASE.test(result.reply)) {
      handoffs.push({ category: 'unknown_info', summary: 'הבוט ענה "אבדוק ואחזור" - נדרשת תשובה מהצוות' });
    }

    // Last line of defense - agent output is already checked, but never send a non-compliant reply.
    let reply = result.reply;
    if (!checkReply(reply, { pricing: site.pricing, couponEnabled }).ok) {
      log.error('reply_blocked_by_compliance', { phone });
      reply = 'תודה על ההודעה 🙏 אבדוק ואחזור אליך בהקדם.';
      if (!handoffs.length) handoffs.push({ category: 'other', summary: 'תשובת הבוט נחסמה בבדיקת תאימות' });
    }

    await send(phone, reply);
    if (handoffs.length) {
      // One alert per customer message: the most specific category, all the reasons, and the
      // customer's last message so the owner has context.
      const main = handoffs.find((h) => h.category !== 'other') || handoffs[0];
      const summary = [...new Set(handoffs.map((h) => h.summary).filter(Boolean)), `ההודעה האחרונה: "${msg.text.slice(0, 300)}"`].join('\n');
      await store.setMeta(phone, { handoff: newHandoffState(main, now()) });
      await handoff.notify({ phone, category: main.category, summary, customerName: msg.name });
    }
    log.info('message_handled', { phone, handoffs: handoffs.map((h) => h.category).join(',') || 'none', fallback: result.fallback });
    return { action: 'replied', reply, handoffs, detected: detected.map((d) => d.category) };
  }

  async function handle(msg) {
    if (!msg || !msg.from) return { action: 'ignored' };
    if (isDuplicate(msg.id)) return { action: 'duplicate' };
    if (IGNORED_TYPES.has(msg.type)) return { action: 'ignored' };
    log.info('message_received', { phone: msg.from, type: msg.type, text: msg.text });

    if (ownerNumber && samePhone(msg.from, ownerNumber)) return handleOwnerCommand(msg);
    if (blocked.has(normalizePhone(msg.from))) return { action: 'blocked' };
    if (isIgnored(normalizePhone(msg.from))) {
      // Permanent "don't auto-answer" list (BOT_IGNORE_NUMBERS): never reply, only forward to the owner.
      if (ownerNumber) await send(ownerNumber, `💬 +${normalizePhone(msg.from)}: ${msg.text || `(הודעה מסוג ${msg.type})`}`);
      return { action: 'ignored_number' };
    }
    if (!allow(msg.from)) {
      log.warn('rate_limited', { phone: msg.from });
      return { action: 'rate_limited' };
    }
    if (msg.id && whatsapp.markRead) whatsapp.markRead(msg.id).catch(() => {});

    // Serialize per customer so history stays consistent when messages arrive in bursts.
    const prev = queues.get(msg.from) || Promise.resolve();
    const run = prev.then(() => processCustomerMessage(msg)).catch((err) => {
      log.error('handle_error', { phone: msg.from, error: err?.message });
      return { action: 'error' };
    });
    queues.set(msg.from, run);
    run.finally(() => { if (queues.get(msg.from) === run) queues.delete(msg.from); });
    return run;
  }

  return { handle, blocked };
}

module.exports = { createMessageHandler, createRateLimiter, detect, NON_TEXT_REPLY, OWNER_HELP };
