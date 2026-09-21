// sika-backend/lib/claude.js
// ─────────────────────────────────────────
// Anthropic SDK client — single instance, shared by all route handlers.
// All AI prompt logic lives here, not in route files.
//
// Model: claude-sonnet-4-20250514
// ⚠️ COST NOTE:
//   categorize()      ~100 tokens in + ~50 out   ≈ $0.0003 per call
//   weeklySummary()   ~400 tokens in + ~120 out  ≈ $0.001  per call
//   At 1,000 users logging 5 tx/day: ~$1.50/day in AI costs
//   Monitor via Anthropic console — set a spend alert at $10/day
// ─────────────────────────────────────────

const Anthropic = require('@anthropic-ai/sdk');

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error('ANTHROPIC_API_KEY is not set. Check your .env file.');
}

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = 'claude-sonnet-4-20250514';

// ── Valid categories (must match DB constraint + app constants) ──
const VALID_CATEGORIES = ['Food', 'Transport', 'Bills', 'Entertainment', 'Savings', 'Other'];

// ── Categorize a single transaction ──────────────────────────────
// Returns: { category: string, tip: string }
// Never throws — returns a safe fallback on any error.
//
// @param {number} amount       - Transaction amount in GHS
// @param {string} description  - User's description
async function categorize(amount, description) {
  const prompt = `The user spent ${amount} GHS on "${description}".
1. Categorize this transaction into exactly one of: Food, Transport, Bills, Entertainment, Savings, Other.
2. Give ONE short friendly money tip (max 15 words) related to this category.
Respond in JSON only: { "category": "...", "tip": "..." }`;

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 120,        // Small: we only need a short JSON response
      temperature: 0,         // Low temp = consistent categorization
      messages: [{ role: 'user', content: prompt }],
    });

    // Extract the text content from Claude's response
    const raw = message.content[0]?.text?.trim() ?? '';

    // Parse JSON — Claude should return clean JSON but be defensive
    let parsed;
    try {
      // Strip markdown code fences if Claude wraps in ```json ... ```
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      parsed = JSON.parse(cleaned);
    } catch {
      console.error('[claude] Failed to parse JSON response:', raw);
      return { category: 'Other', tip: '' };
    }

    // Validate category value
    const category = VALID_CATEGORIES.includes(parsed.category) ? parsed.category : 'Other';
    const tip = typeof parsed.tip === 'string' ? parsed.tip.trim() : '';

    return { category, tip };
  } catch (err) {
    // API error (rate limit, network, etc.) — return safe fallback
    console.error('[claude] categorize() error:', err.message);
    return { category: 'Other', tip: '', error: true };
  }
}

// ── Generate weekly AI summary paragraph ─────────────────────────
// Returns a single friendly paragraph (string).
// Never throws.
//
// @param {Array<{category, total_amount, transaction_count}>} categoryTotals
// @param {number} grandTotal  - Total spend this week in GHS
async function generateWeeklySummary(categoryTotals, grandTotal) {
  if (!categoryTotals || categoryTotals.length === 0) {
    return "You haven't logged any transactions this week. Start tracking to see your insights!";
  }

  // Format the data for the prompt (keep it small — tokens cost money)
  const breakdown = categoryTotals
    .map(r => `${r.category}: GH₵${parseFloat(r.total_amount).toFixed(2)} (${r.transaction_count} transactions)`)
    .join('\n');

  const prompt = `A user in Ghana tracked their spending this week. Here is their breakdown:

Total spent: GH₵${grandTotal.toFixed(2)}
${breakdown}

Write ONE short, friendly, encouraging paragraph (max 40 words) that:
1. Mentions the biggest spending category
2. Gives one actionable saving tip for next week
3. Uses simple English (Grade 6 level)
4. Stays positive and motivating
Do not use emojis. Do not start with "This week".`;

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 150,
      temperature: 0.7,     // Slightly creative — makes summaries feel less robotic
      messages: [{ role: 'user', content: prompt }],
    });

    return message.content[0]?.text?.trim() ?? '';
  } catch (err) {
    console.error('[claude] generateWeeklySummary() error:', err.message);
    return "We could not load your weekly summary right now. Check back soon!";
  }
}

module.exports = { categorize, generateWeeklySummary };
