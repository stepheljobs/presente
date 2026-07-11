import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/roles';
import { DatabaseService } from '../database/database.service';
import { RECOGNITION_PROVIDER } from '../recognition/provider';
import type { RecognitionProvider } from '../recognition/provider';

export interface ConsentInput {
  type: 'signature' | 'paper';
  artifactKey: string;
  strokeData?: unknown;
  language: 'en' | 'tl';
}

export interface EnrollmentPhotoInput {
  pose: 'front' | 'left' | 'right' | 'hard_hat';
  storageKey: string;
  sha256?: string;
}

const TEMPLATE_RETRY_DELAYS_MS = [200, 1000, 4000];

@Injectable()
export class EnrollmentService {
  private readonly logger = new Logger(EnrollmentService.name);
  private readonly encKey: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    @Inject(RECOGNITION_PROVIDER)
    private readonly recognition: RecognitionProvider,
    config: ConfigService,
  ) {
    this.encKey = config.getOrThrow<string>('GOV_ID_ENC_KEY');
  }

  /** E3-S06: consent is its own legal artifact, recorded before any face data. */
  async addConsent(actor: AuthUser, workerId: string, input: ConsentInput) {
    return this.db.withTenant(actor.tenantId, async (client) => {
      const worker = await client.query('SELECT 1 FROM workers WHERE id = $1', [
        workerId,
      ]);
      if (!worker.rowCount) throw new NotFoundException('Worker not found');
      const result = await client.query<{ id: string }>(
        `INSERT INTO consents
           (tenant_id, worker_id, type, artifact_key, stroke_data, language, engineer_id)
         VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid,
                 $1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          workerId,
          input.type,
          input.artifactKey,
          input.strokeData ? JSON.stringify(input.strokeData) : null,
          input.language,
          actor.sub,
        ],
      );
      await this.audit.log(client, {
        actor: actor.sub,
        action: 'consent.record',
        entity: `worker:${workerId}`,
        after: { type: input.type, language: input.language },
      });
      return { id: result.rows[0].id };
    });
  }

  /**
   * E3-S06 gate + E3-S07 ingestion + E3-S09 template generation.
   * No consent record → 403, no face data stored.
   */
  async submitPhotos(
    actor: AuthUser,
    workerId: string,
    photos: EnrollmentPhotoInput[],
  ) {
    await this.db.withTenant(actor.tenantId, async (client) => {
      const consent = await client.query(
        'SELECT 1 FROM consents WHERE worker_id = $1 LIMIT 1',
        [workerId],
      );
      if (!consent.rowCount) {
        throw new ForbiddenException(
          'Biometric consent must be recorded before face enrollment',
        );
      }
      for (const photo of photos) {
        await client.query(
          `INSERT INTO enrollment_photos
             (tenant_id, worker_id, pose, storage_key, sha256, created_by)
           VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid,
                   $1, $2, $3, $4, $5)`,
          [workerId, photo.pose, photo.storageKey, photo.sha256 ?? null, actor.sub],
        );
      }
      await client.query(
        `UPDATE workers SET biometric_status = 'pending', updated_at = now()
         WHERE id = $1`,
        [workerId],
      );
      await this.audit.log(client, {
        actor: actor.sub,
        action: 'enrollment.photos',
        entity: `worker:${workerId}`,
        after: { poses: photos.map((p) => p.pose) },
      });
    });

    const generated = await this.generateTemplate(actor.tenantId, workerId);
    return { biometricStatus: generated ? 'enrolled' : 'pending' };
  }

  /**
   * E3-S09: provider call with backoff; on exhaustion the worker stays
   * `pending` and a later retryPending() sweep picks it up.
   */
  async generateTemplate(tenantId: string, workerId: string): Promise<boolean> {
    const keys = await this.db.withTenant(tenantId, async (client) => {
      const rows = await client.query<{ storage_key: string }>(
        'SELECT storage_key FROM enrollment_photos WHERE worker_id = $1',
        [workerId],
      );
      return rows.rows.map((r) => r.storage_key);
    });
    if (keys.length === 0) return false;

    for (let attempt = 0; ; attempt++) {
      try {
        const { faceId } = await this.recognition.indexFaces({
          tenantId,
          workerId,
          photoKeys: keys,
        });
        await this.db.withTenant(tenantId, (client) =>
          client.query(
            `UPDATE workers SET biometric_status = 'enrolled',
                    face_provider = 'stub',
                    face_id_enc = pgp_sym_encrypt($2, $3, 'cipher-algo=aes256'),
                    face_indexed_at = now(), updated_at = now()
             WHERE id = $1`,
            [workerId, faceId, this.encKey],
          ),
        );
        return true;
      } catch (err) {
        if (attempt >= TEMPLATE_RETRY_DELAYS_MS.length) {
          this.logger.warn(
            `template generation failed for worker=${workerId}: ${String(err)}`,
          );
          return false;
        }
        await new Promise((r) =>
          setTimeout(r, TEMPLATE_RETRY_DELAYS_MS[attempt]),
        );
      }
    }
  }

  /**
   * E3-S12: verified provider-side delete, then purge photos + template.
   * Attendance/payroll rows and consent records are retained (NFR-5); the
   * audit entry is the deletion certificate (Flow 9).
   */
  async deleteBiometrics(actor: AuthUser, workerId: string) {
    const faceId = await this.db.withTenant(actor.tenantId, async (client) => {
      const row = await client.query<{ face_id: string | null }>(
        `SELECT CASE WHEN face_id_enc IS NULL THEN NULL
                ELSE pgp_sym_decrypt(face_id_enc, $2) END AS face_id
         FROM workers WHERE id = $1`,
        [workerId, this.encKey],
      );
      if (!row.rowCount) throw new NotFoundException('Worker not found');
      return row.rows[0].face_id;
    });

    if (faceId) {
      const result = await this.recognition.deleteFaces({
        tenantId: actor.tenantId,
        faceId,
      });
      if (!result.deleted) {
        throw new Error('Recognition provider did not confirm deletion');
      }
    }

    return this.db.withTenant(actor.tenantId, async (client) => {
      const photos = await client.query(
        'DELETE FROM enrollment_photos WHERE worker_id = $1',
        [workerId],
      );
      await client.query(
        `UPDATE workers SET biometric_status = 'none', face_provider = NULL,
                face_id_enc = NULL, face_indexed_at = NULL, updated_at = now()
         WHERE id = $1`,
        [workerId],
      );
      await this.audit.log(client, {
        actor: actor.sub,
        action: 'biometric.delete',
        entity: `worker:${workerId}`,
        after: {
          certificate: {
            providerDeleteVerified: faceId !== null,
            photosPurged: photos.rowCount,
            deletedAt: new Date().toISOString(),
          },
        },
        reason: 'Biometric data deletion (RA 10173 / Flow 9)',
      });
      return { deleted: true, photosPurged: photos.rowCount };
    });
  }
}
