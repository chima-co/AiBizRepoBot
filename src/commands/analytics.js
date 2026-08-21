// ─────────────────────────────────────────────
//  analytics.js — /analytics /insights /ask /advice /alerts /summary
// ─────────────────────────────────────────────
const { Analytics, Sales, Expenses, Products } = require("../db/database");
const { fmt, getBusiness, safeReply } = require("../utils/helpers");
const { mainMenu } = require("../utils/keyboards");

function registerAnalytics(bot) {

  // /analytics
  bot.command("analytics", showAnalytics);
  bot.hears("📈 Analytics", showAnalytics);

  async function showAnalytics(ctx) {
    await ctx.sendChatAction("typing");
    const biz = getBusiness(ctx);
    const d = Analytics.dashboard(biz.id);
    const top = Sales.topProducts(biz.id, 5);
    const expCats = Expenses.byCategory(biz.id);

    const topStr = top.length
      ? top.map((p, i) => `${i + 1}. ${p.product_name} — ${fmt(p.total_revenue)} (${p.total_qty} units)`).join("\n")
      : "No sales recorded yet";

    const expStr = expCats.length
      ? expCats.map((c) => `${c.category}: ${fmt(c.total)}`).join("\n")
      : "No expenses this month";

    const margin = d.month.revenue > 0
      ? ((d.netProfit / d.month.revenue) * 100).toFixed(1)
      : "0";

    await safeReply(ctx,
      `📈 *Business Analytics*\n\n` +
      `*This Month*\n` +
      `Revenue: ${fmt(d.month.revenue)}\n` +
      `Gross Profit: ${fmt(d.month.profit)}\n` +
      `Expenses: ${fmt(d.expenses.total)}\n` +
      `Payroll: ${fmt(d.payroll.total)}\n` +
      `Net Profit: *${fmt(d.netProfit)}*\n` +
      `Profit Margin: *${margin}%*\n\n` +
      `*Top Products:*\n${topStr}\n\n` +
      `*Expense Breakdown:*\n${expStr}\n\n` +
      `*Inventory:*\n` +
      `Products: ${d.products.count}\n` +
      `Stock Value: ${fmt(d.stockValue)}\n` +
      `Low Stock: ${d.lowStock} items`,
      mainMenu()
    );
  }

  // /insights — AI-generated
  bot.command("insights", async (ctx) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      return safeReply(ctx, "🤖 AI insights require an Anthropic API key. Ask your admin to configure it.", mainMenu());
    }
    await ctx.sendChatAction("typing");
    const biz = getBusiness(ctx);
    await safeReply(ctx, "🤖 Analysing your business data...");
    try {
      const { generateInsights } = require("../services/ai");
      const { Settings } = require("../db/database");
      const industry = Settings.get(biz.id, "industry") || "Retail";
      const text = await generateInsights(biz.id, industry);
      await safeReply(ctx, `🤖 *AI Business Insights*\n\n${text}`, mainMenu());
    } catch (err) {
      console.error("AI insights error:", err.message);
      await safeReply(ctx, "⚠️ Could not generate insights right now. Please try again later.", mainMenu());
    }
  });

  // /advice
  bot.command("advice", async (ctx) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      return safeReply(ctx, "🤖 AI advice requires an Anthropic API key.", mainMenu());
    }
    await ctx.sendChatAction("typing");
    const biz = getBusiness(ctx);
    try {
      const { askAI } = require("../services/ai");
      const { Settings } = require("../db/database");
      const industry = Settings.get(biz.id, "industry") || "Retail";
      const advice = await askAI(biz.id, "Give me 3 specific, actionable business improvements I can make this week based on my data.", industry);
      await safeReply(ctx, `💡 *Business Advice*\n\n${advice}`, mainMenu());
    } catch (err) {
      console.error("AI advice error:", err.message);
      await safeReply(ctx, "⚠️ Could not generate advice right now.", mainMenu());
    }
  });

  // /summary
  bot.command("summary", async (ctx) => {
    await ctx.sendChatAction("typing");
    const biz = getBusiness(ctx);
    const d = Analytics.dashboard(biz.id);
    const top = Sales.topProducts(biz.id, 3);

    const topStr = top.length
      ? top.map((p) => `• ${p.product_name}: ${fmt(p.total_revenue)}`).join("\n")
      : "No sales recorded";

    await safeReply(ctx,
      `📋 *Business Summary — ${biz.name}*\n\n` +
      `📅 ${new Date().toLocaleDateString("en-NG", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}\n\n` +
      `*Today:* ${fmt(d.today.revenue)} revenue | ${d.today.count} sales\n` +
      `*This Month:* ${fmt(d.month.revenue)} revenue | Net: ${fmt(d.netProfit)}\n\n` +
      `*Top Sellers:*\n${topStr}\n\n` +
      `${d.lowStock > 0 ? `⚠️ ${d.lowStock} product(s) low on stock — /lowstock` : "✅ Stock levels OK"}\n` +
      `${d.pendingOrders > 0 ? `🚚 ${d.pendingOrders} pending order(s) — /delivery` : ""}`,
      mainMenu()
    );
  });

  // /alerts
  bot.command("alerts", async (ctx) => {
    await ctx.sendChatAction("typing");
    const biz = getBusiness(ctx);
    const d = Analytics.dashboard(biz.id);
    const lowItems = Products.lowStock(biz.id);

    const alerts = [];
    if (d.lowStock > 0) {
      const names = lowItems.slice(0, 3).map((p) => p.name).join(", ");
      alerts.push(`⚠️ *Low Stock:* ${d.lowStock} item(s) — ${names}`);
    }
    if (d.netProfit < 0) {
      alerts.push(`📉 *Profit Warning:* Net profit is negative this month (${fmt(d.netProfit)})`);
    }
    if (d.pendingOrders > 5) {
      alerts.push(`🚚 *Orders Backlog:* ${d.pendingOrders} pending orders need attention`);
    }
    if (d.today.count === 0) {
      alerts.push(`💰 *No Sales Today* — Record a sale with /sale`);
    }

    if (!alerts.length) {
      return safeReply(ctx, "✅ *No alerts — everything looks good!*", mainMenu());
    }

    await safeReply(ctx, `🔔 *Business Alerts*\n\n${alerts.join("\n\n")}`, mainMenu());
  });

  // /ask — AI chat with real data
  bot.command("ask", async (ctx) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      return safeReply(ctx, "🤖 AI features require an Anthropic API key. Contact your admin.", mainMenu());
    }
    const question = ctx.args.join(" ").trim();
    if (!question) {
      ctx.session.aiChat = true;
      return safeReply(ctx,
        `🤖 *Ask ShopBoss Anything*\n\nI can answer questions about your business:\n\n` +
        `• "How much did I make today?"\n` +
        `• "What products are selling best?"\n` +
        `• "Which items are low in stock?"\n` +
        `• "What were my biggest expenses?"\n` +
        `• "How is my profit this week?"\n\n` +
        `_Type your question now:_`,
        { reply_markup: { remove_keyboard: true } }
      );
    }
    await handleAIQuestion(ctx, question);
  });

  bot.hears("🤖 Ask ShopBoss", async (ctx) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      return safeReply(ctx,
        `🤖 *AI Not Configured*\n\n` +
        `The AI assistant needs an Anthropic API key.\n` +
        `Add ANTHROPIC_API_KEY in your Railway Variables.\n\n` +
        `All other features work normally.`,
        mainMenu()
      );
    }
    ctx.session.aiChat = true;
    await safeReply(ctx,
      `🤖 *Ask ShopBoss Anything*\n\nType your business question:`,
      { reply_markup: { remove_keyboard: true } }
    );
  });

  async function handleAIQuestion(ctx, question) {
    await ctx.sendChatAction("typing");
    const biz = getBusiness(ctx);
    try {
      const { askAI } = require("../services/ai");
      const { Settings } = require("../db/database");
      const ind = Settings.get(biz.id, "industry") || "Retail";
      const answer = await askAI(biz.id, question, ind);
      await safeReply(ctx, `🤖 *ShopBoss*\n\n${answer}`, mainMenu());
    } catch (err) {
      console.error("AI ask error:", err.message);
      await safeReply(ctx, "⚠️ Could not answer that right now. Please try again.", mainMenu());
    }
  }

  // AI chat text intercept
  bot.on("text", async (ctx, next) => {
    if (!ctx.session || !ctx.session.aiChat) return next();
    ctx.session.aiChat = false;
    const text = ctx.message.text.trim();
    if (text.startsWith("/") || text === "❌ Cancel") {
      return next();
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return safeReply(ctx,
        `🤖 AI features are not configured yet.

All other commands work normally. Contact /support for help.`,
        mainMenu()
      );
    }
    await handleAIQuestion(ctx, text);
  });
}

module.exports = { registerAnalytics };
