#!/usr/bin/env node
// Generates a bcrypt hash for a plaintext password, ready to paste directly into
// STAFF_PASSWORD_HASH / ADMIN_PASSWORD_HASH in your local .env.local. Never commit the
// plaintext or the hash to a place that isn't your own local environment configuration.
//
// Usage: npm run auth:hash-password -- "your password here"
//
// Why the output has backslashes: a bcrypt hash always contains literal "$" characters
// (e.g. $2b$12$...), and Next.js's .env loader treats "$word" as a variable reference to
// expand — silently deleting that whole segment if no such variable exists. Escaping
// each "$" as "\$" here is what makes the hash survive being pasted into .env.local
// unchanged. Paste the line exactly as printed; don't "clean up" the backslashes.

import bcrypt from "bcryptjs";

const password = process.argv[2];

if (!password) {
  console.error('Usage: npm run auth:hash-password -- "your password here"');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 12);
const envSafeHash = hash.replaceAll("$", "\\$");

console.log(envSafeHash);
console.log("\nPaste the line above exactly as-is into .env.local (backslashes included).");
