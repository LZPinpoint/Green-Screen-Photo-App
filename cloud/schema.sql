CREATE TABLE IF NOT EXISTS venues (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  welcome_text TEXT NOT NULL DEFAULT '',
  api_key_hash TEXT NOT NULL,
  admin_key_hash TEXT NOT NULL,
  retention_days INTEGER NOT NULL DEFAULT 30,
  optin_retention_days INTEGER NOT NULL DEFAULT 365,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  venue_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  scene TEXT NOT NULL DEFAULT '',
  layout TEXT NOT NULL DEFAULT '',
  has_image INTEGER NOT NULL DEFAULT 0,
  has_thumb INTEGER NOT NULL DEFAULT 0,
  image_type TEXT NOT NULL DEFAULT '',
  image_bytes INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_venue ON sessions(venue_id, created_at);
CREATE TABLE IF NOT EXISTS optins (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  venue_id TEXT NOT NULL,
  email TEXT,                      -- plaintext only when marketing_opt_in = 1
  email_hash TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  consent_at INTEGER NOT NULL,
  marketing_opt_in INTEGER NOT NULL,
  last_sent_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_optins_session ON optins(session_id);
CREATE INDEX IF NOT EXISTS idx_optins_venue ON optins(venue_id, marketing_opt_in);
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
