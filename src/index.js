// ─────────────────────────────────────────────
//  index.js — ShopBoss entry point
//  Paywall registered FIRST, before all commands
// ─────────────────────────────────────────────
require("dotenv").config();
const { Telegraf, session, Markup } = require("telegraf");
const express = require("express");
const crypto  = require("crypto");
const { init } = require("./db/database");

if (!process.env.BOT_TOKEN) {
  console.error("❌ BOT_TOKEN is not set.");
  process.exit(1);
}

init().then((dbHandles) => {
  // ── Wire payment service to DB ──
  const payment = require("./services/payment");
  payment.connectDB(dbHandles);

  const bot = new Telegraf(process.env.BOT_TOKEN);
  bot.use(session());

  // CRITICAL: guarantee ctx.session is always an object, never undefined
  bot.use(async (ctx, next) => {
    if (!ctx.session) ctx.session = {};
    return next();
  });

  // Drop non-user updates
  bot.use(async (ctx, next) => { if (!ctx.from) return; return next(); });

  // ── PAYWALL FIRST — before any command ──
  require("./commands/paywall").registerPaywall(bot);

  // ── Admin (owner only) ──
  require("./commands/admin").registerAdmin(bot);

  // ── All business commands ──
  require("./commands/core").registerCore(bot);
  require("./commands/sales").registerSales(bot);
  require("./commands/inventory").registerInventory(bot);
  require("./commands/operations").registerOperations(bot);
  require("./commands/analytics").registerAnalytics(bot);

  // ── /app — Mini App launcher ──
  bot.command("app", async (ctx) => {
    const url = `${process.env.WEBHOOK_URL || "http://localhost:" + (process.env.PORT || 3000)}/mini`;
    await ctx.reply(
      "📱 *Open ShopBoss Dashboard*\n\nTap below to open your full business dashboard:",
      { parse_mode: "Markdown", ...Markup.inlineKeyboard([[Markup.button.webApp("📊 Open ShopBoss App", url)]]) }
    );
  });

  // ── Global error handler ──
  bot.catch(async (err, ctx) => {
    console.error(`❌ COMMAND FAILED`);
    console.error(`   Type    : ${ctx.updateType}`);
    console.error(`   User    : ${ctx.from?.id} (@${ctx.from?.username})`);
    console.error(`   Message : ${ctx.message?.text || "(non-text)"}`);
    console.error(`   Error   : ${err.message}`);
    console.error(`   Stack   : ${err.stack}`);
    try { await ctx.reply("⚠️ Something went wrong. Please try again or use /start to reset."); } catch {}
  });

  // ── Fallback ──
  bot.on("text", async (ctx) => {
    await ctx.reply(
      "🤔 I didn't understand that.\n\nUse /menu for options or /app for the dashboard.",
      require("./utils/keyboards").mainMenu()
    );
  });

  // ── Express ──────────────────────────────────────────────
  const app = express();

  // Raw body needed for Flutterwave webhook signature verification
  app.use("/payment/webhook", express.raw({ type: "application/json" }));
  app.use(express.json());

  // Serve landing page and static assets from public/
  app.use(require("express").static(require("path").join(__dirname, "../public")));

  // ── Landing page payment link creation ──────────────────────
  app.post("/payment/create-link", async (req, res) => {
    try {
      const { name, email, phone, telegram_username } = req.body;
      if (!name || !email || !phone)
        return res.status(400).json({ error: "Name, email and phone are required" });

      const axios   = require("axios");
      const txRef   = `SB-WEB-${Date.now()}`;
      const PRICE   = 125000;
      const webhook = process.env.WEBHOOK_URL;

      // Save a placeholder record (no telegram_id yet — user hasn't started bot)
      // We use email as the key; on bot /start we match by email if needed
      const payload = {
        tx_ref:       txRef,
        amount:       PRICE,
        currency:     "NGN",
        redirect_url: webhook + "/payment/callback",
        customer:     { email, phonenumber: phone, name },
        customizations: {
          title:       "ShopBoss Lifetime Access",
          description: "One-time payment — lifetime access to ShopBoss",
        },
        payment_options: "card,banktransfer,ussd",
        meta: { source: "landing_page", telegram_username: telegram_username || "", name, email },
      };

      const r = await axios.post("https://api.flutterwave.com/v3/payments", payload, {
        headers: { Authorization: "Bearer " + process.env.FLW_SECRET_KEY },
      });

      if (r.data.status !== "success")
        return res.status(500).json({ error: r.data.message });

      res.json({ link: r.data.data.link, txRef });
    } catch(err) {
      console.error("Create link error:", err.message);
      res.status(500).json({ error: "Could not create payment link. Please try again." });
    }
  });

  // ── Flutterwave webhook (Telegram notifies users automatically) ──
  app.post("/payment/webhook", async (req, res) => {
    try {
      const secretHash = process.env.FLW_WEBHOOK_HASH;
      const signature  = req.headers["verif-hash"];

      // Verify webhook is genuinely from Flutterwave
      if (secretHash && signature !== secretHash) {
        console.warn("⚠️ Webhook signature mismatch — ignored");
        return res.status(401).send("Unauthorized");
      }

      const event = JSON.parse(req.body.toString());
      console.log("📥 Flutterwave webhook:", event.event || event["event.type"]);
      await payment.handleWebhookEvent(event, bot);
      res.status(200).send("OK");
    } catch (err) {
      console.error("Webhook error:", err.message);
      res.status(500).send("Error");
    }
  });

  // ── Payment callback (after Flutterwave redirect) ────────
  app.get("/payment/callback", async (req, res) => {
    const { tx_ref, transaction_id, status } = req.query;
    if (!tx_ref) return res.redirect("/payment/failed.html");

    try {
      const tx = await payment.verifyPayment(tx_ref);
      if (tx && tx.status === "successful" && tx.amount >= payment.PRICE) {
        await payment.handleWebhookEvent(
          { event: "charge.completed", data: { tx_ref, id: tx.flwTxId, ...tx } },
          bot
        );
        res.redirect("/payment/success.html");
      } else {
        res.redirect("/payment/pending.html");
      }
    } catch (err) {
      console.error("Callback error:", err.message);
      res.redirect("/payment/pending.html");
    }
  });

  // ── Static payment result pages ──
  app.get("/payment/success.html", (req, res) => {
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Payment Successful</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0f1117;color:#e8eaf0;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}.card{background:#181c27;border:1px solid #2a3045;border-radius:16px;padding:40px;text-align:center;max-width:360px;width:100%}h1{font-size:48px;margin-bottom:16px}h2{color:#22c55e;font-size:22px;margin-bottom:12px}p{color:#7a8099;line-height:1.6;margin-bottom:20px}a{color:#f5c518;text-decoration:none;font-weight:700}</style></head>
    <body><div class="card"><h1>🎉</h1><h2>Payment Successful!</h2>
    <p>Your ShopBoss lifetime access is now active. Return to Telegram to start managing your business.</p>
    <a href="https://t.me/${process.env.BOT_USERNAME || 'ShopBossBot'}">← Open ShopBoss in Telegram</a></div></body></html>`);
  });

  app.get("/payment/pending.html", (req, res) => {
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Payment Pending</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0f1117;color:#e8eaf0;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}.card{background:#181c27;border:1px solid #2a3045;border-radius:16px;padding:40px;text-align:center;max-width:360px;width:100%}h1{font-size:48px;margin-bottom:16px}h2{color:#f59e0b;font-size:22px;margin-bottom:12px}p{color:#7a8099;line-height:1.6;margin-bottom:20px}a{color:#f5c518;text-decoration:none;font-weight:700}</style></head>
    <body><div class="card"><h1>⏳</h1><h2>Payment Processing</h2>
    <p>Your payment is being verified. Return to Telegram and tap "Check my status" — it usually activates within 30 seconds.</p>
    <a href="https://t.me/${process.env.BOT_USERNAME || 'ShopBossBot'}">← Return to Telegram</a></div></body></html>`);
  });

  app.get("/payment/failed.html", (req, res) => {
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Payment Failed</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0f1117;color:#e8eaf0;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}.card{background:#181c27;border:1px solid #2a3045;border-radius:16px;padding:40px;text-align:center;max-width:360px;width:100%}h1{font-size:48px;margin-bottom:16px}h2{color:#ef4444;font-size:22px;margin-bottom:12px}p{color:#7a8099;line-height:1.6;margin-bottom:20px}a{color:#f5c518;text-decoration:none;font-weight:700}</style></head>
    <body><div class="card"><h1>❌</h1><h2>Payment Failed</h2>
    <p>Something went wrong with your payment. Please return to Telegram and try again with /pay.</p>
    <a href="https://t.me/${process.env.BOT_USERNAME || 'ShopBossBot'}">← Return to Telegram</a></div></body></html>`);
  });

  // ── Mini App ──
  app.use("/mini", require("./services/miniapp"));

  const PORT = process.env.PORT || 3000;
  const WEBHOOK_URL = process.env.WEBHOOK_URL;

  if (WEBHOOK_URL) {
    app.use(bot.webhookCallback("/webhook"));
    bot.telegram.setWebhook(`${WEBHOOK_URL}/webhook`).then(() =>
      console.log(`🌐 Webhook: ${WEBHOOK_URL}/webhook`)
    );
  } else {
    bot.launch();
    console.log("🤖 ShopBoss running (polling mode)");
  }

  // Landing page served statically from public/ — this is a fallback only
  app.get("/api/status", (req, res) => res.json({ status: "ok", bot: "ShopBoss" }));
  app.get("/health", (req, res) => res.json({ status: "ok" }));

  // ── Flutterwave status check — visit this URL to confirm FLW is connected ──
  app.get("/payment/status", async (req, res) => {
    const adminId = process.env.ADMIN_TELEGRAM_ID;
    const key     = req.query.key;
    // Simple key check — pass ?key=YOUR_ADMIN_TG_ID in the URL
    if (!adminId || key !== adminId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const hasSecret = !!process.env.FLW_SECRET_KEY;
    const hasPublic = !!process.env.FLW_PUBLIC_KEY;
    const hasHash   = !!process.env.FLW_WEBHOOK_HASH;
    const webhookUrl = process.env.WEBHOOK_URL
      ? process.env.WEBHOOK_URL + "/payment/webhook"
      : "NOT SET";

    let flwConnected = false;
    let flwError = null;
    if (hasSecret) {
      try {
        const axios = require("axios");
        const r = await axios.get("https://api.flutterwave.com/v3/transactions?page=1&per_page=1", {
          headers: { Authorization: "Bearer " + process.env.FLW_SECRET_KEY },
          timeout: 5000,
        });
        flwConnected = r.data.status === "success";
      } catch(e) {
        flwError = e.response?.data?.message || e.message;
      }
    }

    const { getStats } = require("./services/payment");
    const stats = getStats();

    res.json({
      flutterwave: {
        secret_key_set:  hasSecret,
        public_key_set:  hasPublic,
        webhook_hash_set: hasHash,
        webhook_url:     webhookUrl,
        api_connected:   flwConnected,
        api_error:       flwError,
      },
      license_stats: stats,
    });
  });
  app.listen(PORT, () => {
    console.log(`🚀 Server on port ${PORT}`);
    console.log(`💳 Payment webhook: ${WEBHOOK_URL}/payment/webhook`);
  });

  try { require("./services/jobs").startJobs(bot); } catch (e) { console.warn("Jobs skipped:", e.message); }

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));

}).catch((err) => {
  console.error("❌ Failed to start ShopBoss:", err.message);
  console.error(err.stack);
  process.exit(1);
});
