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
  // /report — weekly/monthly business report
  bot.command("report", async (ctx) => {
    await ctx.sendChatAction("typing");
    const biz = getBusiness(ctx);
    const { Sales, Expenses, Payroll, Products } = require("../db/database");
    const month = Sales.thisMonth(biz.id);
    const week  = Sales.thisWeek(biz.id);
    const exp   = Expenses.thisMonth(biz.id);
    const pay   = Payroll.thisMonth(biz.id);
    const low   = Products.lowStock(biz.id);
    const top   = Sales.topProducts(biz.id, 3);
    const net   = month.profit - exp.total - pay.total;
    const margin = month.revenue > 0 ? ((net/month.revenue)*100).toFixed(1) : "0";
    const topStr = top.length ? top.map((p,i) => `${i+1}. ${p.product_name} — ${fmt(p.total_revenue)}`).join("\n") : "No sales yet";
    const d = new Date().toLocaleDateString("en-NG", { month:"long", year:"numeric" });

    await safeReply(ctx,
      `📊 *Business Report — ${d}*\n` +
      `Business: *${biz.name}*\n` +
      `━━━━━━━━━━━━━━━━\n\n` +
      `*📅 This Week*\n` +
      `Revenue: ${fmt(week.revenue)} | Sales: ${week.count}\n\n` +
      `*📆 This Month*\n` +
      `Revenue: *${fmt(month.revenue)}*\n` +
      `Gross Profit: ${fmt(month.profit)}\n` +
      `Expenses: −${fmt(exp.total)}\n` +
      `Payroll: −${fmt(pay.total)}\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `Net Profit: *${fmt(net)}*\n` +
      `Profit Margin: *${margin}%*\n\n` +
      `*🏆 Top Products*\n${topStr}\n\n` +
      `${low.length > 0 ? `*⚠️ Low Stock (${low.length}):*\n${low.slice(0,3).map(p=>`• ${p.name}: ${p.stock} ${p.unit}`).join("\n")}` : "*✅ Stock levels OK*"}\n\n` +
      `_Use /insights for AI-powered analysis_`,
      mainMenu()
    );
  });

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
    // Rate limit: max 20 AI questions per hour per user
    const { RateLimit } = require("../db/database");
    const rl = RateLimit.check(ctx.from.id, "ask_ai", 20);
    if (!rl.allowed) {
      return safeReply(ctx,
        `⏳ *Rate limit reached*

You've asked ${20} questions this hour. Please wait ${rl.resetIn} minute(s) before asking again.`,
        mainMenu()
      );
    }
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

  // AI chat text intercept — always reset after one message
  bot.on("text", async (ctx, next) => {
    const txt = ctx.message?.text?.trim() || "";

    // ── setRates flow (Crypto & Gift Cards businesses) ──────────────────────────
    if (ctx.session?.setRates) {
      const step = ctx.session.setRates.step;
      const val  = parseFloat(txt.replace(/[,₦\s]/g, ""));
      if (isNaN(val) || val < 100) return safeReply(ctx, "⚠️ Enter a valid rate (e.g. 1590)");
      const { Vendors } = require("../db/database");
      const v = Vendors.getByTgId(ctx.from.id);

      if (step === "buy") {
        ctx.session.setRates = { step: "sell", buyRate: val };
        return safeReply(ctx,
          `✅ Buy rate set: *₦${val.toLocaleString("en-NG")}/USDT*

Now enter your *SELL rate* (₦ per USDT).
This is the rate at which you SELL USDT to customers.
_(e.g. 1610)_`,
          { parse_mode: "Markdown" }
        );
      }

      if (step === "sell") {
        const buyRate  = ctx.session.setRates.buyRate;
        const sellRate = val;
        const spread   = (sellRate - buyRate).toFixed(2);
        ctx.session.setRates = undefined;

        const { Vendors } = require("../db/database");
        const vv = Vendors.getByTgId(ctx.from.id);
        if (vv) Vendors.updateRates(ctx.from.id, buyRate, sellRate);
        const spreadComment = spread > 0
          ? spread >= 20 ? "💰 Strong spread" : spread >= 10 ? "👍 Fair spread" : "⚠️ Very thin — consider widening"
          : "❌ Sell rate lower than buy rate — check your figures";

        return safeReply(ctx,
          `✅ *Rates Updated!*

` +
          `📈 Buy Rate:  *₦${Number(buyRate).toLocaleString("en-NG")}/USDT*
` +
          `📉 Sell Rate: *₦${Number(sellRate).toLocaleString("en-NG")}/USDT*
` +
          `💰 Spread:   *₦${spread}/USDT*

` +
          `${spreadComment}

` +
          `Your rates are now live on the ShopBoss marketplace.
Use /p2pstats to see your full profile.`,
          { parse_mode: "Markdown" }
        );
      }
    }

    // ── setLimits flow ────────────────────────────────────────────────
    if (ctx.session?.setLimits) {
      const step = ctx.session.setLimits.step;
      const val  = parseFloat(txt.replace(/[,₦\s]/g, ""));
      if (isNaN(val) || val < 1000) return safeReply(ctx, "⚠️ Enter a valid amount in ₦ (e.g. 10000)");

      if (step === "min") {
        ctx.session.setLimits = { step: "max", min: val };
        return safeReply(ctx,
          `✅ Minimum: *₦${val.toLocaleString("en-NG")}*

Now enter your *maximum* order size in ₦:
_(e.g. 2000000 for ₦2,000,000 max)_`,
          { parse_mode: "Markdown" }
        );
      }

      if (step === "max") {
        const min = ctx.session.setLimits.min;
        ctx.session.setLimits = undefined;
        if (val <= min) return safeReply(ctx, "⚠️ Max must be greater than min. Try again:");
        const { Vendors } = require("../db/database");
        const v = Vendors.getByTgId(ctx.from.id);
        const { Vendors: V2 } = require("../db/database");
        const vv2 = V2.getByTgId(ctx.from.id);
        if (vv2) { V2.updateField(ctx.from.id, "order_min", min); V2.updateField(ctx.from.id, "order_max", val); }
        return safeReply(ctx,
          `✅ *Order Limits Updated*

Min: *₦${min.toLocaleString("en-NG")}*
Max: *₦${val.toLocaleString("en-NG")}*

These are now visible on your marketplace profile.`,
          { parse_mode: "Markdown" }
        );
      }
    }

    // ── setCR flow (completion rate) ──────────────────────────────────
    if (ctx.session?.setCR) {
      ctx.session.setCR = undefined;
      const val = parseFloat(txt.replace(/[%\s]/g, ""));
      if (isNaN(val) || val < 0 || val > 100) return safeReply(ctx, "⚠️ Enter a number between 0 and 100 (e.g. 97.5)");
      const { Vendors } = require("../db/database");
      const v = Vendors.getByTgId(ctx.from.id);
      const { Vendors: V3 } = require("../db/database");
      const vv3 = V3.getByTgId(ctx.from.id);
      if (vv3) V3.updateField(ctx.from.id, "completion_rate", val);
      const comment = val >= 97 ? "🏆 Excellent — you'll rank highly" : val >= 90 ? "👍 Good — keep it above 95% for best visibility" : "⚠️ Below 90% will restrict your platform ranking. Cancel fewer orders.";
      return safeReply(ctx,
        `✅ Completion rate saved: *${val}%*

${comment}`,
        { parse_mode: "Markdown" }
      );
    }

    // ── AI chat flow ──────────────────────────────────────────────────
    if (!ctx.session?.aiChat) return next();
    // Always reset immediately so no messages are trapped
    ctx.session.aiChat = false;
    const text = ctx.message.text.trim();
    // Let keyboard buttons and commands through
    if (text.startsWith("/") || text === "❌ Cancel" || text === "⬅️ Back to Menu" ||
        text.includes("Dashboard") || text.includes("Sales") || text.includes("Inventory") ||
        text.includes("Analytics") || text.includes("Payroll") || text.includes("Suppliers") ||
        text.includes("Deliveries") || text.includes("Ask ShopBoss") || text.includes("Settings") ||
        text.includes("Help")) {
      return next();
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return safeReply(ctx,
        `🤖 AI is not configured yet.\n\nAll other commands work normally. Type /support for help.`,
        mainMenu()
      );
    }
    await handleAIQuestion(ctx, text);
  });
}

module.exports = { registerAnalytics };
