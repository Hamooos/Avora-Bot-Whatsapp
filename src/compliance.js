'use strict';

// Automated enforcement of the brief's hard rules for every outgoing bot reply.
// The same rules are also written into the system prompt; this module is the
// safety net that runs on the model's actual output before anything is sent.

const HEB = '\\u05D0-\\u05EA';
const ALLOWED_PRICES = [189, 315, 439, 61, 157.5];

const LIMITS = {
  maxLines: 4,
  maxChars: 700,
  maxBulletLines: 2,
  minHebrewRatio: 0.5,
};

// Words that negate a banned term when they appear shortly before it in the same clause
// ("אבורה+ אינו טיפול בדום נשימה", "לא מחליף את ה-CPAP").
const NEGATIONS = new Set(['לא', 'אי', 'אינו', 'אינה', 'אינם', 'אינן', 'אין', 'אל', 'בלי', 'שום', 'ללא']);
const NEGATION_WINDOW_WORDS = 4;

function isNegated(text, index) {
  // Look back within the same clause only.
  const before = text.slice(0, index);
  const clauseStart = Math.max(
    before.lastIndexOf('.'), before.lastIndexOf('!'), before.lastIndexOf('?'),
    before.lastIndexOf('\n'), before.lastIndexOf(','), before.lastIndexOf(' - ')
  );
  const clause = before.slice(clauseStart + 1);
  const words = clause.split(/\s+/).filter(Boolean).slice(-NEGATION_WINDOW_WORDS);
  return words.some((w) => {
    const bare = w.replace(/[^א-ת]/g, '');
    return NEGATIONS.has(bare) || (/^[וש]/.test(bare) && NEGATIONS.has(bare.slice(1)));
  });
}

// Hebrew-aware "whole word" with optional one/two-letter prefixes (ו, ה, ש, ב, כ, ל, מ).
function hw(term, suffix = '') {
  return new RegExp(`(?<![${HEB}])(?:[והשבכלמ]{0,2})(?:${term})${suffix}(?![${HEB}])`, 'g');
}

const RULES = [
  // Punctuation
  { id: 'dash', re: /[‒–—―−־]/g, negatable: false,
    message: 'Use a regular dash "-" only (no em-dash, en-dash or maqaf).' },

  // Shipping
  { id: 'home_delivery', re: /עד\s+(?:ה)?בית/g, negatable: false,
    message: 'Never say "עד הבית" - shipping is free "לכל הארץ", not door delivery.' },
  { id: 'home_delivery', re: /(?:משלוח|שליח|מגיע|נשלח|מגיעה)[^.\n]{0,20}(?:הביתה|עד\s+הדלת|לדלת)/g, negatable: true,
    message: 'Shipping is not door delivery.' },

  // Medical wording
  { id: 'medical_claim', re: hw('מרפא|מרפאים|ריפוי|לרפא|ירפא|תרפא|מרפאה את'), negatable: true,
    message: 'Banned wording: מרפא / ריפוי.' },
  { id: 'medical_claim', re: /(?:מטפל|מטפלת|מטפלים|לטפל|טיפול)\s+ב/g, negatable: true,
    message: 'Banned wording: "מטפל ב-" / "טיפול ב-" (only allowed negated: "אינו טיפול ב...").' },
  { id: 'medical_claim', re: hw('תרופה'), negatable: true,
    message: 'Never call Avora+ a medicine ("תרופה").' },
  { id: 'medical_claim', re: /מכשיר\s+רפואי/g, negatable: true,
    message: 'Avora+ is not a medical device - only mention it negated.' },
  { id: 'medical_claim', re: /(?:מונע|מונעת|נוגד|נוגדת|אנטי)[\s-]?(?:ה)?(?:דלק|זיהומ)/g, negatable: false,
    message: 'Never claim anything about preventing inflammation or infection.' },
  { id: 'replaces_treatment',
    re: /(?:מחליף|מחליפה|מחליפים|להחליף|יחליף|תחליף)\s+(?:את\s+)?(?:ל)?(?:ה-?)?(?:תרופ|ספריי|CPAP|כדור|טיפול|מכשיר|סטרואיד|אוטריווין|מסכה)/g,
    negatable: true, message: 'Never say Avora+ replaces medication, spray, treatment or CPAP.' },
  { id: 'stop_medication',
    re: /(?:תפסיק|תפסיקי|תפסיקו|להפסיק|הפסיקו|הפסק|לוותר\s+על|תוותר\s+על|תוותרי\s+על|תורידו|להוריד)\s+(?:\S+\s+){0,2}?(?:את\s+)?(?:ה-?)?(?:תרופ|ספריי|CPAP|כדור|טיפול|סטרואיד|אוטריווין|מכשיר\s+ה)/g,
    negatable: true, message: 'Never tell anyone to stop or change medication / spray / CPAP.' },
  { id: 'diagnosis',
    re: /(?:נשמע|כנראה|בטח|ברור)\s+(?:ש)?(?:יש\s+לך|זה|מדובר\s+ב)\s*(?:סינוסיטיס|דלקת|אלרגיה|פוליפים|דום\s+נשימה|זיהום|סטייה)/g,
    negatable: false, message: 'Never diagnose.' },

  // Promises / hype
  { id: 'promise', re: hw('מובטח|מובטחת|מובטחים|מבטיח|מבטיחה|מבטיחים|להבטיח|נבטיח|בוודאות|בטוח יעבוד|בטוח יעזור|בטוח תרגיש'), negatable: true,
    message: 'Never promise results.' },
  { id: 'promise', re: /100\s*%/g, negatable: true, message: 'Never promise results ("100%").' },
  { id: 'hype', re: /הכי\s+טוב|מהפכני|משנה\s+(?:את\s+)?(?:ה)?משחק|פורץ\s+דרך/g, negatable: false,
    message: 'Banned hype words (הכי טוב / מהפכני / משנה משחק).' },
  { id: 'instant_results',
    re: /(?:מרגיש|מרגישה|מרגישים|תרגיש|תרגישי|תרגישו)\s+(?:את\s+ההבדל\s+)?מיד|מיידי(?:ת)?|(?:מ|ב)(?:הלילה|היום|לילה|יום)\s+(?:הראשון|אחד)|תוך\s+(?:דקה|דקות|שעה|שעות|יום|לילה)(?![א-ת])/g,
    negatable: true, message: 'Results are gradual - never "מיד" / "מהלילה הראשון".' },

  // Research
  { id: 'research_claim', re: /(?:מחקר|מחקרים|המחקרים|מדע)\s+(?:\S+\s+)?(?:הוכיח|הוכיחו|מוכיח|מוכיחים)|(?<![א-ת])(?:הוכח|מוכח|מוכחת|מוכחים)(?![א-ת])|(?:נבדק|נבדקה)\s+קלינית/g,
    negatable: true, message: 'Never say research proved Avora+ works.' },

  // Certifications (known unknown)
  { id: 'certification', re: hw('מאושר|מאושרת'), negatable: true, unlessReply: /אבדוק ואחזור/,
    message: 'Never claim approvals/certifications (unknown - hand off).' },
  { id: 'certification', re: /(?<![A-Za-z])(?:CE|FCC|FDA)(?![A-Za-z])|משרד\s+הבריאות|אמ"ר/g, negatable: true, unlessReply: /אבדוק ואחזור/,
    message: 'Certifications are a known unknown - say "אבדוק ואחזור אליך" and hand off.' },

  // Social proof
  { id: 'fake_social_proof',
    re: /לקוחות\s+מרוצים|(?:אלפי|מאות|עשרות)\s+(?:לקוחות|אנשים|משתמשים)|\d[\d,]*\s*\+?\s*(?:לקוחות|משתמשים|אנשים\s+כבר)|(?:ביקורות|המלצות)\s+(?:מעולות|מצוינות|חמות|מדהימות)|לקוח(?:ה)?\s+(?:שלנו\s+)?(?:סיפר|סיפרה|כתב|כתבה|אמר|אמרה)/g,
    negatable: true, message: 'No reviews, testimonials or customer counts.' },

  // Pricing / deals
  { id: 'discount', re: hw('הנחה|הנחות|קופון|קופונים|מבצע|מבצעים|חוסכים|חיסכון|לחסוך'), negatable: true,
    message: 'No discounts, coupons, deals, savings or "regular price" - quote the bundle prices only.' },
  { id: 'discount', re: /מחיר\s+(?:ה)?(?:רגיל|מקורי|מלא|קודם)|במקום\s+\d/g, negatable: false,
    message: 'Never mention a regular / original price.' },
];

function findRuleViolations(text) {
  const violations = [];
  for (const rule of RULES) {
    if (rule.unlessReply && rule.unlessReply.test(text)) continue;
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text)) !== null) {
      if (rule.negatable && isNegated(text, m.index)) continue;
      violations.push({ rule: rule.id, match: m[0], message: rule.message });
      break;
    }
  }
  return violations;
}

function priceViolations(text) {
  const violations = [];
  const amounts = [];
  const after = /(\d+(?:[.,]\d+)?)\s*(?:₪|ש"ח|ש״ח|שקלים|שקל|NIS|ILS)/g;
  const before = /(?:₪|NIS|ILS)\s*(\d+(?:[.,]\d+)?)/g;
  let m;
  while ((m = after.exec(text)) !== null) amounts.push(m[1]);
  while ((m = before.exec(text)) !== null) amounts.push(m[1]);
  for (const raw of amounts) {
    const n = Number(raw.replace(',', '.'));
    if (!ALLOWED_PRICES.includes(n)) {
      violations.push({ rule: 'price', match: raw, message: `Price ${raw} is not one of the official prices (189 / 315 / 439, third device 61).` });
    }
  }
  if (/\d+(?:\.\d+)?\s*%/.test(text) && !/מחקר|סקירה|פלצבו|דמה/.test(text)) {
    violations.push({ rule: 'discount', match: '%', message: 'No % figures outside the research facts (never a % discount).' });
  }
  if (/660/.test(text) && !/מחקר/.test(text)) {
    violations.push({ rule: 'wavelength', match: '660', message: 'Avora+ is 630-650nm. 660 only when describing the Israeli study.' });
  }
  if (/משלוח|שילוח/.test(text) && /חינם|חינמי/.test(text) && !/לכל\s+הארץ/.test(text)) {
    violations.push({ rule: 'shipping_wording', match: 'חינם', message: 'Free shipping must be phrased "חינם לכל הארץ".' });
  }
  return violations;
}

function formatViolations(text) {
  const violations = [];
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length > LIMITS.maxLines) {
    violations.push({ rule: 'too_long', match: `${lines.length} lines`, message: `Keep it to 1-${LIMITS.maxLines} short lines.` });
  }
  if (text.length > LIMITS.maxChars) {
    violations.push({ rule: 'too_long', match: `${text.length} chars`, message: `Keep it under ${LIMITS.maxChars} characters.` });
  }
  const bullets = lines.filter((l) => /^(?:[-•*▪]|\d+[.)])\s/.test(l)).length;
  if (bullets > LIMITS.maxBulletLines) {
    violations.push({ rule: 'bullets', match: `${bullets} bullets`, message: 'No bullet walls.' });
  }
  const noUrls = text.replace(/https?:\/\/\S+/g, '');
  const heb = (noUrls.match(/[א-ת]/g) || []).length;
  const lat = (noUrls.match(/[A-Za-z]/g) || []).length;
  const other = (noUrls.match(/[Ѐ-ӿ؀-ۿ]/g) || []).length; // Cyrillic / Arabic
  if (heb === 0 || heb / (heb + lat + other) < LIMITS.minHebrewRatio) {
    violations.push({ rule: 'not_hebrew', match: '', message: 'Reply must be in Hebrew.' });
  }
  return violations;
}

// Deterministic, meaning-preserving fixes applied before checking.
function sanitizeReply(text) {
  return String(text || '')
    .replace(/[‒–—―−]/g, '-')
    .replace(/־/g, '-')
    .replace(/\*\*(.+?)\*\*/g, '$1') // no markdown bold in WhatsApp
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Content rules only (no format rules) - useful for checking long source documents.
function checkContent(text) {
  return [...findRuleViolations(text), ...priceViolations(text)];
}

function checkReply(text) {
  const violations = [...checkContent(text), ...formatViolations(text)];
  return { ok: violations.length === 0, violations };
}

module.exports = { checkReply, checkContent, sanitizeReply, isNegated, ALLOWED_PRICES, LIMITS };
