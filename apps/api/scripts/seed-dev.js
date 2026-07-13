#!/usr/bin/env node
/**
 * Seeds a demo tenant, owner, sample site, and roster workers for local dev.
 * Idempotent.
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

const DEMO_WORKERS = [
  { fullName: 'Ana Reyes', nickname: 'Ana', position: 'Mason', dailyRate: 650 },
  {
    fullName: 'Benito Ramos',
    nickname: 'Ben',
    position: 'Carpenter',
    dailyRate: 700,
  },
];

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

  let siteId;
  const existingSite = await pool.query(
    `SELECT id FROM sites WHERE tenant_id = $1 AND name = $2`,
    [tenantId, DEMO_SITE.name],
  );
  if (existingSite.rowCount > 0) {
    siteId = existingSite.rows[0].id;
    console.log(`Site "${DEMO_SITE.name}" already seeded.`);
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
    siteId = site.rows[0].id;
    const row = site.rows[0];
    console.log(
      `Seeded site: ${row.name} @ ${row.lat}, ${row.lng} (r=${row.radius_m}m)`,
    );
  }

  for (const w of DEMO_WORKERS) {
    let workerId;
    const existing = await pool.query(
      `SELECT id FROM workers WHERE tenant_id = $1 AND full_name = $2`,
      [tenantId, w.fullName],
    );
    if (existing.rowCount > 0) {
      workerId = existing.rows[0].id;
      console.log(`Worker "${w.fullName}" already seeded.`);
    } else {
      const inserted = await pool.query(
        `INSERT INTO workers
           (tenant_id, full_name, nickname, position, daily_rate, status)
         VALUES ($1, $2, $3, $4, $5, 'active')
         RETURNING id`,
        [tenantId, w.fullName, w.nickname, w.position, w.dailyRate],
      );
      workerId = inserted.rows[0].id;
      console.log(`Seeded worker: ${w.fullName}`);
    }

    const onRoster = await pool.query(
      `SELECT 1 FROM site_workers WHERE site_id = $1 AND worker_id = $2`,
      [siteId, workerId],
    );
    if (onRoster.rowCount > 0) {
      console.log(`  already on roster for ${DEMO_SITE.name}`);
    } else {
      await pool.query(
        `INSERT INTO site_workers (tenant_id, site_id, worker_id)
         VALUES ($1, $2, $3)`,
        [tenantId, siteId, workerId],
      );
      console.log(`  assigned to ${DEMO_SITE.name}`);
    }
  }

  await pool.end();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
