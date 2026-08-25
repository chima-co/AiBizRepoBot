// ─────────────────────────────────────────────────────────────────────────────
//  miniapp.js — Mini App routes
// ─────────────────────────────────────────────────────────────────────────────
const express = require("express");
const path    = require("path");

const router = express.Router();

// ── Serve Mini App HTML ───────────────────────────────────────────────────────
router.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../../miniapp/index.html"));
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function db() { return require("../db/database"); }

// ── Auth middleware — for authenticated routes only ────────────────────────────
function apiAuth(req, res, next) {
  const tgId = req.headers["x-tg-id"] || req.query.tgid;
  if (!tgId || tgId === "0" || tgId === "undefined") {
    return res.status(401).json({ error: "Unauthorized — open inside Telegram" });
  }
  try {
    const { Business } = db();
    req.tgId    = tgId;
    req.business = Business.getOrCreate(tgId, "My Business");
    next();
  } catch (e) {
    console.error("Mini auth:", e.message);
    res.status(500).json({ error: "Server error" });
  }
}

// ── KYC / Signup Routes (no auth required — user doesn't have TG ID yet) ──────

// POST /mini/kyc/start — submit full KYC form
router.post("/kyc/start", async (req, res) => {
  try {
    const { name, email, phone, business_name, address, city, state, industry } = req.body;
    if (!name || !email || !phone || !business_name || !address || !city || !state)
      return res.status(400).json({ error: "All KYC fields are required" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: "Invalid email address" });
    if (phone.replace(/\D/g, "").length < 10)
      return res.status(400).json({ error: "Invalid phone number" });

    const { UserProfiles, OTP, Signups } = db();

    // Check if already registered
    const existing = UserProfiles.getByEmail(email);
    if (existing?.kyc_complete)
      return res.status(400).json({ error: "This email is already registered. Open Telegram and use /start." });

    // Save profile (upsert — allow resuming if they started before)
    UserProfiles.upsert({ name, email, phone, business_name, address, city, state, industry: industry || "Retail", plan: "trial" });

    // Also save to signups table for admin view
    try { Signups.add({ name, business_name, email, phone, industry: industry || "Retail", plan: "trial" }); } catch (_) {}

    // Generate and send email OTP
    const code = OTP.generateForEmail(email, "email_verify");

    // Send email via bot if configured, or log for now
    await sendOtpEmail(email, name, code);

    res.json({ ok: true, next: "email_otp", message: `OTP sent to ${email}` });
  } catch (e) {
    console.error("KYC start error:", e.message);
    if (e.message?.includes("UNIQUE")) return res.status(400).json({ error: "Email already registered" });
    res.status(500).json({ error: "Registration failed. Try again." });
  }
});

// POST /mini/kyc/verify-email — submit email OTP
router.post("/kyc/verify-email", (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: "Email and code required" });

    const { OTP, UserProfiles } = db();
    const valid = OTP.verifyByEmail(email, code, "email_verify");
    if (!valid) return res.status(400).json({ error: "Invalid or expired code. Request a new one." });

    UserProfiles.verifyEmail(email);
    res.json({ ok: true, next: "complete", message: "Email verified!" });
  } catch (e) {
    console.error("Email verify error:", e.message);
    res.status(500).json({ error: "Verification failed" });
  }
});

// POST /mini/kyc/resend-otp — resend email OTP
router.post("/kyc/resend-otp", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });
    const { UserProfiles, OTP } = db();
    const profile = UserProfiles.getByEmail(email);
    if (!profile) return res.status(400).json({ error: "No registration found for this email" });
    const code = OTP.generateForEmail(email, "email_verify");
    await sendOtpEmail(email, profile.name, code);
    res.json({ ok: true, message: `New OTP sent to ${email}` });
  } catch (e) {
    res.status(500).json({ error: "Could not resend OTP" });
  }
});

// POST /mini/kyc/complete — final step: link Telegram after redirect
router.post("/kyc/complete", apiAuth, (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });

    const { UserProfiles, Vendors, Settings, Business } = db();
    const profile = UserProfiles.getByEmail(email);
    if (!profile) return res.status(404).json({ error: "Profile not found" });
    if (!profile.email_verified) return res.status(400).json({ error: "Email not verified yet" });

    // Link Telegram ID to profile
    UserProfiles.linkTelegram(email, req.tgId);
    UserProfiles.completeKYC(email);

    // Set industry in settings
    if (profile.industry) {
      Settings.set(req.business.id, "industry", profile.industry);
    }

    // Update vendor profile
    Vendors.upsertFromBot({
      telegram_id: req.tgId,
      business_id: req.business.id,
      name: profile.business_name || profile.name,
      email: profile.email,
      phone: profile.phone,
      location: [profile.city, profile.state].filter(Boolean).join(", "),
      industry: profile.industry || "Retail",
    });

    // Update business name
    Business.update(req.business.id, profile.business_name || profile.name);

    res.json({ ok: true, profile, message: "KYC complete! Your account is active." });
  } catch (e) {
    console.error("KYC complete error:", e.message);
    res.status(500).json({ error: "Could not complete setup" });
  }
});

// GET /mini/kyc/status — check KYC state by email
router.get("/kyc/status", (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: "Email required" });
    const { UserProfiles } = db();
    const profile = UserProfiles.getByEmail(email);
    if (!profile) return res.json({ exists: false });
    res.json({
      exists: true,
      email_verified: !!profile.email_verified,
      kyc_complete: !!profile.kyc_complete,
      name: profile.name,
      business_name: profile.business_name,
    });
  } catch (e) {
    res.status(500).json({ error: "Status check failed" });
  }
});

// ── Onboarding routes (after KYC) ─────────────────────────────────────────────

// GET /mini/onboarding — fetch onboarding checklist state
router.get("/onboarding", apiAuth, (req, res) => {
  try {
    const { Products, Settings, Vendors, UserProfiles } = db();
    const biz      = req.business;
    const prods    = Products.list(biz.id);
    const industry = Settings.get(biz.id, "industry");
    const vendor   = Vendors.getByTgId(req.tgId);
    const profile  = UserProfiles.get(req.tgId);
    res.json({
      steps: {
        kyc_complete:      !!profile?.kyc_complete,
        industry_set:      !!industry,
        first_product:     prods.length > 0,
        profile_complete:  !!(vendor?.phone && vendor?.location),
      },
      business: { name: biz.name, industry: industry || null },
      vendor,
      profile,
    });
  } catch (e) {
    res.status(500).json({ error: "Onboarding check failed" });
  }
});

// ── Dashboard data ─────────────────────────────────────────────────────────────
router.get("/data", apiAuth, (req, res) => {
  try {
    const { Analytics, Expenses, Products, Sales } = db();
    const bId = req.business.id;
    const dashboard    = Analytics.dashboard(bId);
    const recentSales  = Sales.list(bId, 8);
    const recentExpenses = Expenses.list(bId, 8);
    const inventoryList  = Products.list(bId);
    const lowStockItems  = Products.lowStock(bId);
    const topProducts    = Sales.topProducts(bId, 5);
    const expenseBreakdown = Expenses.breakdown(bId);
    res.json({
      businessName: req.business.name,
      dashboard, recentSales, recentExpenses,
      inventoryList, lowStockItems, topProducts, expenseBreakdown,
    });
  } catch (e) {
    console.error("Mini /data:", e.message);
    res.status(500).json({ error: "Failed to load data" });
  }
});

// ── Sales ──────────────────────────────────────────────────────────────────────
router.post("/sale", apiAuth, (req, res) => {
  try {
    const { product_name, quantity, sell_price, customer } = req.body;
    if (!product_name || !quantity || !sell_price)
      return res.status(400).json({ error: "Product, quantity, and price required" });
    const { Products, Sales } = db();
    const bId    = req.business.id;
    const prod   = Products.findByName(bId, product_name) || Products.searchByName(bId, product_name)?.[0];
    if (prod && prod.stock < quantity)
      return res.status(400).json({ error: `Only ${prod.stock} ${prod.unit} in stock` });
    const result = Sales.record(bId, {
      product_id: prod?.id || null, product_name: prod?.name || product_name,
      quantity: parseFloat(quantity), sell_price: parseFloat(sell_price),
      cost_price: prod?.cost_price || 0, customer: customer || null,
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: "Failed to record sale" });
  }
});

// ── Products ───────────────────────────────────────────────────────────────────
router.post("/product", apiAuth, (req, res) => {
  try {
    const { name, sell_price, cost_price, stock, unit } = req.body;
    if (!name || !sell_price) return res.status(400).json({ error: "Name and sell price required" });
    const { Products } = db();
    const bId = req.business.id;
    if (Products.findByName(bId, name)) return res.status(400).json({ error: `"${name}" already exists` });
    Products.add(bId, { name, sell_price: parseFloat(sell_price), cost_price: parseFloat(cost_price || 0), stock: parseFloat(stock || 0), unit: unit || "unit", min_stock: 5 });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Failed to add product" });
  }
});

// ── Expenses ───────────────────────────────────────────────────────────────────
router.post("/expense", apiAuth, (req, res) => {
  try {
    const { description, amount, category } = req.body;
    if (!description || !amount) return res.status(400).json({ error: "Description and amount required" });
    const { Expenses } = db();
    Expenses.add(req.business.id, { description, amount: parseFloat(amount), category: category || "General" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Failed to record expense" });
  }
});

// ── AI Ask ─────────────────────────────────────────────────────────────────────
router.post("/ask", apiAuth, async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: "Question required" });
    if (!process.env.ANTHROPIC_API_KEY)
      return res.json({ answer: "🤖 AI is not configured yet. Ask your admin to add the API key." });
    const { askAI } = require("../services/ai");
    const { Settings } = db();
    const industry = Settings.get(req.business.id, "industry") || "Retail";
    const answer = await askAI(req.business.id, question, industry);
    res.json({ answer });
  } catch (e) {
    console.error("Mini /ask:", e.message);
    res.status(500).json({ error: "AI unavailable right now" });
  }
});

// ── Marketplace (paginated) ────────────────────────────────────────────────────
router.get("/marketplace", apiAuth, (req, res) => {
  try {
    const { Vendors } = db();
    const industry = req.query.industry || "All";
    const page     = Math.max(1, parseInt(req.query.page) || 1);
    const limit    = 12;
    const offset   = (page - 1) * limit;

    const all     = Vendors.list(industry, 10000);
    const total   = all.length;
    const vendors = all.slice(offset, offset + limit);
    const pages   = Math.ceil(total / limit) || 1;

    res.json({ vendors, total, page, pages, per_page: limit });
  } catch (e) {
    res.status(500).json({ error: "Failed to load marketplace" });
  }
});

// GET /mini/vendor/:id
router.get("/vendor/:id", apiAuth, (req, res) => {
  try {
    const { Vendors } = db();
    const vendor = Vendors.get(parseInt(req.params.id));
    if (!vendor) return res.status(404).json({ error: "Vendor not found" });
    const reviews     = Vendors.reviews(vendor.id);
    const hasReviewed = Vendors.hasReviewed(vendor.id, req.tgId);
    res.json({ vendor, reviews, hasReviewed });
  } catch (e) {
    res.status(500).json({ error: "Failed to load vendor" });
  }
});

// POST /mini/vendor/:id/review
router.post("/vendor/:id/review", apiAuth, (req, res) => {
  try {
    const { Vendors } = db();
    const vendorId = parseInt(req.params.id);
    const { rating, comment } = req.body;
    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: "Rating must be 1-5" });
    if (!comment || comment.trim().length < 5) return res.status(400).json({ error: "Write at least a sentence" });
    const vendor = Vendors.get(vendorId);
    if (!vendor) return res.status(404).json({ error: "Not found" });
    if (vendor.telegram_id && String(vendor.telegram_id) === String(req.tgId))
      return res.status(400).json({ error: "Cannot review your own business" });
    const already = Vendors.hasReviewed(vendorId, req.tgId);
    Vendors.addReview(vendorId, req.tgId, req.business?.name || "User", parseInt(rating), comment.trim());
    const updated = Vendors.get(vendorId);
    res.json({ ok: true, updated: already, new_rating: updated.rating, review_count: updated.review_count });
  } catch (e) {
    res.status(500).json({ error: "Failed to submit review" });
  }
});

// ── Email OTP sender (uses Telegram bot if no SMTP configured) ─────────────────
async function sendOtpEmail(email, name, code) {
  // Log to console always (visible in Railway logs)
  console.log(`📧 OTP for ${email}: ${code}`);

  // If we have a bot and admin ID, notify admin so they can relay manually
  // In production: integrate Mailgun, SendGrid, or Resend here
  try {
    const bot = global._shopboss_bot;
    const adminId = process.env.ADMIN_TELEGRAM_ID;
    if (bot && adminId) {
      await bot.telegram.sendMessage(adminId,
        `📧 *Email OTP Request*\n\nUser: ${name}\nEmail: \`${email}\`\nCode: \`${code}\`\n\nForward this code to the user or integrate email sending.`,
        { parse_mode: "Markdown" }
      ).catch(() => {});
    }
  } catch (_) {}
}

module.exports = router;
