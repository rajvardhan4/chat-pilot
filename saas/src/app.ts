import path from 'node:path';
import express, { type Express } from 'express';
import { env, ROOT } from './config/env.ts';
import { connectDb } from './db/mongo.ts';
import { errorHandler, notFoundHandler } from './middleware/errors.ts';
import { httpsOnly, securityHeaders } from './middleware/security.ts';
import { loadSession } from './middleware/session.ts';
import { siteApiRouter } from './routes/siteApi.ts';
import { authRouter } from './routes/auth.ts';
import { portalRouter } from './routes/portal.ts';
import { adminRouter } from './routes/admin.ts';
import { portalApiRouter } from './routes/portalApi.ts';
import { seedDefaultPlans } from './services/plans.ts';
import { getPluginZipFile, getPluginVersion } from './services/pluginPackage.ts';

// Async because connecting to MongoDB is: unlike node:sqlite's DatabaseSync,
// which opened the file synchronously on first query, the driver has to
// finish its handshake before a single collection call is safe to make.
export async function createApp(): Promise<Express> {
  await connectDb();
  await seedDefaultPlans();

  const app = express();

  if (env.TRUST_PROXY) app.set('trust proxy', 1);
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
  app.use(
    express.json({
      limit: jsonLimit,
      verify: (req, _res, buf) => {
        (req as express.Request).rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  app.use(
    '/assets',
    express.static(path.join(ROOT, 'src', 'public'), {
      maxAge: env.isProd ? '7d' : 0,
      etag: true,
    }),
  );

  // Unauthenticated liveness probe. Deliberately reveals nothing.
  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, service: 'chat-pilot-saas', api_version: 'v1' });
  });

  // --- Plugin-facing API (Site API Key + HMAC) ---
  app.use('/api/v1/site', siteApiRouter);

  // --- Portal (session cookie) ---
  app.use(loadSession);
  // Defensive handlers for 307-forwarded POST requests
  app.post('/admin', (_req, res) => res.redirect(303, '/admin'));
  app.post('/app', (_req, res) => res.redirect(303, '/app'));
  app.use('/', authRouter);
  app.use('/app', portalRouter);
  app.use('/api/v1/portal', portalApiRouter);
  app.use('/admin', adminRouter);
  // --- Plugin Download Route ---
  app.get(['/download/plugin', '/download/chat-pilot.zip'], (_req, res) => {
    const file = getPluginZipFile();
    if (!file) {
      return res.status(404).send('Plugin archive not found.');
    }
    const version = getPluginVersion();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="chat-pilot-v${version}.zip"`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.sendFile(file);
  });

  app.get('/', (req, res) => {
    if (req.user) {
      res.redirect(303, req.user.platform_role === 'super_admin' ? '/admin' : '/app');
      return;
    }
    res.redirect(303, '/login');
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
