"use strict";
const express  = require("express");
const { Vendors, Products, Orders, Customers, getSetting, setSetting, get, all, run } = require("../../db");
const { requireAdmin, signAdminToken } = require("../../middleware/auth");
const { isAdminTelegramId } = require("../../middleware/auth");
const jwt = require("jsonwebtoken");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "shopbot-dev-secret-change-in-production";

// POST /api/admin/login — admin web login
router.post("/login", (req, res) => {
  const { password } = req.body;
  const adminPass = process.env.ADMIN_PASSWORD || "shopbot-admin-2024";
  if (password !== adminPass) return res.status(401).json({ error: "Invalid credentials" });
  const token = jwt.sign({ role: "admin", adminId: "web" }, JWT_SECRET, { expiresIn: "12h" });
  res.json({ token });
});

// All routes below require admin auth
router.use(requireAdmin);

// GET /api/admin/stats
router.get("/stats", (req, res) => {
  const vendors   = get("SELECT COUNT(*) as n FROM vendors WHERE status='active'").n;
  const pending   = get("SELECT COUNT(*) as n FROM vendors WHERE status='pending'").n;
  const customers = get("SELECT COUNT(*) as n FROM customers").n;
  const orders    = get("SELECT COUNT(*) as n FROM orders").n;
  const revenue   = get("SELECT COALESCE(SUM(total),0) as n FROM orders WHERE payment_status='paid'").n;
  const commission= get("SELECT COALESCE(SUM(commission),0) as n FROM orders WHERE payment_status='paid'").n;
  const products  = get("SELECT COUNT(*) as n FROM products WHERE status='active'").n;
  res.json({ vendors, pending, customers, orders, revenue, commission, products, commission_rate: getSetting("commission_rate") });
});

// GET /api/admin/vendors
router.get("/vendors", (req, res) => {
  const { status="all", limit=50, offset=0 } = req.query;
  let sql = "SELECT v.*,c.name as category_name FROM vendors v LEFT JOIN categories c ON c.id=v.category_id";
  const params = [];
  if (status !== "all") { sql += " WHERE v.status=?"; params.push(status); }
  sql += " ORDER BY v.created_at DESC LIMIT ? OFFSET ?"; params.push(parseInt(limit), parseInt(offset));
  res.json({ vendors: all(sql, params) });
});

// PUT /api/admin/vendors/:id — approve/suspend/update
router.put("/vendors/:id", (req, res) => {
  Vendors.update(req.params.id, req.body);
  res.json({ ok: true });
});

// DELETE /api/admin/vendors/:id/products/:pid
router.delete("/vendors/:id/products/:pid", (req, res) => {
  run("UPDATE products SET status='removed' WHERE id=? AND vendor_id=?", [req.params.pid, req.params.id]);
  res.json({ ok: true });
});

// GET /api/admin/orders
router.get("/orders", (req, res) => {
  const { limit=50, offset=0, status } = req.query;
  let sql = "SELECT o.*,(SELECT COUNT(*) FROM order_items WHERE order_id=o.id) as item_count FROM orders o";
  const params = [];
  if (status) { sql += " WHERE o.status=?"; params.push(status); }
  sql += " ORDER BY o.created_at DESC LIMIT ? OFFSET ?"; params.push(parseInt(limit), parseInt(offset));
  res.json({ orders: all(sql, params) });
});

// GET /api/admin/customers
router.get("/customers", (req, res) => {
  const { limit=50, offset=0 } = req.query;
  res.json({ customers: all("SELECT id,email,first_name,last_name,phone,created_at FROM customers ORDER BY created_at DESC LIMIT ? OFFSET ?", [parseInt(limit), parseInt(offset)]) });
});

// GET /api/admin/categories
router.get("/categories", (req, res) => {
  res.json({ categories: all("SELECT * FROM categories ORDER BY sort_order,name") });
});

// POST /api/admin/categories
router.post("/categories", (req, res) => {
  const { name, icon, parent_id } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g,"-");
  run("INSERT OR IGNORE INTO categories (name,slug,icon,parent_id) VALUES (?,?,?,?)", [name,slug,icon||"🏪",parent_id||null]);
  res.json({ ok: true });
});

// GET/PUT /api/admin/settings
router.get("/settings", (req, res) => {
  const rows = all("SELECT * FROM settings");
  const obj  = {};
  rows.forEach(r => obj[r.key] = r.value);
  res.json({ settings: obj });
});

router.put("/settings", (req, res) => {
  for (const [k,v] of Object.entries(req.body)) setSetting(k, v);
  res.json({ ok: true });
});

// GET /api/admin/commissions
router.get("/commissions", (req, res) => {
  res.json({ commissions: all("SELECT c.*,v.business_name FROM commissions c LEFT JOIN vendors v ON v.id=c.vendor_id ORDER BY c.created_at DESC LIMIT 100") });
});

// GET /api/admin/reviews
router.get("/reviews", (req, res) => {
  res.json({ reviews: all("SELECT r.*,v.business_name,c.email FROM reviews r LEFT JOIN vendors v ON v.id=r.vendor_id LEFT JOIN customers c ON c.id=r.customer_id ORDER BY r.created_at DESC LIMIT 50") });
});

module.exports = router;
