// ─────────────────────────────────────────────
//  miniapp.js — Express routes for the Mini App
//  All endpoints are scoped to the user's business
// ─────────────────────────────────────────────
const express = require("express");
const path = require("path");
const { Business, Products, Sales, Expenses, Analytics } = require("../db/database");

const router = express.Router();

// ── Auth middleware — every request needs a Telegram user ID ──
router.use((req, res, next) => {
  const tgId = req.headers["x-tg-id"];
  if (!tgId || tgId === "0") {
    return res.status(401).json({ error: "Unauthorized" });
  }
  req.business = Business.getOrCreate(tgId, "My Business");
  next();
});

// ── GET /mini/data — all dashboard data in one call ──────────
router.get("/data", (req, res) => {
  try {
    const bId = req.business.id;
    const aiData = Analytics.forAI(bId);
    const recentExpenses = Expenses.list(bId, 8);
    const inventoryList = Products.list(bId);

    res.json({
      businessName: req.business.name,
      ...aiData,
      recentExpenses,
      inventoryList,
    });
  } catch (err) {
    console.error("Mini /data error:", err.message);
    res.status(500).json({ error: "Failed to load data" });
  }
});

// ── POST /mini/sale — record a sale ─────────────────────────
router.post("/sale", (req, res) => {
  try {
    const { product_name, quantity, sell_price, customer } = req.body;
    if (!product_name || !quantity || !sell_price) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const bId = req.business.id;
    // Try to find linked product
    const product = Products.findByName(bId, product_name);
    const cost_price = product?.cost_price || 0;
    const product_id = product?.id || null;

    // Stock check
    if (product && product.stock < quantity) {
      return res.status(400).json({ error: `Only ${product.stock} in stock` });
    }

    const result = Sales.record(bId, {
      product_id,
      product_name,
      quantity: parseFloat(quantity),
      sell_price: parseFloat(sell_price),
      cost_price,
      customer: customer || null,
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("Mini /sale error:", err.message);
    res.status(500).json({ error: "Failed to record sale" });
  }
});

// ── POST /mini/product — add a product ──────────────────────
router.post("/product", (req, res) => {
  try {
    const { name, sell_price, cost_price, stock, unit } = req.body;
    if (!name || !sell_price) {
      return res.status(400).json({ error: "Name and sell price required" });
    }

    const bId = req.business.id;

    // Check duplicate
    const existing = Products.findByName(bId, name);
    if (existing && existing.name.toLowerCase() === name.toLowerCase()) {
      return res.status(400).json({ error: `Product "${name}" already exists` });
    }

    Products.add(bId, {
      name,
      sell_price: parseFloat(sell_price),
      cost_price: parseFloat(cost_price || 0),
      stock: parseFloat(stock || 0),
      unit: unit || "unit",
      min_stock: 5,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("Mini /product error:", err.message);
    res.status(500).json({ error: "Failed to add product" });
  }
});

// ── POST /mini/expense — record an expense ──────────────────
router.post("/expense", (req, res) => {
  try {
    const { description, amount, category } = req.body;
    if (!description || !amount) {
      return res.status(400).json({ error: "Description and amount required" });
    }

    Expenses.add(req.business.id, {
      description,
      amount: parseFloat(amount),
      category: category || "General",
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("Mini /expense error:", err.message);
    res.status(500).json({ error: "Failed to record expense" });
  }
});

// ── POST /mini/ask — AI question ────────────────────────────
router.post("/ask", async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: "Question required" });

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.json({ answer: "🤖 AI features require an Anthropic API key. Contact your admin to set it up." });
    }

    const { askAI } = require("../services/ai");
    const answer = await askAI(req.business.id, question);
    res.json({ answer });
  } catch (err) {
    console.error("Mini /ask error:", err.message);
    res.status(500).json({ error: "AI unavailable" });
  }
});

// ── Serve the Mini App HTML ──────────────────────────────────
router.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../../miniapp/index.html"));
});

module.exports = router;
