// sika-backend/routes/categorize.js
// ─────────────────────────────────────────
// POST /api/categorize
//
// Request body:
//   { amount: number, description: string }
//
// Response:
//   { category: string, tip: string }
//
// Called by the app immediately after the user taps "Save" on a transaction.
// If Claude is slow or fails, the app saves with category "Other" and retries later.
// ─────────────────────────────────────────

const express = require('express');
const { categorize } = require('../lib/claude');

const router = express.Router();

// ── Input validation helper ───────────────
function validateBody(body) {
  const { amount, description } = body;

  if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
    return 'amount must be a positive number';
  }
  if (amount > 1_000_000) {
    return 'amount is unrealistically large';
  }
  if (typeof description !== 'string' || description.trim().length === 0) {
    return 'description must be a non-empty string';
  }
  if (description.trim().length > 200) {
    return 'description is too long (max 200 characters)';
  }

  return null; // null = valid
}

// ── POST /api/categorize ─────────────────
router.post('/', async (req, res) => {
  const validationError = validateBody(req.body);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const { amount, description } = req.body;

  // Sanitize: trim the description before sending to Claude
  const cleanDescription = description.trim();

  console.log(`[categorize] GH₵${amount} — "${cleanDescription.substring(0, 50)}"`);

  const result = await categorize(amount, cleanDescription);

  // Even if Claude returned an error flag, we return 200 with the fallback.
  // The app can show the tip if it exists; the category will be "Other".
  // This way a Claude failure never blocks the user from logging a transaction.
  return res.status(200).json({
    category: result.category,
    tip: result.tip,
  });
});

module.exports = router;
