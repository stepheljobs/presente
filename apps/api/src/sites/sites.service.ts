import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/roles';
import { DatabaseService } from '../database/database.service';
import { distanceMeters } from './geofence';

export interface SiteInput {
  name: string;
  client?: string;
  address?: string;
  lat: number;
  lng: number;
  radiusM: number;
}

interface SiteRow {
  id: string;
  name: string;
  client: string | null;
  address: string | null;
  lat: number;
  lng: number;
  radius_m: number;
  archived_at: Date | null;
  engineer_ids?: string[];
}

const SITE_SELECT = `
  SELECT s.*, coalesce(
    (SELECT array_agg(se.user_id) FROM site_engineers se WHERE se.site_id = s.id),
    '{}'
  ) AS engineer_ids
  FROM sites s`;

@Injectable()
export class SitesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async create(actor: AuthUser, input: SiteInput) {
    return this.db.withTenant(actor.tenantId, async (client) => {
      const result = await client.query<SiteRow>(
        `INSERT INTO sites (tenant_id, name, client, address, lat, lng, radius_m)
         VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid,
                 $1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [input.name, input.client ?? null, input.address ?? null,
         input.lat, input.lng, input.radiusM],
      );
      await this.audit.log(client, {
        actor: actor.sub,
        action: 'site.create',
        entity: `site:${result.rows[0].id}`,
        after: input,
      });
      return this.toDto(result.rows[0]);
    });
  }

  async update(actor: AuthUser, id: string, input: SiteInput) {
    return this.db.withTenant(actor.tenantId, async (client) => {
      const before = await client.query<SiteRow>(
        'SELECT * FROM sites WHERE id = $1',
        [id],
      );
      if (!before.rows[0]) throw new NotFoundException('Site not found');
      const result = await client.query<SiteRow>(
        `UPDATE sites SET name = $2, client = $3, address = $4,
                lat = $5, lng = $6, radius_m = $7, updated_at = now()
         WHERE id = $1 RETURNING *`,
        [id, input.name, input.client ?? null, input.address ?? null,
         input.lat, input.lng, input.radiusM],
      );
      await this.audit.log(client, {
        actor: actor.sub,
        action: 'site.update',
        entity: `site:${id}`,
        before: this.toDto(before.rows[0]),
        after: input,
      });
      return this.toDto(result.rows[0]);
    });
  }

  /**
   * Admins/owners see everything including archived; engineers see only
   * their assigned, active sites (E2-S03 — capture pickers must never
   * show archived sites, E2-S05).
   */
  async list(actor: AuthUser) {
    return this.db.withTenant(actor.tenantId, async (client) => {
      const engineerFilter =
        actor.role === 'engineer'
          ? `WHERE s.archived_at IS NULL AND EXISTS (
               SELECT 1 FROM site_engineers se
               WHERE se.site_id = s.id AND se.user_id = $1
             )`
          : '';
      const result = await client.query<SiteRow>(
        `${SITE_SELECT} ${engineerFilter} ORDER BY s.name`,
        actor.role === 'engineer' ? [actor.sub] : [],
      );
      return result.rows.map((r) => this.toDto(r));
    });
  }

  /** E2-S06: engineer's assigned active sites sorted by distance. */
  async nearest(actor: AuthUser, point: { lat: number; lng: number }) {
    const sites = await this.list(actor);
    return sites
      .map((s) => ({
        ...s,
        distanceM: Math.round(
          distanceMeters(point, { lat: s.lat, lng: s.lng }),
        ),
      }))
      .sort((a, b) => a.distanceM - b.distanceM);
  }

  /** E2-S03: replace the engineer set for a site. */
  async assignEngineers(actor: AuthUser, siteId: string, userIds: string[]) {
    return this.db.withTenant(actor.tenantId, async (client) => {
      const site = await client.query<SiteRow>(
        'SELECT * FROM sites WHERE id = $1',
        [siteId],
      );
      if (!site.rows[0]) throw new NotFoundException('Site not found');

      const before = await client.query<{ user_id: string }>(
        'SELECT user_id FROM site_engineers WHERE site_id = $1',
        [siteId],
      );
      await client.query('DELETE FROM site_engineers WHERE site_id = $1', [
        siteId,
      ]);
      if (userIds.length > 0) {
        // Role check guards against assigning non-engineers.
        await client.query(
          `INSERT INTO site_engineers (tenant_id, site_id, user_id)
           SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid, $1, u.id
           FROM users u WHERE u.id = ANY($2) AND u.role = 'engineer'`,
          [siteId, userIds],
        );
      }
      const after = await client.query<{ user_id: string }>(
        'SELECT user_id FROM site_engineers WHERE site_id = $1',
        [siteId],
      );
      await this.audit.log(client, {
        actor: actor.sub,
        action: 'site.assign_engineers',
        entity: `site:${siteId}`,
        before: { engineerIds: before.rows.map((r) => r.user_id) },
        after: { engineerIds: after.rows.map((r) => r.user_id) },
      });
      return { engineerIds: after.rows.map((r) => r.user_id) };
    });
  }

  /** E2-S05: archived sites vanish from capture pickers, stay in reports. */
  async setArchived(actor: AuthUser, id: string, archived: boolean) {
    return this.db.withTenant(actor.tenantId, async (client) => {
      const result = await client.query<SiteRow>(
        `UPDATE sites
         SET archived_at = ${archived ? 'now()' : 'NULL'}, updated_at = now()
         WHERE id = $1 RETURNING *`,
        [id],
      );
      if (!result.rows[0]) throw new NotFoundException('Site not found');
      await this.audit.log(client, {
        actor: actor.sub,
        action: archived ? 'site.archive' : 'site.unarchive',
        entity: `site:${id}`,
      });
      return this.toDto(result.rows[0]);
    });
  }

  private toDto(row: SiteRow) {
    return {
      id: row.id,
      name: row.name,
      client: row.client,
      address: row.address,
      lat: row.lat,
      lng: row.lng,
      radiusM: row.radius_m,
      archived: row.archived_at !== null,
      engineerIds: row.engineer_ids ?? [],
    };
  }
}
