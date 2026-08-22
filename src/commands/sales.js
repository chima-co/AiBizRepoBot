// ─────────────────────────────────────────────
//  sales.js — /sale /sales /revenue /profit
// ─────────────────────────────────────────────
const { Sales, Products } = require("../db/database");
const { fmt, fmtDate, getBusiness, safeReply, parseNumber } = require("../utils/helpers");
const { mainMenu, cancelMenu } = require("../utils/keyboards");
const { Markup } = require("telegraf");

function registerSales(bot) {

  // ── /sale — guided sale flow ──────────────
  bot.command("sale", async (ctx) => {
    // Quick sale: /sale ProductName Quantity Price  e.g. /sale Rice 5 2500
    if (ctx.args.length >= 3) {
      const biz = getBusiness(ctx);
      const rawQty   = parseNumber(ctx.args[ctx.args.length - 2]);
      const rawPrice = parseNumber(ctx.args[ctx.args.length - 1]);
      const rawName  = ctx.args.slice(0, ctx.args.length - 2).join(" ");
      if (rawQty && rawPrice && rawName) {
        const found = Products.findByName(biz.id, rawName);
        if (found && found.stock < rawQty) {
          return safeReply(ctx, `⚠️ Only ${found.stock} ${found.unit} of *${found.name}* in stock.`, mainMenu());
        }
        const result = Sales.record(biz.id, {
          product_id: found?.id || null,
          product_name: found?.name || rawName,
          quantity: rawQty,
          sell_price: rawPrice,
          cost_price: found?.cost_price || 0,
        });
        const remaining = found ? found.stock - rawQty : null;
        return safeReply(ctx,
          `✅ *Sale Recorded!*\n\n` +
          `Product: ${found?.name || rawName}\n` +
          `Quantity: ${rawQty}\n` +
          `Revenue: *${fmt(result.revenue)}*\n` +
          (result.profit ? `Profit: *${fmt(result.profit)}*\n` : "") +
          (remaining !== null ? `Remaining Stock: ${remaining}\n` : "") +
          `Sale ID: #${result.id}`,
          mainMenu()
        );
      }
    }
    await startSale(ctx);
  });
  bot.hears("💰 Sales", async (ctx) => {
    const biz = getBusiness(ctx);
    const recent = Sales.list(biz.id, 5);
    const month = Sales.thisMonth(biz.id);

    if (!recent.length) {
      await safeReply(ctx,
        `💰 *Sales*\n\nNo sales recorded yet.\n\nTap *Record Sale* to get started!`,
        { ...Markup.inlineKeyboard([[Markup.button.callback("💰 Record Sale", "start_sale")]]), ...mainMenu() }
      );
      return;
    }

    const list = recent.map((s, i) =>
      `${i + 1}. ${s.product_name} × ${s.quantity} — ${fmt(s.revenue)}`
    ).join("\n");

    await safeReply(ctx,
      `💰 *Sales Overview*\n\n` +
      `*This Month:*\n` +
      `Revenue: ${fmt(month.revenue)} | Profit: ${fmt(month.profit)} | ${month.count} sales\n\n` +
      `*Recent Sales:*\n${list}`,
      { ...Markup.inlineKeyboard([[Markup.button.callback("💰 Record Sale", "start_sale")]]), ...mainMenu() }
    );
  });

  bot.action("start_sale", async (ctx) => {
    await ctx.answerCbQuery();
    await startSale(ctx);
  });

  async function startSale(ctx) {
    const biz = getBusiness(ctx);
    const products = Products.list(biz.id);

    ctx.session.sale = { step: "product", businessId: biz.id };

    if (products.length === 0) {
      await safeReply(ctx,
        `📦 No products found. Add a product first with /product, then record your sale.`,
        mainMenu()
      );
      return;
    }

    // Show product list as inline keyboard (max 10)
    const buttons = products.slice(0, 10).map((p) => [
      Markup.button.callback(
        `${p.name} (Stock: ${p.stock} ${p.unit})`,
        `sale_prod:${p.id}`
      ),
    ]);
    buttons.push([Markup.button.callback("✏️ Type product name manually", "sale_prod:manual")]);
    buttons.push([Markup.button.callback("❌ Cancel", "sale_cancel")]);

    await safeReply(ctx, `💰 *Record a Sale*\n\nStep 1/4 — Select product:`, {
      ...Markup.inlineKeyboard(buttons),
    });
  }

  // Product selected from list
  bot.action(/^sale_prod:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const val = ctx.match[1];
    const biz = getBusiness(ctx);

    if (!ctx.session.sale) ctx.session.sale = { businessId: biz.id };

    if (val === "manual") {
      ctx.session.sale.step = "product_manual";
      await safeReply(ctx, `✏️ Type the *product name* (or type "skip" to enter details manually):`, cancelMenu());
      return;
    }

    const product = Products.get(biz.id, parseInt(val));
    if (!product) return safeReply(ctx, "Product not found. Try /sale again.", mainMenu());

    ctx.session.sale = {
      ...ctx.session.sale,
      step: "quantity",
      product_id: product.id,
      product_name: product.name,
      cost_price: product.cost_price,
      sell_price: product.sell_price,
      stock: product.stock,
      unit: product.unit,
    };

    await safeReply(ctx,
      `✅ Product: *${product.name}*\n` +
      `Stock: ${product.stock} ${product.unit}\n` +
      `Default price: ${fmt(product.sell_price)}\n\n` +
      `Step 2/4 — Enter *quantity sold*:`,
      cancelMenu()
    );
  });

  // Cancel sale
  bot.action("sale_cancel", async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.sale = null;
    await safeReply(ctx, "❌ Sale cancelled.", mainMenu());
  });

  // Text handler for multi-step sale flow
  bot.on("text", async (ctx, next) => {
    const sale = ctx.session.sale;
    if (!sale) return next();
    if (ctx.message.text === "❌ Cancel") {
      ctx.session.sale = null;
      return safeReply(ctx, "❌ Sale cancelled.", mainMenu());
    }

    const biz = getBusiness(ctx);
    const text = ctx.message.text.trim();

    // Step: manual product name
    if (sale.step === "product_manual") {
      sale.product_name = text;
      // Try to find matching product
      const found = Products.findByName(biz.id, text);
      if (found) {
        sale.product_id = found.id;
        sale.cost_price = found.cost_price;
        sale.sell_price = found.sell_price;
        sale.stock = found.stock;
        sale.unit = found.unit;
        sale.step = "quantity";
        return safeReply(ctx,
          `✅ Found: *${found.name}*\nStock: ${found.stock} ${found.unit}\n\nStep 2/4 — Enter *quantity sold*:`,
          cancelMenu()
        );
      }
      sale.step = "quantity";
      return safeReply(ctx, `Step 2/4 — Enter *quantity sold* for "${text}":`, cancelMenu());
    }

    // Step: quantity
    if (sale.step === "quantity") {
      const qty = parseNumber(text);
      if (!qty || qty <= 0) return safeReply(ctx, "⚠️ Enter a valid quantity (e.g. 5):", cancelMenu());
      if (sale.stock !== undefined && qty > sale.stock) {
        return safeReply(ctx, `⚠️ Only ${sale.stock} in stock. Enter a lower quantity:`, cancelMenu());
      }
      sale.quantity = qty;
      sale.step = "price";

      const priceHint = sale.sell_price ? ` (default: ${fmt(sale.sell_price)})` : "";
      return safeReply(ctx, `Step 3/4 — Enter *selling price per unit*${priceHint}:\n_(Send "d" to use default price)_`, cancelMenu());
    }

    // Step: price
    if (sale.step === "price") {
      let price;
      if (text.toLowerCase() === "d" && sale.sell_price) {
        price = sale.sell_price;
      } else {
        price = parseNumber(text);
      }
      if (!price || price <= 0) return safeReply(ctx, "⚠️ Enter a valid price (e.g. 2500):", cancelMenu());
      sale.actual_sell_price = price;
      sale.step = "confirm";

      const revenue = sale.quantity * price;
      const profit = sale.cost_price ? sale.quantity * (price - sale.cost_price) : null;

      sale._preview = { revenue, profit };

      await safeReply(ctx,
        `📋 *Confirm Sale*\n\n` +
        `Product: *${sale.product_name}*\n` +
        `Quantity: ${sale.quantity}\n` +
        `Price/unit: ${fmt(price)}\n` +
        `Total Revenue: *${fmt(revenue)}*\n` +
        (profit !== null ? `Est. Profit: *${fmt(profit)}*\n` : "") +
        (sale.stock !== undefined ? `Remaining Stock: ${sale.stock - sale.quantity}\n` : "") +
        `\nType "ok" to confirm or "cancel" to abort:`,
        cancelMenu()
      );
      return;
    }

    // Step: confirm
    if (sale.step === "confirm") {
      if (text.toLowerCase() === "cancel") {
        ctx.session.sale = null;
        return safeReply(ctx, "❌ Sale cancelled.", mainMenu());
      }
      if (text.toLowerCase() !== "ok") {
        return safeReply(ctx, `Type *ok* to confirm or *cancel* to abort:`, cancelMenu());
      }

      try {
        const result = Sales.record(biz.id, {
          product_id: sale.product_id || null,
          product_name: sale.product_name,
          quantity: sale.quantity,
          sell_price: sale.actual_sell_price,
          cost_price: sale.cost_price || 0,
        });

        ctx.session.sale = null;
        const remaining = sale.stock !== undefined ? sale.stock - sale.quantity : null;

        await safeReply(ctx,
          `✅ *Sale Recorded!*\n\n` +
          `Product: ${sale.product_name}\n` +
          `Quantity: ${sale.quantity}\n` +
          `Revenue: *${fmt(result.revenue)}*\n` +
          (result.profit ? `Est. Profit: *${fmt(result.profit)}*\n` : "") +
          (remaining !== null ? `Remaining Stock: ${remaining}\n` : "") +
          `\nSale ID: #${result.id}`,
          mainMenu()
        );
      } catch (err) {
        console.error("Sale record error:", err.message);
        ctx.session.sale = null;
        await safeReply(ctx, "⚠️ Something went wrong recording that sale. Please try again.", mainMenu());
      }
      return;
    }

    return next();
  });

  // /sales — recent sales list
  bot.command("sales", async (ctx) => {
    await ctx.sendChatAction("typing");
    const biz = getBusiness(ctx);
    const recent = Sales.list(biz.id, 10);
    if (!recent.length) return safeReply(ctx, "📊 No sales recorded yet. Use /sale to record your first sale.", mainMenu());

    const list = recent.map((s, i) =>
      `${i + 1}. *${s.product_name}* × ${s.quantity}\n   💰 ${fmt(s.revenue)} | 📅 ${fmtDate(s.created_at)}`
    ).join("\n\n");

    await safeReply(ctx, `💰 *Recent Sales*\n\n${list}`, mainMenu());
  });

  // /revenue
  bot.command("revenue", async (ctx) => {
    await ctx.sendChatAction("typing");
    const biz = getBusiness(ctx);
    const today = Sales.today(biz.id);
    const week = Sales.thisWeek(biz.id);
    const month = Sales.thisMonth(biz.id);
    const top = Sales.topProducts(biz.id, 3);

    const topStr = top.length
      ? top.map((p, i) => `${i + 1}. ${p.product_name} — ${fmt(p.total_revenue)} (${p.total_qty} units)`).join("\n")
      : "No sales yet";

    await safeReply(ctx,
      `💰 *Revenue Report*\n\n` +
      `Today: *${fmt(today.revenue)}* (${today.count} sales)\n` +
      `This Week: *${fmt(week.revenue)}* (${week.count} sales)\n` +
      `This Month: *${fmt(month.revenue)}* (${month.count} sales)\n\n` +
      `*Top Products:*\n${topStr}`,
      mainMenu()
    );
  });

  // /profit
  bot.command("profit", async (ctx) => {
    await ctx.sendChatAction("typing");
    const biz = getBusiness(ctx);
    const { Expenses, Payroll } = require("../db/database");
    const month = Sales.thisMonth(biz.id);
    const expenses = Expenses.thisMonth(biz.id);
    const payroll = Payroll.thisMonth(biz.id);
    const net = month.profit - expenses.total - payroll.total;

    await safeReply(ctx,
      `💵 *Profit Report (This Month)*\n\n` +
      `Gross Revenue: ${fmt(month.revenue)}\n` +
      `Cost of Goods: −${fmt(month.revenue - month.profit)}\n` +
      `Gross Profit: *${fmt(month.profit)}*\n\n` +
      `Expenses: −${fmt(expenses.total)}\n` +
      `Payroll: −${fmt(payroll.total)}\n\n` +
      `📊 Net Profit: *${fmt(net)}*\n\n` +
      `_${net >= 0 ? "✅ Business is profitable this month." : "⚠️ Spending exceeds profit this month."}_`,
      mainMenu()
    );
  });
}

module.exports = { registerSales };
