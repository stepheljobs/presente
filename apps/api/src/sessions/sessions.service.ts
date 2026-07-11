import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/roles';
import { DatabaseService } from '../database/database.service';
import { evaluateGeofence } from '../sites/geofence';
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
  lat: number | null;
  lng: number | null;
  gps_status: string;
  distance_m: number | null;
  within_fence: boolean | null;
  mock_location: boolean;
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
      // E4-S05: the client evaluates the geofence against its cached site;
      // the server recomputes from the authoritative site record whenever
      // a fix and site are present.
      let distanceM: number | null = null;
      let withinFence: boolean | null = null;
      const hasFix =
        dto.gpsStatus === 'fix' &&
        dto.lat !== undefined &&
        dto.lng !== undefined;
      if (hasFix && dto.siteId) {
        const site = await client.query<{
          lat: number;
          lng: number;
          radius_m: number;
        }>('SELECT lat, lng, radius_m FROM sites WHERE id = $1', [dto.siteId]);
        if (site.rowCount) {
          const result = evaluateGeofence(
            { lat: dto.lat!, lng: dto.lng! },
            {
              lat: site.rows[0].lat,
              lng: site.rows[0].lng,
              radiusM: site.rows[0].radius_m,
            },
          );
          distanceM = Math.round(result.distanceM);
          withinFence = result.withinFence;
        }
      }

      const inserted = await client.query<SessionRow>(
        `INSERT INTO attendance_sessions
           (id, tenant_id, type, site_id, engineer_id, device_id, payload,
            device_captured_at, device_sent_at, clock_drift_seconds,
            lat, lng, gps_status, distance_m, within_fence, mock_location)
         VALUES ($1, NULLIF(current_setting('app.tenant_id', true), '')::uuid,
                 $2, $3, $4, $5, $6, $7, $8,
                 EXTRACT(EPOCH FROM (now() - $8::timestamptz))::int,
                 $9, $10, $11, $12, $13, $14)
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
          dto.lat ?? null,
          dto.lng ?? null,
          dto.gpsStatus ?? 'no_fix',
          distanceM,
          withinFence,
          dto.mockLocation ?? false,
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
        // FR-17/FR-18: flags never block capture; they feed the admin queue.
        if (withinFence === false) {
          await client.query(
            `INSERT INTO exceptions
               (tenant_id, type, severity, session_id, site_id, note)
             VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid,
                     'geofence', 3, $1, $2, $3)`,
            [
              uuid,
              dto.siteId ?? null,
              distanceM === null
                ? 'Outside geofence'
                : `${distanceM} m from site`,
            ],
          );
        }
        if (dto.mockLocation) {
          await client.query(
            `INSERT INTO exceptions
               (tenant_id, type, severity, session_id, site_id, note)
             VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid,
                     'mock_location', 2, $1, $2, 'Mock location detected')`,
            [uuid, dto.siteId ?? null],
          );
        }
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
      lat: row.lat,
      lng: row.lng,
      gpsStatus: row.gps_status,
      distanceM: row.distance_m,
      withinFence: row.within_fence,
      mockLocation: row.mock_location,
    };
  }
}
