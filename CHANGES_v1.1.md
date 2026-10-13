# v1.1 changes - owner decisions 2026-10-13 (read with CLAUDE.md; where they conflict, THIS file wins)

Implement on the existing v1 code (branch claude/tender-knuth-qf405w), keep all tests green, add tests for every change, update README, BUILD_NOTES and tests/conversations.

## 1. The live website is the source of truth
- Add a site-sync module. At startup and every 6 hours, fetch from https://avora-il.com:
  - /products/avora-plus.js (single-unit price; Shopify returns cents)
  - /products/avora-plus (product page: bundle prices from the quantity-break block - 2 devices and 3 devices - and the on-page FAQ)
  - /policies/refund-policy, /policies/shipping-policy, /policies/terms-of-service, /policies/privacy-policy, /policies/contact-information
- Extract plain text (policy body: the element with class shopify-policy__body; drop the site header/footer/newsletter popup). Keep the last good copy in memory (and on disk if available); if a fetch fails, keep using the last good copy and log a warning. If no copy was ever loaded, fall back to docs/ and hand off price/policy questions.
- Put the synced text into the system prompt in a clearly labeled "אתר - מידע עדכני" block, AFTER the rules and BEFORE docs/. Where the site and docs/ disagree, the site wins.
- Prices: the bot always quotes the CURRENT site prices from the sync (today: 1 = 189 ₪, 2 = 315 ₪, 3 = 439 ₪). The compliance checker must validate prices against the synced values, not a hard-coded list. If the synced prices differ from the last known values, alert the owner once ("המחירים באתר השתנו: ...").

## 2. Discounts - allowed, only as percentages
- The bot may mention the bundle discount, ONLY as a percentage, computed against buying the same number of single units at the current single price, rounded DOWN to a whole number. Today: 2 devices = 16% ("חיסכון של 16%"), 3 devices = 22%. Compute from the synced prices; never hard-code.
- Not allowed: shekel savings, "מחיר רגיל", "במקום X", crossed-out / compare-at prices, any other % (do NOT repeat the site-wide sale banner or compare-at prices), coupon codes, invented deals. Do not mention the newsletter coupon unless the owner enables it later (config flag, default off).
- Update src/compliance.js accordingly (allow "הנחה"/"חיסכון" only together with the computed bundle %).

## 3. Gift
- Buying 2 devices or more includes the free digital guide "מדריך לנשימה חופשית". The bot may say so.

## 4. Shipping time
- Default answer: "בדרך כלל לוקח שבוע עד שבועיים" (+ free shipping to the whole country, never "עד הבית").
- Only if the customer asks for a commitment or details: "אנחנו מתחייבים לאספקה עד חודש". If they ask further (processing time, express vs regular, tracking, pickup point, where it ships from), answer from the synced shipping policy text.

## 5. Returns, refunds, cancellation
- General questions ("יש החזרים?", "מה אם לא יעזור?"): "יש 30 ימי ניסיון, וההחזרים לפי התנאים במדיניות ההחזרים באתר". NO link - never send a link to the policy (owner 2026-10-13), just say it. Do NOT list the steps, and NEVER promise an unconditional "מחזירים את הכסף" - the site policy has conditions.
- Only when the customer says they WANT to return / get a refund / cancel: explain the relevant steps accurately from the synced refund policy (in short, numbered, max 4 lines, no link), and hand off to the owner. Never discourage, never hide the legal 14-day cancellation (it is in the policy).
- Update every reply, sample conversation and test that currently says or implies an unconditional refund ("לא הרגשתם הבדל, מקבלים את הכסף בחזרה" etc.) to the conditional wording above.

## 6. Hand-off: quiet, then a reassurance only after a long wait
- After a hand-off, the bot stops answering that customer on that matter and forwards the customer's new messages to the owner (as v1 does).
- If the customer writes again and the owner has NOT replied since the hand-off:
  - less than HANDOFF_QUIET_MINUTES (default 120) since the hand-off -> do not reply (forward only);
  - at or after HANDOFF_QUIET_MINUTES -> send ONE short reassurance that repeats what was handed off and that the team will reply soon (e.g. "קיבלנו, הפנייה שלך לגבי ההחזר אצל הצוות, ונחזור אליך בהקדם 🙏"), then restart the quiet timer. Max HANDOFF_MAX_REASSURANCES_PER_DAY (default 3).
  - The support hours on the site are Sunday-Thursday; outside them the reassurance may say the team will reply on the next working day. Don't invent hours that aren't on the site.
- Any owner reply (SEND) or RESUME clears the hand-off state. Add env vars to .env.example and README.

## 7. Known issues to report back (do not "fix" the site - list them in BUILD_NOTES for the owner)
- The bot must never give out a phone number or send links to policy pages.
