import { env } from "../config/env.js";
import { AppError, forbidden, unauthenticated } from "../core/errors.js";
import { asyncRoute } from "./errors.js";
import { constantTimeEqual, signValue, unsignValue } from "../core/crypto.js";
import { getValidSession, findUserById, listAccountsForUser, primaryAccountFor, requireAccountAccess, } from "../services/accounts.js";
import { clientIp } from "./security.js";
export const SESSION_COOKIE = 'cp_session';
const CSRF_HEADER = 'x-csrf-token';
const CSRF_FIELD = '_csrf';
/* ------------------------------------------------------------- cookies -- */
export function parseCookies(header) {
    const out = {};
    if (!header)
        return out;
    for (const part of header.split(';')) {
        const idx = part.indexOf('=');
        if (idx < 0)
            continue;
        const name = part.slice(0, idx).trim();
        const value = part.slice(idx + 1).trim();
        if (name)
            out[name] = decodeURIComponent(value);
    }
    return out;
}
export function setSessionCookie(res, sessionId) {
    const attrs = [
        SESSION_COOKIE + '=' + encodeURIComponent(signValue(sessionId)),
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        'Max-Age=' + 12 * 60 * 60,
    ];
    if (env.FORCE_HTTPS)
        attrs.push('Secure');
    res.append('Set-Cookie', attrs.join('; '));
}
export function clearSessionCookie(res) {
    const attrs = [SESSION_COOKIE + '=', 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
    if (env.FORCE_HTTPS)
        attrs.push('Secure');
    res.append('Set-Cookie', attrs.join('; '));
}
/* ---------------------------------------------------------- middleware -- */
/** Populates req.user / req.session when a valid cookie is present. Never throws. */
export const loadSession = asyncRoute(async (req, _res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    const signed = cookies[SESSION_COOKIE];
    if (!signed)
        return next();
    const sessionId = unsignValue(signed);
    if (!sessionId)
        return next();
    const session = await getValidSession(sessionId);
    if (!session)
        return next();
    const user = await findUserById(session.user_id);
    if (!user || user.status !== 'active')
        return next();
    req.session = session;
    req.user = user;
    req.csrfToken = session.csrf_token;
    req.accounts = await listAccountsForUser(user.id);
    return next();
});
export function requireAuth(req, _res, next) {
    if (!req.user)
        return next(unauthenticated('Please sign in to continue.'));
    next();
}
export function requireSuperAdmin(req, _res, next) {
    if (!req.user)
        return next(unauthenticated('Please sign in to continue.'));
    if (req.user.platform_role !== 'super_admin')
        return next(forbidden('Administrator access is required.'));
    next();
}
/**
 * CSRF: every state-changing portal request must carry the session's CSRF
 * token, either as a form field or the X-CSRF-Token header.
 */
export function requireCsrf(req, _res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method))
        return next();
    if (!req.session)
        return next(unauthenticated('Your session has expired. Please sign in again.'));
    const body = req.body;
    const presented = (req.get(CSRF_HEADER) ?? '') ||
        (typeof body?.[CSRF_FIELD] === 'string' ? body[CSRF_FIELD] : '');
    if (!presented || !constantTimeEqual(presented, req.session.csrf_token)) {
        return next(new AppError('forbidden', 'Your session expired or the form was stale. Please try again.'));
    }
    next();
}
/**
 * Resolves the tenant for this request.
 *
 * The account may be named by `:accountId`, a query param, or defaults to the
 * user's own first account. Membership is always verified.
 */
export const resolveAccount = asyncRoute(async (req, _res, next) => {
    if (!req.user)
        return next(unauthenticated());
    const requested = req.params.accountId ??
        (typeof req.query.account === 'string' ? req.query.account : undefined);
    if (requested) {
        req.account = await requireAccountAccess(req.user, requested);
    }
    else {
        const primary = await primaryAccountFor(req.user);
        if (!primary)
            return next(forbidden('No account is associated with this user.'));
        req.account = await requireAccountAccess(req.user, primary.id);
    }
    next();
});
export { clientIp };
