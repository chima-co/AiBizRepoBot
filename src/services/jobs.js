// ─────────────────────────────────────────────
//  jobs.js — Automated scheduled tasks
//  Only runs if the user has opted in via settings
// ─────────────────────────────────────────────
const cron = require("node-cron");
const { db, Analytics, Products, Settings } = require("../db/database");
const { fmt } = require("../utils/helpers");

function startJobs(bot) {
  // Daily summary at 8PM Lagos time (UTC+1 = 19:00 UTC)
  cron.schedule("0 19 * * *", async () => {
    console.log("⏰ Running daily summary job...");
    try {
      const businesses = db.prepare("SELECT * FROM businesses").all();
      for (const biz of businesses) {
        // Only send if user opted in
        const pref = Settings.get(biz.id, "daily_summary");
        if (pref !== "on") continue;

        const d = Analytics.dashboard(biz.id);
        const lowItems = Products.lowStock(biz.id);

        let msg = `📅 *Daily Summary — ${biz.name}*\n\n` +
          `Today's Revenue: *${fmt(d.today.revenue)}*\n` +
          `Sales Count: ${d.today.count}\n` +
          `Today's Profit: *${fmt(d.today.profit)}*\n`;

        if (lowItems.length > 0) {
          msg += `\n⚠️ *Low Stock Alert:*\n`;
          msg += lowItems.slice(0, 3).map((p) => `• ${p.name}: ${p.stock} ${p.unit} left`).join("\n");
        }

        await bot.telegram.sendMessage(biz.telegram_id, msg, { parse_mode: "Markdown" });
      }
    } catch (err) {
      console.error("Daily summary job error:", err.message);
    }
  });

  // Low stock check every 6 hours
  cron.schedule("0 */6 * * *", async () => {
    console.log("⏰ Running low stock check...");
    try {
      const businesses = db.prepare("SELECT * FROM businesses").all();
      for (const biz of businesses) {
        const pref = Settings.get(biz.id, "low_stock_alerts");
        if (pref !== "on") continue;
        const lowItems = Products.lowStock(biz.id);
        if (!lowItems.length) continue;

        const names = lowItems.slice(0, 5).map((p) => `• ${p.name}: ${p.stock} ${p.unit}`).join("\n");
        await bot.telegram.sendMessage(
          biz.telegram_id,
          `⚠️ *Low Stock Alert*\n\n${names}\n\nUse /stockin to restock.`,
          { parse_mode: "Markdown" }
        );
      }
    } catch (err) {
      console.error("Low stock check error:", err.message);
    }
  });

  console.log("✅ Scheduled jobs started");
}

module.exports = { startJobs };
