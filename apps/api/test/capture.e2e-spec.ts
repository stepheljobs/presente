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
  attendance_sessions, site_workers, workers, site_engineers, sites,
  company_settings, audit_log, users, tenants CASCADE`;

/** Provider whose next searchFaces results are scripted per test. */
class ScriptedProvider implements RecognitionProvider {
  script: { workerId: string | null; confidence: number }[][] = [];
  failNext = false;

  async indexFaces(input: { workerId: string }) {
    return { faceId: `face-${input.workerId}` };
  }
  async deleteFaces() {
    return { deleted: true };
  }
  async searchFaces() {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('provider down');
    }
    return { faces: this.script.shift() ?? [] };
  }
}

describe('E4 backend: recognition, banding, dedup, reconciliation, sweep', () => {
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

  const ingest = (
    uuid: string,
    type: 'time_in' | 'time_out',
    capturedAt: string,
    extra: Record<string, unknown> = {},
  ) =>
    put(`/sessions/${uuid}`, engineerToken)
      .send({
        type,
        siteId,
        deviceId: 'pixel-01',
        deviceCapturedAt: capturedAt,
        deviceSentAt: new Date().toISOString(),
        ...extra,
      })
      .expect(200);

  beforeAll(async () => {
    owner = ownerPool();
    await owner.query(TRUNCATE);
    const t = await owner.query(
      `INSERT INTO tenants (name) VALUES ('Alpha Builders') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    await owner.query(
      `INSERT INTO company_settings (tenant_id) VALUES ($1)`,
      [tenantId],
    );
    const users = await owner.query(
      `INSERT INTO users (tenant_id, email, password_hash, role) VALUES
       ($1, 'eng@alpha.ph', 'x', 'engineer'),
       ($1, 'admin@alpha.ph', 'x', 'admin') RETURNING id`,
      [tenantId],
    );
    const site = await owner.query(
      `INSERT INTO sites (tenant_id, name, lat, lng, radius_m)
       VALUES ($1, 'Tower A', 14.5513, 121.0498, 150) RETURNING id`,
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
    await owner.query(
      `INSERT INTO site_workers (tenant_id, site_id, worker_id)
       VALUES ($1, $2, $3), ($1, $2, $4)`,
      [tenantId, siteId, ramon, bong],
    );

    app = await createTestApp((builder) =>
      builder.overrideProvider(RECOGNITION_PROVIDER).useValue(provider),
    );
    const jwt = app.get(JwtService);
    engineerToken = jwt.sign({
      sub: users.rows[0].id,
      tenantId,
      email: 'eng@alpha.ph',
      role: 'engineer',
    });
    adminToken = jwt.sign({
      sub: users.rows[1].id,
      tenantId,
      email: 'admin@alpha.ph',
      role: 'admin',
    });
  });

  afterAll(async () => {
    await owner.query(TRUNCATE);
    await owner.end();
    await app.close();
  });

  it('ingest recomputes geofence server-side and stores GPS + mock flags', async () => {
    const uuid = randomUUID();
    // ~900 m north of Tower A — outside the 150 m fence.
    const res = await ingest(uuid, 'time_in', '2026-07-12T07:00:00.000Z', {
      lat: 14.5594,
      lng: 121.0498,
      gpsStatus: 'fix',
      mockLocation: true,
    });
    expect(res.body.clockDriftSeconds).toBeDefined();
    const row = await owner.query(
      `SELECT within_fence, distance_m, mock_location FROM attendance_sessions WHERE id = $1`,
      [uuid],
    );
    expect(row.rows[0].within_fence).toBe(false);
    expect(row.rows[0].distance_m).toBeGreaterThan(800);
    expect(row.rows[0].mock_location).toBe(true);
  });

  it('recognition pass bands faces per tenant thresholds (S09+S10)', async () => {
    const uuid = randomUUID();
    await ingest(uuid, 'time_in', '2026-07-12T07:05:00.000Z');
    provider.script = [
      [
        { workerId: ramon, confidence: 0.95 }, // high → auto chip
        { workerId: bong, confidence: 0.75 }, // confirm card
        { workerId: null, confidence: 0.3 }, // unrecognized → red box
      ],
    ];
    const res = await post(`/sessions/${uuid}/photos`, engineerToken)
      .send({ photos: [{ storageKey: 'k1.jpg', sha256: 'aa' }] })
      .expect(201);

    const byBand = Object.fromEntries(
      res.body.tags.map((t: { band: string; status: string }) => [
        t.band,
        t.status,
      ]),
    );
    expect(byBand.high).toBe('active');
    expect(byBand.confirm).toBe('pending_confirm');
    expect(byBand.unrecognized).toBe('pending_confirm');
    expect(res.body.photos[0].recognitionStatus).toBe('done');
  });

  it('provider failure leaves photo pending; retry recovers (S09)', async () => {
    const uuid = randomUUID();
    await ingest(uuid, 'time_in', '2026-07-12T07:06:00.000Z');
    provider.failNext = true;
    const res = await post(`/sessions/${uuid}/photos`, engineerToken)
      .send({ photos: [{ storageKey: 'k2.jpg' }] })
      .expect(201);
    expect(res.body.photos[0].recognitionStatus).toBe('failed');

    provider.script = [[{ workerId: ramon, confidence: 0.6 }]];
    const retry = await post(
      `/sessions/${uuid}/photos/retry-recognition`,
      engineerToken,
    ).expect(200);
    expect(retry.body.photos[0].recognitionStatus).toBe('done');
  });

  it('lookalike pair forces high-confidence match down to confirm (S21)', async () => {
    await post('/lookalikes', adminToken)
      .send({ workerAId: ramon, workerBId: bong })
      .expect(201);

    const uuid = randomUUID();
    await ingest(uuid, 'time_in', '2026-07-12T07:10:00.000Z');
    provider.script = [[{ workerId: bong, confidence: 0.99 }]];
    const res = await post(`/sessions/${uuid}/photos`, engineerToken)
      .send({ photos: [{ storageKey: 'k3.jpg' }] })
      .expect(201);
    const tag = res.body.tags[0];
    expect(tag.band).toBe('confirm');
    expect(tag.status).toBe('pending_confirm');
    expect(tag.notice.forcedConfirm).toBe('lookalike_pair');
  });

  it('confirm-band card actions: accept and pick-other-as-manual (S12/S13)', async () => {
    const uuid = randomUUID();
    await ingest(uuid, 'time_in', '2026-07-12T07:15:00.000Z');
    provider.script = [[{ workerId: bong, confidence: 0.8 }]];
    const res = await post(`/sessions/${uuid}/photos`, engineerToken)
      .send({ photos: [{ storageKey: 'k4.jpg' }] })
      .expect(201);
    const tagId = res.body.tags[0].id;

    // Reject + pick other → original rejected, manual tag flagged + queued.
    const after = await post(`/sessions/${uuid}/tags`, engineerToken)
      .send({ type: 'confirm', tagId, accept: false, workerId: ramon })
      .expect(200);
    const statuses = after.body.tags.map(
      (t: { source: string; status: string }) => `${t.source}:${t.status}`,
    );
    expect(statuses).toContain('auto:rejected');
    expect(
      after.body.tags.find((t: { source: string }) => t.source === 'manual')
        .notice.flag,
    ).toBe('manual_tag');

    const queue = await get('/exceptions?type=manual_tag', adminToken).expect(200);
    expect(queue.body.length).toBeGreaterThan(0);
  });

  it('visitor faces carry no worker link (S14)', async () => {
    const uuid = randomUUID();
    await ingest(uuid, 'time_in', '2026-07-12T07:20:00.000Z');
    const res = await post(`/sessions/${uuid}/tags`, engineerToken)
      .send({ type: 'visitor' })
      .expect(200);
    const visitor = res.body.tags.find(
      (t: { source: string }) => t.source === 'visitor',
    );
    expect(visitor.workerId).toBeNull();
    expect(visitor.status).toBe('active');
  });

  it('duplicate time-in keeps the earliest and marks later ones (S17/S20)', async () => {
    // Times are UTC; company timezone is Asia/Manila (UTC+8). Keep both
    // captures on the same Manila calendar day so the day-scope matches.
    const early = randomUUID();
    const late = randomUUID();
    await ingest(early, 'time_in', '2026-07-13T00:45:00.000Z'); // 08:45 Manila
    await ingest(late, 'time_in', '2026-07-13T01:30:00.000Z'); // 09:30 Manila

    provider.script = [[{ workerId: ramon, confidence: 0.95 }]];
    await post(`/sessions/${early}/photos`, engineerToken)
      .send({ photos: [{ storageKey: 'd1.jpg' }] })
      .expect(201);
    provider.script = [[{ workerId: ramon, confidence: 0.95 }]];
    const lateRes = await post(`/sessions/${late}/photos`, engineerToken)
      .send({ photos: [{ storageKey: 'd2.jpg' }] })
      .expect(201);

    // Lookalike pair from the earlier test forces confirm; accept both first.
    for (const sessionId of [early, late]) {
      const session = await get(`/sessions/${sessionId}`, engineerToken);
      for (const tag of session.body.tags) {
        if (tag.status === 'pending_confirm' && tag.workerId) {
          await post(`/sessions/${sessionId}/tags`, engineerToken)
            .send({ type: 'confirm', tagId: tag.id, accept: true })
            .expect(200);
        }
      }
    }

    const earlyTags = await get(`/sessions/${early}`, engineerToken);
    const lateTags = await get(`/sessions/${late}`, engineerToken);
    expect(
      earlyTags.body.tags.find((t: { workerId: string }) => t.workerId === ramon)
        .status,
    ).toBe('active');
    const dup = lateTags.body.tags.find(
      (t: { workerId: string }) => t.workerId === ramon,
    );
    expect(dup.status).toBe('ignored_duplicate');
    expect(dup.notice.reason).toBe('duplicate_time_in');
    expect(dup.notice.earliestSessionId).toBe(early);
    void lateRes;
  });

  it('reconciliation lists timed-in workers missing from time-out; left-early suppresses sweep (S18/S19)', async () => {
    // Ramon is timed in on 2026-07-13 Manila (previous test). Bong times in too.
    const bongIn = randomUUID();
    await ingest(bongIn, 'time_in', '2026-07-13T01:00:00.000Z'); // 09:00 Manila
    provider.script = [[{ workerId: bong, confidence: 0.95 }]];
    await post(`/sessions/${bongIn}/photos`, engineerToken)
      .send({ photos: [{ storageKey: 'r1.jpg' }] })
      .expect(201);
    const bi = await get(`/sessions/${bongIn}`, engineerToken);
    for (const tag of bi.body.tags) {
      if (tag.status === 'pending_confirm' && tag.workerId) {
        await post(`/sessions/${bongIn}/tags`, engineerToken)
          .send({ type: 'confirm', tagId: tag.id, accept: true })
          .expect(200);
      }
    }

    // Time-out session tags only Bong; Ramon is missing.
    // 09:00 UTC = 17:00 Manila — still 2026-07-13 in tenant timezone.
    const timeOut = randomUUID();
    await ingest(timeOut, 'time_out', '2026-07-13T09:00:00.000Z');
    provider.script = [[{ workerId: bong, confidence: 0.95 }]];
    await post(`/sessions/${timeOut}/photos`, engineerToken)
      .send({ photos: [{ storageKey: 'r2.jpg' }] })
      .expect(201);
    const to = await get(`/sessions/${timeOut}`, engineerToken);
    for (const tag of to.body.tags) {
      if (tag.status === 'pending_confirm' && tag.workerId) {
        await post(`/sessions/${timeOut}/tags`, engineerToken)
          .send({ type: 'confirm', tagId: tag.id, accept: true })
          .expect(200);
      }
    }

    const strip = await get(
      `/sessions/${timeOut}/reconciliation`,
      engineerToken,
    ).expect(200);
    expect(strip.body.map((w: { workerId: string }) => w.workerId)).toEqual([
      ramon,
    ]);

    // Engineer notes Ramon left early → pre-resolved exception.
    await post(`/sessions/${timeOut}/reconciliation`, engineerToken)
      .send({ workerId: ramon, action: 'left_early', note: 'Went home sick at 2pm' })
      .expect(200);

    // Sweep for that day creates nothing new for Ramon (note occupies the
    // slot) and nothing for Bong (he has a time-out).
    const before = await owner.query(
      `SELECT count(*)::int AS n FROM exceptions WHERE day = '2026-07-13'`,
    );
    // Trigger on-sync sweep again via an empty-ish time_out photo submit.
    const resweep = randomUUID();
    await ingest(resweep, 'time_out', '2026-07-13T09:30:00.000Z');
    await post(`/sessions/${resweep}/photos`, engineerToken)
      .send({ photos: [{ storageKey: 'r3.jpg' }] })
      .expect(201);
    const after = await owner.query(
      `SELECT type, status, note, worker_id FROM exceptions
       WHERE day = '2026-07-13' ORDER BY type`,
    );
    expect(after.rows).toHaveLength(before.rows[0].n);
    const ramonEx = after.rows.find(
      (r: { type: string; worker_id: string }) =>
        r.type === 'missing_time_out' && r.worker_id === ramon,
    );
    expect(ramonEx).toBeDefined();
    expect(ramonEx.status).toBe('resolved');
    expect(ramonEx.note).toContain('sick');
  });

  it('admin resolves an open exception with an audited note (E8-S04)', async () => {
    // Manual-tag exception from the confirm test is still open.
    const queue = await get('/exceptions?type=manual_tag', adminToken).expect(200);
    const target = queue.body[0];
    await post(`/exceptions/${target.id}/resolve`, adminToken)
      .send({ status: 'resolved', note: 'Verified against photos' })
      .expect(200);
    const audit = await owner.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE action = 'exception.resolved'`,
    );
    expect(audit.rows[0].n).toBe(1);
  });
});
