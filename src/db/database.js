// ─────────────────────────────────────────────────────────────────────────────
//  database.js — ShopBoss data layer (sql.js / SQLite in-memory + file persist)
// ─────────────────────────────────────────────────────────────────────────────
const initSqlJs = require("sql.js");
const path      = require("path");
const fs        = require("fs");

// Railway Volume should be mounted at /data
// If /data exists and is writable, use it — otherwise fall back to ./data (local dev)
const RAILWAY_VOLUME = "/data";
const LOCAL_DATA     = path.join(__dirname, "../../data");
const DB_DIR  = (() => {
  try {
    const fs2 = require("fs");
    // Check if Railway Volume is mounted and writable
    if (fs2.existsSync(RAILWAY_VOLUME)) {
      fs2.accessSync(RAILWAY_VOLUME, fs2.constants.W_OK);
      console.log("📁 Using Railway Volume at /data for database");
      return RAILWAY_VOLUME;
    }
  } catch (_) {}
  return LOCAL_DATA;
})();
const DB_PATH = path.join(DB_DIR, "shopboss.db");

let db = null;

// ── Init & persistence ────────────────────────────────────────────────────────
function init() {
  return initSqlJs().then((SQL) => {
    if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
    if (fs.existsSync(DB_PATH)) {
      const data = fs.readFileSync(DB_PATH);
      db = new SQL.Database(data);
    } else {
      db = new SQL.Database();
    }
    createSchema();
    setInterval(save, 30000);
    process.on("SIGTERM", save);
    process.on("SIGINT",  save);
    // Run safe column migrations for existing databases
    migrateSchema();
    console.log("✅ Database ready");
    return { run, get, all, save };
  });
}

function save() {
  if (!db) return;
  try {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (e) { console.error("DB save error:", e.message); }
}

// ── Core query helpers ────────────────────────────────────────────────────────
function assertReady() { if (!db) throw new Error("DB not initialised"); }

function run(sql, params = []) {
  assertReady();
  db.run(sql, params);
  const row = db.exec("SELECT last_insert_rowid() as id");
  return { lastInsertRowid: row[0]?.values[0][0] ?? null };
}

function get(sql, params = []) {
  assertReady();
  const result = db.exec(sql, params);
  if (!result.length || !result[0].values.length) return null;
  const { columns, values } = result[0];
  return Object.fromEntries(columns.map((c, i) => [c, values[0][i]]));
}

function all(sql, params = []) {
  assertReady();
  const result = db.exec(sql, params);
  if (!result.length) return [];
  const { columns, values } = result[0];
  return values.map(row => Object.fromEntries(columns.map((c, i) => [c, row[i]])));
}

// ── Schema ────────────────────────────────────────────────────────────────────
function migrateSchema() {
  // Safe ALTER TABLE — silently ignored if column already exists
  const migrations = [
    "ALTER TABLE vendors ADD COLUMN telegram_id TEXT",
    "ALTER TABLE vendor_reviews ADD COLUMN reviewer_tg_id TEXT",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_vendors_tgid ON vendors(telegram_id) WHERE telegram_id IS NOT NULL",
  ];
  for (const sql of migrations) {
    try { db.run(sql); } catch(_) { /* already exists — ignore */ }
  }
}

function createSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS businesses (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT    UNIQUE NOT NULL,
      name        TEXT    NOT NULL DEFAULT 'My Business',
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS products (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      name        TEXT    NOT NULL,
      sell_price  REAL    NOT NULL DEFAULT 0,
      cost_price  REAL    NOT NULL DEFAULT 0,
      stock       REAL    NOT NULL DEFAULT 0,
      unit        TEXT    NOT NULL DEFAULT 'unit',
      min_stock   REAL    NOT NULL DEFAULT 5,
      active      INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sales (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      product_id  INTEGER REFERENCES products(id),
      product_name TEXT   NOT NULL,
      quantity    REAL    NOT NULL DEFAULT 1,
      sell_price  REAL    NOT NULL DEFAULT 0,
      cost_price  REAL    NOT NULL DEFAULT 0,
      revenue     REAL    NOT NULL DEFAULT 0,
      profit      REAL    NOT NULL DEFAULT 0,
      customer    TEXT,
      notes       TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS expenses (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      description TEXT    NOT NULL,
      amount      REAL    NOT NULL DEFAULT 0,
      category    TEXT    NOT NULL DEFAULT 'General',
      notes       TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS stock_movements (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      product_id  INTEGER NOT NULL REFERENCES products(id),
      type        TEXT    NOT NULL CHECK(type IN ('in','out','adjustment')),
      quantity    REAL    NOT NULL DEFAULT 0,
      notes       TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS orders (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      ref         TEXT    NOT NULL UNIQUE,
      customer    TEXT    NOT NULL,
      items       TEXT    NOT NULL DEFAULT '[]',
      total       REAL    NOT NULL DEFAULT 0,
      status      TEXT    NOT NULL DEFAULT 'pending'
                          CHECK(status IN ('pending','confirmed','processing','shipped','delivered','cancelled')),
      notes       TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS staff (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      name        TEXT    NOT NULL,
      role        TEXT    NOT NULL DEFAULT 'Staff',
      salary      REAL    NOT NULL DEFAULT 0,
      phone       TEXT,
      active      INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS payroll (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      staff_id    INTEGER REFERENCES staff(id),
      staff_name  TEXT    NOT NULL,
      amount      REAL    NOT NULL DEFAULT 0,
      period      TEXT    NOT NULL DEFAULT (strftime('%Y-%m', 'now')),
      notes       TEXT,
      paid_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS suppliers (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      name        TEXT    NOT NULL,
      product     TEXT,
      phone       TEXT,
      email       TEXT,
      notes       TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS settings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      key         TEXT    NOT NULL,
      value       TEXT    NOT NULL,
      PRIMARY KEY (business_id, key)
    );
    CREATE TABLE IF NOT EXISTS licenses (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id     TEXT    UNIQUE NOT NULL,
      status          TEXT    NOT NULL DEFAULT 'trial'
                              CHECK(status IN ('trial','active','expired','cancelled')),
      plan            TEXT    NOT NULL DEFAULT 'trial',
      trial_start     TEXT    NOT NULL DEFAULT (datetime('now')),
      trial_end       TEXT    NOT NULL DEFAULT (datetime('now','+14 days')),
      plan_expires_at TEXT,
      paid_at         TEXT,
      tx_ref          TEXT,
      flw_tx_id       TEXT,
      amount_paid     REAL    NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS payments (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id  TEXT    NOT NULL,
      tx_ref       TEXT    UNIQUE NOT NULL,
      amount       REAL    NOT NULL DEFAULT 0,
      status       TEXT    NOT NULL DEFAULT 'pending',
      flw_tx_id    TEXT,
      customer_name  TEXT,
      customer_email TEXT,
      verified_at  TEXT,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS vendors (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id       INTEGER,
      telegram_id       TEXT    UNIQUE,
      name              TEXT    NOT NULL,
      email             TEXT,
      phone             TEXT,
      telegram_username TEXT,
      industry          TEXT    NOT NULL DEFAULT 'Retail',
      description       TEXT,
      location          TEXT,
      rating            REAL    NOT NULL DEFAULT 5.0,
      review_count      INTEGER NOT NULL DEFAULT 0,
      active            INTEGER NOT NULL DEFAULT 1,
      featured          INTEGER NOT NULL DEFAULT 0,
      created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    -- Add telegram_id column if upgrading existing DB
    CREATE TABLE IF NOT EXISTS _vendor_migrate_done (id INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS vendor_reviews (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_id       INTEGER NOT NULL REFERENCES vendors(id),
      reviewer_tg_id  TEXT,
      reviewer        TEXT,
      rating          INTEGER NOT NULL DEFAULT 5 CHECK(rating BETWEEN 1 AND 5),
      comment         TEXT    NOT NULL,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS vendor_listings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_id   INTEGER NOT NULL REFERENCES vendors(id),
      business_id INTEGER,
      title       TEXT    NOT NULL,
      description TEXT,
      price       REAL,
      price_label TEXT,
      category    TEXT,
      image_url   TEXT,
      available   INTEGER NOT NULL DEFAULT 1,
      views       INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS marketplace_sales (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id       INTEGER REFERENCES vendor_listings(id),
      seller_tg_id     TEXT    NOT NULL,
      buyer_tg_id      TEXT,
      buyer_name       TEXT,
      buyer_phone      TEXT,
      amount           REAL    NOT NULL DEFAULT 0,
      description      TEXT,
      seller_confirmed INTEGER NOT NULL DEFAULT 0,
      buyer_confirmed  INTEGER NOT NULL DEFAULT 0,
      status           TEXT    NOT NULL DEFAULT 'pending'
                               CHECK(status IN ('pending','seller_sent','buyer_received','completed','disputed')),
      source           TEXT    NOT NULL DEFAULT 'marketplace',
      created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      completed_at     TEXT
    );
    CREATE TABLE IF NOT EXISTS signups (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      name              TEXT    NOT NULL,
      business_name     TEXT,
      email             TEXT    UNIQUE NOT NULL,
      phone             TEXT,
      telegram_id       TEXT,
      telegram_username TEXT,
      industry          TEXT,
      plan              TEXT    NOT NULL DEFAULT 'trial',
      status            TEXT    NOT NULL DEFAULT 'pending',
      created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS user_profiles (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id     TEXT    UNIQUE,
      email           TEXT    UNIQUE,
      name            TEXT    NOT NULL,
      business_name   TEXT,
      phone           TEXT,
      industry        TEXT,
      description     TEXT,
      location        TEXT,
      logo_url        TEXT,
      verified        INTEGER NOT NULL DEFAULT 0,
      plan            TEXT    NOT NULL DEFAULT 'trial',
      plan_expires_at TEXT,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS otp_codes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT,
      phone       TEXT,
      email       TEXT,
      code        TEXT    NOT NULL,
      purpose     TEXT    NOT NULL DEFAULT 'signup',
      used        INTEGER NOT NULL DEFAULT 0,
      expires_at  TEXT    NOT NULL,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS support_tickets (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT    NOT NULL,
      subject     TEXT    NOT NULL,
      message     TEXT    NOT NULL,
      status      TEXT    NOT NULL DEFAULT 'open',
      admin_reply TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS referrals (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_tg_id  TEXT    NOT NULL,
      referred_tg_id  TEXT    UNIQUE NOT NULL,
      credited        INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS rate_limits (
      telegram_id  TEXT    NOT NULL,
      action       TEXT    NOT NULL,
      count        INTEGER NOT NULL DEFAULT 1,
      window_start TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (telegram_id, action)
    );
    CREATE TABLE IF NOT EXISTS broadcast_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      message     TEXT    NOT NULL,
      sent_count  INTEGER NOT NULL DEFAULT 0,
      fail_count  INTEGER NOT NULL DEFAULT 0,
      sent_by     TEXT    NOT NULL,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

// ── Models ────────────────────────────────────────────────────────────────────

const Business = {
  get:         (tgId)    => get("SELECT * FROM businesses WHERE telegram_id=?", [String(tgId)]),
  getOrCreate: (tgId, name) => {
    const existing = Business.get(tgId);
    if (existing) return existing;
    run("INSERT INTO businesses (telegram_id,name) VALUES (?,?)", [String(tgId), name]);
    return Business.get(tgId);
  },
  update: (id, name) => { run("UPDATE businesses SET name=? WHERE id=?", [name, id]); save(); },
};

const Products = {
  list:       (bId)      => all("SELECT * FROM products WHERE business_id=? AND active=1 ORDER BY name", [bId]),
  get:        (bId, id)  => get("SELECT * FROM products WHERE business_id=? AND id=?", [bId, id]),
  findByName: (bId, n)   => get("SELECT * FROM products WHERE business_id=? AND LOWER(name)=LOWER(?)", [bId, n]),
  add(bId, d) {
    const r = run(
      "INSERT INTO products (business_id,name,sell_price,cost_price,stock,unit,min_stock) VALUES (?,?,?,?,?,?,?)",
      [bId, d.name, d.sell_price||0, d.cost_price||0, d.stock||0, d.unit||"unit", d.min_stock||5]
    );
    save(); return r;
  },
  updateStock: (id, qty)  => { run("UPDATE products SET stock=stock+? WHERE id=?", [qty, id]); save(); },
  setStock:    (id, abs)  => { run("UPDATE products SET stock=? WHERE id=?", [abs, id]); save(); },
  lowStock:    (bId)      => all("SELECT * FROM products WHERE business_id=? AND active=1 AND stock<=min_stock ORDER BY stock ASC", [bId]),
  stockValue:  (bId)      => (get("SELECT COALESCE(SUM(stock*cost_price),0) as v FROM products WHERE business_id=? AND active=1", [bId])||{v:0}).v,
  delete:      (bId, id) => { run("UPDATE products SET active=0 WHERE business_id=? AND id=?", [bId, id]); save(); },
  topByRevenue:(bId, n=5) => all("SELECT p.name, COALESCE(SUM(s.revenue),0) as total FROM products p LEFT JOIN sales s ON s.product_id=p.id WHERE p.business_id=? GROUP BY p.id ORDER BY total DESC LIMIT ?", [bId, n]),
};

const Sales = {
  record(bId, d) {
    const revenue = (d.quantity||1) * (d.sell_price||0);
    const profit  = (d.quantity||1) * ((d.sell_price||0) - (d.cost_price||0));
    const r = run(
      "INSERT INTO sales (business_id,product_id,product_name,quantity,sell_price,cost_price,revenue,profit,customer,notes) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [bId, d.product_id||null, d.product_name, d.quantity||1, d.sell_price||0, d.cost_price||0, revenue, profit, d.customer||null, d.notes||null]
    );
    if (d.product_id) Products.updateStock(d.product_id, -(d.quantity||1));
    save();
    return { id: r.lastInsertRowid, revenue, profit };
  },
  today:      (bId) => get("SELECT COALESCE(SUM(revenue),0) as revenue, COALESCE(SUM(profit),0) as profit, COUNT(*) as count FROM sales WHERE business_id=? AND date(created_at)=date('now','localtime')", [bId]) || {revenue:0,profit:0,count:0},
  thisMonth:  (bId) => get("SELECT COALESCE(SUM(revenue),0) as revenue, COALESCE(SUM(profit),0) as profit, COUNT(*) as count FROM sales WHERE business_id=? AND strftime('%Y-%m',created_at)=strftime('%Y-%m','now')", [bId]) || {revenue:0,profit:0,count:0},
  thisWeek:   (bId) => get("SELECT COALESCE(SUM(revenue),0) as revenue, COALESCE(SUM(profit),0) as profit, COUNT(*) as count FROM sales WHERE business_id=? AND created_at>=datetime('now','-7 days')", [bId]) || {revenue:0,profit:0,count:0},
  list:       (bId, n=10) => all("SELECT * FROM sales WHERE business_id=? ORDER BY created_at DESC LIMIT ?", [bId, n]),
  topCustomers:(bId, n=5) => all("SELECT customer, COUNT(*) as visits, SUM(revenue) as total FROM sales WHERE business_id=? AND customer IS NOT NULL AND customer != '' GROUP BY customer ORDER BY total DESC LIMIT ?", [bId, n]),
  topProducts:(bId, n=5)  => all("SELECT product_name, SUM(revenue) as total_revenue, SUM(quantity) as total_qty FROM sales WHERE business_id=? GROUP BY product_name ORDER BY total_revenue DESC LIMIT ?", [bId, n]),
};

const Expenses = {
  add(bId, d) {
    const r = run("INSERT INTO expenses (business_id,description,amount,category,notes) VALUES (?,?,?,?,?)",
      [bId, d.description, d.amount||0, d.category||"General", d.notes||null]);
    save(); return r;
  },
  today:       (bId) => get("SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as count FROM expenses WHERE business_id=? AND date(created_at)=date('now','localtime')", [bId]) || {total:0,count:0},
  thisMonth:   (bId) => get("SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as count FROM expenses WHERE business_id=? AND strftime('%Y-%m',created_at)=strftime('%Y-%m','now')", [bId]) || {total:0,count:0},
  list:        (bId, n=10) => all("SELECT * FROM expenses WHERE business_id=? ORDER BY created_at DESC LIMIT ?", [bId, n]),
  byCategory:  (bId) => all("SELECT category, SUM(amount) as total FROM expenses WHERE business_id=? AND strftime('%Y-%m',created_at)=strftime('%Y-%m','now') GROUP BY category ORDER BY total DESC", [bId]),
};

const StockMovements = {
  add(bId, d) {
    const r = run("INSERT INTO stock_movements (business_id,product_id,type,quantity,notes) VALUES (?,?,?,?,?)",
      [bId, d.product_id, d.type, d.quantity, d.notes||null]);
    save(); return r;
  },
  list: (bId, n=20) => all("SELECT sm.*,p.name as product_name FROM stock_movements sm LEFT JOIN products p ON p.id=sm.product_id WHERE sm.business_id=? ORDER BY sm.created_at DESC LIMIT ?", [bId, n]),
};

const Orders = {
  create(bId, d) {
    const ref = `ORD-${Date.now().toString().slice(-6)}`;
    const r = run("INSERT INTO orders (business_id,ref,customer,items,total,notes) VALUES (?,?,?,?,?,?)",
      [bId, ref, d.customer, JSON.stringify(d.items||[]), d.total||0, d.notes||null]);
    save(); return { ...r, ref };
  },
  get:       (bId, ref) => get("SELECT * FROM orders WHERE business_id=? AND ref=?", [bId, ref]),
  getById:   (id)       => get("SELECT * FROM orders WHERE id=?", [id]),
  list:      (bId, n=10) => all("SELECT * FROM orders WHERE business_id=? ORDER BY created_at DESC LIMIT ?", [bId, n]),
  pending:   (bId)       => all("SELECT * FROM orders WHERE business_id=? AND status IN ('pending','confirmed','processing','shipped')", [bId]),
  updateStatus(id, status) { run("UPDATE orders SET status=? WHERE id=?", [status, id]); save(); },
};

const Staff = {
  list:  (bId)     => all("SELECT * FROM staff WHERE business_id=? AND active=1 ORDER BY name", [bId]),
  add(bId, d) {
    const r = run("INSERT INTO staff (business_id,name,role,salary,phone) VALUES (?,?,?,?,?)",
      [bId, d.name, d.role||"Staff", d.salary||0, d.phone||null]);
    save(); return r;
  },
};

const Payroll = {
  add(bId, d) {
    const r = run("INSERT INTO payroll (business_id,staff_id,staff_name,amount,period,notes) VALUES (?,?,?,?,?,?)",
      [bId, d.staff_id||null, d.staff_name, d.amount, d.period||new Date().toISOString().slice(0,7), d.notes||null]);
    save(); return r;
  },
  thisMonth: (bId) => get("SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as count FROM payroll WHERE business_id=? AND period=strftime('%Y-%m','now')", [bId]) || {total:0,count:0},
  list:      (bId, n=10) => all("SELECT * FROM payroll WHERE business_id=? ORDER BY paid_at DESC LIMIT ?", [bId, n]),
};

const Suppliers = {
  list: (bId)    => all("SELECT * FROM suppliers WHERE business_id=? ORDER BY name", [bId]),
  add(bId, d) {
    const r = run("INSERT INTO suppliers (business_id,name,product,phone,email,notes) VALUES (?,?,?,?,?,?)",
      [bId, d.name, d.product||null, d.phone||null, d.email||null, d.notes||null]);
    save(); return r;
  },
};

const Settings = {
  get:  (bId, key)       => get("SELECT value FROM settings WHERE business_id=? AND key=?", [bId, key])?.value || null,
  set:  (bId, key, val)  => { run("INSERT OR REPLACE INTO settings (business_id,key,value) VALUES (?,?,?)", [bId, key, String(val)]); save(); },
};

const Analytics = {
  dashboard(bId) {
    const today    = Sales.today(bId);
    const month    = Sales.thisMonth(bId);
    const expenses = Expenses.thisMonth(bId);
    const payroll  = Payroll.thisMonth(bId);
    const products = get("SELECT COUNT(*) as count FROM products WHERE business_id=? AND active=1", [bId]) || {count:0};
    const lowStock = Products.lowStock(bId).length;
    const pending  = Orders.pending(bId).length;
    const stockVal = Products.stockValue(bId);
    const netProfit = month.profit - expenses.total - payroll.total;
    return { today, month, expenses, netProfit, products, lowStock, pendingOrders: pending, stockValue: stockVal };
  },
  forAI(bId) {
    const dash     = Analytics.dashboard(bId);
    const topProds = Sales.topProducts(bId, 5);
    const recent   = Sales.list(bId, 5);
    const expCats  = Expenses.byCategory(bId);
    const lowItems = Products.lowStock(bId).slice(0, 5);
    const week     = Sales.thisWeek(bId);
    return { dashboard: dash, topProducts: topProds, recentSales: recent, expenseBreakdown: expCats, lowStockItems: lowItems, weekSummary: week };
  },
};

// ── Vendors & Marketplace ─────────────────────────────────────────────────────
const Vendors = {
  list(industry, limit=20) {
    if (industry && industry !== "All")
      return all("SELECT * FROM vendors WHERE industry=? AND active=1 ORDER BY rating DESC,review_count DESC LIMIT ?", [industry, limit]);
    return all("SELECT * FROM vendors WHERE active=1 ORDER BY rating DESC,review_count DESC LIMIT ?", [limit]);
  },
  get:         (id)    => get("SELECT * FROM vendors WHERE id=?", [id]),
  getByTgId:   (tgId)  => get("SELECT * FROM vendors WHERE telegram_id=?", [String(tgId)]),
  featured:    ()      => all("SELECT * FROM vendors WHERE active=1 ORDER BY rating DESC,review_count DESC LIMIT 8"),

  // Called when a bot user starts — creates/updates their vendor profile from Telegram data
  upsertFromBot(d) {
    const existing = d.telegram_id ? Vendors.getByTgId(d.telegram_id) : null;
    if (existing) {
      // Update name/industry/phone only if they've changed and new value is set
      run("UPDATE vendors SET name=COALESCE(?,name), phone=COALESCE(?,phone), industry=COALESCE(?,industry), telegram_username=COALESCE(?,telegram_username) WHERE id=?",
        [d.name||null, d.phone||null, d.industry||null, d.telegram_username||null, existing.id]);
      save(); return existing;
    }
    // Create new vendor from bot user
    const r = run(
      "INSERT OR IGNORE INTO vendors (telegram_id,business_id,name,email,phone,telegram_username,industry,description,location) VALUES (?,?,?,?,?,?,?,?,?)",
      [d.telegram_id||null, d.business_id||null, d.name, d.email||null, d.phone||null,
       d.telegram_username||null, d.industry||"Retail", d.description||null, d.location||null]
    );
    save(); return Vendors.getByTgId(d.telegram_id) || { id: r.lastInsertRowid };
  },

  add(d) {
    // Web signup path — email required
    const r = run(
      "INSERT OR IGNORE INTO vendors (telegram_id,business_id,name,email,phone,telegram_username,industry,description,location) VALUES (?,?,?,?,?,?,?,?,?)",
      [d.telegram_id||null, d.business_id||null, d.name, d.email||null, d.phone||null,
       d.telegram_username||null, d.industry||"Retail", d.description||null, d.location||null]
    );
    save(); return r;
  },

  update(id, fields) {
    const sets = [], vals = [];
    if (fields.name)        { sets.push("name=?");        vals.push(fields.name); }
    if (fields.industry)    { sets.push("industry=?");    vals.push(fields.industry); }
    if (fields.phone)       { sets.push("phone=?");       vals.push(fields.phone); }
    if (fields.location)    { sets.push("location=?");    vals.push(fields.location); }
    if (fields.description) { sets.push("description=?"); vals.push(fields.description); }
    if (!sets.length) return;
    vals.push(id);
    run("UPDATE vendors SET " + sets.join(",") + " WHERE id=?", vals);
    save();
  },

  reviews(vendorId) {
    return all("SELECT * FROM vendor_reviews WHERE vendor_id=? ORDER BY created_at DESC LIMIT 20", [vendorId]);
  },

  // Check if a user already reviewed this vendor
  hasReviewed(vendorId, reviewerTgId) {
    if (!reviewerTgId) return false;
    return !!get("SELECT id FROM vendor_reviews WHERE vendor_id=? AND reviewer_tg_id=?", [vendorId, String(reviewerTgId)]);
  },

  addReview(vendorId, reviewerTgId, reviewer, rating, comment) {
    // One review per user per vendor
    if (reviewerTgId && Vendors.hasReviewed(vendorId, reviewerTgId)) {
      // Update existing review instead
      run("UPDATE vendor_reviews SET rating=?,comment=? WHERE vendor_id=? AND reviewer_tg_id=?",
        [rating, comment, vendorId, String(reviewerTgId)]);
    } else {
      run("INSERT INTO vendor_reviews (vendor_id,reviewer_tg_id,reviewer,rating,comment) VALUES (?,?,?,?,?)",
        [vendorId, reviewerTgId||null, reviewer||"Anonymous", rating, comment]);
    }
    const avg = get("SELECT AVG(rating) as avg, COUNT(*) as cnt FROM vendor_reviews WHERE vendor_id=?", [vendorId]);
    run("UPDATE vendors SET rating=?,review_count=? WHERE id=?",
      [Math.round((avg?.avg||5)*10)/10, avg?.cnt||0, vendorId]);
    save();
  },
};

const VendorListings = {
  add(d) {
    const r = run("INSERT INTO vendor_listings (vendor_id,business_id,title,description,price,price_label,category,image_url) VALUES (?,?,?,?,?,?,?,?)",
      [d.vendor_id, d.business_id||null, d.title, d.description||null, d.price||null, d.price_label||null, d.category||null, d.image_url||null]);
    save(); return r;
  },
  list:    (vendorId) => all("SELECT * FROM vendor_listings WHERE vendor_id=? AND available=1 ORDER BY created_at DESC", [vendorId]),
  listAll: (limit=20) => all("SELECT vl.*,v.name as vendor_name,v.industry,v.phone,v.location FROM vendor_listings vl JOIN vendors v ON v.id=vl.vendor_id WHERE vl.available=1 ORDER BY vl.created_at DESC LIMIT ?", [limit]),
  get:     (id)       => get("SELECT vl.*,v.name as vendor_name,v.phone,v.industry FROM vendor_listings vl JOIN vendors v ON v.id=vl.vendor_id WHERE vl.id=?", [id]),
};

const MarketplaceSales = {
  create(d) {
    const r = run("INSERT INTO marketplace_sales (listing_id,seller_tg_id,buyer_tg_id,buyer_name,buyer_phone,amount,description,source) VALUES (?,?,?,?,?,?,?,?)",
      [d.listing_id||null, d.seller_tg_id, d.buyer_tg_id||null, d.buyer_name||null, d.buyer_phone||null, d.amount||0, d.description||null, d.source||"marketplace"]);
    save(); return r;
  },
  confirmSeller(id, tgId) {
    const row = get("SELECT * FROM marketplace_sales WHERE id=? AND seller_tg_id=?", [id, String(tgId)]);
    if (!row) return false;
    run("UPDATE marketplace_sales SET seller_confirmed=1,status='seller_sent' WHERE id=?", [id]);
    const updated = get("SELECT * FROM marketplace_sales WHERE id=?", [id]);
    if (updated.buyer_confirmed) run("UPDATE marketplace_sales SET status='completed',completed_at=datetime('now') WHERE id=?", [id]);
    save(); return true;
  },
  confirmBuyer(id, tgId) {
    const row = get("SELECT * FROM marketplace_sales WHERE id=?", [id]);
    if (!row) return false;
    run("UPDATE marketplace_sales SET buyer_tg_id=?,buyer_confirmed=1,status='buyer_received' WHERE id=?", [String(tgId), id]);
    const updated = get("SELECT * FROM marketplace_sales WHERE id=?", [id]);
    if (updated.seller_confirmed) run("UPDATE marketplace_sales SET status='completed',completed_at=datetime('now') WHERE id=?", [id]);
    save(); return true;
  },
  get:         (id)    => get("SELECT * FROM marketplace_sales WHERE id=?", [id]),
  listBySeller:(tgId)  => all("SELECT * FROM marketplace_sales WHERE seller_tg_id=? ORDER BY created_at DESC LIMIT 20", [String(tgId)]),
  listByBuyer: (tgId)  => all("SELECT * FROM marketplace_sales WHERE buyer_tg_id=? ORDER BY created_at DESC LIMIT 20", [String(tgId)]),
  stats(tgId) {
    const seller = get("SELECT COUNT(*) as cnt,COALESCE(SUM(amount),0) as total FROM marketplace_sales WHERE seller_tg_id=? AND status='completed'", [String(tgId)]) || {cnt:0,total:0};
    const buyer  = get("SELECT COUNT(*) as cnt FROM marketplace_sales WHERE buyer_tg_id=? AND status='completed'", [String(tgId)]) || {cnt:0};
    return { seller, buyer };
  },
};

// ── Users & Auth ──────────────────────────────────────────────────────────────
const Signups = {
  add(d) {
    const r = run("INSERT OR IGNORE INTO signups (name,business_name,email,phone,telegram_id,telegram_username,industry,plan) VALUES (?,?,?,?,?,?,?,?)",
      [d.name, d.business_name||null, d.email, d.phone||null, d.telegram_id||null, d.telegram_username||null, d.industry||null, d.plan||"trial"]);
    if (r.lastInsertRowid) Vendors.add({ name: d.business_name||d.name, email: d.email, phone: d.phone, telegram_username: d.telegram_username, industry: d.industry||"Retail" });
    save(); return r;
  },
  get:   (email) => get("SELECT * FROM signups WHERE email=?", [email]),
  list:  (limit=200) => all("SELECT * FROM signups ORDER BY created_at DESC LIMIT ?", [limit]),
  count: () => get("SELECT COUNT(*) as total, COUNT(CASE WHEN plan!='trial' THEN 1 END) as paid, COUNT(CASE WHEN plan='trial' THEN 1 END) as trial FROM signups") || {total:0,paid:0,trial:0},
};

const UserProfiles = {
  get:       (tgId)  => get("SELECT * FROM user_profiles WHERE telegram_id=?", [String(tgId)]),
  getByEmail:(email) => get("SELECT * FROM user_profiles WHERE email=?", [email]),
  upsert(d) {
    const ex = d.telegram_id ? UserProfiles.get(d.telegram_id) : UserProfiles.getByEmail(d.email);
    if (ex) run("UPDATE user_profiles SET name=COALESCE(?,name),business_name=COALESCE(?,business_name),phone=COALESCE(?,phone),industry=COALESCE(?,industry),description=COALESCE(?,description),location=COALESCE(?,location) WHERE id=?",
      [d.name||null,d.business_name||null,d.phone||null,d.industry||null,d.description||null,d.location||null,ex.id]);
    else run("INSERT INTO user_profiles (telegram_id,email,name,business_name,phone,industry,plan) VALUES (?,?,?,?,?,?,?)",
      [d.telegram_id||null,d.email||null,d.name,d.business_name||null,d.phone||null,d.industry||null,d.plan||"trial"]);
    save();
  },
  verify: (tgId) => { run("UPDATE user_profiles SET verified=1 WHERE telegram_id=?", [String(tgId)]); save(); },
};

const OTP = {
  generate(tgId, phone, email, purpose="signup") {
    const code = Math.floor(100000 + Math.random()*900000).toString();
    const exp  = new Date(Date.now() + 10*60*1000).toISOString();
    run("INSERT INTO otp_codes (telegram_id,phone,email,code,purpose,expires_at) VALUES (?,?,?,?,?,?)",
      [tgId||null, phone||null, email||null, code, purpose, exp]);
    save(); return code;
  },
  verify(tgId, code, purpose="verify") {
    const row = get("SELECT * FROM otp_codes WHERE telegram_id=? AND code=? AND purpose=? AND used=0 AND expires_at>datetime('now') ORDER BY created_at DESC LIMIT 1",
      [String(tgId), code, purpose]);
    if (!row) return false;
    run("UPDATE otp_codes SET used=1 WHERE id=?", [row.id]);
    save(); return true;
  },
};

const Tickets = {
  create(tgId, subject, message) {
    const r = run("INSERT INTO support_tickets (telegram_id,subject,message) VALUES (?,?,?)", [String(tgId), subject, message]);
    save(); return r;
  },
  get:       (id)     => get("SELECT * FROM support_tickets WHERE id=?", [id]),
  list:      (status) => status ? all("SELECT * FROM support_tickets WHERE status=? ORDER BY created_at DESC LIMIT 50", [status]) : all("SELECT * FROM support_tickets ORDER BY created_at DESC LIMIT 100"),
  listByUser:(tgId)   => all("SELECT * FROM support_tickets WHERE telegram_id=? ORDER BY created_at DESC LIMIT 10", [String(tgId)]),
  reply(id, adminReply) { run("UPDATE support_tickets SET admin_reply=?,status='resolved',updated_at=datetime('now') WHERE id=?", [adminReply, id]); save(); },
  updateStatus(id, status) { run("UPDATE support_tickets SET status=?,updated_at=datetime('now') WHERE id=?", [status, id]); save(); },
};

const Referrals = {
  create(referrerId, referredId) {
    try { const r = run("INSERT OR IGNORE INTO referrals (referrer_tg_id,referred_tg_id) VALUES (?,?)", [String(referrerId), String(referredId)]); save(); return r; } catch(_) { return null; }
  },
  stats(tgId) {
    const total    = get("SELECT COUNT(*) as c FROM referrals WHERE referrer_tg_id=?", [String(tgId)])?.c || 0;
    const credited = get("SELECT COUNT(*) as c FROM referrals WHERE referrer_tg_id=? AND credited=1", [String(tgId)])?.c || 0;
    return { total, credited, pending: total - credited };
  },
};

const RateLimit = {
  check(tgId, action, maxPerHour=20) {
    const row = get("SELECT * FROM rate_limits WHERE telegram_id=? AND action=?", [String(tgId), action]);
    const now  = Date.now();
    if (row) {
      const age = now - new Date(row.window_start).getTime();
      if (age > 3600000) { run("UPDATE rate_limits SET count=1,window_start=datetime('now') WHERE telegram_id=? AND action=?", [String(tgId), action]); return { allowed: true, remaining: maxPerHour - 1 }; }
      if (row.count >= maxPerHour) return { allowed: false, remaining: 0, resetIn: Math.ceil((3600000-age)/60000) };
      run("UPDATE rate_limits SET count=count+1 WHERE telegram_id=? AND action=?", [String(tgId), action]);
      return { allowed: true, remaining: maxPerHour - row.count - 1 };
    }
    run("INSERT OR IGNORE INTO rate_limits (telegram_id,action,count) VALUES (?,?,1)", [String(tgId), action]);
    return { allowed: true, remaining: maxPerHour - 1 };
  },
};

// Expose DB path for startup diagnostics
function getDbPath() { return DB_PATH; }

module.exports = {
  init, save, getDbPath, db: () => db,
  Business, Products, Sales, Expenses,
  StockMovements, Orders, Staff, Payroll,
  Suppliers, Analytics, Settings,
  Vendors, VendorListings, MarketplaceSales,
  Signups, UserProfiles, OTP,
  Tickets, Referrals, RateLimit,
};
