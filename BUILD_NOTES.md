# BUILD_NOTES

Build of v1 of the Avora+ WhatsApp bot, following `CLAUDE.md` (brief) and `docs/08_WHATSAPP_BOT_GUIDE.md`. Date: 2026-10-13.

## Status
- Code, tests, Dockerfile, Railway config, README (Hebrew + English) are done.
- `npm test`: 103 tests pass (webhook + signature, routing, compliance, agent with a mocked model, Shopify with a mocked API, 27 sample conversations replayed through the full pipeline).
- Local smoke test: started the real `src/index.js` with dry-run sending. `/health`, webhook verification, a signed message and a rejected bad signature all worked. The message reached the real Anthropic API (rejected, because there was no real key), and the bot sent the safe fallback and the owner alert (dry-run).
- Not done, as the brief asked: no real WhatsApp messages sent, nothing deployed, no accounts created.

## Decisions
1. **Model and agent loop.** `CLAUDE_MODEL` defaults to `claude-sonnet-5-5`, as the brief says. Calls use the official `@anthropic-ai/sdk` with a manual tool loop, two tools (`lookup_order`, `handoff_to_human`), `output_config.effort = low` (env `CLAUDE_EFFORT`) and SDK retries (`maxRetries: 3`, the guide asked for 3 attempts). Forced `tool_choice` isn't used because current models reject it. Server-side refusal fallback isn't enabled. For Sonnet 5.5 it only retries the cyber and frontier-LLM categories, which a customer-service bot won't hit. A refusal gets the safe fallback reply and a hand-off.
2. **Knowledge in the prompt, cached.** Both docs files are loaded word for word into the system prompt at startup, after the rules, and marked for prompt caching. That's about 35K characters, an estimated 15-20K tokens. No RAG: the docs are small and the brief wants the FAQ wording used word for word.
3. **The rules are enforced twice.** They're in the system prompt, and `src/compliance.js` checks every outgoing reply: em/en dash and maqaf (auto-fixed to "-"), the banned medical and hype wording, "עד הבית", prices other than 189/315/439/61, %, discounts / coupons / "מחיר רגיל", 660 outside the study, certification claims, fake reviews / counts, Hebrew-only, max 4 lines / 700 chars / no bullet walls. Words such as "טיפול ב-", "מחליף", "תרופה" and "מכשיר רפואי" are allowed only when negated ("אינו טיפול בדום נשימה"), because the site's own FAQ uses them that way. A failed reply gets one rewrite with the reasons; if that fails too, the bot sends "תודה על ההודעה 🙏 אבדוק ואחזור אליך בהקדם." and hands off. The router checks the final text once more before sending.
4. **Hand-off is deterministic as well as model-driven.** The router has keyword detectors for medical red flags (fever, strong pain, colored or bloody discharge, bleeding, breathing pauses, one-sided blockage, children, pregnancy/breastfeeding), requests for a person, cancel/return/refund, and complaints or faulty devices. A detection is passed to the model as a `[הערת מערכת]` note, and the owner is notified even if the model forgets to call the tool. Any reply containing "אבדוק ואחזור" also notifies the owner. Alerts are de-duplicated per customer and category for one hour. The detectors are deliberately broad (for example, any mention of "ילדים"), so expect some unnecessary alerts.
5. **Cancellation and refunds (legal override).** The bot never offers cancellation unprompted (guide rule 6). When asked, it answers truthfully: 30-day trial, money back per the site's refund policy, the team will handle it. It hands off and never discourages. The return-shipping process is a known unknown, so the bot doesn't describe it.
6. **Order lookup** uses the Shopify Admin **GraphQL** API, not REST. REST is legacy at Shopify, and GraphQL works with the same `read_orders` scope. An order is returned only if the order number AND a phone on the order (order, customer, billing or shipping) match the last 9 digits. Otherwise the answer is the same `found:false`, so order numbers can't be enumerated. There are also at most 5 lookups per customer per hour. Only a Hebrew status sentence and the tracking info reach the model: no name, address or amount, and no dates or day counting (guide rule 5).
7. **How the owner replies to customers.** With the Cloud API, the business number usually can't also be used from the WhatsApp Business app. So the owner can reply through the bot: `SEND <phone> <text>`. This also pauses the bot for that customer for 12 hours and forwards the customer's next messages to the owner. Also added: `PAUSE`, `RESUME`, `BLOCK`, `UNBLOCK` (guide rule 10) and `HELP`.
8. **Memory.** `InMemoryConversationStore` has an async interface (`getHistory/append/clear/getMeta/setMeta`), so Redis or Postgres can replace it. It keeps the last 20 messages, and a conversation expires after 24 hours of inactivity. Only plain text is stored, never tool calls or thinking blocks. The block list and the de-dup sets are also in memory and reset on restart. Run one replica.
9. **Privacy.** Logs are JSON lines. Phone numbers are masked (`9725*****567`), and with `NODE_ENV=production` message bodies are replaced by their length. The owner's WhatsApp alert does contain the full number and the last customer message, since the owner needs them to follow up.
10. **Gender.** The site addresses customers in the plural, so the prompt asks for plural or gender-neutral wording unless the customer's own words make their gender clear. The bot refers to itself as "we" or in neutral forms ("אבדוק ואחזור אליך").
11. **Abandoned cart** is prepared in `src/marketing/abandonedCart.js` and stays disabled. It refuses to run unless explicitly enabled, and it skips anyone without explicit marketing consent. It is not wired to any schedule.
12. **Non-text messages** (voice, image, sticker) get a short Hebrew request to write in text. Reactions are ignored.
13. **Webhook security.** Every POST without a valid `X-Hub-Signature-256` is rejected with 401. If `WHATSAPP_APP_SECRET` is missing, all POSTs are rejected (fail closed). The guide's env var names were changed to the brief's (`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `OWNER_WHATSAPP_NUMBER`).

## Judgment calls on the docs (please confirm)
- **Savings wording.** The sales guide says "בזוג חוסכים 63 ש"ח" and "יש הנחה על זוג". The brief bans any regular price, crossed-out price or % discount, and any invented deal. To be safe, the bot gives the bundle prices only (and "השלישי יוצא 61 ₪", which the brief allows). The checker blocks "הנחה", "חוסכים", "חיסכון", "מבצע", "קופון". The per-device price of the pair (157.50 ₪) is also allowed. If savings in shekels are OK with you, remove those words from the `discount` rule in `src/compliance.js`.
- **The digital gift guide.** "מדריך לנשימה חופשית" with 2 devices appears only in the sales guide, not in the product-page FAQ. The bot does mention it. Please confirm it's still on offer.
- **Phone number on the site.** The FAQ says 055-928-9598, which is 11 digits; an Israeli mobile number has 10 (the sales guide flags this too). The bot never gives out phone numbers or email, since the customer is already on WhatsApp.
- **Strict wording.** Two FAQ passages are stricter in the checker than on the site, so the bot will rephrase them instead of quoting them: "לא נועד ... לתת הקלה מיידית" and the legal disclaimer ("לרפא").
- **Medical device question.** The bot answers the wellness part from the docs. For certifications (CE / FCC / Ministry of Health) it says "אבדוק ואחזור אליך" and hands off, as the brief lists them as unknown.

## Open questions for the owner
1. Delivery time and method: how many days, and does the package go to a pickup point or a post office?
2. Return process: does the customer send the device back, and who pays for shipping?
3. Warranty for a fault after 30 days.
4. Support hours, and what to promise for "the team will get back to you" (for example, "within one business day").
5. Certifications (CE / FCC / Ministry of Health): written confirmation from the supplier.
6. Cleaning instructions and any eye warning from the supplier's booklet. The bot currently says "per the booklet".
7. Are savings / "discount on a pair" wording allowed? (See above.)
8. Is the "מדריך לנשימה חופשית" gift with 2 devices still on offer?
9. Owner alerts outside the 24h window: approve a Utility template and set `OWNER_NOTIFY_TEMPLATE`, or send `HELP` from your phone each day.
10. Should the bot keep answering after a hand-off (current behavior), or go quiet until you reply? `PAUSE` already lets you silence it manually.

## Not verified (no access from this environment)
- **No live model run.** `ANTHROPIC_API_KEY` wasn't available, so the 27 conversations in `tests/conversations/` are expected replies written by hand from the docs. They're marked in their `source` field. Run `npm run conversations:live` with a real key to generate live replies into `tests/conversations/live/` and compare. The prompt itself has not yet been tested against the real model.
- **Meta.** The exact console menus, the current Graph API version (code default `v23.0`, overridable with `WHATSAPP_GRAPH_VERSION`), Coexistence availability, and current per-message prices for Israel.
- **Shopify.** API version `2026-07` (overridable with `SHOPIFY_API_VERSION`), the GraphQL field names were not tested against a live store, and I couldn't confirm whether new custom apps must be created in the Dev Dashboard and how protected-customer-data approval works there. If a lookup fails, the bot hands off.
- **Docker / Railway.** The Docker image was not built (no Docker daemon here), and Railway pricing was not checked.
- **Costs.** The figures in the README are estimates from list prices ($2 / $10 per million tokens, $0.20 for cache reads) and an estimated prompt size, not measurements. Check `cache_read_input_tokens` in the `agent_usage` log lines after going live.
