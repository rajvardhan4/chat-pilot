# Deploying Chat Pilot Cloud

Chat Pilot Cloud is a long-running Node.js process with a file-backed database.
It needs a server you control — a VPS — not PHP shared hosting.

The WordPress plugin is the opposite: it is ordinary PHP and belongs on whatever
hosting the client's site already uses.

## What ships in `deploy/`

| File | Purpose |
| --- | --- |
| `.env.production.example` | Production `.env` with every value already correct except four |
| `chat-pilot.service` | systemd unit — runs as its own user, restarts on failure, starts on boot |
| `nginx-chat-pilot.conf` | Reverse proxy with the upload size and timeouts the app needs |
| `backup.sh` | Nightly `sqlite3 .backup` snapshot of the database, `.env` and uploads |

## Requirements

* **Node 22.18 or newer** — 24 LTS is what it is tested on. The app runs
  TypeScript directly through Node's type stripping, which is unavailable in
  earlier versions. Ubuntu's packaged Node is too old; use NodeSource.
* **nginx** in front, terminating TLS.
* **No database server.** SQLite is built into Node. Nothing to install, no
  credentials to manage.

## The order

1. VPS with Ubuntu 24.04, Node 24, nginx, certbot, sqlite3, ufw.
2. A `chatpilot` system user; the code in `/var/www/chat-pilot`.
3. `npm install --omit=dev` in `saas/`.
4. `cp deploy/.env.production.example saas/.env`, generate the three secrets
   **on the server**, set `APP_URL`, then `chmod 600 saas/.env`.
5. Install the systemd unit, `systemctl enable --now chat-pilot`.
6. Install the nginx site, then `certbot --nginx -d app.yourdomain.com`.
7. `sudo -u chatpilot npm run seed`, then `npm run admin:create`.
8. Install the backup script and its cron entry.

## Two things that catch people out

**`TRUST_PROXY` must be true.** Behind nginx, `FORCE_HTTPS=true` on its own
makes the app see plain HTTP behind the TLS and redirect forever. Both values
are already set in the production template; the loop means one got lost.

**The three secrets are not recoverable.** `ENCRYPTION_KEY` decrypts every
customer's stored AI provider key and `SITE_KEY_PEPPER` verifies every Site API
Key. Lose them and no database backup helps: the provider keys are permanently
unreadable and every installed plugin disconnects. Back them up off the server
before you go live. The app refuses to start in production without all three,
which is deliberate — a missing secret should fail loudly rather than fall back
to a throwaway value and quietly lose data.

## Pointing a WordPress site at it

One line in the site's `wp-config.php`, above `/* That's all, stop editing! */`:

```php
define( 'CHAT_PILOT_API_URL', 'https://app.yourdomain.com' );
```

Identical on every site you install. Then paste the Site API Key on the plugin's
Connection tab. Without this line the plugin talks to the shipped default,
`https://app.chatpilot.cloud`, and reports that Chat Pilot could not be reached —
which is true, and looks exactly like a bad key.

## Updating

```bash
cd /var/www/chat-pilot && git pull
cd saas && npm install --omit=dev
systemctl restart chat-pilot
journalctl -u chat-pilot -n 30
```

Migrations run at startup. Downtime is the few seconds of the restart.

## When the database outgrows SQLite

It will not for a long time — chat traffic is small writes, and the AI call
dominates every request. The point to move is when you need more than one server
running Chat Pilot at once. Every query goes through the thin wrapper in
`src/db/` specifically so that swap stays possible; doing it earlier is work
without benefit.
