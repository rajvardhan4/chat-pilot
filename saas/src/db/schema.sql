-- ===========================================================================
--  CHAT PILOT SAAS - MULTI-TENANT RELATIONAL SCHEMA (v1)
--
--  Tenancy model
--  -------------
--    account            = the tenant (a customer company)
--    account_members    = users belonging to a tenant, with a role
--    website            = a registered site inside a tenant
--
--  EVERY tenant-scoped table carries `account_id`, and every website-scoped
--  table carries BOTH `account_id` and `website_id`. That redundancy is
--  deliberate: it lets every query filter on the tenant boundary directly
--  (defence in depth) instead of relying on a join chain being written
--  correctly at every call site.
-- ===========================================================================

PRAGMA foreign_keys = ON;

-- --------------------------------------------------------------- identity --

CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY,
  email             TEXT NOT NULL,
  email_normalized  TEXT NOT NULL UNIQUE,
  password_hash     TEXT NOT NULL,
  full_name         TEXT NOT NULL DEFAULT '',
  -- 'super_admin' can administer the whole platform; 'user' is a customer.
  platform_role     TEXT NOT NULL DEFAULT 'user',
  status            TEXT NOT NULL DEFAULT 'active',   -- active | suspended
  email_verified_at TEXT,
  last_login_at     TEXT,
  failed_logins     INTEGER NOT NULL DEFAULT 0,
  locked_until      TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users (platform_role);

CREATE TABLE IF NOT EXISTS accounts (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  slug           TEXT NOT NULL UNIQUE,
  status         TEXT NOT NULL DEFAULT 'active',      -- active | suspended | closed
  plan_id        TEXT,
  billing_email  TEXT NOT NULL DEFAULT '',
  suspended_at   TEXT,
  suspend_reason TEXT NOT NULL DEFAULT '',
  -- Chat Pilot's own monthly AI spend guardrail. It is set by the customer and
  -- compared against estimated cost; it is NOT read from a provider account.
  monthly_budget_cents INTEGER NOT NULL DEFAULT 0,   -- 0 = no budget set
  budget_alert_percent INTEGER NOT NULL DEFAULT 80,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  FOREIGN KEY (plan_id) REFERENCES plans (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts (status);

CREATE TABLE IF NOT EXISTS account_members (
  id         TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'owner',           -- owner | admin | member
  created_at TEXT NOT NULL,
  UNIQUE (account_id, user_id),
  FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_members_user ON account_members (user_id);

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  ip_hash       TEXT NOT NULL DEFAULT '',
  user_agent    TEXT NOT NULL DEFAULT '',
  csrf_token    TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  revoked_at    TEXT,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS password_resets (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- ------------------------------------------------------- plans / billing --

CREATE TABLE IF NOT EXISTS plans (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  slug                  TEXT NOT NULL UNIQUE,
  price_cents           INTEGER NOT NULL DEFAULT 0,
  currency              TEXT NOT NULL DEFAULT 'USD',
  max_websites          INTEGER NOT NULL DEFAULT 1,
  max_documents         INTEGER NOT NULL DEFAULT 500,
  max_messages_month    INTEGER NOT NULL DEFAULT 2000,
  max_storage_mb        INTEGER NOT NULL DEFAULT 100,
  features              TEXT NOT NULL DEFAULT '{}',
  is_active             INTEGER NOT NULL DEFAULT 1,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                   TEXT PRIMARY KEY,
  account_id           TEXT NOT NULL,
  plan_id              TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'active', -- active | trialing | past_due | canceled
  current_period_start TEXT NOT NULL,
  current_period_end   TEXT NOT NULL,
  external_ref         TEXT NOT NULL DEFAULT '',
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id) REFERENCES plans (id)
);
CREATE INDEX IF NOT EXISTS idx_subs_account ON subscriptions (account_id);

-- --------------------------------------------------------------- websites --

CREATE TABLE IF NOT EXISTS websites (
  id              TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL,
  name            TEXT NOT NULL,
  primary_domain  TEXT NOT NULL,              -- normalised host, e.g. "example.com"
  url             TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'active',   -- active | inactive | suspended
  suspend_reason  TEXT NOT NULL DEFAULT '',
  timezone        TEXT NOT NULL DEFAULT 'UTC',
  -- Ownership proof: the plugin must echo this token back from the site.
  verification_token   TEXT NOT NULL,
  verified_at          TEXT,
  last_connected_at    TEXT,
  connected_plugin_ver TEXT NOT NULL DEFAULT '',
  -- Conversation lifecycle, per website.
  inactivity_timeout_minutes INTEGER NOT NULL DEFAULT 30,
  retention_days             INTEGER NOT NULL DEFAULT 90,  -- 0 = keep forever
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (account_id, primary_domain),
  FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_websites_account ON websites (account_id);
CREATE INDEX IF NOT EXISTS idx_websites_domain ON websites (primary_domain);

-- Additional hostnames allowed for one website (www, staging, etc).
CREATE TABLE IF NOT EXISTS website_domains (
  id         TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  website_id TEXT NOT NULL,
  domain     TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (website_id, domain),
  FOREIGN KEY (website_id) REFERENCES websites (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_website_domains_domain ON website_domains (domain);

-- ---------------------------------------------------------- site api keys --

CREATE TABLE IF NOT EXISTS site_api_credentials (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL,
  website_id    TEXT NOT NULL,
  -- Non-secret handle embedded in the key, used for O(1) lookup.
  key_id        TEXT NOT NULL UNIQUE,
  -- HMAC-SHA256(SITE_KEY_PEPPER, plaintext). The plaintext is never stored.
  key_hash      TEXT NOT NULL,
  key_prefix    TEXT NOT NULL DEFAULT 'cp_live_',
  last_four     TEXT NOT NULL DEFAULT '',
  label         TEXT NOT NULL DEFAULT 'Primary',
  status        TEXT NOT NULL DEFAULT 'active',   -- active | revoked
  last_used_at  TEXT,
  last_used_ip  TEXT NOT NULL DEFAULT '',
  revoked_at    TEXT,
  created_at    TEXT NOT NULL,
  FOREIGN KEY (website_id) REFERENCES websites (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_site_keys_website ON site_api_credentials (website_id);
CREATE INDEX IF NOT EXISTS idx_site_keys_hash ON site_api_credentials (key_hash);

-- --------------------------------------------------------- ai providers ----

-- The customer's own provider key (OpenAI / Gemini / ...), encrypted at rest.
CREATE TABLE IF NOT EXISTS ai_provider_credentials (
  id             TEXT PRIMARY KEY,
  account_id     TEXT NOT NULL,
  website_id     TEXT NOT NULL,
  provider       TEXT NOT NULL,                    -- openai | gemini | ...
  -- AES-256-GCM envelope. Never leaves the server.
  api_key_enc    TEXT NOT NULL,
  api_key_masked TEXT NOT NULL DEFAULT '',
  base_url       TEXT NOT NULL DEFAULT '',
  org_id         TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'not_configured',
  status_detail  TEXT NOT NULL DEFAULT '',
  last_tested_at TEXT,
  last_success_at TEXT,
  last_failure_at TEXT,
  latency_ms     REAL NOT NULL DEFAULT 0,
  error_count    INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (website_id, provider),
  FOREIGN KEY (website_id) REFERENCES websites (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_provider_creds_account ON ai_provider_credentials (account_id);

-- Which provider/model a website actually uses, plus discovered model cache.
CREATE TABLE IF NOT EXISTS ai_provider_configs (
  id                 TEXT PRIMARY KEY,
  account_id         TEXT NOT NULL,
  website_id         TEXT NOT NULL UNIQUE,
  active_provider    TEXT NOT NULL DEFAULT '',
  active_model       TEXT NOT NULL DEFAULT '',
  temperature        REAL NOT NULL DEFAULT 0.4,
  max_output_tokens  INTEGER NOT NULL DEFAULT 800,
  retrieval_threshold REAL NOT NULL DEFAULT 3.0,
  max_history_messages INTEGER NOT NULL DEFAULT 20,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  FOREIGN KEY (website_id) REFERENCES websites (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_provider_models (
  id           TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL,
  website_id   TEXT NOT NULL,
  provider     TEXT NOT NULL,
  model_id     TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  discovered_at TEXT NOT NULL,
  UNIQUE (website_id, provider, model_id),
  FOREIGN KEY (website_id) REFERENCES websites (id) ON DELETE CASCADE
);

-- ------------------------------------------------------------- knowledge --

CREATE TABLE IF NOT EXISTS knowledge_sources (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL,
  website_id    TEXT NOT NULL,
  type          TEXT NOT NULL,                 -- website | manual | file | faq
  name          TEXT NOT NULL,
  config        TEXT NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'pending', -- pending|processing|completed|failed
  error_message TEXT NOT NULL DEFAULT '',
  last_sync_at  TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  FOREIGN KEY (website_id) REFERENCES websites (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ks_website ON knowledge_sources (website_id, type);

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL,
  website_id  TEXT NOT NULL,
  source_id   TEXT NOT NULL,
  source_type TEXT NOT NULL,                   -- denormalised for retrieval speed
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  source_url  TEXT NOT NULL DEFAULT '',
  category    TEXT NOT NULL DEFAULT '',
  metadata    TEXT NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'enabled', -- enabled | disabled
  word_count  INTEGER NOT NULL DEFAULT 0,
  checksum    TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES knowledge_sources (id) ON DELETE CASCADE,
  FOREIGN KEY (website_id) REFERENCES websites (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_kd_website ON knowledge_documents (website_id, status);
CREATE INDEX IF NOT EXISTS idx_kd_source ON knowledge_documents (source_id);

CREATE TABLE IF NOT EXISTS uploaded_files (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL,
  website_id    TEXT NOT NULL,
  source_id     TEXT,
  original_name TEXT NOT NULL,
  stored_path   TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  checksum      TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  FOREIGN KEY (website_id) REFERENCES websites (id) ON DELETE CASCADE
);

-- ------------------------------------------------------- ai instructions --

CREATE TABLE IF NOT EXISTS ai_instructions (
  id                     TEXT PRIMARY KEY,
  account_id             TEXT NOT NULL,
  website_id             TEXT NOT NULL UNIQUE,
  business_name          TEXT NOT NULL DEFAULT '',
  system_prompt          TEXT NOT NULL DEFAULT '',
  tone                   TEXT NOT NULL DEFAULT 'professional',
  answer_length          TEXT NOT NULL DEFAULT 'concise',
  fallback_response      TEXT NOT NULL DEFAULT '',
  greeting_response      TEXT NOT NULL DEFAULT '',
  generation_error_response TEXT NOT NULL DEFAULT '',
  allow_small_talk       INTEGER NOT NULL DEFAULT 1,
  strict_grounding       INTEGER NOT NULL DEFAULT 1,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  FOREIGN KEY (website_id) REFERENCES websites (id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------- widget --

CREATE TABLE IF NOT EXISTS widget_settings (
  id                   TEXT PRIMARY KEY,
  account_id           TEXT NOT NULL,
  website_id           TEXT NOT NULL UNIQUE,
  enabled              INTEGER NOT NULL DEFAULT 1,
  display_name         TEXT NOT NULL DEFAULT 'Chat Pilot',
  position             TEXT NOT NULL DEFAULT 'bottom-right',
  primary_color        TEXT NOT NULL DEFAULT '#0678f9',
  logo_url             TEXT NOT NULL DEFAULT '',
  welcome_message      TEXT NOT NULL DEFAULT 'Hi there! How can I help you today?',
  placeholder_text     TEXT NOT NULL DEFAULT 'Ask a question...',
  suggested_questions  TEXT NOT NULL DEFAULT '',
  enable_typing        INTEGER NOT NULL DEFAULT 1,
  enable_streaming     INTEGER NOT NULL DEFAULT 1,
  auto_open_chat       INTEGER NOT NULL DEFAULT 0,
  auto_open_delay      INTEGER NOT NULL DEFAULT 5,
  open_once_per_visitor INTEGER NOT NULL DEFAULT 1,
  -- Explicit off switch. A NULL active_form_id means "fall back to the default
  -- form", which is a different state from "the customer turned pre-chat off".
  prechat_enabled      INTEGER NOT NULL DEFAULT 1,
  active_form_id       TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  FOREIGN KEY (website_id) REFERENCES websites (id) ON DELETE CASCADE
);

-- ----------------------------------------------------------------- forms --

CREATE TABLE IF NOT EXISTS forms (
  id         TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  website_id TEXT NOT NULL,
  name       TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (website_id) REFERENCES websites (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_forms_website ON forms (website_id);

CREATE TABLE IF NOT EXISTS form_fields (
  id           TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL,
  website_id   TEXT NOT NULL,
  form_id      TEXT NOT NULL,
  field_key    TEXT NOT NULL,
  type         TEXT NOT NULL,        -- text|email|phone|textarea|dropdown|checkbox|radio
  label        TEXT NOT NULL,
  placeholder  TEXT NOT NULL DEFAULT '',
  options      TEXT NOT NULL DEFAULT '',
  required     INTEGER NOT NULL DEFAULT 0,
  enabled      INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (form_id) REFERENCES forms (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_form_fields_form ON form_fields (form_id);

CREATE TABLE IF NOT EXISTS visitors (
  id             TEXT PRIMARY KEY,
  account_id     TEXT NOT NULL,
  website_id     TEXT NOT NULL,
  visitor_key    TEXT NOT NULL,        -- opaque id minted by the widget
  name           TEXT NOT NULL DEFAULT '',
  email          TEXT NOT NULL DEFAULT '',
  phone          TEXT NOT NULL DEFAULT '',
  ip_hash        TEXT NOT NULL DEFAULT '',
  user_agent     TEXT NOT NULL DEFAULT '',
  first_seen_at  TEXT NOT NULL,
  last_seen_at   TEXT NOT NULL,
  UNIQUE (website_id, visitor_key),
  FOREIGN KEY (website_id) REFERENCES websites (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS form_submissions (
  id              TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL,
  website_id      TEXT NOT NULL,
  form_id         TEXT NOT NULL,
  conversation_id TEXT,
  visitor_id      TEXT,
  session_key     TEXT NOT NULL DEFAULT '',
  name            TEXT NOT NULL DEFAULT '',
  email           TEXT NOT NULL DEFAULT '',
  phone           TEXT NOT NULL DEFAULT '',
  fields          TEXT NOT NULL DEFAULT '{}',
  page_url        TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL,
  FOREIGN KEY (website_id) REFERENCES websites (id) ON DELETE CASCADE,
  FOREIGN KEY (form_id) REFERENCES forms (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_submissions_website ON form_submissions (website_id);
CREATE INDEX IF NOT EXISTS idx_submissions_session ON form_submissions (website_id, session_key);

-- --------------------------------------------------------- conversations --

CREATE TABLE IF NOT EXISTS conversations (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL,
  website_id    TEXT NOT NULL,
  visitor_id    TEXT,
  form_id       TEXT,
  session_key   TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'widget',    -- widget | preview
  status        TEXT NOT NULL DEFAULT 'active',    -- active | completed | archived
  is_read       INTEGER NOT NULL DEFAULT 0,
  visitor_name  TEXT NOT NULL DEFAULT '',
  visitor_email TEXT NOT NULL DEFAULT '',
  visitor_phone TEXT NOT NULL DEFAULT '',
  summary       TEXT NOT NULL DEFAULT '',
  page_url      TEXT NOT NULL DEFAULT '',
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  UNIQUE (website_id, session_key),
  FOREIGN KEY (website_id) REFERENCES websites (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_conv_website ON conversations (website_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conv_status ON conversations (website_id, status);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL,
  website_id      TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  role            TEXT NOT NULL,                 -- user | assistant | system
  content         TEXT NOT NULL,
  seq             INTEGER NOT NULL DEFAULT 0,
  metadata        TEXT NOT NULL DEFAULT '{}',
  created_at      TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages (conversation_id, seq);

-- ----------------------------------------------------------- ai requests --

CREATE TABLE IF NOT EXISTS ai_requests (
  id              TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL,
  website_id      TEXT NOT NULL,
  conversation_id TEXT,
  provider        TEXT NOT NULL DEFAULT '',
  model           TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL,   -- success | fallback | provider_error | blocked
  error_type      TEXT NOT NULL DEFAULT '',
  error_label     TEXT NOT NULL DEFAULT '',
  http_status     INTEGER NOT NULL DEFAULT 0,
  intent          TEXT NOT NULL DEFAULT '',
  retrieval_hit   INTEGER NOT NULL DEFAULT 0,
  top_score       REAL NOT NULL DEFAULT 0,
  sources_used    TEXT NOT NULL DEFAULT '',
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  total_tokens    INTEGER NOT NULL DEFAULT 0,
  estimated_cost  REAL NOT NULL DEFAULT 0,
  latency_ms      REAL NOT NULL DEFAULT 0,
  source          TEXT NOT NULL DEFAULT 'widget',
  created_at      TEXT NOT NULL,
  FOREIGN KEY (website_id) REFERENCES websites (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_airq_website ON ai_requests (website_id, created_at);
CREATE INDEX IF NOT EXISTS idx_airq_account ON ai_requests (account_id, created_at);

CREATE TABLE IF NOT EXISTS usage_records (
  id             TEXT PRIMARY KEY,
  account_id     TEXT NOT NULL,
  website_id     TEXT NOT NULL,
  period         TEXT NOT NULL,          -- YYYY-MM
  messages       INTEGER NOT NULL DEFAULT 0,
  ai_requests    INTEGER NOT NULL DEFAULT 0,
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  total_tokens   INTEGER NOT NULL DEFAULT 0,
  estimated_cost REAL NOT NULL DEFAULT 0,
  updated_at     TEXT NOT NULL,
  UNIQUE (website_id, period),
  FOREIGN KEY (website_id) REFERENCES websites (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_usage_account_period ON usage_records (account_id, period);

CREATE TABLE IF NOT EXISTS analytics_events (
  id         TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  website_id TEXT NOT NULL,
  event      TEXT NOT NULL,
  payload    TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (website_id) REFERENCES websites (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_events_website ON analytics_events (website_id, created_at);

-- ------------------------------------------------- ops / audit / notices --

CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  account_id  TEXT,
  website_id  TEXT,
  type        TEXT NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'info',
  recipient   TEXT NOT NULL DEFAULT '',
  subject     TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  dedupe_key  TEXT NOT NULL DEFAULT '',
  delivered   INTEGER NOT NULL DEFAULT 0,
  delivery_error TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_dedupe ON notifications (dedupe_key, created_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id            TEXT PRIMARY KEY,
  account_id    TEXT,
  website_id    TEXT,
  actor_type    TEXT NOT NULL,          -- user | super_admin | site_key | system
  actor_id      TEXT NOT NULL DEFAULT '',
  action        TEXT NOT NULL,
  target_type   TEXT NOT NULL DEFAULT '',
  target_id     TEXT NOT NULL DEFAULT '',
  ip_hash       TEXT NOT NULL DEFAULT '',
  metadata      TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_account ON audit_logs (account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs (action, created_at);

CREATE TABLE IF NOT EXISTS system_logs (
  id         TEXT PRIMARY KEY,
  account_id TEXT,
  website_id TEXT,
  level      TEXT NOT NULL,
  message    TEXT NOT NULL,
  context    TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_syslog_created ON system_logs (created_at);

CREATE TABLE IF NOT EXISTS platform_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
