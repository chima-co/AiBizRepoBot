// ─────────────────────────────────────────────
//  ai.js — Claude AI integration
//  Fetches real DB data before every AI response
//  Never invents business figures
// ─────────────────────────────────────────────
const Anthropic = require("@anthropic-ai/sdk");
const { Analytics, Sales, Products, Expenses } = require("../db/database");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are ShopBoss, an AI-powered business management assistant for Nigerian small business owners.

You have access to REAL business data provided to you in JSON format at the start of every message.

RULES:
- Only use the data provided — NEVER invent sales, profits, or stock figures
- If data is empty or unavailable, say so clearly: "No sales recorded yet" etc.
- Always format currency as ₦ with comma separators (e.g. ₦12,500)
- Be concise but actionable — give insights, not just numbers
- Suggest practical next steps based on the data
- Use simple English suitable for Nigerian business owners
- Keep responses under 300 words unless a full report is requested
- Use emojis sparingly for readability

You can answer questions about: sales, revenue, profit, expenses, inventory, low stock, top products, orders, staff, payroll, and business performance.`;

async function askAI(businessId, userQuestion) {
  // Fetch real data from DB first
  let data;
  try {
    data = Analytics.forAI(businessId);
  } catch (err) {
    data = { error: "Could not load business data" };
  }

  const contextMessage = `
BUSINESS DATA (current snapshot):
${JSON.stringify(data, null, 2)}

USER QUESTION: ${userQuestion}
`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: contextMessage }],
  });

  return response.content[0].text;
}

async function generateInsights(businessId) {
  let data;
  try {
    data = Analytics.forAI(businessId);
  } catch (err) {
    return "⚠️ Could not load business data for analysis.";
  }

  const prompt = `
BUSINESS DATA:
${JSON.stringify(data, null, 2)}

Generate a concise business insight report with:
1. Key performance highlights from today/this month
2. Top 2-3 concerns or risks (low stock, low profit, high expenses)
3. Top 2-3 actionable recommendations
Keep it under 250 words. Use ₦ for currency. Be specific using the actual data provided.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  return response.content[0].text;
}

module.exports = { askAI, generateInsights };
