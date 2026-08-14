require("dotenv").config();
const { Telegraf, session, Markup } = require("telegraf");
const express = require("express");
const path = require("path");
const { init } = require("./db/database");

if (!process.env.BOT_TOKEN) {
  console.error("❌ BOT_TOKEN is not set.");
  process.exit(1);
}

init().then(() => {
  const bot = new Telegraf(process.env.BOT_TOKEN);
  bot.use(session());
  bot.use(async (ctx, next) => { if (!ctx.from) return; return next(); });

  // Register all command modules
  require("./commands/core").registerCore(bot);
  require("./commands/sales").registerSales(bot);
  require("./commands/inventory").registerInventory(bot);
  require("./commands/operations").registerOperations(bot);
  require("./commands/analytics").registerAnalytics(bot);

  // ── Mini App button — opens the dashboard inside Telegram ──
  bot.command("app", async (ctx) => {
    const url = process.env.WEBHOOK_URL
      ? `${process.env.WEBHOOK_URL}/mini`
      : `http://localhost:${process.env.PORT || 3000}/mini`;

    await ctx.reply(
      "📱 *Open ShopBoss Dashboard*\n\nTap the button below to open your full business dashboard inside Telegram:",
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.webApp("📊 Open ShopBoss App", url)],
        ]),
      }
    );
  });

  // Also attach Mini App button to main menu /start
  // (overrides core.js /start just to add the app button)
  // Done via a "hears" that won't conflict

  // Error handler
  bot.catch(async (err, ctx) => {
    console.error(`❌ [${ctx.updateType}]:`, err.message);
    try { await ctx.reply("⚠️ Something went wrong. Please try again or use /start to reset."); } catch {}
  });

  // Fallback
  bot.on("text", async (ctx) => {
    await ctx.reply(
      "🤔 I didn't understand that.\n\nUse /menu to see all options or /app to open the dashboard.",
      require("./utils/keyboards").mainMenu()
    );
  });

  // Express server
  const app = express();
  app.use(express.json());

  // ── Serve Mini App + its API routes ──
  app.use("/mini", require("./services/miniapp"));

  const PORT = process.env.PORT || 3000;
  const WEBHOOK_URL = process.env.WEBHOOK_URL;

  if (WEBHOOK_URL) {
    app.use(bot.webhookCallback("/webhook"));
    bot.telegram.setWebhook(`${WEBHOOK_URL}/webhook`).then(() => {
      console.log(`🌐 Webhook: ${WEBHOOK_URL}/webhook`);
    });
  } else {
    bot.launch();
    console.log("🤖 ShopBoss running (polling mode)");
  }

  app.get("/", (req, res) => res.json({ status: "ok", bot: "ShopBoss", miniApp: "/mini" }));
  app.get("/health", (req, res) => res.json({ status: "ok" }));
  app.listen(PORT, () => {
    console.log(`🚀 Server on port ${PORT}`);
    console.log(`📱 Mini App: http://localhost:${PORT}/mini`);
  });

  try { require("./services/jobs").startJobs(bot); } catch (e) { console.warn("Jobs skipped:", e.message); }

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));

}).catch((err) => {
  console.error("❌ Failed to start:", err.message);
  process.exit(1);
});
