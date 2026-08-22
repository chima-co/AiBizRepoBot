// ─────────────────────────────────────────────────────────────────────────────
//  jobs.js — Scheduled background tasks
//  All jobs are wrapped in try/catch so one failure never kills the process.
//  Telegram send errors are silently ignored (user may have blocked the bot).
// ─────────────────────────────────────────────────────────────────────────────
const cron = require("node-cron");

// Helper — load db models lazily so this file can be required before DB is ready
function db() { return require("../db/database"); }
function pay() { return require("./payment"); }
const { fmt } = require("../utils/helpers");

// Send a Telegram message, silently ignoring all errors (block, timeout, etc.)
async function safeSend(bot, tgId, text, opts = {}) {
  try {
    await bot.telegram.sendMessage(tgId, text, { parse_mode: "Markdown", ...opts });
  } catch (_) {}
}

// Get all businesses that have a real Telegram ID to message
function getMessagableBusinesses() {
  const { Vendors } = db();
  try {
    // Vendors table has telegram_id for every bot user who ran /start
    return Vendors.list("All", 10000).filter(v => v.telegram_id);
  } catch (_) {
    return [];
  }
}

function startJobs(bot) {

  // ── Daily summary — 8 PM WAT (19:00 UTC) every day ───────────────────────
  cron.schedule("0 19 * * *", async () => {
    console.log("⏰ Daily summary job running…");
    try {
      const { Business, Analytics, Products } = db();
      const vendors = getMessagableBusinesses();
      for (const v of vendors) {
        try {
          const biz = Business.getOrCreate(v.telegram_id, v.name || "My Business");
          if (!biz) continue;
          const d        = Analytics.dashboard(biz.id);
          const lowItems = Products.lowStock(biz.id);
          // Only send if there was at least one sale today
          if (!d.today || d.today.count === 0) continue;
          let msg =
            `📅 *Daily Summary — ${biz.name}*\n\n` +
            `Revenue: *${fmt(d.today.revenue)}* (${d.today.count} sale${d.today.count !== 1 ? "s" : ""})\n` +
            `Profit: *${fmt(d.today.profit)}*\n`;
          if (lowItems.length) {
            msg += `\n⚠️ *Low Stock (${lowItems.length}):*\n` +
              lowItems.slice(0, 3).map(p => `• ${p.name}: ${p.stock} ${p.unit}`).join("\n") +
              `\n\nUse /stockin to restock.`;
          }
          await safeSend(bot, v.telegram_id, msg);
        } catch (_) {}
      }
    } catch (err) {
      console.error("Daily summary error:", err.message);
    }
  });

  // ── Low stock alerts — every 6 hours ─────────────────────────────────────
  cron.schedule("0 */6 * * *", async () => {
    console.log("⏰ Low stock check running…");
    try {
      const { Business, Products } = db();
      const vendors = getMessagableBusinesses();
      for (const v of vendors) {
        try {
          const biz      = Business.getOrCreate(v.telegram_id, v.name || "My Business");
          const lowItems = Products.lowStock(biz.id);
          if (!lowItems.length) continue;
          const names = lowItems.slice(0, 5).map(p => `• ${p.name}: ${p.stock} ${p.unit}`).join("\n");
          await safeSend(bot, v.telegram_id,
            `⚠️ *Low Stock Alert — ${biz.name}*\n\n${names}\n\nUse /stockin to restock.`
          );
        } catch (_) {}
      }
    } catch (err) {
      console.error("Low stock check error:", err.message);
    }
  });

  // ── Expiry reminders — daily at 9 AM WAT (08:00 UTC) ─────────────────────
  cron.schedule("0 8 * * *", async () => {
    console.log("⏰ Expiry reminder check…");
    try {
      const vendors = getMessagableBusinesses();
      for (const v of vendors) {
        try {
          const access = pay().checkAccess(v.telegram_id);
          if (access.status === "trial" && [3, 1].includes(access.daysLeft)) {
            await safeSend(bot, v.telegram_id,
              `⏰ *Trial Ending in ${access.daysLeft} Day${access.daysLeft === 1 ? "" : "s"}*\n\n` +
              `Your free trial expires soon. Choose a plan to keep your data and business running:\n\n` +
              `📅 Monthly — ₦9,500/month\n` +
              `📆 Yearly — ₦90,000/year\n` +
              `♾️ Lifetime — ₦999,999 once\n\n` +
              `Tap /pay to upgrade now.`
            );
          }
          if (access.status === "active" && ["monthly", "yearly"].includes(access.plan) && [7, 2].includes(access.daysLeft)) {
            await safeSend(bot, v.telegram_id,
              `⏰ *Plan Renewal Reminder*\n\n` +
              `Your *${access.plan}* plan expires in ${access.daysLeft} day${access.daysLeft === 1 ? "" : "s"}.\n\n` +
              `Renew now to avoid interruption → /pay`
            );
          }
        } catch (_) {}
      }
    } catch (err) {
      console.error("Expiry reminder error:", err.message);
    }
  });

  // ── Weekly report — Mondays 8 AM WAT (08:00 UTC) ─────────────────────────
  cron.schedule("0 8 * * 1", async () => {
    console.log("⏰ Weekly report job…");
    try {
      const { Business, Analytics, Sales } = db();
      const vendors = getMessagableBusinesses();
      for (const v of vendors) {
        try {
          const biz  = Business.getOrCreate(v.telegram_id, v.name || "My Business");
          const d    = Analytics.dashboard(biz.id);
          const week = Sales.thisWeek(biz.id);
          // Only send if they've had activity this week
          if (!week || week.count === 0) continue;
          await safeSend(bot, v.telegram_id,
            `📊 *Weekly Report — ${biz.name}*\n\n` +
            `💰 This week: *${fmt(week.revenue)}* (${week.count} sales)\n` +
            `📈 This month: *${fmt(d.month.revenue)}*\n` +
            `💵 Net profit: *${fmt(d.netProfit)}*\n` +
            `📦 Low stock items: ${d.lowStock}\n\n` +
            `Use /report for full breakdown.`
          );
        } catch (_) {}
      }
    } catch (err) {
      console.error("Weekly report error:", err.message);
    }
  });

  console.log("✅ Scheduled jobs started: daily summary, low stock, expiry reminders, weekly report");
}

module.exports = { startJobs };
