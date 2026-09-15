# Running Chat Pilot

Two things run: **Chat Pilot Cloud** (the server) and the **WordPress plugin**
(installed on your site). The plugin is useless on its own — start the server
first.

---

## Part 1 — Start Chat Pilot Cloud

Needs **Node.js 22.6 or newer** (`node -v` to check). No build step.

### 1.1 Install

```bash
cd "C:\Projects\Chat Pilot Project\saas"
npm install
```

### 1.2 Create the config file

```bash
copy .env.example .env
```

Generate the three required secrets:

```bash
node -e "for (const k of ['ENCRYPTION_KEY','SESSION_SECRET','SITE_KEY_PEPPER']) console.log(k+'='+require('crypto').randomBytes(32).toString('hex'))"
```

Paste those three lines into `.env`, replacing the empty ones. Then set the
admin login you want:

```
SUPERADMIN_EMAIL=you@yourcompany.com
SUPERADMIN_PASSWORD=ChooseAStrongPassword123!
```

> These three secrets matter. `ENCRYPTION_KEY` decrypts every stored AI provider
> key, and `SITE_KEY_PEPPER` verifies every Site API Key. Change either one
> later and existing provider keys stop decrypting and every installed plugin
> disconnects. Set them once, back them up, leave them alone.

### 1.3 Seed and start

```bash
npm run seed
npm start
```

Open **http://localhost:4000**.

To stop the server: `Ctrl+C`.

### 1.4 The two kinds of login

There is one sign-in page, `/login`, and it sends you to a different place
depending on who you are.

| | Client | Master Admin |
| --- | --- | --- |
| How the account is created | `/signup`, self-service | only from the server, see below |
| Lands on | `/app` — their own websites | `/admin` — the whole platform |
| Can see | only their own account's data | every account, website, plan and audit entry |
| Can see customers' AI provider keys | n/a | **no** — keys are encrypted and are never shown to anyone, including you |

**Master Admin is deliberately not something anyone can sign up for.** The
signup form only ever creates a customer account. The only way to get platform
privileges is to run this on the machine that holds the database:

```bash
npm run admin:create -- --email you@yourcompany.com --name "Your Name"
```

That prints a generated password once — copy it, sign in at `/login`, and you
land on `/admin`. To choose the password yourself, add `--password 'at least 12
characters'`. Running it again for an email that already exists promotes that
user to master admin instead of creating a second account, which is how you give
a colleague access.

`npm run seed` also creates one from `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD`
if you set them in `.env`. Either route works; the command above is the one to
use once the server is already running.

The Master Admin screens are Dashboard, Customers, Websites, Plans & Pricing,
System Health and Audit Log. A master admin can also open `/app` (there is a
**Client portal** button in the header) to see the portal the way a customer
does.

---

## Part 2 — Set up a customer account

In the browser at http://localhost:4000:

1. **Sign up** — name, company, email, password.
2. **Register a website.** Enter the real URL of the WordPress site you will
   install the plugin on. The Site API Key will only work on this domain.
3. **AI Providers** — one dropdown drives this screen. Pick the AI you want to
   use, and the page shows you where to get that provider's API key, a field to
   paste it into (masked, with an eye button to check it), and then the models
   your key can actually reach.

   The order is always the same three steps:

   1. **Get your API key** — the page links straight to that provider's key page.
   2. **Paste the API key** → **Save key** → **Test connection & find models**.
   3. **Choose the model** → **Use this AI on my website**.

   A provider cannot go live until its connection test has actually passed, so a
   typo in a key can never leave the site pointing at an AI that does not answer.

   | Provider | Key looks like | Where to get one |
   | --- | --- | --- |
   | OpenAI | `sk-...` | platform.openai.com/api-keys |
   | Anthropic (Claude) | `sk-ant-...` | console.anthropic.com/settings/keys |
   | Google Gemini | `AIza...` | aistudio.google.com/apikey |
   | Mistral AI | — | console.mistral.ai/api-keys |
   | Groq | `gsk_...` | console.groq.com/keys |
   | DeepSeek | `sk-...` | platform.deepseek.com/api_keys |
   | Together AI | — | api.together.xyz/settings/api-keys |
   | OpenRouter | `sk-or-...` | openrouter.ai/keys |
   | Custom (OpenAI-compatible) | any | your own gateway, vLLM, Ollama, LM Studio |

   Models are read live from your provider account on every test — nothing is
   hardcoded, so a retired model disappears on the next test. If a gateway does
   not implement `/models`, the dropdown is replaced by a text field so you can
   type the model id yourself.

4. **Knowledge Base** — scan your site, add FAQs, paste key facts, upload docs.
5. **AI Instructions** — tone, length, and the fallback wording.
6. **Developer Chat Preview** — ask a few real questions. This uses the exact
   same engine as the live widget, so if it answers well here it will answer
   well on the site.
7. **Connection → Generate key.** Copy the key immediately.

> The key is shown **once**. It is stored only as a hash, so nobody — including
> us — can retrieve it later. Lost it? Generate a new one and revoke the old.

---

## Part 3 — Install the WordPress plugin

### 3.1 The file to upload

```
C:\Projects\Chat Pilot Project\dist\chat-pilot-2.0.0.zip
```

If it is not there, build it:

```bash
cd "C:\Projects\Chat Pilot Project"
npm run plugin:build
```

### 3.2 Upload and activate

WordPress admin → **Plugins → Add New → Upload Plugin** → choose the ZIP →
**Install Now** → **Activate**.

### 3.3 Point the plugin at your server

The plugin ships pointing at `https://app.chatpilot.cloud`. Unless that is
where your server actually lives, tell it otherwise on
**Chat Pilot → Connection → Chat Pilot Cloud address**: paste the URL, press
**Save address**.

Use whatever URL your server is reachable at *from the WordPress machine*. If
WordPress runs in Docker or a VM, `localhost` there is not your machine — use
the host IP or a tunnel.

To pin it at server level instead, so nobody with wp-admin access can change
where this site sends its signed requests, add this to `wp-config.php` **above**
the `/* That's all, stop editing! */` line:

```php
define( 'CHAT_PILOT_API_URL', 'http://localhost:4000' );
```

With that constant present the field on the Connection tab becomes read-only and
says so.

### 3.4 Connect

**Chat Pilot → Connection** → paste the Site API Key → **Connect Chat Pilot**.

You should see **Connected**, your website name and the registered domain. The
widget is now live on the front end.

The key field is masked; the eye button beside it reveals what you pasted, which
is worth a glance before pressing Connect.

### 3.5 What the plugin screen does and does not do

The plugin has four tabs, and they cover only what this WordPress install
actually owns:

| Tab | What it does |
| --- | --- |
| Dashboard | live status, plus links into every Chat Pilot Cloud screen |
| Connection | the Site API Key and the Cloud address |
| Chat Widget | whether the widget may render here, and on which pages |
| Settings | logging, developer mode, the local plugin log |

Everything that shapes an answer — provider, model, knowledge, instructions,
widget design, forms, conversations, analytics — is edited in Chat Pilot Cloud,
never in WordPress. Two editable copies of that data is how a site ends up
saying one thing while the engine believes another.

---

## Part 4 — Making changes to the plugin

**Always bump the version.** WordPress caches plugin assets by version, so
shipping changed code under the same version means browsers keep serving the
old CSS and JS, and the site reports a version it is not running.

Edit files under `wordpress-plugin/chat-pilot/`, then:

```bash
cd "C:\Projects\Chat Pilot Project"

npm run plugin:patch    # 2.0.0 -> 2.0.1   bug fix, copy change, styling
npm run plugin:minor    # 2.0.0 -> 2.1.0   new feature, backwards compatible
npm run plugin:major    # 2.0.0 -> 3.0.0   breaking change
```

Each command updates the version **in both places it lives** (the plugin header
WordPress reads, and the `CHAT_PILOT_VERSION` constant used for cache-busting
and sent to Chat Pilot Cloud), then writes a new
`dist/plugin/chat-pilot-<version>.zip`.

If the two versions ever disagree the build **refuses to run** rather than
producing a broken plugin. Fix it with an exact version:

```bash
node scripts/build-plugin.mjs --set 2.1.3
```

Old ZIPs stay in `dist/`, so you can always roll back by re-uploading a previous
version.

### Updating a live site

**Plugins → Add New → Upload Plugin → choose the new ZIP → Install Now.**
WordPress sees that `chat-pilot` is already installed and offers **Replace
current with uploaded** — take it. The Site API Key and every setting survive,
because they live in `wp_options` and an update never touches them.

Or replace `wp-content/plugins/chat-pilot/` over FTP/SSH with the new files,
which amounts to the same thing.

> **Do not Delete the plugin to update it.** Deleting runs `uninstall.php`,
> which removes the Site API Key, the connection state and the cached widget
> config by design — that is what uninstalling is supposed to do. The site then
> has to be connected again with a fresh key from the dashboard. Use Replace
> current with uploaded instead; deleting is for removing Chat Pilot, not for
> upgrading it.

After updating, open **Chat Pilot → Connection** and press **Re-check
connection** to confirm the new version registered.

---

## Part 5 — Running the tests

```bash
cd "C:\Projects\Chat Pilot Project\saas"
npm test
```

183 tests. One file drives the real plugin PHP against a real server and needs
PHP available:

```bash
set CHAT_PILOT_PHP_BIN=C:\path\to\php.exe
npm test
```

Without PHP that file reports
`﹣ WordPress plugin against a live Chat Pilot server # PHP is not installed on this machine`
rather than quietly passing.

---

## Troubleshooting

**"Chat Pilot could not be reached"** — WordPress cannot make an outbound
request to your server. Check `CHAT_PILOT_API_URL`, that the server is running,
and that no firewall or security plugin is blocking outbound HTTP.

**"This key is registered to a different domain"** — the site URL does not match
the domain you registered. Fix the Website URL on the Connection screen in the
portal, or add the hostname under *Additional allowed domains*.

**"That Site API Key was not recognised"** — wrong key, or it was revoked.
Generate a fresh one.

**Widget does not appear** — check, in order: Connection says Connected; the
widget is enabled in the portal under Chat Widget; the plugin is enabled under
Chat Pilot → Settings; your display rules are not excluding the page.

**Bot always says it cannot find the information** — that is the Missing
Knowledge Fallback: retrieval found nothing relevant. Use *Retrieval
Diagnostics* on the Knowledge Base screen to see the actual scores.

**Bot says it is having trouble generating a response** — different problem:
the AI provider failed. Check AI Providers in the portal; usually an expired key
or an exhausted quota.

---

## For production

| Setting | Value |
|---|---|
| `NODE_ENV` | `production` |
| `APP_URL` | your real HTTPS URL |
| `FORCE_HTTPS` | `true` |
| `TRUST_PROXY` | `true` only behind a trusted reverse proxy |
| the three secrets | required — the server refuses to boot without them |

Run the server under a process manager (pm2, systemd, Windows Service) behind
nginx or IIS with TLS. Back up `saas/data/` and your `.env`.
