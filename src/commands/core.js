// ─────────────────────────────────────────────
//  core.js — /start /help /menu /dashboard
// ─────────────────────────────────────────────
const { Analytics } = require("../db/database");
const { fmt, getBusiness, safeReply } = require("../utils/helpers");
const { mainMenu } = require("../utils/keyboards");

function registerCore(bot) {
  // /start — FIX 5: clear ALL stuck session state so users are never trapped
  bot.start(async (ctx) => {
    ctx.session = {}; // wipe any stuck flow (sale, product, expense, etc.)
    const biz = getBusiness(ctx);
    const name = ctx.from.first_name || "Boss";
    await safeReply(ctx,
      `👋 *Welcome to ShopBoss, ${name}!*\n\n` +
      `I'm your AI-powered business manager. I help you track:\n\n` +
      `💰 Sales & Revenue\n` +
      `📦 Inventory & Stock\n` +
      `💸 Expenses & Profit\n` +
      `🚚 Orders & Deliveries\n` +
      `👥 Staff & Payroll\n` +
      `🤝 Suppliers & Purchases\n` +
      `📈 Business Analytics\n` +
      `🤖 AI Business Insights\n\n` +
      `Your business: *${biz.name}*\n\n` +
      `Tap a button below or type a command to get started.`,
      mainMenu()
    );
  });

  // /help
  bot.command("help", async (ctx) => {
    await safeReply(ctx,
      `*ShopBoss Commands*\n\n` +
      `*📊 Overview*\n` +
      `/dashboard — Business snapshot\n` +
      `/today — Today's summary\n` +
      `/analytics — Full analytics\n\n` +
      `*💰 Sales*\n` +
      `/sale — Record a sale\n` +
      `/sales — Recent sales\n` +
      `/revenue — Revenue report\n` +
      `/profit — Profit report\n\n` +
      `*📦 Inventory*\n` +
      `/inventory — View all stock\n` +
      `/product — Add a product\n` +
      `/stockin — Add stock\n` +
      `/stockout — Remove stock\n` +
      `/lowstock — Low stock alerts\n` +
      `/reorder — Reorder suggestions\n\n` +
      `*💸 Expenses*\n` +
      `/expense — Record expense\n` +
      `/expenses — Expense list\n\n` +
      `*🚚 Orders & Delivery*\n` +
      `/orders — View orders\n` +
      `/order — Create order\n` +
      `/delivery — Delivery status\n` +
      `/track — Track an order\n\n` +
      `*👥 Staff & Payroll*\n` +
      `/staff — Manage staff\n` +
      `/payroll — Record salary payment\n\n` +
      `*🤝 Suppliers*\n` +
      `/suppliers — View suppliers\n` +
      `/purchases — Record purchase\n\n` +
      `*🤖 AI*\n` +
      `/ask — Ask ShopBoss anything\n` +
      `/insights — AI business report\n` +
      `/advice — Get business advice\n\n` +
      `*⚙️ Other*\n` +
      `/settings — Business settings\n` +
      `/alerts — View alerts\n` +
      `/support — Get help`,
      mainMenu()
    );
  });

  // /menu
  bot.command("menu", async (ctx) => {
    await safeReply(ctx, "📋 *Main Menu* — Choose an option:", mainMenu());
  });
  bot.hears("⬅️ Back to Menu", async (ctx) => {
    await safeReply(ctx, "📋 *Main Menu*", mainMenu());
  });

  // /dashboard and button
  async function showDashboard(ctx) {
    await ctx.sendChatAction("typing");
    const biz = getBusiness(ctx);
    const d = Analytics.dashboard(biz.id);

    const profitEmoji = d.netProfit >= 0 ? "📈" : "📉";
    const stockEmoji = d.lowStock > 0 ? "⚠️" : "✅";

    await safeReply(ctx,
      `📊 *${biz.name} — Dashboard*\n\n` +
      `*Today*\n` +
      `💰 Revenue: ${fmt(d.today.revenue)}\n` +
      `📦 Sales: ${d.today.count} transaction(s)\n` +
      `💵 Profit: ${fmt(d.today.profit)}\n\n` +
      `*This Month*\n` +
      `💰 Revenue: ${fmt(d.month.revenue)}\n` +
      `📦 Total Sales: ${d.month.count}\n` +
      `💵 Gross Profit: ${fmt(d.month.profit)}\n` +
      `💸 Expenses: ${fmt(d.expenses.total)}\n` +
      `👥 Payroll: ${fmt(d.payroll.total)}\n` +
      `${profitEmoji} Net Profit: *${fmt(d.netProfit)}*\n\n` +
      `*Inventory*\n` +
      `📦 Products: ${d.products.count}\n` +
      `${stockEmoji} Low Stock: ${d.lowStock} item(s)\n` +
      `💎 Stock Value: ${fmt(d.stockValue)}\n\n` +
      `*Orders*\n` +
      `🚚 Pending: ${d.pendingOrders} order(s)`,
      mainMenu()
    );
  }

  bot.command("dashboard", showDashboard);
  bot.hears("📊 Dashboard", showDashboard);

  // /today
  bot.command("today", async (ctx) => {
    await ctx.sendChatAction("typing");
    const biz = getBusiness(ctx);
    const t = Analytics.dashboard(biz.id).today;
    const exp = require("../db/database").Expenses.today(biz.id);

    await safeReply(ctx,
      `📅 *Today's Summary*\n\n` +
      `💰 Revenue: *${fmt(t.revenue)}*\n` +
      `📦 Sales: ${t.count} transaction(s)\n` +
      `💵 Gross Profit: *${fmt(t.profit)}*\n` +
      `💸 Expenses: ${fmt(exp.total)}\n` +
      `📊 Net: *${fmt(t.profit - exp.total)}*`,
      mainMenu()
    );
  });

  // Settings
  bot.command("settings", async (ctx) => {
    const biz = getBusiness(ctx);
    await safeReply(ctx,
      `⚙️ *Settings*\n\n` +
      `Business: *${biz.name}*\n` +
      `ID: \`${biz.telegram_id}\`\n\n` +
      `To rename your business:\n/setname Your Business Name`,
      mainMenu()
    );
  });

  bot.command("setname", async (ctx) => {
    const newName = ctx.args.join(" ").trim();
    if (!newName) return safeReply(ctx, "Usage: /setname My Shop Name");
    const biz = getBusiness(ctx);
    require("../db/database").Business.update(biz.id, newName);
    await safeReply(ctx, `✅ Business renamed to: *${newName}*`, mainMenu());
  });

  // Support / Privacy / Terms
  bot.command("support", async (ctx) => {
    await safeReply(ctx,
      `💬 *ShopBoss Support*\n\n` +
      `For help, contact:\n📧 support@shopboss.ng\n\n` +
      `Or use /help to see all commands.`,
      mainMenu()
    );
  });
  bot.command("privacy", async (ctx) => {
    await safeReply(ctx, `🔒 *Privacy*\n\nYour business data is stored securely and never shared with third parties.`, mainMenu());
  });
  bot.command("terms", async (ctx) => {
    await safeReply(ctx, `📄 *Terms*\n\nBy using ShopBoss you agree to use it responsibly for legitimate business management.`, mainMenu());
  });
}

module.exports = { registerCore };
