/**
 * Transport and browser security: HTTPS enforcement, security headers, CORS
 * for the site API, and a fixed-window rate limiter.
 */
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.ts';
import { rateLimited } from '../core/errors.ts';

/** Redirects to HTTPS and sets HSTS when FORCE_HTTPS is on. */
export function httpsOnly(req: Request, res: Response, next: NextFunction): void {
  if (!env.FORCE_HTTPS) return next();
  const proto = env.TRUST_PROXY ? (req.get('x-forwarded-proto') ?? req.protocol) : req.protocol;
  if (proto !== 'https') {
    res.redirect(308, 'https://' + req.get('host') + req.originalUrl);
    return;
  }
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; '),
  );
  res.removeHeader('X-Powered-By');
  next();
}

/**
 * CORS for the site API.
 *
 * The plugin calls this API server-to-server (PHP), so no CORS headers are
 * needed for the normal path. We reflect an Origin only for the read-only
 * widget-config endpoint, and only when that Origin belongs to the website the
 * presented key is registered to - which the route resolves before calling
 * this. Wildcards are never emitted.
 */
export function applySiteCors(res: Response, allowedOrigin: string | null): void {
  if (!allowedOrigin) return;
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Chat-Pilot-Key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '600');
}

/* -------------------------------------------------------- rate limiting -- */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Opportunistic sweep so the map cannot grow without bound.
let lastSweep = Date.now();
function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function consumeRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  sweep(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

export function resetRateLimits(): void {
  buckets.clear();
}

export function clientIp(req: Request): string {
  if (env.TRUST_PROXY) {
    const forwarded = req.get('x-forwarded-for');
    if (forwarded) return (forwarded.split(',')[0] as string).trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/** Express middleware factory. `keyFn` decides what is being limited. */
export function rateLimit(options: {
  limit: number;
  windowMs: number;
  keyFn?: (req: Request) => string;
  scope: string;
}) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const key = options.scope + ':' + (options.keyFn ? options.keyFn(req) : clientIp(req));
    if (!consumeRateLimit(key, options.limit, options.windowMs)) {
      next(rateLimited());
      return;
    }
    next();
  };
}
