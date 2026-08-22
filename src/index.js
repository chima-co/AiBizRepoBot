// ─────────────────────────────────────────────────────────────────────────────
//  index.js — ShopBoss entry point
// ─────────────────────────────────────────────────────────────────────────────
"use strict";
require("dotenv").config();

// ── 1. Validate required env vars immediately ─────────────────────────────────
if (!process.env.BOT_TOKEN) {
  console.error("❌ BOT_TOKEN missing. Set it in Railway → Variables.");
  process.exit(1);
}

// ── 2. Global error guards — MUST be first, before any async code ─────────────
process.on("uncaughtException", (err) => {
  console.error("💥 uncaughtException:", err.message);
  console.error(err.stack);
  // Do NOT exit — keep Railway deployment alive
});

process.on("unhandledRejection", (reason) => {
  console.error("💥 unhandledRejection:", reason);
  // Do NOT exit
});

// ── 3. Imports ────────────────────────────────────────────────────────────────
const { Telegraf, session, Markup } = require("telegraf");
const express  = require("express");
const path     = require("path");
const crypto   = require("crypto");
const { init, getDbPath } = require("./db/database");

// ── 4. Startup diagnostic (printed immediately — visible if we crash below) ────
console.log("╔══════════════════════════════════════════╗");
console.log("║         ShopBoss Starting                ║");
console.log("╚══════════════════════════════════════════╝");
console.log("  BOT_TOKEN     :", process.env.BOT_TOKEN      ? "✅ set" : "❌ MISSING");
console.log("  WEBHOOK_URL   :", process.env.WEBHOOK_URL    || "(none → polling mode)");
console.log("  ADMIN_TG_ID   :", process.env.ADMIN_TELEGRAM_ID || "⚠️  not set");
console.log("  ANTHROPIC_KEY :", process.env.ANTHROPIC_API_KEY ? "✅ set" : "⚠️  not set");
console.log("  FLW_SECRET    :", process.env.FLW_SECRET_KEY  ? "✅ set" : "⚠️  not set");
console.log("  PORT          :", process.env.PORT || "3000");

// ── 5. Boot ───────────────────────────────────────────────────────────────────
init().then(async (dbHandles) => {

  const db = require("./db/database");
  require("./services/payment").connectDB(dbHandles);
  console.log("✅ DB ready at", getDbPath());

  // ── Session middleware ────────────────────────────────────────────────────
  let sessionMiddleware;
  try {
    const LocalSession = require("telegraf-session-local/lib/session");
    const sessPath     = path.join(path.dirname(getDbPath()), "sessions.json");
    sessionMiddleware  = new LocalSession({ database: sessPath }).middleware();
    console.log("✅ Sessions: file-based at", sessPath);
  } catch (e) {
    console.warn("⚠️  Sessions: in-memory (telegraf-session-local issue:", e.message, ")");
    sessionMiddleware = session();
  }

  // ── Bot setup ─────────────────────────────────────────────────────────────
  const bot = new Telegraf(process.env.BOT_TOKEN);
  global._shopboss_bot = bot;

  bot.use(sessionMiddleware);
  bot.use((ctx, next) => { if (!ctx.session) ctx.session = {}; return next(); });
  bot.use((ctx, next) => { if (!ctx.from) return; return next(); });

  // Register command modules — ORDER MATTERS (paywall must be first)
  require("./commands/paywall").registerPaywall(bot);
  require("./commands/auth").registerAuth(bot);
  require("./commands/admin").registerAdmin(bot);
  require("./commands/core").registerCore(bot);
  require("./commands/sales").registerSales(bot);
  require("./commands/inventory").registerInventory(bot);
  require("./commands/operations").registerOperations(bot);
  require("./commands/analytics").registerAnalytics(bot);

  // Mini App launcher
  bot.command("app", async (ctx) => {
    const base = (process.env.WEBHOOK_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, "");
    await ctx.reply("📱 *ShopBoss Dashboard*\n\nYour full business dashboard:", {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.webApp("📊 Open Dashboard", `${base}/mini`)],
        [Markup.button.url("🌐 Open in Browser", `${base}/mini`)],
      ]),
    });
  });

  // Global bot error handler
  bot.catch(async (err, ctx) => {
    console.error(`❌ Bot error [${ctx.updateType}] user=${ctx.from?.id} msg="${ctx.message?.text || "?"}": ${err.message}`);
    try { await ctx.reply("⚠️ Something went wrong. Type /start to reset or /support for help."); } catch (_) {}
  });

  // Fallback for unrecognised text — MUST be registered AFTER all commands and analytics
  bot.on("text", async (ctx) => {
    if (ctx.session?.aiChat) return; // analytics module will handle this
    const { mainMenu } = require("./utils/keyboards");
    await ctx.reply(
      "🤔 I don't recognise that.\n\nTry:\n/help — all commands\n/menu — keyboard\n/ask — ask the AI",
      mainMenu()
    );
  });

  // ── Express app ───────────────────────────────────────────────────────────
  const app = express();

  // Raw body for Flutterwave webhook (must be before express.json())
  app.use("/payment/webhook", express.raw({ type: "application/json" }));
  app.use(express.json());
  app.use(express.static(path.join(__dirname, "../public")));

  // Health endpoint — Railway pings this to confirm alive
  app.get("/health", (_req, res) => res.json({
    status: "ok",
    uptime: Math.floor(process.uptime()),
    ts: new Date().toISOString(),
  }));

  // ── Admin ─────────────────────────────────────────────────────────────────
  function isAdmin(req, res) {
    const key = req.query.key || req.body?.key;
    if (!key || key !== process.env.ADMIN_TELEGRAM_ID) {
      res.status(403).json({ error: "Forbidden" });
      return false;
    }
    return true;
  }

  app.get("/admin", (req, res) => {
    const key = req.query.key || "";
    if (!key || key !== process.env.ADMIN_TELEGRAM_ID)
      return res.status(403).send(adminLoginPage());
    const stats    = db.Signups.count();
    const signups  = db.Signups.list(500);
    const vendors  = db.Vendors.list("All", 500);
    const licStats = require("./services/payment").getStats();
    res.send(adminDashboard(stats, signups, vendors, licStats, key));
  });

  app.get("/admin/export", (req, res) => {
    if (!isAdmin(req, res)) return;
    const rows = db.Signups.list(100000)
      .map(s => [s.id, s.name, s.business_name || "", s.email, s.phone || "", s.industry || "", s.plan, s.created_at]
        .map(v => `"${String(v || "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="shopboss-${Date.now()}.csv"`);
    res.send("ID,Name,Business,Email,Phone,Industry,Plan,Date\n" + rows);
  });

  app.post("/admin/broadcast", async (req, res) => {
    if (!isAdmin(req, res)) return;
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message required" });
    const users = db.Signups.list(10000).filter(s => s.telegram_id);
    let sent = 0, failed = 0;
    for (const u of users) {
      try {
        await bot.telegram.sendMessage(u.telegram_id, `📢 *ShopBoss Update*\n\n${message}`, { parse_mode: "Markdown" });
        sent++;
        await new Promise(r => setTimeout(r, 70)); // rate limit
      } catch (_) { failed++; }
    }
    res.json({ ok: true, sent, failed });
  });

  app.post("/admin/grant", async (req, res) => {
    if (!isAdmin(req, res)) return;
    const { telegram_id, plan } = req.body;
    const { PLANS, activateLicense } = require("./services/payment");
    if (!PLANS[plan] || plan === "trial") return res.status(400).json({ error: "Invalid plan" });
    activateLicense(telegram_id, `ADMIN-${Date.now()}`, "admin", PLANS[plan].price, plan);
    try {
      await bot.telegram.sendMessage(telegram_id,
        `🎉 *${PLANS[plan].label} Activated!*\n\nUse /start to continue. 🚀`,
        { parse_mode: "Markdown" }
      );
    } catch (_) {}
    res.json({ ok: true });
  });

  app.post("/admin/suspend", (req, res) => {
    if (!isAdmin(req, res)) return;
    const { telegram_id } = req.body;
    dbHandles.run("UPDATE licenses SET status='cancelled' WHERE telegram_id=?", [String(telegram_id)]);
    db.save();
    res.json({ ok: true });
  });

  // ── Public APIs ───────────────────────────────────────────────────────────
  app.post("/signup", async (req, res) => {
    try {
      const { name, business_name, email, phone, industry, plan } = req.body;
      if (!name || !email) return res.status(400).json({ error: "Name and email required" });
      if (!phone) return res.status(400).json({ error: "Phone required" });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Invalid email" });
      db.Signups.add({ name, business_name: business_name || name, email, phone, industry, plan: plan || "trial" });
      const qp = new URLSearchParams({ email, name, bn: business_name || "", ind: industry || "", ph: phone }).toString();
      res.json({ ok: true, redirect: `/profile.html?${qp}` });
    } catch (e) {
      if (e.message?.includes("UNIQUE")) return res.status(400).json({ error: "Email already registered." });
      res.status(500).json({ error: "Signup failed. Call +2349029092881" });
    }
  });

  app.get("/api/vendors", (req, res) => {
    try {
      res.json({ vendors: db.Vendors.list(req.query.industry || "All", 100) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/vendors/featured", (req, res) => {
    try {
      const vendors = db.Vendors.featured();
      res.json({ vendors: vendors.map(v => ({ ...v, reviews: db.Vendors.reviews(v.id).slice(0, 2) })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/vendors/:id", (req, res) => {
    try {
      const vendor = db.Vendors.get(parseInt(req.params.id));
      if (!vendor) return res.status(404).json({ error: "Not found" });
      res.json({ vendor, reviews: db.Vendors.reviews(vendor.id) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/vendors/:id/review", (req, res) => {
    try {
      const vendorId     = parseInt(req.params.id);
      const { rating, comment, reviewer_name } = req.body;
      const reviewerTgId = req.headers["x-tg-id"] || req.body.reviewer_tg_id || null;
      if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: "Rating must be 1-5" });
      if (!comment || comment.trim().length < 5) return res.status(400).json({ error: "Comment too short" });
      const vendor = db.Vendors.get(vendorId);
      if (!vendor) return res.status(404).json({ error: "Vendor not found" });
      if (reviewerTgId && vendor.telegram_id && String(vendor.telegram_id) === String(reviewerTgId))
        return res.status(400).json({ error: "Cannot review your own business" });
      const alreadyReviewed = reviewerTgId ? db.Vendors.hasReviewed(vendorId, reviewerTgId) : false;
      db.Vendors.addReview(vendorId, reviewerTgId, reviewer_name || "Anonymous", parseInt(rating), comment.trim());
      const updated = db.Vendors.get(vendorId);
      res.json({ ok: true, updated: alreadyReviewed, new_rating: updated.rating, review_count: updated.review_count });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/stats", (req, res) => {
    try {
      const counts = db.Signups.count();
      res.json({ signups: counts.total || 0, vendors: db.Vendors.list("All", 10000).length, industries: 24 });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/profile", (req, res) => {
    try {
      const { email, name, business_name, phone, industry, location, description } = req.body;
      const vendor = db.Vendors.list("All", 100000).find(v => v.email === email);
      if (vendor) {
        dbHandles.run(
          "UPDATE vendors SET name=COALESCE(?,name),phone=COALESCE(?,phone),industry=COALESCE(?,industry),location=?,description=? WHERE id=?",
          [business_name || null, phone || null, industry || null, location || null, description || null, vendor.id]
        );
        db.save();
        res.json({ ok: true, vendor_id: vendor.id });
      } else {
        const r = db.Vendors.add({ name: business_name || name, email, phone, industry, description });
        res.json({ ok: true, vendor_id: r.lastInsertRowid });
      }
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Payment ───────────────────────────────────────────────────────────────
  app.post("/payment/create-link", async (req, res) => {
    try {
      const { name, email, phone, plan } = req.body;
      if (!name || !email || !phone) return res.status(400).json({ error: "Name, email and phone required" });
      if (!process.env.FLW_SECRET_KEY || process.env.FLW_SECRET_KEY.includes("your_"))
        return res.status(503).json({ error: "Payment not configured. Contact +2349029092881" });
      const { PLANS } = require("./services/payment");
      const p    = PLANS[plan] || PLANS.lifetime;
      const ref  = `SB-${Date.now()}`;
      const base = (process.env.WEBHOOK_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, "");
      try { db.Signups.add({ name, email, phone, plan: plan || "lifetime" }); } catch (_) {}
      const r = await require("axios").post("https://api.flutterwave.com/v3/payments", {
        tx_ref: ref, amount: p.price, currency: "NGN",
        redirect_url: `${base}/payment/callback`,
        customer: { email, phonenumber: phone, name },
        customizations: { title: "ShopBoss " + p.label, description: p.description },
        payment_options: "card,banktransfer,ussd",
        meta: { plan, name, email },
      }, { headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` }, timeout: 10000 });
      if (r.data?.status !== "success") return res.status(500).json({ error: r.data?.message || "Gateway error" });
      res.json({ link: r.data.data.link, txRef: ref });
    } catch (e) {
      res.status(500).json({ error: "Payment failed: " + (e.response?.data?.message || e.message) });
    }
  });

  app.post("/payment/webhook", async (req, res) => {
    try {
      if (req.headers["verif-hash"] !== process.env.FLW_WEBHOOK_HASH) return res.status(401).send("Unauthorized");
      const body = JSON.parse(req.body.toString());
      if (body.event === "charge.completed" && body.data?.status === "successful") {
        const { verifyAndActivate, PLANS } = require("./services/payment");
        const result = await verifyAndActivate(body.data.tx_ref, body.data.flw_ref);
        if (result?.telegramId) {
          try {
            await bot.telegram.sendMessage(result.telegramId,
              `🎉 *Payment Confirmed!*\n\n✅ ${(PLANS[result.plan] || PLANS.lifetime).label} activated.\n\nUse /start to continue. 🚀`,
              { parse_mode: "Markdown" }
            );
          } catch (_) {}
        }
      }
      res.sendStatus(200);
    } catch (e) { console.error("Webhook error:", e.message); res.sendStatus(200); }
  });

  app.get("/payment/callback", (req, res) => {
    const base = (process.env.WEBHOOK_URL || "").replace(/\/+$/, "");
    const { status, tx_ref } = req.query;
    if (status === "successful") return res.redirect(`${base}/payment/success.html?ref=${tx_ref}`);
    if (status === "cancelled")  return res.redirect(`${base}/payment/pending.html`);
    res.redirect(`${base}/payment/failed.html`);
  });

  const cbStyle = `<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#080c14;color:#eef1f8;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px}.box{max-width:400px}.ico{font-size:56px;margin-bottom:20px}.h1{font-size:24px;font-weight:800;margin-bottom:12px}.p{color:#8896b0;font-size:14px;line-height:1.7;margin-bottom:24px}.btn{display:inline-flex;background:linear-gradient(135deg,#f0b429,#c8931f);color:#111;font-weight:800;font-size:15px;padding:13px 26px;border-radius:10px;text-decoration:none}</style>`;
  app.get("/payment/success.html", (_, res) => res.send(`<!DOCTYPE html><html><head><title>Payment Successful</title>${cbStyle}</head><body><div class="box"><div class="ico">🎉</div><div class="h1" style="color:#10b981">Payment Successful!</div><div class="p">Your ShopBoss plan is now active. Open the bot to start.</div><a class="btn" href="https://t.me/AiBizRepoBot">Open ShopBoss →</a></div></body></html>`));
  app.get("/payment/pending.html", (_, res) => res.send(`<!DOCTYPE html><html><head><title>Payment Pending</title>${cbStyle}</head><body><div class="box"><div class="ico">⏳</div><div class="h1" style="color:#f0b429">Payment Pending</div><div class="p">Your payment is being processed. We'll activate your plan when it confirms.</div><a class="btn" href="https://t.me/AiBizRepoBot">Go to Bot</a></div></body></html>`));
  app.get("/payment/failed.html",  (_, res) => res.send(`<!DOCTYPE html><html><head><title>Payment Failed</title>${cbStyle}</head><body><div class="box"><div class="ico">❌</div><div class="h1" style="color:#f43f5e">Payment Failed</div><div class="p">Something went wrong. Please try again or call +2349029092881.</div><a class="btn" href="/">Try Again</a></div></body></html>`));

  app.get("/payment/status", (req, res) => {
    if (!isAdmin(req, res)) return;
    res.json({
      ai:          { configured: !!(process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY.includes("your_")) },
      flutterwave: { configured: !!(process.env.FLW_SECRET_KEY && !process.env.FLW_SECRET_KEY.includes("your_")) },
      license_stats: require("./services/payment").getStats(),
    });
  });

  // ── Mini App ──────────────────────────────────────────────────────────────
  app.use("/mini", require("./services/miniapp"));

  // ── Start server then webhook ─────────────────────────────────────────────
  const PORT = parseInt(process.env.PORT || "3000");
  const WURL = (process.env.WEBHOOK_URL || "").replace(/\/+$/, "");

  // Register webhook callback handler BEFORE listen
  if (WURL) {
    app.use(bot.webhookCallback("/webhook"));
  }

  // Listen first — then register with Telegram
  await new Promise((resolve, reject) => {
    const srv = app.listen(PORT, () => {
      console.log(`🚀 Server listening on port ${PORT}`);
      resolve();
    });
    srv.on("error", reject);
  });

  if (WURL) {
    await bot.telegram.setWebhook(`${WURL}/webhook`);
    console.log(`🌐 Webhook: ${WURL}/webhook`);
  } else {
    await bot.launch();
    console.log("🤖 Polling mode");
  }

  // Scheduled jobs (wrapped so crash here doesn't kill the server)
  try { require("./services/jobs").startJobs(bot); }
  catch (e) { console.warn("⚠️  Jobs failed to start:", e.message); }

  // Graceful shutdown
  process.once("SIGINT",  () => { bot.stop("SIGINT");  db.save(); });
  process.once("SIGTERM", () => { bot.stop("SIGTERM"); db.save(); });

  console.log("✅ ShopBoss fully started");

}).catch((err) => {
  console.error("❌ FATAL — boot failed:", err.message);
  console.error(err.stack);
  process.exit(1);
});

// ── Admin HTML (kept at bottom — not in hot path) ─────────────────────────────
function adminLoginPage() {
  return `<!DOCTYPE html><html><head><title>ShopBoss Admin</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#080c14;color:#eef1f8;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}.box{background:#111827;border:1px solid #1e2d44;border-radius:16px;padding:44px;width:100%;max-width:380px;text-align:center}.logo{font-size:36px;margin-bottom:8px}.title{color:#f0b429;font-size:22px;font-weight:800;margin-bottom:8px}.sub{font-size:13px;color:#8896b0;margin-bottom:28px}input{width:100%;background:#141c2e;border:1.5px solid #1e2d44;border-radius:10px;padding:13px;color:#eef1f8;font-size:16px;outline:none;margin-bottom:14px;text-align:center}input:focus{border-color:#f0b429}button{width:100%;background:linear-gradient(135deg,#f0b429,#c8931f);color:#111;border:none;border-radius:10px;padding:14px;font-weight:800;font-size:15px;cursor:pointer}</style></head><body>
<div class="box"><div class="logo">🔐</div><div class="title">ShopBoss Admin</div>
<div class="sub">Enter your Telegram ID as the admin key</div>
<form onsubmit="go(event)"><input id="k" type="password" placeholder="Admin key"/><button type="submit">Access →</button></form></div>
<script>function go(e){e.preventDefault();const k=document.getElementById('k').value.trim();if(k)window.location='/admin?key='+encodeURIComponent(k);}</script>
</body></html>`;
}

function adminDashboard(stats, signups, vendors, licStats, key) {
  const conv = stats.total > 0 ? ((licStats.active / stats.total) * 100).toFixed(1) : "0";
  const mrr  = (licStats.active * 9500).toLocaleString("en-NG");
  const rows = signups.map(s =>
    `<tr><td>${s.id}</td><td><b>${s.name||""}</b></td><td>${s.business_name||"—"}</td>
     <td>${s.email}</td><td>${s.phone||"—"}</td><td>${s.industry||"—"}</td>
     <td><span class="badge b-${s.plan==="lifetime"?"green":s.plan==="monthly"||s.plan==="yearly"?"blue":"gold"}">${s.plan}</span></td>
     <td>${new Date(s.created_at).toLocaleDateString("en-NG")}</td></tr>`
  ).join("");
  const vrows = vendors.slice(0, 200).map(v =>
    `<tr><td>${v.id}</td><td><b>${v.name}</b></td><td>${v.industry}</td>
     <td>${v.location||"—"}</td><td>${v.phone||"—"}</td>
     <td style="color:#f0b429">★ ${v.rating} (${v.review_count})</td></tr>`
  ).join("");

  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>ShopBoss Admin</title>
<style>*{box-sizing:border-box;margin:0;padding:0}:root{--bg:#080c14;--panel:#111827;--card:#141c2e;--rim:#1e2d44;--gold:#f0b429;--green:#10b981;--red:#f43f5e;--text:#eef1f8;--sub:#8896b0;--dim:#3d5270}
body{background:var(--bg);color:var(--text);font-family:-apple-system,sans-serif;font-size:14px}
.bar{background:var(--panel);border-bottom:1px solid var(--rim);height:58px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;position:sticky;top:0;z-index:10}
.logo{color:var(--gold);font-size:17px;font-weight:800}.layout{display:flex;min-height:calc(100vh - 58px)}
.side{width:200px;background:var(--panel);border-right:1px solid var(--rim);padding:12px 0;flex-shrink:0}
.nb{display:block;width:100%;text-align:left;padding:9px 16px;background:none;border:none;border-left:3px solid transparent;color:var(--sub);font-size:13px;font-weight:600;cursor:pointer}
.nb.on{color:var(--gold);border-left-color:var(--gold)}.nb:hover{color:var(--text)}
.main{flex:1;padding:24px;overflow:auto}.tab{display:none}.tab.on{display:block}
.krow{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px;margin-bottom:24px}
.kpi{background:var(--panel);border:1px solid var(--rim);border-radius:12px;padding:20px 16px}
.kv{font-size:30px;font-weight:800;color:var(--gold);letter-spacing:-1px;line-height:1}.kl{font-size:10px;color:var(--sub);margin-top:4px;font-weight:700;text-transform:uppercase}
.tbox{background:var(--panel);border:1px solid var(--rim);border-radius:12px;overflow:auto;margin-bottom:20px}
table{width:100%;border-collapse:collapse;min-width:500px}th{background:var(--card);padding:9px 12px;text-align:left;font-size:10px;text-transform:uppercase;color:var(--sub);font-weight:800}
td{padding:9px 12px;border-bottom:1px solid var(--rim);font-size:13px}tr:last-child td{border:none}
.badge{font-size:10px;font-weight:800;padding:2px 8px;border-radius:99px}
.b-green{background:rgba(16,185,129,.15);color:var(--green)}.b-gold{background:rgba(240,180,41,.15);color:var(--gold)}.b-blue{background:rgba(59,130,246,.15);color:#60a5fa}
.card{background:var(--panel);border:1px solid var(--rim);border-radius:12px;padding:20px;margin-bottom:16px;max-width:420px}
.fi{width:100%;background:var(--card);border:1.5px solid var(--rim);border-radius:8px;padding:9px 12px;color:var(--text);font-size:14px;font-family:inherit;outline:none;margin-bottom:8px;-webkit-appearance:none}
.fi:focus{border-color:var(--gold)}textarea.fi{resize:vertical;min-height:80px}
.btn{display:inline-flex;align-items:center;padding:9px 18px;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;border:none}
.btn-gold{background:var(--gold);color:#111;width:100%;justify-content:center;margin-top:4px}
.toast{position:fixed;bottom:20px;right:20px;padding:11px 18px;border-radius:8px;font-weight:700;font-size:13px;opacity:0;transition:opacity .3s;pointer-events:none;color:#fff;z-index:99}
.toast.show{opacity:1}
@media(max-width:700px){.side{display:none}}</style></head><body>
<div class="bar">
  <div class="logo">⚡ ShopBoss Admin</div>
  <div style="display:flex;gap:8px">
    <a href="/admin/export?key=${key}" class="btn" style="background:transparent;color:var(--sub);border:1px solid var(--rim)">⬇ CSV</a>
    <a href="https://t.me/AiBizRepoBot" target="_blank" class="btn btn-gold">Open Bot →</a>
  </div>
</div>
<div class="layout">
  <nav class="side">
    <button class="nb on" onclick="show('ov',this)">📊 Overview</button>
    <button class="nb" onclick="show('users',this)">👥 Signups</button>
    <button class="nb" onclick="show('vendors',this)">🏪 Vendors</button>
    <button class="nb" onclick="show('bc',this)">📢 Broadcast</button>
    <button class="nb" onclick="show('actions',this)">⚡ Actions</button>
  </nav>
  <div class="main">
    <div class="tab on" id="t-ov">
      <div class="krow">
        <div class="kpi"><div class="kv">${stats.total}</div><div class="kl">Total Signups</div></div>
        <div class="kpi"><div class="kv" style="color:var(--green)">${licStats.active}</div><div class="kl">Paying Users</div></div>
        <div class="kpi"><div class="kv">${vendors.length}</div><div class="kl">Vendors</div></div>
        <div class="kpi"><div class="kv" style="color:var(--green)">₦${Number(licStats.revenue||0).toLocaleString("en-NG")}</div><div class="kl">Revenue</div></div>
        <div class="kpi"><div class="kv" style="color:#60a5fa">₦${mrr}</div><div class="kl">Est. MRR</div></div>
        <div class="kpi"><div class="kv">${conv}%</div><div class="kl">Conversion</div></div>
      </div>
      <div class="tbox"><table>
        <thead><tr><th>#</th><th>Name</th><th>Business</th><th>Email</th><th>Phone</th><th>Industry</th><th>Plan</th><th>Date</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--sub)">No signups yet</td></tr>'}</tbody>
      </table></div>
    </div>
    <div class="tab" id="t-users">
      <div class="tbox"><table>
        <thead><tr><th>#</th><th>Name</th><th>Business</th><th>Email</th><th>Phone</th><th>Industry</th><th>Plan</th><th>Date</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--sub)">No signups yet</td></tr>'}</tbody>
      </table></div>
    </div>
    <div class="tab" id="t-vendors">
      <div class="tbox"><table>
        <thead><tr><th>#</th><th>Business</th><th>Industry</th><th>Location</th><th>Phone</th><th>Rating</th></tr></thead>
        <tbody>${vrows || '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--sub)">No vendors yet</td></tr>'}</tbody>
      </table></div>
    </div>
    <div class="tab" id="t-bc">
      <div class="card">
        <h3 style="margin-bottom:12px;color:var(--gold)">📢 Broadcast</h3>
        <p style="font-size:12px;color:var(--sub);margin-bottom:12px">Sends to ${signups.filter(s => s.telegram_id).length} users with Telegram ID.</p>
        <textarea class="fi" id="bc-msg" placeholder="Type your message…"></textarea>
        <button class="btn btn-gold" onclick="broadcast()">Send Broadcast</button>
      </div>
    </div>
    <div class="tab" id="t-actions">
      <div class="card">
        <h3 style="margin-bottom:12px;color:var(--gold)">✅ Grant Plan</h3>
        <input class="fi" id="g-tgid" placeholder="Telegram ID"/>
        <select class="fi" id="g-plan"><option value="monthly">Monthly</option><option value="yearly">Yearly</option><option value="lifetime">Lifetime</option></select>
        <button class="btn btn-gold" onclick="grantPlan()">Grant Plan</button>
      </div>
      <div class="card">
        <h3 style="margin-bottom:12px;color:#f43f5e">🚫 Suspend User</h3>
        <input class="fi" id="s-tgid" placeholder="Telegram ID"/>
        <button class="btn" style="background:rgba(244,63,94,.15);color:#f43f5e;border:1px solid rgba(244,63,94,.3);width:100%;justify-content:center;margin-top:4px" onclick="suspendUser()">Suspend</button>
      </div>
    </div>
  </div>
</div>
<div class="toast" id="toast"></div>
<script>
const KEY = '${key}';
function show(t, b) {
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('on'));
  document.querySelectorAll('.nb').forEach(x => x.classList.remove('on'));
  document.getElementById('t-'+t).classList.add('on'); b.classList.add('on');
}
function toast(m, ok=true) {
  const t = document.getElementById('toast');
  t.textContent = m; t.style.background = ok ? '#10b981' : '#f43f5e';
  t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2800);
}
async function broadcast() {
  const msg = document.getElementById('bc-msg').value.trim();
  if (!msg) return toast('Enter a message', false);
  if (!confirm('Send to ALL users?')) return;
  const r = await fetch('/admin/broadcast?key='+KEY, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:msg})});
  const d = await r.json(); toast(d.ok ? 'Sent to '+d.sent+' users' : d.error||'Failed', d.ok);
}
async function grantPlan() {
  const tgid = document.getElementById('g-tgid').value.trim();
  const plan = document.getElementById('g-plan').value;
  if (!tgid) return toast('Enter Telegram ID', false);
  const r = await fetch('/admin/grant?key='+KEY, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({telegram_id:tgid,plan})});
  const d = await r.json(); toast(d.ok ? 'Plan granted!' : d.error||'Failed', d.ok);
}
async function suspendUser() {
  const tgid = document.getElementById('s-tgid').value.trim();
  if (!tgid) return toast('Enter Telegram ID', false);
  if (!confirm('Suspend?')) return;
  const r = await fetch('/admin/suspend?key='+KEY, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({telegram_id:tgid})});
  const d = await r.json(); toast(d.ok ? 'Suspended' : d.error||'Failed', d.ok);
}
</script></body></html>`;
}
