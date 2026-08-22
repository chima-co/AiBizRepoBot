// ─────────────────────────────────────────────
//  helpers.js — shared utilities
// ─────────────────────────────────────────────
const { Business } = require("../db/database");

// Format currency
const fmt = (n) => `₦${Number(n || 0).toLocaleString("en-NG")}`;

// Format date
const fmtDate = (d) => new Date(d).toLocaleString("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" });

// Get or create business from Telegram context
function getBusiness(ctx) {
  const tid = ctx.from?.id;
  if (!tid) return null;
  const name = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || "Business Owner";
  return Business.getOrCreate(tid, `${name}'s Business`);
}

// Safe reply — never crashes the bot
async function safeReply(ctx, text, extra = {}) {
  try {
    await ctx.reply(text, { parse_mode: "Markdown", ...extra });
  } catch (err) {
    console.error("Reply failed:", err.message);
  }
}

// Parse a number from user input
function parseNumber(str) {
  if (!str) return null;
  const n = Number(String(str).replace(/[₦,\s]/g, ""));
  return isNaN(n) || n < 0 ? null : n;
}

// Escape markdown special chars
function esc(str) {
  return String(str || "").replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

// Truncate long text
function truncate(str, max = 50) {
  return str.length > max ? str.slice(0, max) + "…" : str;
}

// Build a simple text table from array of rows
function textTable(headers, rows) {
  if (!rows.length) return "_No data_";
  const lines = rows.map((r) => r.join(" | "));
  return `*${headers.join(" | ")}*\n${lines.join("\n")}`;
}

module.exports = { fmt, fmtDate, getBusiness, safeReply, parseNumber, esc, truncate, textTable };
