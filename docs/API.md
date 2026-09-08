# Chat Pilot Site API — v1

The contract between a Chat Pilot WordPress plugin and Chat Pilot Cloud.

Base path: `/api/v1/site`
Transport: HTTPS only in production (`FORCE_HTTPS=true` redirects and sets HSTS).

The API is versioned so a newer server keeps serving older plugin builds. A
breaking change ships as `/api/v2/site` with `/api/v1/site` still answering.

---

## 1. Authentication

Every request carries a **Site API Key** *and* an HMAC signature computed with
that key. The key alone is not sufficient.

### Headers

| Header | Value |
|---|---|
| `X-Chat-Pilot-Key` | the Site API Key, `cp_live_<keyId>_<secret>` |
| `X-Chat-Pilot-Timestamp` | unix seconds |
| `X-Chat-Pilot-Nonce` | 16–128 random hex characters, unique per request |
| `X-Chat-Pilot-Signature` | hex HMAC-SHA256 of the canonical string |
| `X-Chat-Pilot-Site` | the site's own URL (`home_url()`) |
| `X-Chat-Pilot-Plugin` | plugin version (informational) |

### Canonical string

```
METHOD \n PATH \n TIMESTAMP \n NONCE \n sha256hex(rawBody)
```

* `METHOD` — uppercase.
* `PATH` — the full request path, no query string (e.g. `/api/v1/site/chat`).
* `rawBody` — the exact bytes sent; the empty string for a body-less request.

```php
$canonical = implode("\n", [
    strtoupper($method), $path, $timestamp, $nonce, hash('sha256', $body),
]);
$signature = hash_hmac('sha256', $canonical, $siteApiKey);
```

### Why this shape

* The key never appears in a URL or query string, so it cannot leak through
  access logs, proxies or an error message that echoes the URL.
* The body hash is signed, so a proxy cannot alter the payload.
* Timestamp (±300s) plus a single-use nonce make a captured request unusable a
  second time.
* `X-Chat-Pilot-Site` is inside the signature, so the domain claim cannot be
  altered without the key.

### Validation order

Failures are ordered so the plugin can show a specific status:

1. key present, well-formed, and its `key_id` resolves
2. `key_hash` matches (constant-time)
3. key is `active` → else `site_key_revoked`
4. website exists and is `active` → else `website_disabled`
5. account is `active` → else `account_suspended`
6. subscription is `active`/`trialing` → else `subscription_inactive`
7. presented host is registered → else `domain_mismatch`
8. signature matches → else `site_key_invalid`
9. nonce unused → else `site_key_invalid`

---

## 2. Domain binding

A key issued for `example.com` is accepted from:

* `example.com` and `www.example.com`
* any hostname the customer added under Connection → Additional allowed domains
* private/loopback hosts, **only** when the website itself is registered on one
  (local development)

Anything else is `403 domain_mismatch`, and the attempt is written to
`audit_logs` with the presented host.

### Ownership verification

On `/connect`, Chat Pilot fetches

```
GET https://<claimed-site>/wp-json/chat-pilot/v1/site-token
```

and compares the returned token with the website's `verification_token`. That
turns "the caller claims to be example.com" into "example.com served our token".

A failure does **not** block the connection — sites behind HTTP auth or a
firewall are legitimate — but the website stays `verified: false` and the
`ownership_check` result (`verified` | `mismatch` | `unreachable`) is recorded
and shown in both dashboards.

---

## 3. Response envelope

Success:

```json
{ "ok": true, "data": { } }
```

Failure:

```json
{
  "ok": false,
  "error": {
    "code": "domain_mismatch",
    "message": "This Site API Key is registered to a different domain...",
    "fields": { "email": "Email is required." },
    "reference": "a1b2c3d4"
  }
}
```

`message` is always safe to show a human. `fields` appears on validation
failures. `reference` appears only on 5xx and correlates with the server log —
it is not an error detail.

**A response never contains** a provider API key, a system prompt, a stack
trace, SQL, an internal exception, or another tenant's data.

### Error codes

| Code | HTTP | Meaning |
|---|---|---|
| `site_key_invalid` | 401 | unknown key, bad signature, stale timestamp, replayed nonce |
| `site_key_revoked` | 401 | the key was revoked |
| `domain_mismatch` | 403 | presented host is not registered to this website |
| `website_disabled` | 403 | website inactive or suspended, or the widget is off |
| `account_suspended` | 403 | account suspended |
| `subscription_inactive` | 402 | subscription not active or trialing |
| `validation_failed` | 422 | request body failed validation (`fields` present) |
| `rate_limited` | 429 | too many requests |
| `usage_limit_reached` | 429 | monthly message allowance reached |
| `bad_request` | 400 | malformed JSON or missing required data |
| `internal_error` | 500 | unexpected; `reference` included |

---

## 4. Endpoints

### `POST /connect`

Handshake. Records the plugin version and attempts ownership verification.

```json
{ "site_url": "https://example.com", "plugin_version": "2.0.0", "wp_version": "6.7" }
```

```json
{
  "ok": true,
  "data": {
    "status": "connected",
    "website": {
      "id": "…", "name": "Acme Plumbing", "domain": "example.com",
      "status": "active", "verified": true, "ownership_check": "verified"
    },
    "account": { "id": "…", "name": "Acme Ltd" },
    "widget": { },
    "dashboard_url": "https://app.chatpilot.cloud/app/websites/…",
    "api_version": "v1",
    "server_time": "2026-09-07 12:00:00"
  }
}
```

### `GET /config`

Widget configuration plus visitor-facing copy. Cacheable; `widget.configVersion`
changes whenever any setting changes.

```json
{
  "ok": true,
  "data": {
    "website": { "id": "…", "name": "…", "domain": "…", "status": "active" },
    "widget": {
      "enabled": true, "displayName": "Chat Pilot", "position": "bottom-right",
      "primaryColor": "#06b6d4", "logoUrl": "", "welcomeMessage": "…",
      "placeholderText": "…", "suggestedQuestions": ["…"],
      "enableTyping": true, "enableStreaming": true,
      "autoOpenChat": false, "autoOpenDelay": 5, "openOncePerVisitor": true,
      "prechat": {
        "enabled": true, "formId": "…", "intro": "…",
        "fields": [{ "key": "name", "type": "text", "label": "Name",
                     "placeholder": "…", "options": [], "required": true }]
      },
      "configVersion": "2026-09-07 12:00:00"
    },
    "messages": { "fallback": "…", "generation_error": "…", "greeting": "…" }
  }
}
```

`messages` is visitor-facing copy only. The system prompt is never included.

### `POST /chat`

```json
{
  "session_key": "cp_sess_…",
  "message": "How much does a bathroom refit cost?",
  "page_url": "https://example.com/bathrooms",
  "visitor_key": "cp_sess_…",
  "visitor_name": "", "visitor_email": "", "visitor_phone": ""
}
```

```json
{ "ok": true, "data": { "text": "…", "status": "success", "conversation_id": "…" } }
```

`status` is `success`, `fallback` (no relevant knowledge) or `provider_error`
(the AI provider failed). The three are always distinguishable, and the text is
the customer's configured copy for each case.

Conversation history is **not** sent by the client. The server owns it, keyed by
`(website_id, session_key)`, so a visitor cannot forge or replay a conversation.

Rate limits: 240/min per website, and `RATE_LIMIT_CHAT_PER_MINUTE` (default 20)
per visitor session.

### `POST /forms/submit`

```json
{
  "form_id": "…", "session_key": "cp_sess_…", "visitor_key": "cp_sess_…",
  "page_url": "https://example.com/contact",
  "fields": { "name": "Jane Doe", "email": "jane@example.com", "phone": "555-0142" }
}
```

```json
{ "ok": true, "data": { "submission_id": "…", "name": "Jane Doe", "email": "jane@example.com" } }
```

Validation is authoritative here: required fields, email and phone formats, and
dropdown/radio values are checked against the stored form definition. Unknown
keys are dropped rather than stored. A submission on a session that already has
a conversation is linked to it automatically, and vice versa.

Rate limit: 10/min per visitor session.

### `GET /health`

```json
{
  "ok": true,
  "data": {
    "status": "connected", "website_status": "active", "account_status": "active",
    "provider_configured": true, "knowledge_documents": 42, "widget_enabled": true,
    "api_version": "v1", "server_time": "2026-09-07 12:00:00"
  }
}
```

### `POST /disconnect`

Records the disconnect in the audit log. The plugin then clears its local state.
It does **not** revoke the key — that is the customer's decision, in the
dashboard.

---

## 5. What a Site API Key can and cannot do

**Can:** connect, read that one website's widget config and health, send a chat
message for that website, submit that website's forms, disconnect.

**Cannot:** read or change account settings, other websites, knowledge, AI
instructions, conversations, leads, analytics, billing or users; read the AI
provider key; reach any portal or admin route.

---

## 6. Failure handling expected of the plugin

| Situation | Plugin behaviour |
|---|---|
| timeout / 5xx / invalid JSON | friendly visitor message; detail to the plugin log only |
| `site_key_invalid` / `revoked` | mark disconnected, show the reason on Connection |
| `domain_mismatch` | show the reason; do not retry automatically |
| `website_disabled` / `account_suspended` / `subscription_inactive` | stop rendering the widget; show the reason to the admin |
| `rate_limited` | friendly visitor message; no retry storm |
| config unreachable | serve the last known good config, except after a hard-stop code, which takes the widget down |

The visitor never sees an HTTP status, an error code, or the word "API".

---

## 7. Portal API

`/api/v1/portal/*` serves the Chat Pilot dashboard. It is authenticated by the
portal session cookie plus a CSRF token, is tenant-scoped exactly like the
server-rendered pages, and is **not** reachable with a Site API Key.
