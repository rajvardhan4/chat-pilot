# Chat Pilot

Chat Pilot is now two connected systems:

| | What it is | Where |
|---|---|---|
| **Chat Pilot Cloud** | The multi-tenant SaaS control plane. Owns AI providers, models, knowledge, instructions, the response engine, conversations, leads, analytics, billing and platform administration. | [`saas/`](saas) |
| **Chat Pilot for WordPress** | The site-side connector. Owns the visitor-facing widget and the WordPress integration. Holds exactly one secret: the Site API Key. | [`wordpress-plugin/chat-pilot/`](wordpress-plugin/chat-pilot) |

The original v1.1.7 plugin is preserved unmodified in [`_reference/`](_reference)
for comparison.

**Documentation**
* **[How to run it](docs/RUNNING.md)** — setup, the plugin ZIP, and the version-bump rule
* **[How to deploy it](docs/DEPLOY.md)** — VPS, systemd, nginx, HTTPS, backups, auto-deploy on push
* [Architecture map](docs/ARCHITECTURE-MAP.md) — the v1 product, and where every part lives now
* [Site API contract](docs/API.md) — the plugin ↔ Cloud protocol

---

## Quick start

### 1. Run Chat Pilot Cloud

Requires **Node.js 22.6+** (24.x recommended). No build step, no native modules.

```bash
cd saas
npm install
cp .env.example .env
```

Generate the three secrets and put them in `.env`:

```bash
node -e "for (const k of ['ENCRYPTION_KEY','SESSION_SECRET','SITE_KEY_PEPPER']) console.log(k + '=' + require('crypto').randomBytes(32).toString('hex'))"
```

Then seed and start:

```bash
npm run seed     # migrations + default plans + super admin (if configured)
npm start        # http://localhost:4000
```

To create the platform administrator, set `SUPERADMIN_EMAIL` and
`SUPERADMIN_PASSWORD` in `.env` before running `npm run seed`.

### 2. Set up a customer

1. Sign up at `http://localhost:4000/signup`.
2. Register a website (the domain you enter is the only domain its key will work on).
3. **AI Providers** → choose your provider (OpenAI, Anthropic/Claude, Google Gemini, Mistral,
   Groq, DeepSeek, Together AI, OpenRouter, or any OpenAI-compatible endpoint) → paste that
   provider's own API key → *Test connection & discover models* → pick a model.
4. **Knowledge Base** → scan the site, add FAQs, paste manual facts, upload documents.
5. **AI Instructions** → tone, length, fallback copy.
6. **Developer Chat Preview** → verify answers, with full diagnostics.
7. **Connection** → *Generate key*. Copy it — it is shown once.

Every screen has a day/night toggle in the header. Light is the default; the
choice is remembered per browser.

### Master Admin

`/signup` only ever creates a customer account. Platform access is granted from
the server that holds the database:

```bash
cd saas
npm run admin:create -- --email you@yourcompany.com --name "Your Name"
```

Sign in at `/login` and you land on `/admin` instead of the client portal —
customers, websites, plans, system health and the audit log. Customers' AI
provider keys are encrypted and are never shown there either.

### 3. Install the plugin

1. Build the installable ZIP (or use the one already in `dist/plugin/`):

   ```bash
   npm run plugin:build      # -> dist/plugin/chat-pilot-<version>.zip
   ```

   Upload it in WordPress: **Plugins → Add New → Upload Plugin**.

2. If your Cloud install is not at the default endpoint, add to `wp-config.php`:

   ```php
   define( 'CHAT_PILOT_API_URL', 'https://your-chat-pilot-host' );
   ```

3. **Chat Pilot → Connection** → paste the Site API Key → *Connect Chat Pilot*.

The widget goes live immediately.

### 4. Changing the plugin later

Always bump the version — WordPress caches plugin assets by version, so shipping
changed code under the same version leaves browsers serving stale CSS and JS.

```bash
npm run plugin:patch    # 2.0.0 -> 2.0.1   fixes
npm run plugin:minor    # 2.0.0 -> 2.1.0   features
npm run plugin:major    # 2.0.0 -> 3.0.0   breaking changes
```

Each writes the version to **both** places it lives (the plugin header and the
`CHAT_PILOT_VERSION` constant) and produces a new `dist/plugin/chat-pilot-<version>.zip`.
If the two ever disagree the build refuses to run. Full details in
[docs/RUNNING.md](docs/RUNNING.md).

---

## Tests

```bash
cd saas
npm test
```

183 tests across 12 files. They start the real server on an ephemeral port and
drive it over HTTP — nothing is stubbed except the AI provider, which uses a
deterministic mock adapter that is refused outright in production.

| File | Covers |
|---|---|
| `01-auth` | signup, login, lockout, password reset, CSRF |
| `02-tenancy` | cross-tenant reads/writes, retrieval isolation, plan limits |
| `03-site-api` | key format, HMAC, replay, tampering, domain binding, lifecycle |
| `04-ai-engine` | retrieval, source priority, follow-ups, topic switching, greetings, provider failures |
| `05-forms-widget` | widget config propagation, form validation, lead linking, visitor separation |
| `06-knowledge` | manual/FAQ/upload ingestion, MIME and magic-byte checks, crawler guards |
| `07-admin` | super-admin dashboard, suspension, revocation, plans, pricing, authorisation |
| `08-security` | secret storage, log redaction, injection, headers, rate limiting, error hygiene |
| `09-end-to-end` | the full signup → connect → chat → analytics path |
| `10-wordpress-plugin` | the **real plugin PHP** driven against the **real server** |
| `11-budget-maintenance` | budget maths and alerts, conversation timeout and retention |

### The WordPress plugin test

`10-wordpress-plugin.test.ts` loads the actual plugin source on a minimal
WordPress shim (`tests/wp-harness/`) and drives connect → config → form →
chat → follow-up → health → disconnect against a live server. It executes the
same files that ship to a customer site; nothing is re-implemented.

It needs a PHP binary (7.4+, with cURL):

```bash
CHAT_PILOT_PHP_BIN=/path/to/php npm test    # or just have `php` on PATH
```

Without PHP the file **skips and says so** rather than passing quietly.

---

## Layout

```
saas/
  src/
    config/       validated env (nothing else reads process.env)
    core/         errors, crypto, logging + redaction, validation, domain rules
    db/           schema.sql, migrations, thin typed wrapper over node:sqlite
    providers/    adapter contract + 9 providers (openai, anthropic, gemini,
                  mistral, groq, deepseek, together, openrouter, custom), registry
    middleware/   security headers, rate limit, session/CSRF, site HMAC auth, errors
    services/     one module per domain concept
    routes/       siteApi (plugin), portal (customer), admin (platform), portalApi
    views/        EJS, Chat Pilot design system
    public/       css + js, no build step
  tests/
    wp-harness/   WordPress shim + plugin driver (PHP)

wordpress-plugin/chat-pilot/
  includes/Api/         signed client, connection state, config cache
  includes/Core/        plugin, lifecycle, frontend widget, REST ownership route
  includes/Admin/       menu, tabs, assets, AJAX (2 public + 6 admin routes)
  templates/            admin screens
  assets/               widget + admin CSS/JS

docs/                   architecture map, API contract
_reference/chat-pilot/  the untouched v1.1.7 plugin
```

---

## Security summary

* Provider keys: AES-256-GCM at rest, decrypted only inside the generation path, never returned by any route.
* Site API keys: shown once, stored as HMAC-SHA256 with a server-side pepper, revocable instantly.
* Every plugin request: HMAC-signed, timestamped, nonce-protected, body-hash bound.
* Tenant boundary: two functions, both returning 404 for another tenant's id.
* Portal: signed HttpOnly SameSite cookie, server-side sessions, CSRF on every write.
* Passwords: scrypt with a per-user salt; lockout after repeated failures.
* Output: HTML stripped from model answers; EJS escapes everything by default; CSP without `unsafe-inline` for scripts.
* Logs: credential patterns redacted before anything is written.
* Uploads: extension, declared MIME **and** magic bytes checked; stored under an opaque per-tenant path.
* Errors: only `AppError.publicMessage` ever leaves the server.

---

## Production configuration

| Setting | Value |
|---|---|
| `NODE_ENV` | `production` |
| `FORCE_HTTPS` | `true` |
| `TRUST_PROXY` | `true` only behind a trusted reverse proxy |
| `ENCRYPTION_KEY` / `SESSION_SECRET` / `SITE_KEY_PEPPER` | required; startup fails without them |
| `CHAT_PILOT_ENABLE_MOCK_PROVIDER` | must be unset — the mock is refused in production regardless |
| `MAIL_TRANSPORT` | `log` bundled; wire SMTP for real delivery |
| `DATABASE_FILE` | SQLite by default; see below |

**Database.** The schema is portable relational SQL and everything above
`src/db/index.ts` speaks only `get/all/run/tx`, so moving to Postgres is a
rewrite of that one file. SQLite is appropriate for a single-node install and
is what the test suite exercises.

**Still to wire for production:** an SMTP transport, a payment processor
(plans, limits and subscription state are complete and enforced; only card
collection is absent), and object storage if you want uploads off local disk.
