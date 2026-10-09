/**
 * Bootstrap seed: connects to MongoDB, ensures indexes and the default plan
 * ladder exist, and creates the platform super admin from
 * SUPERADMIN_EMAIL/PASSWORD.
 *
 * Safe to re-run. It never overwrites an existing password.
 */
import { env } from "../src/config/env.js";
import { connectDb, closeDb } from "../src/db/mongo.js";
import { createSuperAdmin, findUserByEmail } from "../src/services/accounts.js";
import { seedDefaultPlans } from "../src/services/plans.js";
await connectDb();
await seedDefaultPlans();
console.log('[seed] MongoDB indexes ensured and default plans applied.');
if (!env.SUPERADMIN_EMAIL || !env.SUPERADMIN_PASSWORD) {
    console.log('[seed] SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD not set - skipping admin creation.');
}
else if (await findUserByEmail(env.SUPERADMIN_EMAIL)) {
    console.log('[seed] Super admin already exists: ' + env.SUPERADMIN_EMAIL);
}
else {
    const user = await createSuperAdmin(env.SUPERADMIN_EMAIL, env.SUPERADMIN_PASSWORD, 'Chat Pilot Administrator');
    console.log('[seed] Super admin created: ' + user.email);
}
await closeDb();
