// sika-backend/server.js
// ─────────────────────────────────────────
// Sika API server.
// Responsibilities:
//   - Hold the Anthropic API key (never exposed to the app)
//   - POST /api/categorize    → AI category + tip per transaction
//   - POST /api/weekly-summary → AI summary paragraph for the week
//   - POST /api/sync           → batch-process offline transactions
//
// ⚠️ COST NOTE: Add rate limiting per user once you have real users.
//    The express-rate-limit middleware below is a basic global guard.
//    For production, switch to a per-user key stored in Redis.
// ─────────────────────────────────────────

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');

const categorizeRoute      = require('./routes/categorize');
const weeklySummaryRoute   = require('./routes/weeklySummary');
const syncRoute            = require('./routes/sync');
const requireUser         = require('./middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────

// Parse JSON bodies
app.use(express.json({ limit: '50kb' })); // Keep payloads small

// CORS — allow the Expo app to reach the API
const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim());
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile apps, curl) and known origins
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Global rate limit: 60 requests per minute per IP
// ⚠️ For production, move to per-user rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max: 60,
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// ── Routes ────────────────────────────────
app.use('/api/categorize',      requireUser, categorizeRoute);
app.use('/api/weekly-summary',  requireUser, weeklySummaryRoute);
app.use('/api/sync',            requireUser, syncRoute);

// ── Health check ──────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'sika-backend', ts: new Date().toISOString() });
});

// ── 404 catch-all ─────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Global error handler ──────────────────
// Catches any unhandled errors from route handlers
app.use((err, _req, res, _next) => {
  console.error('[server] Unhandled error:', err.message);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

// ── Start ─────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅  Sika backend running on http://localhost:${PORT}`);
  console.log(`    ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? '✓ set' : '✗ MISSING'}`);
  console.log(`    SUPABASE_URL:      ${process.env.SUPABASE_URL ? '✓ set' : '✗ MISSING'}`);
});

module.exports = app; // for testing
