import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/roles';
import { DatabaseService } from '../database/database.service';
import { toSimplePdf } from '../payroll/exports';

/**
 * E8 dashboard, reports, padding indicators, evidence pack.
 * Exception list/resolve already live on ExceptionsController (E8-S04).
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** E8-S01: per-site tagged-in vs roster for today (tenant timezone). */
  async todayHeadcount(actor: AuthUser) {
    return this.db.withTenant(actor.tenantId, async (client) => {
      const tz = await this.tz(client);
      const rows = await client.query(
        `WITH today AS (
           SELECT (now() AT TIME ZONE $1)::date AS day
         ),
         roster AS (
           SELECT s.id AS site_id, s.name AS site_name, count(sw.worker_id)::int AS roster_n
           FROM sites s
           LEFT JOIN site_workers sw ON sw.site_id = s.id
           WHERE s.archived_at IS NULL
           GROUP BY s.id, s.name
         ),
         tagged AS (
           SELECT sess.site_id, count(DISTINCT t.worker_id)::int AS tagged_n
           FROM session_tags t
           JOIN attendance_sessions sess ON sess.id = t.session_id
           WHERE t.status = 'active' AND t.worker_id IS NOT NULL
             AND sess.type = 'time_in'
             AND (sess.device_captured_at AT TIME ZONE $1)::date = (SELECT day FROM today)
           GROUP BY sess.site_id
         )
         SELECT r.site_id, r.site_name, r.roster_n,
                coalesce(tg.tagged_n, 0) AS tagged_n
         FROM roster r
         LEFT JOIN tagged tg ON tg.site_id = r.site_id
         ORDER BY r.site_name`,
        [tz],
      );
      return rows.rows.map((r) => ({
        siteId: r.site_id,
        siteName: r.site_name,
        roster: Number(r.roster_n),
        taggedIn: Number(r.tagged_n),
        label: `${r.tagged_n}/${r.roster_n} in`,
      }));
    });
  }

  /** E8-S02: reverse-chronological session photos. */
  async photoFeed(actor: AuthUser, limit = 40) {
    return this.db.withTenant(actor.tenantId, async (client) => {
      const rows = await client.query(
        `SELECT sp.id, sp.storage_key, sp.recognition_status, sp.created_at,
                sess.id AS session_id, sess.type, sess.site_id, s.name AS site_name,
                sess.device_captured_at, sess.within_fence, sess.mock_location
         FROM session_photos sp
         JOIN attendance_sessions sess ON sess.id = sp.session_id
         LEFT JOIN sites s ON s.id = sess.site_id
         ORDER BY sp.created_at DESC
         LIMIT $1`,
        [Math.min(limit, 100)],
      );
      return rows.rows.map((p) => ({
        id: p.id,
        storageKey: p.storage_key,
        recognitionStatus: p.recognition_status,
        sessionId: p.session_id,
        sessionType: p.type,
        siteId: p.site_id,
        siteName: p.site_name,
        capturedAt: toIso(p.device_captured_at),
        createdAt: toIso(p.created_at),
        withinFence: p.within_fence,
        mockLocation: p.mock_location,
      }));
    });
  }

  /** E8-S03: last session sync per engineer device. */
  async deviceSyncStatus(actor: AuthUser) {
    return this.db.withTenant(actor.tenantId, async (client) => {
      const rows = await client.query(
        `SELECT sess.device_id, sess.engineer_id, u.email AS engineer_email,
                max(sess.server_received_at) AS last_sync,
                count(*) FILTER (
                  WHERE sess.server_received_at > now() - interval '24 hours'
                )::int AS sessions_24h
         FROM attendance_sessions sess
         JOIN users u ON u.id = sess.engineer_id
         GROUP BY sess.device_id, sess.engineer_id, u.email
         ORDER BY last_sync DESC NULLS LAST`,
      );
      const now = Date.now();
      return rows.rows.map((r) => {
        const last = r.last_sync ? new Date(r.last_sync).getTime() : 0;
        const stale = !last || now - last > 24 * 3600_000;
        return {
          deviceId: r.device_id,
          engineerId: r.engineer_id,
          engineerEmail: r.engineer_email,
          lastSync: r.last_sync ? toIso(r.last_sync) : null,
          sessions24h: Number(r.sessions_24h),
          stale,
        };
      });
    });
  }

  /** E8-S10/S11: session detail for tagging workspace. */
  async sessionForTagging(actor: AuthUser, sessionId: string) {
    return this.db.withTenant(actor.tenantId, async (client) => {
      const sess = await client.query(
        `SELECT sess.*, s.name AS site_name, s.lat AS site_lat, s.lng AS site_lng,
                s.radius_m
         FROM attendance_sessions sess
         LEFT JOIN sites s ON s.id = sess.site_id
         WHERE sess.id = $1`,
        [sessionId],
      );
      if (!sess.rowCount) throw new NotFoundException('Session not found');
      const photos = await client.query(
        `SELECT id, storage_key, recognition_status, sha256_client, tamper_flag, created_at
         FROM session_photos WHERE session_id = $1 ORDER BY created_at`,
        [sessionId],
      );
      const tags = await client.query(
        `SELECT t.*, w.full_name, w.nickname
         FROM session_tags t
         LEFT JOIN workers w ON w.id = t.worker_id
         WHERE t.session_id = $1 ORDER BY t.created_at`,
        [sessionId],
      );
      const s = sess.rows[0];
      return {
        id: s.id,
        type: s.type,
        siteId: s.site_id,
        siteName: s.site_name,
        siteLat: s.site_lat,
        siteLng: s.site_lng,
        radiusM: s.radius_m,
        lat: s.lat,
        lng: s.lng,
        withinFence: s.within_fence,
        distanceM: s.distance_m,
        mockLocation: s.mock_location,
        deviceCapturedAt: toIso(s.device_captured_at),
        engineerId: s.engineer_id,
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
          notice: t.notice,
        })),
      };
    });
  }

  /**
   * E8-S11: admin tag / retag / untag with mandatory reason.
   * Marks manual_tag_admin; never silent.
   */
  async adminTag(
    actor: AuthUser,
    sessionId: string,
    input: {
      action: 'tag' | 'retag' | 'untag';
      tagId?: string;
      workerId?: string;
      photoId?: string;
      reason: string;
    },
  ) {
    if (!input.reason?.trim() || input.reason.trim().length < 3) {
      throw new BadRequestException('Reason note is required');
    }
    if (actor.role === 'engineer') {
      throw new BadRequestException('Only admin/owner can admin-tag');
    }
    await this.db.withTenant(actor.tenantId, async (client) => {
      const before = await client.query(
        `SELECT * FROM session_tags WHERE session_id = $1`,
        [sessionId],
      );

      if (input.action === 'untag') {
        if (!input.tagId) throw new BadRequestException('tagId required');
        await client.query(
          `UPDATE session_tags SET status = 'rejected',
                  notice = coalesce(notice, '{}'::jsonb)
                    || jsonb_build_object('flag', 'manual_tag_admin', 'untagged', true),
                  created_by = $2
           WHERE id = $1`,
          [input.tagId, actor.sub],
        );
      } else if (input.action === 'retag') {
        if (!input.tagId || !input.workerId) {
          throw new BadRequestException('tagId and workerId required');
        }
        await client.query(
          `UPDATE session_tags SET worker_id = $2, source = 'manual', status = 'active',
                  notice = jsonb_build_object('flag', 'manual_tag_admin'),
                  created_by = $3
           WHERE id = $1`,
          [input.tagId, input.workerId, actor.sub],
        );
      } else {
        if (!input.workerId) {
          throw new BadRequestException('workerId required');
        }
        await client.query(
          `INSERT INTO session_tags
             (tenant_id, session_id, photo_id, worker_id, source, status, notice, created_by)
           VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid,
                   $1, $2, $3, 'manual', 'active',
                   '{"flag":"manual_tag_admin"}'::jsonb, $4)`,
          [sessionId, input.photoId ?? null, input.workerId, actor.sub],
        );
      }

      const after = await client.query(
        `SELECT * FROM session_tags WHERE session_id = $1`,
        [sessionId],
      );
      await this.audit.log(client, {
        actor: actor.sub,
        action: `admin_tag.${input.action}`,
        entity: `session:${sessionId}`,
        before: { tags: before.rows.length },
        after: {
          tags: after.rows.length,
          workerId: input.workerId ?? null,
          tagId: input.tagId ?? null,
        },
        reason: input.reason.trim(),
      });
    });
    // Fetch after the write transaction commits so a new connection sees tags.
    return this.sessionForTagging(actor, sessionId);
  }

  /**
   * E8-S06..S09: typed exception resolvers.
   * resolution shapes differ by type; all require a note where FR says so.
   */
  async resolveTyped(
    actor: AuthUser,
    exceptionId: string,
    input: {
      resolution:
        | 'set_halfday'
        | 'set_out_time'
        | 'mark_absent_pm'
        | 'approve_manual'
        | 'reject_manual'
        | 'accept_geofence'
        | 'reject_session'
        | 'keep_engineer'
        | 'use_recognition'
        | 'mark_absent'
        | 'resolve'
        | 'waive';
      note?: string;
      outTime?: string;
      workerId?: string;
    },
  ) {
    return this.db.withTenant(actor.tenantId, async (client) => {
      const ex = await client.query(`SELECT * FROM exceptions WHERE id = $1`, [
        exceptionId,
      ]);
      if (!ex.rowCount) throw new NotFoundException('Exception not found');
      const e = ex.rows[0];
      if (e.status !== 'open') {
        throw new BadRequestException('Exception is not open');
      }

      const note = input.note?.trim() ?? '';
      const needsNote = ![
        'approve_manual',
        'keep_engineer',
        'use_recognition',
      ].includes(input.resolution);
      if (needsNote && note.length < 3 && input.resolution !== 'approve_manual') {
        // approve_manual can be note-optional; reject needs note
        if (
          input.resolution === 'reject_manual' ||
          input.resolution === 'set_out_time' ||
          input.resolution === 'accept_geofence' ||
          input.resolution === 'reject_session' ||
          input.resolution === 'mark_absent' ||
          input.resolution === 'waive'
        ) {
          if (note.length < 3) {
            throw new BadRequestException('A note is required for this action');
          }
        }
      }

      // Apply day-record side effects where applicable.
      if (
        e.worker_id &&
        e.day &&
        (input.resolution === 'set_halfday' ||
          input.resolution === 'mark_absent_pm' ||
          input.resolution === 'mark_absent' ||
          input.resolution === 'set_out_time')
      ) {
        const day = asDate(e.day);
        const status =
          input.resolution === 'set_halfday'
            ? 'halfday'
            : input.resolution === 'set_out_time'
              ? 'present'
              : 'absent';
        await client.query(
          `UPDATE day_records SET
             status = $4,
             source = 'corrected',
             admin_note = $5,
             time_out = CASE
               WHEN $6::timestamptz IS NOT NULL THEN $6::timestamptz
               ELSE time_out END,
             updated_at = now()
           WHERE worker_id = $1 AND day = $2::date
             AND site_id IS NOT DISTINCT FROM $3::uuid`,
          [
            e.worker_id,
            day,
            e.site_id,
            status,
            note || input.resolution,
            input.outTime ?? null,
          ],
        );
      }

      if (input.resolution === 'reject_manual' && e.session_id && e.worker_id) {
        await client.query(
          `UPDATE session_tags SET status = 'rejected'
           WHERE session_id = $1 AND worker_id = $2 AND source = 'manual'
             AND status = 'active'`,
          [e.session_id, e.worker_id],
        );
      }

      if (input.resolution === 'use_recognition' && e.session_id) {
        // Prefer auto high tags; leave manual rejected when they disagree.
        await client.query(
          `UPDATE session_tags SET status = 'rejected'
           WHERE session_id = $1 AND source = 'manual' AND status = 'active'`,
          [e.session_id],
        );
        await client.query(
          `UPDATE session_tags SET status = 'active'
           WHERE session_id = $1 AND source = 'auto' AND band = 'high'
             AND status = 'pending_confirm'`,
          [e.session_id],
        );
      }

      if (input.resolution === 'keep_engineer' && e.session_id) {
        await client.query(
          `UPDATE session_tags SET status = 'rejected'
           WHERE session_id = $1 AND source = 'auto'
             AND status IN ('active', 'pending_confirm')
             AND worker_id IS DISTINCT FROM $2`,
          [e.session_id, e.worker_id],
        );
      }

      if (input.resolution === 'reject_session' && e.session_id) {
        await client.query(
          `UPDATE session_tags SET status = 'rejected' WHERE session_id = $1`,
          [e.session_id],
        );
      }

      const finalStatus =
        input.resolution === 'waive' ? 'waived' : 'resolved';
      await client.query(
        `UPDATE exceptions SET status = $2, note = coalesce($3, note),
                resolved_by = $4, resolved_at = now()
         WHERE id = $1`,
        [exceptionId, finalStatus, note || null, actor.sub],
      );
      await this.audit.log(client, {
        actor: actor.sub,
        action: `exception.${input.resolution}`,
        entity: `exception:${exceptionId}`,
        reason: note || input.resolution,
        after: { resolution: input.resolution, outTime: input.outTime ?? null },
      });
      return { status: finalStatus, resolution: input.resolution };
    });
  }

  /** E8-S12 */
  async attendanceSummary(
    actor: AuthUser,
    opts: { from: string; to: string; siteId?: string },
  ) {
    return this.db.withTenant(actor.tenantId, async (client) => {
      const params: unknown[] = [opts.from, opts.to];
      let siteFilter = '';
      if (opts.siteId) {
        params.push(opts.siteId);
        siteFilter = `AND d.site_id = $${params.length}`;
      }
      const rows = await client.query(
        `SELECT w.full_name, s.name AS site_name, d.day, d.status, d.hours, d.source
         FROM day_records d
         JOIN workers w ON w.id = d.worker_id
         LEFT JOIN sites s ON s.id = d.site_id
         WHERE d.day BETWEEN $1::date AND $2::date ${siteFilter}
         ORDER BY w.full_name, d.day`,
        params,
      );
      const items = rows.rows.map((r) => ({
        workerName: r.full_name,
        siteName: r.site_name,
        day: asDate(r.day),
        status: r.status,
        hours: Number(r.hours),
        source: r.source,
      }));
      const totals = {
        rows: items.length,
        present: items.filter((i) => i.status === 'present' || i.status === 'ot_candidate')
          .length,
        halfday: items.filter((i) => i.status === 'halfday').length,
        absent: items.filter((i) => i.status === 'absent').length,
        hours: items.reduce((a, i) => a + i.hours, 0),
      };
      return { items, totals };
    });
  }

  /** E8-S13 */
  async otReport(actor: AuthUser, opts: { from: string; to: string }) {
    return this.db.withTenant(actor.tenantId, async (client) => {
      const days = await client.query(
        `SELECT w.full_name, s.name AS site_name, d.day, d.hours, d.status
         FROM day_records d
         JOIN workers w ON w.id = d.worker_id
         LEFT JOIN sites s ON s.id = d.site_id
         WHERE d.day BETWEEN $1::date AND $2::date
           AND d.status = 'ot_candidate'
         ORDER BY d.day, w.full_name`,
        [opts.from, opts.to],
      );
      const manualOt = await client.query(
        `SELECT w.full_name, o.day, o.delta_hours, o.reason
         FROM payroll_ot_adjustments o
         JOIN workers w ON w.id = o.worker_id
         WHERE o.day BETWEEN $1::date AND $2::date
         ORDER BY o.day`,
        [opts.from, opts.to],
      );
      return {
        photoOt: days.rows.map((r) => ({
          workerName: r.full_name,
          siteName: r.site_name,
          day: asDate(r.day),
          hours: Number(r.hours),
          otHours: Math.max(0, Number(r.hours) - 8),
        })),
        manualOt: manualOt.rows.map((r) => ({
          workerName: r.full_name,
          day: asDate(r.day),
          deltaHours: Number(r.delta_hours),
          reason: r.reason,
          manual: true,
        })),
      };
    });
  }

  /** E8-S14 */
  async exceptionTrends(actor: AuthUser, opts: { from: string; to: string }) {
    return this.db.withTenant(actor.tenantId, async (client) => {
      const byType = await client.query(
        `SELECT type, count(*)::int AS n,
                percentile_cont(0.5) WITHIN GROUP (
                  ORDER BY extract(epoch FROM (resolved_at - created_at))
                ) AS median_resolve_sec
         FROM exceptions
         WHERE created_at::date BETWEEN $1::date AND $2::date
         GROUP BY type
         ORDER BY n DESC`,
        [opts.from, opts.to],
      );
      const byEngineer = await client.query(
        `SELECT u.email, count(*)::int AS n
         FROM exceptions e
         JOIN attendance_sessions sess ON sess.id = e.session_id
         JOIN users u ON u.id = sess.engineer_id
         WHERE e.created_at::date BETWEEN $1::date AND $2::date
         GROUP BY u.email
         ORDER BY n DESC
         LIMIT 20`,
        [opts.from, opts.to],
      );
      return {
        byType: byType.rows.map((r) => ({
          type: r.type,
          count: Number(r.n),
          medianResolveSeconds:
            r.median_resolve_sec === null ? null : Number(r.median_resolve_sec),
        })),
        byEngineer: byEngineer.rows.map((r) => ({
          engineerEmail: r.email,
          count: Number(r.n),
        })),
      };
    });
  }

  /** E8-S15: padding indicator cards (Flow 10). */
  async paddingIndicators(actor: AuthUser) {
    return this.db.withTenant(actor.tenantId, async (client) => {
      const manual = await client.query(
        `SELECT w.id, w.full_name, count(*)::int AS n
         FROM session_tags t
         JOIN workers w ON w.id = t.worker_id
         WHERE t.source = 'manual' AND t.status = 'active'
         GROUP BY w.id, w.full_name
         ORDER BY n DESC LIMIT 10`,
      );
      const geofence = await client.query(
        `SELECT u.email, count(*)::int AS n
         FROM attendance_sessions sess
         JOIN users u ON u.id = sess.engineer_id
         WHERE sess.within_fence = false
         GROUP BY u.email
         ORDER BY n DESC LIMIT 10`,
      );
      const perfect = await client.query(
        `SELECT w.id, w.full_name, count(*)::int AS days
         FROM day_records d
         JOIN workers w ON w.id = d.worker_id
         WHERE d.status IN ('present', 'ot_candidate')
           AND d.day > (current_date - 30)
         GROUP BY w.id, w.full_name
         HAVING count(*) >= 20
         ORDER BY days DESC LIMIT 10`,
      );
      const otByEng = await client.query(
        `SELECT u.email, count(*)::int AS n
         FROM day_records d
         JOIN attendance_sessions sess ON sess.id = ANY(d.session_ids)
         JOIN users u ON u.id = sess.engineer_id
         WHERE d.status = 'ot_candidate'
         GROUP BY u.email
         ORDER BY n DESC LIMIT 10`,
      );
      return {
        mostManuallyTagged: manual.rows.map((r) => ({
          workerId: r.id,
          workerName: r.full_name,
          count: Number(r.n),
        })),
        geofenceFlagsByEngineer: geofence.rows.map((r) => ({
          engineerEmail: r.email,
          count: Number(r.n),
        })),
        perfectAttendanceAnomalies: perfect.rows.map((r) => ({
          workerId: r.id,
          workerName: r.full_name,
          days: Number(r.days),
        })),
        otConcentrationByEngineer: otByEng.rows.map((r) => ({
          engineerEmail: r.email,
          count: Number(r.n),
        })),
      };
    });
  }

  /** E8-S16: evidence pack PDF (photos keys + audit excerpts). */
  async evidencePack(
    actor: AuthUser,
    input: { workerId?: string; engineerId?: string; from?: string; to?: string },
  ) {
    return this.db.withTenant(actor.tenantId, async (client) => {
      const lines: string[] = ['Presente evidence pack', ''];
      if (input.workerId) {
        const w = await client.query(
          `SELECT full_name FROM workers WHERE id = $1`,
          [input.workerId],
        );
        lines.push(`Worker: ${w.rows[0]?.full_name ?? input.workerId}`);
        const photos = await client.query(
          `SELECT sp.storage_key, sess.device_captured_at, s.name AS site
           FROM session_tags t
           JOIN session_photos sp ON sp.id = t.photo_id
           JOIN attendance_sessions sess ON sess.id = t.session_id
           LEFT JOIN sites s ON s.id = sess.site_id
           WHERE t.worker_id = $1 AND t.status = 'active'
           ORDER BY sess.device_captured_at DESC LIMIT 50`,
          [input.workerId],
        );
        lines.push(`Photos (${photos.rowCount}):`);
        for (const p of photos.rows) {
          lines.push(
            `  ${toIso(p.device_captured_at)} ${p.site ?? ''} ${p.storage_key}`,
          );
        }
        const audit = await client.query(
          `SELECT action, reason, ts FROM audit_log
           WHERE entity = $1 OR entity LIKE $2
           ORDER BY ts DESC LIMIT 40`,
          [`worker:${input.workerId}`, `day_record:%`],
        );
        lines.push('Audit:');
        for (const a of audit.rows) {
          lines.push(
            `  ${toIso(a.ts)} ${a.action}${a.reason ? ' — ' + a.reason : ''}`,
          );
        }
      }
      if (input.engineerId) {
        const u = await client.query(`SELECT email FROM users WHERE id = $1`, [
          input.engineerId,
        ]);
        lines.push(`Engineer: ${u.rows[0]?.email ?? input.engineerId}`);
        const sess = await client.query(
          `SELECT id, type, device_captured_at, within_fence, mock_location
           FROM attendance_sessions WHERE engineer_id = $1
           ORDER BY device_captured_at DESC LIMIT 40`,
          [input.engineerId],
        );
        lines.push(`Sessions (${sess.rowCount}):`);
        for (const s of sess.rows) {
          lines.push(
            `  ${toIso(s.device_captured_at)} ${s.type} fence=${s.within_fence} mock=${s.mock_location}`,
          );
        }
      }
      const pdf = toSimplePdf('Evidence pack', lines);
      const hash = createHash('sha256').update(pdf).digest('hex');
      await this.audit.log(client, {
        actor: actor.sub,
        action: 'evidence_pack.export',
        entity: input.workerId
          ? `worker:${input.workerId}`
          : `user:${input.engineerId}`,
        after: { bytes: pdf.length, hash },
      });
      return { body: pdf, hash, filename: `evidence-${hash.slice(0, 8)}.pdf` };
    });
  }

  private async tz(client: { query: (sql: string) => Promise<{ rows: { timezone?: string }[] }> }) {
    const r = await client.query(
      `SELECT timezone FROM company_settings LIMIT 1`,
    );
    return r.rows[0]?.timezone ?? 'Asia/Manila';
  }
}

function toIso(v: Date | string): string {
  if (v instanceof Date) return v.toISOString();
  return new Date(v).toISOString();
}

function asDate(v: Date | string): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}
