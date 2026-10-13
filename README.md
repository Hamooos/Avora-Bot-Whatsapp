# Avora+ WhatsApp Bot

בוט שירות לקוחות בוואטסאפ לאבורה+, בעברית, 24/7. / A Hebrew WhatsApp customer-service bot for Avora+.

- [עברית](#עברית)
- [English](#english)

---

## עברית

### מה הבוט עושה
1. **שאלות על המוצר** - עונה רק מתוך המידע מהאתר (ראו "סנכרון מהאתר"), `docs/PRODUCT_PAGE_FAQ.md` ו-`docs/SALES_GUIDE_KNOWLEDGE.md`, בהודעות קצרות. כשהאתר והמסמכים לא מסכימים - האתר קובע.
2. **סטטוס הזמנה** - מחפש בשופיפיי לפי מספר הזמנה + מספר הטלפון (קריאה בלבד). אם הטלפון לא תואם, הלקוח מקבל "לא מצאנו".
3. **העברה לנציג** - כשהלקוח מבקש אדם, אומר שהוא רוצה לבטל / להחזיר / לקבל החזר, תלונה, דגל אדום רפואי, או כל שאלה שאין לה תשובה. הלקוח מקבל "הצוות יחזור אליך", ואתה מקבל הודעת וואטסאפ אחת עם המספר, הסיבה וההודעה האחרונה.

כל תשובה עוברת בדיקה אוטומטית לפני שליחה (מילים אסורות, מקף ארוך, מחירים מול המחירים באתר, הנחות רק באחוז המחושב, "עד הבית", הבטחת החזר ללא תנאים, מספרי טלפון וקישורים למדיניות, אורך). תשובה שנכשלת נכתבת מחדש פעם אחת, ואם גם היא נכשלת - נשלח "אבדוק ואחזור אליך" ואתה מקבל התראה.

### מה הבוט אומר (החלטות 13.10.2026)
- **מחירים** - תמיד המחירים הנוכחיים באתר (היום: 1 = 189 ₪, 2 = 315 ₪, 3 = 439 ₪).
- **הנחה** - רק באחוזים, מחושב מול קנייה של אותו מספר יחידות במחיר של מכשיר בודד, מעוגל למטה (היום: 2 מכשירים - חיסכון של 16%, 3 מכשירים - 22%). אף פעם לא חיסכון בשקלים, "מחיר רגיל", "במקום X", מחיר מחוק, באנר מבצע של האתר או קופון ניוזלטר (אלא אם `NEWSLETTER_COUPON_ENABLED=true`).
- **מתנה** - משני מכשירים ומעלה מקבלים את המדריך הדיגיטלי "מדריך לנשימה חופשית".
- **זמן משלוח** - "בדרך כלל לוקח שבוע עד שבועיים" + משלוח חינם לכל הארץ. רק אם מבקשים התחייבות: "אנחנו מתחייבים לאספקה עד חודש". פרטים נוספים - ממדיניות המשלוחים באתר.
- **החזרים, שאלה כללית** - "יש 30 ימי ניסיון, וההחזרים לפי התנאים במדיניות ההחזרים באתר". בלי קישור, בלי שלבים, ובלי "מקבלים את הכסף בחזרה".
- **לקוח שרוצה להחזיר / לבטל** - השלבים בקצרה ממדיניות ההחזרים באתר (ממוספר, עד 4 שלבים, בלי קישור, בלי להסתיר את 14 ימי הביטול), והעברה אליך.
- אף פעם לא נותן מספר טלפון או קישור לדפי המדיניות.

### אחרי העברה לנציג
- הבוט מפסיק לענות ללקוח הזה, וכל הודעה חדשה שלו מועברת אליך.
- אם עברו פחות מ-`HANDOFF_QUIET_MINUTES` (ברירת מחדל 120 דקות) מאז ההעברה ולא ענית - הבוט שותק.
- אחרי הזמן הזה - הלקוח מקבל הודעת הרגעה אחת קצרה (למשל "קיבלנו, הפנייה שלך לגבי ההחזר או הביטול אצל הצוות, ונחזור אליך בהקדם 🙏"), והספירה מתחילה מחדש. לכל היותר `HANDOFF_MAX_REASSURANCES_PER_DAY` (ברירת מחדל 3) ביום. בשישי-שבת ההודעה אומרת שהצוות זמין בימים א'-ה' ויחזור ביום העבודה הבא.
- תשובה שלך דרך `SEND`, או `RESUME`, סוגרת את ההעברה.

### סנכרון מהאתר
בעלייה וכל 6 שעות הבוט קורא מ-avora-il.com: מחיר מכשיר בודד (`/products/avora-plus.js`), מחירי החבילות והשאלות הנפוצות מדף המוצר, ומדיניות ההחזרים, המשלוחים, תנאי השימוש, הפרטיות ופרטי הקשר. הטקסט נכנס להנחיות של הבוט בבלוק "אתר - מידע עדכני" (בלי כותרת/פוטר/פופאפ ניוזלטר/באנר מבצע/מחירים מחוקים, ובלי קישורים, טלפונים ואימיילים).
- אם קריאה נכשלת - הבוט ממשיך עם העותק הטוב האחרון (בזיכרון ובקובץ `SITE_CACHE_FILE`) ורושם אזהרה בלוג.
- אם אף פעם לא נטען עותק - הבוט משתמש במחירים מ-`docs/` ומעביר אליך שאלות על מחיר ומדיניות.
- אם המחירים באתר השתנו - אתה מקבל הודעה אחת: "המחירים באתר השתנו: ...".
- המחירים והאחוזים נלקחים מהאתר, כך ששינוי מחיר באתר לא דורש שינוי בקוד.

### פקודות מנהל (שולחים מהמספר שב-`OWNER_WHATSAPP_NUMBER` למספר של הבוט)
| פקודה | מה זה עושה |
|---|---|
| `SEND 0501234567 טקסט` | שולח ללקוח את הטקסט בשם העסק, סוגר את ההעברה לנציג, ומשתיק את הבוט ללקוח הזה ל-12 שעות. הודעות הלקוח בזמן הזה מועברות אליך. |
| `PAUSE 0501234567` / `RESUME 0501234567` | משתיק / מחזיר את הבוט ללקוח (`RESUME` גם סוגר העברה לנציג) |
| `BLOCK 0501234567` / `UNBLOCK 0501234567` | חוסם / מבטל חסימה (נשמר בזיכרון עד ריסטארט) |
| `HELP` | רשימת הפקודות |

שים לב: וואטסאפ מאפשר לשלוח טקסט חופשי ללקוח רק עד 24 שעות מההודעה האחרונה שלו.

### הרצה מקומית
```bash
npm install
cp .env.example .env      # ממלאים ערכים
npm test                  # כל הבדיקות, בלי רשת
npm run dev               # שרת על http://localhost:3000
```
כדי שלא יישלחו הודעות אמיתיות בזמן ניסוי: `WHATSAPP_DRY_RUN=true` ב-`.env`.
כדי לראות איך Claude עונה בפועל על השיחות לדוגמה (עולה כסף, לא שולח וואטסאפ): `npm run conversations:live`.

### משתני סביבה
| משתנה | מה זה |
|---|---|
| `WHATSAPP_TOKEN` | טוקן קבוע של System User (שלב 5 למטה) |
| `WHATSAPP_PHONE_NUMBER_ID` | Phone number ID מעמוד API Setup |
| `WHATSAPP_VERIFY_TOKEN` | מחרוזת אקראית שאתה בוחר, ומקלידים אותה גם ב-Meta |
| `WHATSAPP_APP_SECRET` | App secret של האפליקציה ב-Meta (לבדיקת חתימה) |
| `OWNER_WHATSAPP_NUMBER` | המספר הפרטי שלך, למשל `972501234567` |
| `ANTHROPIC_API_KEY` | מפתח API של Anthropic |
| `CLAUDE_MODEL` | ברירת מחדל `claude-sonnet-5-5` |
| `SHOPIFY_STORE` | `avora-il.myshopify.com` |
| `SHOPIFY_ACCESS_TOKEN` | טוקן Admin API עם `read_orders` בלבד |
| `PORT` | ריילווי מגדיר לבד |
| `HANDOFF_QUIET_MINUTES` | כמה דקות הבוט שותק אחרי העברה לנציג לפני הודעת הרגעה (ברירת מחדל 120) |
| `HANDOFF_MAX_REASSURANCES_PER_DAY` | מקסימום הודעות הרגעה ללקוח ביום (ברירת מחדל 3) |
| `NEWSLETTER_COUPON_ENABLED` | האם מותר להזכיר את קופון הניוזלטר (ברירת מחדל `false`) |
| `SITE_URL` / `SITE_SYNC_HOURS` / `SITE_CACHE_FILE` | כתובת האתר (`https://avora-il.com`), כל כמה שעות לסנכרן (6), קובץ העותק האחרון (`data/site-cache.json`) |
| רשות: `NODE_ENV=production`, `WHATSAPP_DRY_RUN`, `CLAUDE_EFFORT`, `CLAUDE_MAX_TOKENS`, `SHOPIFY_API_VERSION`, `WHATSAPP_GRAPH_VERSION`, `OWNER_NOTIFY_TEMPLATE` | ראו `.env.example` |

### חיבור WhatsApp Cloud API של Meta - שלב אחרי שלב
1. **Business portfolio**: ב-business.facebook.com צור (או בחר) את חשבון העסק של אבורה, והתחל אימות עסק (Business verification).
2. **אפליקציה**: ב-developers.facebook.com > My Apps > Create App > בחר בשימוש של WhatsApp ("Connect with customers through WhatsApp"), וחבר אותה ל-Business portfolio.
3. **מספר טלפון**: באפליקציה > WhatsApp > API Setup > Add phone number. המספר צריך לקבל SMS או שיחה לאימות. אם המספר כבר פעיל באפליקציית וואטסאפ / WhatsApp Business, צריך למחוק אותו משם קודם (או להשתמש באפשרות Coexistence אם היא זמינה לך - לא נבדק). הגדר שם תצוגה (Meta מאשרים אותו).
4. העתק את **Phone number ID** ל-`WHATSAPP_PHONE_NUMBER_ID`. באפליקציה > App settings > Basic העתק את **App secret** ל-`WHATSAPP_APP_SECRET`.
5. **טוקן קבוע**: ב-Business settings > Users > System users > Add (תפקיד Admin) > Assign assets: האפליקציה וחשבון ה-WhatsApp (Full control) > Generate new token > בחר את האפליקציה, תוקף **Never**, הרשאות `whatsapp_business_messaging` ו-`whatsapp_business_management`. העתק ל-`WHATSAPP_TOKEN` (הטוקן מוצג פעם אחת).
6. **פריסה לריילווי** (סעיף הבא) כדי לקבל כתובת ציבורית.
7. **Webhook**: באפליקציה > WhatsApp > Configuration > Webhook > Edit: Callback URL = `https://<הדומיין-שלך>.up.railway.app/webhook`, Verify token = הערך של `WHATSAPP_VERIFY_TOKEN` > Verify and save. אחר כך ב-Webhook fields עשה **Subscribe** ל-`messages`.
8. **אמצעי תשלום** ב-WhatsApp Manager (נדרש לתבניות בתשלום), והעבר את האפליקציה ל-**Live** (צריך כתובת למדיניות פרטיות).
9. **התראות אליך**: שלח `HELP` מהמספר הפרטי שלך למספר של הבוט - זה פותח חלון של 24 שעות שבו הבוט יכול לשלוח לך התראות. כדי לקבל התראות גם מחוץ לחלון, צור ב-WhatsApp Manager תבנית Utility בעברית (למשל `owner_alert` עם הגוף "פנייה חדשה שדורשת טיפול: {{1}}"), וכשהיא מאושרת שים את שמה ב-`OWNER_NOTIFY_TEMPLATE`.
10. בדיקה: שלח מטלפון אחר "כמה זה עולה?" למספר של הבוט.

### טוקן שופיפיי (קריאה בלבד)
באדמין של שופיפיי: Settings > Apps and sales channels > Develop apps > Create an app > Configure Admin API scopes > סמן רק `read_orders` > Install > העתק את ה-Admin API access token ל-`SHOPIFY_ACCESS_TOKEN`.
הבוט צריך לקרוא את הטלפון שבהזמנה, ולכן באפליקציה צריך לאשר גישה ל-**Protected customer data** (שדה Phone).
אם אצלך האדמין מפנה ליצירת אפליקציות דרך ה-Dev Dashboard של שופיפיי - צור שם אפליקציה עם אותה הרשאה והתקן אותה בחנות (התהליך הזה לא נבדק מכאן).

### פריסה לריילווי
1. railway.com > New Project > Deploy from GitHub repo > בחר את הריפו. ריילווי בונה מה-`Dockerfile` ובודק את `/health` (מוגדר ב-`railway.json`).
2. Variables: הוסף את כל משתני הסביבה + `NODE_ENV=production`.
3. Settings > Networking > Generate Domain. את הכתובת שמים ב-Webhook של Meta (שלב 7).
4. מומלץ תוכנית בתשלום כדי שהשירות לא יירדם. כל `git push` לענף הראשי מפעיל פריסה מחדש.
5. השאר **שירות אחד (replica אחד)**: הזיכרון של השיחות נמצא בתוך התהליך.
6. רשות: חבר Volume של ריילווי ל-`/app/data`, כדי שהעותק האחרון של האתר יישמר גם אחרי פריסה. בלי Volume הבוט פשוט קורא את האתר מחדש בעלייה.

### עדכון קבצי הידע
- עורכים את `docs/PRODUCT_PAGE_FAQ.md` או `docs/SALES_GUIDE_KNOWLEDGE.md`, מריצים `npm test`, עושים commit ו-push. ריילווי מפרס, והבוט קורא את הקבצים מחדש בעלייה.
- מחירים, מדיניות ושאלות נפוצות בדף המוצר - משנים **באתר**. הבוט מתעדכן תוך עד 6 שעות (או בריסטארט), בלי שינוי קוד.
- כשתהיה תשובה לאחד מהדברים שעוד לא ידועים (אישורים, אחריות אחרי 30 יום) - הכי פשוט להוסיף אותה לאתר; אחרת כתוב אותה במסמך ומחק אותה מרשימת ה-"Known unknowns" ב-`src/agent/systemPrompt.js`.

### עלויות צפויות (הערכה, יש לבדוק במחירונים העדכניים)
- **Claude API** (Sonnet 5.5: $2 למיליון טוקנים נכנסים, $10 ליוצאים, קריאה מהמטמון $0.20): ההנחיות + שני המסמכים הם בערך 15-20 אלף טוקנים, והם נשמרים במטמון. הטקסט מהאתר (מדיניות ושאלות נפוצות) מוסיף עוד, לפי האורך שלו - כנראה פי 1.5-2 בעלות הקלט. הודעה אחת עולה בערך 1-2 סנט, ושיחה של 5-6 הודעות בערך 5-15 סנט. 1,000 שיחות בחודש - בערך $50-150.
- **Meta**: תשובות בתוך 24 שעות מהודעת הלקוח (שיחת שירות) - חינם. תבניות Utility (למשל התראות אליך מחוץ לחלון) ו-Marketing (עגלות נטושות, לא פעיל) - בתשלום לפי הודעה לפי מחירון Meta לישראל.
- **Railway**: תוכנית Hobby בסביבות $5 לחודש כולל שימוש בסיסי; הבוט קטן ואמור להיכנס בזה או קצת מעל.

### פרטיות ושמירת מידע
- נשמר רק: מספר טלפון, טקסט של עד 20 ההודעות האחרונות בשיחה, ודגלים קטנים (מושתק / חסום / העברה פתוחה). אין שמירה של לקוחות בדיסק או במסד נתונים. בדיסק נשמר רק עותק של טקסט ציבורי מהאתר (`data/site-cache.json`).
- שיחה נמחקת אחרי 24 שעות בלי פעילות, וכל הזיכרון נמחק בכל ריסטארט / פריסה.
- הלוגים בפרודקשן (`NODE_ENV=production`) לא כוללים תוכן הודעות, ומספרי טלפון מוסתרים (`9725*****567`).
- ההתראות אליך בוואטסאפ כוללות את המספר המלא ואת ההודעה האחרונה של הלקוח, כדי שתוכל לחזור אליו.
- שופיפיי: קריאה בלבד, והבוט מעביר ל-Claude רק סטטוס ומספר מעקב (בלי שם, כתובת או סכום).
- המידע עובר לספקים: Meta (וואטסאפ), Anthropic (תוכן השיחה), Railway (אירוח). כדאי לציין זאת במדיניות הפרטיות באתר.

---

## English

### What it does
1. **Product questions** - answered only from the live-site text (see "Site sync"), `docs/PRODUCT_PAGE_FAQ.md` and `docs/SALES_GUIDE_KNOWLEDGE.md`, in short Hebrew WhatsApp messages. Where the site and docs/ disagree, the site wins.
2. **Order status** - read-only Shopify lookup by order number + phone. A phone mismatch looks exactly like "not found".
3. **Hand-off** - person requested, a stated wish to cancel / return / get a refund, complaint, medical red flag, or anything not covered: the customer is told the team will get back to them and the owner gets one WhatsApp alert per message.

Every reply is checked by `src/compliance.js` before sending (banned words, em/en dashes, prices against the synced site prices, discounts only as the computed bundle %, "עד הבית", unconditional refund promises, phone numbers / emails / policy links, reviews, certifications, length, Hebrew). A failing reply is rewritten once by the model; if it still fails, a safe "אבדוק ואחזור אליך" is sent and the owner is alerted.

### What the bot says (owner decisions, CHANGES_v1.1.md)
- Prices: always the current site prices (today 189 / 315 / 439 ₪).
- Bundle discount only as a %, vs. the same number of single units at the current single price, rounded down (today 16% / 22%). Never shekel savings, "regular price", "instead of X", compare-at prices, the site-wide sale banner, or the newsletter coupon (unless `NEWSLETTER_COUPON_ENABLED=true`).
- 2 devices or more include the digital guide "מדריך לנשימה חופשית".
- Shipping time: "בדרך כלל לוקח שבוע עד שבועיים"; on request for a commitment "אנחנו מתחייבים לאספקה עד חודש"; further details from the synced shipping policy.
- General refund questions: "יש 30 ימי ניסיון, וההחזרים לפי התנאים במדיניות ההחזרים באתר" - no link, no steps, no unconditional money-back promise. A customer who wants to return / cancel gets the steps from the synced refund policy (numbered, max 4, no link, the legal 14-day cancellation not hidden) and a hand-off.
- Never a phone number or a link to a policy page.

### After a hand-off
The bot stops answering that customer and forwards their new messages to the owner. If the owner hasn't replied: before `HANDOFF_QUIET_MINUTES` (default 120) nothing is sent; at/after it, one short reassurance naming what was handed off, then the quiet timer restarts, at most `HANDOFF_MAX_REASSURANCES_PER_DAY` (default 3) per Israeli calendar day. On Friday-Saturday (support days on the site are Sunday-Thursday) it says the team replies on the next working day. An owner `SEND` or `RESUME` clears the hand-off. Implementation: `src/handoffState.js`.

### Site sync
`src/siteSync.js` fetches, at startup and every `SITE_SYNC_HOURS` (default 6): `/products/avora-plus.js` (single price, cents), `/products/avora-plus` (bundle prices from the quantity-break block and the on-page FAQ) and the five `/policies/*` pages (`.shopify-policy__body`). Header, footer, newsletter popup, announcement/sale banners and crossed-out prices are removed, as are links, phone numbers and emails. The text goes into the system prompt as "אתר - מידע עדכני", after the rules and before docs/. Every part keeps its last good copy (memory + `SITE_CACHE_FILE`); a failed fetch only logs `site_sync_part_failed`. With no copy ever loaded, docs/ prices are used and price/policy questions are handed off. A price change sends the owner one "המחירים באתר השתנו: ..." alert.

### Architecture
```
Meta webhook -> src/server.js (verify token, X-Hub-Signature-256)
             -> src/router.js (dedupe, owner commands, block/pause, hand-off quiet mode, rate limit, red-flag detectors, per-customer queue)
             -> src/agent/agent.js (Claude + tools: lookup_order, handoff_to_human; compliance check + 1 rewrite)
                  -> src/shopify.js (GraphQL Admin API, read_orders)
             -> src/whatsapp.js (Graph API sender)   src/handoff.js (log + owner WhatsApp alert)
site:   src/siteSync.js (live prices / FAQ / policies, every 6h) -> src/pricing.js (bundle %) -> prompt + compliance
memory: src/memory/store.js (in-memory, swappable interface)
prepared, disabled: src/marketing/abandonedCart.js
```

### Local run
```bash
npm install
cp .env.example .env     # fill in values
npm test                 # all tests, no network
npm run dev              # http://localhost:3000  (set WHATSAPP_DRY_RUN=true to avoid real sends)
npm run conversations:live   # replay tests/conversations against the real Claude API (no WhatsApp)
```

### Environment variables
See the Hebrew table above and `.env.example`. Required: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `OWNER_WHATSAPP_NUMBER`, `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` (default `claude-sonnet-5-5`), `SHOPIFY_STORE`, `SHOPIFY_ACCESS_TOKEN`, `PORT`. Without `WHATSAPP_APP_SECRET` every webhook POST is rejected (fail closed). v1.1 adds `HANDOFF_QUIET_MINUTES` (120), `HANDOFF_MAX_REASSURANCES_PER_DAY` (3), `NEWSLETTER_COUPON_ENABLED` (false), and optional `SITE_URL`, `SITE_SYNC_HOURS`, `SITE_CACHE_FILE`.

### Meta WhatsApp Cloud API setup
1. Create / pick the Meta Business portfolio and start business verification.
2. developers.facebook.com > Create App > WhatsApp use case, linked to the portfolio.
3. WhatsApp > API Setup > add and verify the business phone number (it can't be active in the WhatsApp app at the same time unless you use Coexistence - not verified here). Set the display name.
4. Copy the Phone number ID and the App secret (App settings > Basic).
5. Permanent token: Business settings > System users > add an Admin system user > assign the app and the WhatsApp account > Generate token (expiry Never, `whatsapp_business_messaging` + `whatsapp_business_management`).
6. Deploy to Railway to get a public URL.
7. WhatsApp > Configuration > Webhook: callback `https://<domain>/webhook`, verify token = `WHATSAPP_VERIFY_TOKEN`, then subscribe to the `messages` field.
8. Add a payment method in WhatsApp Manager and switch the app to Live (needs a privacy policy URL).
9. Owner alerts: send `HELP` from the owner's phone to open the 24h window. For alerts outside it, create a Hebrew Utility template with one body variable and set `OWNER_NOTIFY_TEMPLATE`.

### Shopify token
Admin > Settings > Apps and sales channels > Develop apps > create app > Admin API scope `read_orders` only > install > copy the Admin API access token. Grant **protected customer data** access for the Phone field. If your store directs custom-app creation to Shopify's Dev Dashboard, create the app there with the same scope (not verified from here).

### Railway deploy
New Project > Deploy from GitHub repo. Builds from the `Dockerfile`, health check `/health` (`railway.json`). Add the variables plus `NODE_ENV=production`, generate a domain, keep **one replica** (memory is in-process). Every push to the default branch redeploys. Optionally mount a Railway volume at `/app/data` so the last good site copy survives redeploys.

### Updating the knowledge
Prices, policies and the product-page FAQ are changed **on the website**; the bot picks them up within 6 hours (or on restart) with no code change. For docs/: edit, run `npm test`, commit, push. When a known unknown (certifications, warranty after 30 days) gets an answer, put it on the site or in docs/ and remove it from the "Known unknowns" line in `src/agent/systemPrompt.js`.

### Expected costs (estimates - check current price lists)
- Claude (Sonnet 5.5, $2 / $10 per million input / output tokens, cache reads $0.20): the ~15-20K-token system prompt (plus the synced site text - probably 1.5-2x the input) is prompt-cached; ~1-2 cents per message, ~5-15 cents per conversation; ~$50-150 per 1,000 conversations.
- Meta: replies inside the 24h customer-service window are free; Utility templates (owner alerts outside the window) and Marketing templates (abandoned cart - disabled) are paid per message per Meta's Israel rate card.
- Railway: Hobby plan around $5/month including base usage.

### Privacy and data retention
Stored in memory only: phone number, text of the last 20 messages, small flags (paused / blocked / open hand-off). The only thing on disk is a copy of public website text (`data/site-cache.json`). A conversation is deleted after 24h without activity, and all memory is lost on restart/redeploy. Production logs contain no message bodies and masked phone numbers. Owner alerts contain the full number and the last customer message. Shopify access is read-only and only status + tracking reach the model. Data processors: Meta, Anthropic, Railway - mention them in the site's privacy policy.
