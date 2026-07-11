import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Pool } from 'pg';
import request from 'supertest';
import { createTestApp, ownerPool } from './helpers';

const TRUNCATE = `TRUNCATE payroll_adjustments, payroll_ot_adjustments, payroll_lines,
  payroll_runs, day_records, exceptions, session_tags, session_photos,
  worker_day_admin_edits, attendance_sessions, site_workers, workers,
  site_engineers, sites, company_settings, audit_log, users, tenants CASCADE`;

describe('E7 payroll runs, compute, approve, export', () => {
  let app: INestApplication;
  let owner: Pool;
  let tenantId: string;
  let adminToken: string;
  let ownerToken: string;
  let siteId: string;
  let workerId: string;

  const post = (path: string, token: string) =>
    request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token}`);
  const get = (path: string, token: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    owner = ownerPool();
    await owner.query(TRUNCATE);
    const t = await owner.query(
      `INSERT INTO tenants (name) VALUES ('Pay Co') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    await owner.query(
      `INSERT INTO company_settings (tenant_id, standard_workday_hours, ot_multiplier)
       VALUES ($1, 8, 1.25)`,
      [tenantId],
    );
    const users = await owner.query(
      `INSERT INTO users (tenant_id, email, password_hash, role) VALUES
       ($1, 'admin@pay.ph', 'x', 'admin'),
       ($1, 'owner@pay.ph', 'x', 'owner') RETURNING id`,
      [tenantId],
    );
    const site = await owner.query(
      `INSERT INTO sites (tenant_id, name, lat, lng, radius_m, ot_eligible)
       VALUES ($1, 'Tower', 14.55, 121.05, 150, true) RETURNING id`,
      [tenantId],
    );
    siteId = site.rows[0].id;
    const w = await owner.query(
      `INSERT INTO workers (tenant_id, full_name, daily_rate, biometric_status)
       VALUES ($1, 'Ramon Torres', 800, 'enrolled') RETURNING id`,
      [tenantId],
    );
    workerId = w.rows[0].id;

    // Seed day records for Mon–Fri previous week 2026-07-06..12
    for (const day of [
      '2026-07-06',
      '2026-07-07',
      '2026-07-08',
      '2026-07-09',
      '2026-07-10',
    ]) {
      await owner.query(
        `INSERT INTO day_records
           (tenant_id, worker_id, site_id, day, time_in, time_out, hours, status, source)
         VALUES ($1, $2, $3, $4::date,
                 ($4 || 'T00:00:00Z')::timestamptz,
                 ($4 || 'T09:00:00Z')::timestamptz,
                 9, 'ot_candidate', 'photo')`,
        [tenantId, workerId, siteId, day],
      );
    }

    app = await createTestApp();
    const jwt = app.get(JwtService);
    adminToken = jwt.sign({
      sub: users.rows[0].id,
      tenantId,
      email: 'admin@pay.ph',
      role: 'admin',
    });
    ownerToken = jwt.sign({
      sub: users.rows[1].id,
      tenantId,
      email: 'owner@pay.ph',
      role: 'owner',
    });
  });

  afterAll(async () => {
    await owner.query(TRUNCATE);
    await owner.end();
    await app.close();
  });

  it('starts a run, computes gross with OT, transitions, blocks illegal, exports', async () => {
    const started = await post('/payroll/runs', adminToken)
      .send({ start: '2026-07-06', end: '2026-07-12' })
      .expect(201);

    expect(started.body.status).toBe('draft');
    expect(started.body.lines).toHaveLength(1);
    const line = started.body.lines[0];
    // 5 days × 800 + 5×1h OT × (800/8)×1.25 = 4000 + 5×125 = 4625
    expect(line.daysPresent).toBe(5);
    expect(line.otHours).toBe(5);
    expect(line.gross).toBe(4625);
    expect(started.body.totals.gross).toBe(4625);

    const runId = started.body.id;

    // Illegal jump draft → approved
    await post(`/payroll/runs/${runId}/transition`, adminToken)
      .send({ status: 'approved' })
      .expect(400);

    await post(`/payroll/runs/${runId}/transition`, adminToken)
      .send({ status: 'reviewed' })
      .expect(200);

    // Adjustment drops back path tested via add then recompute
    await post(`/payroll/runs/${runId}/adjustments`, adminToken)
      .send({ workerId, amount: -200, note: 'Cash advance' })
      .expect(200);

    const afterAdj = await get(`/payroll/runs/${runId}`, adminToken).expect(200);
    expect(afterAdj.body.status).toBe('draft'); // edit dropped reviewed
    expect(afterAdj.body.lines[0].gross).toBe(4425);

    await post(`/payroll/runs/${runId}/transition`, adminToken)
      .send({ status: 'reviewed' })
      .expect(200);
    await post(`/payroll/runs/${runId}/transition`, adminToken)
      .send({ status: 'approved' })
      .expect(200);

    // Immutable
    await post(`/payroll/runs/${runId}/adjustments`, adminToken)
      .send({ workerId, amount: 50, note: 'Nope' })
      .expect(400);

    const csv = await get(
      `/payroll/runs/${runId}/export?format=csv`,
      adminToken,
    ).expect(200);
    expect(csv.text).toContain('Ramon Torres');
    expect(csv.text).toContain('4425');

    const exported = await get(`/payroll/runs/${runId}`, adminToken).expect(200);
    expect(exported.body.status).toBe('exported');
    expect(exported.body.exportHash).toBeTruthy();
  });

  it('owner-only approve policy blocks admin', async () => {
    await post('/payroll/approve-role', ownerToken)
      .send({ approveRole: 'owner' })
      .expect(200);

    const run = await post('/payroll/runs', adminToken)
      .send({ start: '2026-06-29', end: '2026-07-05' })
      .expect(201);
    // empty-ish period still creates run
    await post(`/payroll/runs/${run.body.id}/transition`, adminToken)
      .send({ status: 'reviewed' })
      .expect(200);
    await post(`/payroll/runs/${run.body.id}/transition`, adminToken)
      .send({ status: 'approved' })
      .expect(403);

    await post(`/payroll/runs/${run.body.id}/transition`, ownerToken)
      .send({ status: 'approved' })
      .expect(200);
  });
});
