// ─────────────────────────────────────────────
//  core.js — /start /help /menu /dashboard
// ─────────────────────────────────────────────
const { Analytics } = require("../db/database");
const { fmt, getBusiness, safeReply } = require("../utils/helpers");
const { mainMenu } = require("../utils/keyboards");

function registerCore(bot) {
  // /start — FIX 5: clear ALL stuck session state so users are never trapped
  bot.start(async (ctx) => {
    ctx.session = {}; // wipe any stuck flow

    // Handle referral link: /start ref_12345
    const payload = ctx.startPayload;
    if (payload && payload.startsWith("ref_")) {
      const referrerId = payload.replace("ref_", "");
      if (referrerId !== String(ctx.from.id)) {
        const { Referrals } = require("../db/database");
        Referrals.create(referrerId, ctx.from.id);
      }
    } // end if (payload)
    // session cleared — sale, product, expense flows all reset
    const biz = getBusiness(ctx);
    const name = ctx.from.first_name || "Boss";

    // Auto-create/update vendor profile from Telegram user data (no signup form needed)
    try {
      const { Vendors, Settings } = require("../db/database");
      const industry = Settings.get(biz.id, "industry") || null;
      const fullName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || name;
      Vendors.upsertFromBot({
        telegram_id:      String(ctx.from.id),
        business_id:      biz.id,
        name:             biz.name !== "My Business" ? biz.name : fullName + "'s Business",
        telegram_username: ctx.from.username || null,
        industry:         industry,
      });
    } catch(e) { console.warn("Vendor upsert failed:", e.message); }
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
              [Markup.button.callback("💱 Crypto & Gift Cards", "setind:Crypto & Gift Cards"), Markup.button.callback("🏦 Finance", "setind:Finance")],
              [Markup.button.callback("📋 See all 25 industries", "change_industry")],
            ])
          });
        } catch(_) {}
      }, 1500);
    }

    // Check if KYC is complete
    const { UserProfiles } = require("../db/database");
    const profile = UserProfiles.get(ctx.from.id);
    const kycDone = !!profile?.kyc_complete;
    const baseUrl = (process.env.WEBHOOK_URL || "").replace(/\/+$/, "");

    if (!kycDone) {
      // First-time user — direct to KYC
      const { Markup } = require("telegraf");
      await safeReply(ctx,
        `👋 *Welcome to ShopBoss, ${name}!*\n\n` +
        `Before you can start, you need to complete a quick account setup.\n\n` +
        `*This takes about 2 minutes and includes:*\n` +
        `✅ Your full name and business name\n` +
        `✅ Email verification (OTP)\n` +
        `✅ Phone number and address\n\n` +
        `This is required so we can verify your identity and create your marketplace profile.`,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [Markup.button.webApp("🚀 Complete Setup Now", `${baseUrl}/mini`)],
            [Markup.button.url("🌐 Open in Browser", `${baseUrl}/mini`)],
          ]),
        }
      );
    } else {
      // Returning user — show full welcome
      await safeReply(ctx,
        `👋 *Welcome back, ${name}!*\n\n` +
        `Your business: *${biz.name}*\n\n` +
        `What would you like to do today?`,
        mainMenu()
      );
    }
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
      `*⚙️ Manage*\n` +
      `/setup — Onboarding checklist\n` +
      `/profile — Your marketplace profile\n` +
      `/setphone — Add phone number\n` +
      `/setlocation — Add location\n` +
      `/setname — Rename business\n` +
      `/setindustry — Set industry\n` +
      `/deleteproduct — Remove a product\n` +
      `/customers — Top customers\n` +
      `/report — Monthly report\n` +
      `/cancel — Cancel any flow\n` +
      `/pay — Upgrade plan\n` +
      `/alerts — View alerts\n` +
      `/support — Get help`,
      mainMenu()
    );
  });

  // /menu and /cancel — universal reset
  bot.command("menu", async (ctx) => {
    await safeReply(ctx, "📋 *Main Menu* — Choose an option:", mainMenu());
  });
  bot.command("cancel", async (ctx) => {
    // Clear all multi-step flow keys (not the whole session object)
    const keep = {}; // preserve non-flow keys like _trialBannerShown
    if (ctx.session._trialBannerShown) keep._trialBannerShown = ctx.session._trialBannerShown;
    ctx.session = keep;
    await safeReply(ctx, "❌ *Cancelled.* What would you like to do?", mainMenu());
  });
  bot.hears("⬅️ Back to Menu", async (ctx) => {
    const keep = {};
    if (ctx.session._trialBannerShown) keep._trialBannerShown = ctx.session._trialBannerShown;
    ctx.session = keep;
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
    // Sync name to vendor profile
    try {
      const { Vendors } = require("../db/database");
      const v = Vendors.getByTgId(ctx.from.id);
      if (v) Vendors.update(v.id, { name: newName });
    } catch(_) {}
    await safeReply(ctx, `✅ Business renamed to: *${newName}*`, mainMenu());
  });

  // /setindustry — set business industry for AI context
  bot.command("setindustry", async (ctx) => {
    const { Markup } = require("telegraf");
    const INDS = ["Agriculture","Logistics","Shipping","Warehousing","Manufacturing","Retail",
      "Wholesale","Pharmacy","Fashion","Food & Beverage","Tech & Repairs","Energy",
      "Construction","Beauty","Education","Hospitality","Agro-Processing","Printing",
      "Security","Healthcare","Auto & Transport","ICT","Finance","Export/Import","Crypto & Gift Cards"];
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
    const db = require("../db/database");
    db.Settings.set(biz.id, "industry", industry);
    // Sync industry to vendor profile
    try {
      const v = db.Vendors.getByTgId(ctx.from.id);
      if (v) db.Vendors.update(v.id, { industry });
    } catch(_) {}
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
      "Security","Healthcare","Auto & Transport","ICT","Finance","Export/Import","Crypto & Gift Cards"];
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
    const { Tickets } = require("../db/database");
    const myTickets = Tickets.listByUser(ctx.from.id);
    const openCount = myTickets.filter(t => t.status === "open" || t.status === "in_progress").length;
    await safeReply(ctx,
      `💬 *ShopBoss Support*\n\n` +
      `Your open tickets: ${openCount}\n\n` +
      `Open a ticket: /ticket Your question here\n\n` +
      `📞 Urgent: +234 902 909 2881\n` +
      `✉️ Okonkwochima2006@gmail.com`,
      mainMenu()
    );
  });

  bot.command("ticket", async (ctx) => {
    const { Tickets } = require("../db/database");
    const message = ctx.args.join(" ").trim();
    if (!message) return safeReply(ctx, "Usage: /ticket Your question here", mainMenu());
    const subject = message.split(" ").slice(0, 6).join(" ");
    const r = Tickets.create(ctx.from.id, subject, message);
    await safeReply(ctx,
      `🎫 *Ticket #${r.lastInsertRowid} Created*\n\nWe reply within 4 hours (Mon-Sat, 8AM-8PM).`,
      mainMenu()
    );
    const adminId = process.env.ADMIN_TELEGRAM_ID;
    if (adminId) {
      ctx.telegram.sendMessage(adminId,
        `🎫 New Ticket #${r.lastInsertRowid} from ${ctx.from.id} (@${ctx.from.username || "?"}): ${subject}\nReply: /areply ${r.lastInsertRowid} message`,
        { parse_mode: "Markdown" }
      ).catch(() => {});
    }
  });

  bot.command("refer", async (ctx) => {
    const { Referrals } = require("../db/database");
    const stats = Referrals.stats(ctx.from.id);
    const refLink = `https://t.me/AiBizRepoBot?start=ref_${ctx.from.id}`;
    await safeReply(ctx,
      `🤝 *Refer & Earn*\n\nShare your link and earn 1 free month for every friend who subscribes.\n\nYour link:\n${refLink}\n\nReferred: ${stats.total} | Credited: ${stats.credited}`,
      mainMenu()
    );
  });

  // /pay — handled by paywall.js (removed duplicate)

  // /profile — show and update your marketplace profile
  bot.command("profile", async (ctx) => {
    const biz = getBusiness(ctx);
    const { Settings, Vendors } = require("../db/database");
    const industry = Settings.get(biz.id, "industry") || "Not set";
    const vendor = Vendors.getByTgId(ctx.from.id);
    const { Markup } = require("telegraf");

    await safeReply(ctx,
      `👤 *Your Profile*\n\n` +
      `Business: *${biz.name}*\n` +
      `Industry: *${industry}*\n` +
      `Phone: ${vendor?.phone || "Not set"}\n` +
      `Location: ${vendor?.location || "Not set"}\n` +
      `Marketplace: ${vendor ? "✅ Listed" : "⚠️ Not listed"}\n` +
      (vendor ? `Rating: ⭐ ${vendor.rating} (${vendor.review_count} reviews)\n` : "") +
      `\n*Update your profile:*\n` +
      `/setname — change business name\n` +
      `/setindustry — change industry\n` +
      `/setphone — add phone number\n` +
      `/setlocation — add location`,
      mainMenu()
    );
  });

  // /setrates — crypto P2P merchants update live buy/sell rates
  bot.command("setrates", async (ctx) => {
    const { Settings } = require("../db/database");
    const biz = getBusiness(ctx);
    const industry = Settings.get(biz.id, "industry");
    if (industry !== "Crypto & Gift Cards") {
      return safeReply(ctx, "⚠️ /setrates is for Crypto & Gift Cards businesses.\n\nSet your industry to 'Crypto & Gift Cards' first using /setindustry.");
    }
    ctx.session.setRates = { step: "buy" };
    await safeReply(ctx,
      `💱 *Update Your Trading Rates*\n\nLet's update your live buy and sell rates for your marketplace profile.\n\n*What is your USDT buy rate? (₦ per USDT)*\n\nThis is the rate at which you buy USDT *from* customers — what you pay them.\n_(Jeroid current rate: ~₦1,410. e.g. type 1410)_`,
      cancelMenu()
    );
  });

  // /setlimits — set order limits for P2P profile
  bot.command("setlimits", async (ctx) => {
    const { Settings } = require("../db/database");
    const biz = getBusiness(ctx);
    const industry = Settings.get(biz.id, "industry");
    if (industry !== "Crypto & Gift Cards") {
      return safeReply(ctx, "⚠️ /setlimits is for Crypto & Gift Cards businesses only.");
    }
    ctx.session.setLimits = { step: "min" };
    await safeReply(ctx,
      `📊 *Set Trade Size Limits*\n\nWhat is the *minimum* trade you accept in ₦?\n_(e.g. 5000 for ₦5,000 minimum — enter the number only)_`,
      cancelMenu()
    );
  });

  // /p2pstats — quick P2P dashboard
  bot.command("cryptostats", async (ctx) => {
    const { Settings, Vendors } = require("../db/database");
    const biz    = getBusiness(ctx);
    const vendor = Vendors.getByTgId(ctx.from.id);
    const industry = Settings.get(biz.id, "industry");
    if (industry !== "Crypto & Gift Cards") {
      return safeReply(ctx, "⚠️ /p2pstats is for Crypto & Gift Cards businesses. Use /setindustry first.");
    }
    const v = vendor || {};
    const spread = v.sell_rate && v.buy_rate ? (v.sell_rate - v.buy_rate).toFixed(2) : "N/A";
    const fmtN = n => n ? "₦" + Number(n).toLocaleString("en-NG") : "Not set";
    await safeReply(ctx,
      `💱 *Your Crypto & Gift Cards Profile*\n\n` +
      `📈 Buy Rate (USDT):  *${fmtN(v.buy_rate)}/USDT*\n` +
      `📉 Sell Rate (USDT): *${fmtN(v.sell_rate)}/USDT*\n` +
      `💰 Spread:           *₦${spread}/USDT*\n\n` +
      `📦 Assets Traded:  ${v.pairs_traded || "Not set"}\n` +
      `🎁 Gift Cards:     ${v.platforms_active || "Not set"}\n` +
      `📊 Trade Limits:   ₦${v.order_min ? Number(v.order_min).toLocaleString() : "?"} – ₦${v.order_max ? Number(v.order_max).toLocaleString() : "?"}\n` +
      `⚡ Payout Speed:   ${v.completion_rate ? v.completion_rate + " mins avg" : "Not set"}\n` +
      `🏆 Total Trades:   ${v.trade_count ? Number(v.trade_count).toLocaleString() : "Not set"}\n\n` +
      `Use /setrates to update buy/sell rates\n` +
      `Use /setpairs to list assets and gift cards you trade\n` +
      `Use /setlimits for min/max trade size`,
    );
  });

  // /setpairs — set trading pairs for crypto P2P profile
  bot.command("setpairs", async (ctx) => {
    const { Settings } = require("../db/database");
    const biz = getBusiness(ctx);
    if (Settings.get(biz.id, "industry") !== "Crypto & Gift Cards")
      return safeReply(ctx, "⚠️ /setpairs is for Crypto & Gift Cards businesses only.");
    const { Markup } = require("telegraf");
    await safeReply(ctx, `💱 *What do you trade?*\n\nSelect all that apply — crypto assets and gift card brands:`,
      { parse_mode: "Markdown", ...Markup.inlineKeyboard([
        [Markup.button.callback("USDT (TRC20)", "pair:USDT/TRC20"), Markup.button.callback("USDT (ERC20)", "pair:USDT/ERC20")],
        [Markup.button.callback("Bitcoin (BTC)", "pair:BTC"), Markup.button.callback("Ethereum (ETH)", "pair:ETH")],
        [Markup.button.callback("Solana (SOL)", "pair:SOL"), Markup.button.callback("BNB", "pair:BNB")],
        [Markup.button.callback("Amazon Gift Cards", "pair:Amazon GC"), Markup.button.callback("iTunes Gift Cards", "pair:iTunes GC")],
        [Markup.button.callback("Steam/Google Play GC", "pair:Steam+Google GC"), Markup.button.callback("Visa/Mastercard GC", "pair:Visa+MC GC")],
        [Markup.button.callback("✅ Save selection", "pair:save")],
      ]) }
    );
  });

  // /setcompletion — log your platform completion rate
  bot.command("setcompletion", async (ctx) => {
    const { Settings } = require("../db/database");
    const biz = getBusiness(ctx);
    if (Settings.get(biz.id, "industry") !== "Crypto & Gift Cards")
      return safeReply(ctx, "⚠️ /setcompletion is for Crypto & Gift Cards businesses only.");
    ctx.session.setCR = true;
    await safeReply(ctx,
      `⚡ *Average Payout Speed*\n\nHow many minutes does it typically take you to pay customers after receiving their crypto or gift card?\n\n_(e.g. type 15 for 15 minutes — Jeroid's standard is under 15 minutes)_`,
      cancelMenu()
    );
  });

  // pair: action handler for /setpairs
  bot.action(/^pair:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const pair = ctx.match[1];
    const { Vendors } = require("../db/database");
    if (pair === "save") {
      const stored = ctx.session.pairs?.join(", ") || "USDT/TRC20";
      const v = Vendors.getByTgId(ctx.from.id);
      if (v) Vendors.updateField(ctx.from.id, "pairs_traded", stored);
      ctx.session.pairs = undefined;
      return safeReply(ctx, `✅ Pairs saved: *${stored}*\n\nUpdate rates with /setrates`, { parse_mode: "Markdown" });
    }
    if (!ctx.session.pairs) ctx.session.pairs = [];
    const idx = ctx.session.pairs.indexOf(pair);
    if (idx > -1) ctx.session.pairs.splice(idx, 1); else ctx.session.pairs.push(pair);
    const has = ctx.session.pairs.includes(pair);
    await ctx.answerCbQuery(`${has ? "✅ Added" : "Removed"}: ${pair}`);
  });

  // /setphone — add phone to vendor profile
  bot.command("setphone", async (ctx) => {
    const phone = ctx.args[0]?.trim();
    if (!phone) return safeReply(ctx, "Usage: /setphone 08012345678");
    const { Vendors } = require("../db/database");
    const vendor = Vendors.getByTgId(ctx.from.id);
    if (vendor) { Vendors.update(vendor.id, { phone }); }
    await safeReply(ctx, `✅ Phone updated to: *${phone}*\n\nBuyers can now call or WhatsApp you from the marketplace.`, mainMenu());
  });

  // /setlocation — add location to vendor profile
  bot.command("setlocation", async (ctx) => {
    const location = ctx.args.join(" ").trim();
    if (!location) return safeReply(ctx, "Usage: /setlocation Lagos Island, Lagos");
    const { Vendors } = require("../db/database");
    const vendor = Vendors.getByTgId(ctx.from.id);
    if (vendor) { Vendors.update(vendor.id, { location }); }
    await safeReply(ctx, `✅ Location updated to: *${location}*\n\nThis helps buyers find you by proximity.`, mainMenu());
  });

  // /setup — onboarding checklist for new users
  bot.command("setup", async (ctx) => {
    const biz = getBusiness(ctx);
    const { Settings, Products, Vendors } = require("../db/database");
    const industry    = Settings.get(biz.id, "industry");
    const hasProducts = Products.list(biz.id).length > 0;
    const vendor      = Vendors.getByTgId(ctx.from.id);
    const hasPhone    = !!vendor?.phone;
    const hasName     = biz.name !== "My Business" && !biz.name.endsWith("'s Business");
    const hasLocation = !!vendor?.location;

    const done  = (s) => `✅ ${s}`;
    const todo  = (s, cmd) => `⬜ ${s} → ${cmd}`;

    const steps = [
      hasName     ? done("Business name set")           : todo("Set your business name",   "/setname Chima Stores"),
      industry    ? done(`Industry: ${industry}`)        : todo("Set your industry",        "/setindustry"),
      hasProducts ? done("Products added")               : todo("Add your first product",   "/product"),
      hasPhone    ? done("Phone on marketplace")         : todo("Add your phone number",    "/setphone 08012345678"),
      hasLocation ? done("Location on marketplace")      : todo("Add your location",        "/setlocation Lagos"),
    ];

    const complete = steps.filter(s => s.startsWith("✅")).length;
    const pct      = Math.round((complete / steps.length) * 100);

    await safeReply(ctx,
      `🚀 *Setup Checklist (${pct}% complete)*\n\n` +
      steps.join("\n") + "\n\n" +
      (complete === steps.length
        ? "🎉 *All done!* Your ShopBoss is fully set up. Use /workflow for industry tips."
        : `Complete the steps above to get the most out of ShopBoss.`),
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
