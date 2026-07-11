import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/roles';
import { DatabaseService } from '../database/database.service';
import { IngestSessionDto } from './sessions.controller';

interface SessionRow {
  id: string;
  type: string;
  site_id: string | null;
  engineer_id: string;
  device_id: string;
  payload: Record<string, unknown>;
  device_captured_at: Date;
  device_sent_at: Date;
  server_received_at: Date;
  clock_drift_seconds: number;
}

@Injectable()
export class SessionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Idempotent upsert keyed on the client-generated session UUID (E0-S06).
   * First call inserts and stamps server receive-time + clock drift
   * (E0-S10); identical retries change nothing and return the stored row.
   */
  async ingest(uuid: string, dto: IngestSessionDto, user: AuthUser) {
    return this.db.withTenant(user.tenantId, async (client) => {
      const inserted = await client.query<SessionRow>(
        `INSERT INTO attendance_sessions
           (id, tenant_id, type, site_id, engineer_id, device_id, payload,
            device_captured_at, device_sent_at, clock_drift_seconds)
         VALUES ($1, NULLIF(current_setting('app.tenant_id', true), '')::uuid,
                 $2, $3, $4, $5, $6, $7, $8,
                 EXTRACT(EPOCH FROM (now() - $8::timestamptz))::int)
         ON CONFLICT (id) DO NOTHING
         RETURNING *`,
        [
          uuid,
          dto.type,
          dto.siteId ?? null,
          user.sub,
          dto.deviceId,
          JSON.stringify(dto.payload ?? {}),
          dto.deviceCapturedAt,
          dto.deviceSentAt,
        ],
      );

      let row = inserted.rows[0];
      if (row) {
        await this.audit.log(client, {
          actor: user.sub,
          action: 'session.ingest',
          entity: `attendance_session:${uuid}`,
          after: { type: dto.type, siteId: dto.siteId ?? null },
        });
      } else {
        const existing = await client.query<SessionRow>(
          'SELECT * FROM attendance_sessions WHERE id = $1',
          [uuid],
        );
        row = existing.rows[0];
      }
      return this.toDto(row);
    });
  }

  private toDto(row: SessionRow) {
    return {
      id: row.id,
      type: row.type,
      siteId: row.site_id,
      engineerId: row.engineer_id,
      deviceId: row.device_id,
      payload: row.payload,
      deviceCapturedAt: row.device_captured_at.toISOString(),
      deviceSentAt: row.device_sent_at.toISOString(),
      serverReceivedAt: row.server_received_at.toISOString(),
      clockDriftSeconds: row.clock_drift_seconds,
    };
  }
}
