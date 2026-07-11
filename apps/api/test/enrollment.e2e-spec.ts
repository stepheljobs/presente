import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Pool } from 'pg';
import request from 'supertest';
import {
  RECOGNITION_PROVIDER,
  RecognitionProvider,
} from '../src/recognition/provider';
import { createTestApp, ownerPool } from './helpers';

const TRUNCATE =
  'TRUNCATE enrollment_photos, consents, site_workers, workers, audit_log, users, tenants CASCADE';

/** Provider that can be told to fail N times before succeeding. */
class FlakyProvider implements RecognitionProvider {
  failuresRemaining = 0;
  deleteCalls: string[] = [];

  async indexFaces(input: { workerId: string }) {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining--;
      throw new Error('provider unavailable');
    }
    return { faceId: `face-${input.workerId}` };
  }

  async deleteFaces(input: { faceId: string }) {
    this.deleteCalls.push(input.faceId);
    return { deleted: true };
  }

  async searchFaces(): Promise<{
    faces: { workerId: string | null; confidence: number }[];
  }> {
    return { faces: [] };
  }
}

describe('E3-S06/S09/S12 consent gate, templates, biometric deletion', () => {
  let app: INestApplication;
  let owner: Pool;
  let engineerToken: string;
  let adminToken: string;
  let workerId: string;
  const provider = new FlakyProvider();

  const photos = [
    { pose: 'front', storageKey: 'tenants/t/enroll/f.jpg', sha256: 'aa' },
    { pose: 'left', storageKey: 'tenants/t/enroll/l.jpg' },
    { pose: 'right', storageKey: 'tenants/t/enroll/r.jpg' },
    { pose: 'hard_hat', storageKey: 'tenants/t/enroll/h.jpg' },
  ];

  beforeAll(async () => {
    owner = ownerPool();
    await owner.query(TRUNCATE);
    const t = await owner.query(
      `INSERT INTO tenants (name) VALUES ('Alpha Builders') RETURNING id`,
    );
    const tenantId = t.rows[0].id;
    const users = await owner.query(
      `INSERT INTO users (tenant_id, email, password_hash, role) VALUES
       ($1, 'eng@alpha.ph', 'x', 'engineer'),
       ($1, 'admin@alpha.ph', 'x', 'admin') RETURNING id`,
      [tenantId],
    );
    const w = await owner.query(
      `INSERT INTO workers (tenant_id, full_name) VALUES ($1, 'Ramon Torres')
       RETURNING id`,
      [tenantId],
    );
    workerId = w.rows[0].id;
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

  it('face enrollment returns 403 before any consent record (E3-S06)', async () => {
    await request(app.getHttpServer())
      .post(`/workers/${workerId}/enrollment`)
      .set('Authorization', `Bearer ${engineerToken}`)
      .send({ photos })
      .expect(403);

    const stored = await owner.query(
      'SELECT count(*)::int AS n FROM enrollment_photos',
    );
    expect(stored.rows[0].n).toBe(0);
  });

  it('consent record unlocks enrollment; stub template generated (E3-S09)', async () => {
    await request(app.getHttpServer())
      .post(`/workers/${workerId}/consents`)
      .set('Authorization', `Bearer ${engineerToken}`)
      .send({
        type: 'signature',
        artifactKey: 'tenants/t/consent/sig.png',
        strokeData: { strokes: [[1, 2]] },
        language: 'tl',
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/workers/${workerId}/enrollment`)
      .set('Authorization', `Bearer ${engineerToken}`)
      .send({ photos })
      .expect(201);
    expect(res.body.biometricStatus).toBe('enrolled');

    // Face id stored encrypted, not plaintext.
    const raw = await owner.query(
      `SELECT face_id_enc::text AS enc, biometric_status FROM workers WHERE id = $1`,
      [workerId],
    );
    expect(raw.rows[0].biometric_status).toBe('enrolled');
    expect(raw.rows[0].enc).not.toContain(`face-${workerId}`);
  });

  it('provider outage leaves worker pending for retry, then recovers (E3-S09)', async () => {
    const w2 = await owner.query(
      `INSERT INTO workers (tenant_id, full_name)
       SELECT tenant_id, 'Flaky Enrollee' FROM workers WHERE id = $1
       RETURNING id`,
      [workerId],
    );
    const flakyId = w2.rows[0].id;
    await request(app.getHttpServer())
      .post(`/workers/${flakyId}/consents`)
      .set('Authorization', `Bearer ${engineerToken}`)
      .send({ type: 'paper', artifactKey: 'k.jpg', language: 'en' })
      .expect(201);

    provider.failuresRemaining = 99; // exhaust all retries
    const res = await request(app.getHttpServer())
      .post(`/workers/${flakyId}/enrollment`)
      .set('Authorization', `Bearer ${engineerToken}`)
      .send({ photos: [photos[0]] })
      .expect(201);
    expect(res.body.biometricStatus).toBe('pending');

    // One transient failure, then success on the in-call retry.
    provider.failuresRemaining = 1;
    const retry = await request(app.getHttpServer())
      .post(`/workers/${flakyId}/enrollment`)
      .set('Authorization', `Bearer ${engineerToken}`)
      .send({ photos: [photos[1]] })
      .expect(201);
    expect(retry.body.biometricStatus).toBe('enrolled');
  }, 30_000);

  it('biometric deletion verifies provider delete, purges photos, keeps consent + audit certificate (E3-S12)', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/workers/${workerId}/biometrics`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.deleted).toBe(true);
    expect(res.body.photosPurged).toBe(4);
    expect(provider.deleteCalls).toContain(`face-${workerId}`);

    const worker = await owner.query(
      `SELECT biometric_status, face_id_enc FROM workers WHERE id = $1`,
      [workerId],
    );
    expect(worker.rows[0]).toEqual({
      biometric_status: 'none',
      face_id_enc: null,
    });

    // Consent records survive deletion (NFR-5).
    const consents = await owner.query(
      'SELECT count(*)::int AS n FROM consents WHERE worker_id = $1',
      [workerId],
    );
    expect(consents.rows[0].n).toBe(1);

    const certificate = await owner.query(
      `SELECT after FROM audit_log WHERE action = 'biometric.delete'
       AND entity = $1`,
      [`worker:${workerId}`],
    );
    expect(certificate.rows[0].after.certificate.providerDeleteVerified).toBe(
      true,
    );
  });

  it('engineers cannot delete biometrics', async () => {
    await request(app.getHttpServer())
      .delete(`/workers/${workerId}/biometrics`)
      .set('Authorization', `Bearer ${engineerToken}`)
      .expect(403);
  });

  it('serves consent copy and quality thresholds from server config (E3-S03/S08)', async () => {
    const notice = await request(app.getHttpServer())
      .get('/config/consent-notice')
      .set('Authorization', `Bearer ${engineerToken}`)
      .expect(200);
    expect(notice.body.en).toContain('Republic Act 10173');
    expect(notice.body.tl).toContain('Data Privacy Act');
    expect(notice.body.version).toBeGreaterThanOrEqual(1);

    const quality = await request(app.getHttpServer())
      .get('/config/enrollment-quality')
      .set('Authorization', `Bearer ${engineerToken}`)
      .expect(200);
    expect(quality.body.minJpegBytesPerPixel).toBeGreaterThan(0);
    expect(quality.body.minWidthPx).toBeGreaterThan(0);
  });
});
