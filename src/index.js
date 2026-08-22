// ─────────────────────────────────────────────────────────────────────────────
//  index.js — ShopBoss entry point (clean single-file bootstrap)
// ─────────────────────────────────────────────────────────────────────────────
require("dotenv").config();

if (!process.env.BOT_TOKEN) {
  console.error("❌ BOT_TOKEN is not set in Railway Variables. Go to Railway → your service → Variables and add BOT_TOKEN.");
  process.exit(1);
}
// Validate WEBHOOK_URL format early
if (process.env.WEBHOOK_URL) {
  const wurl = process.env.WEBHOOK_URL;
  if (!wurl.startsWith("https://")) {
    console.error("❌ WEBHOOK_URL must start with https:// — current value:", wurl);
    process.exit(1);
  }
  if (wurl.endsWith("/")) {
    console.warn("⚠️  WEBHOOK_URL has a trailing slash — it will be stripped automatically.");
  }
}

const { Telegraf, session, Markup } = require("telegraf");
const express = require("express");
const crypto  = require("crypto");
const path    = require("path");
const { init } = require("./db/database");

// ── Admin HTML (static helpers, no env vars exposed) ─────────────────────────
function adminLoginPage() {
  return `<!DOCTYPE html><html><head><title>ShopBoss Admin</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#080c14;color:#eef1f8;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
.box{background:#111827;border:1px solid #1e2d44;border-radius:16px;padding:44px;width:100%;max-width:380px;text-align:center}
.logo{font-size:36px;margin-bottom:8px}.title{color:#f0b429;font-size:22px;font-weight:800;margin-bottom:8px}
.sub{font-size:13px;color:#8896b0;margin-bottom:28px}
input{width:100%;background:#141c2e;border:1.5px solid #1e2d44;border-radius:10px;padding:13px;color:#eef1f8;font-size:16px;outline:none;margin-bottom:14px;text-align:center}
input:focus{border-color:#f0b429}
button{width:100%;background:linear-gradient(135deg,#f0b429,#c8931f);color:#111;border:none;border-radius:10px;padding:14px;font-weight:800;font-size:15px;cursor:pointer}
</style></head><body>
<div class="box">
<div class="logo">🔐</div>
<div class="title">ShopBoss Admin</div>
<div class="sub">Enter your admin key to access the control panel</div>
<form onsubmit="go(event)">
<input id="k" type="password" placeholder="Admin key" autocomplete="current-password"/>
<button type="submit">Access Dashboard →</button>
</form></div>
<script>function go(e){e.preventDefault();const k=document.getElementById('k').value.trim();if(k)window.location='/admin?key='+encodeURIComponent(k);}</script>
</body></html>`;
}

function adminDashboard(stats, signups, vendors, licStats, key) {
  const rows = signups.map(s => `<tr>
    <td>${s.id}</td><td><strong>${s.name||""}</strong></td><td>${s.business_name||"—"}</td>
    <td>${s.email}</td><td>${s.phone||"—"}</td><td>${s.industry||"—"}</td>
    <td><span class="badge b-${s.plan==="lifetime"?"green":s.plan==="monthly"||s.plan==="yearly"?"blue":"gold"}">${s.plan}</span></td>
    <td>${new Date(s.created_at).toLocaleDateString("en-NG")}</td></tr>`).join("");

  const vendorRows = vendors.slice(0,100).map(v => `<tr>
    <td>${v.id}</td><td><strong>${v.name}</strong></td><td>${v.industry}</td>
    <td>${v.location||"—"}</td><td>${v.phone||"—"}</td>
    <td><span style="color:#f0b429">★ ${v.rating}</span> (${v.review_count})</td></tr>`).join("");

  const conv = stats.total > 0 ? ((licStats.active / stats.total)*100).toFixed(1) : "0";
  const mrr  = (licStats.active * 9500).toLocaleString("en-NG");

  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>ShopBoss Admin Console</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#080c14;--panel:#111827;--card:#141c2e;--rim:#1e2d44;--gold:#f0b429;--green:#10b981;--red:#f43f5e;--blue:#3b82f6;--text:#eef1f8;--sub:#8896b0;--dim:#3d5270}
body{background:var(--bg);color:var(--text);font-family:-apple-system,"Inter",sans-serif;font-size:14px;min-height:100vh}
.topbar{background:var(--panel);border-bottom:1px solid var(--rim);height:60px;display:flex;align-items:center;justify-content:space-between;padding:0 28px;position:sticky;top:0;z-index:100}
.brand{display:flex;align-items:center;gap:10px;font-size:17px;font-weight:800;color:var(--gold)}
.brand .dot{width:9px;height:9px;border-radius:50%;background:var(--green);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.bar-right{display:flex;gap:10px}
.btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:8px;font-weight:700;font-size:13px;text-decoration:none;cursor:pointer;border:none;transition:all .15s}
.btn-gold{background:var(--gold);color:#111}.btn-ghost{background:transparent;color:var(--text);border:1.5px solid var(--rim)}
.btn-ghost:hover{border-color:var(--gold);color:var(--gold)}
.layout{display:flex;min-height:calc(100vh - 60px)}
.sidebar{width:210px;background:var(--panel);border-right:1px solid var(--rim);padding:16px 0;flex-shrink:0;position:sticky;top:60px;height:calc(100vh - 60px);overflow-y:auto}
.sec-label{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:var(--dim);padding:14px 18px 4px}
.nav-btn{display:block;width:100%;text-align:left;padding:10px 18px;background:none;border:none;border-left:3px solid transparent;color:var(--sub);font-size:13px;font-weight:600;cursor:pointer;transition:all .15s}
.nav-btn:hover{color:var(--text);background:rgba(255,255,255,.02)}
.nav-btn.on{color:var(--gold);border-left-color:var(--gold);background:rgba(240,180,41,.05)}
.main{flex:1;padding:28px;overflow:auto}
.tab{display:none}.tab.on{display:block}
.kpi-row{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px;margin-bottom:28px}
.kpi{background:var(--panel);border:1px solid var(--rim);border-radius:12px;padding:22px 18px}
.kv{font-size:32px;font-weight:800;color:var(--gold);letter-spacing:-1.5px;line-height:1}
.kl{font-size:10px;color:var(--sub);margin-top:5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px}
.ks{font-size:12px;color:var(--dim);margin-top:2px}
.sec-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.sec-hdr h2{font-size:14px;font-weight:800;color:var(--gold);text-transform:uppercase;letter-spacing:.5px}
.tbl-box{background:var(--panel);border:1px solid var(--rim);border-radius:12px;overflow:auto;margin-bottom:24px}
table{width:100%;border-collapse:collapse;min-width:600px}
th{background:var(--card);padding:10px 14px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:var(--sub);font-weight:800;white-space:nowrap}
td{padding:10px 14px;border-bottom:1px solid var(--rim);font-size:13px;vertical-align:middle}
tr:last-child td{border-bottom:none}
tr:hover td{background:rgba(255,255,255,.015)}
.badge{font-size:10px;font-weight:800;padding:3px 9px;border-radius:99px}
.b-green{background:rgba(16,185,129,.15);color:var(--green)}.b-gold{background:rgba(240,180,41,.15);color:var(--gold)}.b-blue{background:rgba(59,130,246,.15);color:#60a5fa}.b-red{background:rgba(244,63,94,.15);color:var(--red)}
.action-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px}
.action-card{background:var(--panel);border:1px solid var(--rim);border-radius:12px;padding:22px}
.action-card h3{font-size:14px;font-weight:800;margin-bottom:14px;color:var(--gold)}
.fi{width:100%;background:var(--card);border:1.5px solid var(--rim);border-radius:8px;padding:10px 12px;color:var(--text);font-size:14px;font-family:inherit;outline:none;margin-bottom:8px;-webkit-appearance:none}
.fi:focus{border-color:var(--gold)} textarea.fi{resize:vertical;min-height:90px}
.hlth{display:flex;align-items:center;justify-content:space-between;padding:13px 0;border-bottom:1px solid var(--rim)}
.hlth:last-child{border-bottom:none}
.hdot{width:10px;height:10px;border-radius:50%}.h-ok{background:var(--green)}.h-bad{background:var(--red)}.h-warn{background:var(--gold)}
.toast{position:fixed;bottom:24px;right:24px;padding:12px 20px;border-radius:10px;font-weight:700;font-size:13px;opacity:0;transition:opacity .3s;pointer-events:none;z-index:9999;color:#fff}
.toast.show{opacity:1}
.search-bar{margin-bottom:14px}
.search-bar input{width:100%;max-width:360px;background:var(--card);border:1.5px solid var(--rim);border-radius:8px;padding:10px 14px;color:var(--text);font-size:14px;outline:none}
.search-bar input:focus{border-color:var(--gold)}
@media(max-width:768px){.sidebar{display:none}.action-grid{grid-template-columns:1fr}.kpi-row{grid-template-columns:1fr 1fr}}
</style></head><body>

<div class="topbar">
  <div class="brand"><span class="dot"></span>ShopBoss Admin</div>
  <div class="bar-right">
    <a href="/admin/export?key=ADMINKEY" class="btn btn-ghost">⬇ Export CSV</a>
    <a href="https://t.me/AiBizRepoBot" target="_blank" class="btn btn-gold">Open Bot →</a>
  </div>
</div>

<div class="layout">
  <nav class="sidebar">
    <div class="sec-label">Overview</div>
    <button class="nav-btn on" onclick="show('overview',this)">📊 Dashboard</button>
    <button class="nav-btn" onclick="show('revenue',this)">💰 Revenue</button>
    <div class="sec-label">Users</div>
    <button class="nav-btn" onclick="show('users',this)">👥 All Signups</button>
    <button class="nav-btn" onclick="show('vendors',this)">🏪 Vendors</button>
    <div class="sec-label">Tools</div>
    <button class="nav-btn" onclick="show('broadcast',this)">📢 Broadcast</button>
    <button class="nav-btn" onclick="show('actions',this)">⚡ User Actions</button>
    <div class="sec-label">System</div>
    <button class="nav-btn" onclick="show('health',this)">🏥 Health Check</button>
  </nav>

  <div class="main">

    <div class="tab on" id="t-overview">
      <div class="kpi-row">
        <div class="kpi"><div class="kv">${stats.total}</div><div class="kl">Total Signups</div><div class="ks">${stats.trial} on trial</div></div>
        <div class="kpi"><div class="kv" style="color:var(--green)">${licStats.active}</div><div class="kl">Paying Users</div><div class="ks">${conv}% conversion</div></div>
        <div class="kpi"><div class="kv">${vendors.length}</div><div class="kl">Active Vendors</div></div>
        <div class="kpi"><div class="kv" style="color:var(--green)">&#x20A6;${Number(licStats.revenue||0).toLocaleString("en-NG")}</div><div class="kl">Total Revenue</div></div>
        <div class="kpi"><div class="kv" style="color:#60a5fa">&#x20A6;${mrr}</div><div class="kl">Est. MRR</div><div class="ks">active × ₦9,500</div></div>
        <div class="kpi"><div class="kv">${licStats.expired||0}</div><div class="kl">Churned</div></div>
      </div>
      <div class="sec-hdr"><h2>📋 Recent Signups</h2></div>
      <div class="tbl-box"><table>
        <thead><tr><th>#</th><th>Name</th><th>Business</th><th>Email</th><th>Phone</th><th>Industry</th><th>Plan</th><th>Date</th></tr></thead>
        <tbody>${rows||'<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--sub)">No signups yet</td></tr>'}</tbody>
      </table></div>
    </div>

    <div class="tab" id="t-revenue">
      <div class="kpi-row">
        <div class="kpi"><div class="kv">&#x20A6;${Number(licStats.revenue||0).toLocaleString("en-NG")}</div><div class="kl">Total Collected</div></div>
        <div class="kpi"><div class="kv">&#x20A6;${mrr}</div><div class="kl">Est. MRR</div></div>
        <div class="kpi"><div class="kv">${conv}%</div><div class="kl">Conversion Rate</div><div class="ks">Trial → Paid</div></div>
        <div class="kpi"><div class="kv">&#x20A6;${licStats.active>0?Number((licStats.revenue||0)/licStats.active).toLocaleString("en-NG"):"0"}</div><div class="kl">Avg. Per User</div></div>
      </div>
      <div class="action-card" style="max-width:480px">
        <h3>Plan Pricing</h3>
        <table style="border:none"><thead><tr><th>Plan</th><th>Price</th><th>Duration</th></tr></thead><tbody>
        <tr><td>Monthly</td><td>₦9,500</td><td>30 days</td></tr>
        <tr><td>Yearly</td><td>₦90,000</td><td>365 days</td></tr>
        <tr><td>Lifetime</td><td>₦999,999</td><td>Forever</td></tr>
        </tbody></table>
      </div>
    </div>

    <div class="tab" id="t-users">
      <div class="sec-hdr"><h2>👥 All Signups (${signups.length})</h2><a href="/admin/export?key=ADMINKEY" class="btn btn-gold">⬇ Export CSV</a></div>
      <div class="search-bar"><input type="text" placeholder="Search by name, email, industry…" oninput="filterTable(this,'users-tbl')"/></div>
      <div class="tbl-box"><table id="users-tbl">
        <thead><tr><th>#</th><th>Name</th><th>Business</th><th>Email</th><th>Phone</th><th>Industry</th><th>Plan</th><th>Date</th></tr></thead>
        <tbody>${rows||'<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--sub)">No users yet</td></tr>'}</tbody>
      </table></div>
    </div>

    <div class="tab" id="t-vendors">
      <div class="sec-hdr"><h2>🏪 Active Vendors (${vendors.length})</h2></div>
      <div class="tbl-box"><table>
        <thead><tr><th>#</th><th>Business</th><th>Industry</th><th>Location</th><th>Phone</th><th>Rating</th></tr></thead>
        <tbody>${vendorRows||'<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--sub)">No vendors yet</td></tr>'}</tbody>
      </table></div>
    </div>

    <div class="tab" id="t-broadcast">
      <div class="action-grid" style="grid-template-columns:1fr">
        <div class="action-card">
          <h3>📢 Broadcast Message</h3>
          <p style="font-size:13px;color:var(--sub);margin-bottom:14px">Sends to all ${signups.filter(s=>s.telegram_id).length} users with a Telegram ID.</p>
          <textarea class="fi" id="bc-msg" placeholder="Type your message…"></textarea>
          <button class="btn btn-gold" style="width:100%" onclick="broadcast()">Send Broadcast</button>
        </div>
      </div>
    </div>

    <div class="tab" id="t-actions">
      <div class="action-grid">
        <div class="action-card">
          <h3>✅ Grant Plan</h3>
          <label style="font-size:11px;font-weight:700;color:var(--sub);text-transform:uppercase;display:block;margin-bottom:5px">Telegram ID</label>
          <input class="fi" id="g-tgid" placeholder="e.g. 1234567890"/>
          <label style="font-size:11px;font-weight:700;color:var(--sub);text-transform:uppercase;display:block;margin-bottom:5px">Plan</label>
          <select class="fi" id="g-plan"><option value="monthly">Monthly — ₦9,500</option><option value="yearly">Yearly — ₦90,000</option><option value="lifetime">Lifetime — ₦999,999</option></select>
          <button class="btn btn-gold" style="width:100%;margin-top:4px" onclick="grantPlan()">Grant Plan</button>
        </div>
        <div class="action-card">
          <h3>🚫 Suspend User</h3>
          <label style="font-size:11px;font-weight:700;color:var(--sub);text-transform:uppercase;display:block;margin-bottom:5px">Telegram ID</label>
          <input class="fi" id="s-tgid" placeholder="e.g. 1234567890"/>
          <button class="btn" style="width:100%;margin-top:4px;background:rgba(244,63,94,.15);color:var(--red);border:1px solid rgba(244,63,94,.3)" onclick="suspendUser()">Suspend User</button>
        </div>
      </div>
      <div class="action-card" style="max-width:360px">
        <h3>🔑 Admin Key</h3>
        <p style="font-size:13px;color:var(--sub);margin-bottom:14px">Your admin key for the bot commands and this console.</p>
        <button class="btn btn-ghost" style="width:100%" onclick="copyKey()">📋 Copy Admin Key</button>
      </div>
    </div>

    <div class="tab" id="t-health">
      <div class="action-card" style="max-width:480px">
        <h3>🏥 System Health</h3>
        <div class="hlth"><div style="display:flex;align-items:center;gap:10px"><div class="hdot h-ok"></div>Bot Server</div><span style="color:var(--green);font-weight:700">✅ Running</span></div>
        <div class="hlth"><div style="display:flex;align-items:center;gap:10px"><div class="hdot AICLASS"></div>AI (Anthropic)</div><span style="color:AICOLOR;font-weight:700">AISTATUS</span></div>
        <div class="hlth"><div style="display:flex;align-items:center;gap:10px"><div class="hdot FLWCLASS"></div>Flutterwave</div><span style="color:FLWCOLOR;font-weight:700">FLWSTATUS</span></div>
        <div class="hlth"><div style="display:flex;align-items:center;gap:10px"><div class="hdot h-ok"></div>Database</div><span style="color:var(--green);font-weight:700">✅ Active</span></div>
        <div class="hlth" style="border:none"><div style="display:flex;align-items:center;gap:10px"><div class="hdot h-ok"></div>Webhook</div><span style="color:var(--sub);font-size:12px;word-break:break-all">WEBHOOKURL</span></div>
      </div>
    </div>

  </div>
</div>

<div class="toast" id="toast"></div>

<script>
const ADMINKEY = 'ADMINKEY';
function show(tab, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('on'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('on'));
  document.getElementById('t-' + tab).classList.add('on');
  btn.classList.add('on');
}
function toast(msg, ok=true) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.style.background = ok ? '#10b981' : '#f43f5e';
  t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2800);
}
function filterTable(inp, tableId) {
  const q = inp.value.toLowerCase();
  document.querySelectorAll('#'+tableId+' tbody tr').forEach(r => {
    r.style.display = r.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}
async function broadcast() {
  const msg = document.getElementById('bc-msg').value.trim();
  if (!msg) return toast('Enter a message first', false);
  if (!confirm('Send to ALL users?')) return;
  const r = await fetch('/admin/broadcast?key=' + ADMINKEY, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({message:msg}) });
  const d = await r.json();
  toast(d.ok ? 'Broadcast sent to ' + d.sent + ' users!' : (d.error||'Failed'), d.ok);
}
async function grantPlan() {
  const tgid = document.getElementById('g-tgid').value.trim();
  const plan  = document.getElementById('g-plan').value;
  if (!tgid) return toast('Enter Telegram ID', false);
  const r = await fetch('/admin/grant?key=' + ADMINKEY, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({telegram_id:tgid,plan}) });
  const d = await r.json();
  toast(d.ok ? 'Plan granted!' : (d.error||'Failed'), d.ok);
}
async function suspendUser() {
  const tgid = document.getElementById('s-tgid').value.trim();
  if (!tgid) return toast('Enter Telegram ID', false);
  if (!confirm('Suspend this user?')) return;
  const r = await fetch('/admin/suspend?key=' + ADMINKEY, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({telegram_id:tgid}) });
  const d = await r.json();
  toast(d.ok ? 'User suspended' : (d.error||'Failed'), d.ok);
}
function copyKey() {
  navigator.clipboard.writeText(ADMINKEY).then(() => toast('Admin key copied!')).catch(() => toast('Copy failed', false));
}
</script>
</body></html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  BOOT
// ─────────────────────────────────────────────────────────────────────────────
// ── FIX 3 & 4: Global crash guards — prevent Railway silent exits ─────────────
process.on("uncaughtException", (err) => {
  console.error("💥 UNCAUGHT EXCEPTION — bot will continue running:");
  console.error("   Name:", err.name);
  console.error("   Message:", err.message);
  console.error("   Stack:", err.stack);
  // Don't exit — Railway should stay up
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("💥 UNHANDLED PROMISE REJECTION:");
  console.error("   Reason:", reason);
  console.error("   Promise:", promise);
  // Don't exit — log and continue
});

init().then(async (dbHandles) => {

  const db = require("./db/database");
  // db is already initialised — init() ran above and returned dbHandles
  require("./services/payment").connectDB(dbHandles);

  // ── Bot ────────────────────────────────────────────────────────────────────
  const bot = new Telegraf(process.env.BOT_TOKEN);
  global._shopboss_bot = bot;

  // FIX 5: Use LocalSession so user flows survive Railway restarts
  // Falls back to in-memory if telegraf/sessions not available
  let sessionMiddleware;
  try {
    const { LocalSession } = require("telegraf-session-local");
    const localSession = new LocalSession({
      database: require("path").join(__dirname, "../data/sessions.json"),
      storage: LocalSession.storageFileAsync,
    });
    sessionMiddleware = localSession.middleware();
    console.log("✅ Session: file-based (telegraf-session-local)");
  } catch (_) {
    // telegraf-session-local not installed — use in-memory (sessions reset on restart)
    sessionMiddleware = session();
    console.log("⚠️  Session: in-memory (install telegraf-session-local for persistence)");
  }
  bot.use(sessionMiddleware);
  bot.use(async (ctx, next) => { if (!ctx.session) ctx.session = {}; return next(); });
  bot.use(async (ctx, next) => { if (!ctx.from) return; return next(); });

  // Order matters: paywall first, then auth, admin, core, etc.
  require("./commands/paywall").registerPaywall(bot);
  require("./commands/auth").registerAuth(bot);
  require("./commands/admin").registerAdmin(bot);
  require("./commands/core").registerCore(bot);
  require("./commands/sales").registerSales(bot);
  require("./commands/inventory").registerInventory(bot);
  require("./commands/operations").registerOperations(bot);
  require("./commands/analytics").registerAnalytics(bot);

  // /app — Mini App launcher
  bot.command("app", async (ctx) => {
    const baseUrl = process.env.WEBHOOK_URL || `http://localhost:${process.env.PORT || 3000}`;
    const miniUrl = `${baseUrl}/mini`;
    await ctx.reply(
      "📱 *ShopBoss Dashboard*\n\nYour full business dashboard — sales, inventory, expenses and AI chat:",
      { parse_mode: "Markdown", ...Markup.inlineKeyboard([
        [Markup.button.webApp("📊 Open Dashboard", miniUrl)],
        [Markup.button.url("🌐 Open in Browser", miniUrl)],
      ])}
    );
  });

  // Global error handler
  bot.catch(async (err, ctx) => {
    console.error(`❌ ${ctx.updateType} | ${ctx.from?.id} | ${ctx.message?.text||"?"} | ${err.message}`);
    console.error(err.stack);
    try { await ctx.reply("⚠️ Something went wrong. Type /start to reset, or /support to contact us."); } catch (_) {}
  });

  // Fallback text handler (must be LAST)
  bot.on("text", async (ctx) => {
    const { mainMenu } = require("./utils/keyboards");
    await ctx.reply(
      "🤔 I don't recognise that command.\n\n" +
      "Use the menu below or try:\n/help — see all commands\n/menu — open the keyboard\n/ask — ask the AI anything",
      mainMenu()
    );
  });

  // ── Express ────────────────────────────────────────────────────────────────
  const app = express();
  app.use("/payment/webhook", express.raw({ type: "application/json" }));
  app.use(express.json());
  app.use(express.static(path.join(__dirname, "../public")));

  // ── Healthcheck — Railway pings this to confirm the app is alive ───────────
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      uptime_seconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  // ── Startup diagnostic log — visible in Railway logs on every boot ─────────
  console.log("╔══════════════════════════════════════════╗");
  console.log("║         ShopBoss Bot Starting            ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log("  BOT_TOKEN     :", process.env.BOT_TOKEN      ? "✅ set" : "❌ MISSING — bot won't start");
  console.log("  WEBHOOK_URL   :", process.env.WEBHOOK_URL    || "not set → polling mode");
  console.log("  ADMIN_TG_ID   :", process.env.ADMIN_TELEGRAM_ID || "⚠️  not set — /admin won't work");
  console.log("  ANTHROPIC_KEY :", process.env.ANTHROPIC_API_KEY ? "✅ set" : "⚠️  not set — AI disabled");
  console.log("  FLW_SECRET    :", process.env.FLW_SECRET_KEY  ? "✅ set" : "⚠️  not set — payments disabled");
  console.log("  PORT          :", process.env.PORT || "3000");
  console.log("  DB_PATH       :", require("./db/database").getDbPath?.() || "see database.js");
  console.log("══════════════════════════════════════════");

  // ── Admin web console ──────────────────────────────────────────────────────
  function checkAdmin(req, res) {
    const key = req.query.key || req.body?.key;
    if (!key || key !== process.env.ADMIN_TELEGRAM_ID) {
      if (req.method === "GET") res.status(403).send(adminLoginPage());
      else res.status(403).json({ error: "Forbidden" });
      return false;
    }
    return true;
  }

  app.get("/admin", (req, res) => {
    if (!checkAdmin(req, res)) return;
    const key      = req.query.key;
    const stats    = db.Signups.count();
    const signups  = db.Signups.list(500);
    const vendors  = db.Vendors.list("All", 500);
    const licStats = require("./services/payment").getStats();
    const aiOk  = !!(process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY.includes("your_"));
    const flwOk = !!(process.env.FLW_SECRET_KEY && !process.env.FLW_SECRET_KEY.includes("your_"));
    const wurl  = process.env.WEBHOOK_URL || "Not configured";

    let html = adminDashboard(stats, signups, vendors, licStats, key);
    // Inject safe values post-template (never expose env vars inside template)
    html = html
      .replace(/ADMINKEY/g, key)
      .replace("AICLASS", aiOk ? "h-ok" : "h-bad")
      .replace("AICOLOR", aiOk ? "var(--green)" : "var(--red)")
      .replace("AISTATUS", aiOk ? "✅ Configured" : "❌ Key missing — add ANTHROPIC_API_KEY in Railway")
      .replace("FLWCLASS", flwOk ? "h-ok" : "h-bad")
      .replace("FLWCOLOR", flwOk ? "var(--green)" : "var(--red)")
      .replace("FLWSTATUS", flwOk ? "✅ Configured" : "❌ Key missing — add FLW_SECRET_KEY in Railway")
      .replace("WEBHOOKURL", wurl);
    res.send(html);
  });

  app.get("/admin/export", (req, res) => {
    if (!checkAdmin(req, res)) return;
    const signups = db.Signups.list(100000);
    const header  = "ID,Name,Business,Email,Phone,Industry,Plan,Date\n";
    const rows    = signups.map(s =>
      [s.id, s.name, s.business_name||"", s.email, s.phone||"", s.industry||"", s.plan, s.created_at]
        .map(v => `"${String(v||"").replace(/"/g,'""')}"`).join(",")
    ).join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="shopboss-${Date.now()}.csv"`);
    res.send(header + rows);
  });

  app.post("/admin/broadcast", async (req, res) => {
    if (!checkAdmin(req, res)) return;
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message required" });
    const all = db.Signups.list(10000).filter(s => s.telegram_id);
    let sent = 0, failed = 0;
    for (const s of all) {
      try { await bot.telegram.sendMessage(s.telegram_id, `📢 *ShopBoss Update*\n\n${message}`, { parse_mode: "Markdown" }); sent++; await new Promise(r => setTimeout(r, 70)); }
      catch (_) { failed++; }
    }
    res.json({ ok: true, sent, failed });
  });

  app.post("/admin/grant", async (req, res) => {
    if (!checkAdmin(req, res)) return;
    const { telegram_id, plan } = req.body;
    const { PLANS, activateLicense } = require("./services/payment");
    if (!PLANS[plan] || plan === "trial") return res.status(400).json({ error: "Invalid plan" });
    activateLicense(telegram_id, `ADMIN-${Date.now()}`, "admin", PLANS[plan].price, plan);
    try { await bot.telegram.sendMessage(telegram_id, `🎉 *${PLANS[plan].label} Activated!*\n\n${PLANS[plan].description}\n\nSend /start to continue. 🚀`, { parse_mode: "Markdown" }); } catch (_) {}
    res.json({ ok: true });
  });

  app.post("/admin/suspend", (req, res) => {
    if (!checkAdmin(req, res)) return;
    const { telegram_id } = req.body;
    dbHandles.run("UPDATE licenses SET status='cancelled' WHERE telegram_id=?", [String(telegram_id)]);
    require("./db/database").save();
    res.json({ ok: true });
  });

  // ── Public signup ──────────────────────────────────────────────────────────
  app.post("/signup", async (req, res) => {
    try {
      const { name, business_name, email, phone, industry, plan } = req.body;
      if (!name || !email) return res.status(400).json({ error: "Name and email required" });
      if (!phone) return res.status(400).json({ error: "Phone number required" });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Invalid email address" });
      db.Signups.add({ name, business_name: business_name||name, email, phone, industry, plan: plan||"trial" });
      const qp = new URLSearchParams({ email: email||"", name: name||"", bn: business_name||"", ind: industry||"", ph: phone||"" }).toString();
      res.json({ ok: true, redirect: `/profile.html?${qp}` });
    } catch(e) {
      if (e.message?.includes("UNIQUE")) return res.status(400).json({ error: "This email is already registered." });
      res.status(500).json({ error: "Signup failed. Call +2349029092881" });
    }
  });

  // ── Vendor & listing APIs ──────────────────────────────────────────────────
  app.get("/api/vendors", (req, res) => {
    try {
      const industry = req.query.industry || "All";
      // Get all active vendors (includes bot users and web signups)
      const vendors = db.Vendors.list(industry, 100);
      res.json({ vendors, total: vendors.length });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // Get a single vendor profile with reviews
  app.get("/api/vendors/:id", (req, res) => {
    try {
      const vendor = db.Vendors.get(parseInt(req.params.id));
      if (!vendor) return res.status(404).json({ error: "Vendor not found" });
      const reviews = db.Vendors.reviews(vendor.id);
      res.json({ vendor, reviews });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/vendors/:id/review — leave a review (must have tg_id)
  app.post("/api/vendors/:id/review", (req, res) => {
    try {
      const vendorId = parseInt(req.params.id);
      const { rating, comment, reviewer_name } = req.body;
      const reviewerTgId = req.headers["x-tg-id"] || req.body.reviewer_tg_id || null;

      if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: "Rating must be 1-5" });
      if (!comment || comment.trim().length < 5) return res.status(400).json({ error: "Comment must be at least 5 characters" });

      const vendor = db.Vendors.get(vendorId);
      if (!vendor) return res.status(404).json({ error: "Vendor not found" });

      // Prevent reviewing own business
      if (reviewerTgId && vendor.telegram_id && String(vendor.telegram_id) === String(reviewerTgId)) {
        return res.status(400).json({ error: "You cannot review your own business" });
      }

      const alreadyReviewed = reviewerTgId ? db.Vendors.hasReviewed(vendorId, reviewerTgId) : false;
      db.Vendors.addReview(vendorId, reviewerTgId, reviewer_name || "Anonymous", parseInt(rating), comment.trim());

      const updated = db.Vendors.get(vendorId);
      res.json({
        ok: true,
        updated: alreadyReviewed,
        new_rating: updated.rating,
        review_count: updated.review_count,
      });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // Public signup count — shows on landing page stats
  app.get("/api/stats", (req, res) => {
    try {
      const counts = db.Signups.count();
      const vendors = db.Vendors.list("All", 10000);
      res.json({
        signups: counts.total || 0,
        vendors: vendors.length || 0,
        industries: 24,
      });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/vendors/featured", (req, res) => {
    try {
      const vendors = db.Vendors.featured();
      res.json({ vendors: vendors.map(v => ({ ...v, reviews: db.Vendors.reviews(v.id).slice(0, 2) })) });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/listings", (req, res) => {
    try {
      const { vendor_id, title, description, price, price_label, category } = req.body;
      if (!vendor_id || !title) return res.status(400).json({ error: "vendor_id and title required" });
      const r = db.VendorListings.add({ vendor_id, title, description, price, price_label, category });
      res.json({ ok: true, id: r.lastInsertRowid });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/listings", (req, res) => {
    try { res.json({ listings: db.VendorListings.listAll(20) }); }
    catch(e) { res.status(500).json({ error: e.message }); }
  });

  // ── Profile save ───────────────────────────────────────────────────────────
  app.post("/api/profile", (req, res) => {
    try {
      const { email, name, business_name, phone, industry, location, description } = req.body;
      const vendor = db.Vendors.list("All", 100000).find(v => v.email === email);
      if (vendor) {
        dbHandles.run("UPDATE vendors SET name=COALESCE(?,name),phone=COALESCE(?,phone),industry=COALESCE(?,industry),location=?,description=? WHERE id=?",
          [business_name||null, phone||null, industry||null, location||null, description||null, vendor.id]);
        db.save();
        res.json({ ok: true, vendor_id: vendor.id });
      } else {
        const r = db.Vendors.add({ name: business_name||name, email, phone, industry, description });
        res.json({ ok: true, vendor_id: r.lastInsertRowid });
      }
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // ── Marketplace sale confirmation ──────────────────────────────────────────
  app.post("/api/sales/confirm", (req, res) => {
    try {
      const { sale_id, action, tg_id } = req.body;
      if (!sale_id || !action || !tg_id) return res.status(400).json({ error: "sale_id, action, tg_id required" });
      let ok = false;
      if (action === "sent")     ok = db.MarketplaceSales.confirmSeller(sale_id, tg_id);
      if (action === "received") ok = db.MarketplaceSales.confirmBuyer(sale_id, tg_id);
      if (!ok) return res.status(400).json({ error: "Could not confirm — check sale ID and your role" });
      const updated = db.MarketplaceSales.get(sale_id);
      res.json({ ok: true, status: updated.status, completed: updated.status === "completed" });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // ── Flutterwave payment ────────────────────────────────────────────────────
  app.post("/payment/create-link", async (req, res) => {
    try {
      const { name, email, phone, plan } = req.body;
      if (!name || !email || !phone) return res.status(400).json({ error: "Name, email and phone required" });
      if (!process.env.FLW_SECRET_KEY || process.env.FLW_SECRET_KEY.includes("your_"))
        return res.status(503).json({ error: "Payment system not configured. Contact +2349029092881" });
      const { PLANS } = require("./services/payment");
      const selectedPlan = PLANS[plan] || PLANS.lifetime;
      const txRef = `SB-WEB-${Date.now()}`;
      const wUrl  = process.env.WEBHOOK_URL || `http://localhost:${process.env.PORT||3000}`;
      try { db.Signups.add({ name, email, phone, plan: plan||"lifetime" }); } catch(_) {}
      const axios = require("axios");
      const r = await axios.post("https://api.flutterwave.com/v3/payments", {
        tx_ref: txRef, amount: selectedPlan.price, currency: "NGN",
        redirect_url: `${wUrl}/payment/callback`,
        customer: { email, phonenumber: phone, name },
        customizations: { title: "ShopBoss " + selectedPlan.label, description: selectedPlan.description },
        payment_options: "card,banktransfer,ussd",
        meta: { plan, name, email },
      }, { headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` }, timeout: 10000 });
      if (r.data?.status !== "success") return res.status(500).json({ error: r.data?.message||"Gateway error. Try again." });
      res.json({ link: r.data.data.link, txRef });
    } catch(e) {
      console.error("FLW link error:", e.message);
      res.status(500).json({ error: "Payment failed: " + (e.response?.data?.message||e.message) + ". Call +2349029092881" });
    }
  });

  // ── Flutterwave webhook ────────────────────────────────────────────────────
  app.post("/payment/webhook", async (req, res) => {
    try {
      const hash = req.headers["verif-hash"];
      if (!hash || hash !== process.env.FLW_WEBHOOK_HASH) return res.status(401).send("Unauthorized");
      const body = JSON.parse(req.body.toString());
      console.log("📥 Webhook:", body.event, body.data?.tx_ref);
      if (body.event === "charge.completed" && body.data?.status === "successful") {
        const { verifyAndActivate } = require("./services/payment");
        const result = await verifyAndActivate(body.data.tx_ref, body.data.flw_ref);
        if (result?.telegramId) {
          try {
            const { PLANS } = require("./services/payment");
            await bot.telegram.sendMessage(result.telegramId,
              `🎉 *Payment Confirmed!*\n\n✅ ${(PLANS[result.plan]||PLANS.lifetime).label} activated.\n\nUse /start to continue.`,
              { parse_mode: "Markdown" }
            );
          } catch (_) {}
        }
      }
      res.sendStatus(200);
    } catch(e) { console.error("Webhook error:", e.message); res.sendStatus(200); }
  });

  // ── Payment callback ───────────────────────────────────────────────────────
  app.get("/payment/callback", (req, res) => {
    const { status, tx_ref } = req.query;
    const baseUrl = process.env.WEBHOOK_URL || "";
    if (status === "successful")
      return res.redirect(`${baseUrl}/payment/success.html?ref=${tx_ref}`);
    if (status === "cancelled")
      return res.redirect(`${baseUrl}/payment/pending.html`);
    return res.redirect(`${baseUrl}/payment/failed.html`);
  });

  // Simple callback pages
  const cbStyle = `<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#080c14;color:#eef1f8;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px}.box{max-width:400px}.ico{font-size:56px;margin-bottom:20px}.h1{font-size:24px;font-weight:800;margin-bottom:12px}.p{color:#8896b0;font-size:14px;line-height:1.7;margin-bottom:24px}.btn{display:inline-flex;background:linear-gradient(135deg,#f0b429,#c8931f);color:#111;font-weight:800;font-size:15px;padding:13px 26px;border-radius:10px;text-decoration:none}</style>`;
  app.get("/payment/success.html", (_,res)=>res.send(`<!DOCTYPE html><html><head><title>Payment Successful</title>${cbStyle}</head><body><div class="box"><div class="ico">🎉</div><div class="h1" style="color:#10b981">Payment Successful!</div><div class="p">Your ShopBoss plan has been activated. Open the bot to start managing your business.</div><a class="btn" href="https://t.me/AiBizRepoBot">Open ShopBoss Bot →</a></div></body></html>`));
  app.get("/payment/pending.html", (_,res)=>res.send(`<!DOCTYPE html><html><head><title>Payment Pending</title>${cbStyle}</head><body><div class="box"><div class="ico">⏳</div><div class="h1" style="color:#f0b429">Payment Pending</div><div class="p">Your payment is being processed. We'll activate your plan as soon as it confirms.</div><a class="btn" href="https://t.me/AiBizRepoBot">Go to Bot</a></div></body></html>`));
  app.get("/payment/failed.html", (_,res)=>res.send(`<!DOCTYPE html><html><head><title>Payment Failed</title>${cbStyle}</head><body><div class="box"><div class="ico">❌</div><div class="h1" style="color:#f43f5e">Payment Failed</div><div class="p">Something went wrong. Please try again or call +2349029092881 for help.</div><a class="btn" href="/">Try Again</a></div></body></html>`));

  // ── Payment status (private check) ────────────────────────────────────────
  app.get("/payment/status", (req, res) => {
    if (!checkAdmin(req, res)) return;
    const aiOk  = !!(process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY.includes("your_"));
    const flwOk = !!(process.env.FLW_SECRET_KEY && !process.env.FLW_SECRET_KEY.includes("your_"));
    res.json({
      flutterwave: { secret_key_set: flwOk, webhook_url: (process.env.WEBHOOK_URL||"NOT SET")+"/payment/webhook" },
      ai: { configured: aiOk },
      license_stats: require("./services/payment").getStats(),
    });
  });

  // ── Mini App ───────────────────────────────────────────────────────────────
  app.use("/mini", require("./services/miniapp"));

  // ── Webhook or polling ─────────────────────────────────────────────────────
  const WEBHOOK_URL = process.env.WEBHOOK_URL;
  const PORT        = parseInt(process.env.PORT || "3000");

  if (WEBHOOK_URL) {
    // FIX: register webhookCallback on express BEFORE listen
    // FIX: strip trailing slash from WEBHOOK_URL to prevent Telegram rejecting it
    const cleanUrl = WEBHOOK_URL.replace(/\/+$/, "");
    app.use(bot.webhookCallback("/webhook"));

    // Start server FIRST — then tell Telegram where to send updates
    await new Promise((resolve) => {
      app.listen(PORT, () => {
        console.log(`🚀 Server listening on port ${PORT}`);
        resolve();
      });
    });

    // Now that server is ready, register the webhook
    await bot.telegram.setWebhook(`${cleanUrl}/webhook`);
    console.log(`🌐 Webhook registered: ${cleanUrl}/webhook`);

  } else {
    // Polling mode — start server first, then polling
    await new Promise((resolve) => app.listen(PORT, () => { console.log(`🚀 Server on port ${PORT}`); resolve(); }));
    await bot.launch();
    console.log("🤖 Bot running in polling mode");
  }

  // Scheduled jobs
  try { require("./services/jobs").startJobs(bot); } catch(e) { console.warn("Jobs skipped:", e.message); }

  process.once("SIGINT",  () => { bot.stop("SIGINT");  require("./db/database").save(); });
  process.once("SIGTERM", () => { bot.stop("SIGTERM"); require("./db/database").save(); });

}).catch(err => {
  console.error("❌ Failed to start:", err.message);
  console.error(err.stack);
  process.exit(1);
});
