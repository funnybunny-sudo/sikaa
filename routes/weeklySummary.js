// sika-backend/routes/weeklySummary.js
// ─────────────────────────────────────────
// POST /api/weekly-summary
//
// Request body:
//   { userId: string }
//
// Response:
//   { summary: string }
//
// Fetches this week's spending from Supabase using the service role key,
// then asks Claude to write a friendly paragraph summary.
// ─────────────────────────────────────────

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { generateWeeklySummary } = require('../lib/claude');

const router = express.Router();

// Use the service role key (admin) so we can query any user's data.
// This key must NEVER be exposed to the mobile app.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

router.post('/', async (req, res) => {
  const userId = req.user.id; // verified by middleware/auth.js — never trust a body userId

  try {
    // Get this week's category totals using the DB function we defined in the schema
    // (Using raw query since supabase-js doesn't support calling functions with args easily)
    const { data, error } = await supabase
      .from('transactions')
      .select('category, amount')
      .eq('user_id', userId)
      .gte('date', getWeekStart())
      .lte('date', getWeekEnd());

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.json({
        summary: "You haven't logged any transactions this week. Start tracking to see your insights!",
      });
    }

    // Aggregate by category in JS (avoids a second DB query)
    const totals = aggregateByCategory(data);
    const grandTotal = data.reduce((sum, tx) => sum + parseFloat(tx.amount), 0);

    const summary = await generateWeeklySummary(totals, grandTotal);

    return res.json({ summary });
  } catch (err) {
    console.error('[weekly-summary] Error:', err.message);
    return res.status(500).json({ error: 'Could not generate summary. Try again later.' });
  }
});

// ── Helpers ───────────────────────────────

function aggregateByCategory(transactions) {
  const map = {};
  for (const tx of transactions) {
    if (!map[tx.category]) {
      map[tx.category] = { category: tx.category, total_amount: 0, transaction_count: 0 };
    }
    map[tx.category].total_amount += parseFloat(tx.amount);
    map[tx.category].transaction_count += 1;
  }
  // Sort by total descending so the prompt leads with biggest category
  return Object.values(map).sort((a, b) => b.total_amount - a.total_amount);
}

// Monday of current week (ISO week)
function getWeekStart() {
  const d = new Date();
  const day = d.getDay(); // 0=Sun, 1=Mon, …
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(d.setDate(diff));
  return mon.toISOString().split('T')[0];
}

// Sunday of current week
function getWeekEnd() {
  const start = new Date(getWeekStart());
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return end.toISOString().split('T')[0];
}

module.exports = router;
