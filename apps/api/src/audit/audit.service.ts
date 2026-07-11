import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface AuditEntry {
  actor: string | null;
  action: string;
  entity: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
}

/**
 * Writes to the append-only audit_log (NFR-6). Must be called with the
 * client of an open tenant transaction (DatabaseService.withTenant) so the
 * entry commits or rolls back atomically with the mutation it records —
 * tenant_id comes from the transaction's RLS context.
 */
@Injectable()
export class AuditService {
  async log(client: PoolClient, entry: AuditEntry): Promise<void> {
    await client.query(
      `INSERT INTO audit_log (tenant_id, actor, action, entity, before, after, reason)
       VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid, $1, $2, $3, $4, $5, $6)`,
      [
        entry.actor,
        entry.action,
        entry.entity,
        entry.before === undefined ? null : JSON.stringify(entry.before),
        entry.after === undefined ? null : JSON.stringify(entry.after),
        entry.reason ?? null,
      ],
    );
  }
}
