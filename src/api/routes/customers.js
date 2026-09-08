"use strict";
const express  = require("express");
const bcrypt   = require("bcryptjs");
const { Customers, Orders } = require("../../db");
const { signCustomerToken, requireCustomer } = require("../../middleware/auth");

const router = express.Router();

// POST /api/customers/register
router.post("/register", async (req, res) => {
  try {
    const { email, password, first_name, last_name, phone } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });
    if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
    if (Customers.getByEmail(email)) return res.status(400).json({ error: "Email already registered" });
    const hash = await bcrypt.hash(password, 10);
    const r = Customers.create({ email, password_hash: hash, first_name, last_name, phone });
    const customer = Customers.getById(r.lastInsertRowid);
    res.json({ token: signCustomerToken(customer), customer });
  } catch (e) {
    console.error("Register error:", e.message);
    res.status(500).json({ error: "Registration failed" });
  }
});

// POST /api/customers/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });
    const customer = Customers.getByEmail(email);
    if (!customer) return res.status(401).json({ error: "Invalid credentials" });
    const valid = await bcrypt.compare(password, customer.password_hash);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });
    const safe = Customers.getById(customer.id);
    res.json({ token: signCustomerToken(safe), customer: safe });
  } catch (e) {
    res.status(500).json({ error: "Login failed" });
  }
});

// GET /api/customers/me
router.get("/me", requireCustomer, (req, res) => {
  res.json({ customer: req.customer });
});

// PUT /api/customers/me
router.put("/me", requireCustomer, (req, res) => {
  Customers.update(req.customer.id, req.body);
  res.json({ ok: true, customer: Customers.getById(req.customer.id) });
});

// GET /api/customers/orders
router.get("/orders", requireCustomer, (req, res) => {
  const orders = Orders.getByCustomer(req.customer.id);
  const result = orders.map(o => ({
    ...o,
    items: Orders.getItemsByOrder(o.id),
  }));
  res.json({ orders: result });
});

module.exports = router;
