// ─────────────────────────────────────────────
//  ai.js — Claude AI integration
//  FIX: lazy client init (not at module load time)
//  FIX: explicit error messages per failure mode
// ─────────────────────────────────────────────
const { Analytics } = require("../db/database");

// INDUSTRY CONTEXT — tailored prompts per industry
const INDUSTRY_CONTEXT = {
  "Agriculture":    "Focus on harvest cycles, seasonal revenue, input costs, storage losses, commodity prices.",
  "Logistics":      "Focus on trip revenue, fuel costs, vehicle maintenance, route profitability, driver payroll.",
  "Retail":         "Focus on margins, fast-moving vs slow-moving products, shrinkage, reorder points, foot traffic.",
  "Wholesale":      "Focus on bulk margins, credit terms, minimum order values, supplier costs, stock turnover.",
  "Manufacturing":  "Focus on raw material costs, production yield, overhead allocation, waste reduction.",
  "Food & Beverage":"Focus on daily revenue, spoilage/wastage, ingredient costs, peak hours, menu profitability.",
  "Pharmacy":       "Focus on drug margins, expiry management, prescription vs OTC split, supplier reliability.",
  "Fashion":        "Focus on seasonal trends, slow-moving SKUs, mark-up ratios, return rates.",
  "Logistics":      "Focus on delivery revenue per trip, fuel efficiency, fleet utilisation.",
  "Construction":   "Focus on project margins, material costs, labour, timeline vs budget.",
  "Energy":         "Focus on fuel costs, generator revenue, solar payback periods, maintenance.",
  "Healthcare":     "Focus on consultation revenue, consumable costs, patient volume.",
  "ICT":            "Focus on project revenue, recurring vs one-off income, software/hardware margins.",
  "Finance":        "Focus on interest income, default rates, portfolio size, cost of funds.",
};

function getClient() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key.includes("your_") || key.length < 20) {
    throw new Error("ANTHROPIC_API_KEY is not configured. Add it in Railway → Variables.");
  }
  // Lazy init — created fresh each call to avoid stale key issues
  const Anthropic = require("@anthropic-ai/sdk");
  return new Anthropic({ apiKey: key });
}

function buildSystemPrompt(industry) {
  const industryHint = INDUSTRY_CONTEXT[industry] || "";
  return `You are ShopBoss, an AI business assistant for Nigerian SME owners.
You receive REAL business data in JSON at the start of every message.

RULES:
- Only use the data provided — NEVER invent figures
- If data is empty, say clearly "No data recorded yet"
- Format currency as ₦ with commas (e.g. ₦12,500)
- Be concise and actionable — give insights not just numbers
- Use simple English for Nigerian business owners
- Keep responses under 300 words
${industryHint ? `\nINDUSTRY FOCUS (${industry}): ${industryHint}` : ""}`;
}

async function askAI(businessId, userQuestion, industry) {
  const client = getClient(); // throws clear error if key missing

  let data;
  try { data = Analytics.forAI(businessId); }
  catch (err) { data = { error: "Could not load business data" }; }

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 600,
    system: buildSystemPrompt(industry),
    messages: [{
      role: "user",
      content: `BUSINESS DATA:\n${JSON.stringify(data, null, 2)}\n\nQUESTION: ${userQuestion}`,
    }],
  });

  return response.content[0].text;
}

async function generateInsights(businessId, industry) {
  const client = getClient();

  let data;
  try { data = Analytics.forAI(businessId); }
  catch (err) { return "⚠️ Could not load business data for analysis."; }

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 500,
    system: buildSystemPrompt(industry),
    messages: [{
      role: "user",
      content: `BUSINESS DATA:\n${JSON.stringify(data, null, 2)}\n\nGenerate a concise report:\n1. Key performance highlights\n2. Top 2-3 risks or concerns\n3. Top 2-3 actionable recommendations\nUnder 250 words. Use ₦.`,
    }],
  });

  return response.content[0].text;
}

// Industry-specific workflow content
function getIndustryWorkflow(industry) {
  const workflows = {
    "Agriculture": {
      quickActions: ["🌱 Record Harvest", "💊 Log Input Cost", "📦 Stockin Produce", "🚛 Record Sale to Market"],
      insights: ["Track seasonal profit margins", "Monitor input cost vs yield ratio", "Set minimum stock for perishables"],
      commands: ["/sale — record produce sale", "/expense — log input costs (seeds, fertiliser)", "/stockin — add harvest to inventory", "/lowstock — check produce levels"],
    },
    "Logistics": {
      quickActions: ["🚚 Record Trip Revenue", "⛽ Log Fuel Expense", "🔧 Log Maintenance", "📦 Track Delivery"],
      insights: ["Revenue per trip analysis", "Fuel cost as % of revenue", "Fleet utilisation rate"],
      commands: ["/sale — record trip payment", "/expense — log fuel/maintenance", "/order — create delivery order", "/delivery — track pending deliveries"],
    },
    "Retail": {
      quickActions: ["💰 Record Sale", "📦 Check Stock", "⚠️ Low Stock Alert", "🛒 Add New Product"],
      insights: ["Best-selling products", "Stock turnover rate", "Daily revenue trends"],
      commands: ["/sale — record daily sales", "/inventory — check stock levels", "/lowstock — restock alerts", "/revenue — sales report"],
    },
    "Food & Beverage": {
      quickActions: ["🍕 Record Orders", "🛒 Log Ingredient Cost", "📊 Daily Summary", "👨‍🍳 Staff Payroll"],
      insights: ["Daily revenue vs food cost", "Peak hour analysis", "Menu item profitability"],
      commands: ["/sale — record orders", "/expense — log food costs", "/today — daily performance", "/staff — manage kitchen staff"],
    },
    "Wholesale": {
      quickActions: ["📦 Record Bulk Sale", "🤝 Add Supplier", "💳 Record Purchase", "📈 Profit Report"],
      insights: ["Bulk margin per product", "Supplier cost comparison", "Credit vs cash sales"],
      commands: ["/sale — bulk sale", "/suppliers — manage suppliers", "/purchases — track purchases", "/profit — margin report"],
    },
    "Manufacturing": {
      quickActions: ["🏭 Record Production", "🔩 Log Material Cost", "📦 Add to Stock", "💰 Record Sale"],
      insights: ["Production yield efficiency", "Material cost vs revenue", "Output vs target"],
      commands: ["/stockin — add production output", "/expense — raw material costs", "/sale — finished goods sale", "/analytics — production report"],
    },
  };
  return workflows[industry] || {
    quickActions: ["💰 Record Sale", "📦 Check Inventory", "💸 Log Expense", "📊 View Dashboard"],
    insights: ["Track daily revenue", "Monitor stock levels", "Watch expense ratios"],
    commands: ["/sale", "/inventory", "/expense", "/dashboard"],
  };
}

module.exports = { askAI, generateInsights, getIndustryWorkflow };
