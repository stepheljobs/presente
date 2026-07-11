import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Pool } from 'pg';
import request from 'supertest';
import { createTestApp, ownerPool } from './helpers';

const TRUNCATE =
  'TRUNCATE enrollment_photos, consents, site_workers, workers, site_engineers, sites, company_settings, audit_log, users, tenants CASCADE';

describe('E3-S01/S10/S11 + E2-S04 workers, approval, rosters, deactivation', () => {
  let app: INestApplication;
  let owner: Pool;
  let tenantId: string;
  let adminToken: string;
  let engineerToken: string;
  let siteId: string;

  const authed = (
    method: 'get' | 'post' | 'put' | 'delete',
    path: string,
    token: string,
  ) =>
    request(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    owner = ownerPool();
    await owner.query(TRUNCATE);
    const t = await owner.query(
      `INSERT INTO tenants (name) VALUES ('Alpha Builders') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const users = await owner.query(
      `INSERT INTO users (tenant_id, email, password_hash, role) VALUES
       ($1, 'admin@alpha.ph', 'x', 'admin'),
       ($1, 'eng@alpha.ph', 'x', 'engineer') RETURNING id`,
      [tenantId],
    );
    const s = await owner.query(
      `INSERT INTO sites (tenant_id, name, lat, lng) VALUES
       ($1, 'Tower A', 14.55, 121.05) RETURNING id`,
      [tenantId],
    );
    siteId = s.rows[0].id;
    app = await createTestApp();
    const jwt = app.get(JwtService);
    adminToken = jwt.sign({
      sub: users.rows[0].id,
      tenantId,
      email: 'admin@alpha.ph',
      role: 'admin',
    });
    engineerToken = jwt.sign({
      sub: users.rows[1].id,
      tenantId,
      email: 'eng@alpha.ph',
      role: 'engineer',
    });
  });

  afterAll(async () => {
    await owner.query(TRUNCATE);
    await owner.end();
    await app.close();
  });

  it('admin-created worker is active; gov ID is encrypted at rest', async () => {
    const res = await authed('post', '/workers', adminToken)
      .send({
        fullName: 'Ramon Torres',
        position: 'Mason',
        dailyRate: 650,
        govId: 'PH-1234-5678',
      })
      .expect(201);
    expect(res.body.status).toBe('active');
    expect(res.body.dailyRate).toBe(650);
    expect(res.body.govId).toBe('PH-1234-5678');

    // Raw column is ciphertext, not the plain value.
    const raw = await owner.query(
      `SELECT gov_id_enc::text AS enc FROM workers WHERE full_name = 'Ramon Torres'`,
    );
    expect(raw.rows[0].enc).not.toContain('PH-1234');
  });

  it('engineer responses omit rate and gov ID entirely', async () => {
    const list = await authed('get', '/workers', engineerToken).expect(200);
    const worker = list.body.items[0];
    expect(worker.fullName).toBe('Ramon Torres');
    expect(worker).not.toHaveProperty('dailyRate');
    expect(worker).not.toHaveProperty('govId');

    const single = await authed(
      'get',
      `/workers/${worker.id}`,
      engineerToken,
    ).expect(200);
    expect(single.body).not.toHaveProperty('dailyRate');
  });

  it('engineer-created worker enters pending_approval with no rate (E3-S10)', async () => {
    const res = await authed('post', '/workers', engineerToken)
      .send({ fullName: 'Bong Reyes', position: 'Laborer', dailyRate: 999 })
      .expect(201);
    expect(res.body.status).toBe('pending_approval');

    const raw = await owner.query(
      `SELECT daily_rate FROM workers WHERE full_name = 'Bong Reyes'`,
    );
    expect(raw.rows[0].daily_rate).toBeNull(); // engineer-set rate ignored
  });

  it('approve sets rate and activates; reject requires a note; both audited', async () => {
    const pending = await authed(
      'get',
      '/workers?status=pending_approval',
      adminToken,
    ).expect(200);
    const bong = pending.body.items.find(
      (w: { fullName: string }) => w.fullName === 'Bong Reyes',
    );

    const approved = await authed(
      'post',
      `/workers/${bong.id}/approve`,
      adminToken,
    )
      .send({ dailyRate: 610 })
      .expect(200);
    expect(approved.body.status).toBe('active');
    expect(approved.body.dailyRate).toBe(610);

    // Second pending worker to reject.
    const w2 = await authed('post', '/workers', engineerToken)
      .send({ fullName: 'Ghost Worker' })
      .expect(201);
    await authed('post', `/workers/${w2.body.id}/reject`, adminToken)
      .send({})
      .expect(400); // note required
    await authed('post', `/workers/${w2.body.id}/reject`, adminToken)
      .send({ note: 'Duplicate of Ramon' })
      .expect(200);

    const audit = await owner.query(
      `SELECT count(*)::int AS n FROM audit_log
       WHERE action IN ('worker.approve', 'worker.reject')`,
    );
    expect(audit.rows[0].n).toBe(2);
  });

  it('roster add/remove is audited; list filters by site (E2-S04)', async () => {
    const workers = await authed('get', '/workers', adminToken).expect(200);
    const ramon = workers.body.items.find(
      (w: { fullName: string }) => w.fullName === 'Ramon Torres',
    );

    await authed(
      'post',
      `/sites/${siteId}/workers/${ramon.id}`,
      adminToken,
    ).expect(201);

    const roster = await authed(
      'get',
      `/workers?siteId=${siteId}`,
      adminToken,
    ).expect(200);
    expect(roster.body.items.map((w: { id: string }) => w.id)).toEqual([
      ramon.id,
    ]);

    await authed(
      'delete',
      `/sites/${siteId}/workers/${ramon.id}`,
      adminToken,
    ).expect(200);
    const empty = await authed(
      'get',
      `/workers?siteId=${siteId}`,
      adminToken,
    ).expect(200);
    expect(empty.body.items).toEqual([]);

    const audit = await owner.query(
      `SELECT count(*)::int AS n FROM audit_log
       WHERE action IN ('roster.add', 'roster.remove')`,
    );
    expect(audit.rows[0].n).toBe(2);
  });

  it('roster pagination handles 200+ workers (E2-S04)', async () => {
    await owner.query(
      `INSERT INTO workers (tenant_id, full_name)
       SELECT $1, 'Bulk Worker ' || lpad(g::text, 3, '0') FROM generate_series(1, 210) g`,
      [tenantId],
    );
    await owner.query(
      `INSERT INTO site_workers (tenant_id, site_id, worker_id)
       SELECT $1, $2, id FROM workers WHERE full_name LIKE 'Bulk Worker %'`,
      [tenantId, siteId],
    );
    const page1 = await authed(
      'get',
      `/workers?siteId=${siteId}&page=1&pageSize=200`,
      adminToken,
    ).expect(200);
    expect(page1.body.total).toBe(210);
    expect(page1.body.items).toHaveLength(200);
    const page2 = await authed(
      'get',
      `/workers?siteId=${siteId}&page=2&pageSize=200`,
      adminToken,
    ).expect(200);
    expect(page2.body.items).toHaveLength(10);
  });

  it('deactivation sets end date, retention timer, and clears rosters (E3-S11)', async () => {
    const workers = await authed(
      'get',
      '/workers?pageSize=500',
      adminToken,
    ).expect(200);
    const ramon = workers.body.items.find(
      (w: { fullName: string }) => w.fullName === 'Ramon Torres',
    );
    await authed(
      'post',
      `/sites/${siteId}/workers/${ramon.id}`,
      adminToken,
    ).expect(201);

    const res = await authed(
      'post',
      `/workers/${ramon.id}/deactivate`,
      adminToken,
    )
      .send({ endDate: '2026-07-31' })
      .expect(200);
    expect(res.body.status).toBe('deactivated');
    expect(res.body.endDate).toBe('2026-07-31');
    // Default retention: 12 months after the end date (timestamp compared
    // as an instant — string rendering is timezone-dependent).
    const retention = Date.parse(res.body.retentionUntil);
    const dayMs = 24 * 3600 * 1000;
    expect(Math.abs(retention - Date.parse('2027-07-31T00:00:00+08:00')))
      .toBeLessThan(dayMs);

    const roster = await owner.query(
      'SELECT count(*)::int AS n FROM site_workers WHERE worker_id = $1',
      [ramon.id],
    );
    expect(roster.rows[0].n).toBe(0);
  });

  it('engineer cannot update, approve, or deactivate workers', async () => {
    const workers = await authed(
      'get',
      '/workers?pageSize=500',
      adminToken,
    ).expect(200);
    const anyone = workers.body.items[0];
    await authed('put', `/workers/${anyone.id}`, engineerToken)
      .send({ fullName: 'Hacked Name' })
      .expect(403);
    await authed('post', `/workers/${anyone.id}/deactivate`, engineerToken)
      .send({ endDate: '2026-07-31' })
      .expect(403);
  });
});
