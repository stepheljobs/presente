#!/usr/bin/env node
/**
 * Seeds a demo tenant and owner for local development. Idempotent.
 * Connects as the table owner (RLS-exempt) via MIGRATION_DATABASE_URL.
 *
 *   pnpm --filter @presente/api seed:dev
 *   Login: owner@demo.ph / presente-dev-123
 */
const fs = require('fs');
const path = require('path');
const argon2 = require('argon2');
const { Pool } = require('pg');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const EMAIL = 'owner@demo.ph';
const PASSWORD = 'presente-dev-123';

(async () => {
  const pool = new Pool({
    connectionString:
      process.env.MIGRATION_DATABASE_URL ??
      'postgres://localhost:5432/presente_dev',
  });
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [
    EMAIL,
  ]);
  if (existing.rowCount > 0) {
    console.log(`${EMAIL} already seeded — nothing to do.`);
  } else {
    const tenant = await pool.query(
      `INSERT INTO tenants (name) VALUES ('Demo Construction Co') RETURNING id`,
    );
    const hash = await argon2.hash(PASSWORD);
    await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, role)
       VALUES ($1, $2, $3, 'owner')`,
      [tenant.rows[0].id, EMAIL, hash],
    );
    console.log(`Seeded ${EMAIL} / ${PASSWORD}`);
  }
  await pool.end();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
