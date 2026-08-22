// ─────────────────────────────────────────────
//  inventory.js — /inventory /product /stockin /stockout /lowstock /reorder
// ─────────────────────────────────────────────
const { Products, StockMovements, Sales } = require("../db/database");
const { fmt, getBusiness, safeReply, parseNumber } = require("../utils/helpers");
const { mainMenu, cancelMenu } = require("../utils/keyboards");
const { Markup } = require("telegraf");

function registerInventory(bot) {

  // /inventory
  bot.command("inventory", showInventory);
  bot.hears("📦 Inventory", showInventory);

  async function showInventory(ctx) {
    await ctx.sendChatAction("typing");
    const biz = getBusiness(ctx);
    const products = Products.list(biz.id);

    if (!products.length) {
      return safeReply(ctx,
        `📦 *Inventory*\n\nNo products yet. Use /product to add your first product.`,
        mainMenu()
      );
    }

    const list = products.map((p, i) => {
      const stockAlert = p.stock <= p.min_stock ? " ⚠️" : "";
      return `${i + 1}. *${p.name}*${stockAlert}\n   Stock: ${p.stock} ${p.unit} | Price: ${fmt(p.sell_price)}`;
    }).join("\n\n");

    const stockValue = Products.stockValue(biz.id);
    const lowCount = Products.lowStock(biz.id).length;

    await safeReply(ctx,
      `📦 *Inventory (${products.length} products)*\n\n${list}\n\n` +
      `💎 Total Stock Value: *${fmt(stockValue)}*\n` +
      (lowCount > 0 ? `⚠️ ${lowCount} item(s) low on stock — /lowstock` : "✅ All stock levels OK"),
      mainMenu()
    );
  }

  // /product — add new product
  bot.command("product", async (ctx) => {
    const biz = getBusiness(ctx);
    ctx.session.addProduct = { step: "name", businessId: biz.id };
    await safeReply(ctx,
      `📦 *Add New Product*\n\nStep 1/5 — Enter *product name*:`,
      cancelMenu()
    );
  });

  // /stockin — add stock
  bot.command("stockin", async (ctx) => {
    const biz = getBusiness(ctx);
    const products = Products.list(biz.id);
    if (!products.length) return safeReply(ctx, "No products yet. Use /product to add products first.", mainMenu());

    ctx.session.stockIn = { step: "product", businessId: biz.id };
    const buttons = products.slice(0, 10).map((p) => [
      Markup.button.callback(`${p.name} (${p.stock} ${p.unit})`, `si_prod:${p.id}`),
    ]);
    buttons.push([Markup.button.callback("❌ Cancel", "si_cancel")]);
    await safeReply(ctx, `📥 *Stock In*\n\nSelect product to restock:`, { ...Markup.inlineKeyboard(buttons) });
  });

  bot.action(/^si_prod:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const biz = getBusiness(ctx);
    const prod = Products.get(biz.id, parseInt(ctx.match[1]));
    if (!prod) return safeReply(ctx, "Product not found.", mainMenu());
    ctx.session.stockIn = { step: "quantity", businessId: biz.id, product: prod };
    await safeReply(ctx,
      `📥 *Stock In — ${prod.name}*\n\nCurrent stock: ${prod.stock} ${prod.unit}\n\nEnter *quantity to add*:`,
      cancelMenu()
    );
  });

  bot.action("si_cancel", async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.stockIn = null;
    await safeReply(ctx, "❌ Cancelled.", mainMenu());
  });

  // /stockout — remove stock
  bot.command("stockout", async (ctx) => {
    const biz = getBusiness(ctx);
    const products = Products.list(biz.id);
    if (!products.length) return safeReply(ctx, "No products yet.", mainMenu());

    ctx.session.stockOut = { step: "product", businessId: biz.id };
    const buttons = products.slice(0, 10).map((p) => [
      Markup.button.callback(`${p.name} (${p.stock} ${p.unit})`, `so_prod:${p.id}`),
    ]);
    buttons.push([Markup.button.callback("❌ Cancel", "so_cancel")]);
    await safeReply(ctx, `📤 *Stock Out*\n\nSelect product:`, { ...Markup.inlineKeyboard(buttons) });
  });

  bot.action(/^so_prod:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const biz = getBusiness(ctx);
    const prod = Products.get(biz.id, parseInt(ctx.match[1]));
    if (!prod) return safeReply(ctx, "Product not found.", mainMenu());
    ctx.session.stockOut = { step: "quantity", businessId: biz.id, product: prod };
    await safeReply(ctx,
      `📤 *Stock Out — ${prod.name}*\n\nCurrent stock: ${prod.stock} ${prod.unit}\n\nEnter *quantity to remove*:`,
      cancelMenu()
    );
  });

  bot.action("so_cancel", async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.stockOut = null;
    await safeReply(ctx, "❌ Cancelled.", mainMenu());
  });

  // /lowstock
  bot.command("lowstock", async (ctx) => {
    await ctx.sendChatAction("typing");
    const biz = getBusiness(ctx);
    const items = Products.lowStock(biz.id);
    if (!items.length) return safeReply(ctx, "✅ All products have sufficient stock.", mainMenu());

    const list = items.map((p, i) =>
      `${i + 1}. *${p.name}*\n   Stock: ${p.stock} ${p.unit} | Min: ${p.min_stock}\n   ⚠️ Need: ${Math.max(0, p.min_stock - p.stock)} more`
    ).join("\n\n");

    await safeReply(ctx, `⚠️ *Low Stock Alert (${items.length} items)*\n\n${list}\n\nUse /stockin to restock.`, mainMenu());
  });

  // /reorder
  bot.command("reorder", async (ctx) => {
    await ctx.sendChatAction("typing");
    const biz = getBusiness(ctx);
    const items = Products.lowStock(biz.id);
    if (!items.length) return safeReply(ctx, "✅ No reorders needed — all stock levels are OK.", mainMenu());

    const list = items.map((p) =>
      `• *${p.name}* — Order at least ${Math.max(p.min_stock * 2, p.min_stock - p.stock + 10)} ${p.unit}`
    ).join("\n");

    await safeReply(ctx, `📋 *Reorder Suggestions*\n\n${list}\n\nContact your suppliers with /suppliers`, mainMenu());
  });

  // /stockvalue
  bot.command("stockvalue", async (ctx) => {
    const biz = getBusiness(ctx);
    const value = Products.stockValue(biz.id);
    const count = Products.list(biz.id).length;
    await safeReply(ctx, `💎 *Stock Valuation*\n\nTotal products: ${count}\nTotal value: *${fmt(value)}*\n_(based on cost price)_`, mainMenu());
  });

  // /deleteproduct — mark product inactive
  bot.command("deleteproduct", async (ctx) => {
    const biz = getBusiness(ctx);
    const name = ctx.args.join(" ").trim();
    if (!name) {
      const prods = Products.list(biz.id);
      if (!prods.length) return safeReply(ctx, "No products to delete.", mainMenu());
      const btns = prods.slice(0, 12).map(p => [Markup.button.callback(`❌ ${p.name}`, `del_prod:${p.id}`)]);
      btns.push([Markup.button.callback("Cancel", "del_prod:cancel")]);
      return safeReply(ctx, "🗑️ *Delete Product*\n\nSelect product to remove:", { ...Markup.inlineKeyboard(btns) });
    }
    const prod = Products.findByName(biz.id, name);
    if (!prod) return safeReply(ctx, `❌ Product "${name}" not found.`, mainMenu());
    Products.delete(biz.id, prod.id);
    await safeReply(ctx, `✅ *${prod.name}* removed from inventory.`, mainMenu());
  });

  bot.action(/^del_prod:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (ctx.match[1] === "cancel") return ctx.editMessageText("❌ Cancelled.");
    const biz = getBusiness(ctx);
    const prod = Products.get(biz.id, parseInt(ctx.match[1]));
    if (!prod) return ctx.editMessageText("Product not found.");
    Products.delete(biz.id, prod.id);
    await ctx.editMessageText(`✅ *${prod.name}* removed from inventory.`, { parse_mode: "Markdown" });
  });

  // /customers — top customers by spend
  bot.command("customers", async (ctx) => {
    await ctx.sendChatAction("typing");
    const biz = getBusiness(ctx);
    const top = Sales.topCustomers(biz.id, 10);
    if (!top.length) return safeReply(ctx, "👥 No customer data yet.\n\nAdd customer names when recording sales.", mainMenu());
    const list = top.map((c, i) =>
      `${i+1}. *${c.customer}*\n   ${c.visits} visit(s) · ${fmt(c.total)} total spend`
    ).join("\n\n");
    await safeReply(ctx, `👥 *Top Customers*\n\n${list}`, mainMenu());
  });

  // ── TEXT HANDLERS for multi-step flows ──────

  bot.on("text", async (ctx, next) => {
    const text = ctx.message.text.trim();
    const biz = getBusiness(ctx);

    // ── Add Product Flow ──
    const ap = ctx.session.addProduct;
    if (ap) {
      if (text === "❌ Cancel") {
        ctx.session.addProduct = null;
        return safeReply(ctx, "❌ Cancelled.", mainMenu());
      }

      if (ap.step === "name") {
        ap.name = text;
        ap.step = "sell_price";
        return safeReply(ctx, `Step 2/5 — Selling price per unit (e.g. 2500):`, cancelMenu());
      }
      if (ap.step === "sell_price") {
        const price = parseNumber(text);
        if (!price) return safeReply(ctx, "⚠️ Enter a valid price (numbers only):", cancelMenu());
        ap.sell_price = price;
        ap.step = "cost_price";
        return safeReply(ctx, `Step 3/5 — Cost/purchase price per unit (or "0" if unknown):`, cancelMenu());
      }
      if (ap.step === "cost_price") {
        ap.cost_price = parseNumber(text) || 0;
        ap.step = "stock";
        return safeReply(ctx, `Step 4/5 — Current stock quantity:`, cancelMenu());
      }
      if (ap.step === "stock") {
        const stock = parseNumber(text);
        if (stock === null) return safeReply(ctx, "⚠️ Enter a valid stock quantity:", cancelMenu());
        ap.stock = stock;
        ap.step = "unit";
        return safeReply(ctx, `Step 5/5 — Unit of measurement (e.g. pieces, kg, litres, cartons — or press /skip):`, cancelMenu());
      }
      if (ap.step === "unit") {
        ap.unit = text === "/skip" ? "unit" : text;
        // Save to DB
        try {
          Products.add(biz.id, {
            name: ap.name,
            sell_price: ap.sell_price,
            cost_price: ap.cost_price,
            stock: ap.stock,
            unit: ap.unit,
            min_stock: 5,
          });
          ctx.session.addProduct = null;
          return safeReply(ctx,
            `✅ *Product Added!*\n\n` +
            `Name: *${ap.name}*\n` +
            `Sell Price: ${fmt(ap.sell_price)}\n` +
            `Cost Price: ${fmt(ap.cost_price)}\n` +
            `Stock: ${ap.stock} ${ap.unit}\n` +
            `Low Stock Alert: at 5 ${ap.unit}`,
            mainMenu()
          );
        } catch (err) {
          console.error("Add product error:", err.message);
          ctx.session.addProduct = null;
          if (err.message.includes("UNIQUE")) {
            return safeReply(ctx, `⚠️ A product named "${ap.name}" already exists.`, mainMenu());
          }
          return safeReply(ctx, "⚠️ Failed to add product. Please try again.", mainMenu());
        }
      }
      return next();
    }

    // ── Stock In Flow ──
    const si = ctx.session.stockIn;
    if (si?.step === "quantity") {
      if (text === "❌ Cancel") {
        ctx.session.stockIn = null;
        return safeReply(ctx, "❌ Cancelled.", mainMenu());
      }
      const qty = parseNumber(text);
      if (!qty || qty <= 0) return safeReply(ctx, "⚠️ Enter a valid quantity:", cancelMenu());

      const newStock = si.product.stock + qty;
      Products.setStock(si.product.id, newStock);
      StockMovements.add(biz.id, { product_id: si.product.id, type: "in", quantity: qty, notes: "Manual stock in" });
      ctx.session.stockIn = null;
      return safeReply(ctx,
        `📥 *Stock Added!*\n\n` +
        `Product: *${si.product.name}*\n` +
        `Added: +${qty} ${si.product.unit}\n` +
        `New Stock: *${newStock} ${si.product.unit}*`,
        mainMenu()
      );
    }

    // ── Stock Out Flow ──
    const so = ctx.session.stockOut;
    if (so?.step === "quantity") {
      if (text === "❌ Cancel") {
        ctx.session.stockOut = null;
        return safeReply(ctx, "❌ Cancelled.", mainMenu());
      }
      const qty = parseNumber(text);
      if (!qty || qty <= 0) return safeReply(ctx, "⚠️ Enter a valid quantity:", cancelMenu());
      if (qty > so.product.stock) return safeReply(ctx, `⚠️ Only ${so.product.stock} in stock. Enter a lower quantity:`, cancelMenu());

      const newStock = so.product.stock - qty;
      Products.setStock(so.product.id, newStock);
      StockMovements.add(biz.id, { product_id: so.product.id, type: "out", quantity: qty, notes: "Manual stock out" });
      ctx.session.stockOut = null;
      return safeReply(ctx,
        `📤 *Stock Removed!*\n\n` +
        `Product: *${so.product.name}*\n` +
        `Removed: −${qty} ${so.product.unit}\n` +
        `New Stock: *${newStock} ${so.product.unit}*`,
        mainMenu()
      );
    }

    return next();
  });
}

module.exports = { registerInventory };
