import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { log } from "./core/logger.js";
import { closeDb, MongoConnectionError } from "./db/mongo.js";
import { startMaintenanceSchedule } from "./services/maintenance.js";
/**
 * Startup needs the database, so a failed connection is a failed start, not
 * a warning to serve traffic through. A server that boots without its
 * database only fails later, one confusing request at a time.
 *
 * The connection error already carries the sentence describing what to fix
 * (see explainConnectionFailure in db/mongo.ts); printing a stack trace on
 * top of it just buries that sentence.
 */
let app;
try {
    app = await createApp();
}
catch (err) {
    if (err instanceof MongoConnectionError) {
        // eslint-disable-next-line no-console
        console.error('\n[chat-pilot] Cannot start: ' + err.message + '\n');
    }
    else {
        // eslint-disable-next-line no-console
        console.error('\n[chat-pilot] Cannot start.\n', err, '\n');
    }
    process.exit(1);
}
// Conversation timeouts and retention are enforced by a periodic sweep.
const stopMaintenance = startMaintenanceSchedule();
const server = app.listen(env.PORT, () => {
    // Both numbers, because behind a reverse proxy they are different things:
    // the port the process bound, and the address the outside world uses. A
    // banner showing only APP_URL hides a PORT that did not take effect.
    // eslint-disable-next-line no-console
    console.log('[chat-pilot] SaaS portal listening on port ' + env.PORT +
        ' — public URL ' + env.APP_URL + ' (' + env.NODE_ENV + ')');
});
function shutdown(signal) {
    log.info('Shutting down (' + signal + ').');
    stopMaintenance();
    server.close(() => {
        closeDb()
            .catch((err) => log.error('Error closing MongoDB connection.', { error: String(err) }))
            .finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 8000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
    log.error('Unhandled promise rejection.', { reason: String(reason) });
});
