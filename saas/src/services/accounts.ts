/**
 * Users, accounts (tenants), membership and sessions.
 *
 * Tenancy rule enforced here: a user only ever reaches data through an
 * `account_members` row. `requireAccountAccess` is the single choke point.
 */
import { db, nowIso, toBool } from '../db/index.ts';
import { AppError, conflict, forbidden, notFound } from '../core/errors.ts';
import { hashPassword, newId, randomToken, verifyPassword, sign } from '../core/crypto.ts';
import { audit, hashIp } from './audit.ts';

/* --------------------------------------------------------------- types -- */

export interface UserRow {
  id: string;
  email: string;
  email_normalized: string;
  password_hash: string;
  full_name: string;
  platform_role: 'user' | 'super_admin';
  status: 'active' | 'suspended';
  email_verified_at: string | null;
  last_login_at: string | null;
  failed_logins: number;
  locked_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountRow {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'closed';
  plan_id: string | null;
  billing_email: string;
  suspended_at: string | null;
  suspend_reason: string;
  created_at: string;
  updated_at: string;
}

export interface MembershipRow {
  id: string;
  account_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member';
  created_at: string;
}

export interface SessionRow {
  id: string;
  user_id: string;
  csrf_token: string;
  expires_at: string;
  revoked_at: string | null;
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours
const MAX_FAILED_LOGINS = 8;
const LOCKOUT_MS = 1000 * 60 * 15;

/* --------------------------------------------------------------- users -- */

export function findUserByEmail(email: string): UserRow | undefined {
  return db.get<UserRow>('SELECT * FROM users WHERE email_normalized = ?', email.trim().toLowerCase());
}

export function findUserById(id: string): UserRow | undefined {
  return db.get<UserRow>('SELECT * FROM users WHERE id = ?', id);
}

export function slugify(input: string): string {
  const base = String(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'account';
}

function uniqueSlug(desired: string): string {
  const base = slugify(desired);
  let candidate = base;
  let n = 1;
  while (db.get('SELECT id FROM accounts WHERE slug = ?', candidate)) {
    n += 1;
    candidate = `${base}-${n}`;
  }
  return candidate;
}

export interface SignupInput {
  email: string;
  password: string;
  fullName: string;
  companyName: string;
  ip?: string;
}

export interface SignupResult {
  user: UserRow;
  account: AccountRow;
}

/** Creates a user, their tenant account and the owner membership atomically. */
export function signup(input: SignupInput): SignupResult {
  const existing = findUserByEmail(input.email);
  if (existing) {
    throw conflict('An account already exists for that email address.');
  }

  const now = nowIso();
  const userId = newId();
  const accountId = newId();

  const freePlan = db.get<{ id: string }>(
    "SELECT id FROM plans WHERE is_active = 1 ORDER BY price_cents ASC LIMIT 1",
  );

  db.tx(() => {
    db.run(
      `INSERT INTO users (id, email, email_normalized, password_hash, full_name, platform_role,
                          status, email_verified_at, failed_logins, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'user', 'active', ?, 0, ?, ?)`,
      userId,
      input.email.trim(),
      input.email.trim().toLowerCase(),
      hashPassword(input.password),
      input.fullName.trim(),
      now, // self-serve signups are considered verified on creation in this build
      now,
      now,
    );
    db.run(
      `INSERT INTO accounts (id, name, slug, status, plan_id, billing_email, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?, ?, ?)`,
      accountId,
      input.companyName.trim(),
      uniqueSlug(input.companyName),
      freePlan?.id ?? null,
      input.email.trim().toLowerCase(),
      now,
      now,
    );
    db.run(
      `INSERT INTO account_members (id, account_id, user_id, role, created_at)
       VALUES (?, ?, ?, 'owner', ?)`,
      newId(),
      accountId,
      userId,
      now,
    );
    if (freePlan) {
      const periodEnd = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
      db.run(
        `INSERT INTO subscriptions (id, account_id, plan_id, status, current_period_start, current_period_end, created_at, updated_at)
         VALUES (?, ?, ?, 'active', ?, ?, ?, ?)`,
        newId(),
        accountId,
        freePlan.id,
        now,
        periodEnd,
        now,
        now,
      );
    }
  });

  audit({
    accountId,
    actorType: 'user',
    actorId: userId,
    action: 'auth.signup',
    targetType: 'account',
    targetId: accountId,
    ip: input.ip,
  });

  return { user: findUserById(userId)!, account: getAccount(accountId)! };
}

export interface LoginResult {
  user: UserRow;
  session: SessionRow;
}

export function login(email: string, password: string, meta: { ip?: string; userAgent?: string }): LoginResult {
  const genericFailure = new AppError('invalid_credentials', 'Email or password is incorrect.');
  const user = findUserByEmail(email);

  if (!user) {
    // Equalise timing against the hash comparison on the success path.
    verifyPassword(password, hashPassword('decoy-password-value'));
    audit({ actorType: 'system', action: 'auth.login_failed', metadata: { reason: 'no_user' }, ip: meta.ip });
    throw genericFailure;
  }

  if (user.locked_until && user.locked_until > nowIso()) {
    throw new AppError(
      'rate_limited',
      'Too many failed sign-in attempts. Please try again in a few minutes.',
    );
  }

  if (!verifyPassword(password, user.password_hash)) {
    const failures = user.failed_logins + 1;
    const lockedUntil =
      failures >= MAX_FAILED_LOGINS
        ? new Date(Date.now() + LOCKOUT_MS).toISOString().slice(0, 19).replace('T', ' ')
        : null;
    db.run('UPDATE users SET failed_logins = ?, locked_until = ?, updated_at = ? WHERE id = ?',
      failures, lockedUntil, nowIso(), user.id);
    audit({
      actorType: 'user',
      actorId: user.id,
      action: 'auth.login_failed',
      metadata: { failures },
      ip: meta.ip,
    });
    throw genericFailure;
  }

  if (user.status !== 'active') {
    throw new AppError('account_suspended', 'This account has been suspended. Please contact support.');
  }

  const session = createSession(user.id, meta);
  db.run('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?',
    nowIso(), nowIso(), user.id);
  audit({ actorType: user.platform_role === 'super_admin' ? 'super_admin' : 'user', actorId: user.id, action: 'auth.login', ip: meta.ip });
  return { user: findUserById(user.id)!, session };
}

/* ------------------------------------------------------------ sessions -- */

export function createSession(userId: string, meta: { ip?: string; userAgent?: string }): SessionRow {
  const id = newId();
  const now = nowIso();
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString().slice(0, 19).replace('T', ' ');
  const csrf = randomToken(24);
  db.run(
    `INSERT INTO sessions (id, user_id, ip_hash, user_agent, csrf_token, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    userId,
    hashIp(meta.ip),
    (meta.userAgent ?? '').slice(0, 250),
    csrf,
    now,
    now,
    expires,
  );
  return db.get<SessionRow>('SELECT * FROM sessions WHERE id = ?', id)!;
}

export function getValidSession(sessionId: string): SessionRow | undefined {
  const row = db.get<SessionRow>('SELECT * FROM sessions WHERE id = ?', sessionId);
  if (!row) return undefined;
  if (row.revoked_at) return undefined;
  if (row.expires_at <= nowIso()) return undefined;
  db.run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', nowIso(), sessionId);
  return row;
}

export function revokeSession(sessionId: string): void {
  db.run('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', nowIso(), sessionId);
}

export function revokeAllSessions(userId: string): void {
  db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', nowIso(), userId);
}

/* ----------------------------------------------------- password resets -- */

export function createPasswordReset(email: string): { token: string; user: UserRow } | null {
  const user = findUserByEmail(email);
  if (!user) return null;
  const token = randomToken(32);
  db.run(
    `INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    newId(),
    user.id,
    sign(token),
    new Date(Date.now() + 3600_000).toISOString().slice(0, 19).replace('T', ' '),
    nowIso(),
  );
  return { token, user };
}

export function consumePasswordReset(token: string, newPassword: string): boolean {
  const row = db.get<{ id: string; user_id: string; expires_at: string; used_at: string | null }>(
    'SELECT * FROM password_resets WHERE token_hash = ?',
    sign(token),
  );
  if (!row || row.used_at || row.expires_at <= nowIso()) return false;
  db.tx(() => {
    db.run('UPDATE password_resets SET used_at = ? WHERE id = ?', nowIso(), row.id);
    db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
      hashPassword(newPassword), nowIso(), row.user_id);
  });
  revokeAllSessions(row.user_id);
  audit({ actorType: 'user', actorId: row.user_id, action: 'auth.password_reset' });
  return true;
}

export function changePassword(userId: string, currentPassword: string, newPassword: string): void {
  const user = findUserById(userId);
  if (!user) throw notFound('User not found.');
  if (!verifyPassword(currentPassword, user.password_hash)) {
    throw new AppError('invalid_credentials', 'Your current password is incorrect.');
  }
  db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
    hashPassword(newPassword), nowIso(), userId);
  audit({ actorType: 'user', actorId: userId, action: 'auth.password_changed' });
}

/* ------------------------------------------------------------ accounts -- */

export function getAccount(accountId: string): AccountRow | undefined {
  return db.get<AccountRow>('SELECT * FROM accounts WHERE id = ?', accountId);
}

export function listAccountsForUser(userId: string): AccountRow[] {
  return db.all<AccountRow>(
    `SELECT a.* FROM accounts a
       JOIN account_members m ON m.account_id = a.id
      WHERE m.user_id = ?
      ORDER BY a.created_at ASC`,
    userId,
  );
}

export function getMembership(userId: string, accountId: string): MembershipRow | undefined {
  return db.get<MembershipRow>(
    'SELECT * FROM account_members WHERE user_id = ? AND account_id = ?',
    userId,
    accountId,
  );
}

/**
 * THE tenant boundary. Returns the account only when the user is a member and
 * the account is usable. Super admins bypass membership but never silently:
 * every such access is audited by the caller.
 */
export function requireAccountAccess(
  user: UserRow,
  accountId: string,
  opts: { allowSuspended?: boolean } = {},
): AccountRow {
  const account = getAccount(accountId);
  if (!account) throw notFound('Account not found.');

  if (user.platform_role !== 'super_admin') {
    const membership = getMembership(user.id, accountId);
    // Deliberately a 404, not a 403: do not confirm that another tenant's id exists.
    if (!membership) throw notFound('Account not found.');
  }

  if (!opts.allowSuspended && account.status !== 'active') {
    throw new AppError('account_suspended', 'This account is suspended. Please contact support.');
  }
  return account;
}

export function updateAccount(accountId: string, patch: { name?: string; billingEmail?: string }): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    params.push(patch.name.trim());
  }
  if (patch.billingEmail !== undefined) {
    sets.push('billing_email = ?');
    params.push(patch.billingEmail.trim().toLowerCase());
  }
  if (!sets.length) return;
  sets.push('updated_at = ?');
  params.push(nowIso(), accountId);
  db.run(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`, ...params);
}

export function setAccountStatus(
  accountId: string,
  status: 'active' | 'suspended' | 'closed',
  reason: string,
  actorId: string,
): void {
  db.run(
    'UPDATE accounts SET status = ?, suspend_reason = ?, suspended_at = ?, updated_at = ? WHERE id = ?',
    status,
    reason,
    status === 'active' ? null : nowIso(),
    nowIso(),
    accountId,
  );
  audit({
    accountId,
    actorType: 'super_admin',
    actorId,
    action: 'account.status_changed',
    targetType: 'account',
    targetId: accountId,
    metadata: { status, reason },
  });
}

export function setUserStatus(userId: string, status: 'active' | 'suspended', actorId: string): void {
  db.run('UPDATE users SET status = ?, updated_at = ? WHERE id = ?', status, nowIso(), userId);
  if (status === 'suspended') revokeAllSessions(userId);
  audit({
    actorType: 'super_admin',
    actorId,
    action: 'user.status_changed',
    targetType: 'user',
    targetId: userId,
    metadata: { status },
  });
}

/** Convenience: the account a user lands on by default. */
export function primaryAccountFor(user: UserRow): AccountRow | undefined {
  return listAccountsForUser(user.id)[0];
}

export function createSuperAdmin(email: string, password: string, fullName: string): UserRow {
  const existing = findUserByEmail(email);
  if (existing) {
    db.run("UPDATE users SET platform_role = 'super_admin', updated_at = ? WHERE id = ?", nowIso(), existing.id);
    return findUserById(existing.id)!;
  }
  const id = newId();
  const now = nowIso();
  db.run(
    `INSERT INTO users (id, email, email_normalized, password_hash, full_name, platform_role,
                        status, email_verified_at, failed_logins, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'super_admin', 'active', ?, 0, ?, ?)`,
    id,
    email.trim(),
    email.trim().toLowerCase(),
    hashPassword(password),
    fullName,
    now,
    now,
    now,
  );
  return findUserById(id)!;
}

/**
 * Replaces a user's password outright.
 *
 * No current-password check: this is for the server-side admin CLI, where the
 * operator already has database access, not for anything reachable over HTTP.
 * The in-app change flow is changePassword(), which does verify.
 */
export function setPassword(userId: string, newPassword: string): void {
  db.run(
    'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
    hashPassword(newPassword),
    nowIso(),
    userId,
  );
}

/** Replaces a user's display name. Server-side admin tooling only. */
export function setFullName(userId: string, fullName: string): void {
  db.run(
    'UPDATE users SET full_name = ?, updated_at = ? WHERE id = ?',
    fullName.trim(),
    nowIso(),
    userId,
  );
}

export const isSuperAdmin = (u: { platform_role: string } | null | undefined): boolean =>
  u?.platform_role === 'super_admin';

export { toBool };
