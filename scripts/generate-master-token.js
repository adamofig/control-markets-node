#!/usr/bin/env node
/**
 * Generates a System Master Token (`cm_master_*`) for SYSTEM_MASTER_TOKEN.
 *
 * Usage: npm run generate:master-token
 *
 * The value is never stored in MongoDB — paste it into the server .env (or the cluster secret)
 * and hand the same value to every infrastructure caller.
 */
const { randomBytes } = require('crypto');

// 14 bytes (112 bits) keeps the token short enough to paste around comfortably while staying
// far above brute-force range for a bearer secret — well over the service's 32-char minimum.
const token = `cm_master_${randomBytes(14).toString('hex')}`;

console.log('\nSystem Master Token generated. Store it in your server environment:\n');
console.log(`CONTROL_MASTER_TOKEN=${token}`);
console.log('# (Legacy alias: SYSTEM_MASTER_TOKEN=...)');
console.log('# SYSTEM_MASTER_USER=adamo.figueroa@gmail.com   # identity the token acts as by default\n');
console.log('Callers send it as:  Authorization: Bearer <token>   (or  x-api-key: <token>)');
console.log('Optional headers:    x-org-id: <orgId>              x-system-user: <email|userId>\n');
