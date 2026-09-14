#!/usr/bin/env node
// Generates a bcrypt hash for a plaintext password, for STAFF_PASSWORD_HASH /
// ADMIN_PASSWORD_HASH in your local .env.local. Never commit the plaintext or the hash
// to a place that isn't your own local environment configuration.
//
// Usage: npm run auth:hash-password -- "your password here"

import bcrypt from "bcryptjs";

const password = process.argv[2];

if (!password) {
  console.error("Usage: npm run auth:hash-password -- \"your password here\"");
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 12);
console.log(hash);
