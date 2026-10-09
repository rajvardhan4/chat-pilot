import { unauthenticated } from "../core/errors.js";
import { getWebsiteForAccount } from "../services/websites.js";
import { asyncRoute } from "./errors.js";
export const resolveWebsite = asyncRoute(async (req, _res, next) => {
    if (!req.account)
        return next(unauthenticated());
    const websiteId = req.params.websiteId ??
        (typeof req.body === 'object' && req.body && 'website_id' in req.body
            ? String(req.body.website_id)
            : undefined) ??
        (typeof req.query.website === 'string' ? req.query.website : undefined);
    if (!websiteId)
        return next(new Error('websiteId is required on this route.'));
    req.website = await getWebsiteForAccount(req.account.id, websiteId);
    next();
});
