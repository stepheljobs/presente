import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import {
  RECOGNITION_PROVIDER,
  RecognitionProvider,
} from '../src/recognition/provider';
import { createTestApp, ownerPool } from './helpers';

const TRUNCATE = `TRUNCATE tenants CASCADE`;

class Stub implements RecognitionProvider {
  async indexFaces(input: { workerId: string }) {
    return { faceId: input.workerId };
  }
  async deleteFaces() {
    return { deleted: true };
  }
  async searchFaces() {
    return {
      faces: [{ workerId: null as string | null, confidence: 0.2 }],
    };
  }
}

describe('E8 dashboard, exceptions resolve, admin tag, reports', () => {
  let app: INestApplication;
  let owner: Pool;
  let tenantId: string;
  let adminToken: string;
  let engineerId: string;
  let siteId: string;
  let workerId: string;
  let sessionId: string;

  const post = (path: string, token: string) =>
    request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token}`);
  const get = (path: string, token: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`);
  const put = (path: string, token: string) =>
    request(app.getHttpServer()).put(path).set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    owner = ownerPool();
    await owner.query(TRUNCATE);
    const t = await owner.query(
      `INSERT INTO tenants (name) VALUES ('Dash Co') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    await owner.query(`INSERT INTO company_settings (tenant_id) VALUES ($1)`, [
      tenantId,
    ]);
    const users = await owner.query(
      `INSERT INTO users (tenant_id, email, password_hash, role) VALUES
       ($1, 'admin@dash.ph', 'x', 'admin'),
       ($1, 'eng@dash.ph', 'x', 'engineer') RETURNING id`,
      [tenantId],
    );
    engineerId = users.rows[1].id;
    const site = await owner.query(
      `INSERT INTO sites (tenant_id, name, lat, lng, radius_m)
       VALUES ($1, 'Yard', 14.55, 121.05, 150) RETURNING id`,
      [tenantId],
    );
    siteId = site.rows[0].id;
    await owner.query(
      `INSERT INTO site_engineers (tenant_id, site_id, user_id) VALUES ($1,$2,$3)`,
      [tenantId, siteId, engineerId],
    );
    const w = await owner.query(
      `INSERT INTO workers (tenant_id, full_name, biometric_status)
       VALUES ($1, 'Ramon T', 'enrolled') RETURNING id`,
      [tenantId],
    );
    workerId = w.rows[0].id;
    await owner.query(
      `INSERT INTO site_workers (tenant_id, site_id, worker_id) VALUES ($1,$2,$3)`,
      [tenantId, siteId, workerId],
    );

    app = await createTestApp((b) =>
      b.overrideProvider(RECOGNITION_PROVIDER).useValue(new Stub()),
    );
    const jwt = app.get(JwtService);
    adminToken = jwt.sign({
      sub: users.rows[0].id,
      tenantId,
      email: 'admin@dash.ph',
      role: 'admin',
    });
    const engToken = jwt.sign({
      sub: engineerId,
      tenantId,
      email: 'eng@dash.ph',
      role: 'engineer',
    });

    sessionId = randomUUID();
    await put(`/sessions/${sessionId}`, engToken)
      .send({
        type: 'time_in',
        siteId,
        deviceId: 'pixel-dash',
        deviceCapturedAt: new Date().toISOString(),
        deviceSentAt: new Date().toISOString(),
        lat: 14.55,
        lng: 121.05,
        gpsStatus: 'fix',
      })
      .expect(200);
    await post(`/sessions/${sessionId}/photos`, engToken)
      .send({ photos: [{ storageKey: 'dash.jpg', sha256: 'aa' }] })
      .expect(201);
  });

  afterAll(async () => {
    await owner.query(TRUNCATE);
    await owner.end();
    await app.close();
  });

  it('E8-S01/S02/S03: today headcount, photo feed, devices', async () => {
    const today = await get('/dashboard/today', adminToken).expect(200);
    expect(Array.isArray(today.body)).toBe(true);
    const yard = today.body.find(
      (s: { siteName: string }) => s.siteName === 'Yard',
    );
    expect(yard.roster).toBe(1);

    const photos = await get('/dashboard/photos', adminToken).expect(200);
    expect(photos.body.length).toBeGreaterThan(0);
    expect(photos.body[0].sessionId).toBe(sessionId);

    const devices = await get('/dashboard/devices', adminToken).expect(200);
    expect(
      devices.body.some(
        (d: { deviceId: string }) => d.deviceId === 'pixel-dash',
      ),
    ).toBe(true);
  });

  it('E8-S11: admin tag with reason', async () => {
    const tagged = await post(
      `/dashboard/sessions/${sessionId}/admin-tag`,
      adminToken,
    ).send({
      action: 'tag',
      workerId,
      reason: 'Recognized on photo review',
    });
    expect(tagged.status).toBe(200);
    expect(Array.isArray(tagged.body.tags)).toBe(true);
    const manual = tagged.body.tags.find(
      (t: { source: string }) => t.source === 'manual',
    );
    expect(manual).toBeTruthy();
    expect(manual.workerId).toBe(workerId);
  });

  it('E8-S05/S06: exception list filters + typed resolve', async () => {
    await owner.query(
      `INSERT INTO exceptions (tenant_id, type, severity, worker_id, site_id, day, session_id, note)
       VALUES ($1, 'missing_time_out', 2, $2, $3, current_date, $4, 'left early?')`,
      [tenantId, workerId, siteId, sessionId],
    );
    await owner.query(
      `INSERT INTO day_records (tenant_id, worker_id, site_id, day, status, source, hours)
       VALUES ($1, $2, $3, current_date, 'present', 'photo', 4)
       ON CONFLICT DO NOTHING`,
      [tenantId, workerId, siteId],
    );

    const list = await get(
      '/exceptions?status=open&type=missing_time_out',
      adminToken,
    ).expect(200);
    expect(list.body.length).toBeGreaterThan(0);
    const ex = list.body.find(
      (e: { type: string }) => e.type === 'missing_time_out',
    );

    await post(`/exceptions/${ex.id}/resolve-typed`, adminToken)
      .send({ resolution: 'set_halfday', note: 'Confirmed halfday' })
      .expect(200);

    const day = await owner.query(
      `SELECT status, source FROM day_records
       WHERE worker_id = $1 AND day = current_date`,
      [workerId],
    );
    expect(day.rows[0].status).toBe('halfday');
    expect(day.rows[0].source).toBe('corrected');
  });

  it('E8-S12/S15/S16: reports, padding, evidence pack', async () => {
    const from = '2020-01-01';
    const to = '2030-01-01';
    await get(
      `/dashboard/reports/attendance?from=${from}&to=${to}`,
      adminToken,
    ).expect(200);
    await get(`/dashboard/reports/ot?from=${from}&to=${to}`, adminToken).expect(
      200,
    );
    await get(
      `/dashboard/reports/exceptions?from=${from}&to=${to}`,
      adminToken,
    ).expect(200);
    const pad = await get('/dashboard/padding', adminToken).expect(200);
    expect(pad.body.mostManuallyTagged).toBeDefined();

    const pack = await post('/dashboard/evidence-pack', adminToken)
      .send({ workerId })
      .expect(200);
    expect(pack.headers['content-type']).toContain('pdf');
    expect(pack.headers['x-export-hash']).toBeTruthy();
  });
});
