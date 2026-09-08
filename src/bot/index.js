"use strict";
const { Telegraf, Markup, session } = require("telegraf");
const { Vendors, Products, Services, Orders, Analytics, Expenses, Staff, getSetting, all, get, run, recordSale, slugify } = require("../db");
const { isAdminTelegramId } = require("../middleware/auth");

const fmt  = n => "₦" + Number(n||0).toLocaleString("en-NG");
const safe = async (fn) => { try { await fn(); } catch(e) { console.error("Bot handler:", e.message); } };

// ── Categories for bot ────────────────────────────────────────
function getCategories() {
  return all("SELECT * FROM categories WHERE active=1 ORDER BY sort_order,name");
}

// ── Keyboards ─────────────────────────────────────────────────
function mainVendorMenu() {
  return Markup.keyboard([
    ["📦 Products",  "🛎️ Services"],
    ["📋 Orders",    "📊 Sales"],
    ["💸 Expenses",  "📈 Analytics"],
    ["👥 Staff",     "🚚 Deliveries"],
    ["🏪 My Store",  "🤖 AI Assistant"],
    ["ℹ️ Help"],
  ]).resize();
}

function cancelMenu() {
  return Markup.keyboard([["❌ Cancel"]]).resize();
}

function isCancel(text) {
  return text === "❌ Cancel" || text === "/cancel";
}

// ── Helper: get vendor or send onboarding prompt ───────────────
async function getVendorOrPrompt(ctx) {
  const vendor = Vendors.getByTelegramId(ctx.from.id);
  if (!vendor) {
    await ctx.reply(
      "👋 You don't have a ShopBot store yet.\n\nType /register to create your store and start selling on the marketplace.",
      Markup.keyboard([["/register"]]).resize()
    );
    return null;
  }
  if (vendor.status === "pending") {
    await ctx.reply("⏳ Your store is under review. We'll notify you once it's approved.\n\nContact support if this takes more than 24 hours.");
    return null;
  }
  return vendor;
}

// ── AI helper ────────────────────────────────────────────────
async function askAI(vendor, question, context) {
  if (!process.env.ANTHROPIC_API_KEY) return "🤖 AI assistant is not configured yet.";
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 500,
        system: `You are ShopBot AI — a business assistant for ${vendor.business_name}, a Nigerian business on ShopBot marketplace.
Industry: ${vendor.industry || "Retail"}. Location: ${vendor.location || "Nigeria"}.
Business context: ${JSON.stringify(context)}
Answer concisely. Use ₦ for Naira. Be practical and direct. Max 200 words.`,
        messages: [{ role: "user", content: question }],
      }),
    });
    const data = await response.json();
    return data.content?.[0]?.text || "Sorry, I couldn't get a response.";
  } catch (e) {
    console.error("AI error:", e.message);
    return "🤖 AI is temporarily unavailable.";
  }
}

// ── Main bot start ─────────────────────────────────────────────
async function startBot() {
  if (!process.env.BOT_TOKEN) { console.warn("⚠️ BOT_TOKEN not set — bot disabled"); return; }

  const bot = new Telegraf(process.env.BOT_TOKEN);
  global._shopbot = bot;
  bot.use(session());

  // ── Global error handler ───────────────────────────────────
  bot.catch(async (err, ctx) => {
    console.error("Bot error:", err.message);
    try { await ctx.reply("⚠️ Something went wrong. Type /start to reset."); } catch {}
  });

  // ── /start ─────────────────────────────────────────────────
  bot.start(async (ctx) => {
    const vendor = Vendors.getByTelegramId(ctx.from.id);
    if (vendor && vendor.status === "active") {
      const today = Analytics.todaySales(vendor.id);
      const orders = Analytics.todayOrders(vendor.id).length;
      const low    = Products.lowStock(vendor.id).length;
      await ctx.reply(
        `👋 Welcome back, *${vendor.business_name}*!\n\n` +
        `📊 Today:\n` +
        `  💰 Revenue: *${fmt(today.revenue)}*\n` +
        `  📦 Orders:  *${orders}*\n` +
        `  ⚠️ Low stock: *${low} item(s)*\n\n` +
        `Use the menu below to manage your store.`,
        { parse_mode: "Markdown", ...mainVendorMenu() }
      );
    } else if (vendor && vendor.status === "pending") {
      await ctx.reply("⏳ Your store is pending review. We'll notify you soon!", Markup.removeKeyboard());
    } else {
      await ctx.reply(
        `🛍️ *Welcome to ShopBot!*\n\n` +
        `ShopBot lets you sell your products & services on Nigeria's marketplace — managed entirely from Telegram.\n\n` +
        `✅ Create your store\n` +
        `✅ Add products & services\n` +
        `✅ Receive orders\n` +
        `✅ Track sales & analytics\n` +
        `✅ Manage inventory, staff & more\n\n` +
        `Ready to start selling?`,
        { parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("🚀 Create My Store", "register")],
          ]) }
      );
    }
  });

  bot.action("register", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply("Let's set up your store! What's your *business name*?", { parse_mode:"Markdown", ...cancelMenu() });
    ctx.session.reg = { step: "business_name" };
  });

  // ── /register ─────────────────────────────────────────────
  bot.command("register", async (ctx) => {
    if (Vendors.getByTelegramId(ctx.from.id)) return ctx.reply("You already have a store. Type /start to see your dashboard.");
    await ctx.reply("Let's set up your store! What's your *business name*?", { parse_mode:"Markdown", ...cancelMenu() });
    ctx.session.reg = { step: "business_name" };
  });

  // ── /menu ──────────────────────────────────────────────────
  bot.command("menu", async (ctx) => {
    const v = await getVendorOrPrompt(ctx);
    if (!v) return;
    await ctx.reply("📋 Main menu:", mainVendorMenu());
  });

  // ── /help ──────────────────────────────────────────────────
  bot.command("help", async (ctx) => {
    await ctx.reply(
      `*ShopBot Commands*\n\n` +
      `*Store setup*\n` +
      `/register — Create your store\n` +
      `/mystore — View/edit your store\n\n` +
      `*Products*\n` +
      `/product — Add a product\n` +
      `/myproducts — List products\n` +
      `/editproduct — Edit a product\n` +
      `/stockin — Add stock\n` +
      `/stockout — Remove stock\n` +
      `/lowstock — Low stock alert\n\n` +
      `*Services*\n` +
      `/service — Add a service\n\n` +
      `*Orders & Sales*\n` +
      `/orders — View pending orders\n` +
      `/sale — Record manual sale\n` +
      `/sales — Today's sales\n` +
      `/revenue — Revenue report\n\n` +
      `*Business*\n` +
      `/expenses — View expenses\n` +
      `/expense — Add expense\n` +
      `/staff — Manage staff\n` +
      `/analytics — Business analytics\n\n` +
      `*AI*\n` +
      `/ask — Ask your AI assistant`,
      { parse_mode: "Markdown", ...mainVendorMenu() }
    );
  });

  // ── TEXT ROUTER (session-based flows) ──────────────────────
  bot.on("text", async (ctx, next) => {
    const text = ctx.message.text;
    if (isCancel(text)) {
      ctx.session = {};
      return ctx.reply("❌ Cancelled.", mainVendorMenu());
    }
    // Route to active session flow
    if (ctx.session.reg)         return handleRegistration(ctx, text);
    if (ctx.session.addProduct)  return handleAddProduct(ctx, text);
    if (ctx.session.addService)  return handleAddService(ctx, text);
    if (ctx.session.addExpense)  return handleAddExpense(ctx, text);
    if (ctx.session.addStaff)    return handleAddStaff(ctx, text);
    if (ctx.session.editProduct) return handleEditProduct(ctx, text);
    if (ctx.session.stockIn)     return handleStockIn(ctx, text);
    if (ctx.session.stockOut)    return handleStockOut(ctx, text);
    if (ctx.session.aiChat)      return handleAIChat(ctx, text);
    if (ctx.session.recordSale)  return handleRecordSale(ctx, text);
    if (ctx.session.storeEdit)   return handleStoreEdit(ctx, text);
    return next();
  });

  // ── PHOTO handler (for product images during setup) ────────
  bot.on("photo", async (ctx, next) => {
    if (ctx.session.addProduct?.step === "image") {
      const fileId = ctx.message.photo.at(-1).file_id;
      ctx.session.addProduct.data.image_url = `tg:${fileId}`;
      ctx.session.addProduct.step = "confirm";
      const d = ctx.session.addProduct.data;
      await ctx.reply(
        `📋 *Confirm your product:*\n\n` +
        `📦 Name: *${d.name}*\n` +
        `💰 Price: *${fmt(d.price)}*\n` +
        `📊 Stock: *${d.stock}* ${d.unit}\n` +
        `📂 Category: *${d.category || "General"}*\n\n` +
        `Save this product?`,
        { parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("✅ Save Product", "saveproduct"),
             Markup.button.callback("❌ Cancel", "cancelprod")],
          ]) }
      );
    }
    return next();
  });

  // ── REGISTRATION FLOW ──────────────────────────────────────
  async function handleRegistration(ctx, text) {
    const reg = ctx.session.reg;
    const cats = getCategories();

    if (reg.step === "business_name") {
      reg.data = { business_name: text, telegram_id: ctx.from.id, username: ctx.from.username };
      reg.step = "industry";
      // Show category keyboard
      const buttons = cats.map(c => [Markup.button.callback(`${c.icon} ${c.name}`, `regcat:${c.id}`)]);
      await ctx.reply("What industry/category is your business?", Markup.inlineKeyboard(buttons));
      return;
    }
    if (reg.step === "location") {
      reg.data.location = text; reg.step = "phone";
      return ctx.reply("What's your business phone number?", cancelMenu());
    }
    if (reg.step === "phone") {
      reg.data.phone = text; reg.step = "description";
      return ctx.reply("Write a short description of your business (1-2 sentences):", cancelMenu());
    }
    if (reg.step === "description") {
      reg.data.description = text;
      // Save vendor
      try {
        const r = Vendors.create(reg.data);
        const vendorId = r.lastInsertRowid;
        // Auto-approve in dev, require admin approval in prod
        const autoApprove = !process.env.REQUIRE_APPROVAL;
        if (autoApprove) {
          Vendors.update(vendorId, { status: "active" });
          const v = Vendors.getById(vendorId);
          ctx.session = {};
          const BASE = (process.env.WEBHOOK_URL||"http://localhost:3000").replace(/\/+$/,"");
          await ctx.reply(
            `🎉 *Store Created Successfully!*\n\n` +
            `🏪 *${v.business_name}*\n` +
            `📍 ${v.location}\n\n` +
            `Your store is now LIVE on the marketplace!\n\n` +
            `🌐 Store URL: ${BASE}/store/${v.store_slug}\n\n` +
            `Start adding products with /product`,
            { parse_mode: "Markdown", ...mainVendorMenu() }
          );
        } else {
          ctx.session = {};
          await ctx.reply("✅ Your store registration is submitted for review. We'll notify you within 24 hours.");
        }
        // Notify admin
        if (process.env.ADMIN_TELEGRAM_ID) {
          const v = Vendors.getById(vendorId);
          await bot.telegram.sendMessage(process.env.ADMIN_TELEGRAM_ID,
            `🆕 New vendor registration:\n*${v.business_name}*\n${v.location}\n${v.phone||"no phone"}\n\nApprove: /approve_${vendorId}`,
            { parse_mode: "Markdown" }).catch(()=>{});
        }
      } catch (e) {
        console.error("Register error:", e.message);
        ctx.session = {};
        await ctx.reply("❌ Registration failed. Please try again with /register.");
      }
    }
  }

  bot.action(/^regcat:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.session.reg) return;
    const cat = get("SELECT * FROM categories WHERE id=?", [ctx.match[1]]);
    if (cat) {
      ctx.session.reg.data.category_id = cat.id;
      ctx.session.reg.data.industry = cat.name;
    }
    ctx.session.reg.step = "location";
    await ctx.editMessageText(`✅ Industry: ${cat?.name || "Selected"}`);
    await ctx.reply("Where is your business located? (City, State)", cancelMenu());
  });

  // ── MY STORE ───────────────────────────────────────────────
  bot.hears("🏪 My Store", async (ctx) => {
    const v = await getVendorOrPrompt(ctx);
    if (!v) return;
    const BASE = (process.env.WEBHOOK_URL||"http://localhost:3000").replace(/\/+$/,"");
    await ctx.reply(
      `🏪 *${v.business_name}*\n\n` +
      `📍 ${v.location||"Not set"}\n` +
      `📞 ${v.phone||"Not set"}\n` +
      `🏷️ Industry: ${v.industry||"Not set"}\n` +
      `⭐ Rating: ${Number(v.rating).toFixed(1)} (${v.review_count} reviews)\n` +
      `📊 Status: ${v.status}\n\n` +
      `🌐 ${BASE}/store/${v.store_slug}`,
      { parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("✏️ Edit Description", "edit:description"),
           Markup.button.callback("📍 Edit Location", "edit:location")],
          [Markup.button.callback("📞 Edit Phone", "edit:phone"),
           Markup.button.callback("🕐 Opening Hours", "edit:opening_hours")],
          [Markup.button.callback("🚚 Delivery Info", "edit:delivery_info"),
           Markup.button.callback("💰 Delivery Fee", "edit:delivery_fee")],
        ]) }
    );
  });

  bot.command("mystore", async (ctx) => ctx.emit("message", { text: "🏪 My Store", ...ctx.message }));

  bot.action(/^edit:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const field = ctx.match[1];
    const labels = { description:"business description", location:"location (City, State)", phone:"phone number", opening_hours:"opening hours (e.g. Mon-Sat 9am-6pm)", delivery_info:"delivery information", delivery_fee:"delivery fee in ₦ (number only)" };
    ctx.session.storeEdit = { field };
    await ctx.reply(`Enter your ${labels[field] || field}:`, cancelMenu());
  });

  async function handleStoreEdit(ctx, text) {
    const v = await getVendorOrPrompt(ctx);
    if (!v) return;
    const { field } = ctx.session.storeEdit;
    const val = field === "delivery_fee" ? parseFloat(text)||0 : text;
    Vendors.update(v.id, { [field]: val });
    ctx.session.storeEdit = null;
    await ctx.reply(`✅ ${field.replace(/_/g," ")} updated!`, mainVendorMenu());
  }

  // ── PRODUCT MANAGEMENT ────────────────────────────────────
  bot.hears("📦 Products", async (ctx) => {
    const v = await getVendorOrPrompt(ctx);
    if (!v) return;
    const prods = Products.listByVendor(v.id);
    if (!prods.length) {
      return ctx.reply("📦 You have no products yet.\n\nAdd your first product:", Markup.inlineKeyboard([[Markup.button.callback("➕ Add Product", "addprod")]]));
    }
    await ctx.reply(
      `📦 *Your Products (${prods.length})*`,
      { parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("➕ Add Product", "addprod")],
          ...prods.slice(0,10).map(p => [Markup.button.callback(`${p.stock<=p.min_stock?"⚠️":"✅"} ${p.name} — ${fmt(p.price)} (${p.stock} left)`, `prod:${p.id}`)]),
        ]) }
    );
  });

  bot.command("product", async (ctx) => {
    const v = await getVendorOrPrompt(ctx);
    if (!v) return;
    await startAddProduct(ctx, v);
  });

  bot.command("myproducts", async (ctx) => {
    ctx.message.text = "📦 Products";
    return bot.handleUpdate({ message: ctx.message, update_id: 0 });
  });

  bot.action("addprod", async (ctx) => {
    await ctx.answerCbQuery();
    const v = await getVendorOrPrompt(ctx);
    if (!v) return;
    await startAddProduct(ctx, v);
  });

  async function startAddProduct(ctx, vendor) {
    ctx.session.addProduct = { step: "name", data: { vendor_id: vendor.id } };
    await ctx.reply("📦 *Add New Product*\n\nWhat's the product name?", { parse_mode:"Markdown", ...cancelMenu() });
  }

  async function handleAddProduct(ctx, text) {
    const ap = ctx.session.addProduct;
    const v  = Vendors.getByTelegramId(ctx.from.id);
    if (!v) return;

    if (ap.step === "name") {
      ap.data.name = text; ap.step = "price";
      return ctx.reply(`💰 Price for *${text}* (in ₦)?`, { parse_mode:"Markdown" });
    }
    if (ap.step === "price") {
      const p = parseFloat(text.replace(/[₦,\s]/g,""));
      if (isNaN(p)||p<0) return ctx.reply("❌ Enter a valid price (e.g. 2500)");
      ap.data.price = p; ap.step = "cost";
      return ctx.reply("💸 Cost/buying price in ₦? (for profit tracking — type 0 if unsure)");
    }
    if (ap.step === "cost") {
      ap.data.cost_price = parseFloat(text.replace(/[₦,\s]/g,""))||0;
      ap.step = "stock";
      return ctx.reply("📊 Opening stock quantity?");
    }
    if (ap.step === "stock") {
      ap.data.stock = parseInt(text)||0; ap.step = "unit";
      return ctx.reply("📏 Unit of measurement? (e.g. pieces, cartons, kg, litres)");
    }
    if (ap.step === "unit") {
      ap.data.unit = text; ap.step = "category";
      const cats = getCategories();
      return ctx.reply("📂 Select a category:", Markup.inlineKeyboard(
        cats.map(c => [Markup.button.callback(`${c.icon} ${c.name}`, `pc:${c.id}`)]).concat([[Markup.button.callback("⏭️ Skip", "pc:0")]])
      ));
    }
    if (ap.step === "description") {
      ap.data.description = text === "skip" ? null : text;
      ap.step = "image";
      return ctx.reply("📸 Send a product image (or type 'skip' to skip):");
    }
    if (ap.step === "image" && text.toLowerCase() === "skip") {
      await saveProduct(ctx, ap);
    }
  }

  bot.action(/^pc:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.session.addProduct) return;
    ctx.session.addProduct.data.category_id = ctx.match[1] === "0" ? null : parseInt(ctx.match[1]);
    ctx.session.addProduct.step = "description";
    await ctx.editMessageText("✅ Category selected");
    await ctx.reply("📝 Product description? (type 'skip' to skip):", cancelMenu());
  });

  bot.action("saveproduct", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.session.addProduct) return;
    await saveProduct(ctx, ctx.session.addProduct);
  });

  bot.action("cancelprod", async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.addProduct = null;
    await ctx.reply("❌ Product creation cancelled.", mainVendorMenu());
  });

  async function saveProduct(ctx, ap) {
    try {
      Products.create(ap.data);
      ctx.session.addProduct = null;
      await ctx.reply(
        `✅ *Product Added!*\n\n📦 ${ap.data.name}\n💰 ${fmt(ap.data.price)}\n📊 Stock: ${ap.data.stock} ${ap.data.unit}\n\nYour product is now live on the marketplace!`,
        { parse_mode:"Markdown", ...mainVendorMenu() }
      );
    } catch(e) {
      console.error("Save product:", e.message);
      ctx.session.addProduct = null;
      await ctx.reply("❌ Failed to save product. Try again.", mainVendorMenu());
    }
  }

  bot.action(/^prod:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const v = await getVendorOrPrompt(ctx);
    if (!v) return;
    const p = Products.getById(ctx.match[1]);
    if (!p || p.vendor_id !== v.id) return ctx.reply("Product not found.");
    await ctx.reply(
      `📦 *${p.name}*\n💰 ${fmt(p.price)} | Cost: ${fmt(p.cost_price)}\n📊 Stock: ${p.stock} ${p.unit}\n📌 Status: ${p.status}`,
      { parse_mode:"Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("📥 Stock In", `si:${p.id}`),
           Markup.button.callback("📤 Stock Out", `so:${p.id}`)],
          [Markup.button.callback("✏️ Edit Price", `ep:${p.id}`),
           Markup.button.callback(p.status==="active"?"⏸️ Deactivate":"▶️ Activate", `toggle:${p.id}`)],
          [Markup.button.callback("🌟 Feature", `feat:${p.id}`),
           Markup.button.callback("🗑️ Delete", `delprod:${p.id}`)],
        ]) }
    );
  });

  // Stock in/out
  bot.action(/^si:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.stockIn = { product_id: parseInt(ctx.match[1]) };
    await ctx.reply("📥 How many units are you adding to stock?", cancelMenu());
  });
  bot.action(/^so:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.stockOut = { product_id: parseInt(ctx.match[1]) };
    await ctx.reply("📤 How many units are you removing from stock?", cancelMenu());
  });
  async function handleStockIn(ctx, text) {
    const v = await getVendorOrPrompt(ctx);
    if (!v) return;
    const qty = parseInt(text)||0;
    if (qty <= 0) return ctx.reply("Enter a positive number.");
    Products.adjustStock(ctx.session.stockIn.product_id, v.id, qty);
    run("INSERT INTO inventory_movements (vendor_id,product_id,type,quantity,notes) VALUES (?,?,?,?,?)",
      [v.id, ctx.session.stockIn.product_id, "in", qty, "Manual stock in"]);
    ctx.session.stockIn = null;
    await ctx.reply(`✅ Added ${qty} to stock.`, mainVendorMenu());
  }
  async function handleStockOut(ctx, text) {
    const v = await getVendorOrPrompt(ctx);
    if (!v) return;
    const qty = parseInt(text)||0;
    if (qty <= 0) return ctx.reply("Enter a positive number.");
    Products.adjustStock(ctx.session.stockOut.product_id, v.id, -qty);
    ctx.session.stockOut = null;
    await ctx.reply(`✅ Removed ${qty} from stock.`, mainVendorMenu());
  }

  // Edit price
  bot.action(/^ep:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.editProduct = { id: parseInt(ctx.match[1]), field: "price" };
    await ctx.reply("💰 Enter new price in ₦:", cancelMenu());
  });
  async function handleEditProduct(ctx, text) {
    const v = await getVendorOrPrompt(ctx);
    if (!v) return;
    const { id, field } = ctx.session.editProduct;
    const val = field === "price" ? parseFloat(text.replace(/[₦,\s]/g,""))||0 : text;
    Products.update(id, v.id, { [field]: val });
    ctx.session.editProduct = null;
    await ctx.reply(`✅ ${field} updated!`, mainVendorMenu());
  }

  // Toggle status, feature, delete
  bot.action(/^toggle:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const v = await getVendorOrPrompt(ctx); if (!v) return;
    const p = Products.getById(ctx.match[1]);
    if (!p || p.vendor_id !== v.id) return;
    Products.update(p.id, v.id, { status: p.status==="active"?"inactive":"active" });
    await ctx.reply(`✅ Product ${p.status==="active"?"deactivated":"activated"}.`, mainVendorMenu());
  });
  bot.action(/^feat:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const v = await getVendorOrPrompt(ctx); if (!v) return;
    const p = Products.getById(ctx.match[1]);
    if (!p || p.vendor_id !== v.id) return;
    Products.update(p.id, v.id, { featured: p.featured ? 0 : 1 });
    await ctx.reply(`✅ Product ${p.featured?"removed from":"added to"} featured.`, mainVendorMenu());
  });
  bot.action(/^delprod:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const v = await getVendorOrPrompt(ctx); if (!v) return;
    Products.update(ctx.match[1], v.id, { status: "deleted" });
    await ctx.reply("🗑️ Product removed.", mainVendorMenu());
  });

  // Low stock command
  bot.command("lowstock", async (ctx) => {
    const v = await getVendorOrPrompt(ctx); if (!v) return;
    const low = Products.lowStock(v.id);
    if (!low.length) return ctx.reply("✅ All products have sufficient stock!", mainVendorMenu());
    const list = low.map(p => `⚠️ *${p.name}*: ${p.stock} ${p.unit} (min: ${p.min_stock})`).join("\n");
    await ctx.reply(`⚠️ *Low Stock Alert*\n\n${list}`, { parse_mode:"Markdown", ...mainVendorMenu() });
  });

  // Stockin / stockout commands
  bot.command("stockin",  async (ctx) => {
    const v = await getVendorOrPrompt(ctx); if (!v) return;
    const prods = Products.listByVendor(v.id);
    if (!prods.length) return ctx.reply("No products yet. Add one with /product.");
    await ctx.reply("📥 Which product are you restocking?",
      Markup.inlineKeyboard(prods.map(p => [Markup.button.callback(p.name, `si:${p.id}`)])));
  });
  bot.command("stockout", async (ctx) => {
    const v = await getVendorOrPrompt(ctx); if (!v) return;
    const prods = Products.listByVendor(v.id);
    if (!prods.length) return ctx.reply("No products yet.");
    await ctx.reply("📤 Which product are you removing stock from?",
      Markup.inlineKeyboard(prods.map(p => [Markup.button.callback(p.name, `so:${p.id}`)])));
  });

  // ── SERVICES ──────────────────────────────────────────────
  bot.hears("🛎️ Services", async (ctx) => {
    const v = await getVendorOrPrompt(ctx); if (!v) return;
    const svcs = Services.listByVendor(v.id);
    if (!svcs.length) return ctx.reply("You have no services yet. Add one with /service.");
    const list = svcs.map(s => `🛎️ *${s.name}* — ${fmt(s.price)}${s.duration_min?` (${s.duration_min} min)`:""}`).join("\n");
    await ctx.reply(`*Your Services:*\n\n${list}\n\nAdd more with /service`, { parse_mode:"Markdown", ...mainVendorMenu() });
  });

  bot.command("service", async (ctx) => {
    const v = await getVendorOrPrompt(ctx); if (!v) return;
    ctx.session.addService = { step: "name", data: { vendor_id: v.id } };
    await ctx.reply("🛎️ *Add New Service*\n\nService name?", { parse_mode:"Markdown", ...cancelMenu() });
  });

  async function handleAddService(ctx, text) {
    const as = ctx.session.addService;
    if (as.step === "name") {
      as.data.name = text; as.step = "price";
      return ctx.reply(`💰 Price for *${text}* in ₦?`, { parse_mode:"Markdown" });
    }
    if (as.step === "price") {
      as.data.price = parseFloat(text.replace(/[₦,\s]/g,""))||0;
      as.step = "duration";
      return ctx.reply("⏱️ Duration in minutes? (type 0 to skip)");
    }
    if (as.step === "duration") {
      as.data.duration_min = parseInt(text)||null;
      as.step = "availability";
      return ctx.reply("📅 Availability? (e.g. Mon-Sat 9am-6pm, or 'By appointment')");
    }
    if (as.step === "availability") {
      as.data.availability = text; as.step = "description";
      return ctx.reply("📝 Brief description? (or type 'skip')");
    }
    if (as.step === "description") {
      as.data.description = text === "skip" ? null : text;
      Services.create(as.data);
      ctx.session.addService = null;
      await ctx.reply(`✅ *Service Added!*\n\n🛎️ ${as.data.name}\n💰 ${fmt(as.data.price)}\n\nCustomers can now discover and book your service.`, { parse_mode:"Markdown", ...mainVendorMenu() });
    }
  }

  // ── ORDERS ────────────────────────────────────────────────
  bot.hears("📋 Orders", async (ctx) => {
    const v = await getVendorOrPrompt(ctx); if (!v) return;
    const orders = Orders.getVendorOrders(v.id, "pending", 10);
    if (!orders.length) {
      return ctx.reply("📋 No pending orders.\n\nAll caught up! ✅", mainVendorMenu());
    }
    await ctx.reply(`📋 *Pending Orders (${orders.length})*`, { parse_mode:"Markdown" });
    for (const o of orders.slice(0,5)) {
      await ctx.reply(
        `🛒 *Order ${o.order_ref}*\n` +
        `👤 ${o.customer_name}${o.customer_phone ? " · " + o.customer_phone : ""}\n` +
        `📦 ${o.quantity}× ${o.item_name} — ${fmt(o.total_price)}\n` +
        `📍 ${o.delivery_address||"Not specified"}`,
        { parse_mode:"Markdown",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("✅ Accept", `accept:${o.id}`),
             Markup.button.callback("❌ Reject", `reject:${o.id}`)],
            [Markup.button.callback("🚚 Mark Delivered", `deliver:${o.id}`)],
          ]) }
      );
    }
  });

  bot.command("orders", async (ctx) => {
    ctx.message.text = "📋 Orders";
    return ctx.emit("message", ctx.message);
  });

  bot.action(/^accept:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery("✅ Accepted");
    const itemId = ctx.match[1];
    if (itemId === "x") return;
    Orders.updateItemStatus(itemId, "accepted", null);
    await ctx.editMessageText("✅ Order accepted! The customer has been notified.");
  });
  bot.action(/^reject:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery("❌ Rejected");
    const itemId = ctx.match[1];
    if (itemId === "x") return;
    Orders.updateItemStatus(itemId, "rejected", null);
    await ctx.editMessageText("❌ Order rejected.");
  });
  bot.action(/^deliver:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery("🚚 Marked delivered");
    Orders.updateItemStatus(ctx.match[1], "delivered", null);
    await ctx.editMessageText("🚚 Order marked as delivered!");
  });

  // ── SALES ─────────────────────────────────────────────────
  bot.hears("📊 Sales", async (ctx) => {
    const v = await getVendorOrPrompt(ctx); if (!v) return;
    const today = Analytics.todaySales(v.id);
    const month = Analytics.monthSales(v.id);
    const tops  = Analytics.topProducts(v.id, 3);
    const topsText = tops.map((p,i) => `${i+1}. ${p.product_name} — ${p.sold} sold (${fmt(p.revenue)})`).join("\n") || "No sales yet";
    await ctx.reply(
      `📊 *Sales Summary*\n\n` +
      `*Today*\n` +
      `  💰 Revenue: ${fmt(today.revenue)}\n` +
      `  📦 Orders: ${today.count}\n` +
      `  💵 Profit: ${fmt(today.profit)}\n\n` +
      `*This Month*\n` +
      `  💰 Revenue: ${fmt(month.revenue)}\n` +
      `  📦 Orders: ${month.count}\n` +
      `  💵 Profit: ${fmt(month.profit)}\n\n` +
      `*Top Products*\n${topsText}`,
      { parse_mode:"Markdown", ...mainVendorMenu() }
    );
  });

  // Record manual sale
  bot.command("sale", async (ctx) => {
    const v = await getVendorOrPrompt(ctx); if (!v) return;
    const prods = Products.listByVendor(v.id);
    if (!prods.length) return ctx.reply("No products yet. Add one with /product.");
    ctx.session.recordSale = { step: "product", vendor: v };
    await ctx.reply("💰 *Record a Sale*\n\nSelect product:", { parse_mode:"Markdown",
      ...Markup.inlineKeyboard(prods.map(p => [Markup.button.callback(p.name, `sp:${p.id}`)]).concat([[Markup.button.callback("✏️ Manual entry", "sp:manual")]]))
    });
  });

  bot.action(/^sp:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.session.recordSale) return;
    if (ctx.match[1] === "manual") {
      ctx.session.recordSale.step = "manual_name";
      return ctx.reply("Enter product name:", cancelMenu());
    }
    const p = Products.getById(ctx.match[1]);
    ctx.session.recordSale.product = p;
    ctx.session.recordSale.step = "quantity";
    await ctx.editMessageText(`Selected: ${p.name} (${fmt(p.price)})`);
    await ctx.reply(`How many ${p.unit} did you sell?`, cancelMenu());
  });

  async function handleRecordSale(ctx, text) {
    const rs = ctx.session.recordSale;
    const v  = rs.vendor;
    if (rs.step === "manual_name") {
      rs.manual_name = text; rs.step = "manual_price";
      return ctx.reply("Price in ₦?");
    }
    if (rs.step === "manual_price") {
      rs.manual_price = parseFloat(text.replace(/[₦,\s]/g,""))||0;
      rs.step = "quantity";
      return ctx.reply("Quantity sold?");
    }
    if (rs.step === "quantity") {
      const qty  = parseInt(text)||1;
      const prod = rs.product;
      const name = prod?.name || rs.manual_name || "Manual sale";
      const price= prod?.price || rs.manual_price || 0;
      const cost = prod?.cost_price || 0;
      const commRate = parseFloat(getSetting("commission_rate")||"5");
      recordSale(v.id, null, prod?.id||null, name, qty, price, cost, commRate);
      if (prod) Products.adjustStock(prod.id, v.id, -qty);
      ctx.session.recordSale = null;
      await ctx.reply(`✅ Sale recorded!\n\n📦 ${qty}× ${name}\n💰 ${fmt(qty*price)}\n💵 Profit: ${fmt(qty*(price-cost))}`, mainVendorMenu());
    }
  }

  bot.command("sales",   async (ctx) => { ctx.message.text = "📊 Sales"; ctx.emit("message", ctx.message); });
  bot.command("revenue", async (ctx) => { ctx.message.text = "📊 Sales"; ctx.emit("message", ctx.message); });

  // ── ANALYTICS ─────────────────────────────────────────────
  bot.hears("📈 Analytics", async (ctx) => {
    const v = await getVendorOrPrompt(ctx); if (!v) return;
    const today = Analytics.todaySales(v.id);
    const month = Analytics.monthSales(v.id);
    const low   = Products.lowStock(v.id).length;
    const prods = Products.listByVendor(v.id).length;
    const svcs  = Services.listByVendor(v.id).length;
    const expenses = get("SELECT COALESCE(SUM(amount),0) as t FROM expenses WHERE vendor_id=? AND strftime('%Y-%m',created_at)=strftime('%Y-%m','now')", [v.id]);
    const netProfit= month.profit - (expenses?.t||0);
    await ctx.reply(
      `📈 *Business Analytics — ${v.business_name}*\n\n` +
      `*Today*\n` +
      `  Revenue: ${fmt(today.revenue)} | Sales: ${today.count}\n\n` +
      `*This Month*\n` +
      `  Revenue: ${fmt(month.revenue)}\n` +
      `  Gross Profit: ${fmt(month.profit)}\n` +
      `  Expenses: ${fmt(expenses?.t||0)}\n` +
      `  Net Profit: ${fmt(netProfit)}\n\n` +
      `*Catalog*\n` +
      `  Products: ${prods} | Services: ${svcs}\n` +
      `  ⚠️ Low stock: ${low} item(s)\n\n` +
      `*Rating:* ⭐ ${Number(v.rating).toFixed(1)} (${v.review_count} reviews)`,
      { parse_mode:"Markdown", ...mainVendorMenu() }
    );
  });

  bot.command("analytics", async (ctx) => { ctx.message.text = "📈 Analytics"; ctx.emit("message", ctx.message); });

  // ── EXPENSES ──────────────────────────────────────────────
  bot.hears("💸 Expenses", async (ctx) => {
    const v = await getVendorOrPrompt(ctx); if (!v) return;
    const today = Expenses.today(v.id);
    const list  = Expenses.list(v.id, 5);
    const recentText = list.map(e => `• ${e.description} — ${fmt(e.amount)}`).join("\n") || "None yet";
    await ctx.reply(
      `💸 *Expenses*\n\nToday: ${fmt(today.total)} (${today.count} items)\n\n*Recent:*\n${recentText}`,
      { parse_mode:"Markdown",
        ...Markup.inlineKeyboard([[Markup.button.callback("➕ Add Expense", "addexp")]]) }
    );
  });

  bot.command("expense",  async (ctx) => { ctx.message.text = "💸 Expenses"; ctx.emit("message", ctx.message); });
  bot.command("expenses", async (ctx) => { ctx.message.text = "💸 Expenses"; ctx.emit("message", ctx.message); });

  bot.action("addexp", async (ctx) => {
    await ctx.answerCbQuery();
    const v = await getVendorOrPrompt(ctx); if (!v) return;
    ctx.session.addExpense = { step: "description", vendor_id: v.id };
    await ctx.reply("💸 What was the expense? (e.g. Generator fuel, Staff salary)", cancelMenu());
  });

  async function handleAddExpense(ctx, text) {
    const ae = ctx.session.addExpense;
    if (ae.step === "description") {
      ae.description = text; ae.step = "amount";
      return ctx.reply("💰 Amount in ₦?");
    }
    if (ae.step === "amount") {
      const amount = parseFloat(text.replace(/[₦,\s]/g,""))||0;
      Expenses.add(ae.vendor_id, ae.description, amount, "General");
      ctx.session.addExpense = null;
      await ctx.reply(`✅ Expense recorded!\n${ae.description} — ${fmt(amount)}`, mainVendorMenu());
    }
  }

  // ── STAFF ─────────────────────────────────────────────────
  bot.hears("👥 Staff", async (ctx) => {
    const v = await getVendorOrPrompt(ctx); if (!v) return;
    const staff = Staff.list(v.id);
    if (!staff.length) return ctx.reply("👥 No staff added yet.\n\nAdd staff with /addstaff.", mainVendorMenu());
    const list = staff.map(s => `👤 *${s.name}* — ${s.role||"Staff"} | ${fmt(s.salary)}/month`).join("\n");
    await ctx.reply(`👥 *Your Team (${staff.length})*\n\n${list}`, { parse_mode:"Markdown", ...mainVendorMenu() });
  });

  bot.command("addstaff", async (ctx) => {
    const v = await getVendorOrPrompt(ctx); if (!v) return;
    ctx.session.addStaff = { step: "name", vendor_id: v.id };
    await ctx.reply("👤 Staff member's name?", cancelMenu());
  });

  async function handleAddStaff(ctx, text) {
    const as = ctx.session.addStaff;
    if (as.step === "name") {
      as.name = text; as.step = "role";
      return ctx.reply(`Role/position for ${text}?`);
    }
    if (as.step === "role") {
      as.role = text; as.step = "salary";
      return ctx.reply("Monthly salary in ₦?");
    }
    if (as.step === "salary") {
      const salary = parseFloat(text.replace(/[₦,\s]/g,""))||0;
      Staff.add(as.vendor_id, as.name, as.role, null, salary);
      ctx.session.addStaff = null;
      await ctx.reply(`✅ ${as.name} added to your team!`, mainVendorMenu());
    }
  }

  // ── DELIVERIES ────────────────────────────────────────────
  bot.hears("🚚 Deliveries", async (ctx) => {
    const v = await getVendorOrPrompt(ctx); if (!v) return;
    const deliveries = all("SELECT * FROM deliveries WHERE vendor_id=? AND status='pending' ORDER BY created_at DESC LIMIT 10", [v.id]);
    if (!deliveries.length) return ctx.reply("🚚 No pending deliveries.", mainVendorMenu());
    const list = deliveries.map(d => `📦 ${d.customer||"Customer"} — ${d.address||"Address"} | ${fmt(d.fee)}`).join("\n");
    await ctx.reply(`🚚 *Pending Deliveries:*\n\n${list}`, { parse_mode:"Markdown", ...mainVendorMenu() });
  });

  // ── AI ASSISTANT ──────────────────────────────────────────
  bot.hears("🤖 AI Assistant", async (ctx) => {
    const v = await getVendorOrPrompt(ctx); if (!v) return;
    ctx.session.aiChat = { vendor_id: v.id };
    await ctx.reply(
      `🤖 *ShopBot AI — ${v.business_name}*\n\n` +
      `Ask me anything about your business:\n\n` +
      `"How much did I make today?"\n` +
      `"What are my best-selling products?"\n` +
      `"What should I restock?"\n` +
      `"How did I perform this month?"\n\n` +
      `Type your question or ❌ Cancel to exit.`,
      { parse_mode:"Markdown", ...cancelMenu() }
    );
  });

  bot.command("ask", async (ctx) => {
    const v = await getVendorOrPrompt(ctx); if (!v) return;
    const question = ctx.args.join(" ");
    if (!question) {
      ctx.session.aiChat = { vendor_id: v.id };
      return ctx.reply("🤖 What would you like to know about your business?", cancelMenu());
    }
    await ctx.sendChatAction("typing");
    const today = Analytics.todaySales(v.id);
    const month = Analytics.monthSales(v.id);
    const tops  = Analytics.topProducts(v.id, 5);
    const low   = Products.lowStock(v.id);
    const answer = await askAI(v, question, { today, month, topProducts: tops, lowStock: low });
    await ctx.reply(`🤖 ${answer}`, mainVendorMenu());
  });

  async function handleAIChat(ctx, text) {
    const v = Vendors.getById(ctx.session.aiChat.vendor_id);
    if (!v) { ctx.session.aiChat = null; return; }
    await ctx.sendChatAction("typing");
    const today = Analytics.todaySales(v.id);
    const month = Analytics.monthSales(v.id);
    const tops  = Analytics.topProducts(v.id, 5);
    const low   = Products.lowStock(v.id);
    const answer = await askAI(v, text, { today, month, topProducts: tops, lowStock: low });
    await ctx.reply(`🤖 ${answer}\n\nAsk another question or ❌ Cancel to exit.`, cancelMenu());
  }

  // ── ADMIN COMMANDS ─────────────────────────────────────────
  bot.command(/^approve_(\d+)$/, async (ctx) => {
    if (!isAdminTelegramId(ctx.from.id)) return ctx.reply("❌ Unauthorized.");
    const id = ctx.match[1];
    Vendors.update(id, { status: "active" });
    const v = Vendors.getById(id);
    if (!v) return ctx.reply("Vendor not found.");
    const BASE = (process.env.WEBHOOK_URL||"http://localhost:3000").replace(/\/+$/,"");
    // Notify vendor
    await bot.telegram.sendMessage(v.telegram_id,
      `🎉 *Your store is APPROVED!*\n\n🏪 ${v.business_name} is now live on the ShopBot marketplace.\n\n🌐 ${BASE}/store/${v.store_slug}\n\nStart adding products: /product`,
      { parse_mode:"Markdown", ...mainVendorMenu() }
    ).catch(()=>{});
    await ctx.reply(`✅ Vendor ${v.business_name} approved.`);
  });

  bot.command(/^suspend_(\d+)$/, async (ctx) => {
    if (!isAdminTelegramId(ctx.from.id)) return ctx.reply("❌ Unauthorized.");
    Vendors.update(ctx.match[1], { status: "suspended" });
    await ctx.reply(`✅ Vendor suspended.`);
  });

  // ── FALLBACK ──────────────────────────────────────────────
  bot.on("text", async (ctx) => {
    const vendor = Vendors.getByTelegramId(ctx.from.id);
    if (vendor && vendor.status === "active") {
      await ctx.reply("I didn't understand that. Use /help to see all commands.", mainVendorMenu());
    } else {
      await ctx.reply("Type /start to get started or /register to create your store.");
    }
  });

  // ── LAUNCH ────────────────────────────────────────────────
  const WEBHOOK_URL = (process.env.WEBHOOK_URL||"").replace(/\/+$/,"");
  if (WEBHOOK_URL) {
    global._botWebhookHandler = bot.webhookCallback("/webhook");
    await bot.telegram.setWebhook(`${WEBHOOK_URL}/webhook`);
    console.log(`🌐 Bot webhook: ${WEBHOOK_URL}/webhook`);
  } else {
    bot.launch();
    console.log("🤖 Bot polling mode");
  }

  process.once("SIGINT",  () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));

  return bot;
}

module.exports = startBot;
