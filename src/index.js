// ─────────────────────────────────────────────
//  index.js — ShopBoss entry point
//  Paywall registered FIRST, before all commands
// ─────────────────────────────────────────────
require("dotenv").config();
const { Telegraf, session, Markup } = require("telegraf");
const express = require("express");
const crypto  = require("crypto");
const { init, Vendors, Signups } = require("./db/database");

if (!process.env.BOT_TOKEN) {
  console.error("❌ BOT_TOKEN is not set.");
  process.exit(1);
}

// ── Admin HTML helpers ────────────────────────────────────
function adminLoginPage() {
  return `<!DOCTYPE html><html><head><title>ShopBoss Admin</title>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <style>*{box-sizing:border-box;margin:0;padding:0}body{background:#0d1220;color:#eef1f8;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}.box{background:#131929;border:1px solid #1f2d47;border-radius:14px;padding:40px;width:100%;max-width:360px;text-align:center}h2{color:#f0b429;font-size:20px;font-weight:800;margin-bottom:24px}input{width:100%;background:#1e2840;border:1.5px solid #2a3a58;border-radius:8px;padding:12px;color:#eef1f8;font-size:16px;outline:none;margin-bottom:14px;text-align:center}button{width:100%;background:linear-gradient(135deg,#f0b429,#c8931f);color:#111;border:none;border-radius:8px;padding:13px;font-weight:800;font-size:15px;cursor:pointer}</style></head>
  <body><div class="box"><h2>🔐 ShopBoss Admin</h2>
  <form onsubmit="window.location='/admin?key='+document.getElementById('k').value;return false">
  <input id="k" type="password" placeholder="Enter admin key" autocomplete="current-password"/>
  <button type="submit">Access Dashboard</button>
  </form></div></body></html>`;
}

function adminDashboard(stats, signups, vendors, licStats, key) {
  const rows = signups.map(s =>
    `<tr><td>${s.id}</td><td><strong>${s.name}</strong></td><td>${s.business_name||"—"}</td><td>${s.email}</td><td>${s.phone||"—"}</td><td>${s.industry||"—"}</td><td style="color:${s.plan==="lifetime"?"#10b981":"#f0b429"}">${s.plan}</td><td style="color:#8896b0;font-size:11px">${new Date(s.created_at).toLocaleDateString("en-NG")}</td></tr>`
  ).join("");

  return `<!DOCTYPE html><html><head><title>ShopBoss Admin</title>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#080c14;color:#eef1f8;font-family:-apple-system,"Inter",sans-serif;font-size:14px}
  nav{background:#0d1220;border-bottom:1px solid #1f2d47;padding:16px 24px;display:flex;align-items:center;gap:12px}
  nav h1{color:#f0b429;font-size:18px;font-weight:800} nav span{color:#8896b0;font-size:12px}
  .wrap{max-width:1200px;margin:0 auto;padding:24px}
  .sgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:28px}
  .sc{background:#111827;border:1px solid #1f2d47;border-radius:12px;padding:20px;text-align:center}
  .sc .n{font-size:32px;font-weight:800;color:#f0b429} .sc .l{font-size:11px;color:#8896b0;margin-top:4px;text-transform:uppercase;letter-spacing:.5px}
  h2{font-size:14px;font-weight:800;color:#f0b429;margin-bottom:12px;text-transform:uppercase;letter-spacing:.5px}
  table{width:100%;border-collapse:collapse;background:#111827;border-radius:12px;overflow:hidden}
  th{background:#161e30;padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#8896b0;font-weight:700}
  td{padding:10px 14px;border-bottom:1px solid #1f2d47;font-size:13px;vertical-align:middle}
  tr:last-child td{border-bottom:none} tr:hover td{background:rgba(240,180,41,.03)}
  .ebtn{display:inline-block;background:#f0b429;color:#111;font-weight:800;font-size:13px;padding:10px 20px;border-radius:8px;text-decoration:none;margin-bottom:16px}
  </style></head><body>
  <nav><h1>🤖 ShopBoss Admin</h1><span>Control Panel · Chima George Okonkwo</span></nav>
  <div class="wrap">
    <div class="sgrid">
      <div class="sc"><div class="n">${stats.total}</div><div class="l">Total Signups</div></div>
      <div class="sc"><div class="n" style="color:#10b981">${licStats.active||0}</div><div class="l">Paid (Lifetime)</div></div>
      <div class="sc"><div class="n">${stats.trial}</div><div class="l">On Trial</div></div>
      <div class="sc"><div class="n">${vendors.length}</div><div class="l">Marketplace Vendors</div></div>
      <div class="sc"><div class="n" style="color:#10b981">&#x20A6;${Number(licStats.revenue||0).toLocaleString("en-NG")}</div><div class="l">Total Revenue</div></div>
    </div>
    <h2>&#x1F4CB; All Signups (${signups.length})</h2>
    <a class="ebtn" href="/admin/export?key=${key}">&#x2B07; Export CSV</a>
    <div style="overflow-x:auto">
    <table>
      <thead><tr><th>#</th><th>Name</th><th>Business</th><th>Email</th><th>Phone</th><th>Industry</th><th>Plan</th><th>Date</th></tr></thead>
      <tbody>${rows||'<tr><td colspan="8" style="text-align:center;color:#8896b0;padding:32px">No signups yet</td></tr>'}</tbody>
    </table>
    </div>
  </div></body></html>`;
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
    const baseUrl = process.env.WEBHOOK_URL || `http://localhost:${process.env.PORT || 3000}`;
    const miniUrl = `${baseUrl}/mini`;

    // Markup.button.webApp only works if the bot has a registered Mini App in BotFather
    // We provide BOTH a webApp button AND a regular URL button as fallback
    await ctx.reply(
      "📱 *ShopBoss Dashboard*\n\n" +
      "Open your full business dashboard — charts, sales, inventory and AI chat in one place.\n\n" +
      `📌 Direct link: ${miniUrl}`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.webApp("📊 Open Dashboard (Telegram)", miniUrl)],
          [Markup.button.url("🌐 Open in Browser", miniUrl)],
        ])
      }
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

  // ── Public signup + vendor registration ─────────────────────
  app.post("/signup", async (req, res) => {
    try {
      const { name, business_name, email, phone, industry, plan } = req.body;
      if (!name || !email) return res.status(400).json({ error: "Name and email required" });
      if (!phone) return res.status(400).json({ error: "Phone number required" });
      const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRx.test(email)) return res.status(400).json({ error: "Invalid email address" });
      Signups.add({ name, business_name: business_name || name, email, phone, industry, plan: plan || "trial" });
      // Redirect URL for post-signup profile page
      const qp = new URLSearchParams({
        email: email || '',
        name: name || '',
        bn: business_name || '',
        ind: industry || '',
        ph: phone || '',
      }).toString();
      res.json({ ok: true, redirect: `/profile.html?${qp}` });
    } catch(err) {
      console.error("Signup error:", err.message);
      if (err.message?.includes("UNIQUE")) return res.status(400).json({ error: "This email is already registered. Try signing in." });
      res.status(500).json({ error: "Signup failed. Please try again or call +2349029092881" });
    }
  });

  // ── Admin dashboard — password protected ─────────────────────
  app.get("/admin", (req, res) => {
    const key = req.query.key;
    if (!key || key !== process.env.ADMIN_TELEGRAM_ID) {
      return res.status(403).send(adminLoginPage());
    }
    const stats    = Signups.count();
    const signups  = Signups.list(200);
    const vendors  = Vendors.list("All", 200);
    const licStats = require("./services/payment").getStats();
    res.send(adminDashboard(stats, signups, vendors, licStats, key));
  });

  app.get("/admin/export", (req, res) => {
    if (req.query.key !== process.env.ADMIN_TELEGRAM_ID) return res.status(403).send("Forbidden");
    const signups = Signups.list(10000);
    const header = "ID,Name,Business,Email,Phone,Industry,Plan,Date\n";
    const rows = signups.map(s =>
      [s.id, s.name, s.business_name||"", s.email, s.phone||"", s.industry||"", s.plan, s.created_at]
        .map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")
    ).join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="signups-${Date.now()}.csv"`);
    res.send(header + rows);
  });


  // ── Public: get vendors for marketplace ──────────────────────
  app.get("/api/vendors", (req, res) => {
    try {
      const industry = req.query.industry || "All";
      const vendors  = Vendors.list(industry, 20);
      // Attach latest review to each vendor
      const enriched = vendors.map(v => ({
        ...v,
        latestReview: Vendors.reviews(v.id)[0] || null,
      }));
      res.json({ vendors: enriched });
    } catch(err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Public: get featured vendors ─────────────────────────────
  app.get("/api/vendors/featured", (req, res) => {
    try {
      const featured = Vendors.featured();
      const enriched = featured.map(v => ({ ...v, reviews: Vendors.reviews(v.id).slice(0, 2) }));
      res.json({ vendors: enriched });
    } catch(err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Landing page payment link creation ──────────────────────
  app.post("/payment/create-link", async (req, res) => {
    try {
      const { name, email, phone, telegram_username, plan } = req.body;
      const { PLANS } = require('./services/payment');
      const selectedPlan = PLANS[plan] || PLANS.lifetime;
      const planPrice = selectedPlan.price;
      if (!name || !email || !phone)
        return res.status(400).json({ error: "Name, email and phone are required" });

      // If no FLW key configured, return helpful error
      if (!process.env.FLW_SECRET_KEY || process.env.FLW_SECRET_KEY.includes("your_")) {
        return res.status(503).json({ error: "Payment system not configured yet. Please contact support: +2349029092881" });
      }

      const axios  = require("axios");
      const txRef  = `SB-WEB-${Date.now()}`;
      const planPrice2 = planPrice || 299999;
      const wUrl   = process.env.WEBHOOK_URL || `http://localhost:${process.env.PORT || 3000}`;

      // Also record signup
      try { Signups.add({ name, email, phone, telegram_username, industry: "General", plan: plan || "lifetime" }); } catch(_) {}

      const payload = {
        tx_ref:       txRef,
        amount:       planPrice2,
        currency:     "NGN",
        redirect_url: `${wUrl}/payment/callback`,
        customer:     { email, phonenumber: phone, name },
        customizations: {
          title:       "ShopBoss Lifetime Access",
          description: "One-time payment — lifetime access to ShopBoss AI Business Manager",
          logo:        `${wUrl}/logo.png`,
        },
        payment_options: "card,banktransfer,ussd",
        meta: {
          source:            "landing_page",
          telegram_username: telegram_username || "",
          name, email,
        },
      };

      const r = await axios.post("https://api.flutterwave.com/v3/payments", payload, {
        headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` },
        timeout: 10000,
      });

      if (!r.data || r.data.status !== "success") {
        console.error("FLW error:", r.data);
        return res.status(500).json({ error: r.data?.message || "Payment gateway error. Try again or call +2349029092881" });
      }

      res.json({ link: r.data.data.link, txRef });
    } catch(err) {
      console.error("Create link error:", err.message);
      const msg = err.response?.data?.message || err.message || "Unknown error";
      res.status(500).json({ error: `Payment failed: ${msg}. Contact +2349029092881` });
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
    <a href="https://t.me/${process.env.BOT_USERNAME || 'AiBizRepoBot'}">← Open ShopBoss in Telegram</a></div></body></html>`);
  });

  app.get("/payment/pending.html", (req, res) => {
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Payment Pending</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0f1117;color:#e8eaf0;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}.card{background:#181c27;border:1px solid #2a3045;border-radius:16px;padding:40px;text-align:center;max-width:360px;width:100%}h1{font-size:48px;margin-bottom:16px}h2{color:#f59e0b;font-size:22px;margin-bottom:12px}p{color:#7a8099;line-height:1.6;margin-bottom:20px}a{color:#f5c518;text-decoration:none;font-weight:700}</style></head>
    <body><div class="card"><h1>⏳</h1><h2>Payment Processing</h2>
    <p>Your payment is being verified. Return to Telegram and tap "Check my status" — it usually activates within 30 seconds.</p>
    <a href="https://t.me/${process.env.BOT_USERNAME || 'AiBizRepoBot'}">← Return to Telegram</a></div></body></html>`);
  });

  app.get("/payment/failed.html", (req, res) => {
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Payment Failed</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0f1117;color:#e8eaf0;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}.card{background:#181c27;border:1px solid #2a3045;border-radius:16px;padding:40px;text-align:center;max-width:360px;width:100%}h1{font-size:48px;margin-bottom:16px}h2{color:#ef4444;font-size:22px;margin-bottom:12px}p{color:#7a8099;line-height:1.6;margin-bottom:20px}a{color:#f5c518;text-decoration:none;font-weight:700}</style></head>
    <body><div class="card"><h1>❌</h1><h2>Payment Failed</h2>
    <p>Something went wrong with your payment. Please return to Telegram and try again with /pay.</p>
    <a href="https://t.me/${process.env.BOT_USERNAME || 'AiBizRepoBot'}">← Return to Telegram</a></div></body></html>`);
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

  // ── Profile update ──────────────────────────────────────────
  app.post("/api/profile", (req, res) => {
    try {
      const { email, name, business_name, phone, industry, location, description } = req.body;
      if (!email && !name) return res.status(400).json({ error: "Email or name required" });

      // Update vendor record
      const vendor = Vendors.list("All", 10000).find(v => v.email === email);
      if (vendor) {
        // Update vendor with new details
        const { db } = require("./db/database");
        db.run("UPDATE vendors SET name=?, phone=?, industry=?, location=?, description=? WHERE id=?",
          [business_name || vendor.name, phone || vendor.phone, industry || vendor.industry,
           location || null, description || null, vendor.id]);
        require("./db/database").save?.();
        res.json({ ok: true, vendor_id: vendor.id });
      } else {
        // Create vendor
        const r = Vendors.add({ name: business_name || name, email, phone, industry, description });
        res.json({ ok: true, vendor_id: r.lastInsertRowid });
      }
    } catch(err) {
      console.error("Profile save error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Vendor listings ─────────────────────────────────────────
  app.get("/api/listings", (req, res) => {
    try {
      const listings = VendorListings.listAll(20);
      res.json({ listings });
    } catch(err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/listings", async (req, res) => {
    try {
      const tgId = req.headers["x-tg-id"];
      if (!tgId) return res.status(401).json({ error: "Unauthorized" });
      const { title, description, price, price_label, category, image_url } = req.body;
      if (!title) return res.status(400).json({ error: "Title required" });
      // Find vendor by telegram_id
      const vendor = Vendors.list("All", 1000).find(v => {
        const signup = Signups.get(v.email);
        return signup && String(signup.telegram_id || "") === String(tgId);
      });
      if (!vendor) return res.status(404).json({ error: "Create your vendor profile first by signing up" });
      const r = VendorListings.add({ vendor_id: vendor.id, title, description, price, price_label, category, image_url });
      res.json({ ok: true, id: r.lastInsertRowid });
    } catch(err) { res.status(500).json({ error: err.message }); }
  });

  // ── Marketplace sale confirmation ────────────────────────────
  app.post("/api/sales/confirm", (req, res) => {
    try {
      const { sale_id, action, tg_id } = req.body;
      if (!sale_id || !action || !tg_id) return res.status(400).json({ error: "sale_id, action, tg_id required" });
      let ok = false;
      if (action === "sent") ok = MarketplaceSales.confirmSeller(sale_id, tg_id);
      else if (action === "received") ok = MarketplaceSales.confirmBuyer(sale_id, tg_id);
      if (!ok) return res.status(400).json({ error: "Could not confirm — check sale ID and your role" });
      const updated = MarketplaceSales.get(sale_id);
      res.json({ ok: true, status: updated.status, completed: updated.status === "completed" });
    } catch(err) { res.status(500).json({ error: err.message }); }
  });

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
