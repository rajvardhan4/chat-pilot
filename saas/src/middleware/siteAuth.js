/**
 * Site API authentication for the WordPress plugin.
 *
 * Presenting the key is necessary but not sufficient. Every request must also
 * carry an HMAC signature computed with the key itself, so:
 *
 *   - the key is never transmitted in a URL or a log-prone position,
 *   - a captured request cannot be replayed (timestamp window + nonce),
 *   - a request body cannot be altered in flight (body hash is signed).
 *
 * Canonical string signed by the plugin:
 *
 *   METHOD \n PATH \n TIMESTAMP \n NONCE \n sha256hex(rawBody)
 *
 * Headers:
 *   X-Chat-Pilot-Key        the Site API Key
 *   X-Chat-Pilot-Timestamp  unix seconds
 *   X-Chat-Pilot-Nonce      16+ random hex chars, unique per request
 *   X-Chat-Pilot-Signature  hex HMAC-SHA256(key, canonical)
 *   X-Chat-Pilot-Site       the site's own URL (cross-checked against the
 *                           registered domain; signed, so not freely spoofable
 *                           without the key)
 */
import { createHash, createHmac } from 'node:crypto';
import { AppError } from "../core/errors.js";
import { constantTimeEqual } from "../core/crypto.js";
import { authenticateSiteRequest } from "../services/siteKeys.js";
import { clientIp } from "./security.js";
import { asyncRoute } from "./errors.js";
export const SIGNATURE_WINDOW_SECONDS = 300;
/** Replay guard. Nonces expire with the signature window. */
const seenNonces = new Map();
function rememberNonce(nonce) {
    const now = Date.now();
    for (const [key, at] of seenNonces) {
        if (now - at > SIGNATURE_WINDOW_SECONDS * 2000)
            seenNonces.delete(key);
    }
    if (seenNonces.has(nonce))
        return false;
    seenNonces.set(nonce, now);
    return true;
}
export function resetNonceCache() {
    seenNonces.clear();
}
export function canonicalString(method, path, timestamp, nonce, rawBody) {
    const bodyHash = createHash('sha256')
        .update(typeof rawBody === 'string' ? rawBody : (rawBody ?? Buffer.alloc(0)))
        .digest('hex');
    return [method.toUpperCase(), path, timestamp, nonce, bodyHash].join('\n');
}
export function computeSignature(siteKey, canonical) {
    return createHmac('sha256', siteKey).update(canonical).digest('hex');
}
export function siteAuth(options = {}) {
    return asyncRoute(async (req, _res, next) => {
        const key = (req.get('x-chat-pilot-key') ?? '').trim();
        const timestamp = (req.get('x-chat-pilot-timestamp') ?? '').trim();
        const nonce = (req.get('x-chat-pilot-nonce') ?? '').trim();
        const signature = (req.get('x-chat-pilot-signature') ?? '').trim();
        const siteUrl = (req.get('x-chat-pilot-site') ?? '').trim();
        if (!key) {
            throw new AppError('site_key_invalid', 'A Chat Pilot Site API Key is required.');
        }
        if (!timestamp || !nonce || !signature) {
            throw new AppError('site_key_invalid', 'This request is missing its Chat Pilot signature headers.');
        }
        if (nonce.length < 16 || nonce.length > 128) {
            throw new AppError('site_key_invalid', 'This request signature is not valid.');
        }
        const skew = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
        if (!Number.isFinite(skew) || skew > SIGNATURE_WINDOW_SECONDS) {
            throw new AppError('site_key_invalid', 'This request has expired. Check that your server clock is accurate, then try again.');
        }
        // Authenticate the key first: we need the plaintext to verify the HMAC,
        // and the plaintext is exactly what the caller presented.
        const context = await authenticateSiteRequest({
            presentedKey: key,
            siteUrl,
            ip: clientIp(req),
            enforceDomain: options.enforceDomain !== false,
        });
        // originalUrl, not req.path: inside a mounted router req.path is relative
        // to the mount point, while the plugin signs the full request path.
        const fullPath = (req.originalUrl ?? req.url).split('?')[0];
        const expected = computeSignature(key, canonicalString(req.method, fullPath, timestamp, nonce, req.rawBody ?? Buffer.alloc(0)));
        if (!constantTimeEqual(expected, signature)) {
            throw new AppError('site_key_invalid', 'This request signature is not valid.');
        }
        if (!rememberNonce(nonce)) {
            throw new AppError('site_key_invalid', 'This request has already been processed.');
        }
        req.site = context;
        next();
    });
}
