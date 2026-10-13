'use strict';

// Phone helpers. WhatsApp gives numbers as international digits, e.g. "972501234567".

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

// Normalizes an Israeli or international number to international digits (no "+").
// "050-123-4567" -> "972501234567", "+972 50 123 4567" -> "972501234567".
function normalizePhone(value) {
  let d = digitsOnly(value);
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0') && d.length === 10) d = '972' + d.slice(1);
  if (d.startsWith('9720')) d = '972' + d.slice(4);
  return d;
}

// Two numbers are the same person if their last 9 digits match
// (Israeli mobile numbers have 9 significant digits after the 0 / 972 prefix).
function samePhone(a, b) {
  const x = normalizePhone(a);
  const y = normalizePhone(b);
  if (x.length < 9 || y.length < 9) return false;
  return x.slice(-9) === y.slice(-9);
}

// For logs: keep country code and last 3 digits only. "972501234567" -> "9725*****567".
function maskPhone(value) {
  const d = digitsOnly(value);
  if (!d) return '';
  if (d.length <= 6) return '*'.repeat(d.length);
  return d.slice(0, 4) + '*'.repeat(d.length - 7) + d.slice(-3);
}

module.exports = { digitsOnly, normalizePhone, samePhone, maskPhone };
