const { Markup } = require("telegraf");

const mainMenu = () =>
  Markup.keyboard([
    ["📊 Dashboard", "💰 Sales"],
    ["📦 Inventory", "🚚 Deliveries"],
    ["👥 Payroll", "🤝 Suppliers"],
    ["📈 Analytics", "🤖 Ask ShopBoss"],
    ["⚙️ Settings", "❓ Help"],
  ]).resize();

const cancelMenu = () =>
  Markup.keyboard([["❌ Cancel"]]).resize();

const backMenu = () =>
  Markup.keyboard([["⬅️ Back to Menu"]]).resize();

const confirmKeyboard = (yesData, noData) =>
  Markup.inlineKeyboard([
    [Markup.button.callback("✅ Confirm", yesData), Markup.button.callback("❌ Cancel", noData)],
  ]);

const statusKeyboard = (orderId) =>
  Markup.inlineKeyboard([
    [Markup.button.callback("✅ Confirmed", `status:${orderId}:confirmed`)],
    [Markup.button.callback("⚙️ Processing", `status:${orderId}:processing`)],
    [Markup.button.callback("🚚 Shipped", `status:${orderId}:shipped`)],
    [Markup.button.callback("📦 Delivered", `status:${orderId}:delivered`)],
    [Markup.button.callback("❌ Cancelled", `status:${orderId}:cancelled`)],
  ]);

module.exports = { mainMenu, cancelMenu, backMenu, confirmKeyboard, statusKeyboard };
