"use strict";
const Database = require("better-sqlite3");
const path     = require("path");
const fs       = require("fs");
require("dotenv").config();

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "../../data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "shopbot.db");
let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    createSchema();
  }
  return db;
}

function createSchema() {
  db.exec(`
    -- ── Platform settings ─────────────────────────────────────
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- ── Categories (dynamic, database-driven) ─────────────────
    CREATE TABLE IF NOT EXISTS categories (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL UNIQUE,
      slug        TEXT    NOT NULL UNIQUE,
      icon        TEXT    DEFAULT '🏪',
      parent_id   INTEGER REFERENCES categories(id),
      sort_order  INTEGER DEFAULT 0,
      active      INTEGER DEFAULT 1,
      created_at  TEXT    DEFAULT (datetime('now'))
    );

    -- ── Vendors ───────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS vendors (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id     TEXT    UNIQUE NOT NULL,
      telegram_username TEXT,
      business_name   TEXT    NOT NULL,
      store_name      TEXT,
      store_slug      TEXT    UNIQUE,
      category_id     INTEGER REFERENCES categories(id),
      industry        TEXT,
      description     TEXT,
      location        TEXT,
      phone           TEXT,
      email           TEXT,
      logo_url        TEXT,
      banner_url      TEXT,
      opening_hours   TEXT,
      delivery_info   TEXT,
      delivery_fee    REAL    DEFAULT 0,
      delivery_zones  TEXT,
      min_order       REAL    DEFAULT 0,
      rating          REAL    DEFAULT 5.0,
      review_count    INTEGER DEFAULT 0,
      status          TEXT    DEFAULT 'pending',
      commission_rate REAL,
      plan            TEXT    DEFAULT 'free',
      verified        INTEGER DEFAULT 0,
      setup_step      INTEGER DEFAULT 0,
      created_at      TEXT    DEFAULT (datetime('now'))
    );

    -- ── Vendor locations (multi-branch) ───────────────────────
    CREATE TABLE IF NOT EXISTS vendor_locations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_id   INTEGER NOT NULL REFERENCES vendors(id),
      name        TEXT    NOT NULL,
      address     TEXT,
      phone       TEXT,
      is_primary  INTEGER DEFAULT 0,
      active      INTEGER DEFAULT 1,
      created_at  TEXT    DEFAULT (datetime('now'))
    );

    -- ── Products ──────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS products (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_id    INTEGER NOT NULL REFERENCES vendors(id),
      location_id  INTEGER REFERENCES vendor_locations(id),
      category_id  INTEGER REFERENCES categories(id),
      name         TEXT    NOT NULL,
      description  TEXT,
      price        REAL    NOT NULL DEFAULT 0,
      compare_price REAL,
      cost_price   REAL    DEFAULT 0,
      stock        INTEGER DEFAULT 0,
      min_stock    INTEGER DEFAULT 5,
      sku          TEXT,
      unit         TEXT    DEFAULT 'unit',
      image_url    TEXT,
      images       TEXT,
      featured     INTEGER DEFAULT 0,
      status       TEXT    DEFAULT 'active',
      type         TEXT    DEFAULT 'physical',
      created_at   TEXT    DEFAULT (datetime('now'))
    );

    -- ── Services ──────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS services (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_id    INTEGER NOT NULL REFERENCES vendors(id),
      category_id  INTEGER REFERENCES categories(id),
      name         TEXT    NOT NULL,
      description  TEXT,
      price        REAL    NOT NULL DEFAULT 0,
      duration_min INTEGER,
      availability TEXT,
      location     TEXT,
      image_url    TEXT,
      booking_req  TEXT,
      status       TEXT    DEFAULT 'active',
      created_at   TEXT    DEFAULT (datetime('now'))
    );

    -- ── Customers ─────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS customers (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      email        TEXT    UNIQUE NOT NULL,
      password_hash TEXT   NOT NULL,
      first_name   TEXT,
      last_name    TEXT,
      phone        TEXT,
      address      TEXT,
      city         TEXT,
      state        TEXT,
      verified     INTEGER DEFAULT 0,
      created_at   TEXT    DEFAULT (datetime('now'))
    );

    -- ── Orders ────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS orders (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      order_ref      TEXT    UNIQUE NOT NULL,
      customer_id    INTEGER REFERENCES customers(id),
      customer_name  TEXT    NOT NULL,
      customer_email TEXT,
      customer_phone TEXT,
      delivery_address TEXT,
      city           TEXT,
      state          TEXT,
      subtotal       REAL    DEFAULT 0,
      delivery_fee   REAL    DEFAULT 0,
      commission     REAL    DEFAULT 0,
      total          REAL    DEFAULT 0,
      payment_status TEXT    DEFAULT 'pending',
      payment_ref    TEXT,
      payment_method TEXT,
      status         TEXT    DEFAULT 'pending',
      notes          TEXT,
      created_at     TEXT    DEFAULT (datetime('now'))
    );

    -- ── Order items (multi-vendor) ─────────────────────────────
    CREATE TABLE IF NOT EXISTS order_items (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id     INTEGER NOT NULL REFERENCES orders(id),
      vendor_id    INTEGER NOT NULL REFERENCES vendors(id),
      product_id   INTEGER REFERENCES products(id),
      service_id   INTEGER REFERENCES services(id),
      item_name    TEXT    NOT NULL,
      quantity     INTEGER DEFAULT 1,
      unit_price   REAL    NOT NULL,
      total_price  REAL    NOT NULL,
      vendor_earnings REAL DEFAULT 0,
      commission   REAL    DEFAULT 0,
      status       TEXT    DEFAULT 'pending',
      vendor_notes TEXT
    );

    -- ── Payments ──────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS payments (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id     INTEGER REFERENCES orders(id),
      amount       REAL    NOT NULL,
      currency     TEXT    DEFAULT 'NGN',
      provider     TEXT,
      provider_ref TEXT,
      status       TEXT    DEFAULT 'pending',
      paid_at      TEXT,
      created_at   TEXT    DEFAULT (datetime('now'))
    );

    -- ── Vendor sales (for analytics) ──────────────────────────
    CREATE TABLE IF NOT EXISTS vendor_sales (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_id    INTEGER NOT NULL REFERENCES vendors(id),
      order_item_id INTEGER REFERENCES order_items(id),
      product_id   INTEGER REFERENCES products(id),
      product_name TEXT    NOT NULL,
      quantity     INTEGER DEFAULT 1,
      unit_price   REAL    NOT NULL,
      cost_price   REAL    DEFAULT 0,
      revenue      REAL    NOT NULL,
      profit       REAL    DEFAULT 0,
      commission   REAL    DEFAULT 0,
      net_earning  REAL    DEFAULT 0,
      created_at   TEXT    DEFAULT (datetime('now'))
    );

    -- ── Expenses ──────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS expenses (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_id   INTEGER NOT NULL REFERENCES vendors(id),
      description TEXT    NOT NULL,
      amount      REAL    NOT NULL,
      category    TEXT    DEFAULT 'General',
      created_at  TEXT    DEFAULT (datetime('now'))
    );

    -- ── Staff ─────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS staff (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_id   INTEGER NOT NULL REFERENCES vendors(id),
      name        TEXT    NOT NULL,
      role        TEXT,
      phone       TEXT,
      salary      REAL    DEFAULT 0,
      start_date  TEXT,
      active      INTEGER DEFAULT 1,
      created_at  TEXT    DEFAULT (datetime('now'))
    );

    -- ── Payroll ───────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS payroll (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_id   INTEGER NOT NULL REFERENCES vendors(id),
      staff_id    INTEGER REFERENCES staff(id),
      staff_name  TEXT    NOT NULL,
      amount      REAL    NOT NULL,
      period      TEXT,
      paid_at     TEXT    DEFAULT (datetime('now'))
    );

    -- ── Inventory movements ───────────────────────────────────
    CREATE TABLE IF NOT EXISTS inventory_movements (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_id   INTEGER NOT NULL REFERENCES vendors(id),
      product_id  INTEGER NOT NULL REFERENCES products(id),
      type        TEXT    NOT NULL,
      quantity    INTEGER NOT NULL,
      notes       TEXT,
      created_at  TEXT    DEFAULT (datetime('now'))
    );

    -- ── Deliveries ────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS deliveries (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_id   INTEGER NOT NULL REFERENCES vendors(id),
      order_id    INTEGER REFERENCES orders(id),
      customer    TEXT,
      address     TEXT,
      rider       TEXT,
      fee         REAL    DEFAULT 0,
      status      TEXT    DEFAULT 'pending',
      notes       TEXT,
      created_at  TEXT    DEFAULT (datetime('now'))
    );

    -- ── Reviews ───────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS reviews (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_id   INTEGER NOT NULL REFERENCES vendors(id),
      customer_id INTEGER REFERENCES customers(id),
      product_id  INTEGER REFERENCES products(id),
      order_id    INTEGER REFERENCES orders(id),
      rating      INTEGER NOT NULL,
      comment     TEXT,
      reply       TEXT,
      created_at  TEXT    DEFAULT (datetime('now'))
    );

    -- ── Notifications ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS notifications (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_id   INTEGER REFERENCES vendors(id),
      customer_id INTEGER REFERENCES customers(id),
      type        TEXT    NOT NULL,
      title       TEXT    NOT NULL,
      message     TEXT,
      read        INTEGER DEFAULT 0,
      created_at  TEXT    DEFAULT (datetime('now'))
    );

    -- ── Commissions ───────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS commissions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_id   INTEGER REFERENCES vendors(id),
      order_id    INTEGER REFERENCES orders(id),
      gross       REAL    NOT NULL,
      rate        REAL    NOT NULL,
      amount      REAL    NOT NULL,
      vendor_net  REAL    NOT NULL,
      created_at  TEXT    DEFAULT (datetime('now'))
    );

    -- ── Indexes ───────────────────────────────────────────────
    CREATE INDEX IF NOT EXISTS idx_products_vendor    ON products(vendor_id);
    CREATE INDEX IF NOT EXISTS idx_products_category  ON products(category_id);
    CREATE INDEX IF NOT EXISTS idx_products_status    ON products(status);
    CREATE INDEX IF NOT EXISTS idx_order_items_vendor ON order_items(vendor_id);
    CREATE INDEX IF NOT EXISTS idx_order_items_order  ON order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_vendor_sales_vid   ON vendor_sales(vendor_id);
    CREATE INDEX IF NOT EXISTS idx_vendors_slug       ON vendors(store_slug);
    CREATE INDEX IF NOT EXISTS idx_vendors_status     ON vendors(status);
  `);

  seedDefaults();
}

function seedDefaults() {
  // Platform commission default
  const existing = db.prepare("SELECT value FROM settings WHERE key='commission_rate'").get();
  if (!existing) {
    db.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)").run("commission_rate", "5");
    db.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)").run("platform_name", "ShopBot");
    db.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)").run("currency", "NGN");
  }

  // Seed categories if empty
  const catCount = db.prepare("SELECT COUNT(*) as n FROM categories").get();
  if (catCount.n === 0) {
    const cats = [
      ["Food & Drinks","food-drinks","🍔",0],
      ["Fashion & Clothing","fashion","👗",0],
      ["Beauty & Personal Care","beauty","💄",0],
      ["Electronics & Gadgets","electronics","📱",0],
      ["Home & Living","home-living","🏠",0],
      ["Grocery & Supermarket","grocery","🛒",0],
      ["Health & Wellness","health","💊",0],
      ["Professional Services","professional","💼",0],
      ["Home & Property Services","home-services","🔧",0],
      ["Automotive","automotive","🚗",0],
      ["Logistics & Delivery","logistics","🚚",0],
      ["Travel & Hospitality","travel","✈️",0],
      ["Education & Training","education","📚",0],
      ["Events & Entertainment","events","🎉",0],
      ["Agriculture","agriculture","🌾",0],
      ["Manufacturing","manufacturing","🏭",0],
      ["Wholesale & Distribution","wholesale","📦",0],
      ["Creative & Design","creative","🎨",0],
      ["Digital & Tech","digital","💻",0],
      ["Crypto & Gift Cards","crypto","💱",0],
      ["Finance","finance","🏦",0],
      ["Export & Import","export-import","🌍",0],
      ["Other","other","🏪",0],
    ];
    const ins = db.prepare("INSERT OR IGNORE INTO categories (name,slug,icon,sort_order) VALUES (?,?,?,?)");
    cats.forEach(([n,s,i,o]) => ins.run(n,s,i,o));
  }
}

// ── Model helpers ─────────────────────────────────────────────
function run(sql, params=[])   { return getDb().prepare(sql).run(params); }
function get(sql, params=[])   { return getDb().prepare(sql).get(params); }
function all(sql, params=[])   { return getDb().prepare(sql).all(params); }
function getSetting(key)       { return get("SELECT value FROM settings WHERE key=?", [key])?.value; }
function setSetting(key, val)  { run("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)", [key, String(val)]); }

// ── Vendor model ──────────────────────────────────────────────
const Vendors = {
  getByTelegramId: (tgId) => get("SELECT * FROM vendors WHERE telegram_id=?", [String(tgId)]),
  getById:         (id)   => get("SELECT * FROM vendors WHERE id=?", [id]),
  getBySlug:       (slug) => get("SELECT * FROM vendors WHERE store_slug=? AND status='active'", [slug]),
  list:            (limit=50, offset=0) => all("SELECT * FROM vendors WHERE status='active' ORDER BY created_at DESC LIMIT ? OFFSET ?", [limit, offset]),
  create(data) {
    const slug = slugify(data.store_name || data.business_name);
    return run(
      `INSERT INTO vendors (telegram_id,telegram_username,business_name,store_name,store_slug,industry,location,phone,description,setup_step)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [String(data.telegram_id), data.username||null, data.business_name, data.store_name||data.business_name,
       slug, data.industry||null, data.location||null, data.phone||null, data.description||null, data.setup_step||1]
    );
  },
  update(id, fields) {
    const allowed = ["business_name","store_name","store_slug","industry","description","location","phone","email",
      "logo_url","banner_url","opening_hours","delivery_info","delivery_fee","delivery_zones","min_order",
      "status","setup_step","category_id","plan","verified","commission_rate","telegram_username"];
    const sets = [], vals = [];
    for (const [k,v] of Object.entries(fields)) {
      if (allowed.includes(k)) { sets.push(`${k}=?`); vals.push(v); }
    }
    if (!sets.length) return;
    vals.push(id);
    run(`UPDATE vendors SET ${sets.join(",")} WHERE id=?`, vals);
  },
  updateRating(id) {
    const r = get("SELECT AVG(rating) as avg, COUNT(*) as cnt FROM reviews WHERE vendor_id=?", [id]);
    run("UPDATE vendors SET rating=?, review_count=? WHERE id=?", [r.avg||5, r.cnt, id]);
  },
};

// ── Products model ────────────────────────────────────────────
const Products = {
  getById:    (id)       => get("SELECT * FROM products WHERE id=?", [id]),
  listByVendor(vendorId, status="active") {
    return all("SELECT p.*,c.name as category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.vendor_id=? AND p.status=? ORDER BY p.created_at DESC", [vendorId, status]);
  },
  search(q, categorySlug, limit=20, offset=0) {
    let sql = `SELECT p.*,v.business_name,v.store_slug,c.name as cat_name FROM products p
               JOIN vendors v ON v.id=p.vendor_id AND v.status='active'
               LEFT JOIN categories c ON c.id=p.category_id
               WHERE p.status='active'`;
    const params = [];
    if (q) { sql += " AND (p.name LIKE ? OR p.description LIKE ?)"; params.push(`%${q}%`,`%${q}%`); }
    if (categorySlug) {
      sql += " AND c.slug=?"; params.push(categorySlug);
    }
    sql += " ORDER BY p.featured DESC, p.created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);
    return all(sql, params);
  },
  featured(limit=8) {
    return all(`SELECT p.*,v.business_name,v.store_slug FROM products p JOIN vendors v ON v.id=p.vendor_id AND v.status='active' WHERE p.status='active' AND p.featured=1 ORDER BY RANDOM() LIMIT ?`, [limit]);
  },
  lowStock(vendorId) {
    return all("SELECT * FROM products WHERE vendor_id=? AND status='active' AND stock<=min_stock", [vendorId]);
  },
  create(data) {
    return run(
      `INSERT INTO products (vendor_id,category_id,name,description,price,compare_price,cost_price,stock,min_stock,unit,image_url,sku,type)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [data.vendor_id,data.category_id||null,data.name,data.description||null,data.price,
       data.compare_price||null,data.cost_price||0,data.stock||0,data.min_stock||5,
       data.unit||"unit",data.image_url||null,data.sku||null,data.type||"physical"]
    );
  },
  update(id, vendorId, fields) {
    const allowed = ["name","description","price","compare_price","cost_price","stock","min_stock","unit","image_url","category_id","status","featured","sku","type"];
    const sets=[], vals=[];
    for (const [k,v] of Object.entries(fields)) {
      if (allowed.includes(k)) { sets.push(`${k}=?`); vals.push(v); }
    }
    if (!sets.length) return;
    vals.push(id, vendorId);
    run(`UPDATE products SET ${sets.join(",")} WHERE id=? AND vendor_id=?`, vals);
  },
  adjustStock(id, vendorId, delta) {
    run("UPDATE products SET stock=MAX(0,stock+?) WHERE id=? AND vendor_id=?", [delta, id, vendorId]);
  },
};

// ── Services model ────────────────────────────────────────────
const Services = {
  getById:     (id)      => get("SELECT * FROM services WHERE id=?", [id]),
  listByVendor:(vendorId)=> all("SELECT * FROM services WHERE vendor_id=? AND status='active'", [vendorId]),
  search(q, limit=20, offset=0) {
    return all(`SELECT s.*,v.business_name,v.store_slug FROM services s JOIN vendors v ON v.id=s.vendor_id AND v.status='active' WHERE s.status='active' AND (s.name LIKE ? OR s.description LIKE ?) LIMIT ? OFFSET ?`,
      [`%${q||""}%`,`%${q||""}%`,limit,offset]);
  },
  create(data) {
    return run(
      `INSERT INTO services (vendor_id,category_id,name,description,price,duration_min,availability,location,image_url,booking_req)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [data.vendor_id,data.category_id||null,data.name,data.description||null,data.price,
       data.duration_min||null,data.availability||null,data.location||null,data.image_url||null,data.booking_req||null]
    );
  },
};

// ── Orders model ──────────────────────────────────────────────
const Orders = {
  getById:    (id)       => get("SELECT * FROM orders WHERE id=?", [id]),
  getByRef:   (ref)      => get("SELECT * FROM orders WHERE order_ref=?", [ref]),
  getByCustomer(customerId, limit=10) {
    return all("SELECT * FROM orders WHERE customer_id=? ORDER BY created_at DESC LIMIT ?", [customerId, limit]);
  },
  getItemsByOrder: (orderId) => all("SELECT oi.*,v.business_name,v.store_slug FROM order_items oi JOIN vendors v ON v.id=oi.vendor_id WHERE oi.order_id=?", [orderId]),
  getVendorOrders(vendorId, status, limit=50) {
    let sql = `SELECT oi.*,o.order_ref,o.customer_name,o.customer_phone,o.delivery_address,o.city,o.created_at as order_date,o.payment_status
               FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.vendor_id=?`;
    const params = [vendorId];
    if (status) { sql += " AND oi.status=?"; params.push(status); }
    sql += " ORDER BY o.created_at DESC LIMIT ?"; params.push(limit);
    return all(sql, params);
  },
  createOrder(data) {
    const ref = "ORD-" + Date.now();
    const r = run(
      `INSERT INTO orders (order_ref,customer_id,customer_name,customer_email,customer_phone,delivery_address,city,state,subtotal,delivery_fee,commission,total,notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [ref,data.customer_id||null,data.customer_name,data.customer_email||null,data.customer_phone||null,
       data.delivery_address,data.city||null,data.state||null,data.subtotal,data.delivery_fee||0,
       data.commission||0,data.total,data.notes||null]
    );
    return { ...r, order_ref: ref, id: r.lastInsertRowid };
  },
  addItem(data) {
    return run(
      `INSERT INTO order_items (order_id,vendor_id,product_id,service_id,item_name,quantity,unit_price,total_price,vendor_earnings,commission)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [data.order_id,data.vendor_id,data.product_id||null,data.service_id||null,data.item_name,
       data.quantity,data.unit_price,data.total_price,data.vendor_earnings||0,data.commission||0]
    );
  },
  updateStatus(id, status) {
    run("UPDATE orders SET status=? WHERE id=?", [status, id]);
  },
  updateItemStatus(itemId, status, notes) {
    run("UPDATE order_items SET status=?,vendor_notes=? WHERE id=?", [status, notes||null, itemId]);
  },
  updatePayment(orderId, status, ref) {
    run("UPDATE orders SET payment_status=?,payment_ref=? WHERE id=?", [status, ref||null, orderId]);
  },
};

// ── Analytics for vendors ─────────────────────────────────────
const Analytics = {
  todaySales(vendorId) {
    return get(`SELECT COUNT(*) as count, COALESCE(SUM(revenue),0) as revenue, COALESCE(SUM(profit),0) as profit
               FROM vendor_sales WHERE vendor_id=? AND date(created_at)=date('now','localtime')`, [vendorId]);
  },
  monthSales(vendorId) {
    return get(`SELECT COUNT(*) as count, COALESCE(SUM(revenue),0) as revenue, COALESCE(SUM(profit),0) as profit
               FROM vendor_sales WHERE vendor_id=? AND strftime('%Y-%m',created_at)=strftime('%Y-%m','now','localtime')`, [vendorId]);
  },
  topProducts(vendorId, limit=5) {
    return all(`SELECT product_name, SUM(quantity) as sold, SUM(revenue) as revenue FROM vendor_sales WHERE vendor_id=? GROUP BY product_name ORDER BY sold DESC LIMIT ?`, [vendorId, limit]);
  },
  todayOrders(vendorId) {
    return all(`SELECT oi.*,o.order_ref,o.customer_name,o.delivery_address FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.vendor_id=? AND date(o.created_at)=date('now','localtime') ORDER BY o.created_at DESC`, [vendorId]);
  },
};

// ── Customers model ───────────────────────────────────────────
const Customers = {
  getById:    (id)     => get("SELECT id,email,first_name,last_name,phone,address,city,state,created_at FROM customers WHERE id=?", [id]),
  getByEmail: (email)  => get("SELECT * FROM customers WHERE email=?", [email]),
  create(data) {
    return run(
      "INSERT INTO customers (email,password_hash,first_name,last_name,phone) VALUES (?,?,?,?,?)",
      [data.email, data.password_hash, data.first_name||null, data.last_name||null, data.phone||null]
    );
  },
  update(id, fields) {
    const allowed = ["first_name","last_name","phone","address","city","state"];
    const sets=[], vals=[];
    for (const [k,v] of Object.entries(fields)) {
      if (allowed.includes(k)) { sets.push(`${k}=?`); vals.push(v); }
    }
    if (!sets.length) return;
    vals.push(id);
    run(`UPDATE customers SET ${sets.join(",")} WHERE id=?`, vals);
  },
};

// ── Expenses model ────────────────────────────────────────────
const Expenses = {
  add(vendorId, desc, amount, category) {
    return run("INSERT INTO expenses (vendor_id,description,amount,category) VALUES (?,?,?,?)",
      [vendorId, desc, amount, category||"General"]);
  },
  today(vendorId) {
    return get("SELECT COUNT(*) as count, COALESCE(SUM(amount),0) as total FROM expenses WHERE vendor_id=? AND date(created_at)=date('now','localtime')", [vendorId]);
  },
  list(vendorId, limit=20) {
    return all("SELECT * FROM expenses WHERE vendor_id=? ORDER BY created_at DESC LIMIT ?", [vendorId, limit]);
  },
};

// ── Staff model ───────────────────────────────────────────────
const Staff = {
  list:   (vendorId) => all("SELECT * FROM staff WHERE vendor_id=? AND active=1", [vendorId]),
  add(vendorId, name, role, phone, salary) {
    return run("INSERT INTO staff (vendor_id,name,role,phone,salary) VALUES (?,?,?,?,?)", [vendorId,name,role||null,phone||null,salary||0]);
  },
};

// ── Helpers ───────────────────────────────────────────────────
function slugify(text) {
  return (text||"store").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").substring(0,50)
    + "-" + Math.random().toString(36).substring(2,6);
}

function recordSale(vendorId, orderItemId, productId, productName, qty, unitPrice, costPrice, commissionRate) {
  const revenue    = qty * unitPrice;
  const profit     = revenue - (qty * (costPrice||0));
  const commission = revenue * ((commissionRate||5)/100);
  const netEarning = revenue - commission;
  run(`INSERT INTO vendor_sales (vendor_id,order_item_id,product_id,product_name,quantity,unit_price,cost_price,revenue,profit,commission,net_earning)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [vendorId,orderItemId||null,productId||null,productName,qty,unitPrice,costPrice||0,revenue,profit,commission,netEarning]);
}

module.exports = {
  getDb, run, get, all, getSetting, setSetting,
  Vendors, Products, Services, Orders, Analytics,
  Customers, Expenses, Staff, slugify, recordSale,
};
