/**
 * Cryptographic primitives.
 *
 *  - Passwords          : scrypt with a per-user random salt (constant-time compare).
 *  - Provider API keys  : AES-256-GCM envelope, key derived from ENCRYPTION_KEY.
 *  - Site API keys      : shown once, stored only as HMAC-SHA256(pepper, key).
 *  - Session cookies    : value.HMAC-SHA256(SESSION_SECRET, value).
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual, } from 'node:crypto';
import { env } from "../config/env.js";
/* ------------------------------------------------------------------ ids -- */
export const newId = () => randomUUID();
/** URL-safe random token. */
export function randomToken(bytes = 32) {
    return randomBytes(bytes).toString('base64url');
}
/* ------------------------------------------------------------ passwords -- */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEYLEN = 64;
export function hashPassword(password) {
    const salt = randomBytes(16);
    const derived = scryptSync(password, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
    return [
        'scrypt',
        SCRYPT_N,
        SCRYPT_R,
        SCRYPT_P,
        salt.toString('hex'),
        derived.toString('hex'),
    ].join('$');
}
export function verifyPassword(password, stored) {
    try {
        const parts = stored.split('$');
        if (parts.length !== 6 || parts[0] !== 'scrypt')
            return false;
        const derived = scryptSync(password, Buffer.from(parts[4], 'hex'), KEYLEN, {
            N: Number(parts[1]),
            r: Number(parts[2]),
            p: Number(parts[3]),
        });
        const expected = Buffer.from(parts[5], 'hex');
        if (expected.length !== derived.length)
            return false;
        return timingSafeEqual(derived, expected);
    }
    catch {
        return false;
    }
}
/* ----------------------------------------------------- secret envelopes -- */
function encryptionKey() {
    const raw = env.ENCRYPTION_KEY;
    // Accept 64-char hex, otherwise derive deterministically from the string.
    if (/^[0-9a-f]{64}$/i.test(raw))
        return Buffer.from(raw, 'hex');
    return scryptSync(raw, 'chat-pilot-encryption-key-v1', 32);
}
/** AES-256-GCM. Returns "v1.iv.tag.ciphertext" (each part base64url). */
export function encryptSecret(plaintext) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64url'), tag.toString('base64url'), enc.toString('base64url')].join('.');
}
export function decryptSecret(envelope) {
    const parts = envelope.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') {
        throw new Error('Malformed secret envelope.');
    }
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(parts[1], 'base64url'));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
    return Buffer.concat([
        decipher.update(Buffer.from(parts[3], 'base64url')),
        decipher.final(),
    ]).toString('utf8');
}
/** Masked hint that is safe to display after a secret has been saved. */
export function maskSecret(plaintext) {
    const clean = plaintext.trim();
    if (clean.length <= 8)
        return '••••••••';
    return clean.slice(0, 3) + '••••••••' + clean.slice(-4);
}
/* -------------------------------------------------------- site api keys -- */
export const SITE_KEY_PREFIX_LIVE = 'cp_live_';
export const SITE_KEY_PREFIX_TEST = 'cp_test_';
export function generateSiteKey(live = true) {
    const keyId = randomBytes(8).toString('hex');
    const secretPart = randomBytes(24).toString('base64url');
    const prefix = live ? SITE_KEY_PREFIX_LIVE : SITE_KEY_PREFIX_TEST;
    const plaintext = prefix + keyId + '_' + secretPart;
    return {
        plaintext,
        keyId,
        keyHash: hashSiteKey(plaintext),
        lastFour: plaintext.slice(-4),
    };
}
export function hashSiteKey(plaintext) {
    return createHmac('sha256', env.SITE_KEY_PEPPER).update(plaintext.trim()).digest('hex');
}
/** Extracts the non-secret key id from a presented key without a table scan. */
export function parseSiteKeyId(plaintext) {
    const trimmed = plaintext.trim();
    for (const prefix of [SITE_KEY_PREFIX_LIVE, SITE_KEY_PREFIX_TEST]) {
        if (trimmed.startsWith(prefix)) {
            const rest = trimmed.slice(prefix.length);
            const sep = rest.indexOf('_');
            if (sep > 0)
                return rest.slice(0, sep);
        }
    }
    return null;
}
export function constantTimeEqual(a, b) {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length)
        return false;
    return timingSafeEqual(bufA, bufB);
}
/* ------------------------------------------------------------- signing -- */
export function sign(value, secret = env.SESSION_SECRET) {
    return createHmac('sha256', secret).update(value).digest('base64url');
}
export function signValue(value) {
    return value + '.' + sign(value);
}
export function unsignValue(signed) {
    const idx = signed.lastIndexOf('.');
    if (idx <= 0)
        return null;
    const value = signed.slice(0, idx);
    const mac = signed.slice(idx + 1);
    return constantTimeEqual(sign(value), mac) ? value : null;
}
