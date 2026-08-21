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
    // Prompt industry setup for new businesses (no industry set yet)
    const { Settings } = require("../db/database");
    const hasIndustry = Settings.get(biz.id, "industry");
    if (!hasIndustry) {
      // Queue industry prompt after welcome
      setTimeout(async () => {
        try {
          const { Markup } = require("telegraf");
          await ctx.reply(
            "🏭 *One quick setup:*\n\nWhat industry is your business in? This helps the AI give you relevant advice.",
            { parse_mode: "Markdown", ...Markup.inlineKeyboard([
              [Markup.button.callback("🌾 Agriculture", "setind:Agriculture"), Markup.button.callback("🚚 Logistics", "setind:Logistics")],
              [Markup.button.callback("🏪 Retail", "setind:Retail"), Markup.button.callback("🍕 Food & Beverage", "setind:Food & Beverage")],
              [Markup.button.callback("🏭 Manufacturing", "setind:Manufacturing"), Markup.button.callback("🤝 Wholesale", "setind:Wholesale")],
              [Markup.button.callback("📋 See all 24 industries", "change_industry")],
            ])
          });
        } catch(_) {}
      }, 1500);
    }

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

    // Marketplace sales stats
    const { MarketplaceSales, Settings } = require("../db/database");
    const mpStats = MarketplaceSales.stats(ctx.from.id);
    const industry = Settings.get(biz.id, "industry");

    await safeReply(ctx,
      `📊 *${biz.name} — Dashboard*` +
      (industry ? ` _(${industry})_` : "") + `\n\n` +
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
      `🚚 Pending: ${d.pendingOrders} order(s)\n\n` +
      `*Marketplace*\n` +
      `🛍️ Sales Completed: ${mpStats.seller.cnt}\n` +
      `💰 Marketplace Revenue: ${fmt(mpStats.seller.total)}\n` +
      `📦 Purchases Made: ${mpStats.buyer.cnt}`,
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

  // /setindustry — set business industry for AI context
  bot.command("setindustry", async (ctx) => {
    const { Markup } = require("telegraf");
    const INDS = ["Agriculture","Logistics","Shipping","Warehousing","Manufacturing","Retail",
      "Wholesale","Pharmacy","Fashion","Food & Beverage","Tech & Repairs","Energy",
      "Construction","Beauty","Education","Hospitality","Agro-Processing","Printing",
      "Security","Healthcare","Auto & Transport","ICT","Finance","Export/Import"];
    const buttons = [];
    for (let i = 0; i < INDS.length; i += 2) {
      const row = [Markup.button.callback(INDS[i], `setind:${INDS[i]}`)];
      if (INDS[i+1]) row.push(Markup.button.callback(INDS[i+1], `setind:${INDS[i+1]}`));
      buttons.push(row);
    }
    await safeReply(ctx, "🏭 *Select Your Industry*\n\nThis helps ShopBoss AI give you relevant insights and connects you with the right marketplace partners:", {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard(buttons),
    });
  });

  bot.action(/^setind:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const biz = getBusiness(ctx);
    const industry = ctx.match[1];
    require("../db/database").Settings.set(biz.id, "industry", industry);
    await ctx.editMessageText(
      `✅ Industry set to: *${industry}*\n\nShopBoss AI will now give you ${industry}-specific insights and recommendations.\n\nType /workflow to see your industry tools.`,
      { parse_mode: "Markdown" }
    );
  });

  // /workflow — industry-specific quick actions
  bot.command("workflow", async (ctx) => {
    await ctx.sendChatAction("typing");
    const biz = getBusiness(ctx);
    const { Settings } = require("../db/database");
    const { getIndustryWorkflow } = require("../services/ai");
    const industry = Settings.get(biz.id, "industry") || "Retail";
    const wf = getIndustryWorkflow(industry);
    const { Markup } = require("telegraf");

    const quickBtns = wf.quickActions.map(a => [Markup.button.callback(a, "noop")]);

    await safeReply(ctx,
      `⚡ *${industry} Workflow*\n\n` +
      `*Key Insights to Track:*\n${wf.insights.map(i => `• ${i}`).join("\n")}\n\n` +
      `*Recommended Commands:*\n${wf.commands.map(c => `• ${c}`).join("\n")}\n\n` +
      `*Quick Actions:*`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          ...quickBtns,
          [Markup.button.callback("🏭 Change Industry", "change_industry")],
        ]),
      }
    );
  });

  bot.action("noop", async (ctx) => { await ctx.answerCbQuery(); });
  bot.action("change_industry", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.deleteMessage().catch(() => {});
    const { Markup } = require("telegraf");
    const INDS = ["Agriculture","Logistics","Shipping","Warehousing","Manufacturing","Retail",
      "Wholesale","Pharmacy","Fashion","Food & Beverage","Tech & Repairs","Energy",
      "Construction","Beauty","Education","Hospitality","Agro-Processing","Printing",
      "Security","Healthcare","Auto & Transport","ICT","Finance","Export/Import"];
    const buttons = [];
    for (let i = 0; i < INDS.length; i += 2) {
      const row = [Markup.button.callback(INDS[i], `setind:${INDS[i]}`)];
      if (INDS[i+1]) row.push(Markup.button.callback(INDS[i+1], `setind:${INDS[i+1]}`));
      buttons.push(row);
    }
    await safeReply(ctx, "🏭 Select your industry:", { ...Markup.inlineKeyboard(buttons) });
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
