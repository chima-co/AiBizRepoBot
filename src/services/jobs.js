// ─────────────────────────────────────────────
//  jobs.js — Scheduled tasks
//  FIX: uses all() not db.prepare() (sql.js API)
// ─────────────────────────────────────────────
const cron = require("node-cron");
const { Analytics, Products, Settings, Signups } = require("../db/database");
const { fmt } = require("../utils/helpers");
const { checkAccess } = require("./payment");

function startJobs(bot) {

  // ── Daily summary at 8PM WAT (19:00 UTC) ──────────────────────
  cron.schedule("0 19 * * *", async () => {
    console.log("⏰ Daily summary job running…");
    try {
      const signups = Signups.list(10000);
      for (const s of signups) {
        if (!s.telegram_id) continue;
        const pref = Settings.get(null, "daily_summary"); // per-business later
        // Only send to opted-in users
        if (pref !== "on") continue;
        // Find matching business
        const { Business } = require("../db/database");
        const biz = Business.get(s.telegram_id);
        if (!biz) continue;
        const d = Analytics.dashboard(biz.id);
        const lowItems = Products.lowStock(biz.id);
        let msg = `📅 *Daily Summary — ${biz.name}*\n\n` +
          `Revenue: *${fmt(d.today.revenue)}* (${d.today.count} sales)\n` +
          `Profit: *${fmt(d.today.profit)}*\n`;
        if (lowItems.length) {
          msg += `\n⚠️ *Low Stock:*\n` + lowItems.slice(0, 3).map(p => `• ${p.name}: ${p.stock} ${p.unit}`).join("\n");
        }
        await bot.telegram.sendMessage(s.telegram_id, msg, { parse_mode: "Markdown" }).catch(() => {});
      }
    } catch (err) {
      console.error("Daily summary error:", err.message);
    }
  });

  // ── Low stock check every 6 hours ─────────────────────────────
  cron.schedule("0 */6 * * *", async () => {
    console.log("⏰ Low stock check running…");
    try {
      const signups = Signups.list(10000);
      for (const s of signups) {
        if (!s.telegram_id) continue;
        const { Business } = require("../db/database");
        const biz = Business.get(s.telegram_id);
        if (!biz) continue;
        // Low stock alerts sent to all users with telegram_id
        // Future: per-user opt-in via /notify command
        const lowItems = Products.lowStock(biz.id);
        if (!lowItems.length) continue;
        const names = lowItems.slice(0, 5).map(p => `• ${p.name}: ${p.stock} ${p.unit}`).join("\n");
        await bot.telegram.sendMessage(s.telegram_id,
          `⚠️ *Low Stock Alert*\n\n${names}\n\nUse /stockin to restock.`,
          { parse_mode: "Markdown" }
        ).catch(() => {});
      }
    } catch (err) {
      console.error("Low stock check error:", err.message);
    }
  });

  // ── Plan expiry reminders — daily at 9AM WAT (08:00 UTC) ──────
  cron.schedule("0 8 * * *", async () => {
    console.log("⏰ Expiry reminder check…");
    try {
      const signups = Signups.list(10000);
      for (const s of signups) {
        if (!s.telegram_id) continue;
        const access = checkAccess(s.telegram_id);
        // Trial — warn at 3 days and 1 day left
        if (access.status === "trial" && [3, 1].includes(access.daysLeft)) {
          await bot.telegram.sendMessage(s.telegram_id,
            `⏰ *Trial Ending in ${access.daysLeft} Day${access.daysLeft === 1 ? "" : "s"}*\n\n` +
            `Your free trial expires soon. Choose a plan to keep managing your business:\n\n` +
            `📅 Monthly — ₦9,500\n📆 Yearly — ₦90,000\n♾️ Lifetime — ₦299,999\n\nUse /pay to upgrade.`,
            { parse_mode: "Markdown" }
          ).catch(() => {});
        }
        // Monthly/Yearly — warn at 7 days and 2 days
        if (access.status === "active" && ["monthly","yearly"].includes(access.plan) && [7, 2].includes(access.daysLeft)) {
          await bot.telegram.sendMessage(s.telegram_id,
            `⏰ *Plan Renewal Reminder*\n\n` +
            `Your *${access.plan}* plan expires in ${access.daysLeft} day${access.daysLeft === 1 ? "" : "s"}.\n\n` +
            `Renew now to avoid any interruption. Use /pay.`,
            { parse_mode: "Markdown" }
          ).catch(() => {});
        }
      }
    } catch (err) {
      console.error("Expiry reminder error:", err.message);
    }
  });

  // ── Weekly business report — Mondays at 8AM WAT ───────────────
  cron.schedule("0 8 * * 1", async () => {
    console.log("⏰ Weekly report job…");
    try {
      const signups = Signups.list(10000);
      for (const s of signups) {
        if (!s.telegram_id) continue;
        const { Business } = require("../db/database");
        const biz = Business.get(s.telegram_id);
        if (!biz) continue;
        // Weekly report sent to all users with telegram_id
        const d = Analytics.dashboard(biz.id);
        const { Sales } = require("../db/database");
        const week = Sales.thisWeek(biz.id);
        await bot.telegram.sendMessage(s.telegram_id,
          `📊 *Weekly Report — ${biz.name}*\n\n` +
          `💰 This week: ${fmt(week.revenue)} (${week.count} sales)\n` +
          `📈 This month: ${fmt(d.month.revenue)}\n` +
          `💵 Net profit: ${fmt(d.netProfit)}\n` +
          `📦 Low stock items: ${d.lowStock}\n\n` +
          `Use /analytics for the full report.`,
          { parse_mode: "Markdown" }
        ).catch(() => {});
      }
    } catch (err) {
      console.error("Weekly report error:", err.message);
    }
  });

  console.log("✅ Scheduled jobs started (daily summary, low stock, expiry reminders, weekly report)");
}

module.exports = { startJobs };
