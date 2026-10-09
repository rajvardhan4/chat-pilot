/**
 * Vercel Serverless Function entry point for Chat Pilot SaaS (Monorepo Root).
 */
let appPromise = null;

export default async function handler(req, res) {
  // 1. Guard check: Required production environment variables
  const missing = [];
  if (!process.env.MONGODB_URI) missing.push('MONGODB_URI');
  if (!process.env.ENCRYPTION_KEY) missing.push('ENCRYPTION_KEY');
  if (!process.env.SESSION_SECRET) missing.push('SESSION_SECRET');
  if (!process.env.SITE_KEY_PEPPER) missing.push('SITE_KEY_PEPPER');

  if (missing.length > 0) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Chat Pilot — Vercel Setup Required</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #090d16;
            color: #f1f5f9;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
          }
          .container {
            max-width: 660px;
            width: 100%;
            background: #111827;
            border: 1px solid #1f2937;
            border-radius: 16px;
            padding: 36px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.5);
          }
          .badge {
            display: inline-block;
            background: rgba(239, 68, 68, 0.15);
            color: #f87171;
            font-size: 13px;
            font-weight: 600;
            padding: 4px 12px;
            border-radius: 999px;
            margin-bottom: 16px;
          }
          h1 { font-size: 22px; font-weight: 700; margin-bottom: 12px; color: #fff; }
          p { color: #94a3b8; font-size: 15px; line-height: 1.6; margin-bottom: 20px; }
          .missing-box {
            background: #182234;
            border: 1px solid #2d3c54;
            border-radius: 10px;
            padding: 16px 20px;
            margin-bottom: 24px;
          }
          .missing-title { font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; margin-bottom: 10px; font-weight: 600; }
          .keys { display: flex; flex-direction: column; gap: 8px; }
          .key-item { display: flex; align-items: center; gap: 8px; font-family: monospace; font-size: 14px; color: #fca5a5; }
          .steps {
            background: rgba(56, 189, 248, 0.05);
            border-left: 3px solid #38bdf8;
            padding: 16px 20px;
            border-radius: 0 8px 8px 0;
            margin-bottom: 24px;
          }
          .steps h3 { font-size: 14px; color: #38bdf8; margin-bottom: 8px; }
          .steps ol { padding-left: 20px; color: #cbd5e1; font-size: 14px; line-height: 1.6; }
          .steps li { margin-bottom: 6px; }
          .footer { font-size: 13px; color: #64748b; text-align: center; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="badge">⚙️ Action Required on Vercel</div>
          <h1>Missing Environment Variables</h1>
          <p>Chat Pilot SaaS deployed successfully, but required production secrets are missing in your Vercel Dashboard.</p>
          <div class="missing-box">
            <div class="missing-title">Missing Environment Variables:</div>
            <div class="keys">
              ${missing.map(k => `<div class="key-item">⚠️ <span>${k}</span></div>`).join('')}
            </div>
          </div>
          <div class="steps">
            <h3>How to configure on Vercel:</h3>
            <ol>
              <li>Go to your <strong>Vercel Dashboard</strong> &rarr; Select <strong>chat-pilot</strong> project.</li>
              <li>Navigate to <strong>Settings</strong> &rarr; <strong>Environment Variables</strong>.</li>
              <li>Add the missing variables (e.g. <code>MONGODB_URI</code>, <code>ENCRYPTION_KEY</code>, <code>SESSION_SECRET</code>, <code>SITE_KEY_PEPPER</code>).</li>
              <li>Go to <strong>Deployments</strong> tab and click <strong>Redeploy</strong>.</li>
            </ol>
          </div>
          <div class="footer">Chat Pilot SaaS Platform &bull; Production Security Guard</div>
        </div>
      </body>
      </html>
    `);
  }

  // 2. Load and invoke Express app
  try {
    if (!appPromise) {
      const { createApp } = await import('../saas/src/app.js');
      appPromise = createApp();
    }
    const app = await appPromise;
    return app(req, res);
  } catch (err) {
    console.error('[chat-pilot] Serverless Error:', err);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <body style="font-family: sans-serif; background: #090d16; color: #f1f5f9; padding: 40px;">
        <h2 style="color: #f87171;">⚠️ Chat Pilot Database / Startup Error</h2>
        <p style="margin-top: 12px; color: #cbd5e1;">${err.message}</p>
        <p style="margin-top: 16px; color: #94a3b8; font-size: 14px;">
          If this is a MongoDB connection error, please check that MongoDB Atlas Network Access has <code>0.0.0.0/0</code> allowed.
        </p>
      </body>
      </html>
    `);
  }
}
