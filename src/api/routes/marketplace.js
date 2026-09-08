"use strict";
const express = require("express");
const { Vendors, Products, Services, Orders, Expenses, Analytics, getSetting, recordSale, get, all } = require("../../db");
const { optionalCustomer, requireCustomer } = require("../../middleware/auth");

const router = express.Router();

// GET /api/categories
router.get("/categories", (req, res) => {
  const cats = all("SELECT * FROM categories WHERE active=1 ORDER BY sort_order,name");
  res.json({ categories: cats });
});

// GET /api/products — search/browse
router.get("/products", optionalCustomer, (req, res) => {
  const { q, category, limit=20, offset=0 } = req.query;
  const products = Products.search(q, category, parseInt(limit), parseInt(offset));
  res.json({ products });
});

// GET /api/products/featured
router.get("/products/featured", (req, res) => {
  res.json({ products: Products.featured(8) });
});

// GET /api/products/:id
router.get("/products/:id", (req, res) => {
  const p = Products.getById(req.params.id);
  if (!p || p.status !== "active") return res.status(404).json({ error: "Product not found" });
  const vendor = Vendors.getById(p.vendor_id);
  if (!vendor || vendor.status !== "active") return res.status(404).json({ error: "Product not found" });
  res.json({ product: p, vendor: { business_name: vendor.business_name, store_slug: vendor.store_slug, rating: vendor.rating, location: vendor.location } });
});

// GET /api/services — search services
router.get("/services", (req, res) => {
  const { q, limit=20, offset=0 } = req.query;
  res.json({ services: Services.search(q, parseInt(limit), parseInt(offset)) });
});

// GET /api/vendors — list vendors
router.get("/vendors", (req, res) => {
  const { category, limit=24, offset=0 } = req.query;
  let sql = `SELECT v.*,c.name as category_name FROM vendors v LEFT JOIN categories c ON c.id=v.category_id WHERE v.status='active'`;
  const params = [];
  if (category) { sql += " AND c.slug=?"; params.push(category); }
  sql += " ORDER BY v.rating DESC, v.created_at DESC LIMIT ? OFFSET ?";
  params.push(parseInt(limit), parseInt(offset));
  res.json({ vendors: all(sql, params) });
});

// GET /api/vendors/:slug — storefront
router.get("/vendors/:slug", (req, res) => {
  const vendor = Vendors.getBySlug(req.params.slug);
  if (!vendor) return res.status(404).json({ error: "Store not found" });
  const products  = Products.listByVendor(vendor.id);
  const services  = Services.listByVendor(vendor.id);
  const reviews   = all("SELECT r.*,c.first_name,c.last_name FROM reviews r LEFT JOIN customers c ON c.id=r.customer_id WHERE r.vendor_id=? ORDER BY r.created_at DESC LIMIT 10", [vendor.id]);
  // Strip internal fields
  const safe = { id:vendor.id, business_name:vendor.business_name, store_name:vendor.store_name, store_slug:vendor.store_slug,
    industry:vendor.industry, description:vendor.description, location:vendor.location, phone:vendor.phone,
    logo_url:vendor.logo_url, banner_url:vendor.banner_url, opening_hours:vendor.opening_hours,
    delivery_info:vendor.delivery_info, delivery_fee:vendor.delivery_fee, min_order:vendor.min_order,
    rating:vendor.rating, review_count:vendor.review_count };
  res.json({ vendor: safe, products, services, reviews });
});

// POST /api/orders — place order
router.post("/orders", optionalCustomer, (req, res) => {
  try {
    const { items, customer_name, customer_email, customer_phone, delivery_address, city, state, notes } = req.body;
    if (!items?.length) return res.status(400).json({ error: "No items in order" });
    if (!customer_name || !delivery_address) return res.status(400).json({ error: "Name and delivery address required" });

    const commissionRate = parseFloat(getSetting("commission_rate") || "5");
    let subtotal = 0;
    const enriched = [];

    for (const item of items) {
      const product = item.product_id ? Products.getById(item.product_id) : null;
      const service = item.service_id ? get("SELECT * FROM services WHERE id=?", [item.service_id]) : null;
      const entity  = product || service;
      if (!entity) return res.status(400).json({ error: `Item not found: ${item.product_id || item.service_id}` });
      const vendor  = Vendors.getById(entity.vendor_id);
      if (!vendor || vendor.status !== "active") return res.status(400).json({ error: "Vendor unavailable" });
      if (product && product.stock < (item.quantity||1)) return res.status(400).json({ error: `Insufficient stock: ${product.name}` });
      const qty        = parseInt(item.quantity) || 1;
      const unitPrice  = entity.price;
      const totalPrice = unitPrice * qty;
      const commission = totalPrice * (commissionRate / 100);
      subtotal += totalPrice;
      enriched.push({ product, service, vendor, entity, qty, unitPrice, totalPrice, commission });
    }

    // Get max delivery fee from involved vendors
    const maxDelivery = Math.max(...enriched.map(e => e.vendor.delivery_fee || 0));
    const total       = subtotal + maxDelivery;
    const totalComm   = subtotal * (commissionRate / 100);

    const order = Orders.createOrder({
      customer_id: req.customer?.id || null,
      customer_name, customer_email, customer_phone, delivery_address, city, state, notes,
      subtotal, delivery_fee: maxDelivery, commission: totalComm, total,
    });

    for (const e of enriched) {
      const itemResult = Orders.addItem({
        order_id: order.id,
        vendor_id: e.vendor.id,
        product_id: e.product?.id || null,
        service_id: e.service?.id || null,
        item_name: e.entity.name,
        quantity: e.qty,
        unit_price: e.unitPrice,
        total_price: e.totalPrice,
        vendor_earnings: e.totalPrice - e.commission,
        commission: e.commission,
      });
      // Adjust stock
      if (e.product) Products.adjustStock(e.product.id, e.vendor.id, -e.qty);
    }

    // Notify vendors via bot (async, don't await)
    notifyVendors(order.id, order.order_ref, enriched).catch(() => {});

    res.json({ ok: true, order_ref: order.order_ref, order_id: order.id, total });
  } catch (err) {
    console.error("Order error:", err.message);
    res.status(500).json({ error: "Failed to place order" });
  }
});

// GET /api/orders/:ref — track order
router.get("/orders/:ref", optionalCustomer, (req, res) => {
  const order = Orders.getByRef(req.params.ref);
  if (!order) return res.status(404).json({ error: "Order not found" });
  // Customer can only see their own orders (or guest orders without customer_id)
  if (req.customer && order.customer_id && order.customer_id !== req.customer.id)
    return res.status(403).json({ error: "Forbidden" });
  const items = Orders.getItemsByOrder(order.id);
  res.json({ order, items });
});

// POST /api/orders/:ref/payment — update payment status (called by payment webhook)
router.post("/orders/:ref/payment", (req, res) => {
  const { status, provider_ref } = req.body;
  const order = Orders.getByRef(req.params.ref);
  if (!order) return res.status(404).json({ error: "Order not found" });
  Orders.updatePayment(order.id, status, provider_ref);
  if (status === "paid") {
    Orders.updateStatus(order.id, "confirmed");
    // Record vendor sales
    const items = Orders.getItemsByOrder(order.id);
    const commRate = parseFloat(getSetting("commission_rate") || "5");
    items.forEach(item => {
      const product = item.product_id ? Products.getById(item.product_id) : null;
      recordSale(item.vendor_id, item.id, item.product_id, item.item_name, item.quantity, item.unit_price, product?.cost_price||0, commRate);
    });
  }
  res.json({ ok: true });
});

async function notifyVendors(orderId, orderRef, enriched) {
  const bot = global._shopbot;
  if (!bot) return;
  // Group items by vendor
  const byVendor = {};
  for (const e of enriched) {
    if (!byVendor[e.vendor.id]) byVendor[e.vendor.id] = { vendor: e.vendor, items: [] };
    byVendor[e.vendor.id].items.push(e);
  }
  for (const { vendor, items } of Object.values(byVendor)) {
    try {
      const itemLines = items.map(i => `• ${i.qty}× ${i.entity.name} — ₦${Number(i.totalPrice).toLocaleString("en-NG")}`).join("\n");
      const vendorOrders = Orders.getVendorOrders(vendor.id, "pending", 1);
      const latestItem   = vendorOrders[0];
      const { Markup }   = require("telegraf");
      await bot.telegram.sendMessage(vendor.telegram_id,
        `🛒 *NEW ORDER ${orderRef}*\n\n${itemLines}\n\nTotal: ₦${Number(items.reduce((s,i)=>s+i.totalPrice,0)).toLocaleString("en-NG")}`,
        { parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("✅ Accept", `accept:${latestItem?.id || "x"}`),
             Markup.button.callback("❌ Reject", `reject:${latestItem?.id || "x"}`)],
          ]) }
      );
    } catch (e) { console.warn("Notify vendor failed:", e.message); }
  }
}

module.exports = router;
