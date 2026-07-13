#!/usr/bin/env node
/**
 * Seeds a demo tenant, owner, and sample site for local development. Idempotent.
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

/** Near Sto. Tomas City Hall / Maharlika Hwy area, Batangas. */
const DEMO_SITE = {
  name: 'Sierra Verde Townhomes Phase 2',
  client: 'Verde Homes Realty',
  address: 'Maharlika Highway, Sto. Tomas City, Batangas',
  lat: 14.1078,
  lng: 121.1414,
  radiusM: 200,
};

(async () => {
  const pool = new Pool({
    connectionString:
      process.env.MIGRATION_DATABASE_URL ??
      'postgres://localhost:5432/presente_dev',
  });

  let tenantId;
  const existingUser = await pool.query(
    'SELECT id, tenant_id FROM users WHERE email = $1',
    [EMAIL],
  );
  if (existingUser.rowCount > 0) {
    tenantId = existingUser.rows[0].tenant_id;
    console.log(`${EMAIL} already seeded — skipping user.`);
  } else {
    const tenant = await pool.query(
      `INSERT INTO tenants (name) VALUES ('Demo Construction Co') RETURNING id`,
    );
    tenantId = tenant.rows[0].id;
    const hash = await argon2.hash(PASSWORD);
    await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, role)
       VALUES ($1, $2, $3, 'owner')`,
      [tenantId, EMAIL, hash],
    );
    console.log(`Seeded ${EMAIL} / ${PASSWORD}`);
  }

  const existingSite = await pool.query(
    `SELECT id FROM sites WHERE tenant_id = $1 AND name = $2`,
    [tenantId, DEMO_SITE.name],
  );
  if (existingSite.rowCount > 0) {
    console.log(`Site "${DEMO_SITE.name}" already seeded — nothing to do.`);
  } else {
    const site = await pool.query(
      `INSERT INTO sites (tenant_id, name, client, address, lat, lng, radius_m)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, lat, lng, radius_m`,
      [
        tenantId,
        DEMO_SITE.name,
        DEMO_SITE.client,
        DEMO_SITE.address,
        DEMO_SITE.lat,
        DEMO_SITE.lng,
        DEMO_SITE.radiusM,
      ],
    );
    const row = site.rows[0];
    console.log(
      `Seeded site: ${row.name} @ ${row.lat}, ${row.lng} (r=${row.radius_m}m)`,
    );
  }

  await pool.end();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
