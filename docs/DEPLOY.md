# Deploying Chat Pilot Cloud

Chat Pilot Cloud is a long-running Node.js process with a file-backed database.
It needs a server you control — a VPS — not PHP shared hosting.

The WordPress plugin is the opposite: it is ordinary PHP and belongs on whatever
hosting the client's site already uses.

## Two ways to get the code onto the server

**With git** (recommended — `git pull` is the whole update from then on):
see "Upload the code" below.

**With a ZIP** (no git access on the host, or a one-off manual install):

```bash
npm run cloud:build
```

Produces `dist/cloud/chat-pilot-cloud-<date>-<commit>.zip` — everything under
`saas/` and `deploy/`, minus `node_modules`, `saas/data`, `saas/.env` and
`saas/tests`. Unzip it as `/var/www/chat-pilot` on the server and every command
below is identical either way. This is the SIBLING of `npm run plugin:build`,
not a replacement — one ships to your own VPS, the other to a customer's
WordPress site. Two different destinations, kept in two different folders:
`dist/cloud/` and `dist/plugin/`.

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

## Automatic deploys (optional)

`.github/workflows/deploy.yml` redeploys automatically on every push to
`master`/`main`: SSH in, `git pull`, `npm install`, `chown`, restart, then
check `/healthz`. It runs the exact commands the manual "Updating" section
above has you type — nothing Hostinger-specific, it works against any VPS
reachable over SSH.

Two of Hostinger's own "connect to GitHub" features exist but do not fit this
app: the generic Git integration in hPanel only copies files into
`public_html` — no `npm install`, no service restart — and the "Deploy to
Hostinger VPS" GitHub Action is Docker-only, which this deployment is not.
Plain SSH is what actually runs the three commands.

### One-time setup, once the VPS exists

1. **Generate a dedicated deploy key** on your own machine — not the key you
   use to SSH in personally:

   ```bash
   ssh-keygen -t ed25519 -f chat-pilot-deploy -N "" -C "chat-pilot-deploy"
   ```

   This makes two files: `chat-pilot-deploy` (private) and
   `chat-pilot-deploy.pub` (public).

2. **Authorise the public half on the VPS**, for `root` — the workflow
   connects as `root`, matching every command in "Updating" above:

   ```bash
   cat chat-pilot-deploy.pub | ssh root@YOUR.VPS.IP "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
   ```

3. **Get the server's host key fingerprint**, so the workflow can tell your
   real VPS apart from anything else that might end up at that address:

   ```bash
   ssh-keyscan -t ed25519 YOUR.VPS.IP | ssh-keygen -lf -
   ```

   Copy the `SHA256:…` part of the output.

4. **Add three repository secrets** — GitHub → this repo → Settings →
   Secrets and variables → Actions → New repository secret:

   | Secret | Value |
   | --- | --- |
   | `VPS_HOST` | the VPS IP or `app.yourdomain.com` |
   | `VPS_SSH_KEY` | the full contents of `chat-pilot-deploy` (the private file) |
   | `VPS_HOST_FINGERPRINT` | the `SHA256:…` line from step 3 |

5. **Delete the local key files** once both secrets are saved —
   `chat-pilot-deploy` and `chat-pilot-deploy.pub` — they only need to exist
   on GitHub and on the VPS's `authorized_keys` from here on.

Push a change under `saas/` and watch the **Actions** tab. From then on,
`git push` is the entire deploy.

## When the database outgrows SQLite

It will not for a long time — chat traffic is small writes, and the AI call
dominates every request. The point to move is when you need more than one server
running Chat Pilot at once. Every query goes through the thin wrapper in
`src/db/` specifically so that swap stays possible; doing it earlier is work
without benefit.
