#!/usr/bin/env node
/**
 * Seeds photo-style time-in / time-out sessions + day records for demo workers
 * Ana Reyes & Benito Ramos, 2026-07-06 → 2026-07-12 (Asia/Manila).
 *
 * Prerequisites:  pnpm --filter @presente/api seed:dev
 * Run:            pnpm --filter @presente/api seed:attendance
 *
 * Idempotent: removes prior rows tagged with device_id = seed-demo-attendance
 * for this tenant before re-inserting.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const OWNER_EMAIL = 'owner@demo.ph';
const SITE_NAME = 'Sierra Verde Townhomes Phase 2';
const WORKER_NAMES = ['Ana Reyes', 'Benito Ramos'];
const DEVICE_ID = 'seed-demo-attendance';
const DAY_FROM = '2026-07-06';
const DAY_TO = '2026-07-12';

/** Schedules in local Manila wall time (hour, minute). */
const SCHEDULE = {
  'Ana Reyes': {
    // Mon–Fri full day, Sat half day, Sun off
    '2026-07-06': { in: [7, 50], out: [17, 5] },
    '2026-07-07': { in: [7, 55], out: [17, 0] },
    '2026-07-08': { in: [8, 5], out: [17, 10] },
    '2026-07-09': { in: [7, 48], out: [16, 55] },
    '2026-07-10': { in: [8, 0], out: [17, 0] },
    '2026-07-11': { in: [8, 0], out: [12, 0] }, // Sat half day
    // 2026-07-12 Sunday — absent (no sessions)
  },
  'Benito Ramos': {
    '2026-07-06': { in: [8, 0], out: [17, 30] },
    '2026-07-07': { in: [7, 45], out: [17, 15] },
    '2026-07-08': { in: [8, 10], out: [17, 5] },
    '2026-07-09': { in: [8, 0], out: [18, 0] }, // OT
    '2026-07-10': { in: [7, 58], out: [17, 2] },
    '2026-07-11': { in: [8, 0], out: [17, 0] },
    '2026-07-12': { in: [8, 30], out: [12, 30] }, // Sun short
  },
};

function daysInclusive(from, to) {
  const out = [];
  const cur = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/** Manila wall clock → Date (timestamptz). */
function manilaDate(day, hour, minute) {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return new Date(`${day}T${hh}:${mm}:00+08:00`);
}

function hoursBetween(a, b) {
  if (!a || !b) return 0;
  const h = (b.getTime() - a.getTime()) / 3_600_000;
  return Math.round(h * 100) / 100;
}

function classifyStatus(hours, hasIn, hasOut) {
  if (!hasIn && !hasOut) return 'absent';
  if (!hasIn || !hasOut) return hasIn ? 'present' : 'absent'; // partial still photo-present-ish
  if (hours >= 8.01) return 'ot_candidate';
  if (hours > 0 && hours < 4) return 'halfday';
  if (hours >= 4) return 'present';
  return 'absent';
}

(async () => {
  const pool = new Pool({
    connectionString:
      process.env.MIGRATION_DATABASE_URL ??
      'postgres://localhost:5432/presente_dev',
  });

  const owner = await pool.query(
    `SELECT id, tenant_id FROM users WHERE email = $1`,
    [OWNER_EMAIL],
  );
  if (!owner.rowCount) {
    console.error(
      `No ${OWNER_EMAIL} — run: pnpm --filter @presente/api seed:dev`,
    );
    process.exit(1);
  }
  const engineerId = owner.rows[0].id;
  const tenantId = owner.rows[0].tenant_id;

  const site = await pool.query(
    `SELECT id, lat, lng FROM sites WHERE tenant_id = $1 AND name = $2`,
    [tenantId, SITE_NAME],
  );
  if (!site.rowCount) {
    console.error(`Site "${SITE_NAME}" missing — run seed:dev first`);
    process.exit(1);
  }
  const siteId = site.rows[0].id;
  const lat = site.rows[0].lat ?? 14.1078;
  const lng = site.rows[0].lng ?? 121.1414;

  const workers = await pool.query(
    `SELECT id, full_name FROM workers
     WHERE tenant_id = $1 AND full_name = ANY($2::text[])`,
    [tenantId, WORKER_NAMES],
  );
  if (workers.rowCount < WORKER_NAMES.length) {
    console.error(
      `Need workers ${WORKER_NAMES.join(', ')} — run seed:dev first`,
    );
    process.exit(1);
  }
  const byName = Object.fromEntries(
    workers.rows.map((w) => [w.full_name, w.id]),
  );

  // Ensure company_settings (timezone) for dashboard/recompute consistency.
  await pool.query(
    `INSERT INTO company_settings (tenant_id, timezone)
     VALUES ($1, 'Asia/Manila')
     ON CONFLICT (tenant_id) DO UPDATE SET timezone = 'Asia/Manila'`,
    [tenantId],
  );

  // Ensure on site roster.
  for (const name of WORKER_NAMES) {
    await pool.query(
      `INSERT INTO site_workers (tenant_id, site_id, worker_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [tenantId, siteId, byName[name]],
    );
  }

  // Wipe previous seed rows for this device (photos/tags cascade).
  const old = await pool.query(
    `SELECT id FROM attendance_sessions
     WHERE tenant_id = $1 AND device_id = $2`,
    [tenantId, DEVICE_ID],
  );
  if (old.rowCount) {
    // Exceptions may reference sessions — null them first if needed.
    await pool.query(
      `UPDATE exceptions SET session_id = NULL
       WHERE session_id = ANY($1::uuid[])`,
      [old.rows.map((r) => r.id)],
    );
    await pool.query(
      `DELETE FROM attendance_sessions WHERE id = ANY($1::uuid[])`,
      [old.rows.map((r) => r.id)],
    );
    console.log(`Removed ${old.rowCount} prior seed session(s).`);
  }

  const workerIds = WORKER_NAMES.map((n) => byName[n]);
  await pool.query(
    `DELETE FROM day_records
     WHERE tenant_id = $1
       AND worker_id = ANY($2::uuid[])
       AND day BETWEEN $3::date AND $4::date
       AND site_id = $5`,
    [tenantId, workerIds, DAY_FROM, DAY_TO, siteId],
  );

  const range = daysInclusive(DAY_FROM, DAY_TO);
  let sessions = 0;
  let daysWritten = 0;

  for (const day of range) {
    for (const name of WORKER_NAMES) {
      const plan = SCHEDULE[name][day];
      if (!plan) {
        // Explicit absent day-record for visibility in attendance grids.
        await pool.query(
          `INSERT INTO day_records
             (tenant_id, worker_id, site_id, day, time_in, time_out, hours,
              status, source, session_ids, photo_ids, within_fence, mock_location)
           VALUES ($1,$2,$3,$4::date,NULL,NULL,0,'absent','photo','{}','{}',true,false)
           ON CONFLICT (tenant_id, worker_id, day, site_id) DO UPDATE SET
             time_in = NULL, time_out = NULL, hours = 0, status = 'absent',
             source = 'photo', updated_at = now()`,
          [tenantId, byName[name], siteId, day],
        );
        daysWritten++;
        console.log(`  ${day} ${name}: absent`);
        continue;
      }

      const timeIn = manilaDate(day, plan.in[0], plan.in[1]);
      const timeOut = manilaDate(day, plan.out[0], plan.out[1]);
      const sessionIds = [];
      const photoIds = [];

      for (const [type, at] of [
        ['time_in', timeIn],
        ['time_out', timeOut],
      ]) {
        const sessionId = crypto.randomUUID();
        const photoId = crypto.randomUUID();
        const tagId = crypto.randomUUID();
        sessionIds.push(sessionId);
        photoIds.push(photoId);

        await pool.query(
          `INSERT INTO attendance_sessions
             (id, tenant_id, type, site_id, engineer_id, device_id, payload,
              device_captured_at, device_sent_at, server_received_at,
              clock_drift_seconds, lat, lng, gps_status, distance_m,
              within_fence, mock_location, clock_drift_flagged)
           VALUES
             ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$8,$8,0,$9,$10,'fix',12,true,false,false)`,
          [
            sessionId,
            tenantId,
            type,
            siteId,
            engineerId,
            DEVICE_ID,
            JSON.stringify({ seed: 'attendance-jul2026', worker: name }),
            at.toISOString(),
            lat,
            lng,
          ],
        );

        await pool.query(
          `INSERT INTO session_photos
             (id, tenant_id, session_id, storage_key, recognition_status)
           VALUES ($1,$2,$3,$4,'done')`,
          [
            photoId,
            tenantId,
            sessionId,
            `seed/${day}/${name.replace(/\s+/g, '-').toLowerCase()}/${type}.jpg`,
          ],
        );

        await pool.query(
          `INSERT INTO session_tags
             (id, tenant_id, session_id, photo_id, worker_id, band, confidence,
              source, status, created_by)
           VALUES ($1,$2,$3,$4,$5,'high',0.97,'auto','active',$6)`,
          [tagId, tenantId, sessionId, photoId, byName[name], engineerId],
        );
        sessions++;
      }

      const hrs = hoursBetween(timeIn, timeOut);
      const status = classifyStatus(hrs, true, true);

      await pool.query(
        `INSERT INTO day_records
           (tenant_id, worker_id, site_id, day, time_in, time_out, hours,
            status, source, session_ids, photo_ids, within_fence, mock_location,
            geofence_distance_m)
         VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,'photo',$9,$10,true,false,12)
         ON CONFLICT (tenant_id, worker_id, day, site_id) DO UPDATE SET
           time_in = excluded.time_in,
           time_out = excluded.time_out,
           hours = excluded.hours,
           status = excluded.status,
           source = 'photo',
           session_ids = excluded.session_ids,
           photo_ids = excluded.photo_ids,
           within_fence = true,
           mock_location = false,
           geofence_distance_m = 12,
           updated_at = now()`,
        [
          tenantId,
          byName[name],
          siteId,
          day,
          timeIn.toISOString(),
          timeOut.toISOString(),
          hrs,
          status,
          sessionIds,
          photoIds,
        ],
      );
      daysWritten++;
      console.log(
        `  ${day} ${name}: ${plan.in[0]}:${String(plan.in[1]).padStart(2, '0')}–${plan.out[0]}:${String(plan.out[1]).padStart(2, '0')} Manila · ${hrs}h · ${status}`,
      );
    }
  }

  console.log(
    `\nDone. ${sessions} sessions, ${daysWritten} day-records for ${SITE_NAME}.`,
  );
  console.log(`Range: ${DAY_FROM} → ${DAY_TO} (Asia/Manila). Re-run is safe.`);
  await pool.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
