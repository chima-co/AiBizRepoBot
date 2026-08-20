// ─────────────────────────────────────────────
//  admin.js — Owner-only admin commands
//  Protected by your personal Telegram ID
// ─────────────────────────────────────────────
const { Markup } = require("telegraf");
const { getAllLicenses, getStats, activateLicense, checkAccess } = require("../services/payment");

// Your personal Telegram ID — set in env var ADMIN_TELEGRAM_ID
function isAdmin(ctx) {
  const adminId = process.env.ADMIN_TELEGRAM_ID;
  if (!adminId) return false;
  return String(ctx.from?.id) === String(adminId);
}

function registerAdmin(bot) {

  // /admin — main admin panel
  bot.command("admin", async (ctx) => {
    if (!isAdmin(ctx)) return; // Silent — don't reveal command exists

    const stats = getStats();
    await ctx.reply(
      `🔐 *ShopBoss Admin Panel*\n\n` +
      `📊 *License Stats:*\n` +
      `Total users: ${stats.total}\n` +
      `✅ Active (paid): ${stats.active}\n` +
      `⏳ On trial: ${stats.trial}\n` +
      `❌ Expired: ${stats.expired}\n\n` +
      `💰 *Total Revenue: ₦${Number(stats.revenue).toLocaleString("en-NG")}*\n\n` +
      `_Commands: /licenses /activate /revenue_`,
      { parse_mode: "Markdown" }
    );
  });

  // /licenses — list all users
  bot.command("licenses", async (ctx) => {
    if (!isAdmin(ctx)) return;

    const all = getAllLicenses();
    if (!all.length) return ctx.reply("No licenses yet.");

    const lines = all.slice(0, 20).map((l, i) =>
      `${i + 1}. ID: \`${l.telegram_id}\` — *${l.status.toUpperCase()}*` +
      (l.paid_at ? ` — ₦${Number(l.amount_paid || 0).toLocaleString()}` : "")
    ).join("\n");

    await ctx.reply(
      `📋 *Licenses (latest 20)*\n\n${lines}`,
      { parse_mode: "Markdown" }
    );
  });

  // /activate <telegram_id> — manually activate a user (e.g. after manual bank transfer)
  bot.command("activate", async (ctx) => {
    if (!isAdmin(ctx)) return;
    const targetId = ctx.args[0];
    if (!targetId) return ctx.reply("Usage: /activate <telegram_id>");

    activateLicense(targetId, `MANUAL-${Date.now()}`, "manual", 125000);

    await ctx.reply(`✅ License activated for Telegram ID: \`${targetId}\``, { parse_mode: "Markdown" });

    // Notify the user
    try {
      await bot.telegram.sendMessage(
        targetId,
        `🎉 *Your ShopBoss access has been activated!*\n\n` +
        `✅ Lifetime access — never expires.\n\nUse /start to begin! 🚀`,
        { parse_mode: "Markdown" }
      );
    } catch (e) {
      await ctx.reply(`⚠️ Could not notify user (they may not have started the bot yet).`);
    }
  });

  // /revenue — financial summary for owner
  bot.command("revenue", async (ctx) => {
    if (!isAdmin(ctx)) return;

    const stats = getStats();
    await ctx.reply(
      `💰 *Revenue Summary*\n\n` +
      `Paying customers: ${stats.active}\n` +
      `Price per user: ₦125,000\n` +
      `Total collected: *₦${Number(stats.revenue).toLocaleString("en-NG")}*\n\n` +
      `Trial users (potential): ${stats.trial}\n` +
      `Expired (churned): ${stats.expired}`,
      { parse_mode: "Markdown" }
    );
  });
}

module.exports = { registerAdmin };
