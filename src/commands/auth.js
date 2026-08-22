// ─────────────────────────────────────────────
//  auth.js — OTP verification + marketplace sale confirmations
// ─────────────────────────────────────────────
const { OTP, UserProfiles, MarketplaceSales, Business } = require("../db/database");
const { fmt, getBusiness, safeReply } = require("../utils/helpers");
const { mainMenu } = require("../utils/keyboards");
const { Markup } = require("telegraf");

function registerAuth(bot) {

  // ── /verify — send OTP to phone via Telegram message ──────────
  bot.command("verify", async (ctx) => {
    const biz = getBusiness(ctx);
    const profile = UserProfiles.get(ctx.from.id);

    if (profile?.verified) {
      return safeReply(ctx, "✅ Your account is already verified!", mainMenu());
    }

    const phone = ctx.args[0] || profile?.phone;
    if (!phone) {
      return safeReply(ctx,
        "📱 *Verify Your Account*\n\nSend your phone number to receive an OTP:\n\nUsage: `/verify 08012345678`",
        { parse_mode: "Markdown" }
      );
    }

    const code = OTP.generate(ctx.from.id, phone, null, "verify");

    // In production: send via SMS (Termii, Twilio, etc.)
    // For now: send the OTP directly in Telegram (dev mode)
    await safeReply(ctx,
      `📱 *OTP Sent*\n\nYour verification code:\n\n` +
      `\`${code}\`\n\n` +
      `Valid for 10 minutes. Reply with:\n/otp ${code}`,
      { parse_mode: "Markdown" }
    );
  });

  // ── /otp — submit OTP code ─────────────────────────────────────
  bot.command("otp", async (ctx) => {
    const code = ctx.args[0];
    if (!code) return safeReply(ctx, "Usage: /otp 123456");

    const valid = OTP.verify(ctx.from.id, code, "verify");
    if (!valid) {
      return safeReply(ctx,
        "❌ *Invalid or expired OTP.*\n\nRequest a new one with /verify",
        { parse_mode: "Markdown" }
      );
    }

    UserProfiles.verify(ctx.from.id);
    await safeReply(ctx,
      "✅ *Account Verified!*\n\nYour ShopBoss account is now fully verified. " +
      "Your marketplace profile is live and trusted buyers can see your listings.",
      mainMenu()
    );
  });

  // ── /confirm — confirm a marketplace sale ──────────────────────
  // Used by SELLER: /confirm <sale_id> sent
  // Used by BUYER:  /confirm <sale_id> received
  bot.command("confirm", async (ctx) => {
    const [saleId, action] = ctx.args;
    if (!saleId || !action) {
      return safeReply(ctx,
        "📋 *Confirm a Marketplace Sale*\n\n" +
        "If you're the *seller*: `/confirm <sale_id> sent`\n" +
        "If you're the *buyer*:  `/confirm <sale_id> received`\n\n" +
        "Find your sale ID from /mysales",
        { parse_mode: "Markdown" }
      );
    }

    const id = parseInt(saleId);
    const sale = MarketplaceSales.get(id);
    if (!sale) return safeReply(ctx, "❌ Sale not found. Check the ID and try again.");

    const tgId = String(ctx.from.id);

    if (action.toLowerCase() === "sent") {
      if (sale.seller_tg_id !== tgId) return safeReply(ctx, "❌ You are not the seller for this sale.");
      if (sale.seller_confirmed) return safeReply(ctx, "✅ You already confirmed this sale as sent.");

      const ok = MarketplaceSales.confirmSeller(id, tgId);
      if (!ok) return safeReply(ctx, "❌ Could not confirm. Please try again.");

      await safeReply(ctx,
        `📦 *Confirmed: Item Sent!*\n\n` +
        `Sale #${id} marked as dispatched.\n\n` +
        `Waiting for buyer to confirm receipt.\n` +
        `When both confirm, the sale is complete.`,
        mainMenu()
      );

      // Notify buyer if we have their ID
      if (sale.buyer_tg_id) {
        try {
          await bot.telegram.sendMessage(
            sale.buyer_tg_id,
            `📦 *Your Order Has Been Sent!*\n\n` +
            `Sale #${id} — the seller has confirmed dispatch.\n\n` +
            `Once you receive it, confirm with:\n/confirm ${id} received`,
            { parse_mode: "Markdown" }
          );
        } catch (_) {}
      }

    } else if (action.toLowerCase() === "received") {
      if (sale.buyer_tg_id && sale.buyer_tg_id !== tgId) {
        return safeReply(ctx, "❌ You are not the registered buyer for this sale.");
      }
      if (sale.buyer_confirmed) return safeReply(ctx, "✅ You already confirmed receipt.");

      // Allow buyer confirmation even if buyer_tg_id wasn't set (walk-in buyer)
      const ok = MarketplaceSales.confirmBuyer(id, tgId);
      if (!ok) return safeReply(ctx, "❌ Could not confirm. Try /confirm " + id + " received again.");

      const updated = MarketplaceSales.get(id);
      await safeReply(ctx,
        `✅ *Receipt Confirmed!*\n\n` +
        `Sale #${id} marked as received.\n\n` +
        `${updated.status === "completed" ? "🎉 *Sale is now COMPLETE* — both parties have confirmed." : "Waiting for seller confirmation."}`,
        mainMenu()
      );

      // Notify seller
      if (sale.seller_tg_id) {
        try {
          await bot.telegram.sendMessage(
            sale.seller_tg_id,
            `🎉 *Buyer Confirmed Receipt!*\n\n` +
            `Sale #${id} — the buyer has confirmed they received the item.\n\n` +
            `${updated.status === "completed" ? "✅ Sale is fully COMPLETE." : ""}`,
            { parse_mode: "Markdown" }
          );
        } catch (_) {}
      }

    } else {
      return safeReply(ctx, "❌ Action must be either `sent` or `received`.\n\nExample: /confirm 12 sent", mainMenu());
    }
  });

  // ── /mysales — view marketplace sales ────────────────────────
  bot.command("mysales", async (ctx) => {
    await ctx.sendChatAction("typing");
    const tgId = String(ctx.from.id);
    const asSeller = MarketplaceSales.listBySeller(tgId);
    const asBuyer  = MarketplaceSales.listByBuyer(tgId);

    const { fmt } = require("../utils/helpers");

    const STATUS = { pending:"⏳", seller_sent:"📦 Sent", buyer_received:"📬 Received", completed:"✅ Complete", disputed:"⚠️ Disputed" };

    if (!asSeller.length && !asBuyer.length) {
      return safeReply(ctx, "📋 No marketplace sales yet.\n\nUse /sale to record a sale or browse the marketplace.", mainMenu());
    }

    let msg = "📋 *My Marketplace Sales*\n\n";

    if (asSeller.length) {
      msg += "*As Seller:*\n";
      asSeller.slice(0, 5).forEach(s => {
        msg += `#${s.id} — ${STATUS[s.status]||s.status}\n`;
        msg += `Amount: ${fmt(s.amount)} | Buyer: ${s.buyer_name || "Unknown"}\n\n`;
      });
    }

    if (asBuyer.length) {
      msg += "*As Buyer:*\n";
      asBuyer.slice(0, 5).forEach(s => {
        msg += `#${s.id} — ${STATUS[s.status]||s.status}\n`;
        msg += `Amount: ${fmt(s.amount)}\n\n`;
      });
    }

    msg += "\nConfirm a sale: `/confirm <id> sent` or `/confirm <id> received`";

    await safeReply(ctx, msg, mainMenu());
  });

  // ── /recordsale — create a marketplace sale record ────────────
  bot.command("recordsale", async (ctx) => {
    const tgId = String(ctx.from.id);
    ctx.session.mpSale = { step: "amount", seller_tg_id: tgId, source: "marketplace" };
    await safeReply(ctx,
      "📦 *Record a Marketplace Sale*\n\nStep 1/3 — Enter the *sale amount* (₦):",
      { reply_markup: { remove_keyboard: true } }
    );
  });

  bot.on("text", async (ctx, next) => {
    const ms = ctx.session?.mpSale;
    if (!ms) return next();

    const text = ctx.message.text.trim();
    if (text === "❌ Cancel") {
      ctx.session.mpSale = null;
      return safeReply(ctx, "❌ Cancelled.", mainMenu());
    }

    const { parseNumber } = require("../utils/helpers");

    if (ms.step === "amount") {
      const amt = parseNumber(text);
      if (!amt || amt <= 0) return safeReply(ctx, "⚠️ Enter a valid amount:", { reply_markup: { remove_keyboard: true } });
      ms.amount = amt;
      ms.step = "desc";
      return safeReply(ctx, "Step 2/3 — Describe what was sold:");
    }

    if (ms.step === "desc") {
      ms.description = text;
      ms.step = "buyer";
      return safeReply(ctx, "Step 3/3 — Buyer's name or phone (or type 'skip'):");
    }

    if (ms.step === "buyer") {
      if (text.toLowerCase() !== "skip") ms.buyer_name = text;
      try {
        const r = MarketplaceSales.create({
          seller_tg_id: ms.seller_tg_id,
          amount: ms.amount,
          description: ms.description,
          buyer_name: ms.buyer_name || null,
          source: ms.source,
        });
        ctx.session.mpSale = null;
        return safeReply(ctx,
          `✅ *Marketplace Sale Recorded!*\n\n` +
          `Sale ID: #${r.lastInsertRowid}\n` +
          `Amount: ${fmt(ms.amount)}\n` +
          `Description: ${ms.description}\n\n` +
          `Once delivered, confirm with:\n/confirm ${r.lastInsertRowid} sent`,
          mainMenu()
        );
      } catch (e) {
        ctx.session.mpSale = null;
        return safeReply(ctx, "⚠️ Failed to record sale. Please try again.", mainMenu());
      }
    }

    return next();
  });
}

module.exports = { registerAuth };
