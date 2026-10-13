# Avora+ WhatsApp customer-service bot - build brief

Owner: Avora (Israeli DTC brand, Shopify store avora-il.myshopify.com, site avora-il.com). Product: Avora+ (אבורה+), an intranasal red light device. Customers write in Hebrew on WhatsApp. This repo is ONLY the bot. Date of brief: 2026-10-13.

## Goal (version 1)
A WhatsApp Business bot that answers customers in natural Israeli Hebrew, 24/7, the way the owner would:
1. Product questions (what it is, how it works, how to use, safety, who it suits, results timeline) - answered ONLY from `docs/PRODUCT_PAGE_FAQ.md` (live site wording - use word for word when it fits) and `docs/SALES_GUIDE_KNOWLEDGE.md` (the owner's sales guide: facts, research, FAQ, objections, "what not to say").
2. Order status - look up a Shopify order by order number + the customer's phone (read-only Admin API), reply with status/tracking if available.
3. Hand-off to a human - when the bot is unsure, the customer asks for a person, a complaint/refund/cancellation request, a medical red flag, or anything not covered by the docs: tell the customer the team will get back to them, and notify the owner (log + an owner notification hook; WhatsApp to the owner's number via env var).
Out of scope for v1 (prepare the structure, don't enable): abandoned-cart template messages (need Meta-approved templates and marketing consent).

## Stack (follow docs/08_WHATSAPP_BOT_GUIDE.md)
Node.js + Express, Meta WhatsApp Cloud API webhook (verify token + signature check X-Hub-Signature-256), Anthropic Claude API for the agent (default model `claude-sonnet-5-5`; make it an env var), Shopify Admin API (read_orders only), per-conversation memory (in-memory for v1 with a clean interface so a DB can replace it), hosting target Railway (Dockerfile or nixpacks, health check endpoint).
Read the guide fully - its "Bot Behavior Rules (learned from production)" apply, EXCEPT where this brief overrides them (see "Legal overrides").

## Hard rules for every bot reply (put them in the system prompt AND enforce with automated checks)
- Hebrew only, short WhatsApp-style messages, warm and practical. Regular dash "-" only, never an em-dash or en-dash. No bullet walls; 1-4 short lines.
- Never invent facts. If the docs don't cover it, say "אבדוק ואחזור אליך" and hand off. Known unknowns today: certifications (CE/FCC/Ministry of Health), delivery time and method details, return-shipping process, warranty after 30 days, support hours.
- Prices exactly: 1 device 189 ₪, 2 devices 315 ₪, 3 devices 439 ₪ (the third is 61 ₪). Free shipping "לכל הארץ" - NEVER "עד הבית" (it is not door delivery). 30-day trial: didn't feel a difference -> money back per the site's refund policy. Never mention a "regular price", a crossed-out price, or a % discount. Never invent coupons or deals.
- Wellness wording ONLY. Allowed: עוזר, תומך, הקלה, אף רגוע יותר, לנשום חופשי יותר. BANNED: מרפא, ריפוי, מטפל ב-, טיפול ב(מחלה), תרופה, מובטח, הכי טוב, מהפכני, "מרגישים מיד", "מהלילה הראשון", "מחליף תרופות/CPAP".
- Avora+ is a wellness device, not a medical device. Never give medical advice or diagnosis. Never tell anyone to stop or change a medication, spray, or CPAP - "כל שינוי רק עם הרופא שלך".
- CPAP / sleep apnea: always say it does NOT treat sleep apnea and does NOT replace the CPAP; they keep using the machine as the doctor said.
- Refer to a doctor (and hand off) on red flags: fever, strong facial pain, colored or bloody discharge, nosebleeds, breathing pauses in sleep, one-sided blockage that doesn't pass, children, pregnancy/breastfeeding questions.
- Results: gradual - "הרבה אנשים מתחילים לשים לב אחרי שבוע-שבועיים של שימוש יומי, ויותר לאורך החודש", always "אצל כל אחד זה שונה". Never promise.
- Research: only as in the sales guide (studies tested red light in the nose in general, not Avora+; the Israeli study used 660nm; Avora+ is 630-650nm). Never "studies proved Avora+ works".
- No fake reviews, no customer counts, no testimonials. If asked for reviews: we're new in Israel, that's why there's a 30-day trial.

## Legal overrides of the guide (Israel)
- Cancellation / refunds: the guide's "never offer cancellation" means don't PROPOSE cancelling unprompted. But if a customer asks to cancel or return, never deny, hide or discourage it - answer truthfully (30-day trial, money back per the site policy) and hand off to a human to process it. Israeli consumer protection law gives a right to cancel; the bot must not mislead.
- Marketing messages (abandoned cart, promos) only to people who gave explicit consent (Israeli anti-spam law) and only via Meta-approved templates. Not enabled in v1.
- Privacy: store the minimum (phone, conversation, order number). No full message bodies or PII in plain production logs (mask phone numbers). Document data retention in the README.

## Security
- Secrets ONLY via environment variables. Commit a `.env.example` with names and empty values. Never commit real values, never print them in logs or tests.
- Env vars: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET, OWNER_WHATSAPP_NUMBER, ANTHROPIC_API_KEY, CLAUDE_MODEL, SHOPIFY_STORE, SHOPIFY_ACCESS_TOKEN, PORT.

## What NOT to do
- Do not send real WhatsApp messages, do not deploy, do not create accounts or buy anything. The owner will connect Meta, the number and Railway himself following the README.
- Do not add knowledge that isn't in docs/. Do not change the facts in docs/.

## Deliverables
1. Working code (server, webhook, agent, WhatsApp sender, Shopify lookup, hand-off/notify, memory) with clear structure.
2. Automated tests: webhook verification + signature; message routing; a compliance test that runs the agent's replies (with a mocked or recorded model) through a banned-words / dash / price / "עד הבית" check; Shopify lookup with mocked API.
3. `tests/conversations/` - at least 20 sample Hebrew conversations (customer message -> bot reply) covering: price, bundles, how it works short and long, usage, pain/comfort, CPAP, polyps/septum, pregnancy, kids, "is it a medical device", spray dependency, "too expensive", "gimmick?", reviews, shipping, delivery time (unknown -> hand off), return/cancel (hand off, no discouraging), order status, angry customer, off-topic. If a real ANTHROPIC_API_KEY is available in the environment, generate them live; otherwise mark them as expected replies written from the docs.
4. README (Hebrew + English): local run, env vars, Meta WhatsApp Cloud API setup step by step (app, phone number, webhook URL + verify token, permanent token), Railway deploy, how to update the knowledge files, costs to expect (Claude API per conversation, Meta per conversation, hosting).
5. `BUILD_NOTES.md`: decisions made, open questions for the owner, anything that couldn't be verified.
