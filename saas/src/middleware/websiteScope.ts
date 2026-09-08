/**
 * Resolves `:websiteId` inside the tenant already resolved by `resolveAccount`.
 *
 * This is the second half of the tenant boundary: an id belonging to another
 * account produces a 404, never another tenant's data.
 */
import type { NextFunction, Request, Response } from 'express';
import { unauthenticated } from '../core/errors.ts';
import { getWebsiteForAccount, type WebsiteRow } from '../services/websites.ts';
import { asyncRoute } from './errors.ts';

declare module 'express-serve-static-core' {
  interface Request {
    website?: WebsiteRow;
  }
}

export const resolveWebsite = asyncRoute(async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  if (!req.account) return next(unauthenticated());
  const websiteId =
    (req.params.websiteId as string | undefined) ??
    (typeof req.body === 'object' && req.body && 'website_id' in req.body
      ? String((req.body as Record<string, unknown>).website_id)
      : undefined) ??
    (typeof req.query.website === 'string' ? req.query.website : undefined);

  if (!websiteId) return next(new Error('websiteId is required on this route.'));
  req.website = await getWebsiteForAccount(req.account.id, websiteId);
  next();
});
