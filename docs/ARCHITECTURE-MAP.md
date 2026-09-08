# Chat Pilot — Architecture Map

This is the map of the product **as it was** (plugin v1.1.7), and where each part
lives **now** (Chat Pilot Cloud + plugin v2.0.0). It was written by reading the
whole v1 source before any code was changed, and it is the reference for what
moved, what stayed, and what was deliberately replaced.

---

## 1. The v1 plugin, as found

`chat-pilot.zip` — 51 files, ~19,950 lines.

| Area | v1 files | Lines | What it did |
|---|---|---|---|
| Bootstrap | `chat-pilot.php`, `Autoloader.php`, `Core/Plugin.php`, `Core/Lifecycle.php` | 216 | Constants, PSR-4 autoload, singleton container, activation + table creation |
| Admin shell | `Admin/Menu.php`, `Admin/TabsController.php`, `Admin/Assets.php` | 255 | Top-level menu, 11-tab router, asset enqueue + `wp_localize_script` |
| Admin UI | `templates/*.php` (14 files) | 4,152 | Dashboard, Providers, KB, Instructions, Playground, Widget, Forms, Conversations, Analytics, Settings, Support, Security, Database |
| Admin JS | `assets/js/admin-script.js` | 3,745 | All AJAX: provider tests, model discovery, crawler, uploads, form builder, analytics |
| Admin CSS | `assets/css/admin-style.css` | 1,397 | Dark glassmorphic design system |
| AJAX + security | `Security/Verification.php` | 1,964 | **46 AJAX routes**, capability + nonce checks |
| AI engine | `KB/IntelligenceEngine.php` | 866 | Intent, context, prompt assembly, provider call, error categorisation |
| Retrieval | `KB/RetrievalEngine.php` | 421 | TF-IDF keyword ranking, source priority, intent expansion |
| Knowledge | `KB/KBManager.php`, `WebCrawler.php`, `PDFParser.php`, `DocxParser.php`, `TxtParser.php`, `BaseParser.php` | 1,244 | Sources, ingestion, crawling, document parsing |
| Providers | `Providers/*.php` (7 files) | 852 | OpenAI + Gemini adapters, factory, registry, manager |
| Conversations | `Conversations/ConversationManager.php` | 538 | Sessions, transcripts, summaries, status |
| Forms | `Forms/FormManager.php` | 427 | Forms, fields, submissions, conversation linking |
| Analytics | `Analytics/AnalyticsManager.php` | 855 | Token/cost maths, pricing table, reporting |
| Notifications | `Notifications/NotificationManager.php` | 369 | Lead, conversation, budget, provider-failure emails |
| Settings | `Settings/Repository.php`, `Sanitizer.php` | 391 | One `chat_pilot_options` tree, dot-notation access |
| Data | `Database/Schema.php`, `Migration.php` | 208 | 6 custom tables via `dbDelta` |
| Widget | `Core/Frontend.php`, `assets/js/widget-script.js`, `assets/css/widget-style.css` | 1,136 | Launcher, chat window, pre-chat form, streaming |

### v1 database (per WordPress site)

`wp_chat_pilot_logs`, `_kb_sources`, `_kb_documents`, `_conversations`,
`_forms`, `_form_submissions` — **no tenant column anywhere**, because one
install *was* one tenant.

### v1 response pipeline

```
visitor question
  -> classify_intent()                    greeting | small_talk | developer_info | knowledge
  -> resolve_contextual_query_heuristic() rewrite follow-ups
  -> RetrievalEngine::search()            TF-IDF over wp_chat_pilot_kb_documents
  -> threshold filter (default 3.0)
  -> context block assembly
  -> system prompt + guidance + fallback rule
  -> ProviderManager -> OpenAI | Gemini
  -> error categorisation                 quota | auth | timeout | provider
  -> answer -> ConversationManager -> Logger
```

### Defects and constraints found in v1

These are recorded because they shaped the migration, and each one has a
disposition below.

1. **Client-specific vocabulary baked into the engine.**
   `IntelligenceEngine::resolve_contextual_query_heuristic()` matched one
   client's services — `board`, `boarding`, `puppy`, `day training`, `daycare`
   — and mapped them to hardcoded topic strings such as
   `'Board and Train Program'`. `RetrievalEngine::detect_intent()` contained
   another client's terms: `dumpking`, `trailer|demolition|junk|hauling`.
   Neither can exist in a multi-tenant product.
   → **Replaced.** See §3, "Contextual follow-ups".

2. **Provider keys in a WordPress option.**
   `providers.openai.api_key` and `providers.gemini.api_key` sat in plaintext
   in `wp_options`, readable by any code on the site.
   → **Moved and encrypted.** See §2.

3. **Hardcoded model fallbacks.** `GeminiProvider::fetchAvailableModels()`
   appended `gemini-3.6-flash`, `gemini-3.5-flash` and
   `gemini-3.5-flash-lite` to whatever the API returned, and `sendPrompt()`
   silently retried against a hardcoded candidate list — so the model actually
   used could differ from the one selected.
   → **Removed.** Discovery is now provider-reported only, and the selected
   model is the model used.

4. **Privileged AJAX exposed to unauthenticated callers.**
   `chat_pilot_get_key_list` and `chat_pilot_test_notification_delivery` were
   registered with `wp_ajax_nopriv_`.
   → **Removed.** v2 exposes exactly two `nopriv` routes: chat and form submit.

5. **Retrieval false positives.** A single shared word could score highly
   because a title match was weighted 25×IDF with no coverage requirement, so
   an unrelated question could return a confident wrong answer instead of the
   fallback.
   → **Fixed.** See §3, "Retrieval".

6. **Answer post-processing by string surgery.** v1 stripped the developer's
   phone number and email out of generated answers with `str_ireplace`, then
   patched up the resulting punctuation with four regexes.
   → **Replaced** by not putting that data in the prompt at all.

7. **Settings shadowed provider config.** `ai_defaults.default_provider` and
   `default_provider` were both written and read in different places.
   → **Removed.** One row, `ai_provider_configs`, is authoritative.

---

## 2. Where everything lives now

| Concern | v1 | v2 | Why |
|---|---|---|---|
| AI provider credentials | `wp_options`, plaintext | `ai_provider_credentials.api_key_enc`, AES-256-GCM | Never expose a customer's provider key to site code |
| Provider adapters | plugin | SaaS `src/providers/` | One implementation for every tenant |
| Model discovery | plugin, with hardcoded additions | SaaS, provider-reported only | Selected model == used model |
| Retrieval | plugin, per-site tables | SaaS, `(account_id, website_id)` scoped | Tenant isolation |
| Prompt assembly | plugin | SaaS `chatEngine.ts` | The prompt never leaves the server |
| AI Instructions | `wp_options` | `ai_instructions` | Per website, one source of truth |
| Knowledge base | 3 WP tables | `knowledge_sources`, `knowledge_documents`, `uploaded_files` | Tenant-scoped |
| Conversations | `wp_chat_pilot_conversations` (messages as a JSON blob) | `conversations` + `messages` (one row per message) | Queryable, paginable, purgeable |
| Forms | `wp_chat_pilot_forms` (fields as JSON) | `forms` + `form_fields` | Server-side validation against a real schema |
| Analytics | derived from conversation JSON | `ai_requests`, `usage_records`, `analytics_events` | Accurate per-request accounting |
| Cost estimates | hardcoded PHP array | `pricing.ts` + `platform_settings` override | Editable without a deploy |
| Notifications | WP mail | `notifications` table + transport | Storage never depends on delivery |
| Widget appearance | `wp_options` | `widget_settings` | One dashboard for many sites |
| Widget rendering | plugin | **plugin** (unchanged markup) | It is a WordPress concern |
| Display rules (which pages) | — | **plugin** | Genuinely WordPress-only |
| Site enable/disable | plugin | **both** — SaaS owns the widget switch, plugin owns "render on this install" | Different questions |

---

## 3. What was rebuilt rather than ported

### Contextual follow-ups — `src/services/contextResolver.ts`

v1 asked "does the history mention `board`?" and substituted a fixed string.
v2 asks two questions that hold for any business:

1. *Is this message referential?* — it contains a pronoun or elliptical form
   (`it`, `that`, `how much`, `how long`) **and** carries no subject of its
   own, measured by removing "carrier words" that never identify a topic.
2. *What is the active topic?* — the salient terms of recent turns, weighted by
   recency, with the titles of the documents that answered the previous
   question weighted highest, because those name what was actually discussed.

A referential message is searched with the topic terms appended. A message with
its own subject that shares nothing with the active topic is treated as a topic
change and the old topic is dropped.

Verified with two tenants in unrelated industries (plumbing, hair salon) using
the same code path and no shared vocabulary — `tests/04-ai-engine.test.ts`.

### Retrieval coverage — `src/services/retrieval.ts`

Scoring keeps v1's TF-IDF core and source-priority ordering, and adds a
**coverage** factor: how much of the question a document actually answers,
measured over one group per original query word so plurals cannot inflate it.

```
score = (tfidf + title/phrase bonuses) × (0.4 + 0.6 × coverage) ÷ log(words)
```

with a hard gate: a question of three or more content words needs at least 34%
coverage. Asking a plumber about "replacement guitar strings for a Stratocaster"
scored 17.2 against "Water heater replacement" under v1's rules; it now scores
below threshold and returns the configured fallback.

### Failure separation

v1's two failure states could blur because both ended in a fallback string. v2
keeps them structurally distinct all the way through:

| | Missing knowledge | Provider failure |
|---|---|---|
| Cause | retrieval found nothing above threshold | the provider call failed |
| Visitor sees | `ai_instructions.fallback_response` | `ai_instructions.generation_error_response` |
| `ai_requests.status` | `fallback` | `provider_error` |
| Analytics | Missing-knowledge fallbacks | AI provider failures |
| Notification | none | throttled alert, categorised |

---

## 4. The v1 admin tabs, and what happened to each

| Tab | Disposition |
|---|---|
| Dashboard | **Kept in WordPress**, now showing live SaaS status (connection, provider, knowledge count, widget state) |
| AI Providers | Moved to Cloud. WP tab shows status + a deep link |
| Knowledge Base | Moved to Cloud. WP tab shows status + a deep link |
| AI Instructions | Moved to Cloud. WP tab shows status + a deep link |
| Developer Chat Preview | Moved to Cloud (same engine as the widget, plus diagnostics) |
| Chat Widget | **Split** — appearance in Cloud, display rules in WordPress. WP tab shows the exact cached payload |
| Forms | Moved to Cloud. WP tab shows status + a deep link |
| Conversations | Moved to Cloud. WP tab shows status + a deep link |
| Analytics | Moved to Cloud. WP tab shows status + a deep link |
| Settings | **Kept**, reduced to WordPress-side settings. AI/provider settings deliberately not duplicated |
| Support | **Kept** in WordPress, with LMG contact details |
| Connection | **New** — the only screen that holds a secret |
| Security Audit / Database Logs | Folded into Settings (plugin log) and the Cloud audit log |

Nothing was dropped without a replacement. The reason each screen moved is the
same in every case: it edits data that shapes an AI answer, and two editable
copies of that data is how a site ends up disagreeing with its own engine.

---

## 5. Multi-tenant data model

```
users ──< account_members >── accounts ──< websites
                                 │             ├── site_api_credentials
                                 │             ├── ai_provider_credentials / _configs / _models
                                 │             ├── knowledge_sources ──< knowledge_documents
                                 │             ├── ai_instructions, widget_settings
                                 │             ├── forms ──< form_fields
                                 │             ├── visitors, conversations ──< messages
                                 │             ├── form_submissions
                                 │             └── ai_requests, usage_records, analytics_events
                                 ├── subscriptions ── plans
                                 └── notifications, audit_logs
```

Every website-scoped table carries **both** `account_id` and `website_id`. The
redundancy is deliberate: every query can filter on the tenant boundary
directly instead of depending on a join chain being written correctly at each
call site. Two functions are the only doors into tenant data —
`requireAccountAccess()` and `getWebsiteForAccount()` — and both return **404,
not 403**, for another tenant's id, so the API never confirms that an id exists.

---

## 6. Request flow, end to end

```
visitor types in the widget
  -> browser POST admin-ajax.php?action=chat_pilot_chat   (WP nonce)
  -> plugin Admin\Ajax::ajax_chat                          (nonce check, sanitise)
  -> plugin Api\Client::post                               (HMAC-signed, key stays server-side)
  -> SaaS POST /api/v1/site/chat
       siteAuth   : key -> hash lookup -> signature -> timestamp -> nonce
       siteKeys   : key status -> website status -> account status -> subscription -> domain
       rate limit : per website AND per visitor session
       usage      : monthly message quota
       engine     : context -> retrieval -> priority -> instructions -> provider -> generate
       sanitise   : strip HTML from the model's answer
       persist    : conversation, messages, ai_requests, usage_records
  <- { text, status, conversation_id }
  <- plugin returns { text, status } only
  <- widget renders
```

---

## 7. What is intentionally still in WordPress

* Widget markup and CSS — byte-for-byte the v1 layout.
* The launcher, open/close, auto-open and streaming behaviour.
* Pre-chat form rendering (the definition comes from the SaaS).
* Display rules: which pages show the widget, and whether admins see it.
* The connection screen and the Site API Key.
* The ownership-verification REST route.
* WordPress capability and nonce enforcement.
* A local, redacted log of connection events.
