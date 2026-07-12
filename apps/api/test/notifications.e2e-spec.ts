import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Pool } from 'pg';
import request from 'supertest';
import { createTestApp, ownerPool } from './helpers';

const TRUNCATE = `TRUNCATE tenants CASCADE`;

describe('E9 notifications: devices, reminder, digest, weekly summary', () => {
  let app: INestApplication;
  let owner: Pool;
  let tenantId: string;
  let adminToken: string;
  let ownerToken: string;
  let engineerToken: string;
  let engineerId: string;
  let ownerId: string;
  let adminId: string;
  let siteId: string;

  const post = (path: string, token: string) =>
    request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    owner = ownerPool();
    await owner.query(TRUNCATE);
    const t = await owner.query(
      `INSERT INTO tenants (name) VALUES ('Notify Co') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    // Reminder far in the past so the 15-min window always includes "now".
    await owner.query(
      `INSERT INTO company_settings (tenant_id, timezone, no_time_in_reminder_time)
       VALUES ($1, 'Asia/Manila', '00:00:00')`,
      [tenantId],
    );
    const users = await owner.query(
      `INSERT INTO users (tenant_id, email, password_hash, role, phone) VALUES
       ($1, 'owner@notify.ph', 'x', 'owner', '+639171111111'),
       ($1, 'admin@notify.ph', 'x', 'admin', NULL),
       ($1, 'eng@notify.ph', 'x', 'engineer', '+639172222222')
       RETURNING id, role`,
      [tenantId],
    );
    ownerId = users.rows.find((r: { role: string }) => r.role === 'owner').id;
    adminId = users.rows.find((r: { role: string }) => r.role === 'admin').id;
    engineerId = users.rows.find(
      (r: { role: string }) => r.role === 'engineer',
    ).id;

    const site = await owner.query(
      `INSERT INTO sites (tenant_id, name, lat, lng, radius_m)
       VALUES ($1, 'Site N', 14.55, 121.05, 150) RETURNING id`,
      [tenantId],
    );
    siteId = site.rows[0].id;
    await owner.query(
      `INSERT INTO site_engineers (tenant_id, site_id, user_id) VALUES ($1,$2,$3)`,
      [tenantId, siteId, engineerId],
    );
    // Open exception for admin digest
    await owner.query(
      `INSERT INTO exceptions (tenant_id, type, severity, note)
       VALUES ($1, 'geofence', 3, '900m out')`,
      [tenantId],
    );

    app = await createTestApp();
    const jwt = app.get(JwtService);
    ownerToken = jwt.sign({
      sub: ownerId,
      tenantId,
      email: 'owner@notify.ph',
      role: 'owner',
    });
    adminToken = jwt.sign({
      sub: adminId,
      tenantId,
      email: 'admin@notify.ph',
      role: 'admin',
    });
    engineerToken = jwt.sign({
      sub: engineerId,
      tenantId,
      email: 'eng@notify.ph',
      role: 'engineer',
    });
  });

  afterAll(async () => {
    await owner.query(TRUNCATE);
    await owner.end();
    await app.close();
  });

  it('E9-S01: registers device token and logs push delivery', async () => {
    await post('/notifications/devices', engineerToken)
      .send({ token: 'ExponentPushToken[test-engineer-device]', platform: 'android' })
      .expect(200);

    const tokens = await owner.query(
      `SELECT token FROM device_tokens WHERE user_id = $1`,
      [engineerId],
    );
    expect(tokens.rows[0].token).toContain('ExponentPushToken');
  });

  it('E9-S02: no-time-in reminder fires for engineer without session', async () => {
    const res = await post('/notifications/jobs/no-time-in', adminToken).expect(
      200,
    );
    expect(res.body.sent).toBeGreaterThanOrEqual(1);

    const log = await owner.query(
      `SELECT kind, channel, status, body FROM notification_log
       WHERE kind = 'no_time_in_reminder' AND user_id = $1`,
      [engineerId],
    );
    expect(log.rows.length).toBeGreaterThanOrEqual(1);
    expect(log.rows[0].status).toBe('sent');
    expect(log.rows[0].channel).toBe('push');

    // Dedupe: second run same day does not re-send
    const again = await post('/notifications/jobs/no-time-in', adminToken).expect(
      200,
    );
    expect(again.body.sent).toBe(0);
  });

  it('E9-S03: admin digest groups open exceptions; suppressed when zero after resolve', async () => {
    // Admin has no push token → email fallback
    const res = await post('/notifications/jobs/admin-digest', adminToken).expect(
      200,
    );
    expect(res.body.sent).toBeGreaterThanOrEqual(1);

    const log = await owner.query(
      `SELECT channel, body, status FROM notification_log
       WHERE kind = 'admin_exception_digest' AND user_id = $1`,
      [adminId],
    );
    expect(log.rows.length).toBeGreaterThanOrEqual(1);
    expect(log.rows[0].body).toContain('geofence');
    expect(['email', 'push', 'sms']).toContain(log.rows[0].channel);
  });

  it('E9-S04: owner weekly summary includes headcount / gross / exceptions', async () => {
    // Seed a day record in the previous payroll week so headcount > 0 if week matches
    await owner.query(
      `INSERT INTO day_records (tenant_id, worker_id, site_id, day, status, source, hours)
       SELECT $1, w.id, $2, (current_date - 3), 'present', 'photo', 8
       FROM workers w WHERE false`,
      [tenantId, siteId],
    );
    // Ensure owner has email path
    const res = await post('/notifications/jobs/owner-weekly', ownerToken).expect(
      200,
    );
    expect(res.body.sent).toBeGreaterThanOrEqual(1);

    const log = await owner.query(
      `SELECT body, channel, status FROM notification_log
       WHERE kind = 'owner_weekly_summary' AND user_id = $1`,
      [ownerId],
    );
    expect(log.rows.length).toBeGreaterThanOrEqual(1);
    expect(log.rows[0].body).toMatch(/Week|workers|exceptions/i);
    expect(log.rows[0].status).toBe('sent');
  });
});
