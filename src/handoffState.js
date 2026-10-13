'use strict';

// After a hand-off the bot goes quiet for that customer (CHANGES_v1.1 §6):
//  - the customer's new messages are forwarded to the owner;
//  - while the owner hasn't replied, the customer gets ONE short reassurance only after
//    HANDOFF_QUIET_MINUTES of quiet, then the timer restarts;
//  - at most HANDOFF_MAX_REASSURANCES_PER_DAY reassurances per Israeli calendar day;
//  - an owner SEND or RESUME clears the state.

const TZ = 'Asia/Jerusalem';
// Support days published on the site: Sunday-Thursday. No hours are published, so none are used.
const SUPPORT_WEEKDAYS = new Set(['Sun', 'Mon', 'Tue', 'Wed', 'Thu']);

// What the reassurance says was handed off, per hand-off category.
const TOPICS = {
  cancel_refund: 'הפנייה שלך לגבי ההחזר או הביטול',
  order_issue: 'הפנייה שלך לגבי ההזמנה',
  human_request: 'הבקשה שלך לדבר עם נציג',
  complaint: 'הפנייה שלך',
  medical: 'השאלה שלך',
  unknown_info: 'השאלה שלך',
  other: 'הפנייה שלך',
};

function israelParts(t) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(t));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return { weekday: get('weekday'), dayKey: `${get('year')}-${get('month')}-${get('day')}` };
}

function isSupportDay(t) {
  return SUPPORT_WEEKDAYS.has(israelParts(t).weekday);
}

function reassuranceText(category, t) {
  const topic = TOPICS[category] || TOPICS.other;
  if (isSupportDay(t)) return `קיבלנו, ${topic} אצל הצוות, ונחזור אליך בהקדם 🙏`;
  return `קיבלנו, ${topic} אצל הצוות. הצוות זמין בימים א'-ה', ונחזור אליך ביום העבודה הבא 🙏`;
}

function newHandoffState({ category, summary }, t) {
  return { category, summary, at: t, quietSince: t, reassurances: [] };
}

/**
 * Decide what to do with a customer message while a hand-off is open.
 * @returns {{action: 'silent'|'reassure', state: object, text?: string}}
 */
function decide(state, t, { quietMs, maxPerDay }) {
  if (t - state.quietSince < quietMs) return { action: 'silent', state };
  const today = israelParts(t).dayKey;
  const todays = (state.reassurances || []).filter((r) => israelParts(r).dayKey === today);
  if (todays.length >= maxPerDay) return { action: 'silent', state };
  return {
    action: 'reassure',
    text: reassuranceText(state.category, t),
    state: { ...state, quietSince: t, reassurances: [...todays, t] },
  };
}

module.exports = { decide, newHandoffState, reassuranceText, isSupportDay, TOPICS };
