// ─────────────────────────────────────────────
//  database.js — sql.js SQLite
//  FIX 1: save() guarded — never crashes if db not ready
//  FIX 2: run/get/all throw clear error if called before init
//  FIX 3: setInterval only starts after init completes
// ─────────────────────────────────────────────
const initSqlJs = require("sql.js");
const path = require("path");
const fs = require("fs");

const DB_DIR = path.join(__dirname, "../../data");
const DB_PATH = path.join(DB_DIR, "shopboss.db");
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

let db = null; // null until init() completes
let saveTimer = null;

function init() {
  return initSqlJs().then((SqlJs) => {
    if (fs.existsSync(DB_PATH)) {
      const data = fs.readFileSync(DB_PATH);
      db = new SqlJs.Database(data);
    } else {
      db = new SqlJs.Database();
    }
    db.run("PRAGMA foreign_keys = ON;");
    createSchema();

    // FIX 3: Only start auto-save AFTER db is ready
    saveTimer = setInterval(save, 30000);
    process.on("exit", save);
    process.on("SIGINT", () => { save(); process.exit(0); });
    process.on("SIGTERM", () => { save(); process.exit(0); });

    console.log("✅ Database ready");
    // Return raw query handles so payment service can connect
    return { run, get, all };
  });
}

// FIX 1: save() is safe — does nothing if db not ready
function save() {
  if (!db) return;
  try {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (err) {
    console.error("DB save error:", err.message);
  }
}

// FIX 2: All query functions throw a clear error if called before init()
function assertReady() {
  if (!db) throw new Error("Database not initialised yet — call init() first");
}

function run(sql, params = []) {
  assertReady();
  db.run(sql, params);
  const row = db.exec("SELECT last_insert_rowid() as id");
  return { lastInsertRowid: row[0]?.values[0][0] ?? null };
}

function get(sql, params = []) {
  assertReady();
  const result = db.exec(sql, params);
  if (!result.length || !result[0].values.length) return undefined;
  const { columns, values } = result[0];
  return Object.fromEntries(columns.map((c, i) => [c, values[0][i]]));
}

function all(sql, params = []) {
  assertReady();
  const result = db.exec(sql, params);
  if (!result.length) return [];
  const { columns, values } = result[0];
  return values.map((row) => Object.fromEntries(columns.map((c, i) => [c, row[i]])));
}

function createSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS businesses (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT    UNIQUE NOT NULL,
      name        TEXT    NOT NULL DEFAULT 'My Business',
      currency    TEXT    NOT NULL DEFAULT '₦',
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS products (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL,
      name        TEXT    NOT NULL,
      sku         TEXT,
      cost_price  REAL    NOT NULL DEFAULT 0,
      sell_price  REAL    NOT NULL DEFAULT 0,
      stock       REAL    NOT NULL DEFAULT 0,
      min_stock   REAL    NOT NULL DEFAULT 5,
      unit        TEXT    NOT NULL DEFAULT 'unit',
      category    TEXT,
      active      INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sales (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id  INTEGER NOT NULL,
      product_id   INTEGER,
      product_name TEXT    NOT NULL,
      quantity     REAL    NOT NULL,
      sell_price   REAL    NOT NULL,
      cost_price   REAL    NOT NULL DEFAULT 0,
      revenue      REAL    NOT NULL,
      profit       REAL    NOT NULL DEFAULT 0,
      customer     TEXT,
      note         TEXT,
      sale_date    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS expenses (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id  INTEGER NOT NULL,
      description  TEXT    NOT NULL,
      amount       REAL    NOT NULL,
      category     TEXT    NOT NULL DEFAULT 'General',
      note         TEXT,
      expense_date TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS stock_movements (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL,
      product_id  INTEGER NOT NULL,
      type        TEXT    NOT NULL,
      quantity    REAL    NOT NULL,
      note        TEXT,
      moved_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS orders (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id      INTEGER NOT NULL,
      order_ref        TEXT    NOT NULL,
      customer         TEXT,
      items_json       TEXT    NOT NULL DEFAULT '[]',
      total            REAL    NOT NULL DEFAULT 0,
      status           TEXT    NOT NULL DEFAULT 'pending',
      delivery_address TEXT,
      note             TEXT,
      created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS staff (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL,
      name        TEXT    NOT NULL,
      role        TEXT,
      salary      REAL    NOT NULL DEFAULT 0,
      phone       TEXT,
      active      INTEGER NOT NULL DEFAULT 1,
      hired_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS payroll (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL,
      staff_id    INTEGER NOT NULL,
      staff_name  TEXT    NOT NULL,
      amount      REAL    NOT NULL,
      period      TEXT    NOT NULL,
      note        TEXT,
      paid_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS suppliers (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL,
      name        TEXT    NOT NULL,
      phone       TEXT,
      email       TEXT,
      products    TEXT,
      note        TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS vendors (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id   INTEGER,
      name          TEXT    NOT NULL,
      email         TEXT    UNIQUE NOT NULL,
      phone         TEXT,
      telegram_username TEXT,
      industry      TEXT    NOT NULL DEFAULT 'Retail',
      description   TEXT,
      location      TEXT,
      rating        REAL    NOT NULL DEFAULT 5.0,
      review_count  INTEGER NOT NULL DEFAULT 0,
      active        INTEGER NOT NULL DEFAULT 1,
      featured      INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS vendor_reviews (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_id   INTEGER NOT NULL REFERENCES vendors(id),
      reviewer    TEXT,
      rating      INTEGER NOT NULL DEFAULT 5,
      comment     TEXT    NOT NULL,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS signups (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      email      TEXT    UNIQUE NOT NULL,
      phone      TEXT,
      telegram_username TEXT,
      industry   TEXT,
      plan       TEXT    NOT NULL DEFAULT 'trial',
      status     TEXT    NOT NULL DEFAULT 'pending',
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS settings (
      business_id INTEGER NOT NULL,
      key         TEXT    NOT NULL,
      value       TEXT,
      PRIMARY KEY (business_id, key)
    );
  `);
}

// ─── Business ──────────────────────────────────────────────
const Business = {
  getOrCreate(telegramId, name = "My Business") {
    let biz = get("SELECT * FROM businesses WHERE telegram_id = ?", [String(telegramId)]);
    if (!biz) {
      run("INSERT INTO businesses (telegram_id, name) VALUES (?, ?)", [String(telegramId), name]);
      save();
      biz = get("SELECT * FROM businesses WHERE telegram_id = ?", [String(telegramId)]);
    }
    return biz;
  },
  get(telegramId) {
    return get("SELECT * FROM businesses WHERE telegram_id = ?", [String(telegramId)]);
  },
  update(id, name) {
    run("UPDATE businesses SET name = ? WHERE id = ?", [name, id]);
    save();
  },
};

// ─── Products ──────────────────────────────────────────────
const Products = {
  list(bId) {
    return all("SELECT * FROM products WHERE business_id = ? AND active = 1 ORDER BY name", [bId]);
  },
  get(bId, id) {
    return get("SELECT * FROM products WHERE id = ? AND business_id = ?", [id, bId]);
  },
  findByName(bId, name) {
    return get("SELECT * FROM products WHERE business_id = ? AND name LIKE ? AND active = 1", [bId, `%${name}%`]);
  },
  search(bId, q) {
    return all("SELECT * FROM products WHERE business_id = ? AND (name LIKE ? OR category LIKE ?) AND active = 1", [bId, `%${q}%`, `%${q}%`]);
  },
  add(bId, { name, sku, cost_price, sell_price, stock, min_stock, unit, category }) {
    const r = run(
      "INSERT INTO products (business_id,name,sku,cost_price,sell_price,stock,min_stock,unit,category) VALUES (?,?,?,?,?,?,?,?,?)",
      [bId, name, sku || null, cost_price || 0, sell_price || 0, stock || 0, min_stock || 5, unit || "unit", category || null]
    );
    save();
    return r;
  },
  updateStock(bId, id, stock) {
    run("UPDATE products SET stock = ? WHERE id = ? AND business_id = ?", [stock, id, bId]);
    save();
  },
  lowStock(bId) {
    return all("SELECT * FROM products WHERE business_id = ? AND active = 1 AND stock <= min_stock ORDER BY stock ASC", [bId]);
  },
  stockValue(bId) {
    return get("SELECT SUM(stock * cost_price) as value FROM products WHERE business_id = ? AND active = 1", [bId])?.value || 0;
  },
  delete(bId, id) {
    run("UPDATE products SET active = 0 WHERE id = ? AND business_id = ?", [id, bId]);
    save();
  },
};

// ─── Sales ─────────────────────────────────────────────────
const Sales = {
  record(bId, { product_id, product_name, quantity, sell_price, cost_price, customer, note }) {
    const revenue = quantity * sell_price;
    const profit = quantity * (sell_price - (cost_price || 0));
    const r = run(
      "INSERT INTO sales (business_id,product_id,product_name,quantity,sell_price,cost_price,revenue,profit,customer,note) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [bId, product_id || null, product_name, quantity, sell_price, cost_price || 0, revenue, profit, customer || null, note || null]
    );
    if (product_id) {
      const prod = Products.get(bId, product_id);
      if (prod) {
        Products.updateStock(bId, product_id, prod.stock - quantity);
        StockMovements.record(bId, product_id, "out", quantity, `Sale #${r.lastInsertRowid}`);
      }
    }
    save();
    return { id: r.lastInsertRowid, revenue, profit };
  },
  today(bId) {
    return get(
      "SELECT COUNT(*) as count, COALESCE(SUM(revenue),0) as revenue, COALESCE(SUM(profit),0) as profit FROM sales WHERE business_id = ? AND date(sale_date) = date('now')",
      [bId]
    ) || { count: 0, revenue: 0, profit: 0 };
  },
  thisWeek(bId) {
    return get(
      "SELECT COUNT(*) as count, COALESCE(SUM(revenue),0) as revenue, COALESCE(SUM(profit),0) as profit FROM sales WHERE business_id = ? AND sale_date >= datetime('now','-7 days')",
      [bId]
    ) || { count: 0, revenue: 0, profit: 0 };
  },
  thisMonth(bId) {
    return get(
      "SELECT COUNT(*) as count, COALESCE(SUM(revenue),0) as revenue, COALESCE(SUM(profit),0) as profit FROM sales WHERE business_id = ? AND strftime('%Y-%m',sale_date)=strftime('%Y-%m','now')",
      [bId]
    ) || { count: 0, revenue: 0, profit: 0 };
  },
  list(bId, limit = 10) {
    return all("SELECT * FROM sales WHERE business_id = ? ORDER BY sale_date DESC LIMIT ?", [bId, limit]);
  },
  topProducts(bId, limit = 5) {
    return all(
      "SELECT product_name, SUM(quantity) as total_qty, SUM(revenue) as total_revenue FROM sales WHERE business_id = ? GROUP BY product_name ORDER BY total_qty DESC LIMIT ?",
      [bId, limit]
    );
  },
};

// ─── Expenses ──────────────────────────────────────────────
const Expenses = {
  add(bId, { description, amount, category, note }) {
    const r = run(
      "INSERT INTO expenses (business_id,description,amount,category,note) VALUES (?,?,?,?,?)",
      [bId, description, amount, category || "General", note || null]
    );
    save();
    return r;
  },
  today(bId) {
    return get(
      "SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE business_id = ? AND date(expense_date)=date('now')",
      [bId]
    ) || { total: 0 };
  },
  thisMonth(bId) {
    return get(
      "SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as count FROM expenses WHERE business_id = ? AND strftime('%Y-%m',expense_date)=strftime('%Y-%m','now')",
      [bId]
    ) || { total: 0, count: 0 };
  },
  list(bId, limit = 10) {
    return all("SELECT * FROM expenses WHERE business_id = ? ORDER BY expense_date DESC LIMIT ?", [bId, limit]);
  },
  byCategory(bId) {
    return all(
      "SELECT category, SUM(amount) as total FROM expenses WHERE business_id = ? AND strftime('%Y-%m',expense_date)=strftime('%Y-%m','now') GROUP BY category ORDER BY total DESC",
      [bId]
    );
  },
};

// ─── Stock Movements ───────────────────────────────────────
const StockMovements = {
  record(bId, productId, type, quantity, note) {
    const r = run(
      "INSERT INTO stock_movements (business_id,product_id,type,quantity,note) VALUES (?,?,?,?,?)",
      [bId, productId, type, quantity, note || null]
    );
    save();
    return r;
  },
};

// ─── Orders ────────────────────────────────────────────────
const Orders = {
  create(bId, { customer, items, total, delivery_address, note }) {
    const ref = `ORD-${Date.now().toString().slice(-6)}`;
    const r = run(
      "INSERT INTO orders (business_id,order_ref,customer,items_json,total,delivery_address,note) VALUES (?,?,?,?,?,?,?)",
      [bId, ref, customer || null, JSON.stringify(items || []), total || 0, delivery_address || null, note || null]
    );
    save();
    return { id: r.lastInsertRowid, ref };
  },
  list(bId, limit = 10) {
    return all("SELECT * FROM orders WHERE business_id = ? ORDER BY created_at DESC LIMIT ?", [bId, limit]);
  },
  get(bId, id) {
    return get("SELECT * FROM orders WHERE id = ? AND business_id = ?", [id, bId]);
  },
  getByRef(bId, ref) {
    return get("SELECT * FROM orders WHERE order_ref = ? AND business_id = ?", [ref, bId]);
  },
  updateStatus(bId, id, status) {
    run("UPDATE orders SET status=?, updated_at=datetime('now') WHERE id=? AND business_id=?", [status, id, bId]);
    save();
  },
  pending(bId) {
    return all(
      "SELECT * FROM orders WHERE business_id=? AND status IN ('pending','confirmed','processing') ORDER BY created_at",
      [bId]
    );
  },
};

// ─── Staff ─────────────────────────────────────────────────
const Staff = {
  list(bId) {
    return all("SELECT * FROM staff WHERE business_id=? AND active=1 ORDER BY name", [bId]);
  },
  add(bId, { name, role, salary, phone }) {
    const r = run(
      "INSERT INTO staff (business_id,name,role,salary,phone) VALUES (?,?,?,?,?)",
      [bId, name, role || null, salary || 0, phone || null]
    );
    save();
    return r;
  },
  get(bId, id) {
    return get("SELECT * FROM staff WHERE id=? AND business_id=?", [id, bId]);
  },
};

// ─── Payroll ───────────────────────────────────────────────
const Payroll = {
  pay(bId, { staff_id, staff_name, amount, period, note }) {
    const r = run(
      "INSERT INTO payroll (business_id,staff_id,staff_name,amount,period,note) VALUES (?,?,?,?,?,?)",
      [bId, staff_id, staff_name, amount, period, note || null]
    );
    save();
    return r;
  },
  list(bId, limit = 20) {
    return all("SELECT * FROM payroll WHERE business_id=? ORDER BY paid_at DESC LIMIT ?", [bId, limit]);
  },
  thisMonth(bId) {
    return get(
      "SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as count FROM payroll WHERE business_id=? AND strftime('%Y-%m',paid_at)=strftime('%Y-%m','now')",
      [bId]
    ) || { total: 0, count: 0 };
  },
};

// ─── Suppliers ─────────────────────────────────────────────
const Suppliers = {
  list(bId) {
    return all("SELECT * FROM suppliers WHERE business_id=? ORDER BY name", [bId]);
  },
  add(bId, { name, phone, email, products, note }) {
    const r = run(
      "INSERT INTO suppliers (business_id,name,phone,email,products,note) VALUES (?,?,?,?,?,?)",
      [bId, name, phone || null, email || null, products || null, note || null]
    );
    save();
    return r;
  },
};

// ─── Analytics ─────────────────────────────────────────────
const Analytics = {
  dashboard(bId) {
    const today = Sales.today(bId);
    const month = Sales.thisMonth(bId);
    const expenses = Expenses.thisMonth(bId);
    const payroll = Payroll.thisMonth(bId);
    const productsRow = get("SELECT COUNT(*) as count FROM products WHERE business_id=? AND active=1", [bId]) || { count: 0 };
    const lowStock = Products.lowStock(bId).length;
    const pendingOrders = Orders.pending(bId).length;
    const stockValue = Products.stockValue(bId);
    const netProfit = month.profit - expenses.total - payroll.total;
    return { today, month, expenses, payroll, products: productsRow, lowStock, pendingOrders, stockValue, netProfit };
  },
  forAI(bId) {
    const dashboard = Analytics.dashboard(bId);
    const topProducts = Sales.topProducts(bId, 5);
    const recentSales = Sales.list(bId, 5);
    const expenseBreakdown = Expenses.byCategory(bId);
    const lowStockItems = Products.lowStock(bId).slice(0, 5);
    return { dashboard, topProducts, recentSales, expenseBreakdown, lowStockItems };
  },
};

// ─── Settings ──────────────────────────────────────────────
const Settings = {
  get(bId, key) {
    return get("SELECT value FROM settings WHERE business_id=? AND key=?", [bId, key])?.value ?? null;
  },
  set(bId, key, value) {
    run("INSERT OR REPLACE INTO settings (business_id,key,value) VALUES (?,?,?)", [bId, key, String(value)]);
    save();
  },
};

// ─── Vendors ────────────────────────────────────────────────
const Vendors = {
  list(industry, limit = 20) {
    if (industry && industry !== 'All') {
      return all("SELECT * FROM vendors WHERE industry = ? AND active = 1 ORDER BY rating DESC, review_count DESC LIMIT ?", [industry, limit]);
    }
    return all("SELECT * FROM vendors WHERE active = 1 ORDER BY rating DESC, review_count DESC LIMIT ?", [limit]);
  },
  get(id) { return get("SELECT * FROM vendors WHERE id = ?", [id]); },
  add(data) {
    const r = run(
      "INSERT OR IGNORE INTO vendors (business_id,name,email,phone,telegram_username,industry,description,location) VALUES (?,?,?,?,?,?,?,?)",
      [data.business_id||null, data.name, data.email, data.phone||null, data.telegram_username||null, data.industry||'Retail', data.description||null, data.location||null]
    );
    save(); return r;
  },
  featured() {
    return all("SELECT * FROM vendors WHERE active = 1 ORDER BY rating DESC LIMIT 6");
  },
  reviews(vendorId) {
    return all("SELECT * FROM vendor_reviews WHERE vendor_id = ? ORDER BY created_at DESC LIMIT 10", [vendorId]);
  },
  addReview(vendorId, reviewer, rating, comment) {
    run("INSERT INTO vendor_reviews (vendor_id,reviewer,rating,comment) VALUES (?,?,?,?)", [vendorId, reviewer, rating, comment]);
    const avg = get("SELECT AVG(rating) as avg, COUNT(*) as cnt FROM vendor_reviews WHERE vendor_id = ?", [vendorId]);
    run("UPDATE vendors SET rating = ?, review_count = ? WHERE id = ?", [Math.round((avg?.avg||5)*10)/10, avg?.cnt||0, vendorId]);
    save();
  },
};

// ─── Signups ─────────────────────────────────────────────────
const Signups = {
  add(data) {
    const r = run(
      "INSERT OR IGNORE INTO signups (name,email,phone,telegram_username,industry,plan) VALUES (?,?,?,?,?,?)",
      [data.name, data.email, data.phone||null, data.telegram_username||null, data.industry||null, data.plan||'trial']
    );
    // Auto-create vendor profile
    if (r.lastInsertRowid) {
      Vendors.add({ name: data.name, email: data.email, phone: data.phone, telegram_username: data.telegram_username, industry: data.industry || 'Retail' });
    }
    save(); return r;
  },
  get(email) { return get("SELECT * FROM signups WHERE email = ?", [email]); },
  list(limit = 100) { return all("SELECT * FROM signups ORDER BY created_at DESC LIMIT ?", [limit]); },
};

module.exports = {
  init, save,
  Business, Products, Sales, Expenses,
  StockMovements, Orders, Staff, Payroll,
  Suppliers, Analytics, Settings, Vendors, Signups,
};
