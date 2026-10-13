# Avora+ WhatsApp Bot

בוט שירות לקוחות בוואטסאפ לאבורה+, בעברית, 24/7. / A Hebrew WhatsApp customer-service bot for Avora+.

- [עברית](#עברית)
- [English](#english)

---

## עברית

### מה הבוט עושה
1. **שאלות על המוצר** - עונה רק מתוך `docs/PRODUCT_PAGE_FAQ.md` ו-`docs/SALES_GUIDE_KNOWLEDGE.md`, בהודעות קצרות.
2. **סטטוס הזמנה** - מחפש בשופיפיי לפי מספר הזמנה + מספר הטלפון (קריאה בלבד). אם הטלפון לא תואם, הלקוח מקבל "לא מצאנו".
3. **העברה לנציג** - כשהלקוח מבקש אדם, ביטול / החזרה / החזר כספי, תלונה, דגל אדום רפואי, או כל שאלה שאין לה תשובה במסמכים. הלקוח מקבל "הצוות יחזור אליך", ואתה מקבל הודעת וואטסאפ עם המספר, הסיבה וההודעה האחרונה.

כל תשובה עוברת בדיקה אוטומטית לפני שליחה (מילים אסורות, מקף ארוך, מחירים, "עד הבית", אורך). תשובה שנכשלת נכתבת מחדש פעם אחת, ואם גם היא נכשלת - נשלח "אבדוק ואחזור אליך" ואתה מקבל התראה.

### פקודות מנהל (שולחים מהמספר שב-`OWNER_WHATSAPP_NUMBER` למספר של הבוט)
| פקודה | מה זה עושה |
|---|---|
| `SEND 0501234567 טקסט` | שולח ללקוח את הטקסט בשם העסק, ומשתיק את הבוט ללקוח הזה ל-12 שעות. הודעות הלקוח בזמן הזה מועברות אליך. |
| `PAUSE 0501234567` / `RESUME 0501234567` | משתיק / מחזיר את הבוט ללקוח |
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

### עדכון קבצי הידע
- עורכים את `docs/PRODUCT_PAGE_FAQ.md` או `docs/SALES_GUIDE_KNOWLEDGE.md`, מריצים `npm test`, עושים commit ו-push. ריילווי מפרס, והבוט קורא את הקבצים מחדש בעלייה.
- כשתהיה תשובה לאחד מ"הדברים שעוד צריך לבדוק" (זמן משלוח, אישורים, תהליך החזרה, אחריות, שעות שירות) - כתוב אותה במסמך, ומחק אותה מרשימת ה-"Known unknowns" ב-`src/agent/systemPrompt.js`.
- אם המחירים משתנים - עדכן גם את `ALLOWED_PRICES` ב-`src/compliance.js` ואת המחירים ב-`src/agent/systemPrompt.js`, אחרת הבדיקה תחסום את המחיר החדש.

### עלויות צפויות (הערכה, יש לבדוק במחירונים העדכניים)
- **Claude API** (Sonnet 5.5: $2 למיליון טוקנים נכנסים, $10 ליוצאים, קריאה מהמטמון $0.20): ההנחיות + שני המסמכים הם בערך 15-20 אלף טוקנים, והם נשמרים במטמון. הודעה אחת עולה בערך 1-2 סנט, ושיחה של 5-6 הודעות בערך 5-15 סנט. 1,000 שיחות בחודש - בערך $50-150.
- **Meta**: תשובות בתוך 24 שעות מהודעת הלקוח (שיחת שירות) - חינם. תבניות Utility (למשל התראות אליך מחוץ לחלון) ו-Marketing (עגלות נטושות, לא פעיל) - בתשלום לפי הודעה לפי מחירון Meta לישראל.
- **Railway**: תוכנית Hobby בסביבות $5 לחודש כולל שימוש בסיסי; הבוט קטן ואמור להיכנס בזה או קצת מעל.

### פרטיות ושמירת מידע
- נשמר רק: מספר טלפון, טקסט של עד 20 ההודעות האחרונות בשיחה, ודגלים קטנים (מושתק / חסום). אין שמירה בדיסק או במסד נתונים.
- שיחה נמחקת אחרי 24 שעות בלי פעילות, וכל הזיכרון נמחק בכל ריסטארט / פריסה.
- הלוגים בפרודקשן (`NODE_ENV=production`) לא כוללים תוכן הודעות, ומספרי טלפון מוסתרים (`9725*****567`).
- ההתראות אליך בוואטסאפ כוללות את המספר המלא ואת ההודעה האחרונה של הלקוח, כדי שתוכל לחזור אליו.
- שופיפיי: קריאה בלבד, והבוט מעביר ל-Claude רק סטטוס ומספר מעקב (בלי שם, כתובת או סכום).
- המידע עובר לספקים: Meta (וואטסאפ), Anthropic (תוכן השיחה), Railway (אירוח). כדאי לציין זאת במדיניות הפרטיות באתר.

---

## English

### What it does
1. **Product questions** - answered only from `docs/PRODUCT_PAGE_FAQ.md` and `docs/SALES_GUIDE_KNOWLEDGE.md`, in short Hebrew WhatsApp messages.
2. **Order status** - read-only Shopify lookup by order number + phone. A phone mismatch looks exactly like "not found".
3. **Hand-off** - person requested, cancel / return / refund, complaint, medical red flag, or anything not in the docs: the customer is told the team will get back to them and the owner gets a WhatsApp alert.

Every reply is checked by `src/compliance.js` before sending (banned words, em/en dashes, prices, "עד הבית", reviews, certifications, length, Hebrew). A failing reply is rewritten once by the model; if it still fails, a safe "אבדוק ואחזור אליך" is sent and the owner is alerted.

### Architecture
```
Meta webhook -> src/server.js (verify token, X-Hub-Signature-256)
             -> src/router.js (dedupe, owner commands, block/pause, rate limit, red-flag detectors, per-customer queue)
             -> src/agent/agent.js (Claude + tools: lookup_order, handoff_to_human; compliance check + 1 rewrite)
                  -> src/shopify.js (GraphQL Admin API, read_orders)
             -> src/whatsapp.js (Graph API sender)   src/handoff.js (log + owner WhatsApp alert)
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
See the Hebrew table above and `.env.example`. Required: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `OWNER_WHATSAPP_NUMBER`, `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` (default `claude-sonnet-5-5`), `SHOPIFY_STORE`, `SHOPIFY_ACCESS_TOKEN`, `PORT`. Without `WHATSAPP_APP_SECRET` every webhook POST is rejected (fail closed).

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
New Project > Deploy from GitHub repo. Builds from the `Dockerfile`, health check `/health` (`railway.json`). Add the variables plus `NODE_ENV=production`, generate a domain, keep **one replica** (memory is in-process). Every push to the default branch redeploys.

### Updating the knowledge
Edit the files in `docs/`, run `npm test`, commit, push. When a known unknown gets an answer, add it to the docs and remove it from the "Known unknowns" line in `src/agent/systemPrompt.js`. If prices change, also update `ALLOWED_PRICES` in `src/compliance.js` and the prices in the system prompt.

### Expected costs (estimates - check current price lists)
- Claude (Sonnet 5.5, $2 / $10 per million input / output tokens, cache reads $0.20): the ~15-20K-token system prompt is prompt-cached; ~1-2 cents per message, ~5-15 cents per conversation; ~$50-150 per 1,000 conversations.
- Meta: replies inside the 24h customer-service window are free; Utility templates (owner alerts outside the window) and Marketing templates (abandoned cart - disabled) are paid per message per Meta's Israel rate card.
- Railway: Hobby plan around $5/month including base usage.

### Privacy and data retention
Stored in memory only: phone number, text of the last 20 messages, small flags. A conversation is deleted after 24h without activity, and all memory is lost on restart/redeploy. Production logs contain no message bodies and masked phone numbers. Owner alerts contain the full number and the last customer message. Shopify access is read-only and only status + tracking reach the model. Data processors: Meta, Anthropic, Railway - mention them in the site's privacy policy.
