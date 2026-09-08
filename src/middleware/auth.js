"use strict";
const jwt = require("jsonwebtoken");
const { Customers } = require("../db");

const JWT_SECRET = process.env.JWT_SECRET || "shopbot-dev-secret-change-in-production";
const ADMIN_IDS  = (process.env.ADMIN_TELEGRAM_ID||"").split(",").map(s=>s.trim()).filter(Boolean);

function signCustomerToken(customer) {
  return jwt.sign({ id: customer.id, email: customer.email, role: "customer" }, JWT_SECRET, { expiresIn: "30d" });
}

function signAdminToken(adminId) {
  return jwt.sign({ adminId, role: "admin" }, JWT_SECRET, { expiresIn: "12h" });
}

function requireCustomer(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
  try {
    const decoded = jwt.verify(auth.slice(7), JWT_SECRET);
    if (decoded.role !== "customer") return res.status(403).json({ error: "Forbidden" });
    req.customer = Customers.getById(decoded.id);
    if (!req.customer) return res.status(401).json({ error: "Customer not found" });
    next();
  } catch { res.status(401).json({ error: "Invalid token" }); }
}

function optionalCustomer(req, res, next) {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    try {
      const decoded = jwt.verify(auth.slice(7), JWT_SECRET);
      if (decoded.role === "customer") req.customer = Customers.getById(decoded.id);
    } catch {}
  }
  next();
}

function requireAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
  try {
    const decoded = jwt.verify(auth.slice(7), JWT_SECRET);
    if (decoded.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    req.adminId = decoded.adminId;
    next();
  } catch { res.status(401).json({ error: "Invalid token" }); }
}

function isAdminTelegramId(tgId) {
  return ADMIN_IDS.includes(String(tgId));
}

module.exports = { signCustomerToken, signAdminToken, requireCustomer, optionalCustomer, requireAdmin, isAdminTelegramId, JWT_SECRET };
