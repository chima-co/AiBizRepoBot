// ─────────────────────────────────────────────
//  admin.js — Complete owner admin system
//  Telegram commands + web console
// ─────────────────────────────────────────────
const { Markup } = require("telegraf");
const { getAllLicenses, getStats, activateLicense, PLANS } = require("../services/payment");
const { Signups, Vendors, Tickets, Referrals, RateLimit } = require("../db/database");
const { fmt } = require("../utils/helpers");

function isAdmin(ctx) {
  const adminId = process.env.ADMIN_TELEGRAM_ID;
  if (!adminId) return false;
  return String(ctx.from?.id) === String(adminId);
}

function registerAdmin(bot) {

  // ── /admin — full dashboard overview ──────────────────────────
  bot.command("admin", async (ctx) => {
    if (!isAdmin(ctx)) return;
    await ctx.sendChatAction("typing");
    const lic    = getStats();
    const sigs   = Signups.count();
    const vends  = Vendors.list("All", 10000).length;
    const openTix = Tickets.list("open").length;
    const wurl   = process.env.WEBHOOK_URL || "http://localhost:3000";

    await ctx.reply(
      `🔐 *ShopBoss Admin Console*\n\n` +
      `👥 *Users*\n` +
      `Total signups: *${sigs.total}*\n` +
      `Active vendors: *${vends}*\n` +
      `On trial: ${sigs.trial}\n\n` +
      `💰 *Revenue*\n` +
      `Paying users: *${lic.active}*\n` +
      `Total revenue: *${fmt(lic.revenue)}*\n` +
      `Expired/churned: ${lic.expired}\n\n` +
      `🎫 *Support*\n` +
      `Open tickets: *${openTix}*\n\n` +
      `🌐 *Web Console:*\n` +
      `\`${wurl}/admin?key=${process.env.ADMIN_TELEGRAM_ID}\`\n\n` +
      `_Commands: /astats /users /avendors /arevenue /broadcast /tickets /areply /grantplan /suspend_`,
      { parse_mode: "Markdown" }
    );
  });

  // ── /astats — detailed platform stats ─────────────────────────
  bot.command("astats", async (ctx) => {
    if (!isAdmin(ctx)) return;
    await ctx.sendChatAction("typing");
    const lic  = getStats();
    const sigs = Signups.count();
    const { MarketplaceSales } = require("../db/database");

    await ctx.reply(
      `📊 *Platform Statistics*\n\n` +
      `*Signups*\n` +
      `Total: ${sigs.total} | Trial: ${sigs.trial} | Paid: ${lic.active}\n\n` +
      `*Revenue Breakdown*\n` +
      `Total: *${fmt(lic.revenue)}*\n` +
      `Lifetime subs: ${lic.active}\n` +
      `Churned: ${lic.expired}\n\n` +
      `*Conversion Rate*\n` +
      `${sigs.total > 0 ? ((lic.active / sigs.total) * 100).toFixed(1) : 0}% of signups converted to paid\n\n` +
      `*Vendors*\n` +
      `Active: ${Vendors.list("All", 10000).length}`,
      { parse_mode: "Markdown" }
    );
  });

  // ── /users — list recent users ─────────────────────────────────
  bot.command("users", async (ctx) => {
    if (!isAdmin(ctx)) return;
    const all = Signups.list(15);
    if (!all.length) return ctx.reply("No users yet.");
    const lines = all.map((s, i) =>
      `${i + 1}. *${s.business_name || s.name}*\n` +
      `   ${s.email} | ${s.industry || "?"} | _${s.plan}_`
    ).join("\n\n");
    await ctx.reply(`👥 *Recent Users (${all.length})*\n\n${lines}`, { parse_mode: "Markdown" });
  });

  // ── /avendors — list active vendors ───────────────────────────
  bot.command("avendors", async (ctx) => {
    if (!isAdmin(ctx)) return;
    const all = Vendors.list("All", 20);
    if (!all.length) return ctx.reply("No vendors yet.");
    const lines = all.slice(0, 15).map((v, i) =>
      `${i + 1}. *${v.name}* — ${v.industry}\n   📍 ${v.location || "?"} | ⭐ ${v.rating}`
    ).join("\n\n");
    await ctx.reply(`🏪 *Active Vendors (${all.length})*\n\n${lines}`, { parse_mode: "Markdown" });
  });

  // ── /arevenue — revenue breakdown ─────────────────────────────
  bot.command("arevenue", async (ctx) => {
    if (!isAdmin(ctx)) return;
    const stats = getStats();
    const plans = Object.entries(PLANS)
      .filter(([k]) => k !== "trial")
      .map(([k, p]) => `${p.label}: ₦${Number(p.price).toLocaleString("en-NG")}`)
      .join("\n");

    await ctx.reply(
      `💰 *Revenue Report*\n\n` +
      `Total collected: *${fmt(stats.revenue)}*\n` +
      `Paying customers: ${stats.active}\n` +
      `Avg per customer: ${stats.active > 0 ? fmt(stats.revenue / stats.active) : "₦0"}\n\n` +
      `*Plan Pricing:*\n${plans}\n\n` +
      `Trial → Paid conversion: ${stats.total > 0 ? ((stats.active / stats.total) * 100).toFixed(1) : 0}%`,
      { parse_mode: "Markdown" }
    );
  });

  // ── /grantplan <tg_id> <plan> — manually grant any plan ───────
  bot.command("grantplan", async (ctx) => {
    if (!isAdmin(ctx)) return;
    const [targetId, planName] = ctx.args;
    if (!targetId || !planName) return ctx.reply("Usage: /grantplan <telegram_id> <monthly|yearly|lifetime>");
    if (!PLANS[planName] || planName === "trial") return ctx.reply("Invalid plan. Use: monthly, yearly, or lifetime");

    activateLicense(targetId, `MANUAL-${Date.now()}`, "manual", PLANS[planName].price, planName);

    await ctx.reply(`✅ *${PLANS[planName].label}* plan granted to \`${targetId}\``, { parse_mode: "Markdown" });

    try {
      const planInfo = PLANS[planName];
      await bot.telegram.sendMessage(targetId,
        `🎉 *ShopBoss ${planInfo.label} Access Activated!*\n\n` +
        `${planInfo.description}\n\nUse /start to continue. Enjoy! 🚀`,
        { parse_mode: "Markdown" }
      );
    } catch (_) {
      await ctx.reply("⚠️ Could not notify user (they may not have started the bot).");
    }
  });

  // ── /suspend <tg_id> — suspend a user ─────────────────────────
  bot.command("suspend", async (ctx) => {
    if (!isAdmin(ctx)) return;
    const targetId = ctx.args[0];
    if (!targetId) return ctx.reply("Usage: /suspend <telegram_id>");
    const { db } = require("../db/database");
    db.run("UPDATE licenses SET status='cancelled' WHERE telegram_id=?", [String(targetId)]);
    require("../db/database").save?.();
    await ctx.reply(`🔒 User \`${targetId}\` suspended.`, { parse_mode: "Markdown" });
  });

  // ── /broadcast <message> — message all active users ───────────
  bot.command("broadcast", async (ctx) => {
    if (!isAdmin(ctx)) return;
    const message = ctx.args.join(" ").trim();
    if (!message) return ctx.reply("Usage: /broadcast Your message here\n\nThis sends to ALL users with a Telegram ID.");

    const all = Signups.list(10000).filter(s => s.telegram_id);
    await ctx.reply(`📢 Sending to ${all.length} users…`);

    let sent = 0, failed = 0;
    for (const s of all) {
      try {
        await bot.telegram.sendMessage(s.telegram_id,
          `📢 *Message from ShopBoss*\n\n${message}`,
          { parse_mode: "Markdown" }
        );
        sent++;
        await new Promise(r => setTimeout(r, 50)); // rate limit
      } catch (_) { failed++; }
    }

    await ctx.reply(`✅ Broadcast complete\n\nSent: ${sent}\nFailed: ${failed}`);
  });

  // ── /tickets — view open support tickets ──────────────────────
  bot.command("tickets", async (ctx) => {
    if (!isAdmin(ctx)) return;
    const open = Tickets.list("open");
    if (!open.length) return ctx.reply("✅ No open support tickets.");

    const lines = open.slice(0, 10).map((t, i) =>
      `${i + 1}. *#${t.id}* — ${t.subject}\n` +
      `   From: \`${t.telegram_id}\`\n` +
      `   _${t.message.slice(0, 80)}${t.message.length > 80 ? "…" : ""}_`
    ).join("\n\n");

    await ctx.reply(`🎫 *Open Tickets (${open.length})*\n\n${lines}\n\nReply: /areply <id> <message>`, { parse_mode: "Markdown" });
  });

  // ── /areply <ticket_id> <message> — reply to support ticket ───
  bot.command("areply", async (ctx) => {
    if (!isAdmin(ctx)) return;
    const [ticketId, ...rest] = ctx.args;
    const reply = rest.join(" ").trim();
    if (!ticketId || !reply) return ctx.reply("Usage: /areply <ticket_id> <your reply message>");

    const ticket = Tickets.get(parseInt(ticketId));
    if (!ticket) return ctx.reply(`❌ Ticket #${ticketId} not found.`);

    Tickets.reply(parseInt(ticketId), reply);
    await ctx.reply(`✅ Replied to ticket #${ticketId}`);

    try {
      await bot.telegram.sendMessage(ticket.telegram_id,
        `💬 *ShopBoss Support — Ticket #${ticketId}*\n\n` +
        `*Your question:* ${ticket.subject}\n\n` +
        `*Our reply:*\n${reply}\n\n` +
        `If you need more help, use /support to open a new ticket.`,
        { parse_mode: "Markdown" }
      );
    } catch (_) {
      await ctx.reply("⚠️ Could not deliver reply to user.");
    }
  });

  // ── /ahealth — system health check ────────────────────────────
  bot.command("ahealth", async (ctx) => {
    if (!isAdmin(ctx)) return;
    const aiOk   = !!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY.includes("your_");
    const flwOk  = !!process.env.FLW_SECRET_KEY && !process.env.FLW_SECRET_KEY.includes("your_");
    const wh     = process.env.WEBHOOK_URL || "Not set";
    const uptime = Math.floor(process.uptime() / 60);

    await ctx.reply(
      `🏥 *System Health*\n\n` +
      `Bot: ✅ Running\n` +
      `Uptime: ${uptime} minutes\n` +
      `Webhook: ${wh}\n\n` +
      `🤖 AI (Anthropic): ${aiOk ? "✅ Configured" : "❌ Key missing"}\n` +
      `💳 Flutterwave: ${flwOk ? "✅ Configured" : "❌ Key missing"}\n\n` +
      `Environment: ${process.env.NODE_ENV || "development"}`,
      { parse_mode: "Markdown" }
    );
  });
}

module.exports = { registerAdmin };
