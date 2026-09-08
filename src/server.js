"use strict";
require("dotenv").config();

// ── Global crash guards ───────────────────────────────────────
process.on("uncaughtException",  err => console.error("💥 uncaughtException:", err.message, err.stack));
process.on("unhandledRejection", err => console.error("💥 unhandledRejection:", err));

const express     = require("express");
const path        = require("path");
const rateLimit   = require("express-rate-limit");
const { getDb }   = require("./db");

// Initialise DB first
getDb();
console.log("✅ Database ready");

// ── Start Telegram bot in same process ────────────────────────
const startBot = require("./bot");
startBot().catch(e => console.error("Bot start error:", e.message));

const app  = express();
const PORT = parseInt(process.env.PORT || "3000");

// ── Middleware ────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "../public")));

// Rate limiting
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false });
app.use("/api", limiter);

// CORS for development
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ── API Routes ────────────────────────────────────────────────
app.use("/api/customers",  require("./api/routes/customers"));
app.use("/api",            require("./api/routes/marketplace"));
app.use("/api/admin",      require("./api/routes/admin"));

// ── Health ────────────────────────────────────────────────────
app.get("/health", (req, res) => res.json({ status: "ok", ts: new Date().toISOString() }));

// ── File uploads ──────────────────────────────────────────────
const multer = require("multer");
const storage = multer.diskStorage({
  destination: path.join(__dirname, "../public/uploads"),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname.replace(/[^a-z0-9.]/gi,"_")),
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });
  res.json({ url: `/uploads/${req.file.filename}` });
});

// ── Telegram webhook (if WEBHOOK_URL set) ─────────────────────
if (process.env.WEBHOOK_URL) {
  const WURL = process.env.WEBHOOK_URL.replace(/\/+$/, "");
  // Bot registers itself after launch; webhook callback registered in bot/index.js
  app.post("/webhook", (req, res) => {
    if (global._botWebhookHandler) return global._botWebhookHandler(req, res);
    res.sendStatus(200);
  });
}

// ── Frontend SPA fallback ─────────────────────────────────────
// Admin dashboard
app.get("/admin*", (req, res) => res.sendFile(path.join(__dirname, "../public/admin.html")));
// Customer SPA
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "../public/index.html")));

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`🚀 ShopBot server on port ${PORT}`));

module.exports = app;
