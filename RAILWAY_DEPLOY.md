# ShopBoss — Railway Deployment Guide
## Read this completely before deploying

---

## Why the bot was crashing — 6 bugs, all fixed

| # | Bug | Effect | Fixed |
|---|-----|--------|-------|
| 1 | `db.init;` was a no-op (property access, not a call) | DB schema silently never ran | ✅ Removed |
| 2 | `setWebhook()` fired before `app.listen()` | Telegram connected before server was ready → crash | ✅ `listen` now runs first |
| 3 | No `uncaughtException` handler | Any sync error killed Railway process silently | ✅ Handler added |
| 4 | No `unhandledRejection` handler | Any rejected Promise killed Railway silently | ✅ Handler added |
| 5 | In-memory sessions | Every deploy wiped all user flows mid-sale | ✅ File-based sessions |
| 6 | WEBHOOK_URL trailing slash | Telegram rejected webhook registration silently | ✅ Auto-stripped |

---

## Step-by-step Railway setup

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "Initial ShopBoss deploy"
git remote add origin https://github.com/YOUR_USERNAME/shopboss.git
git push -u origin main
```

### 2. Create Railway project
- Go to railway.app → New Project → Deploy from GitHub
- Select your shopboss repo
- Railway will auto-detect Node.js and run `npm install && node src/index.js`

### 3. Add a Volume (CRITICAL — without this your database resets on every deploy)
- In Railway → your service → Volumes tab
- Click "Add Volume"
- Mount path: `/data`
- Size: 1 GB (free tier gives you this)

### 4. Set environment variables
In Railway → your service → Variables tab, add ALL of these:

```
BOT_TOKEN=          ← from @BotFather on Telegram
BOT_USERNAME=       AiBizRepoBot
ADMIN_TELEGRAM_ID=  ← your Telegram ID from @userinfobot
WEBHOOK_URL=        https://YOUR-APP.up.railway.app   ← NO trailing slash
ANTHROPIC_API_KEY=  sk-ant-...   ← from console.anthropic.com
FLW_SECRET_KEY=     FLWSECK-...  ← from dashboard.flutterwave.com
FLW_PUBLIC_KEY=     FLWPUBK-...  ← from dashboard.flutterwave.com
FLW_WEBHOOK_HASH=   ← random string, set same in Flutterwave webhook settings
```

> ⚠️ WEBHOOK_URL must be `https://` — no trailing slash, no `/webhook` at the end.
> Railway auto-sets PORT — do NOT set it yourself.

### 5. Set Flutterwave webhook
In Flutterwave dashboard → Settings → Webhooks:
- URL: `https://YOUR-APP.up.railway.app/payment/webhook`
- Secret hash: same value as FLW_WEBHOOK_HASH above

### 6. Register bot commands in BotFather
- Open @BotFather → /setcommands → select @AiBizRepoBot
- Paste the full block from COMMANDS.md

### 7. Register Mini App in BotFather
- /newapp → select @AiBizRepoBot
- App URL: `https://YOUR-APP.up.railway.app/mini`

---

## After deploy — how to confirm it's working

1. Check Railway logs — you should see:
```
╔══════════════════════════════════════════╗
║         ShopBoss Bot Starting            ║
╚══════════════════════════════════════════╝
  BOT_TOKEN     : ✅ set
  WEBHOOK_URL   : https://your-app.up.railway.app
  ...
✅ Database ready
🚀 Server listening on port XXXX
🌐 Webhook registered: https://your-app.up.railway.app/webhook
```

2. Hit the health endpoint in your browser:
   `https://YOUR-APP.up.railway.app/health`
   → Should return `{"status":"ok","uptime_seconds":...}`

3. Open Telegram → @AiBizRepoBot → send `/start`
   → Should get the welcome message within 2 seconds

---

## Common errors and fixes

**Bot doesn't respond after deploy**
→ Check WEBHOOK_URL in Railway Variables — must match your Railway domain exactly
→ Go to `https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo` — check `last_error_message`

**"Database not initialised" error in logs**
→ You didn't mount the Volume. Go to Railway → Volumes → Add Volume at `/data`

**Sessions reset after every deploy**
→ Install `telegraf-session-local` (already in package.json) — sessions file is in `/data/sessions.json`

**Payment webhook not firing**
→ Flutterwave webhook URL must be `https://YOUR-APP.up.railway.app/payment/webhook`
→ FLW_WEBHOOK_HASH must match exactly what you put in Flutterwave dashboard

**AI not working**
→ ANTHROPIC_API_KEY not set — add it in Railway Variables

---

## Local development
```bash
cp .env.example .env
# Fill in .env with your values (leave WEBHOOK_URL blank for polling mode)
npm install
npm start
```
