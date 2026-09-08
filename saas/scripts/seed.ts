/**
 * Bootstrap seed: applies migrations, ensures the default plan ladder exists,
 * and creates the platform super admin from SUPERADMIN_EMAIL/PASSWORD.
 *
 * Safe to re-run. It never overwrites an existing password.
 */
import { env } from '../src/config/env.ts';
import { db, migrate } from '../src/db/index.ts';
import { createSuperAdmin, findUserByEmail } from '../src/services/accounts.ts';
import { seedDefaultPlans } from '../src/services/plans.ts';

migrate();
seedDefaultPlans();
console.log('[seed] migrations applied and default plans ensured.');

if (!env.SUPERADMIN_EMAIL || !env.SUPERADMIN_PASSWORD) {
  console.log('[seed] SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD not set - skipping admin creation.');
} else if (findUserByEmail(env.SUPERADMIN_EMAIL)) {
  console.log('[seed] Super admin already exists: ' + env.SUPERADMIN_EMAIL);
} else {
  const user = createSuperAdmin(env.SUPERADMIN_EMAIL, env.SUPERADMIN_PASSWORD, 'Chat Pilot Administrator');
  console.log('[seed] Super admin created: ' + user.email);
}

db.close();
