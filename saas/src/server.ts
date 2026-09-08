import { createApp } from './app.ts';
import { env } from './config/env.ts';
import { log } from './core/logger.ts';
import { db } from './db/index.ts';
import { startMaintenanceSchedule } from './services/maintenance.ts';

const app = createApp();

// Conversation timeouts and retention are enforced by a periodic sweep.
const stopMaintenance = startMaintenanceSchedule();

const server = app.listen(env.PORT, () => {
  // Both numbers, because behind a reverse proxy they are different things:
  // the port the process bound, and the address the outside world uses. A
  // banner showing only APP_URL hides a PORT that did not take effect.
  // eslint-disable-next-line no-console
  console.log(
    '[chat-pilot] SaaS portal listening on port ' + env.PORT +
      ' — public URL ' + env.APP_URL + ' (' + env.NODE_ENV + ')',
  );
});

function shutdown(signal: string): void {
  log.info('Shutting down (' + signal + ').');
  stopMaintenance();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 8000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  log.error('Unhandled promise rejection.', { reason: String(reason) });
});
