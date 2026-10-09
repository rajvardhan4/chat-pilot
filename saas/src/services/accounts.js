/**
 * Users, accounts (tenants), membership and sessions.
 *
 * Tenancy rule enforced here: a user only ever reaches data through an
 * `account_members` row. `requireAccountAccess` is the single choke point.
 */
import { col, nowIso, toBool, withTransaction } from "../db/mongo.js";
import { AppError, conflict, forbidden, notFound } from "../core/errors.js";
import { hashPassword, newId, randomToken, verifyPassword, sign } from "../core/crypto.js";
import { audit, hashIp } from "./audit.js";
function toUserRow(d) {
    const { _id, ...rest } = d;
    return { id: _id, ...rest };
}
function toAccountRow(d) {
    const { _id, ...rest } = d;
    return { id: _id, ...rest };
}
function toMembershipRow(d) {
    const { _id, ...rest } = d;
    return { id: _id, ...rest };
}
function toSessionRow(d) {
    return { id: d._id, user_id: d.user_id, csrf_token: d.csrf_token, expires_at: d.expires_at, revoked_at: d.revoked_at };
}
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours
const MAX_FAILED_LOGINS = 8;
const LOCKOUT_MS = 1000 * 60 * 15;
/* --------------------------------------------------------------- users -- */
export async function findUserByEmail(email) {
    const doc = await col('users').findOne({ email_normalized: email.trim().toLowerCase() });
    return doc ? toUserRow(doc) : undefined;
}
export async function findUserById(id) {
    const doc = await col('users').findOne({ _id: id });
    return doc ? toUserRow(doc) : undefined;
}
export function slugify(input) {
    const base = String(input)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
    return base || 'account';
}
async function uniqueSlug(desired) {
    const base = slugify(desired);
    let candidate = base;
    let n = 1;
    while (await col('accounts').findOne({ _id: candidate }, { projection: { _id: 1 } })) {
        n += 1;
        candidate = `${base}-${n}`;
    }
    return candidate;
}
/** Creates a user, their tenant account and the owner membership atomically. */
export async function signup(input) {
    const existing = await findUserByEmail(input.email);
    if (existing) {
        throw conflict('An account already exists for that email address.');
    }
    const now = nowIso();
    const userId = newId();
    const accountId = newId();
    // is_active is stored as 0/1 (mirroring the old SQLite boolean-as-integer
    // convention — see plans.ts), not a BSON boolean, so the filter must match
    // that literal type.
    const freePlan = await col('plans')
        .find({ is_active: 1 })
        .sort({ price_cents: 1 })
        .limit(1)
        .next();
    // uniqueSlug() reads the accounts collection, so it runs before the
    // transaction opens rather than inside it — a session only wraps writes
    // here, matching how the original synchronous transaction never issued a
    // SELECT of its own either.
    const slug = await uniqueSlug(input.companyName);
    await withTransaction(async (session) => {
        await col('users').insertOne({
            _id: userId,
            email: input.email.trim(),
            email_normalized: input.email.trim().toLowerCase(),
            password_hash: hashPassword(input.password),
            full_name: input.fullName.trim(),
            platform_role: 'user',
            status: 'active',
            // Self-serve signups are considered verified on creation in this build.
            email_verified_at: now,
            last_login_at: null,
            failed_logins: 0,
            locked_until: null,
            created_at: now,
            updated_at: now,
        }, { session });
        await col('accounts').insertOne({
            _id: accountId,
            name: input.companyName.trim(),
            slug,
            status: 'active',
            plan_id: freePlan?._id ?? null,
            billing_email: input.email.trim().toLowerCase(),
            suspended_at: null,
            suspend_reason: '',
            created_at: now,
            updated_at: now,
        }, { session });
        await col('account_members').insertOne({ _id: newId(), account_id: accountId, user_id: userId, role: 'owner', created_at: now }, { session });
        if (freePlan) {
            const periodEnd = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
            await col('subscriptions').insertOne({
                _id: newId(),
                account_id: accountId,
                plan_id: freePlan._id,
                status: 'active',
                current_period_start: now,
                current_period_end: periodEnd,
                external_ref: '',
                created_at: now,
                updated_at: now,
            }, { session });
        }
    });
    await audit({
        accountId,
        actorType: 'user',
        actorId: userId,
        action: 'auth.signup',
        targetType: 'account',
        targetId: accountId,
        ip: input.ip,
    });
    return { user: (await findUserById(userId)), account: (await getAccount(accountId)) };
}
export async function login(email, password, meta) {
    const genericFailure = new AppError('invalid_credentials', 'Email or password is incorrect.');
    const user = await findUserByEmail(email);
    if (!user) {
        // Equalise timing against the hash comparison on the success path.
        verifyPassword(password, hashPassword('decoy-password-value'));
        await audit({ actorType: 'system', action: 'auth.login_failed', metadata: { reason: 'no_user' }, ip: meta.ip });
        throw genericFailure;
    }
    if (user.locked_until && user.locked_until > nowIso()) {
        throw new AppError('rate_limited', 'Too many failed sign-in attempts. Please try again in a few minutes.');
    }
    if (!verifyPassword(password, user.password_hash)) {
        const failures = user.failed_logins + 1;
        const lockedUntil = failures >= MAX_FAILED_LOGINS
            ? new Date(Date.now() + LOCKOUT_MS).toISOString().slice(0, 19).replace('T', ' ')
            : null;
        await col('users').updateOne({ _id: user.id }, { $set: { failed_logins: failures, locked_until: lockedUntil, updated_at: nowIso() } });
        await audit({
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
    const session = await createSession(user.id, meta);
    await col('users').updateOne({ _id: user.id }, { $set: { failed_logins: 0, locked_until: null, last_login_at: nowIso(), updated_at: nowIso() } });
    await audit({
        actorType: user.platform_role === 'super_admin' ? 'super_admin' : 'user',
        actorId: user.id,
        action: 'auth.login',
        ip: meta.ip,
    });
    return { user: (await findUserById(user.id)), session };
}
/* ------------------------------------------------------------ sessions -- */
export async function createSession(userId, meta) {
    const id = newId();
    const now = nowIso();
    const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString().slice(0, 19).replace('T', ' ');
    const csrf = randomToken(24);
    const doc = {
        _id: id,
        user_id: userId,
        ip_hash: hashIp(meta.ip),
        user_agent: (meta.userAgent ?? '').slice(0, 250),
        csrf_token: csrf,
        created_at: now,
        last_seen_at: now,
        expires_at: expires,
        revoked_at: null,
    };
    await col('sessions').insertOne(doc);
    return toSessionRow(doc);
}
export async function getValidSession(sessionId) {
    const row = await col('sessions').findOne({ _id: sessionId });
    if (!row)
        return undefined;
    if (row.revoked_at)
        return undefined;
    if (row.expires_at <= nowIso())
        return undefined;
    await col('sessions').updateOne({ _id: sessionId }, { $set: { last_seen_at: nowIso() } });
    return toSessionRow(row);
}
export async function revokeSession(sessionId) {
    await col('sessions').updateOne({ _id: sessionId, revoked_at: null }, { $set: { revoked_at: nowIso() } });
}
export async function revokeAllSessions(userId) {
    await col('sessions').updateMany({ user_id: userId, revoked_at: null }, { $set: { revoked_at: nowIso() } });
}
/* ----------------------------------------------------- password resets -- */
export async function createPasswordReset(email) {
    const user = await findUserByEmail(email);
    if (!user)
        return null;
    const token = randomToken(32);
    await col('password_resets').insertOne({
        _id: newId(),
        user_id: user.id,
        token_hash: sign(token),
        expires_at: new Date(Date.now() + 3600_000).toISOString().slice(0, 19).replace('T', ' '),
        used_at: null,
        created_at: nowIso(),
    });
    return { token, user };
}
export async function consumePasswordReset(token, newPassword) {
    const row = await col('password_resets').findOne({ token_hash: sign(token) });
    if (!row || row.used_at || row.expires_at <= nowIso())
        return false;
    await withTransaction(async (session) => {
        await col('password_resets').updateOne({ _id: row._id }, { $set: { used_at: nowIso() } }, { session });
        await col('users').updateOne({ _id: row.user_id }, { $set: { password_hash: hashPassword(newPassword), updated_at: nowIso() } }, { session });
    });
    await revokeAllSessions(row.user_id);
    await audit({ actorType: 'user', actorId: row.user_id, action: 'auth.password_reset' });
    return true;
}
export async function changePassword(userId, currentPassword, newPassword) {
    const user = await findUserById(userId);
    if (!user)
        throw notFound('User not found.');
    if (!verifyPassword(currentPassword, user.password_hash)) {
        throw new AppError('invalid_credentials', 'Your current password is incorrect.');
    }
    await col('users').updateOne({ _id: userId }, { $set: { password_hash: hashPassword(newPassword), updated_at: nowIso() } });
    await audit({ actorType: 'user', actorId: userId, action: 'auth.password_changed' });
}
/* ------------------------------------------------------------ accounts -- */
export async function getAccount(accountId) {
    const doc = await col('accounts').findOne({ _id: accountId });
    return doc ? toAccountRow(doc) : undefined;
}
export async function listAccountsForUser(userId) {
    const memberships = await col('account_members').find({ user_id: userId }).toArray();
    if (!memberships.length)
        return [];
    const accountIds = memberships.map((m) => m.account_id);
    const docs = await col('accounts')
        .find({ _id: { $in: accountIds } })
        .sort({ created_at: 1 })
        .toArray();
    return docs.map(toAccountRow);
}
export async function getMembership(userId, accountId) {
    const doc = await col('account_members').findOne({ user_id: userId, account_id: accountId });
    return doc ? toMembershipRow(doc) : undefined;
}
/**
 * THE tenant boundary. Returns the account only when the user is a member and
 * the account is usable. Super admins bypass membership but never silently:
 * every such access is audited by the caller.
 */
export async function requireAccountAccess(user, accountId, opts = {}) {
    const account = await getAccount(accountId);
    if (!account)
        throw notFound('Account not found.');
    if (user.platform_role !== 'super_admin') {
        const membership = await getMembership(user.id, accountId);
        // Deliberately a 404, not a 403: do not confirm that another tenant's id exists.
        if (!membership)
            throw notFound('Account not found.');
    }
    if (!opts.allowSuspended && account.status !== 'active') {
        throw new AppError('account_suspended', 'This account is suspended. Please contact support.');
    }
    return account;
}
export async function updateAccount(accountId, patch) {
    const set = {};
    if (patch.name !== undefined)
        set.name = patch.name.trim();
    if (patch.billingEmail !== undefined)
        set.billing_email = patch.billingEmail.trim().toLowerCase();
    if (!Object.keys(set).length)
        return;
    set.updated_at = nowIso();
    await col('accounts').updateOne({ _id: accountId }, { $set: set });
}
export async function setAccountStatus(accountId, status, reason, actorId) {
    await col('accounts').updateOne({ _id: accountId }, {
        $set: {
            status,
            suspend_reason: reason,
            suspended_at: status === 'active' ? null : nowIso(),
            updated_at: nowIso(),
        },
    });
    await audit({
        accountId,
        actorType: 'super_admin',
        actorId,
        action: 'account.status_changed',
        targetType: 'account',
        targetId: accountId,
        metadata: { status, reason },
    });
}
export async function setUserStatus(userId, status, actorId) {
    await col('users').updateOne({ _id: userId }, { $set: { status, updated_at: nowIso() } });
    if (status === 'suspended')
        await revokeAllSessions(userId);
    await audit({
        actorType: 'super_admin',
        actorId,
        action: 'user.status_changed',
        targetType: 'user',
        targetId: userId,
        metadata: { status },
    });
}
/** Convenience: the account a user lands on by default. */
export async function primaryAccountFor(user) {
    return (await listAccountsForUser(user.id))[0];
}
export async function createSuperAdmin(email, password, fullName) {
    const existing = await findUserByEmail(email);
    if (existing) {
        await col('users').updateOne({ _id: existing.id }, { $set: { platform_role: 'super_admin', updated_at: nowIso() } });
        return (await findUserById(existing.id));
    }
    const id = newId();
    const now = nowIso();
    await col('users').insertOne({
        _id: id,
        email: email.trim(),
        email_normalized: email.trim().toLowerCase(),
        password_hash: hashPassword(password),
        full_name: fullName,
        platform_role: 'super_admin',
        status: 'active',
        email_verified_at: now,
        last_login_at: null,
        failed_logins: 0,
        locked_until: null,
        created_at: now,
        updated_at: now,
    });
    return (await findUserById(id));
}
/**
 * Replaces a user's password outright.
 *
 * No current-password check: this is for the server-side admin CLI, where the
 * operator already has database access, not for anything reachable over HTTP.
 * The in-app change flow is changePassword(), which does verify.
 */
export async function setPassword(userId, newPassword) {
    await col('users').updateOne({ _id: userId }, { $set: { password_hash: hashPassword(newPassword), updated_at: nowIso() } });
}
/** Replaces a user's display name. Server-side admin tooling only. */
export async function setFullName(userId, fullName) {
    await col('users').updateOne({ _id: userId }, { $set: { full_name: fullName.trim(), updated_at: nowIso() } });
}
export const isSuperAdmin = (u) => u?.platform_role === 'super_admin';
export { toBool };
