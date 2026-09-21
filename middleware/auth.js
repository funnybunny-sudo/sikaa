// sika-backend/middleware/auth.js
// ─────────────────────────────────────────
// Verifies the Supabase access token sent by the app and attaches the
// verified user to req.user. Routes must use req.user.id — never a userId
// from the request body, because the backend talks to Supabase with the
// service_role key (which bypasses RLS).
// ─────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

module.exports = async function requireUser(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  if (!token) {
    return res.status(401).json({ error: 'Sign in required' });
  }

  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
    req.user = data.user;
    return next();
  } catch (err) {
    console.error('[auth] Token check failed:', err.message);
    return res.status(503).json({ error: 'Could not verify session. Please try again.' });
  }
};
