import path from 'node:path';
import express, {} from 'express';
import { env, ROOT } from "./config/env.js";
import { connectDb } from "./db/mongo.js";
import { errorHandler, notFoundHandler } from "./middleware/errors.js";
import { httpsOnly, securityHeaders } from "./middleware/security.js";
import { loadSession } from "./middleware/session.js";
import { siteApiRouter } from "./routes/siteApi.js";
import { authRouter } from "./routes/auth.js";
import { portalRouter } from "./routes/portal.js";
import { adminRouter } from "./routes/admin.js";
import { portalApiRouter } from "./routes/portalApi.js";
import { seedDefaultPlans } from "./services/plans.js";
// Async because connecting to MongoDB is: unlike node:sqlite's DatabaseSync,
// which opened the file synchronously on first query, the driver has to
// finish its handshake before a single collection call is safe to make.
export async function createApp() {
    await connectDb();
    await seedDefaultPlans();
    const app = express();
    if (env.TRUST_PROXY)
        app.set('trust proxy', 1);
    app.set('view engine', 'ejs');
    app.set('views', path.join(ROOT, 'src', 'views'));
    app.disable('x-powered-by');
    app.use(httpsOnly);
    app.use(securityHeaders);
    // Raw body is retained so the site API can verify HMAC signatures.
    // Uploads arrive base64-encoded, so the JSON limit must clear
    // UPLOAD_MAX_BYTES * 4/3 plus envelope overhead; the real per-file limit is
    // still enforced (and reported as 413) by the upload route itself.
    const jsonLimit = Math.ceil((env.UPLOAD_MAX_BYTES * 4) / 3) + 512 * 1024;
    app.use(express.json({
        limit: jsonLimit,
        verify: (req, _res, buf) => {
            req.rawBody = Buffer.from(buf);
        },
    }));
    app.use(express.urlencoded({ extended: false, limit: '1mb' }));
    app.use('/assets', express.static(path.join(ROOT, 'src', 'public'), {
        maxAge: env.isProd ? '7d' : 0,
        etag: true,
    }));
    app.use('/assets', express.static(path.join(process.cwd(), 'saas', 'src', 'public'), {
        maxAge: env.isProd ? '7d' : 0,
        etag: true,
    }));
    app.use('/assets', express.static(path.join(process.cwd(), 'src', 'public'), {
        maxAge: env.isProd ? '7d' : 0,
        etag: true,
    }));
    // Unauthenticated liveness probe. Deliberately reveals nothing.
    app.get('/healthz', (_req, res) => {
        res.json({ ok: true, service: 'chat-pilot-saas', api_version: 'v1' });
    });
    // --- Plugin-facing API (Site API Key + HMAC) ---
    app.use('/api/v1/site', siteApiRouter);
    // --- Portal (session cookie) ---
    app.use(loadSession);
    app.use('/', authRouter);
    app.use('/app', portalRouter);
    app.use('/api/v1/portal', portalApiRouter);
    app.use('/admin', adminRouter);
    app.get('/', (req, res) => {
        if (req.user) {
            res.redirect(req.user.platform_role === 'super_admin' ? '/admin' : '/app');
            return;
        }
        res.redirect('/login');
    });
    app.use(notFoundHandler);
    app.use(errorHandler);
    return app;
}
