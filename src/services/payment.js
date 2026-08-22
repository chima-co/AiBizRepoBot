// ─────────────────────────────────────────────
//  payment.js — Flutterwave payment + license system
//  One-time payment of ₦999,999 for lifetime access
// ─────────────────────────────────────────────
const axios = require("axios");

const FLW_SECRET  = process.env.FLW_SECRET_KEY;
const FLW_PUBLIC  = process.env.FLW_PUBLIC_KEY;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const TRIAL_DAYS  = 14;

const PLANS = {
  trial:    { price: 0,      label: "Free Trial",       days: 14,   description: "14-day free trial" },
  monthly:  { price: 9500,   label: "Monthly",          days: 30,   description: "Monthly subscription — ₦9,500/month" },
  yearly:   { price: 90000,  label: "Yearly",           days: 365,  description: "Annual subscription — ₦90,000/year" },
  lifetime: { price: 999999, label: "Lifetime Access",  days: null, description: "Lifetime access — pay once, never again" },
};
// keep PRICE for backward compat
const PRICE = PLANS.lifetime.price; // Beta testing period

// ─── License DB helpers (injected after DB init) ──────────
let db_run, db_get, db_all;

function connectDB({ run, get, all }) {
  db_run = run;
  db_get = get;
  db_all = all;

  // Create payments + licenses tables
  db_run(`
    CREATE TABLE IF NOT EXISTS licenses (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id   TEXT    UNIQUE NOT NULL,
      status        TEXT    NOT NULL DEFAULT 'trial'
                            CHECK(status IN ('trial','active','expired','cancelled')),
      trial_start   TEXT    NOT NULL DEFAULT (datetime('now')),
      trial_end     TEXT    NOT NULL DEFAULT (datetime('now', '+7 days')),
      paid_at       TEXT,
      tx_ref        TEXT,
      flw_tx_id     TEXT,
      amount_paid   REAL,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS payments (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id   TEXT    NOT NULL,
      tx_ref        TEXT    UNIQUE NOT NULL,
      flw_tx_id     TEXT,
      amount        REAL    NOT NULL,
      status        TEXT    NOT NULL DEFAULT 'pending'
                            CHECK(status IN ('pending','success','failed')),
      customer_name TEXT,
      customer_email TEXT,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      verified_at   TEXT
    );
  `);
}

// ─── License checks ───────────────────────────────────────

function getLicense(telegramId) {
  return db_get("SELECT * FROM licenses WHERE telegram_id = ?", [String(telegramId)]);
}

function createTrial(telegramId) {
  const existing = getLicense(telegramId);
  if (existing) return existing;
  db_run(
    "INSERT INTO licenses (telegram_id, status) VALUES (?, 'trial')",
    [String(telegramId)]
  );
  return getLicense(telegramId);
}

/**
 * Returns access status for a user:
 * { allowed: true/false, status: 'trial'|'active'|'expired', daysLeft: N }
 */
function checkAccess(telegramId) {
  const lic = getLicense(telegramId);
  if (!lic) {
    createTrial(telegramId);
    return { allowed: true, status: "trial", daysLeft: TRIAL_DAYS, plan: "trial" };
  }

  // Lifetime — never expires
  if (lic.status === "active" && lic.plan === "lifetime") {
    return { allowed: true, status: "active", daysLeft: null, plan: "lifetime" };
  }

  // Monthly / Yearly — check expiry
  if (lic.status === "active" && ["monthly","yearly"].includes(lic.plan)) {
    if (!lic.plan_expires_at) return { allowed: true, status: "active", daysLeft: null, plan: lic.plan };
    const daysLeft = Math.ceil((new Date(lic.plan_expires_at) - Date.now()) / 86400000);
    if (daysLeft > 0) return { allowed: true, status: "active", daysLeft, plan: lic.plan };
    db_run("UPDATE licenses SET status='expired' WHERE telegram_id=?", [String(telegramId)]);
    return { allowed: false, status: "expired", daysLeft: 0, plan: lic.plan };
  }

  // Trial
  if (lic.status === "trial") {
    const daysLeft = Math.ceil((new Date(lic.trial_end) - Date.now()) / 86400000);
    if (daysLeft > 0) return { allowed: true, status: "trial", daysLeft, plan: "trial" };
    db_run("UPDATE licenses SET status='expired' WHERE telegram_id=?", [String(telegramId)]);
    return { allowed: false, status: "expired", daysLeft: 0, plan: "trial" };
  }

  return { allowed: false, status: lic.status, daysLeft: 0, plan: lic.plan || "trial" };
}

function activateLicense(telegramId, txRef, flwTxId, amountPaid, plan) {
  // Determine plan from amount if not specified
  if (!plan) {
    if (amountPaid >= 299000) plan = "lifetime";
    else if (amountPaid >= 85000) plan = "yearly";
    else plan = "monthly";
  }
  const planConfig = PLANS[plan] || PLANS.lifetime;
  const expiresAt = planConfig.days
    ? new Date(Date.now() + planConfig.days * 86400000).toISOString()
    : null;

  db_run(`
    INSERT INTO licenses (telegram_id, status, plan, plan_expires_at, paid_at, tx_ref, flw_tx_id, amount_paid)
    VALUES (?, 'active', ?, ?, datetime('now'), ?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      status='active', plan=excluded.plan, plan_expires_at=excluded.plan_expires_at,
      paid_at=datetime('now'), tx_ref=excluded.tx_ref,
      flw_tx_id=excluded.flw_tx_id, amount_paid=excluded.amount_paid
  `, [String(telegramId), plan, expiresAt, txRef, flwTxId, amountPaid]);
}

// ─── Flutterwave payment link generator ──────────────────

function generateTxRef(telegramId) {
  return `SB-${telegramId}-${Date.now()}`;
}

async function createPaymentLink(telegramId, customerName, customerEmail, customerPhone) {
  const txRef = generateTxRef(telegramId);

  // Save pending payment record
  db_run(
    "INSERT OR IGNORE INTO payments (telegram_id, tx_ref, amount, customer_name, customer_email) VALUES (?,?,?,?,?)",
    [String(telegramId), txRef, PRICE, customerName, customerEmail]
  );

  const payload = {
    tx_ref: txRef,
    amount: PRICE,
    currency: "NGN",
    redirect_url: `${WEBHOOK_URL}/payment/callback`,
    customer: {
      email: customerEmail,
      phonenumber: customerPhone,
      name: customerName,
    },
    customizations: {
      title: "ShopBoss Lifetime Access",
      description: "One-time payment for full lifetime access to ShopBoss AI Business Manager",
      logo: `${WEBHOOK_URL}/logo.png`,
    },
    payment_options: "card,banktransfer,ussd",
    meta: {
      telegram_id: String(telegramId),
      product: "ShopBoss Lifetime",
    },
  };

  const res = await axios.post(
    "https://api.flutterwave.com/v3/payments",
    payload,
    { headers: { Authorization: `Bearer ${FLW_SECRET}` } }
  );

  if (res.data.status !== "success") {
    throw new Error("Flutterwave payment link creation failed: " + res.data.message);
  }

  return { link: res.data.data.link, txRef };
}

// ─── Verify payment with Flutterwave ─────────────────────

async function verifyPayment(txRef) {
  const res = await axios.get(
    `https://api.flutterwave.com/v3/transactions?tx_ref=${txRef}`,
    { headers: { Authorization: `Bearer ${FLW_SECRET}` } }
  );

  const txList = res.data.data;
  if (!txList || txList.length === 0) return null;

  const tx = txList[0];
  return {
    status: tx.status,          // "successful" | "failed" | "pending"
    amount: tx.amount,
    currency: tx.currency,
    flwTxId: tx.id,
    customerName: tx.customer?.name,
    customerEmail: tx.customer?.email,
    meta: tx.meta,
    telegramId: tx.meta?.telegram_id,
  };
}

// ─── Handle Flutterwave webhook event ────────────────────

async function handleWebhookEvent(event, bot) {
  if (event["event.type"] !== "PAYMENT" && event.event !== "charge.completed") return;

  const txRef = event.data?.tx_ref || event.txRef;
  if (!txRef) return;

  // Verify with Flutterwave API (don't trust webhook payload alone)
  const tx = await verifyPayment(txRef);
  if (!tx || tx.status !== "successful") return;
  if (tx.amount < PRICE || tx.currency !== "NGN") {
    console.warn(`⚠️ Payment ${txRef} amount mismatch: got ${tx.amount}`);
    return;
  }

  const telegramId = tx.telegramId || tx.meta?.telegram_id;
  if (!telegramId) return;

  // Update payment record
  db_run(`
    UPDATE payments SET status='success', flw_tx_id=?, verified_at=datetime('now')
    WHERE tx_ref=?
  `, [String(tx.flwTxId), txRef]);

  // Activate license
  activateLicense(telegramId, txRef, String(tx.flwTxId), tx.amount);

  console.log(`✅ License activated for Telegram ID: ${telegramId} | Ref: ${txRef}`);

  // Notify user in bot
  try {
    await bot.telegram.sendMessage(
      telegramId,
      `🎉 *Payment Confirmed! Welcome to ShopBoss!*\n\n` +
      `✅ Amount: ₦${Number(tx.amount).toLocaleString("en-NG")}\n` +
      `📋 Reference: \`${txRef}\`\n` +
      `🔑 Access: *Lifetime — never expires*\n\n` +
      `You now have full access to all ShopBoss features.\n\n` +
      `Tap /start to begin managing your business! 🚀`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    console.error("Could not notify user after payment:", err.message);
  }
}

// ─── Admin helpers ────────────────────────────────────────

function getAllLicenses() {
  return db_all("SELECT * FROM licenses ORDER BY created_at DESC");
}

function getStats() {
  const total     = db_get("SELECT COUNT(*) as c FROM licenses")?.c || 0;
  const active    = db_get("SELECT COUNT(*) as c FROM licenses WHERE status='active'")?.c || 0;
  const trial     = db_get("SELECT COUNT(*) as c FROM licenses WHERE status='trial'")?.c || 0;
  const expired   = db_get("SELECT COUNT(*) as c FROM licenses WHERE status='expired'")?.c || 0;
  const revenue   = db_get("SELECT COALESCE(SUM(amount_paid),0) as r FROM licenses WHERE status='active'")?.r || 0;
  return { total, active, trial, expired, revenue };
}

module.exports = {
  connectDB,
  checkAccess,
  createTrial,
  getLicense,
  activateLicense,
  createPaymentLink, PLANS,
  verifyPayment,
  handleWebhookEvent,
  getAllLicenses,
  getStats,
  PRICE,
  TRIAL_DAYS,
};
