// sika-backend/routes/sync.js
// ─────────────────────────────────────────
// POST /api/sync
//
// Called when the app comes back online with transactions that were
// logged offline (ai_processed = false).
//
// Request body:
//   { userId: string }
//
// Response:
//   { processed: number, failed: number }
//
// Flow:
//   1. Fetch all unprocessed transactions for the user from Supabase
//   2. For each: call Claude to categorize → update the row
//   3. Return a count of successes and failures
// ─────────────────────────────────────────

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { categorize } = require('../lib/claude');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

router.post('/', async (req, res) => {
  const userId = req.user.id; // verified by middleware/auth.js — never trust a body userId

  try {
    // Fetch unprocessed transactions (limit 50 to avoid long responses)
    const { data: transactions, error: fetchError } = await supabase
      .from('transactions')
      .select('id, amount, description')
      .eq('user_id', userId)
      .eq('ai_processed', false)
      .order('created_at', { ascending: true })
      .limit(50);

    if (fetchError) throw fetchError;
    if (!transactions || transactions.length === 0) {
      return res.json({ processed: 0, failed: 0 });
    }

    console.log(`[sync] Processing ${transactions.length} offline transactions for user ${userId.substring(0, 8)}...`);

    let processed = 0;
    let failed = 0;

    // Process each transaction sequentially to avoid overwhelming the Claude API
    // At 50 transactions this takes ~15s — acceptable for a background sync
    for (const tx of transactions) {
      try {
        const result = await categorize(tx.amount, tx.description);

        if (result.error) {
          failed++;
          continue; // Leave ai_processed = false, will retry next sync
        }

        // Update the row with AI results
        const { error: updateError } = await supabase
          .from('transactions')
          .update({
            category:     result.category,
            tip:          result.tip,
            ai_processed: true,
          })
          .eq('id', tx.id)
          .eq('user_id', userId); // Safety: ensure we only update this user's rows

        if (updateError) throw updateError;
        processed++;
      } catch (txErr) {
        console.error(`[sync] Failed to process tx ${tx.id}:`, txErr.message);
        failed++;
      }
    }

    console.log(`[sync] Done. processed=${processed} failed=${failed}`);
    return res.json({ processed, failed });
  } catch (err) {
    console.error('[sync] Error:', err.message);
    return res.status(500).json({ error: 'Sync failed. Try again.' });
  }
});

module.exports = router;
