// ─────────────────────────────────────────────
//  miniapp.js — Mini App routes
//  FIX: HTML page served without auth (Telegram injects the user)
//  FIX: API routes use tg-id from header OR query param
// ─────────────────────────────────────────────
const express = require("express");
const path    = require("path");
const { Business, Products, Sales, Expenses, Analytics } = require("../db/database");

const router = express.Router();

// ── Serve HTML first — NO auth needed here ───────────────────
// Telegram opens this URL; the JS inside then sends the user's ID
router.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../../miniapp/index.html"));
});

// ── API auth middleware — applies only to /mini/data, /mini/sale etc ──
function apiAuth(req, res, next) {
  // Accept tg-id from header (sent by JS) or query string (fallback)
  const tgId = req.headers["x-tg-id"] || req.query.tgid;
  if (!tgId || tgId === "0" || tgId === "undefined") {
    return res.status(401).json({ error: "Unauthorized — open this inside Telegram" });
  }
  try {
    req.business = Business.getOrCreate(tgId, "My Business");
    next();
  } catch (err) {
    console.error("Mini auth error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
}

// ── GET /mini/data ───────────────────────────────────────────
router.get("/data", apiAuth, (req, res) => {
  try {
    const bId = req.business.id;
    const aiData        = Analytics.forAI(bId);
    const recentExpenses = Expenses.list(bId, 8);
    const inventoryList  = Products.list(bId);
    res.json({ businessName: req.business.name, ...aiData, recentExpenses, inventoryList });
  } catch (err) {
    console.error("Mini /data error:", err.message);
    res.status(500).json({ error: "Failed to load data" });
  }
});

// ── POST /mini/sale ──────────────────────────────────────────
router.post("/sale", apiAuth, (req, res) => {
  try {
    const { product_name, quantity, sell_price, customer } = req.body;
    if (!product_name || !quantity || !sell_price)
      return res.status(400).json({ error: "Missing required fields" });

    const bId     = req.business.id;
    const product = Products.findByName(bId, product_name);
    const cost_price = product?.cost_price || 0;
    const product_id = product?.id || null;

    if (product && product.stock < quantity)
      return res.status(400).json({ error: `Only ${product.stock} in stock` });

    const result = Sales.record(bId, {
      product_id, product_name,
      quantity: parseFloat(quantity),
      sell_price: parseFloat(sell_price),
      cost_price, customer: customer || null,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("Mini /sale error:", err.message);
    res.status(500).json({ error: "Failed to record sale" });
  }
});

// ── POST /mini/product ───────────────────────────────────────
router.post("/product", apiAuth, (req, res) => {
  try {
    const { name, sell_price, cost_price, stock, unit } = req.body;
    if (!name || !sell_price)
      return res.status(400).json({ error: "Name and sell price required" });

    const bId = req.business.id;
    const existing = Products.findByName(bId, name);
    if (existing && existing.name.toLowerCase() === name.toLowerCase())
      return res.status(400).json({ error: `"${name}" already exists` });

    Products.add(bId, {
      name, sell_price: parseFloat(sell_price),
      cost_price: parseFloat(cost_price || 0),
      stock: parseFloat(stock || 0),
      unit: unit || "unit", min_stock: 5,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("Mini /product error:", err.message);
    res.status(500).json({ error: "Failed to add product" });
  }
});

// ── POST /mini/expense ───────────────────────────────────────
router.post("/expense", apiAuth, (req, res) => {
  try {
    const { description, amount, category } = req.body;
    if (!description || !amount)
      return res.status(400).json({ error: "Description and amount required" });
    Expenses.add(req.business.id, {
      description, amount: parseFloat(amount), category: category || "General",
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("Mini /expense error:", err.message);
    res.status(500).json({ error: "Failed to record expense" });
  }
});

// ── POST /mini/ask ───────────────────────────────────────────
router.post("/ask", apiAuth, async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: "Question required" });
    if (!process.env.ANTHROPIC_API_KEY)
      return res.json({ answer: "🤖 AI features are not configured yet. Ask your admin to add the API key." });
    const { askAI } = require("../services/ai");
    const { Settings } = require("../db/database");
    const industry = Settings.get(req.business.id, "industry") || "Retail";
    const answer = await askAI(req.business.id, question, industry);
    res.json({ answer });
  } catch (err) {
    console.error("Mini /ask error:", err.message);
    res.status(500).json({ error: "AI unavailable right now" });
  }
});

module.exports = router;

// ── GET /mini/marketplace ─────────────────────────────────────
router.get("/marketplace", apiAuth, (req, res) => {
  try {
    const { Vendors } = require("../db/database");
    const industry = req.query.industry || "All";
    const vendors  = Vendors.list(industry, 50);
    res.json({ vendors });
  } catch(err) {
    console.error("Mini /marketplace error:", err.message);
    res.status(500).json({ error: "Failed to load marketplace" });
  }
});

// ── GET /mini/vendor/:id ──────────────────────────────────────
router.get("/vendor/:id", apiAuth, (req, res) => {
  try {
    const { Vendors } = require("../db/database");
    const vendor  = Vendors.get(parseInt(req.params.id));
    if (!vendor) return res.status(404).json({ error: "Vendor not found" });
    const reviews = Vendors.reviews(vendor.id);
    const hasReviewed = Vendors.hasReviewed(vendor.id, req.headers["x-tg-id"]);
    res.json({ vendor, reviews, hasReviewed });
  } catch(err) {
    console.error("Mini /vendor error:", err.message);
    res.status(500).json({ error: "Failed to load vendor" });
  }
});

// ── POST /mini/vendor/:id/review ─────────────────────────────
router.post("/vendor/:id/review", apiAuth, (req, res) => {
  try {
    const { Vendors } = require("../db/database");
    const vendorId     = parseInt(req.params.id);
    const { rating, comment } = req.body;
    const reviewerTgId = req.headers["x-tg-id"];

    if (!rating || rating < 1 || rating > 5)
      return res.status(400).json({ error: "Rating must be 1-5" });
    if (!comment || comment.trim().length < 5)
      return res.status(400).json({ error: "Write at least a sentence" });

    const vendor = Vendors.get(vendorId);
    if (!vendor) return res.status(404).json({ error: "Vendor not found" });

    if (vendor.telegram_id && String(vendor.telegram_id) === String(reviewerTgId))
      return res.status(400).json({ error: "You cannot review your own business" });

    const alreadyReviewed = Vendors.hasReviewed(vendorId, reviewerTgId);
    const reviewerName = req.business?.name || "ShopBoss User";

    Vendors.addReview(vendorId, reviewerTgId, reviewerName, parseInt(rating), comment.trim());

    const updated = Vendors.get(vendorId);
    res.json({
      ok: true,
      updated: alreadyReviewed,
      new_rating: updated.rating,
      review_count: updated.review_count,
    });
  } catch(err) {
    console.error("Mini /review error:", err.message);
    res.status(500).json({ error: "Failed to submit review" });
  }
});
