/**
 * Creates (or promotes) a Chat Pilot master administrator.
 *
 * Master admin is deliberately not something you can sign up for. The signup
 * form only ever creates a customer account, so the only way to get platform
 * privileges is to run this on the server that owns the database - which is the
 * one place where being able to read every tenant's data is legitimate.
 *
 * Usage:
 *   npm run admin:create -- --email you@example.com --name "Your Name"
 *   npm run admin:create -- --email you@example.com --password 'S3cret!' --name "Your Name"
 *
 * With no --password one is generated and printed once. Running it again for an
 * existing email promotes that user to master admin instead of creating a
 * second account; pass --password as well to reset their password at the same
 * time.
 */
import { randomBytes } from 'node:crypto';
import { createSuperAdmin, findUserByEmail, setFullName, setPassword } from "../src/services/accounts.js";
import { connectDb, closeDb } from "../src/db/mongo.js";
function arg(name) {
    const flag = '--' + name;
    const index = process.argv.indexOf(flag);
    if (index !== -1 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) {
        return process.argv[index + 1].trim();
    }
    const inline = process.argv.find((a) => a.startsWith(flag + '='));
    return inline ? inline.slice(flag.length + 1).trim() : '';
}
function fail(message) {
    console.error('\n  ' + message + '\n');
    console.error('  Usage: npm run admin:create -- --email you@example.com --name "Your Name"\n');
    process.exit(1);
}
/** A readable but genuinely random password, for when none was supplied. */
function generatePassword() {
    // Ambiguous glyphs are left out: this gets read off a terminal and retyped.
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const bytes = randomBytes(20);
    let out = '';
    for (const byte of bytes)
        out += alphabet[byte % alphabet.length];
    return out.slice(0, 8) + '-' + out.slice(8, 14) + '-' + out.slice(14, 20);
}
const email = arg('email');
const name = arg('name') || 'Master Admin';
const supplied = arg('password');
if (!email)
    fail('An --email is required.');
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    fail('"' + email + '" is not a valid email address.');
if (supplied && supplied.length < 12)
    fail('A master admin password must be at least 12 characters.');
// The database may not have been connected/indexed yet on a fresh install.
await connectDb();
const existing = await findUserByEmail(email);
const password = supplied || (existing ? '' : generatePassword());
const user = await createSuperAdmin(email, password || generatePassword(), name);
if (existing) {
    // createSuperAdmin() only changes the role for someone who already exists,
    // so a --name or --password given alongside it is applied here rather than
    // being silently ignored.
    if (supplied)
        await setPassword(user.id, supplied);
    if (arg('name'))
        await setFullName(user.id, name);
}
console.log('');
if (existing) {
    console.log('  Promoted an existing user to master admin.');
    console.log('    email:    ' + user.email);
    if (supplied) {
        console.log('    password: (reset to the one you supplied)');
    }
    else {
        console.log('    password: unchanged - they sign in with the password they already had');
    }
    if (arg('name')) {
        console.log('    name:     ' + name);
    }
}
else {
    console.log('  Master admin created.');
    console.log('    email:    ' + user.email);
    console.log('    password: ' + (supplied || password));
    if (!supplied) {
        console.log('');
        console.log('  This password is shown once. Copy it now, then change it after signing in.');
    }
}
console.log('');
console.log('  Sign in at /login. Master admins land on /admin instead of the client portal.');
console.log('');
await closeDb();
