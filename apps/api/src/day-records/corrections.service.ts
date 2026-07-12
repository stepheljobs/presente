import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/roles';
import { DatabaseService } from '../database/database.service';
import { DayRecordsService, type DayStatus } from './day-records.service';

@Injectable()
export class CorrectionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly days: DayRecordsService,
  ) {}

  /** E6-S05: engineer submits a correction request (works offline → sync later). */
  async create(
    actor: AuthUser,
    input: {
      dayRecordId?: string;
      workerId: string;
      siteId?: string;
      day: string;
      proposed: {
        timeIn?: string | null;
        timeOut?: string | null;
        status?: DayStatus;
      };
      reason: string;
      photoKey?: string;
    },
  ) {
    if (!input.reason?.trim()) {
      throw new BadRequestException('Reason is required');
    }
    return this.db.withTenant(actor.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO correction_requests
           (tenant_id, day_record_id, worker_id, site_id, day, engineer_id,
            proposed, reason, photo_key)
         VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid,
                 $1, $2, $3, $4::date, $5, $6, $7, $8)
         RETURNING *`,
        [
          input.dayRecordId ?? null,
          input.workerId,
          input.siteId ?? null,
          input.day,
          actor.sub,
          JSON.stringify(input.proposed),
          input.reason.trim(),
          input.photoKey ?? null,
        ],
      );
      const row = result.rows[0];
      await client.query(
        `INSERT INTO exceptions
           (tenant_id, type, severity, worker_id, site_id, day, session_id, note)
         VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid,
                 'correction_request', 3, $1, $2, $3::date, NULL, $4)`,
        [
          input.workerId,
          input.siteId ?? null,
          input.day,
          `Correction request ${row.id}: ${input.reason.trim()}`,
        ],
      );
      await this.audit.log(client, {
        actor: actor.sub,
        action: 'correction.submit',
        entity: `correction:${row.id}`,
        after: input.proposed,
        reason: input.reason.trim(),
      });
      return this.toDto(row);
    });
  }

  async list(
    actor: AuthUser,
    opts: { status?: string } = {},
  ) {
    return this.db.withTenant(actor.tenantId, async (client) => {
      const status = opts.status ?? 'submitted';
      const params: unknown[] = [status];
      let filter = 'WHERE c.status = $1';
      if (actor.role === 'engineer') {
        params.push(actor.sub);
        filter += ` AND c.engineer_id = $${params.length}`;
      }
      const rows = await client.query(
        `SELECT c.*, w.full_name AS worker_name, s.name AS site_name
         FROM correction_requests c
         JOIN workers w ON w.id = c.worker_id
         LEFT JOIN sites s ON s.id = c.site_id
         ${filter}
         ORDER BY c.created_at DESC LIMIT 200`,
        params,
      );
      return rows.rows.map((r) => this.toDto(r));
    });
  }

  /** E6-S06: approve applies E6-S04 path; reject requires note. */
  async review(
    actor: AuthUser,
    id: string,
    input: { decision: 'approved' | 'rejected'; note?: string },
  ) {
    if (actor.role === 'engineer') {
      throw new BadRequestException('Only admins can review corrections');
    }
    if (input.decision === 'rejected' && !input.note?.trim()) {
      throw new BadRequestException('Reject requires a note');
    }

    const request = await this.db.withTenant(actor.tenantId, async (client) => {
      const rows = await client.query(
        `SELECT * FROM correction_requests WHERE id = $1 AND status = 'submitted'`,
        [id],
      );
      if (!rows.rowCount) {
        throw new NotFoundException('No open correction request with that id');
      }
      return rows.rows[0];
    });

    if (input.decision === 'approved') {
      let dayRecordId = request.day_record_id as string | null;
      if (!dayRecordId) {
        // Resolve by worker/day/site if not linked.
        const found = await this.db.withTenant(actor.tenantId, (client) =>
          client.query(
            `SELECT id FROM day_records
             WHERE worker_id = $1 AND day = $2
               AND site_id IS NOT DISTINCT FROM $3
             LIMIT 1`,
            [request.worker_id, request.day, request.site_id],
          ),
        );
        dayRecordId = found.rows[0]?.id ?? null;
      }
      if (!dayRecordId) {
        throw new BadRequestException(
          'No day record to apply this correction to — recompute first',
        );
      }
      const proposed = request.proposed as {
        timeIn?: string | null;
        timeOut?: string | null;
        status?: DayStatus;
      };
      await this.days.adminEdit(actor, dayRecordId, {
        timeIn: proposed.timeIn,
        timeOut: proposed.timeOut,
        status: proposed.status,
        reason: `Approved correction: ${request.reason}`,
      });
    }

    return this.db.withTenant(actor.tenantId, async (client) => {
      await client.query(
        `UPDATE correction_requests SET
           status = $2, review_note = $3, reviewed_by = $4, reviewed_at = now()
         WHERE id = $1`,
        [id, input.decision, input.note?.trim() ?? null, actor.sub],
      );
      await this.audit.log(client, {
        actor: actor.sub,
        action: `correction.${input.decision}`,
        entity: `correction:${id}`,
        reason: input.note?.trim() ?? request.reason,
      });
      // Resolve matching exception queue items.
      await client.query(
        `UPDATE exceptions SET status = 'resolved', resolved_by = $2, resolved_at = now(),
                note = coalesce(note, '') || ' · ' || $3
         WHERE type = 'correction_request' AND worker_id = $1 AND day = $4
           AND status = 'open'`,
        [
          request.worker_id,
          actor.sub,
          input.decision,
          request.day,
        ],
      );
      const updated = await client.query(
        'SELECT * FROM correction_requests WHERE id = $1',
        [id],
      );
      return this.toDto(updated.rows[0]);
    });
  }

  private toDto(row: {
    id: string;
    day_record_id: string | null;
    worker_id: string;
    site_id: string | null;
    day: Date | string;
    engineer_id: string;
    proposed: unknown;
    reason: string;
    photo_key: string | null;
    status: string;
    review_note: string | null;
    reviewed_by: string | null;
    reviewed_at: Date | null;
    created_at: Date;
    worker_name?: string;
    site_name?: string;
  }) {
    return {
      id: row.id,
      dayRecordId: row.day_record_id,
      workerId: row.worker_id,
      workerName: row.worker_name ?? null,
      siteId: row.site_id,
      siteName: row.site_name ?? null,
      day:
        row.day instanceof Date
          ? row.day.toISOString().slice(0, 10)
          : String(row.day).slice(0, 10),
      engineerId: row.engineer_id,
      proposed: row.proposed,
      reason: row.reason,
      photoKey: row.photo_key,
      status: row.status,
      reviewNote: row.review_note,
      reviewedBy: row.reviewed_by,
      reviewedAt: row.reviewed_at ? row.reviewed_at.toISOString() : null,
      createdAt: row.created_at.toISOString(),
    };
  }
}
