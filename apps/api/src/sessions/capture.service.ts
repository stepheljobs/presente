import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/roles';
import { DatabaseService } from '../database/database.service';
import { bandFor } from '../recognition/banding';
import type { Band } from '../recognition/banding';
import { RECOGNITION_PROVIDER } from '../recognition/provider';
import type { RecognitionProvider } from '../recognition/provider';

interface TagRow {
  id: string;
  session_id: string;
  photo_id: string | null;
  worker_id: string | null;
  band: Band | null;
  confidence: string | null;
  source: string;
  status: string;
  notice: unknown;
}

@Injectable()
export class CaptureService {
  private readonly logger = new Logger(CaptureService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    @Inject(RECOGNITION_PROVIDER)
    private readonly recognition: RecognitionProvider,
  ) {}

  /**
   * E4-S04/S08 + E5-S04: bind photos to a session; re-verify client hash
   * when the client also sends a post-upload digest (tamper_flag on mismatch).
   */
  async submitPhotos(
    actor: AuthUser,
    sessionId: string,
    photos: { storageKey: string; sha256?: string; sha256Verified?: string }[],
  ) {
    const photoIds = await this.db.withTenant(
      actor.tenantId,
      async (client) => {
        const session = await client.query(
          'SELECT 1 FROM attendance_sessions WHERE id = $1',
          [sessionId],
        );
        if (!session.rowCount) throw new NotFoundException('Session not found');
        const ids: string[] = [];
        for (const photo of photos) {
          // E5-S04: client re-hash after upload must match capture hash.
          const tamper =
            Boolean(photo.sha256) &&
            Boolean(photo.sha256Verified) &&
            photo.sha256 !== photo.sha256Verified;
          const result = await client.query<{ id: string }>(
            `INSERT INTO session_photos
               (tenant_id, session_id, storage_key, sha256_client, tamper_flag)
             VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid,
                     $1, $2, $3, $4)
             RETURNING id`,
            [sessionId, photo.storageKey, photo.sha256 ?? null, tamper],
          );
          ids.push(result.rows[0].id);
        }
        return ids;
      },
    );
    await this.runRecognition(actor.tenantId, sessionId);
    // On-sync sweep (E4-S19): a time-out session landing is the moment
    // missing-time-in exceptions become detectable.
    const meta = await this.db.withTenant(actor.tenantId, (client) =>
      client.query<{ type: string; day: string }>(
        `SELECT s.type,
                ((s.device_captured_at AT TIME ZONE cs.timezone)::date)::text AS day
         FROM attendance_sessions s
         JOIN company_settings cs ON cs.tenant_id = s.tenant_id
         WHERE s.id = $1`,
        [sessionId],
      ),
    );
    if (meta.rows[0]?.type === 'time_out') {
      await this.sweepExceptions(actor.tenantId, meta.rows[0].day);
    }
    return this.getSession(actor, sessionId).then((s) => ({
      photoIds,
      ...s,
    }));
  }

  /**
   * E4-S09: match each pending photo against the site roster (fallback:
   * whole company roster); persist per-face {worker, confidence} with the
   * S10 band. Provider failure leaves the photo `pending recognition`.
   * E4-S21: lookalike-pair matches are forced down to confirm-band.
   */
  async runRecognition(tenantId: string, sessionId: string): Promise<void> {
    const context = await this.db.withTenant(tenantId, async (client) => {
      const session = await client.query<{ site_id: string | null }>(
        'SELECT site_id FROM attendance_sessions WHERE id = $1',
        [sessionId],
      );
      if (!session.rowCount) return null;
      const siteId = session.rows[0].site_id;

      const candidates = await client.query<{
        worker_id: string;
        face_id: string;
      }>(
        `SELECT w.id AS worker_id, 'stub' AS face_id FROM workers w
         WHERE w.biometric_status = 'enrolled' AND w.status = 'active'
         AND ($1::uuid IS NULL OR EXISTS (
           SELECT 1 FROM site_workers sw
           WHERE sw.worker_id = w.id AND sw.site_id = $1
         ) OR NOT EXISTS (
           SELECT 1 FROM site_workers sw2 WHERE sw2.site_id = $1
         ))`,
        [siteId],
      );

      const pending = await client.query<{ id: string; storage_key: string }>(
        `SELECT id, storage_key FROM session_photos
         WHERE session_id = $1 AND recognition_status IN ('pending', 'failed')`,
        [sessionId],
      );

      const settings = await client.query<{
        recognition_high_threshold: string;
        recognition_confirm_threshold: string;
      }>(`SELECT * FROM company_settings LIMIT 1`);

      const pairs = await client.query<{ worker_a: string; worker_b: string }>(
        'SELECT worker_a, worker_b FROM lookalike_pairs',
      );

      return {
        photos: pending.rows,
        candidates: candidates.rows.map((c) => ({
          workerId: c.worker_id,
          faceId: c.face_id,
        })),
        thresholds: {
          high: Number(settings.rows[0]?.recognition_high_threshold ?? 0.9),
          confirm: Number(
            settings.rows[0]?.recognition_confirm_threshold ?? 0.7,
          ),
        },
        lookalikes: new Set(
          pairs.rows.flatMap((p) => [p.worker_a, p.worker_b]),
        ),
      };
    });
    if (!context || context.photos.length === 0) return;

    for (const photo of context.photos) {
      let faces: { workerId: string | null; confidence: number }[];
      try {
        const result = await this.recognition.searchFaces({
          tenantId,
          photoKey: photo.storage_key,
          candidates: context.candidates,
        });
        faces = result.faces;
      } catch (err) {
        this.logger.warn(`recognition failed photo=${photo.id}: ${String(err)}`);
        await this.db.withTenant(tenantId, (client) =>
          client.query(
            `UPDATE session_photos SET recognition_status = 'failed' WHERE id = $1`,
            [photo.id],
          ),
        );
        continue;
      }

      await this.db.withTenant(tenantId, async (client) => {
        const scope = await this.sessionDayScope(client, sessionId);
        const manuals = await client.query<{
          id: string;
          worker_id: string;
          source: string;
        }>(
          `SELECT id, worker_id, source FROM session_tags
           WHERE session_id = $1 AND photo_id IS NOT DISTINCT FROM $2
             AND worker_id IS NOT NULL
             AND source IN ('manual', 'confirmed')
             AND status = 'active'`,
          [sessionId, photo.id],
        );
        // Also include session-level manuals without a photo bind.
        const sessionManuals = await client.query<{
          id: string;
          worker_id: string;
          source: string;
        }>(
          `SELECT id, worker_id, source FROM session_tags
           WHERE session_id = $1 AND photo_id IS NULL
             AND worker_id IS NOT NULL
             AND source IN ('manual', 'confirmed')
             AND status = 'active'`,
          [sessionId],
        );
        const allManuals = [...manuals.rows, ...sessionManuals.rows];
        const manualWorkerIds = new Set(allManuals.map((m) => m.worker_id));

        const autoMatches: { workerId: string; band: Band; confidence: number }[] =
          [];

        for (const face of faces) {
          let band: Band = face.workerId
            ? bandFor(face.confidence, context.thresholds)
            : 'unrecognized';
          let notice: Record<string, unknown> | null = null;
          if (
            band === 'high' &&
            face.workerId &&
            context.lookalikes.has(face.workerId)
          ) {
            band = 'confirm';
            notice = { forcedConfirm: 'lookalike_pair' };
          }

          // E5-S08: agreement with an existing manual tag → confirm, skip auto row.
          if (face.workerId && manualWorkerIds.has(face.workerId) && band !== 'unrecognized') {
            await client.query(
              `UPDATE session_tags
               SET notice = coalesce(notice, '{}'::jsonb)
                              || '{"recognitionAgreed":true}'::jsonb
               WHERE session_id = $1 AND worker_id = $2 AND status = 'active'
                 AND source IN ('manual', 'confirmed')`,
              [sessionId, face.workerId],
            );
            await this.audit.log(client, {
              actor: null,
              action: 'recognition.agree_manual',
              entity: `session:${sessionId}`,
              after: { workerId: face.workerId, confidence: face.confidence },
            });
            continue;
          }

          // E5-S05: admin-edited worker-day wins; engineer auto tag suppressed.
          if (face.workerId && scope && band !== 'unrecognized') {
            const locked = await this.isAdminEditedDay(
              client,
              face.workerId,
              scope.siteId,
              scope.day,
            );
            if (locked) {
              await client.query(
                `INSERT INTO session_tags
                   (tenant_id, session_id, photo_id, worker_id, band, confidence,
                    source, status, notice)
                 VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid,
                         $1, $2, $3, $4, $5, 'auto', 'suppressed_admin', $6)`,
                [
                  sessionId,
                  photo.id,
                  face.workerId,
                  band,
                  face.confidence,
                  JSON.stringify({ reason: 'admin_edit_wins' }),
                ],
              );
              await this.audit.log(client, {
                actor: null,
                action: 'sync.conflict_admin_wins',
                entity: `session:${sessionId}`,
                after: {
                  workerId: face.workerId,
                  engineerBand: band,
                  confidence: face.confidence,
                },
                reason: 'Admin-edited worker-day retained; engineer tag suppressed',
              });
              continue;
            }
          }

          if (face.workerId && band !== 'unrecognized') {
            autoMatches.push({
              workerId: face.workerId,
              band,
              confidence: face.confidence,
            });
          }

          await client.query(
            `INSERT INTO session_tags
               (tenant_id, session_id, photo_id, worker_id, band, confidence,
                source, status, notice)
             VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid,
                     $1, $2, $3, $4, $5, 'auto', $6, $7)`,
            [
              sessionId,
              photo.id,
              band === 'unrecognized' ? null : face.workerId,
              band,
              face.confidence,
              band === 'high' ? 'active' : 'pending_confirm',
              notice ? JSON.stringify(notice) : null,
            ],
          );
        }

        // E5-S08: high auto match disagrees with a manual tag on the same photo.
        for (const manual of allManuals) {
          const agreed = autoMatches.some((a) => a.workerId === manual.worker_id);
          const rival = autoMatches.find(
            (a) =>
              a.workerId !== manual.worker_id &&
              (a.band === 'high' || a.band === 'confirm'),
          );
          if (!agreed && rival) {
            await client.query(
              `INSERT INTO exceptions
                 (tenant_id, type, severity, worker_id, session_id, note)
               VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid,
                       'recognition_disagreement', 2, $1, $2, $3)`,
              [
                manual.worker_id,
                sessionId,
                `Manual tag vs recognition match ${rival.workerId} (${rival.band})`,
              ],
            );
            await this.audit.log(client, {
              actor: null,
              action: 'recognition.disagree_manual',
              entity: `session:${sessionId}`,
              before: { manualWorkerId: manual.worker_id },
              after: {
                recognitionWorkerId: rival.workerId,
                band: rival.band,
              },
              reason: 'Never overwrite manual tag (E5-S08)',
            });
          }
        }

        await client.query(
          `UPDATE session_photos SET recognition_status = 'done' WHERE id = $1`,
          [photo.id],
        );
      });
    }
    await this.applyDuplicateProtection(tenantId, sessionId);
  }

  private async sessionDayScope(
    client: PoolClient,
    sessionId: string,
  ): Promise<{ siteId: string | null; day: string } | null> {
    const result = await client.query<{ site_id: string | null; day: string }>(
      `SELECT s.site_id,
              ((s.device_captured_at AT TIME ZONE cs.timezone)::date)::text AS day
       FROM attendance_sessions s
       JOIN company_settings cs ON cs.tenant_id = s.tenant_id
       WHERE s.id = $1`,
      [sessionId],
    );
    if (!result.rowCount) return null;
    return { siteId: result.rows[0].site_id, day: result.rows[0].day };
  }

  private async isAdminEditedDay(
    client: PoolClient,
    workerId: string,
    siteId: string | null,
    day: string,
  ): Promise<boolean> {
    if (!siteId) return false;
    const result = await client.query(
      `SELECT 1 FROM worker_day_admin_edits
       WHERE worker_id = $1 AND site_id = $2 AND day = $3::date`,
      [workerId, siteId, day],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * E5-S05 / E6-S04 seed: record that an admin edited a worker-day so late
   * engineer sync cannot silently overwrite it.
   */
  async recordAdminDayEdit(
    actor: AuthUser,
    input: {
      workerId: string;
      siteId: string;
      day: string;
      reason: string;
      before?: unknown;
      after?: unknown;
    },
  ) {
    if (actor.role === 'engineer') {
      throw new BadRequestException('Engineers cannot lock worker-days');
    }
    return this.db.withTenant(actor.tenantId, async (client) => {
      await client.query(
        `INSERT INTO worker_day_admin_edits
           (tenant_id, worker_id, site_id, day, edited_by, reason, before, after)
         VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid,
                 $1, $2, $3::date, $4, $5, $6, $7)
         ON CONFLICT (tenant_id, worker_id, day, site_id) DO UPDATE SET
           edited_by = excluded.edited_by,
           edited_at = now(),
           reason = excluded.reason,
           before = excluded.before,
           after = excluded.after`,
        [
          input.workerId,
          input.siteId,
          input.day,
          actor.sub,
          input.reason,
          input.before === undefined ? null : JSON.stringify(input.before),
          input.after === undefined ? null : JSON.stringify(input.after),
        ],
      );
      await this.audit.log(client, {
        actor: actor.sub,
        action: 'worker_day.admin_edit',
        entity: `worker:${input.workerId}`,
        before: input.before,
        after: input.after,
        reason: input.reason,
      });
      return { locked: true };
    });
  }

  /**
   * E4-S17/S20: among active time-in tags for the same worker/day/site,
   * only the earliest capture stays active; later ones are marked
   * ignored_duplicate with notice metadata. Idempotent, so late-arriving
   * sessions (additional time-in, E4-S20) re-settle correctly.
   */
  async applyDuplicateProtection(
    tenantId: string,
    sessionId: string,
  ): Promise<void> {
    await this.db.withTenant(tenantId, async (client) => {
      await client.query(
        `WITH scope AS (
           SELECT s.site_id, s.type,
                  (s.device_captured_at AT TIME ZONE cs.timezone)::date AS day
           FROM attendance_sessions s
           JOIN company_settings cs ON cs.tenant_id = s.tenant_id
           WHERE s.id = $1
         ),
         ranked AS (
           SELECT t.id,
                  row_number() OVER (
                    PARTITION BY t.worker_id
                    ORDER BY s.device_captured_at
                  ) AS rn,
                  first_value(s.id) OVER (
                    PARTITION BY t.worker_id
                    ORDER BY s.device_captured_at
                  ) AS earliest_session
           FROM session_tags t
           JOIN attendance_sessions s ON s.id = t.session_id
           JOIN company_settings cs ON cs.tenant_id = s.tenant_id
           JOIN scope ON scope.type = 'time_in'
             AND s.type = 'time_in'
             AND s.site_id IS NOT DISTINCT FROM scope.site_id
             AND (s.device_captured_at AT TIME ZONE cs.timezone)::date = scope.day
           WHERE t.worker_id IS NOT NULL
             AND t.status IN ('active', 'ignored_duplicate')
         )
         UPDATE session_tags t SET
           status = CASE WHEN r.rn = 1 THEN 'active' ELSE 'ignored_duplicate' END,
           notice = CASE WHEN r.rn = 1 THEN t.notice
                    ELSE coalesce(t.notice, '{}'::jsonb) || jsonb_build_object(
                      'reason', 'duplicate_time_in',
                      'earliestSessionId', r.earliest_session
                    ) END
         FROM ranked r WHERE t.id = r.id`,
        [sessionId],
      );
    });
  }

  /** E4-S12/S13/S14: tagging-screen decisions. */
  async applyTagAction(
    actor: AuthUser,
    sessionId: string,
    action:
      | { type: 'confirm'; tagId: string; accept: boolean; workerId?: string }
      | { type: 'manual'; workerId: string; photoId?: string }
      | { type: 'visitor'; photoId?: string; tagId?: string },
  ) {
    await this.db.withTenant(actor.tenantId, async (client) => {
      if (action.type === 'confirm') {
        const tag = await client.query<TagRow>(
          `SELECT * FROM session_tags WHERE id = $1 AND session_id = $2`,
          [action.tagId, sessionId],
        );
        if (!tag.rowCount) throw new NotFoundException('Tag not found');
        if (action.accept) {
          await client.query(
            `UPDATE session_tags SET status = 'active', source = 'confirmed',
                    created_by = $2 WHERE id = $1`,
            [action.tagId, actor.sub],
          );
        } else {
          await client.query(
            `UPDATE session_tags SET status = 'rejected', created_by = $2
             WHERE id = $1`,
            [action.tagId, actor.sub],
          );
          if (action.workerId) {
            // "Pick other" path lands as a flagged manual tag (FR-15).
            await this.insertManualTag(
              client,
              sessionId,
              tag.rows[0].photo_id,
              action.workerId,
              actor,
            );
          }
        }
      } else if (action.type === 'manual') {
        await this.insertManualTag(
          client,
          sessionId,
          action.photoId ?? null,
          action.workerId,
          actor,
        );
      } else {
        if (action.tagId) {
          await client.query(
            `UPDATE session_tags SET status = 'active', source = 'visitor',
                    worker_id = NULL, created_by = $2 WHERE id = $1`,
            [action.tagId, actor.sub],
          );
        } else {
          await client.query(
            `INSERT INTO session_tags
               (tenant_id, session_id, photo_id, source, status, created_by)
             VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid,
                     $1, $2, 'visitor', 'active', $3)`,
            [sessionId, action.photoId ?? null, actor.sub],
          );
        }
      }
    });
    await this.applyDuplicateProtection(actor.tenantId, sessionId);
    return this.getSession(actor, sessionId);
  }

  private async insertManualTag(
    client: PoolClient,
    sessionId: string,
    photoId: string | null,
    workerId: string,
    actor: AuthUser,
  ) {
    const scope = await this.sessionDayScope(client, sessionId);
    // E5-S05: late engineer manual tag on an admin-edited day is suppressed.
    if (
      actor.role === 'engineer' &&
      scope &&
      (await this.isAdminEditedDay(client, workerId, scope.siteId, scope.day))
    ) {
      await client.query(
        `INSERT INTO session_tags
           (tenant_id, session_id, photo_id, worker_id, source, status, notice, created_by)
         VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid,
                 $1, $2, $3, 'manual', 'suppressed_admin',
                 '{"flag":"manual_tag","reason":"admin_edit_wins"}'::jsonb, $4)`,
        [sessionId, photoId, workerId, actor.sub],
      );
      await this.audit.log(client, {
        actor: actor.sub,
        action: 'sync.conflict_admin_wins',
        entity: `session:${sessionId}`,
        after: { workerId, source: 'manual' },
        reason: 'Admin-edited worker-day retained; engineer manual tag suppressed',
      });
      return;
    }

    await client.query(
      `INSERT INTO session_tags
         (tenant_id, session_id, photo_id, worker_id, source, status, notice, created_by)
       VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid,
               $1, $2, $3, 'manual', 'active',
               '{"flag":"manual_tag"}'::jsonb, $4)`,
      [sessionId, photoId, workerId, actor.sub],
    );
    // Manual tags surface in the admin queue (FR-15, resolver E8-S07).
    await client.query(
      `INSERT INTO exceptions (tenant_id, type, severity, worker_id, session_id)
       VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid,
               'manual_tag', 3, $1, $2)`,
      [workerId, sessionId],
    );
  }

  async getSession(actor: AuthUser, sessionId: string) {
    return this.db.withTenant(actor.tenantId, async (client) => {
      const session = await client.query(
        `SELECT s.*, st.name AS site_name FROM attendance_sessions s
         LEFT JOIN sites st ON st.id = s.site_id WHERE s.id = $1`,
        [sessionId],
      );
      if (!session.rowCount) throw new NotFoundException('Session not found');
      const photos = await client.query(
        `SELECT id, storage_key, sha256_client, tamper_flag, recognition_status
         FROM session_photos WHERE session_id = $1 ORDER BY created_at`,
        [sessionId],
      );
      const tags = await client.query(
        `SELECT t.*, w.full_name, w.nickname FROM session_tags t
         LEFT JOIN workers w ON w.id = t.worker_id
         WHERE t.session_id = $1 ORDER BY t.created_at`,
        [sessionId],
      );
      const s = session.rows[0];
      return {
        id: s.id,
        type: s.type,
        siteId: s.site_id,
        siteName: s.site_name,
        gpsStatus: s.gps_status,
        withinFence: s.within_fence,
        distanceM: s.distance_m,
        mockLocation: s.mock_location,
        deviceCapturedAt: s.device_captured_at.toISOString(),
        photos: photos.rows.map((p) => ({
          id: p.id,
          storageKey: p.storage_key,
          recognitionStatus: p.recognition_status,
          tamperFlag: p.tamper_flag,
        })),
        tags: tags.rows.map((t) => ({
          id: t.id,
          photoId: t.photo_id,
          workerId: t.worker_id,
          workerName: t.full_name,
          nickname: t.nickname,
          band: t.band,
          confidence: t.confidence === null ? null : Number(t.confidence),
          source: t.source,
          status: t.status,
          // node-pg returns jsonb as object; tolerate string just in case.
          notice:
            typeof t.notice === 'string'
              ? (JSON.parse(t.notice) as Record<string, unknown>)
              : t.notice,
        })),
      };
    });
  }

  /**
   * E4-S18: workers timed-in today at this site but absent from this
   * time-out session's tags.
   */
  async reconciliation(actor: AuthUser, sessionId: string) {
    return this.db.withTenant(actor.tenantId, async (client) => {
      const rows = await client.query<{
        worker_id: string;
        full_name: string;
      }>(
        `WITH scope AS (
           SELECT s.site_id,
                  (s.device_captured_at AT TIME ZONE cs.timezone)::date AS day,
                  cs.timezone
           FROM attendance_sessions s
           JOIN company_settings cs ON cs.tenant_id = s.tenant_id
           WHERE s.id = $1 AND s.type = 'time_out'
         )
         SELECT DISTINCT w.id AS worker_id, w.full_name
         FROM session_tags t
         JOIN attendance_sessions s ON s.id = t.session_id
         JOIN scope ON s.site_id IS NOT DISTINCT FROM scope.site_id
           AND (s.device_captured_at AT TIME ZONE scope.timezone)::date = scope.day
         JOIN workers w ON w.id = t.worker_id
         WHERE s.type = 'time_in' AND t.status = 'active' AND t.worker_id IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM session_tags t2
             WHERE t2.session_id = $1 AND t2.worker_id = t.worker_id
               AND t2.status IN ('active', 'pending_confirm')
           )
         ORDER BY w.full_name`,
        [sessionId],
      );
      return rows.rows.map((r) => ({
        workerId: r.worker_id,
        fullName: r.full_name,
      }));
    });
  }

  /** E4-S18 actions: left-early note (suppresses the sweep) or explicit
   * leave-as-exception. */
  async reconcileWorker(
    actor: AuthUser,
    sessionId: string,
    workerId: string,
    action: 'left_early' | 'leave_exception',
    note?: string,
  ) {
    if (action === 'left_early' && !note?.trim()) {
      throw new BadRequestException('A note is required for left-early');
    }
    await this.db.withTenant(actor.tenantId, async (client) => {
      const scope = await client.query<{ site_id: string | null; day: string }>(
        `SELECT s.site_id,
                ((s.device_captured_at AT TIME ZONE cs.timezone)::date)::text AS day
         FROM attendance_sessions s
         JOIN company_settings cs ON cs.tenant_id = s.tenant_id
         WHERE s.id = $1`,
        [sessionId],
      );
      if (!scope.rowCount) throw new NotFoundException('Session not found');
      const { site_id, day } = scope.rows[0];
      await client.query(
        `INSERT INTO exceptions
           (tenant_id, type, severity, worker_id, session_id, site_id, day,
            note, status, resolved_by, resolved_at)
         VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid,
                 'missing_time_out', 2, $1, $2, $3, $4, $5, $6, $7,
                 CASE WHEN $6 = 'resolved' THEN now() END)
         ON CONFLICT (tenant_id, type, worker_id, site_id, day)
           WHERE worker_id IS NOT NULL AND day IS NOT NULL
         DO UPDATE SET note = excluded.note, status = excluded.status,
                       resolved_by = excluded.resolved_by,
                       resolved_at = excluded.resolved_at`,
        [
          workerId,
          sessionId,
          site_id,
          day,
          note ?? null,
          action === 'left_early' ? 'resolved' : 'open',
          action === 'left_early' ? actor.sub : null,
        ],
      );
      await this.audit.log(client, {
        actor: actor.sub,
        action: `reconcile.${action}`,
        entity: `session:${sessionId}`,
        after: { workerId, note: note ?? null },
      });
    });
    return { recorded: true };
  }

  /**
   * E4-S19: sweep a tenant-day for missing time-outs (timed in, never
   * timed out) and missing time-ins (timed out only). Left-early notes
   * already occupy the dedupe slot, so they suppress regeneration.
   */
  async sweepExceptions(tenantId: string, day?: string): Promise<number> {
    return this.db.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `WITH tz AS (SELECT timezone FROM company_settings LIMIT 1),
         target AS (
           SELECT coalesce(
             $1::date,
             (now() AT TIME ZONE (SELECT timezone FROM tz))::date
           ) AS day
         ),
         daily AS (
           SELECT t.worker_id, s.site_id, s.type
           FROM session_tags t
           JOIN attendance_sessions s ON s.id = t.session_id
           WHERE t.status = 'active' AND t.worker_id IS NOT NULL
             AND (s.device_captured_at AT TIME ZONE (SELECT timezone FROM tz))::date
                 = (SELECT day FROM target)
         ),
         missing_out AS (
           SELECT DISTINCT worker_id, site_id, 'missing_time_out'::text AS type
           FROM daily d WHERE type = 'time_in'
           AND NOT EXISTS (
             SELECT 1 FROM daily d2 WHERE d2.worker_id = d.worker_id
             AND d2.site_id IS NOT DISTINCT FROM d.site_id AND d2.type = 'time_out'
           )
         ),
         missing_in AS (
           SELECT DISTINCT worker_id, site_id, 'missing_time_in'::text AS type
           FROM daily d WHERE type = 'time_out'
           AND NOT EXISTS (
             SELECT 1 FROM daily d2 WHERE d2.worker_id = d.worker_id
             AND d2.site_id IS NOT DISTINCT FROM d.site_id AND d2.type = 'time_in'
           )
         )
         INSERT INTO exceptions (tenant_id, type, severity, worker_id, site_id, day)
         SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid,
                type, 2, worker_id, site_id, (SELECT day FROM target)
         FROM (SELECT * FROM missing_out UNION ALL SELECT * FROM missing_in) m
         ON CONFLICT (tenant_id, type, worker_id, site_id, day)
           WHERE worker_id IS NOT NULL AND day IS NOT NULL
         DO NOTHING`,
        [day ?? null],
      );
      return result.rowCount ?? 0;
    });
  }
}
