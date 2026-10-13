# BUILD_NOTES

Avora+ WhatsApp bot. v1 follows `CLAUDE.md` (brief) and `docs/08_WHATSAPP_BOT_GUIDE.md`; v1.1 follows `CHANGES_v1.1.md` (owner decisions, 2026-10-13), which wins where it conflicts with the brief. Date: 2026-10-13.

## Status
- v1.1 is implemented on `claude/tender-knuth-qf405w`. `npm test`: **146 tests pass** (webhook + signature, routing, hand-off quiet mode, compliance, system-prompt rules, site sync with fixtures, agent with a mocked model, Shopify with a mocked API, and 30 sample conversations replayed through the full pipeline).
- Local smoke test of the real `src/index.js` (dry-run sending): the server starts even though the site can't be reached. It logs `site_sync_part_failed` for every page, falls back to the docs/ prices, and hands off a price question with a single owner alert.
- Not done, as the brief asks: no real WhatsApp messages sent, nothing deployed, no accounts created.
- **The live site was not reachable from the build environment** (the network policy blocks `avora-il.com`). The site-sync parser is built for standard Shopify page structure and tested only on **synthetic fixtures** (`tests/fixtures/site/`, labelled as made up). Before going live, run the bot once with network access and check the `site_sync_done` / `site_sync_part_failed` log lines (see "Not verified").

## v1.1 changes (CHANGES_v1.1.md)
1. **Live site is the source of truth** - `src/siteSync.js`.
   - **Schedule:** at startup and every `SITE_SYNC_HOURS` (6) it fetches `/products/avora-plus.js`, `/products/avora-plus` and the five `/policies/*` pages.
   - **Prices:** the single price comes from the product JSON (cents ÷ 100). The 2- and 3-device prices come from the quantity-break block: the first price after a "2 מכשירים" / "3 מכשירים" label that is above the single price and below that many singles. This skips crossed-out (compare-at) and per-unit prices. A page that fails the check is "could not parse", never a guess.
   - **Text:** the FAQ comes from FAQ / accordion blocks, or else the text after "שאלות נפוצות". Each policy comes from `.shopify-policy__body`. Removed before use: header, footer, newsletter popup, announcement / sale banners, `<s>`/`<del>`/compare-at elements, links, phone numbers and emails.
   - **Last good copy:** each part keeps its last good copy in memory and in `SITE_CACHE_FILE` (`data/site-cache.json`). A failed fetch keeps that copy and logs a warning.
   - **Prompt:** the synced text goes into the system prompt as "# אתר - מידע עדכני", after the rules and before docs/, and the prompt says the site wins. There are two prompt-cache breakpoints, after the rules and at the end, so a site change only re-caches the site + docs part.
   - **Never loaded:** the bot uses the docs/ prices (marked as possibly out of date), and price, shipping-detail, terms and privacy questions are handed off. A router detector does this even if the model doesn't.
   - **Price change:** the owner gets one WhatsApp alert, "המחירים באתר השתנו: מכשיר אחד: 189 ₪ -> 199 ₪, ...", per new set of prices. It compares against the last known prices: the disk cache, or the docs/ prices on the very first run.
   - **Price checking:** the compliance checker now checks prices against the synced values (`src/pricing.js`). The hard-coded list is gone.
2. **Discounts only as %** - `bundleDiscountPercent` = floor((1 - bundle / (qty × single)) × 100), computed from the current prices (today 16% / 22%).
   - The checker allows "הנחה" / "חיסכון" / "חוסכים" only together with one of those percentages, and allows no other % except in a research context (72% / 24% ...).
   - Still blocked: shekel amounts other than the 3 prices, "מחיר רגיל" / "במקום X" / "מחיר מחוק", "מבצע", and "קופון" / "קוד הנחה".
   - Coupons are behind `NEWSLETTER_COUPON_ENABLED`, default off. When on, the prompt allows mentioning the newsletter coupon as the site describes it, and the checker allows the word.
   - Removed: v1's "the third one is 61 ₪" and the 157.50 ₪ per-device price. Both are shekel-savings framings, so they're now blocked.
3. **Gift** - the prompt says 2 or more devices include "מדריך לנשימה חופשית".
4. **Shipping time** - the default answer is "בדרך כלל לוקח שבוע עד שבועיים" plus free shipping לכל הארץ. Only when asked for a commitment: "אנחנו מתחייבים לאספקה עד חודש". Details come from the synced shipping policy, or a hand-off if it isn't loaded. Delivery time is no longer a known unknown.
5. **Refunds** - general questions get "יש 30 ימי ניסיון, וההחזרים לפי התנאים במדיניות ההחזרים באתר": no link, no steps, no unconditional promise.
   - **Blocked by the checker:** "מקבלים / תקבלו / נחזיר ... את הכסף", "כסף בחזרה", "החזר מלא", "בלי / ללא / אין סיכון", "אין מה להפסיד".
   - **Stated wish to return or cancel:** the bot gives the steps from the synced refund policy (numbered, at most 4, no link, the 14-day legal cancellation not hidden) and hands off. The checker allows a numbered list of up to 4 steps (6 lines / 900 characters in total).
   - **Narrower detector:** the router's `cancel_refund` detector now fires only on a stated wish ("אני רוצה להחזיר", "לבטל את ההזמנה", "תבטלו"). Questions like "יש החזרים?", "אפשר לקבל החזר אם לא עוזר?" or "איך עובדת מדיניות ההחזרים?" get the general answer and don't silence the bot.
   - **Samples:** every sample conversation and test that implied an unconditional refund was updated.
6. **Quiet after a hand-off** - `src/handoffState.js`. After a hand-off the bot stops answering that customer and forwards every new message to the owner.
   - **Before `HANDOFF_QUIET_MINUTES` (120):** nothing is sent to the customer.
   - **At or after it:** one reassurance naming the topic, e.g. "קיבלנו, הפנייה שלך לגבי ההחזר או הביטול אצל הצוות, ונחזור אליך בהקדם 🙏". Then the timer restarts.
   - **Daily limit:** at most `HANDOFF_MAX_REASSURANCES_PER_DAY` (3) per Israeli calendar day.
   - **Weekend:** on Friday-Saturday it says "הצוות זמין בימים א'-ה', ונחזור אליך ביום העבודה הבא". No hours are mentioned, because the site publishes only days.
   - **Clearing:** `SEND` or `RESUME` closes the hand-off. `SEND` also keeps v1's 12-hour pause, during which the customer's messages go to the owner.
   - **One alert per message:** all hand-off reasons from one customer message now go into a single owner alert (v1 could send two, e.g. a technical fallback plus a detector).
7. **No phone numbers, emails or policy links** - the prompt forbids them, the checker blocks them (tracking links and tracking numbers are still allowed), and the sync strips them from the site text before it reaches the prompt.

## Known issues to report to the owner (§7 - not fixed on the site)
1. **The FAQ promises an unconditional refund.** The product-page FAQ ("מה אם זה לא יעזור לי?" and "מה אם לא ארגיש שיפור?") says "מקבלים / תקבלו את הכסף בחזרה" with no conditions. You've said the refund policy has conditions. The bot now uses the conditional wording, but the site itself still promises more than the policy does.
2. **The phone number on the site has a digit too many.** The FAQ ("יש לי עוד שאלה") lists 055-928-9598, which is 11 digits; an Israeli mobile has 10. The bot never gives out a phone number either way.
3. **The sales guide uses wording v1.1 now forbids.** "בזוג חוסכים 63 ש"ח", "השלישי יוצא רק 61 ש"ח", "יש הנחה על זוג" and "אין פה סיכון" are shekel-savings or unconditional-promise phrasings. The bot overrides them. Staff using the guide on calls should know.
4. **The site has a sale banner and compare-at prices** (as described in CHANGES_v1.1). The bot is told never to repeat them, and the sync strips them. If the "regular" price is shown crossed out on the site, customers may ask about it. The bot will only quote the current prices.
5. **I couldn't check the live site at all** (blocked network), so other on-site issues may exist. Run the bot once with network access and read the `site_sync_*` logs and `data/site-cache.json`.

## Decisions (v1, still in force unless changed above)
1. **Model and agent loop.** `CLAUDE_MODEL` defaults to `claude-sonnet-5-5`. Calls use the official `@anthropic-ai/sdk` with a manual tool loop, two tools (`lookup_order`, `handoff_to_human`), `output_config.effort = low` (`CLAUDE_EFFORT`) and SDK retries (`maxRetries: 3`). Forced `tool_choice` isn't used, because current models reject it. A refusal gets the safe fallback and a hand-off.
2. **Knowledge in the prompt, cached.** Rules + site block + both docs files, with no RAG. Docs ≈ 35K characters (15-20K tokens). The site text adds more, depending on the length of the policies; each part is capped at 12,000 characters.
3. **The rules are enforced twice.** They're in the prompt, and `src/compliance.js` checks every reply (dash auto-fix, banned medical / hype wording with negation handling, "עד הבית", prices / % / discounts, refund promises, contact details and policy links, 660 outside the study, certifications, fake social proof, Hebrew only, length and bullets). A failed reply gets one rewrite with the reasons; if that fails too, the bot sends the safe fallback and hands off. The router checks the final text once more, using the same synced prices.
4. **Deterministic hand-off detectors.** Medical red flags, a request for a person, a stated wish to cancel or return, complaints / faulty device, and (v1.1) questions that need site data that never loaded. Any reply containing "אבדוק ואחזור" also hands off. Since a hand-off now silences the bot for up to 2 hours, a false positive costs more than in v1. The broadest detector is any mention of children ("ילדים"), which the brief requires.
5. **Cancellation (legal override).** The bot never proposes cancelling unprompted, and never denies, hides or discourages it when asked.
6. **Order lookup.** Shopify Admin GraphQL, `read_orders`. The order number AND a phone on the order must match, otherwise the answer is the same `found:false`. At most 5 lookups per customer per hour. Only a Hebrew status sentence and the tracking info reach the model.
7. **Owner commands** through the bot: `SEND`, `PAUSE`, `RESUME`, `BLOCK`, `UNBLOCK`, `HELP`.
8. **Memory** is in-process (`InMemoryConversationStore`, swappable), with the last 20 messages and a 24-hour inactivity expiry. The open-hand-off state lives in the same per-conversation metadata, so it also expires after 24 hours without messages and on restart. After that the bot answers again. Messages that arrive during a hand-off are forwarded but not added to the bot's history.
9. **Privacy.** Masked phone numbers in logs and no message bodies in production. Owner alerts carry the full number and the last message. The disk cache holds only public site text.
10. **Gender-neutral / plural wording**, as on the site.
11. **Abandoned cart** is prepared and disabled.
12. **Non-text messages** get a short request to write in text. During a hand-off they are forwarded as "(הודעה מסוג image)".
13. **Webhook security** fails closed without `WHATSAPP_APP_SECRET`.

## Interpretations of CHANGES_v1.1 (please confirm)
- **"Stops answering that customer on that matter."** Telling which matter a new message is about would need another model call, so the bot treats every message from that customer as the same matter until you reply (`SEND`) or `RESUME`.
- **Support hours.** CHANGES says the site lists Sunday-Thursday. The reassurance uses that (Israel time, days only). It is a constant in `src/handoffState.js`, not parsed from the contact page, because the page's format is unknown.
- **"Fall back to docs/ and hand off price/policy questions"** is applied per part. If the prices loaded but the shipping policy didn't, only shipping-detail questions are handed off. General refund questions and the default shipping time don't depend on the site (they are fixed owner wording), so they are never handed off for a missing sync.
- **Price-change alert.** The first comparison is against the docs/ prices, so if the site's prices already differ from docs/ on the very first sync, you get one alert.

## Open questions for the owner
1. Warranty for a fault after 30 days (still a known unknown).
2. Certifications (CE / FCC / Ministry of Health): written confirmation from the supplier.
3. Cleaning instructions and any eye warning from the supplier's booklet.
4. Owner alerts outside the 24-hour window: approve a Utility template and set `OWNER_NOTIFY_TEMPLATE`, or send `HELP` from your phone each day. Price-change alerts use the same channel.
5. Do you want the newsletter coupon mentioned (`NEWSLETTER_COUPON_ENABLED=true`)? If yes, the bot will describe it only as the site does, never give a code.
6. Is 2 hours of quiet right for customers who write at night? Do you want a fixed hour range added to the reassurance, if you publish one on the site?

Resolved by v1.1: delivery time, return process (from the synced policy), support days, savings wording (% only), the gift with 2+ devices, and staying quiet after a hand-off.

## Not verified (no access from this environment)
- **Live site.** `avora-il.com` was blocked by the build environment's network policy, so I don't know:
  - whether the quantity-break block uses labels like "2 מכשירים" / "3 מכשירים";
  - whether the FAQ sits in an FAQ / accordion element;
  - whether the site blocks automated requests;
  - how long the policies are.

  If the bundle prices can't be parsed, the log shows `site_sync_part_failed part=bundle_prices` and the bot keeps the last good prices (or the docs/ prices + hand-off). Adapt `QTY_LABELS` / `parseBundlePrices` in `src/siteSync.js` to the real markup if needed. To develop against the site from Claude Code on the web, add `avora-il.com` under Allowed domains in the environment's network settings.
- **No live model run.** There was no `ANTHROPIC_API_KEY`, so the 30 conversations in `tests/conversations/` are expected replies written by hand from docs/ and CHANGES_v1.1. They're marked in `source`, and their `site` field says they assume the current prices but no policy texts. That's why the return / cancel samples say the team will send the steps instead of listing them. Run `npm run conversations:live` (it syncs the site first) to see real replies.
- **Meta.** Console menus, the Graph API version (default `v23.0`), Coexistence, and Israel per-message prices.
- **Shopify.** API version `2026-07`, the GraphQL field names against a live store, and Dev Dashboard custom apps / protected customer data.
- **Docker / Railway.** The image wasn't built (no Docker daemon here). A Railway volume at `/app/data` is optional and wasn't tested.
- **Costs.** README figures are estimates. The synced site text will raise input tokens by an amount that depends on policy length. Check the `agent_usage` logs (`cacheRead` / `cacheWrite`) after going live.
