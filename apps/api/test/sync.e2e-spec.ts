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

const TRUNCATE = `TRUNCATE exceptions, lookalike_pairs, session_tags, session_photos,
  worker_day_admin_edits, attendance_sessions, site_workers, workers, site_engineers,
  sites, company_settings, audit_log, users, tenants CASCADE`;

class ScriptedProvider implements RecognitionProvider {
  script: { workerId: string | null; confidence: number }[][] = [];
  async indexFaces(input: { workerId: string }) {
    return { faceId: `face-${input.workerId}` };
  }
  async deleteFaces() {
    return { deleted: true };
  }
  async searchFaces() {
    return { faces: this.script.shift() ?? [] };
  }
}

describe('E5 backend: drift, admin conflict, recognition reconcile, hash', () => {
  let app: INestApplication;
  let owner: Pool;
  let tenantId: string;
  let engineerToken: string;
  let adminToken: string;
  let siteId: string;
  let ramon: string;
  let bong: string;
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
      `INSERT INTO tenants (name) VALUES ('Sync Co') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    await owner.query(`INSERT INTO company_settings (tenant_id) VALUES ($1)`, [
      tenantId,
    ]);
    const users = await owner.query(
      `INSERT INTO users (tenant_id, email, password_hash, role) VALUES
       ($1, 'eng@sync.ph', 'x', 'engineer'),
       ($1, 'admin@sync.ph', 'x', 'admin') RETURNING id`,
      [tenantId],
    );
    const site = await owner.query(
      `INSERT INTO sites (tenant_id, name, lat, lng, radius_m)
       VALUES ($1, 'Yard', 14.55, 121.05, 150) RETURNING id`,
      [tenantId],
    );
    siteId = site.rows[0].id;
    const workers = await owner.query(
      `INSERT INTO workers (tenant_id, full_name, biometric_status)
       VALUES ($1, 'Ramon Torres', 'enrolled'), ($1, 'Bong Reyes', 'enrolled')
       RETURNING id`,
      [tenantId],
    );
    ramon = workers.rows[0].id;
    bong = workers.rows[1].id;

    app = await createTestApp((builder) =>
      builder.overrideProvider(RECOGNITION_PROVIDER).useValue(provider),
    );
    const jwt = app.get(JwtService);
    engineerToken = jwt.sign({
      sub: users.rows[0].id,
      tenantId,
      email: 'eng@sync.ph',
      role: 'engineer',
    });
    adminToken = jwt.sign({
      sub: users.rows[1].id,
      tenantId,
      email: 'admin@sync.ph',
      role: 'admin',
    });
  });

  afterAll(async () => {
    await owner.query(TRUNCATE);
    await owner.end();
    await app.close();
  });

  it('E5-S06: clock drift > 10 min flags device sessions and opens exception', async () => {
    const uuid = randomUUID();
    // deviceSentAt 20 minutes in the past → drift ≈ 1200s
    const sent = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const res = await put(`/sessions/${uuid}`, engineerToken)
      .send({
        type: 'time_in',
        siteId,
        deviceId: 'pixel-drift',
        deviceCapturedAt: sent,
        deviceSentAt: sent,
      })
      .expect(200);
    expect(Math.abs(res.body.clockDriftSeconds)).toBeGreaterThan(600);

    const flagged = await owner.query(
      `SELECT clock_drift_flagged FROM attendance_sessions WHERE id = $1`,
      [uuid],
    );
    expect(flagged.rows[0].clock_drift_flagged).toBe(true);

    const ex = await get('/exceptions?type=clock_drift', adminToken).expect(200);
    expect(ex.body.length).toBeGreaterThan(0);
    expect(ex.body[0].note).toContain('pixel-drift');
  });

  it('E5-S04: sha256Verified mismatch sets tamper_flag', async () => {
    const uuid = randomUUID();
    await put(`/sessions/${uuid}`, engineerToken)
      .send({
        type: 'time_in',
        siteId,
        deviceId: 'pixel-hash',
        deviceCapturedAt: '2026-07-14T00:00:00.000Z',
        deviceSentAt: new Date().toISOString(),
      })
      .expect(200);
    provider.script = [[]];
    await post(`/sessions/${uuid}/photos`, engineerToken)
      .send({
        photos: [
          {
            storageKey: 'tamper.jpg',
            sha256: 'aaa',
            sha256Verified: 'bbb',
          },
        ],
      })
      .expect(201);
    const row = await owner.query(
      `SELECT tamper_flag FROM session_photos WHERE session_id = $1`,
      [uuid],
    );
    expect(row.rows[0].tamper_flag).toBe(true);
  });

  it('E5-S05: late engineer tag on admin-edited day is suppressed; audit keeps both', async () => {
    await post('/worker-days/admin-edit', adminToken)
      .send({
        workerId: ramon,
        siteId,
        day: '2026-07-14',
        reason: 'Corrected halfday after engineer left',
        before: { status: 'Present' },
        after: { status: 'Halfday' },
      })
      .expect(200);

    const uuid = randomUUID();
    // 2026-07-14 08:00 Manila = 00:00 UTC
    await put(`/sessions/${uuid}`, engineerToken)
      .send({
        type: 'time_in',
        siteId,
        deviceId: 'pixel-late',
        deviceCapturedAt: '2026-07-14T00:00:00.000Z',
        deviceSentAt: new Date().toISOString(),
      })
      .expect(200);

    provider.script = [[{ workerId: ramon, confidence: 0.99 }]];
    const res = await post(`/sessions/${uuid}/photos`, engineerToken)
      .send({ photos: [{ storageKey: 'late.jpg', sha256: 'x' }] })
      .expect(201);

    const tag = res.body.tags.find(
      (t: { workerId: string }) => t.workerId === ramon,
    );
    expect(tag.status).toBe('suppressed_admin');
    expect(tag.notice.reason).toBe('admin_edit_wins');

    const audit = await owner.query(
      `SELECT action, after, reason FROM audit_log
       WHERE action = 'sync.conflict_admin_wins'`,
    );
    expect(audit.rows.length).toBeGreaterThan(0);
    // Admin edit preserved separately
    const admin = await owner.query(
      `SELECT after FROM worker_day_admin_edits WHERE worker_id = $1`,
      [ramon],
    );
    expect(admin.rows[0].after).toEqual({ status: 'Halfday' });
  });

  it('E5-S08: recognition agrees with manual → confirm; disagree → exception, no overwrite', async () => {
    // Agreement path
    const agree = randomUUID();
    await put(`/sessions/${agree}`, engineerToken)
      .send({
        type: 'time_in',
        siteId,
        deviceId: 'pixel-rec',
        deviceCapturedAt: '2026-07-15T00:00:00.000Z',
        deviceSentAt: new Date().toISOString(),
      })
      .expect(200);
    await post(`/sessions/${agree}/tags`, engineerToken)
      .send({ type: 'manual', workerId: bong })
      .expect(200);
    provider.script = [[{ workerId: bong, confidence: 0.96 }]];
    const agreed = await post(`/sessions/${agree}/photos`, engineerToken)
      .send({ photos: [{ storageKey: 'agree.jpg' }] })
      .expect(201);
    const bongTag = agreed.body.tags.find(
      (t: { workerId: string; source: string }) =>
        t.workerId === bong && t.source === 'manual',
    );
    expect(bongTag.status).toBe('active');
    expect(bongTag.notice.recognitionAgreed).toBe(true);
    // No auto overwrite row for the same worker as active auto
    const autoBong = agreed.body.tags.filter(
      (t: { workerId: string; source: string }) =>
        t.workerId === bong && t.source === 'auto',
    );
    expect(autoBong).toHaveLength(0);

    // Disagreement path — different calendar day so duplicate-in does not
    // mark the manual tag ignored_duplicate.
    const disagree = randomUUID();
    await put(`/sessions/${disagree}`, engineerToken)
      .send({
        type: 'time_in',
        siteId,
        deviceId: 'pixel-rec',
        deviceCapturedAt: '2026-07-16T00:00:00.000Z',
        deviceSentAt: new Date().toISOString(),
      })
      .expect(200);
    await post(`/sessions/${disagree}/tags`, engineerToken)
      .send({ type: 'manual', workerId: bong })
      .expect(200);
    provider.script = [[{ workerId: ramon, confidence: 0.97 }]];
    const disagreed = await post(`/sessions/${disagree}/photos`, engineerToken)
      .send({ photos: [{ storageKey: 'disagree.jpg' }] })
      .expect(201);
    const stillBong = disagreed.body.tags.find(
      (t: { workerId: string; source: string }) =>
        t.workerId === bong && t.source === 'manual',
    );
    expect(stillBong.status).toBe('active');
    expect(stillBong.notice?.recognitionAgreed).toBeUndefined();
    const autoRamon = disagreed.body.tags.find(
      (t: { workerId: string; source: string }) =>
        t.workerId === ramon && t.source === 'auto',
    );
    expect(autoRamon).toBeDefined();

    const queue = await get(
      '/exceptions?type=recognition_disagreement',
      adminToken,
    ).expect(200);
    expect(queue.body.length).toBeGreaterThan(0);
  });
});
