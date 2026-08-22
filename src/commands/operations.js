// ─────────────────────────────────────────────
//  operations.js — Expenses, Orders, Delivery,
//                   Staff, Payroll, Suppliers
// ─────────────────────────────────────────────
const { Expenses, Orders, Staff, Payroll, Suppliers } = require("../db/database");
const { fmt, fmtDate, getBusiness, safeReply, parseNumber } = require("../utils/helpers");
const { mainMenu, cancelMenu, statusKeyboard } = require("../utils/keyboards");
const { Markup } = require("telegraf");

function registerOperations(bot) {

  // ─────────────────────────────────────────────
  //  EXPENSES
  // ─────────────────────────────────────────────
  bot.command("expense", async (ctx) => {
    const biz = getBusiness(ctx);
    ctx.session.expense = { step: "description", businessId: biz.id };
    await safeReply(ctx, `💸 *Record Expense*\n\nStep 1/3 — Describe the expense (e.g. "Generator fuel"):`, cancelMenu());
  });

  bot.command("expenses", showExpenses);
  async function showExpenses(ctx) {
    await ctx.sendChatAction("typing");
    const biz = getBusiness(ctx);
    const month = Expenses.thisMonth(biz.id);
    const recent = Expenses.list(biz.id, 8);
    const categories = Expenses.byCategory(biz.id);

    if (!recent.length) return safeReply(ctx, "💸 No expenses recorded yet.\n\nUse /expense to record one.", mainMenu());

    const catStr = categories.map((c) => `${c.category}: ${fmt(c.total)}`).join("\n");
    const list = recent.map((e, i) =>
      `${i + 1}. *${e.description}* — ${fmt(e.amount)}\n   📂 ${e.category} | ${fmtDate(e.created_at)}`
    ).join("\n\n");

    await safeReply(ctx,
      `💸 *Expenses (This Month)*\n\n` +
      `Total: *${fmt(month.total)}* (${month.count} entries)\n\n` +
      `*By Category:*\n${catStr || "None"}\n\n` +
      `*Recent:*\n${list}`,
      mainMenu()
    );
  }

  // ─────────────────────────────────────────────
  //  ORDERS
  // ─────────────────────────────────────────────
  bot.command("orders", showOrders);
  bot.hears("🚚 Deliveries", showOrders);

  async function showOrders(ctx) {
    await ctx.sendChatAction("typing");
    const biz = getBusiness(ctx);
    const orders = Orders.list(biz.id, 8);

    if (!orders.length) {
      return safeReply(ctx, `📦 *Orders*\n\nNo orders yet. Use /order to create one.`, mainMenu());
    }

    const STATUS_EMOJI = { pending: "⏳", confirmed: "✅", processing: "⚙️", shipped: "🚚", delivered: "📦", cancelled: "❌" };
    const list = orders.map((o, i) =>
      `${i + 1}. *${o.ref}* — ${STATUS_EMOJI[o.status] || "📦"} ${o.status.toUpperCase()}\n   Customer: ${o.customer || "N/A"} | Total: ${fmt(o.total)}\n   📅 ${fmtDate(o.created_at)}`
    ).join("\n\n");

    const pending = orders.filter((o) => ["pending", "confirmed", "processing"].includes(o.status)).length;
    await safeReply(ctx,
      `🚚 *Orders (${orders.length} total, ${pending} active)*\n\n${list}\n\nUse /track ORD-XXXXX to track an order.`,
      mainMenu()
    );
  }

  bot.command("order", async (ctx) => {
    const biz = getBusiness(ctx);
    ctx.session.newOrder = { step: "customer", businessId: biz.id, items: [] };
    await safeReply(ctx, `📦 *Create Order*\n\nStep 1/3 — Customer name (or "skip"):`, cancelMenu());
  });

  bot.command("delivery", async (ctx) => {
    await ctx.sendChatAction("typing");
    const biz = getBusiness(ctx);
    const orders = Orders.pending(biz.id);
    if (!orders.length) return safeReply(ctx, "✅ No pending deliveries.", mainMenu());

    const STATUS_EMOJI = { pending: "⏳", confirmed: "✅", processing: "⚙️" };
    const list = orders.map((o) =>
      `📦 *${o.ref}* — ${STATUS_EMOJI[o.status] || "📦"} ${o.status.toUpperCase()}\n` +
      `Customer: ${o.customer || "N/A"} | ${fmt(o.total)}\n` +
      (o.delivery_address ? `📍 ${o.delivery_address}` : "No address")
    ).join("\n\n");

    await safeReply(ctx, `🚚 *Pending Deliveries*\n\n${list}`, mainMenu());
  });

  bot.command("track", async (ctx) => {
    const ref = ctx.args[0]?.toUpperCase();
    if (!ref) return safeReply(ctx, "Usage: /track ORD-123456", mainMenu());
    const biz = getBusiness(ctx);
    const order = Orders.getByRef(biz.id, ref);
    if (!order) return safeReply(ctx, `❌ Order "${ref}" not found. Check the ID and try again.`, mainMenu());

    const STATUS_EMOJI = { pending: "⏳", confirmed: "✅", processing: "⚙️", shipped: "🚚", delivered: "📦", cancelled: "❌" };
    await safeReply(ctx,
      `🔍 *Order: ${order.ref}*\n\n` +
      `Status: ${STATUS_EMOJI[order.status]} *${order.status.toUpperCase()}*\n` +
      `Customer: ${order.customer || "N/A"}\n` +
      `Total: ${fmt(order.total)}\n` +
      (order.delivery_address ? `Address: ${order.delivery_address}\n` : "") +
      (order.note ? `Note: ${order.note}\n` : "") +
      `Created: ${fmtDate(order.created_at)}\n` +
      `Updated: ${fmtDate(order.updated_at)}`,
      { ...statusKeyboard(order.id), ...mainMenu() }
    );
  });

  // Update order status from inline button
  bot.action(/^status:(\d+):(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const biz = getBusiness(ctx);
    const [, orderId, status] = ctx.match;
    const order = Orders.get(biz.id, parseInt(orderId));
    if (!order) return safeReply(ctx, "Order not found.", mainMenu());
    Orders.updateStatus(biz.id, parseInt(orderId), status);
    await ctx.editMessageText(
      `✅ Order *${order.ref}* status updated to: *${status.toUpperCase()}*`,
      { parse_mode: "Markdown" }
    );
  });

  // ─────────────────────────────────────────────
  //  STAFF & PAYROLL
  // ─────────────────────────────────────────────
  bot.command("staff", showStaff);
  bot.hears("👥 Payroll", showStaff);

  async function showStaff(ctx) {
    await ctx.sendChatAction("typing");
    const biz = getBusiness(ctx);
    const staff = Staff.list(biz.id);
    if (!staff.length) {
      return safeReply(ctx,
        `👥 *Staff*\n\nNo staff added yet. Use /addstaff to add a team member.`,
        mainMenu()
      );
    }

    const list = staff.map((s, i) =>
      `${i + 1}. *${s.name}* — ${s.role || "Staff"}\n   💰 Salary: ${fmt(s.salary)} | 📞 ${s.phone || "N/A"}`
    ).join("\n\n");

    const payrollMonth = Payroll.thisMonth(biz.id);
    await safeReply(ctx,
      `👥 *Staff (${staff.length} members)*\n\n${list}\n\n` +
      `Payroll this month: *${fmt(payrollMonth.total)}* (${payrollMonth.count} payments)\n\n` +
      `Use /payroll to record a payment | /addstaff to add staff`,
      mainMenu()
    );
  }

  bot.command("addstaff", async (ctx) => {
    const biz = getBusiness(ctx);
    ctx.session.addStaff = { step: "name", businessId: biz.id };
    await safeReply(ctx, `👤 *Add Staff Member*\n\nEnter staff *name*:`, cancelMenu());
  });

  bot.command("payroll", async (ctx) => {
    const biz = getBusiness(ctx);
    const staff = Staff.list(biz.id);
    if (!staff.length) return safeReply(ctx, "No staff added yet. Use /addstaff first.", mainMenu());

    ctx.session.payrollPay = { step: "select", businessId: biz.id };
    const buttons = staff.map((s) => [
      Markup.button.callback(`${s.name} (${fmt(s.salary)}/mo)`, `pay_staff:${s.id}`),
    ]);
    buttons.push([Markup.button.callback("❌ Cancel", "pay_cancel")]);
    await safeReply(ctx, `💰 *Record Payroll*\n\nSelect staff member:`, { ...Markup.inlineKeyboard(buttons) });
  });

  bot.action(/^pay_staff:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const biz = getBusiness(ctx);
    const member = Staff.get(biz.id, parseInt(ctx.match[1]));
    if (!member) return safeReply(ctx, "Staff member not found.", mainMenu());
    ctx.session.payrollPay = { step: "amount", businessId: biz.id, staff: member };
    await safeReply(ctx,
      `💰 *Pay ${member.name}*\n\nDefault salary: ${fmt(member.salary)}\n\nEnter amount to pay (or "d" for default):`,
      cancelMenu()
    );
  });

  bot.action("pay_cancel", async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.payrollPay = null;
    await safeReply(ctx, "❌ Cancelled.", mainMenu());
  });

  // /suppliers
  bot.command("suppliers", showSuppliers);
  bot.hears("🤝 Suppliers", showSuppliers);

  async function showSuppliers(ctx) {
    const biz = getBusiness(ctx);
    const list = Suppliers.list(biz.id);
    if (!list.length) return safeReply(ctx, `🤝 *Suppliers*\n\nNo suppliers yet. Use /addsupplier to add one.`, mainMenu());

    const text = list.map((s, i) =>
      `${i + 1}. *${s.name}*\n   📞 ${s.phone || "N/A"} | Products: ${s.products || "N/A"}`
    ).join("\n\n");

    await safeReply(ctx, `🤝 *Suppliers (${list.length})*\n\n${text}`, mainMenu());
  }

  bot.command("addsupplier", async (ctx) => {
    const biz = getBusiness(ctx);
    ctx.session.addSupplier = { step: "name", businessId: biz.id };
    await safeReply(ctx, `🤝 *Add Supplier*\n\nEnter supplier *name*:`, cancelMenu());
  });

  bot.command("purchases", async (ctx) => {
    await safeReply(ctx, `📋 *Purchases*\n\nUse /stockin to record stock received from suppliers.`, mainMenu());
  });

  // ─────────────────────────────────────────────
  //  TEXT HANDLER for all multi-step operation flows
  // ─────────────────────────────────────────────
  bot.on("text", async (ctx, next) => {
    const biz = getBusiness(ctx);
    const text = ctx.message.text.trim();
    const isCancel = text === "❌ Cancel";

    // ── Expense Flow ──
    const exp = ctx.session.expense;
    if (exp) {
      if (isCancel) { ctx.session.expense = null; return safeReply(ctx, "❌ Cancelled.", mainMenu()); }
      if (exp.step === "description") {
        exp.description = text;
        exp.step = "amount";
        return safeReply(ctx, `Step 2/3 — Enter *amount* (₦):`, cancelMenu());
      }
      if (exp.step === "amount") {
        const amount = parseNumber(text);
        if (!amount) return safeReply(ctx, "⚠️ Enter a valid amount:", cancelMenu());
        exp.amount = amount;
        exp.step = "category";
        return safeReply(ctx,
          `Step 3/3 — Enter *category* (or choose):`,
          {
            ...Markup.inlineKeyboard([
              [Markup.button.callback("🏭 Operations", "exp_cat:Operations"), Markup.button.callback("⚡ Utilities", "exp_cat:Utilities")],
              [Markup.button.callback("🚗 Transport", "exp_cat:Transport"), Markup.button.callback("📦 Stock/Supply", "exp_cat:Stock/Supply")],
              [Markup.button.callback("📢 Marketing", "exp_cat:Marketing"), Markup.button.callback("💼 General", "exp_cat:General")],
            ]),
          }
        );
      }
      if (exp.step === "save") {
        exp.category = text;
        try {
          Expenses.add(biz.id, { description: exp.description, amount: exp.amount, category: exp.category });
          ctx.session.expense = null;
          return safeReply(ctx, `✅ *Expense Recorded!*\n\n${exp.description}\nAmount: *${fmt(exp.amount)}*\nCategory: ${exp.category}`, mainMenu());
        } catch (e) {
          ctx.session.expense = null;
          return safeReply(ctx, "⚠️ Failed to save expense. Please try again.", mainMenu());
        }
      }
      return next();
    }

    // ── Order Flow ──
    const no = ctx.session.newOrder;
    if (no) {
      if (isCancel) { ctx.session.newOrder = null; return safeReply(ctx, "❌ Cancelled.", mainMenu()); }
      if (no.step === "customer") {
        no.customer = text === "skip" ? null : text;
        no.step = "total";
        return safeReply(ctx, `Step 2/3 — Enter *total order amount* (₦):`, cancelMenu());
      }
      if (no.step === "total") {
        const total = parseNumber(text);
        if (!total) return safeReply(ctx, "⚠️ Enter a valid amount:", cancelMenu());
        no.total = total;
        no.step = "address";
        return safeReply(ctx, `Step 3/3 — Enter *delivery address* (or "skip"):`, cancelMenu());
      }
      if (no.step === "address") {
        no.delivery_address = text === "skip" ? null : text;
        try {
          const result = Orders.create(biz.id, { customer: no.customer, total: no.total, delivery_address: no.delivery_address });
          ctx.session.newOrder = null;
          return safeReply(ctx,
            `✅ *Order Created!*\n\nOrder Ref: *${result.ref}*\nCustomer: ${no.customer || "N/A"}\nTotal: ${fmt(no.total)}\nAddress: ${no.delivery_address || "N/A"}\n\nTrack with: /track ${result.ref}`,
            mainMenu()
          );
        } catch (e) {
          ctx.session.newOrder = null;
          return safeReply(ctx, "⚠️ Failed to create order. Please try again.", mainMenu());
        }
      }
      return next();
    }

    // ── Add Staff Flow ──
    const as = ctx.session.addStaff;
    if (as) {
      if (isCancel) { ctx.session.addStaff = null; return safeReply(ctx, "❌ Cancelled.", mainMenu()); }
      if (as.step === "name") { as.name = text; as.step = "role"; return safeReply(ctx, `Role (e.g. Cashier, Driver) or "skip":`, cancelMenu()); }
      if (as.step === "role") { as.role = text === "skip" ? null : text; as.step = "salary"; return safeReply(ctx, `Monthly salary (₦) or "0":`, cancelMenu()); }
      if (as.step === "salary") {
        as.salary = parseNumber(text) || 0;
        as.step = "phone";
        return safeReply(ctx, `Phone number or "skip":`, cancelMenu());
      }
      if (as.step === "phone") {
        as.phone = text === "skip" ? null : text;
        try {
          Staff.add(biz.id, { name: as.name, role: as.role, salary: as.salary, phone: as.phone });
          ctx.session.addStaff = null;
          return safeReply(ctx, `✅ *Staff Added!*\n\n${as.name}\nRole: ${as.role || "N/A"}\nSalary: ${fmt(as.salary)}/mo`, mainMenu());
        } catch (e) {
          ctx.session.addStaff = null;
          return safeReply(ctx, "⚠️ Failed to add staff.", mainMenu());
        }
      }
      return next();
    }

    // ── Payroll Flow ──
    const pr = ctx.session.payrollPay;
    if (pr?.step === "amount") {
      if (isCancel) { ctx.session.payrollPay = null; return safeReply(ctx, "❌ Cancelled.", mainMenu()); }
      let amount;
      if (text.toLowerCase() === "d") { amount = pr.staff.salary; }
      else { amount = parseNumber(text); }
      if (!amount || amount <= 0) return safeReply(ctx, "⚠️ Enter a valid amount:", cancelMenu());
      try {
        const now = new Date();
        Payroll.pay(biz.id, {
          staff_id: pr.staff.id,
          staff_name: pr.staff.name,
          amount,
          period: `${now.toLocaleString("default", { month: "long" })} ${now.getFullYear()}`,
        });
        ctx.session.payrollPay = null;
        return safeReply(ctx, `✅ *Payroll Recorded!*\n\n${pr.staff.name}\nAmount: *${fmt(amount)}*\nPeriod: ${new Date().toLocaleString("default", { month: "long", year: "numeric" })}`, mainMenu());
      } catch (e) {
        ctx.session.payrollPay = null;
        return safeReply(ctx, "⚠️ Failed to record payment.", mainMenu());
      }
    }

    // ── Add Supplier Flow ──
    const sup = ctx.session.addSupplier;
    if (sup) {
      if (isCancel) { ctx.session.addSupplier = null; return safeReply(ctx, "❌ Cancelled.", mainMenu()); }
      if (sup.step === "name") { sup.name = text; sup.step = "phone"; return safeReply(ctx, `Phone number or "skip":`, cancelMenu()); }
      if (sup.step === "phone") {
        sup.phone = text === "skip" ? null : text;
        sup.step = "products";
        return safeReply(ctx, `What products do they supply? (or "skip"):`, cancelMenu());
      }
      if (sup.step === "products") {
        sup.products = text === "skip" ? null : text;
        try {
          Suppliers.add(biz.id, { name: sup.name, phone: sup.phone, products: sup.products });
          ctx.session.addSupplier = null;
          return safeReply(ctx, `✅ *Supplier Added!*\n\n${sup.name}\nPhone: ${sup.phone || "N/A"}\nProducts: ${sup.products || "N/A"}`, mainMenu());
        } catch (e) {
          ctx.session.addSupplier = null;
          return safeReply(ctx, "⚠️ Failed to add supplier.", mainMenu());
        }
      }
      return next();
    }

    return next();
  });

  // Inline button: expense category selection
  bot.action(/^exp_cat:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const biz = getBusiness(ctx);
    const category = ctx.match[1];
    const exp = ctx.session.expense;
    if (!exp) return;
    try {
      Expenses.add(biz.id, { description: exp.description, amount: exp.amount, category });
      ctx.session.expense = null;
      await ctx.editMessageText(
        `✅ *Expense Recorded!*\n\n${exp.description}\nAmount: *${fmt(exp.amount)}*\nCategory: ${category}`,
        { parse_mode: "Markdown" }
      );
    } catch (e) {
      ctx.session.expense = null;
      await safeReply(ctx, "⚠️ Failed to save expense.", mainMenu());
    }
  });
}

module.exports = { registerOperations };
