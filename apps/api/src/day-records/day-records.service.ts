import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/roles';
import { DatabaseService } from '../database/database.service';

export type DayStatus = 'present' | 'halfday' | 'absent' | 'ot_candidate';
export type DaySource = 'photo' | 'manual' | 'corrected' | 'no_biometric';

interface SettingsRow {
  standard_workday_hours: string;
  halfday_rule: 'hours_threshold' | 'cutoff_time';
  halfday_threshold_hours: string;
  halfday_cutoff_time: string;
  timezone: string;
}

interface DayRow {
  id: string;
  worker_id: string;
  site_id: string | null;
  day: Date;
  time_in: Date | null;
  time_out: Date | null;
  hours: string;
  status: DayStatus;
  source: DaySource;
  no_biometric_consent: boolean;
  session_ids: string[];
  photo_ids: string[];
  within_fence: boolean | null;
  mock_location: boolean | null;
  geofence_distance_m: number | null;
  admin_note: string | null;
  full_name?: string;
  site_name?: string;
}

/**
 * E6-S01: pure recompute of worker-day records from photo-verified tags.
 * Idempotent — safe after every late-arriving session (FR-23).
 */
@Injectable()
export class DayRecordsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async recomputeDay(tenantId: string, day: string): Promise<number> {
    return this.db.withTenant(tenantId, async (client) => {
      const settings = await this.loadSettings(client);
      const tz = settings.timezone || 'Asia/Manila';

      const agg = await client.query<{
        worker_id: string;
        site_id: string | null;
        time_in: Date | null;
        time_out: Date | null;
        session_ids: string[];
        photo_ids: string[];
        within_fence: boolean | null;
        mock_location: boolean | null;
        geofence_distance_m: number | null;
        has_manual: boolean;
        no_biometric: boolean;
      }>(
        `WITH scoped AS (
           SELECT t.worker_id, s.site_id, s.id AS session_id, s.type,
                  s.device_captured_at, s.within_fence, s.mock_location,
                  s.distance_m, t.photo_id, t.source,
                  w.no_biometric_consent
           FROM session_tags t
           JOIN attendance_sessions s ON s.id = t.session_id
           JOIN workers w ON w.id = t.worker_id
           WHERE t.status = 'active' AND t.worker_id IS NOT NULL
             AND (s.device_captured_at AT TIME ZONE $2)::date = $1::date
         )
         SELECT worker_id, site_id,
                min(device_captured_at) FILTER (WHERE type = 'time_in') AS time_in,
                max(device_captured_at) FILTER (WHERE type = 'time_out') AS time_out,
                array_agg(DISTINCT session_id) AS session_ids,
                coalesce(
                  array_agg(DISTINCT photo_id) FILTER (WHERE photo_id IS NOT NULL),
                  '{}'
                ) AS photo_ids,
                bool_and(within_fence) AS within_fence,
                bool_or(mock_location) AS mock_location,
                max(distance_m) AS geofence_distance_m,
                bool_or(source = 'manual') AS has_manual,
                bool_or(no_biometric_consent) AS no_biometric
         FROM scoped
         GROUP BY worker_id, site_id`,
        [day, tz],
      );

      let written = 0;
      for (const row of agg.rows) {
        const existing = await client.query<{ source: string; id: string }>(
          `SELECT id, source FROM day_records
           WHERE worker_id = $1 AND day = $2::date
             AND site_id IS NOT DISTINCT FROM $3::uuid`,
          [row.worker_id, day, row.site_id],
        );

        // Admin-edited / corrected: only refresh photo linkage (E5-S05 / E6-S04).
        if (
          existing.rows[0]?.source === 'corrected' ||
          (await this.isAdminLocked(client, row.worker_id, row.site_id, day))
        ) {
          if (existing.rowCount) {
            await client.query(
              `UPDATE day_records SET session_ids = $2, photo_ids = $3, updated_at = now()
               WHERE id = $1`,
              [existing.rows[0].id, row.session_ids, row.photo_ids],
            );
          }
          continue;
        }

        const hours = computeHours(row.time_in, row.time_out);
        const status = classifyStatus(hours, row.time_in, row.time_out, settings);
        let source: DaySource = 'photo';
        if (row.no_biometric) source = 'no_biometric';
        else if (row.has_manual) source = 'manual';

        await client.query(
          `INSERT INTO day_records
             (tenant_id, worker_id, site_id, day, time_in, time_out, hours,
              status, source, no_biometric_consent, session_ids, photo_ids,
              within_fence, mock_location, geofence_distance_m, updated_at)
           VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid,
                   $1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())
           ON CONFLICT (tenant_id, worker_id, day, site_id) DO UPDATE SET
             time_in = excluded.time_in,
             time_out = excluded.time_out,
             hours = excluded.hours,
             status = excluded.status,
             source = excluded.source,
             no_biometric_consent = excluded.no_biometric_consent,
             session_ids = excluded.session_ids,
             photo_ids = excluded.photo_ids,
             within_fence = excluded.within_fence,
             mock_location = excluded.mock_location,
             geofence_distance_m = excluded.geofence_distance_m,
             updated_at = now()`,
          [
            row.worker_id,
            row.site_id,
            day,
            row.time_in,
            row.time_out,
            hours,
            status,
            source,
            row.no_biometric,
            row.session_ids,
            row.photo_ids,
            row.within_fence,
            row.mock_location,
            row.geofence_distance_m,
          ],
        );
        written++;
      }

      // E6-S02: multi-site same worker+day → transfer visibility exception.
      const multi = await client.query<{ worker_id: string }>(
        `SELECT worker_id FROM day_records
         WHERE day = $1::date AND site_id IS NOT NULL
         GROUP BY worker_id HAVING count(*) > 1`,
        [day],
      );
      for (const t of multi.rows) {
        const exists = await client.query(
          `SELECT 1 FROM exceptions
           WHERE type = 'site_transfer' AND worker_id = $1 AND day = $2::date
           LIMIT 1`,
          [t.worker_id, day],
        );
        if (!exists.rowCount) {
          await client.query(
            `INSERT INTO exceptions
               (tenant_id, type, severity, worker_id, day, note)
             VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid,
                     'site_transfer', 4, $1, $2::date,
                     'Worker present at multiple sites this day')`,
            [t.worker_id, day],
          );
        }
      }

      return written;
    });
  }

  private async isAdminLocked(
    client: PoolClient,
    workerId: string,
    siteId: string | null,
    day: string,
  ): Promise<boolean> {
    if (!siteId) return false;
    const r = await client.query(
      `SELECT 1 FROM worker_day_admin_edits
       WHERE worker_id = $1 AND site_id = $2 AND day = $3::date`,
      [workerId, siteId, day],
    );
    return (r.rowCount ?? 0) > 0;
  }

  private async loadSettings(client: PoolClient): Promise<SettingsRow> {
    const r = await client.query<SettingsRow>(
      `SELECT standard_workday_hours, halfday_rule, halfday_threshold_hours,
              halfday_cutoff_time::text, timezone
       FROM company_settings LIMIT 1`,
    );
    return (
      r.rows[0] ?? {
        standard_workday_hours: '8',
        halfday_rule: 'hours_threshold',
        halfday_threshold_hours: '4',
        halfday_cutoff_time: '12:00:00',
        timezone: 'Asia/Manila',
      }
    );
  }

  async list(
    actor: AuthUser,
    opts: { day?: string; workerId?: string; siteId?: string },
  ) {
    return this.db.withTenant(actor.tenantId, async (client) => {
      const params: unknown[] = [];
      const filters: string[] = [];
      if (opts.day) {
        params.push(opts.day);
        filters.push(`d.day = $${params.length}::date`);
      }
      if (opts.workerId) {
        params.push(opts.workerId);
        filters.push(`d.worker_id = $${params.length}`);
      }
      if (opts.siteId) {
        params.push(opts.siteId);
        filters.push(`d.site_id = $${params.length}`);
      }
      if (actor.role === 'engineer') {
        params.push(actor.sub);
        filters.push(`EXISTS (
          SELECT 1 FROM site_engineers se
          WHERE se.site_id = d.site_id AND se.user_id = $${params.length}
        )`);
      }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
      const rows = await client.query<DayRow>(
        `SELECT d.*, w.full_name, s.name AS site_name
         FROM day_records d
         JOIN workers w ON w.id = d.worker_id
         LEFT JOIN sites s ON s.id = d.site_id
         ${where}
         ORDER BY d.day DESC, w.full_name
         LIMIT 500`,
        params,
      );
      return rows.rows.map((r) => this.toDto(r));
    });
  }

  async get(actor: AuthUser, id: string) {
    return this.db.withTenant(actor.tenantId, async (client) => {
      const rows = await client.query<DayRow>(
        `SELECT d.*, w.full_name, s.name AS site_name
         FROM day_records d
         JOIN workers w ON w.id = d.worker_id
         LEFT JOIN sites s ON s.id = d.site_id
         WHERE d.id = $1`,
        [id],
      );
      if (!rows.rowCount) throw new NotFoundException('Day record not found');
      const dto = this.toDto(rows.rows[0]);

      const photos = await client.query(
        `SELECT sp.id, sp.storage_key, sp.recognition_status, sp.session_id
         FROM session_photos sp
         WHERE sp.id = ANY($1::uuid[]) OR sp.session_id = ANY($2::uuid[])
         ORDER BY sp.created_at`,
        [rows.rows[0].photo_ids ?? [], rows.rows[0].session_ids ?? []],
      );
      const audit = await client.query(
        `SELECT actor, action, entity, before, after, reason, ts
         FROM audit_log
         WHERE entity = $1 OR (entity = $2 AND action LIKE 'day_record%')
         ORDER BY ts DESC LIMIT 50`,
        [`day_record:${id}`, `worker:${rows.rows[0].worker_id}`],
      );
      return {
        ...dto,
        photos: photos.rows.map((p) => ({
          id: p.id,
          storageKey: p.storage_key,
          recognitionStatus: p.recognition_status,
          sessionId: p.session_id,
        })),
        audit: audit.rows.map((a) => ({
          actor: a.actor,
          action: a.action,
          entity: a.entity,
          before: a.before,
          after: a.after,
          reason: a.reason,
          createdAt: a.ts.toISOString(),
        })),
      };
    });
  }

  /** E6-S04: admin edit with mandatory reason; locks the day against engineer overwrite. */
  async adminEdit(
    actor: AuthUser,
    id: string,
    input: {
      timeIn?: string | null;
      timeOut?: string | null;
      status?: DayStatus;
      reason: string;
    },
  ) {
    if (!input.reason?.trim() || input.reason.trim().length < 3) {
      throw new BadRequestException('A reason note is required');
    }
    if (actor.role === 'engineer') {
      throw new BadRequestException('Engineers cannot edit day records');
    }
    return this.db.withTenant(actor.tenantId, async (client) => {
      const before = await client.query<DayRow>(
        'SELECT * FROM day_records WHERE id = $1',
        [id],
      );
      if (!before.rowCount) throw new NotFoundException('Day record not found');
      const b = before.rows[0];

      const timeIn =
        input.timeIn !== undefined
          ? input.timeIn
            ? new Date(input.timeIn)
            : null
          : b.time_in;
      const timeOut =
        input.timeOut !== undefined
          ? input.timeOut
            ? new Date(input.timeOut)
            : null
          : b.time_out;
      const hours = computeHours(timeIn, timeOut);
      const status = input.status ?? b.status;

      const updated = await client.query<DayRow>(
        `UPDATE day_records SET
           time_in = $2, time_out = $3, hours = $4, status = $5,
           source = 'corrected', admin_note = $6, updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [id, timeIn, timeOut, hours, status, input.reason.trim()],
      );

      if (b.site_id) {
        await client.query(
          `INSERT INTO worker_day_admin_edits
             (tenant_id, worker_id, site_id, day, edited_by, reason, before, after)
           VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid,
                   $1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (tenant_id, worker_id, day, site_id) DO UPDATE SET
             edited_by = excluded.edited_by,
             edited_at = now(),
             reason = excluded.reason,
             before = excluded.before,
             after = excluded.after`,
          [
            b.worker_id,
            b.site_id,
            b.day,
            actor.sub,
            input.reason.trim(),
            JSON.stringify(this.toDto(b)),
            JSON.stringify(this.toDto(updated.rows[0])),
          ],
        );
      }

      await this.audit.log(client, {
        actor: actor.sub,
        action: 'day_record.admin_edit',
        entity: `day_record:${id}`,
        before: this.toDto(b),
        after: this.toDto(updated.rows[0]),
        reason: input.reason.trim(),
      });
      return this.toDto(updated.rows[0]);
    });
  }

  /** E6-S08: mark present for no-biometric workers (manual attendance). */
  async markManualPresent(
    actor: AuthUser,
    input: {
      workerId: string;
      siteId: string;
      day: string;
      timeIn?: string;
      note?: string;
    },
  ) {
    return this.db.withTenant(actor.tenantId, async (client) => {
      const worker = await client.query<{
        no_biometric_consent: boolean;
      }>('SELECT no_biometric_consent FROM workers WHERE id = $1', [
        input.workerId,
      ]);
      if (!worker.rowCount) throw new NotFoundException('Worker not found');
      if (!worker.rows[0].no_biometric_consent) {
        throw new BadRequestException(
          'Worker is not on the manual-attendance (no biometric) path',
        );
      }
      const timeIn = input.timeIn ? new Date(input.timeIn) : new Date();
      const settings = await this.loadSettings(client);
      const hours = Number(settings.standard_workday_hours);
      const timeOut = new Date(timeIn.getTime() + hours * 3600_000);

      const result = await client.query<DayRow>(
        `INSERT INTO day_records
           (tenant_id, worker_id, site_id, day, time_in, time_out, hours,
            status, source, no_biometric_consent, admin_note, updated_at)
         VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid,
                 $1, $2, $3::date, $4, $5, $6, 'present', 'no_biometric', true, $7, now())
         ON CONFLICT (tenant_id, worker_id, day, site_id) DO UPDATE SET
           time_in = excluded.time_in,
           time_out = excluded.time_out,
           hours = excluded.hours,
           status = 'present',
           source = 'no_biometric',
           no_biometric_consent = true,
           admin_note = excluded.admin_note,
           updated_at = now()
         RETURNING *`,
        [
          input.workerId,
          input.siteId,
          input.day,
          timeIn,
          timeOut,
          hours,
          input.note ?? 'Manual attendance (no biometric consent)',
        ],
      );

      const exists = await client.query(
        `SELECT 1 FROM exceptions
         WHERE type = 'no_biometric_consent' AND worker_id = $1 AND day = $2::date
         LIMIT 1`,
        [input.workerId, input.day],
      );
      if (!exists.rowCount) {
        await client.query(
          `INSERT INTO exceptions
             (tenant_id, type, severity, worker_id, site_id, day, note)
           VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid,
                   'no_biometric_consent', 4, $1, $2, $3::date,
                   'Manual attendance — no biometric consent')`,
          [input.workerId, input.siteId, input.day],
        );
      }

      await this.audit.log(client, {
        actor: actor.sub,
        action: 'day_record.manual_present',
        entity: `day_record:${result.rows[0].id}`,
        after: this.toDto(result.rows[0]),
      });
      return this.toDto(result.rows[0]);
    });
  }

  toDto(row: DayRow) {
    return {
      id: row.id,
      workerId: row.worker_id,
      workerName: row.full_name ?? null,
      siteId: row.site_id,
      siteName: row.site_name ?? null,
      day:
        row.day instanceof Date
          ? row.day.toISOString().slice(0, 10)
          : String(row.day).slice(0, 10),
      timeIn: row.time_in ? row.time_in.toISOString() : null,
      timeOut: row.time_out ? row.time_out.toISOString() : null,
      hours: Number(row.hours),
      status: row.status,
      source: row.source,
      noBiometricConsent: row.no_biometric_consent,
      sessionIds: row.session_ids ?? [],
      photoIds: row.photo_ids ?? [],
      withinFence: row.within_fence,
      mockLocation: row.mock_location,
      geofenceDistanceM: row.geofence_distance_m,
      adminNote: row.admin_note,
    };
  }
}

export function computeHours(
  timeIn: Date | null,
  timeOut: Date | null,
): number {
  if (!timeIn || !timeOut) return 0;
  const ms = timeOut.getTime() - timeIn.getTime();
  if (ms <= 0) return 0;
  return Math.round((ms / 3_600_000) * 100) / 100;
}

export function classifyStatus(
  hours: number,
  timeIn: Date | null,
  timeOut: Date | null,
  settings: SettingsRow,
): DayStatus {
  if (!timeIn && !timeOut) return 'absent';
  if (timeIn && !timeOut) return 'halfday';
  const standard = Number(settings.standard_workday_hours);
  const halfThresh = Number(settings.halfday_threshold_hours);
  if (settings.halfday_rule === 'hours_threshold') {
    if (hours <= 0) return 'absent';
    if (hours < halfThresh) return 'halfday';
    if (hours > standard) return 'ot_candidate';
    return 'present';
  }
  if (timeOut) {
    const cutoff = settings.halfday_cutoff_time.slice(0, 5);
    const outHM = timeOut.toISOString().slice(11, 16);
    if (outHM < cutoff && hours < standard) return 'halfday';
  }
  if (hours > standard) return 'ot_candidate';
  if (hours > 0) return 'present';
  return 'absent';
}
