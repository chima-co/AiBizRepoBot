# 🤖 ShopBoss — AI Business Manager Telegram Bot

ShopBoss is a fully-featured AI-powered business management bot for Nigerian small business owners. It runs entirely on Telegram — no app downloads needed.

---

## ✨ What ShopBoss Does

| Module | Commands |
|---|---|
| 📊 Dashboard | `/dashboard` `/today` `/summary` |
| 💰 Sales | `/sale` `/sales` `/revenue` `/profit` |
| 📦 Inventory | `/inventory` `/product` `/stockin` `/stockout` `/lowstock` `/reorder` |
| 💸 Expenses | `/expense` `/expenses` |
| 🚚 Orders & Delivery | `/orders` `/order` `/delivery` `/track` |
| 👥 Staff | `/staff` `/addstaff` |
| 💰 Payroll | `/payroll` |
| 🤝 Suppliers | `/suppliers` `/addsupplier` |
| 📈 Analytics | `/analytics` `/insights` `/alerts` |
| 🤖 AI Assistant | `/ask` `/advice` `/insights` |
| ⚙️ Settings | `/settings` `/setname` |

---

## 🚀 STEP-BY-STEP SETUP

### Step 1 — Create Your Bot on Telegram

1. Open Telegram and search for **@BotFather**
2. Send `/newbot`
3. Enter a name: e.g. `ShopBoss`
4. Enter a username: e.g. `myshopboss_bot` (must end in `bot`)
5. Copy the **BOT_TOKEN** it gives you

### Step 2 — Get an Anthropic API Key (for AI features)

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Sign up / log in
3. Go to **API Keys** → Create a new key
4. Copy the key (starts with `sk-ant-...`)

### Step 3 — Deploy on Railway (Free)

1. Go to [railway.app](https://railway.app) and sign up with GitHub
2. Click **"New Project"** → **"Deploy from GitHub repo"**
3. Upload or push this folder to a GitHub repo and connect it
4. In Railway dashboard → **Variables** tab, add:

```
BOT_TOKEN         = your_telegram_token
ANTHROPIC_API_KEY = sk-ant-your_key
WEBHOOK_URL       = https://your-project.up.railway.app
```

5. Railway auto-deploys. Your bot goes live! 🎉

> 💡 Find your URL in Railway → **Settings → Domains** tab

### Step 4 — Test Your Bot

Open Telegram, search for your bot username, and send `/start`

---

## 🗂️ Project Structure

```
shopboss/
├── src/
│   ├── index.js              ← Entry point
│   ├── db/
│   │   └── database.js       ← All database logic (sql.js)
│   ├── commands/
│   │   ├── core.js           ← /start /help /menu /dashboard
│   │   ├── sales.js          ← /sale /sales /revenue /profit
│   │   ├── inventory.js      ← /inventory /product /stockin etc
│   │   ├── operations.js     ← Expenses, Orders, Staff, Payroll, Suppliers
│   │   └── analytics.js      ← /analytics /ask /insights /alerts
│   ├── services/
│   │   ├── ai.js             ← Claude AI integration
│   │   └── jobs.js           ← Scheduled alerts & summaries
│   └── utils/
│       ├── helpers.js        ← Formatting, session utilities
│       └── keyboards.js      ← Telegram keyboard layouts
├── data/                     ← SQLite DB (auto-created, not in git)
├── .env.example              ← Environment variable template
├── package.json
├── railway.toml              ← Railway deployment config
└── render.yaml               ← Render deployment config
```

---

## 🔧 Environment Variables

| Variable | Required | Description |
|---|---|---|
| `BOT_TOKEN` | ✅ Yes | From @BotFather |
| `ANTHROPIC_API_KEY` | ✅ For AI | From console.anthropic.com |
| `WEBHOOK_URL` | ✅ Production | Your Railway/Render URL |
| `PORT` | Auto | Set by Railway/Render |
| `REDIS_URL` | Optional | For persistent sessions |

---

## 💰 MONETIZATION IDEAS

See the Monetization section below for a full business model.

---

## 🔒 Security Features

- Every database query is scoped to the user's own business
- No user can access another user's data
- Stack traces never exposed to users
- API keys stored only in environment variables
- Input validation on all user entries
