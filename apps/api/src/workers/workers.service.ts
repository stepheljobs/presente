import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PoolClient } from 'pg';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/roles';
import { DatabaseService } from '../database/database.service';

export interface WorkerInput {
  fullName: string;
  nickname?: string;
  photoKey?: string;
  position?: string;
  dailyRate?: number;
  phone?: string;
  govId?: string;
  startDate?: string;
  /** E6-S08: consent declined — manual attendance path. */
  noBiometricConsent?: boolean;
}

interface WorkerRow {
  id: string;
  full_name: string;
  nickname: string | null;
  photo_key: string | null;
  position: string | null;
  daily_rate: string | null;
  phone: string | null;
  gov_id: string | null;
  start_date: string | null;
  end_date: string | null;
  status: 'active' | 'pending_approval' | 'deactivated';
  biometric_status: 'none' | 'pending' | 'enrolled';
  no_biometric_consent: boolean;
  retention_until: Date | null;
  site_ids?: string[];
}

@Injectable()
export class WorkersService {
  private readonly encKey: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.encKey = config.getOrThrow<string>('GOV_ID_ENC_KEY');
  }

  /**
   * E3-S01 + E3-S10: admins create active workers; engineer-initiated
   * profiles enter pending_approval and carry no rate (engineers cannot
   * see or set rates — the admin confirms one at approval).
   */
  async create(actor: AuthUser, input: WorkerInput) {
    const engineerInitiated = actor.role === 'engineer';
    return this.db.withTenant(actor.tenantId, async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO workers
           (tenant_id, full_name, nickname, photo_key, position, daily_rate,
            phone, gov_id_enc, start_date, status, created_by, no_biometric_consent)
         VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid,
                 $1, $2, $3, $4, $5, $6,
                 CASE WHEN $7::text IS NULL THEN NULL
                      ELSE pgp_sym_encrypt($7::text, $8, 'cipher-algo=aes256') END,
                 $9, $10, $11, $12)
         RETURNING id`,
        [
          input.fullName,
          input.nickname ?? null,
          input.photoKey ?? null,
          input.position ?? null,
          engineerInitiated ? null : (input.dailyRate ?? null),
          input.phone ?? null,
          input.govId ?? null,
          this.encKey,
          input.startDate ?? null,
          engineerInitiated ? 'pending_approval' : 'active',
          actor.sub,
          input.noBiometricConsent ?? false,
        ],
      );
      const id = result.rows[0].id;
      await this.audit.log(client, {
        actor: actor.sub,
        action: 'worker.create',
        entity: `worker:${id}`,
        after: { fullName: input.fullName, status: engineerInitiated ? 'pending_approval' : 'active' },
      });
      return this.getInTx(client, actor, id);
    });
  }

  async update(actor: AuthUser, id: string, input: WorkerInput) {
    return this.db.withTenant(actor.tenantId, async (client) => {
      const before = await this.fetchRow(client, id, true);
      if (!before) throw new NotFoundException('Worker not found');
      await client.query(
        `UPDATE workers SET
           full_name = $2, nickname = $3, photo_key = $4, position = $5,
           daily_rate = $6, phone = $7,
           gov_id_enc = CASE WHEN $8::text IS NULL THEN gov_id_enc
                        ELSE pgp_sym_encrypt($8::text, $9, 'cipher-algo=aes256') END,
           start_date = $10, updated_at = now()
         WHERE id = $1`,
        [
          id,
          input.fullName,
          input.nickname ?? null,
          input.photoKey ?? null,
          input.position ?? null,
          input.dailyRate ?? null,
          input.phone ?? null,
          input.govId ?? null,
          this.encKey,
          input.startDate ?? null,
        ],
      );
      await this.audit.log(client, {
        actor: actor.sub,
        action: 'worker.update',
        entity: `worker:${id}`,
        before: { fullName: before.full_name, dailyRate: before.daily_rate },
        after: { fullName: input.fullName, dailyRate: input.dailyRate ?? null },
      });
      return this.getInTx(client, actor, id);
    });
  }

  /** Paginated list; roster pages must handle 200+ workers (E2-S04). */
  async list(
    actor: AuthUser,
    opts: { siteId?: string; status?: string; page: number; pageSize: number },
  ) {
    return this.db.withTenant(actor.tenantId, async (client) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (opts.siteId) {
        params.push(opts.siteId);
        conditions.push(
          `EXISTS (SELECT 1 FROM site_workers sw
           WHERE sw.worker_id = w.id AND sw.site_id = $${params.length})`,
        );
      }
      if (opts.status) {
        params.push(opts.status);
        conditions.push(`w.status = $${params.length}`);
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const total = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM workers w ${where}`,
        params,
      );
      params.push(opts.pageSize, (opts.page - 1) * opts.pageSize);
      const rows = await client.query<WorkerRow>(
        `SELECT w.*, NULL AS gov_id, coalesce(
           (SELECT array_agg(sw.site_id) FROM site_workers sw WHERE sw.worker_id = w.id),
           '{}'
         ) AS site_ids
         FROM workers w ${where}
         ORDER BY w.full_name
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return {
        total: total.rows[0].n,
        page: opts.page,
        pageSize: opts.pageSize,
        items: rows.rows.map((r) => this.toDto(r, actor)),
      };
    });
  }

  async get(actor: AuthUser, id: string) {
    return this.db.withTenant(actor.tenantId, (client) =>
      this.getInTx(client, actor, id),
    );
  }

  /** E3-S10: Approve sets/confirms the rate and activates; audited. */
  async approve(actor: AuthUser, id: string, dailyRate: number) {
    return this.db.withTenant(actor.tenantId, async (client) => {
      const result = await client.query(
        `UPDATE workers SET status = 'active', daily_rate = $2, updated_at = now()
         WHERE id = $1 AND status = 'pending_approval'`,
        [id, dailyRate],
      );
      if (!result.rowCount) {
        throw new NotFoundException('No pending worker with that id');
      }
      await this.audit.log(client, {
        actor: actor.sub,
        action: 'worker.approve',
        entity: `worker:${id}`,
        after: { dailyRate },
      });
      return this.getInTx(client, actor, id);
    });
  }

  /** E3-S10: Reject requires a note; audited. */
  async reject(actor: AuthUser, id: string, note: string) {
    return this.db.withTenant(actor.tenantId, async (client) => {
      const result = await client.query(
        `UPDATE workers SET status = 'deactivated', end_date = now()::date,
                updated_at = now()
         WHERE id = $1 AND status = 'pending_approval'`,
        [id],
      );
      if (!result.rowCount) {
        throw new NotFoundException('No pending worker with that id');
      }
      await this.audit.log(client, {
        actor: actor.sub,
        action: 'worker.reject',
        entity: `worker:${id}`,
        reason: note,
      });
      return { rejected: true };
    });
  }

  /**
   * E3-S11: end date set, worker leaves all rosters, biometric retention
   * countdown starts (tenant-configurable months).
   */
  async deactivate(actor: AuthUser, id: string, endDate: string) {
    return this.db.withTenant(actor.tenantId, async (client) => {
      const settings = await client.query<{ biometric_retention_months: number }>(
        `SELECT biometric_retention_months FROM company_settings
         WHERE tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid`,
      );
      const months = settings.rows[0]?.biometric_retention_months ?? 12;
      const result = await client.query(
        `UPDATE workers SET status = 'deactivated', end_date = $2,
                retention_until = $2::date + make_interval(months => $3),
                updated_at = now()
         WHERE id = $1 AND status <> 'deactivated'`,
        [id, endDate, months],
      );
      if (!result.rowCount) {
        throw new NotFoundException('No active worker with that id');
      }
      await client.query('DELETE FROM site_workers WHERE worker_id = $1', [id]);
      await this.audit.log(client, {
        actor: actor.sub,
        action: 'worker.deactivate',
        entity: `worker:${id}`,
        after: { endDate, retentionMonths: months },
      });
      return this.getInTx(client, actor, id);
    });
  }

  /** E2-S04: roster membership, audited both directions. */
  async addToSite(actor: AuthUser, siteId: string, workerId: string) {
    await this.db.withTenant(actor.tenantId, async (client) => {
      await client.query(
        `INSERT INTO site_workers (tenant_id, site_id, worker_id)
         VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid, $1, $2)
         ON CONFLICT DO NOTHING`,
        [siteId, workerId],
      );
      await this.audit.log(client, {
        actor: actor.sub,
        action: 'roster.add',
        entity: `site:${siteId}`,
        after: { workerId },
      });
    });
    return { added: true };
  }

  async removeFromSite(actor: AuthUser, siteId: string, workerId: string) {
    await this.db.withTenant(actor.tenantId, async (client) => {
      await client.query(
        'DELETE FROM site_workers WHERE site_id = $1 AND worker_id = $2',
        [siteId, workerId],
      );
      await this.audit.log(client, {
        actor: actor.sub,
        action: 'roster.remove',
        entity: `site:${siteId}`,
        after: { workerId },
      });
    });
    return { removed: true };
  }

  private async getInTx(client: PoolClient, actor: AuthUser, id: string) {
    const row = await this.fetchRow(client, id, actor.role !== 'engineer');
    if (!row) throw new NotFoundException('Worker not found');
    return this.toDto(row, actor);
  }

  private async fetchRow(
    client: PoolClient,
    id: string,
    decryptGovId: boolean,
  ): Promise<WorkerRow | undefined> {
    const result = await client.query<WorkerRow>(
      `SELECT w.*,
         ${decryptGovId ? `CASE WHEN w.gov_id_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(w.gov_id_enc, $2) END` : 'NULL'} AS gov_id,
         coalesce(
           (SELECT array_agg(sw.site_id) FROM site_workers sw WHERE sw.worker_id = w.id),
           '{}'
         ) AS site_ids
       FROM workers w WHERE w.id = $1`,
      decryptGovId ? [id, this.encKey] : [id],
    );
    return result.rows[0];
  }

  /** Rate and gov ID are omitted entirely from engineer responses (NFR-5). */
  private toDto(row: WorkerRow, actor: AuthUser) {
    const base = {
      id: row.id,
      fullName: row.full_name,
      nickname: row.nickname,
      photoKey: row.photo_key,
      position: row.position,
      phone: row.phone,
      startDate: row.start_date,
      endDate: row.end_date,
      status: row.status,
      biometricStatus: row.biometric_status,
      noBiometricConsent: Boolean(row.no_biometric_consent),
      siteIds: row.site_ids ?? [],
      retentionUntil: row.retention_until?.toISOString() ?? null,
    };
    if (actor.role === 'engineer') return base;
    return {
      ...base,
      dailyRate: row.daily_rate === null ? null : Number(row.daily_rate),
      govId: row.gov_id ?? null,
    };
  }
}

export function parseEndDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException('endDate must be YYYY-MM-DD');
  }
  return value;
}
