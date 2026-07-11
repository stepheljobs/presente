import {
  Body,
  Controller,
  Get,
  HttpCode,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { IsIn, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, Roles } from '../auth/decorators';
import type { AuthUser } from '../auth/roles';
import { DatabaseService } from '../database/database.service';
import { CaptureService } from './capture.service';

class ResolveDto {
  @IsIn(['resolved', 'waived'])
  status!: 'resolved' | 'waived';

  @IsString()
  @MinLength(3)
  note!: string;
}

class LookalikeDto {
  @IsUUID()
  workerAId!: string;

  @IsUUID()
  workerBId!: string;
}

/** E8-S04 (pulled forward for E4-S19): typed queue + audited resolution. */
@Controller('exceptions')
export class ExceptionsController {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  @Roles('owner', 'admin')
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('status') status = 'open',
    @Query('type') type?: string,
  ) {
    return this.db.withTenant(user.tenantId, async (client) => {
      const params: unknown[] = [status];
      let filter = 'WHERE e.status = $1';
      if (type) {
        params.push(type);
        filter += ` AND e.type = $${params.length}`;
      }
      const rows = await client.query(
        `SELECT e.*, w.full_name AS worker_name, s.name AS site_name
         FROM exceptions e
         LEFT JOIN workers w ON w.id = e.worker_id
         LEFT JOIN sites s ON s.id = e.site_id
         ${filter}
         ORDER BY e.severity, e.created_at DESC LIMIT 500`,
        params,
      );
      return rows.rows.map((e) => ({
        id: e.id,
        type: e.type,
        severity: e.severity,
        workerId: e.worker_id,
        workerName: e.worker_name,
        sessionId: e.session_id,
        siteId: e.site_id,
        siteName: e.site_name,
        day: e.day,
        note: e.note,
        status: e.status,
        createdAt: e.created_at.toISOString(),
      }));
    });
  }

  @Roles('owner', 'admin')
  @Post(':id/resolve')
  @HttpCode(200)
  resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.db.withTenant(user.tenantId, async (client) => {
      const result = await client.query(
        `UPDATE exceptions SET status = $2, note = coalesce($3, note),
                resolved_by = $4, resolved_at = now()
         WHERE id = $1 AND status = 'open'`,
        [id, dto.status, dto.note, user.sub],
      );
      if (!result.rowCount) {
        throw new NotFoundException('No open exception with that id');
      }
      await this.audit.log(client, {
        actor: user.sub,
        action: `exception.${dto.status}`,
        entity: `exception:${id}`,
        reason: dto.note,
      });
      return { status: dto.status };
    });
  }
}

/** E4-S21: lookalike pairs — recognition between them is permanently
 * forced to confirm-band. */
@Controller('lookalikes')
export class LookalikesController {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  @Roles('owner', 'admin')
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.db.withTenant(user.tenantId, async (client) => {
      const rows = await client.query(
        `SELECT lp.worker_a, lp.worker_b, wa.full_name AS name_a, wb.full_name AS name_b
         FROM lookalike_pairs lp
         JOIN workers wa ON wa.id = lp.worker_a
         JOIN workers wb ON wb.id = lp.worker_b`,
      );
      return rows.rows.map((r) => ({
        workerAId: r.worker_a,
        workerAName: r.name_a,
        workerBId: r.worker_b,
        workerBName: r.name_b,
      }));
    });
  }

  @Roles('owner', 'admin')
  @Post()
  create(@Body() dto: LookalikeDto, @CurrentUser() user: AuthUser) {
    const [a, b] = [dto.workerAId, dto.workerBId].sort();
    return this.db.withTenant(user.tenantId, async (client) => {
      await client.query(
        `INSERT INTO lookalike_pairs (tenant_id, worker_a, worker_b, created_by)
         VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid, $1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [a, b, user.sub],
      );
      await this.audit.log(client, {
        actor: user.sub,
        action: 'lookalike.create',
        entity: `worker:${a}`,
        after: { pairedWith: b },
      });
      return { created: true };
    });
  }
}

/** E4-S19: nightly sweep across tenants (on-sync path lives in ingest). */
@Injectable()
export class ExceptionSweepJob {
  constructor(
    private readonly db: DatabaseService,
    private readonly capture: CaptureService,
  ) {}

  @Cron('0 22 * * *', { timeZone: 'Asia/Manila' })
  async nightly(): Promise<void> {
    const tenants = await this.db.query<{ list_tenant_ids: string }>(
      'SELECT list_tenant_ids()',
    );
    for (const row of tenants.rows) {
      await this.capture.sweepExceptions(row.list_tenant_ids);
    }
  }
}
