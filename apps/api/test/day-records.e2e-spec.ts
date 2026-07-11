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

const TRUNCATE = `TRUNCATE correction_requests, day_records, exceptions, lookalike_pairs,
  session_tags, session_photos, worker_day_admin_edits, attendance_sessions,
  site_workers, workers, site_engineers, sites, company_settings, audit_log,
  users, tenants CASCADE`;

class ScriptedProvider implements RecognitionProvider {
  script: { workerId: string | null; confidence: number }[][] = [];
  async indexFaces(input: { workerId: string }) {
    return { faceId: `f-${input.workerId}` };
  }
  async deleteFaces() {
    return { deleted: true };
  }
  async searchFaces() {
    return { faces: this.script.shift() ?? [] };
  }
}

describe('E6 day records, transfer, corrections, no-biometric', () => {
  let app: INestApplication;
  let owner: Pool;
  let tenantId: string;
  let engineerToken: string;
  let adminToken: string;
  let engineerId: string;
  let siteA: string;
  let siteB: string;
  let ramon: string;
  let manualWorker: string;
  const provider = new ScriptedProvider();

  const put = (path: string, token: string) =>
    request(app.getHttpServer()).put(path).set('Authorization', `Bearer ${token}`);
  const post = (path: string, token: string) =>
    request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token}`);
  const get = (path: string, token: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    owner = ownerPool();
    await owner.query(TRUNCATE);
    const t = await owner.query(
      `INSERT INTO tenants (name) VALUES ('Day Co') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    await owner.query(`INSERT INTO company_settings (tenant_id) VALUES ($1)`, [
      tenantId,
    ]);
    const users = await owner.query(
      `INSERT INTO users (tenant_id, email, password_hash, role) VALUES
       ($1, 'eng@day.ph', 'x', 'engineer'),
       ($1, 'admin@day.ph', 'x', 'admin') RETURNING id`,
      [tenantId],
    );
    engineerId = users.rows[0].id;
    const sites = await owner.query(
      `INSERT INTO sites (tenant_id, name, lat, lng, radius_m) VALUES
       ($1, 'Site A', 14.55, 121.05, 150),
       ($1, 'Site B', 14.56, 121.06, 150)
       RETURNING id`,
      [tenantId],
    );
    siteA = sites.rows[0].id;
    siteB = sites.rows[1].id;
    await owner.query(
      `INSERT INTO site_engineers (tenant_id, site_id, user_id)
       VALUES ($1, $2, $3), ($1, $4, $3)`,
      [tenantId, siteA, engineerId, siteB],
    );
    const workers = await owner.query(
      `INSERT INTO workers (tenant_id, full_name, biometric_status, no_biometric_consent)
       VALUES ($1, 'Ramon Torres', 'enrolled', false),
              ($1, 'Manual Juan', 'none', true)
       RETURNING id`,
      [tenantId],
    );
    ramon = workers.rows[0].id;
    manualWorker = workers.rows[1].id;

    app = await createTestApp((b) =>
      b.overrideProvider(RECOGNITION_PROVIDER).useValue(provider),
    );
    const jwt = app.get(JwtService);
    engineerToken = jwt.sign({
      sub: engineerId,
      tenantId,
      email: 'eng@day.ph',
      role: 'engineer',
    });
    adminToken = jwt.sign({
      sub: users.rows[1].id,
      tenantId,
      email: 'admin@day.ph',
      role: 'admin',
    });
  });

  afterAll(async () => {
    await owner.query(TRUNCATE);
    await owner.end();
    await app.close();
  });

  async function sessionWithTag(
    siteId: string,
    type: 'time_in' | 'time_out',
    at: string,
    workerId: string,
  ) {
    const uuid = randomUUID();
    await put(`/sessions/${uuid}`, engineerToken)
      .send({
        type,
        siteId,
        deviceId: 'pixel-day',
        deviceCapturedAt: at,
        deviceSentAt: new Date().toISOString(),
      })
      .expect(200);
    provider.script = [[{ workerId, confidence: 0.96 }]];
    await post(`/sessions/${uuid}/photos`, engineerToken)
      .send({ photos: [{ storageKey: `${uuid}.jpg` }] })
      .expect(201);
    return uuid;
  }

  it('E6-S01: recompute builds day record with earliest-in / latest-out hours', async () => {
    // 08:00–17:00 Manila = 00:00–09:00 UTC on 2026-07-20
    await sessionWithTag(siteA, 'time_in', '2026-07-20T00:00:00.000Z', ramon);
    await sessionWithTag(siteA, 'time_out', '2026-07-20T09:00:00.000Z', ramon);

    const list = await get('/day-records?day=2026-07-20', adminToken).expect(200);
    expect(list.body.length).toBeGreaterThanOrEqual(1);
    const rec = list.body.find((r: { workerId: string }) => r.workerId === ramon);
    expect(rec).toBeDefined();
    expect(rec.hours).toBe(9);
    expect(rec.status).toBe('ot_candidate'); // > 8h standard
    expect(rec.source).toBe('photo');
  });

  it('E6-S02: mid-day site transfer creates two segments + exception', async () => {
    await sessionWithTag(siteA, 'time_in', '2026-07-21T00:00:00.000Z', ramon);
    await sessionWithTag(siteA, 'time_out', '2026-07-21T04:00:00.000Z', ramon);
    await sessionWithTag(siteB, 'time_in', '2026-07-21T05:00:00.000Z', ramon);
    await sessionWithTag(siteB, 'time_out', '2026-07-21T09:00:00.000Z', ramon);

    const list = await get('/day-records?day=2026-07-21', adminToken).expect(200);
    const segs = list.body.filter(
      (r: { workerId: string }) => r.workerId === ramon,
    );
    expect(segs).toHaveLength(2);
    const ex = await get('/exceptions?type=site_transfer', adminToken).expect(200);
    expect(ex.body.some((e: { workerId: string }) => e.workerId === ramon)).toBe(
      true,
    );
  });

  it('E6-S04: admin edit requires reason and locks day', async () => {
    const list = await get('/day-records?day=2026-07-20', adminToken).expect(200);
    const rec = list.body.find((r: { workerId: string }) => r.workerId === ramon);
    await put(`/day-records/${rec.id}`, adminToken)
      .send({ status: 'halfday' })
      .expect(400);
    const edited = await put(`/day-records/${rec.id}`, adminToken)
      .send({ status: 'halfday', reason: 'Left early for medical' })
      .expect(200);
    expect(edited.body.status).toBe('halfday');
    expect(edited.body.source).toBe('corrected');

    const drill = await get(`/day-records/${rec.id}`, adminToken).expect(200);
    expect(drill.body.audit.length).toBeGreaterThan(0);
  });

  it('E6-S05/S06: correction request approve path', async () => {
    const list = await get('/day-records?day=2026-07-21', adminToken).expect(200);
    const rec = list.body.find(
      (r: { workerId: string; siteId: string }) =>
        r.workerId === ramon && r.siteId === siteA,
    );
    const created = await post('/corrections', engineerToken)
      .send({
        dayRecordId: rec.id,
        workerId: ramon,
        siteId: siteA,
        day: '2026-07-21',
        proposed: { status: 'present' },
        reason: 'Was present full morning',
      })
      .expect(201);
    expect(created.body.status).toBe('submitted');

    const reviewed = await post(
      `/corrections/${created.body.id}/review`,
      adminToken,
    )
      .send({ decision: 'approved', note: 'Photos confirm' })
      .expect(200);
    expect(reviewed.body.status).toBe('approved');

    const after = await get(`/day-records/${rec.id}`, adminToken).expect(200);
    expect(after.body.source).toBe('corrected');
  });

  it('E6-S08: no-biometric manual present + exception', async () => {
    const res = await post('/day-records/manual-present', engineerToken)
      .send({
        workerId: manualWorker,
        siteId: siteA,
        day: '2026-07-22',
        timeIn: '2026-07-22T00:00:00.000Z',
      })
      .expect(200);
    expect(res.body.source).toBe('no_biometric');
    expect(res.body.noBiometricConsent).toBe(true);
    expect(res.body.status).toBe('present');

    const ex = await get(
      '/exceptions?type=no_biometric_consent',
      adminToken,
    ).expect(200);
    expect(
      ex.body.some((e: { workerId: string }) => e.workerId === manualWorker),
    ).toBe(true);
  });
});
