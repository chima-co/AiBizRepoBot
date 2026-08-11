const express = require("express");
const app = express();
app.use(express.json());

// ─── In-memory store (replace with a real DB in production) ───────────────────
const store = {
  products: [
    { id: 1, name: "T-Shirt", price: 15.99, stock: 50, category: "Clothing" },
    { id: 2, name: "Sneakers", price: 59.99, stock: 30, category: "Footwear" },
    { id: 3, name: "Cap", price: 12.99, stock: 100, category: "Accessories" },
    { id: 4, name: "Hoodie", price: 39.99, stock: 20, category: "Clothing" },
    { id: 5, name: "Backpack", price: 49.99, stock: 15, category: "Accessories" },
  ],
  carts: {},      // userId -> [{ productId, qty }]
  orders: {},     // userId -> [{ orderId, items, total, status, date }]
  orderCounter: 1000,
};

const BOT_TOKEN = process.env.BOT_TOKEN || "YOUR_BOT_TOKEN_HERE";
const BASE_URL  = process.env.BASE_URL  || "https://your-app.onrender.com";

// ─── Telegram API helper ──────────────────────────────────────────────────────
async function telegram(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

function send(chatId, text, extra = {}) {
  return telegram("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...extra });
}

function answer(callbackQueryId, text = "") {
  return telegram("answerCallbackQuery", { callback_query_id: callbackQueryId, text });
}

// ─── Keyboard builders ────────────────────────────────────────────────────────
const mainMenu = {
  inline_keyboard: [
    [{ text: "🛍️ Shop",      callback_data: "shop"      }, { text: "🛒 My Cart",  callback_data: "cart"    }],
    [{ text: "📦 My Orders", callback_data: "orders"    }, { text: "🔍 Search",   callback_data: "search"  }],
    [{ text: "📞 Support",   callback_data: "support"   }, { text: "ℹ️ About",    callback_data: "about"   }],
  ],
};

function categoryKeyboard() {
  const cats = [...new Set(store.products.map(p => p.category))];
  const rows = cats.map(c => [{ text: `📁 ${c}`, callback_data: `cat_${c}` }]);
  rows.push([{ text: "🏠 Main Menu", callback_data: "menu" }]);
  return { inline_keyboard: rows };
}

function productKeyboard(products) {
  const rows = products.map(p => [{
    text: `${p.name} — $${p.price.toFixed(2)} ${p.stock === 0 ? "❌" : "✅"}`,
    callback_data: `prod_${p.id}`,
  }]);
  rows.push([{ text: "🏠 Main Menu", callback_data: "menu" }]);
  return { inline_keyboard: rows };
}

function productDetailKeyboard(p) {
  const buttons = [
    [{ text: "➕ Add to Cart", callback_data: `add_${p.id}` }],
    [{ text: "◀️ Back to Shop", callback_data: "shop" }, { text: "🛒 View Cart", callback_data: "cart" }],
    [{ text: "🏠 Main Menu", callback_data: "menu" }],
  ];
  return { inline_keyboard: buttons };
}

function cartKeyboard(userId) {
  const cart = store.carts[userId] || [];
  const buttons = cart.map(item => {
    const p = store.products.find(x => x.id === item.productId);
    return [{ text: `❌ Remove ${p?.name}`, callback_data: `remove_${item.productId}` }];
  });
  if (cart.length > 0) {
    buttons.push([{ text: "✅ Checkout", callback_data: "checkout" }]);
  }
  buttons.push([{ text: "🏠 Main Menu", callback_data: "menu" }]);
  return { inline_keyboard: buttons };
}

// ─── State machine for search ─────────────────────────────────────────────────
const awaitingSearch = new Set();

// ─── Message handler ──────────────────────────────────────────────────────────
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const userId = String(chatId);
  const text   = msg.text || "";

  if (awaitingSearch.has(userId)) {
    awaitingSearch.delete(userId);
    const q = text.toLowerCase();
    const results = store.products.filter(p =>
      p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)
    );
    if (results.length === 0) {
      return send(chatId, `❌ No products found for "<b>${text}</b>".`, { reply_markup: mainMenu });
    }
    return send(chatId, `🔍 Results for "<b>${text}</b>":`, { reply_markup: productKeyboard(results) });
  }

  if (text === "/start" || text === "/menu") {
    return send(chatId,
      `👋 Welcome to <b>ShopBot</b>!\n\nYour one-stop shop. Browse products, add to cart, and place orders — all from Telegram.\n\nWhat would you like to do?`,
      { reply_markup: mainMenu }
    );
  }

  if (text === "/cart")   return showCart(chatId, userId);
  if (text === "/orders") return showOrders(chatId, userId);

  return send(chatId, "Use /start to open the main menu.", { reply_markup: mainMenu });
}

// ─── Callback handler ─────────────────────────────────────────────────────────
async function handleCallback(cb) {
  const chatId = cb.message.chat.id;
  const userId = String(chatId);
  const data   = cb.data;

  await answer(cb.id);

  // Main menu
  if (data === "menu") {
    return send(chatId, "🏠 <b>Main Menu</b>", { reply_markup: mainMenu });
  }

  // Shop — show categories
  if (data === "shop") {
    return send(chatId, "🛍️ <b>Browse by Category</b>", { reply_markup: categoryKeyboard() });
  }

  // Category selected
  if (data.startsWith("cat_")) {
    const cat = data.replace("cat_", "");
    const prods = store.products.filter(p => p.category === cat);
    return send(chatId, `📁 <b>${cat}</b> — ${prods.length} items`, { reply_markup: productKeyboard(prods) });
  }

  // Product detail
  if (data.startsWith("prod_")) {
    const id = parseInt(data.replace("prod_", ""));
    const p  = store.products.find(x => x.id === id);
    if (!p) return send(chatId, "Product not found.");
    const txt = `🏷️ <b>${p.name}</b>\n\n💰 Price: $${p.price.toFixed(2)}\n📦 Category: ${p.category}\n🔢 In Stock: ${p.stock}\n\n${p.stock > 0 ? "✅ Available" : "❌ Out of Stock"}`;
    return send(chatId, txt, { reply_markup: productDetailKeyboard(p) });
  }

  // Add to cart
  if (data.startsWith("add_")) {
    const id = parseInt(data.replace("add_", ""));
    const p  = store.products.find(x => x.id === id);
    if (!p || p.stock === 0) return send(chatId, "❌ Item unavailable.");
    if (!store.carts[userId]) store.carts[userId] = [];
    const existing = store.carts[userId].find(i => i.productId === id);
    if (existing) {
      existing.qty += 1;
    } else {
      store.carts[userId].push({ productId: id, qty: 1 });
    }
    return send(chatId, `✅ <b>${p.name}</b> added to your cart!`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🛒 View Cart", callback_data: "cart" }, { text: "🛍️ Keep Shopping", callback_data: "shop" }],
        ],
      },
    });
  }

  // Remove from cart
  if (data.startsWith("remove_")) {
    const id = parseInt(data.replace("remove_", ""));
    store.carts[userId] = (store.carts[userId] || []).filter(i => i.productId !== id);
    return showCart(chatId, userId);
  }

  // View cart
  if (data === "cart") return showCart(chatId, userId);

  // Checkout
  if (data === "checkout") {
    const cart = store.carts[userId] || [];
    if (cart.length === 0) return send(chatId, "🛒 Your cart is empty.");
    let total = 0;
    const lineItems = cart.map(item => {
      const p = store.products.find(x => x.id === item.productId);
      const subtotal = p.price * item.qty;
      total += subtotal;
      p.stock -= item.qty; // deduct stock
      return `• ${p.name} x${item.qty} = $${subtotal.toFixed(2)}`;
    });
    const orderId = ++store.orderCounter;
    if (!store.orders[userId]) store.orders[userId] = [];
    store.orders[userId].push({
      orderId,
      items: [...cart],
      total,
      status: "Confirmed",
      date: new Date().toLocaleString(),
    });
    store.carts[userId] = [];
    const receipt = `🎉 <b>Order #${orderId} Confirmed!</b>\n\n${lineItems.join("\n")}\n\n💰 <b>Total: $${total.toFixed(2)}</b>\n📅 ${new Date().toLocaleString()}\n\nWe'll notify you when it's shipped! 🚚`;
    return send(chatId, receipt, { reply_markup: mainMenu });
  }

  // Orders
  if (data === "orders") return showOrders(chatId, userId);

  // Search
  if (data === "search") {
    awaitingSearch.add(userId);
    return send(chatId, "🔍 Type the product name or category you're looking for:");
  }

  // Support
  if (data === "support") {
    return send(chatId,
      "📞 <b>Support</b>\n\nFor help, email us at: <b>support@shopbot.com</b>\nOr call: <b>+1 (800) SHOPBOT</b>\n\nWe're here Mon–Fri, 9am–6pm.",
      { reply_markup: mainMenu }
    );
  }

  // About
  if (data === "about") {
    return send(chatId,
      "ℹ️ <b>About ShopBot</b>\n\nShopBot is your personal shopping assistant on Telegram.\n\n🛍️ Browse 100s of products\n🛒 Easy cart & checkout\n📦 Track your orders\n💬 24/7 support\n\nPowered by cutting-edge AI & automation.",
      { reply_markup: mainMenu }
    );
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function showCart(chatId, userId) {
  const cart = store.carts[userId] || [];
  if (cart.length === 0) {
    return send(chatId, "🛒 Your cart is empty. Start shopping!", { reply_markup: mainMenu });
  }
  let total = 0;
  const lines = cart.map(item => {
    const p = store.products.find(x => x.id === item.productId);
    const subtotal = p.price * item.qty;
    total += subtotal;
    return `• ${p.name} x${item.qty} — $${subtotal.toFixed(2)}`;
  });
  const txt = `🛒 <b>Your Cart</b>\n\n${lines.join("\n")}\n\n💰 <b>Total: $${total.toFixed(2)}</b>`;
  return send(chatId, txt, { reply_markup: cartKeyboard(userId) });
}

async function showOrders(chatId, userId) {
  const orders = store.orders[userId] || [];
  if (orders.length === 0) {
    return send(chatId, "📦 You have no orders yet.", { reply_markup: mainMenu });
  }
  const lines = orders.slice(-5).reverse().map(o =>
    `🧾 <b>Order #${o.orderId}</b>\n   Status: ${o.status} | Total: $${o.total.toFixed(2)}\n   📅 ${o.date}`
  );
  return send(chatId, `📦 <b>Your Orders</b>\n\n${lines.join("\n\n")}`, { reply_markup: mainMenu });
}

// ─── Webhook endpoint ─────────────────────────────────────────────────────────
app.post(`/webhook/${BOT_TOKEN}`, async (req, res) => {
  res.sendStatus(200);
  const update = req.body;
  try {
    if (update.message)        await handleMessage(update.message);
    if (update.callback_query) await handleCallback(update.callback_query);
  } catch (e) {
    console.error("Update error:", e);
  }
});

// ─── Dashboard ────────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  const totalOrders  = Object.values(store.orders).flat().length;
  const totalRevenue = Object.values(store.orders).flat().reduce((s, o) => s + o.total, 0);
  const activeCarts  = Object.values(store.carts).filter(c => c.length > 0).length;

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ShopBot Dashboard</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; }
  header { background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 24px 32px; display: flex; align-items: center; gap: 16px; }
  header h1 { font-size: 1.8rem; font-weight: 700; }
  header span { font-size: 2rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; padding: 32px; }
  .card { background: #1e293b; border-radius: 16px; padding: 24px; border: 1px solid #334155; }
  .card .label { font-size: .8rem; color: #94a3b8; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 8px; }
  .card .value { font-size: 2rem; font-weight: 700; color: #f8fafc; }
  .card .sub { font-size: .8rem; color: #64748b; margin-top: 4px; }
  .section { padding: 0 32px 32px; }
  .section h2 { font-size: 1.2rem; margin-bottom: 16px; color: #a5b4fc; }
  table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 12px; overflow: hidden; }
  th { background: #334155; padding: 12px 16px; text-align: left; font-size: .8rem; color: #94a3b8; text-transform: uppercase; }
  td { padding: 12px 16px; border-bottom: 1px solid #334155; font-size: .9rem; }
  tr:last-child td { border: none; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: .75rem; font-weight: 600; }
  .badge-green { background: #166534; color: #bbf7d0; }
  .badge-red   { background: #7f1d1d; color: #fecaca; }
  .setup { background: #1e293b; border-radius: 16px; margin: 0 32px 32px; padding: 24px; border: 1px solid #334155; }
  .setup h2 { color: #a5b4fc; margin-bottom: 12px; }
  .setup code { background: #0f172a; border-radius: 8px; padding: 12px 16px; display: block; margin: 8px 0; font-size: .85rem; color: #67e8f9; white-space: pre-wrap; word-break: break-all; }
  .step { margin-bottom: 12px; }
  .step strong { color: #c4b5fd; }
</style>
</head>
<body>
<header>
  <span>🤖</span>
  <div>
    <h1>ShopBot Dashboard</h1>
    <p style="color:#c4b5fd;font-size:.9rem">Live business overview</p>
  </div>
</header>

<div class="grid">
  <div class="card">
    <div class="label">Total Orders</div>
    <div class="value">${totalOrders}</div>
    <div class="sub">All time</div>
  </div>
  <div class="card">
    <div class="label">Revenue</div>
    <div class="value">$${totalRevenue.toFixed(2)}</div>
    <div class="sub">All time</div>
  </div>
  <div class="card">
    <div class="label">Active Carts</div>
    <div class="value">${activeCarts}</div>
    <div class="sub">Users with items</div>
  </div>
  <div class="card">
    <div class="label">Products</div>
    <div class="value">${store.products.length}</div>
    <div class="sub">In catalogue</div>
  </div>
</div>

<div class="section">
  <h2>📦 Product Inventory</h2>
  <table>
    <thead><tr><th>#</th><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th></tr></thead>
    <tbody>
      ${store.products.map(p => `
        <tr>
          <td>${p.id}</td>
          <td><strong>${p.name}</strong></td>
          <td>${p.category}</td>
          <td>$${p.price.toFixed(2)}</td>
          <td>${p.stock}</td>
          <td><span class="badge ${p.stock > 0 ? "badge-green" : "badge-red"}">${p.stock > 0 ? "In Stock" : "Out of Stock"}</span></td>
        </tr>`).join("")}
    </tbody>
  </table>
</div>

<div class="setup">
  <h2>🚀 Setup Instructions</h2>
  <div class="step"><strong>Step 1 — Deploy to Render (free)</strong><br>Push this project to GitHub, then connect it on <a href="https://render.com" style="color:#a5b4fc">render.com</a> as a Node.js web service.</div>
  <div class="step"><strong>Step 2 — Set environment variables</strong>
    <code>BOT_TOKEN=your_telegram_bot_token_from_BotFather
BASE_URL=https://your-app.onrender.com</code>
  </div>
  <div class="step"><strong>Step 3 — Register webhook with Telegram</strong>
    <code>curl "https://api.telegram.org/bot&lt;BOT_TOKEN&gt;/setWebhook?url=${BASE_URL}/webhook/&lt;BOT_TOKEN&gt;"</code>
  </div>
  <div class="step"><strong>Step 4 — Open your bot on Telegram and type /start 🎉</strong></div>
</div>

</body>
</html>`);
});

// ─── Register webhook on startup ──────────────────────────────────────────────
async function registerWebhook() {
  if (BOT_TOKEN === "YOUR_BOT_TOKEN_HERE") {
    console.log("⚠️  Set BOT_TOKEN env variable to register webhook.");
    return;
  }
  const url = `${BASE_URL}/webhook/${BOT_TOKEN}`;
  const res = await telegram("setWebhook", { url });
  console.log("Webhook registered:", res.ok ? "✅" : `❌ ${res.description}`);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🤖 ShopBot running on port ${PORT}`);
  registerWebhook().catch(console.error);
});
