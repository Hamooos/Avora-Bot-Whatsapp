# WhatsApp Business Bot Guide - Node.js/Express

## Architecture Overview

A WhatsApp customer support bot using:
- **Node.js/Express** server
- **Meta WhatsApp Business API** (Cloud API)
- **Claude AI** (Anthropic SDK) for conversation intelligence
- **Shopify API** for order lookup
- Hosted on **Railway** (auto-deploys from GitHub)

---

## Components

### 1. server.js - Express Server
```javascript
// Express server with Meta WhatsApp webhook
// GET /webhook - verification endpoint (Meta sends verify token)
// POST /webhook - incoming message handler

const express = require('express');
const app = express();
app.use(express.json());

// Webhook verification
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  
  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Incoming messages
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Respond immediately to Meta
  
  const entry = req.body.entry?.[0];
  const change = entry?.changes?.[0];
  const message = change?.value?.messages?.[0];
  
  if (message) {
    await handleMessage(message);
  }
});

app.listen(process.env.PORT || 3000);
```

### 2. agent.js - AI Agent Class
```javascript
// RavenAgent class (rename for your brand)
// Uses @anthropic-ai/sdk
// Maintains conversation history per phone number
// System prompt contains: product FAQ, pricing, shipping, returns, policies

const Anthropic = require('@anthropic-ai/sdk');

class SupportAgent {
  constructor() {
    this.client = new Anthropic();
    this.conversations = new Map(); // phone -> message history
  }
  
  async chat(phone, userMessage) {
    // Get or create conversation history
    if (!this.conversations.has(phone)) {
      this.conversations.set(phone, []);
    }
    const history = this.conversations.get(phone);
    
    history.push({ role: 'user', content: userMessage });
    
    // Retry logic (3 attempts, 3s delay)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await this.client.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          system: SYSTEM_PROMPT,  // Product knowledge, FAQ, policies
          messages: history
        });
        
        const reply = response.content[0].text;
        history.push({ role: 'assistant', content: reply });
        return reply;
      } catch (e) {
        if (attempt < 2) await new Promise(r => setTimeout(r, 3000));
        else throw e;
      }
    }
  }
}
```

### 3. whatsapp.js - Message Handler & Sender
```javascript
// Handles: text messages, button replies, image messages
// Sends: text, buttons, templates via Meta Graph API

const https = require('https');

async function sendWhatsAppMessage(phone, text) {
  const data = JSON.stringify({
    messaging_product: 'whatsapp',
    to: phone,
    type: 'text',
    text: { body: text }
  });
  
  const options = {
    hostname: 'graph.facebook.com',
    path: `/v21.0/${process.env.WHATSAPP_PHONE_ID}/messages`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`
    }
  };
  
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.write(data);
    req.end();
  });
}

// Send template message (for abandoned cart recovery, etc.)
async function sendTemplate(phone, templateName, parameters) {
  const data = JSON.stringify({
    messaging_product: 'whatsapp',
    to: phone,
    type: 'template',
    template: {
      name: templateName,
      language: { code: 'he' },  // or 'ru', 'ar', etc.
      components: parameters
    }
  });
  // ... same request pattern
}
```

### 4. shopify.js - Order Lookup
```javascript
// Shopify REST API for order lookup and creation

async function lookupOrder(query) {
  // Search by email, phone, or order number
  const url = `https://${process.env.SHOPIFY_STORE}/admin/api/2024-01/orders.json?status=any&fields=id,name,email,phone,financial_status,fulfillment_status,created_at,total_price&${query}`;
  
  const options = {
    headers: {
      'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN
    }
  };
  // ... fetch and return
}
```

---

## Bot Behavior Rules (CRITICAL - Learned from Production)

### 1. Don't add info that wasn't asked
If customer asks "how does it work?" - answer ONLY that. Don't volunteer shipping info, return policy, etc.
**Why:** Sounds robotic, wastes tokens.

### 2. Use FAQ answers word-for-word
Don't rephrase FAQ answers. The wording was carefully chosen.
**Why:** Rewriting changes meaning and sounds less natural.

### 3. Don't end every message with "Any other questions?"
Extremely robotic. Only ask occasionally, maybe 1 in 5 messages.

### 4. Don't mention negative policies proactively
Don't mention pickup deadlines, return limitations, or fees unless the customer specifically asks or it's relevant to their situation.
**Why:** Scares customers away before they even order.

### 5. Don't count business days for customers
Never say "X business days have passed." Just say there are delays and the package is on its way.
**Why:** Encourages cancellations.

### 6. NEVER offer cancellation
Never ask "do you want to cancel?" or "prefer to wait or cancel?"
**Why:** Invites cancellation. Let the customer bring it up.

### 7. Don't escalate normal complaints
"I paid and didn't receive" is a factual complaint, not aggression. Only escalate if customer curses, threatens, or demands a manager 3+ times.

### 8. Email is secondary
Only share support email if customer specifically asks. Primary support = WhatsApp.

### 9. Payment methods
Know the difference between cash and bank transfer. They are NOT the same.

### 10. Blocked users
Implement BLOCK/UNBLOCK commands for admin to manage abusive users.

---

## Abandoned Cart Recovery

### Architecture
- Hourly job checks for abandoned carts via Shopify API
- Sends WhatsApp template message to customers who:
  - Added to cart but didn't purchase
  - Haven't been contacted before (track in `sent_carts.json`)
  - Left a phone number

### Template Messages
- Must be pre-approved by Meta (24-72 hour approval process)
- Create separate templates per language
- Templates support parameters (customer name, product name, etc.)

### Important Notes
- `sent_carts.json` on hosting platform is separate from local
- Each environment has its own tracking file
- Can't update via git if in `.gitignore`

---

## Hosting on Railway

### Setup
- Connect GitHub repo -> Railway auto-deploys on push
- Set all environment variables in Railway dashboard
- Free tier: sleeps after inactivity (9+ minute cold start)
- Paid plan ($5/month): always running, recommended for production

### Deployment Workflow
1. Make code changes locally
2. `git add` + `git commit` + `git push`
3. Railway auto-deploys (no manual action needed)

### Health Check
Add a health check endpoint to prevent sleep:
```javascript
app.get('/health', (req, res) => res.status(200).send('OK'));
```
Set up an external ping service to hit `/health` every 5 minutes.

---

## Environment Variables Needed

```
# WhatsApp
WHATSAPP_TOKEN=your_whatsapp_token
WHATSAPP_PHONE_ID=your_phone_number_id
WEBHOOK_VERIFY_TOKEN=your_custom_verify_string

# AI
ANTHROPIC_API_KEY=your_claude_api_key

# Shopify
SHOPIFY_STORE=your-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=your_shopify_token

# App
PORT=3000
ADMIN_PHONE=your_admin_phone_number
```

---

## Retry & Error Handling

- **Anthropic API:** 3 attempts, 3 second delay between retries
- **WhatsApp send:** Log failures but don't crash
- **Shopify lookup:** Handle 404 (order not found) gracefully
- Log all errors to console with timestamp for Railway logs
