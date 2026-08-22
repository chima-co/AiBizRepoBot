// ─────────────────────────────────────────────
//  paywall.js — Middleware that gates all commands
//  Free commands: /start /help /pay /status /support /privacy /terms
//  Everything else requires active license or valid trial
// ─────────────────────────────────────────────
const { Markup } = require("telegraf");
const { checkAccess, createPaymentLink, PRICE, TRIAL_DAYS, PLANS } = require("../services/payment");

// Commands that are ALWAYS free — never blocked
const FREE_COMMANDS = new Set([
  "start", "help", "pay", "status",
  "support", "privacy", "terms",
]);

// The upgrade message shown when access is blocked
async function sendPaywall(ctx, access) {
  const isExpired = access.status === "expired";
  const header = isExpired
    ? `⏰ *Your ${TRIAL_DAYS}-day free trial has ended.*`
    : `🔒 *Access Required*`;

  const sub = isExpired
    ? `Your trial is over. Choose a plan below to continue managing your business.`
    : `This feature requires a ShopBoss plan.`;

  await ctx.reply(
    `${header}\n\n${sub}\n\n` +
    `*Choose Your Plan:*\n\n` +
    `📅 *Monthly* — ₦9,500/month\n` +
    `📆 *Yearly* — ₦90,000/year _(save ₦24,000)_\n` +
    `♾️ *Lifetime* — ₦299,999 once, forever\n\n` +
    `All plans include full access to every feature.`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("📅 Monthly — ₦9,500", "pay:monthly")],
        [Markup.button.callback("📆 Yearly — ₦90,000", "pay:yearly")],
        [Markup.button.callback("♾️ Lifetime — ₦299,999", "pay:lifetime")],
        [Markup.button.callback("❓ Compare plans", "pay_why")],
      ]),
    }
  );
}

// Trial banner shown to trial users (daily reminder on first command of the day)
async function sendTrialBanner(ctx, daysLeft) {
  const urgency = daysLeft <= 2 ? "⚠️" : "ℹ️";
  await ctx.reply(
    `${urgency} *Trial: ${daysLeft} day${daysLeft === 1 ? "" : "s"} remaining*\n\n` +
    `Unlock lifetime access for ₦299,999 — one-time, never expires.\n\nUse /pay to upgrade anytime.`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("💳 Unlock Now", "pay_now")],
      ]),
    }
  );
}

/**
 * Registers the paywall as a bot middleware.
 * Must be registered BEFORE all command modules.
 */
function registerPaywall(bot) {

  // ── Global middleware — runs on every update ──────────────
  bot.use(async (ctx, next) => {
    if (!ctx.from) return next();

    // Extract the command being used (if any)
    const text = ctx.message?.text || "";
    const command = text.startsWith("/")
      ? text.slice(1).split(" ")[0].split("@")[0].toLowerCase()
      : null;

    // Always allow free commands through
    if (command && FREE_COMMANDS.has(command)) return next();

    // Check license status
    const access = checkAccess(ctx.from.id);

    if (!access.allowed) {
      return sendPaywall(ctx, access);
    }

    // Show trial banner once per session (on first non-free command)
    if (access.status === "trial") {
      if (!ctx.session._trialBannerShown) {
        ctx.session._trialBannerShown = true;
        if (access.daysLeft <= 3) {
          // Only show urgency banner in last 3 days
          await sendTrialBanner(ctx, access.daysLeft);
        }
      }
    }

    return next();
  });

  // ── /pay command ──────────────────────────────────────────
  bot.command("pay", async (ctx) => {
    const access = checkAccess(ctx.from.id);

    if (access.status === "active") {
      return ctx.reply(
        "✅ *You already have lifetime access!*\n\nShopBoss is fully unlocked for you. Enjoy! 🎉",
        { parse_mode: "Markdown" }
      );
    }

    // Start payment collection flow
    ctx.session.paying = { step: "name" };
    await ctx.reply(
      `💳 *Unlock ShopBoss — Lifetime Access*\n\n` +
      `*Price: ₦299,999* (one-time, never pay again)\n\n` +
      `I'll generate a secure payment link for you in seconds.\n\n` +
      `First — what is your *full name*?`,
      {
        parse_mode: "Markdown",
        reply_markup: { remove_keyboard: true },
      }
    );
  });

  // ── /status — check license status ───────────────────────
  bot.command("status", async (ctx) => {
    const access = checkAccess(ctx.from.id);

    if (access.status === "active") {
      return ctx.reply(
        `✅ *ShopBoss License: ACTIVE*\n\n` +
        `🔑 Access: Lifetime — never expires\n` +
        `📱 All features unlocked\n\n` +
        `Thank you for supporting ShopBoss! 🙏`,
        { parse_mode: "Markdown" }
      );
    }

    if (access.status === "trial") {
      return ctx.reply(
        `⏳ *ShopBoss License: FREE TRIAL*\n\n` +
        `Days remaining: *${access.daysLeft} day${access.daysLeft === 1 ? "" : "s"}*\n\n` +
        `Unlock lifetime access for ₦299,999 — one-time payment.\nUse /pay to upgrade.`,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([[Markup.button.callback("💳 Pay Now", "pay_now")]]),
        }
      );
    }

    return ctx.reply(
      `❌ *ShopBoss License: EXPIRED*\n\nYour trial has ended. Use /pay to unlock full access.`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([[Markup.button.callback("💳 Unlock Now", "pay_now")]]),
      }
    );
  });

  // ── Inline button: Pay Now ────────────────────────────────
  bot.action(/^pay:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const selectedPlan = ctx.match[1]; // monthly | yearly | lifetime
    const access = checkAccess(ctx.from.id);
    if (access.status === "active" && access.plan === "lifetime") {
      return ctx.reply("✅ You already have lifetime access!");
    }
    const planInfo = PLANS[selectedPlan];
    if (!planInfo) return ctx.reply("❌ Invalid plan.");
    ctx.session.paying = { step: "name", plan: selectedPlan, planLabel: planInfo.label, planPrice: planInfo.price };
    await ctx.reply(
      `💳 *${planInfo.label} — ₦${Number(planInfo.price).toLocaleString("en-NG")}*\n\n` +
      `${planInfo.description}\n\nWhat is your *full name*?`,
      { parse_mode: "Markdown", reply_markup: { remove_keyboard: true } }
    );
  });

  bot.action("pay_now", async (ctx) => {
    await ctx.answerCbQuery();
    const access = checkAccess(ctx.from.id);
    if (access.status === "active") {
      return ctx.reply("✅ You already have lifetime access!");
    }
    ctx.session.paying = { step: "name" };
    await ctx.reply(
      `💳 *Unlock ShopBoss — ₦299,999*\n\nLet me generate your secure payment link.\n\nWhat is your *full name*?`,
      { parse_mode: "Markdown", reply_markup: { remove_keyboard: true } }
    );
  });

  // ── Inline button: Why pay? ───────────────────────────────
  bot.action("pay_why", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      `💡 *Why Pay for ShopBoss?*\n\n` +
      `Most business owners lose money because they can't track:\n\n` +
      `❌ Which products are actually profitable\n` +
      `❌ How much they're really spending\n` +
      `❌ When stock is running low\n` +
      `❌ What their real monthly profit is\n\n` +
      `ShopBoss solves all of this — in Telegram, no app needed.\n\n` +
      `*At ₦299,999 one-time:*\n` +
      `• That's less than ₦350/day over a year\n` +
      `• Less than one generator fuel expense\n` +
      `• Most users recover the cost in the first month by catching losses they didn't know about\n\n` +
      `*No monthly fees. No subscriptions. Pay once, use forever.*`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([[Markup.button.callback("💳 Pay ₦299,999 Now", "pay_now")]]),
      }
    );
  });

  // ── Text handler: collect payment details ─────────────────
  bot.on("text", async (ctx, next) => {
    const paying = ctx.session.paying;
    if (!paying) return next();

    const text = ctx.message.text.trim();

    // Allow cancel at any step
    if (text.toLowerCase() === "cancel" || text === "❌ Cancel") {
      ctx.session.paying = null;
      return ctx.reply("❌ Payment cancelled. Use /pay whenever you're ready.", {
        parse_mode: "Markdown",
      });
    }

    // Step 1: Full name
    if (paying.step === "name") {
      if (text.length < 3) return ctx.reply("⚠️ Please enter your full name (at least 3 characters):");
      paying.name = text;
      paying.step = "email";
      return ctx.reply(
        `✅ Name: *${text}*\n\nNow enter your *email address* (for your payment receipt):`,
        { parse_mode: "Markdown" }
      );
    }

    // Step 2: Email
    if (paying.step === "email") {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(text)) return ctx.reply("⚠️ That doesn't look like a valid email. Try again:");
      paying.email = text;
      paying.step = "phone";
      return ctx.reply(
        `✅ Email: *${text}*\n\nNow enter your *phone number* (e.g. 08012345678):`,
        { parse_mode: "Markdown" }
      );
    }

    // Step 3: Phone — generate link
    if (paying.step === "phone") {
      const phoneRegex = /^(\+?234|0)[789][01]\d{8}$/;
      const cleaned = text.replace(/\s+/g, "");
      if (!phoneRegex.test(cleaned)) {
        return ctx.reply("⚠️ Enter a valid Nigerian phone number (e.g. 08012345678):");
      }
      paying.phone = cleaned;

      await ctx.reply("⏳ Generating your secure payment link...");

      try {
        const { link, txRef } = await createPaymentLink(
          ctx.from.id,
          paying.name,
          paying.email,
          paying.phone
        );

        ctx.session.paying = null;

        await ctx.reply(
          `✅ *Payment Link Ready!*\n\n` +
          `👤 Name: ${paying.name}\n` +
          `📧 Email: ${paying.email}\n` +
          `📱 Phone: ${paying.phone}\n` +
          `💰 Amount: *₦299,999*\n` +
          `📋 Reference: \`${txRef}\`\n\n` +
          `🔒 *Tap the button below to pay securely:*\n` +
          `_(Accepts: Card, Bank Transfer, USSD)_\n\n` +
          `After payment, ShopBoss will activate automatically within seconds.`,
          {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
              [Markup.button.url("💳 Pay ₦299,999 Securely", link)],
              [Markup.button.callback("✅ I've paid — check my status", "check_payment")],
            ]),
          }
        );
      } catch (err) {
        console.error("Payment link error:", err.message);
        ctx.session.paying = null;
        await ctx.reply(
          "⚠️ Could not generate payment link right now. Please try again with /pay or contact /support."
        );
      }
      return;
    }

    return next();
  });

  // ── Manual payment check button ───────────────────────────
  bot.action("check_payment", async (ctx) => {
    await ctx.answerCbQuery("Checking...");
    const access = checkAccess(ctx.from.id);
    if (access.status === "active") {
      await ctx.reply(
        "🎉 *Payment confirmed! You have lifetime access.*\n\nUse /start to begin.",
        { parse_mode: "Markdown" }
      );
    } else {
      await ctx.reply(
        "⏳ Payment not confirmed yet.\n\nIf you've paid, it usually activates within 30 seconds. Wait a moment then tap the button again, or contact /support with your payment reference.",
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([[Markup.button.callback("🔄 Check Again", "check_payment")]]),
        }
      );
    }
  });
}

module.exports = { registerPaywall, sendPaywall, checkAccess };
