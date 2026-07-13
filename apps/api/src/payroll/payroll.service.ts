import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/roles';
import { DatabaseService } from '../database/database.service';
import {
  computeGrossPay,
  payrollWeekBounds,
  type DayInput,
} from './compute';
import {
  payslipDownloadName,
  payslipPdf,
  signatureSheetPdf,
  toCsv,
  toXlsxXml,
  type ExportLine,
} from './exports';
import {
  canTransition,
  isImmutable,
  type RunStatus,
} from './state-machine';

const BLOCKING_EXCEPTION_TYPES = [
  'missing_time_out',
  'missing_time_in',
  'manual_tag',
] as const;

@Injectable()
export class PayrollService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async listRuns(actor: AuthUser) {
    return this.db.withTenant(actor.tenantId, async (client) => {
      const rows = await client.query(
        `SELECT * FROM payroll_runs ORDER BY period_start DESC LIMIT 100`,
      );
      return rows.rows.map((r) => this.runDto(r));
    });
  }

  async suggestPeriod(actor: AuthUser) {
    return this.db.withTenant(actor.tenantId, async (client) => {
      const s = await client.query<{ payroll_week_start_day: number }>(
        'SELECT payroll_week_start_day FROM company_settings LIMIT 1',
      );
      const startDay = s.rows[0]?.payroll_week_start_day ?? 1;
      return payrollWeekBounds(new Date(), startDay, true);
    });
  }

  /** E7-S01 + S02: start a draft run and compute lines from day_records. */
  async startRun(
    actor: AuthUser,
    period?: { start: string; end: string },
  ) {
    if (actor.role === 'engineer') {
      throw new ForbiddenException('Engineers cannot run payroll');
    }
    let bounds =
      period ??
      (await this.suggestPeriod(actor));

    if (period) {
      if (!period.start || !period.end) {
        throw new BadRequestException(
          'Both start and end are required when specifying a period',
        );
      }
      if (period.start > period.end) {
        throw new BadRequestException('period start must be on or before end');
      }
      bounds = period;
    }

    return this.db.withTenant(actor.tenantId, async (client) => {
      const existing = await client.query(
        `SELECT id, status FROM payroll_runs
         WHERE period_start = $1::date AND period_end = $2::date`,
        [bounds.start, bounds.end],
      );
      if (existing.rowCount) {
        throw new BadRequestException(
          `A payroll run already exists for ${bounds.start}–${bounds.end} (${existing.rows[0].status})`,
        );
      }

      const run = await client.query(
        `INSERT INTO payroll_runs
           (tenant_id, period_start, period_end, status, created_by)
         VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid,
                 $1::date, $2::date, 'draft', $3)
         RETURNING *`,
        [bounds.start, bounds.end, actor.sub],
      );
      const runId = run.rows[0].id as string;
      await this.recomputeLines(client, actor, runId);
      await this.audit.log(client, {
        actor: actor.sub,
        action: 'payroll.start',
        entity: `payroll_run:${runId}`,
        after: bounds,
      });
      return this.getRunInTx(client, runId);
    });
  }

  async getRun(actor: AuthUser, runId: string) {
    return this.db.withTenant(actor.tenantId, (client) =>
      this.getRunInTx(client, runId),
    );
  }

  private async getRunInTx(client: import('pg').PoolClient, runId: string) {
    const run = await client.query(`SELECT * FROM payroll_runs WHERE id = $1`, [
      runId,
    ]);
    if (!run.rowCount) throw new NotFoundException('Payroll run not found');
    const lines = await client.query(
      `SELECT pl.*, w.full_name AS worker_name
       FROM payroll_lines pl
       JOIN workers w ON w.id = pl.worker_id
       WHERE pl.run_id = $1
       ORDER BY w.full_name`,
      [runId],
    );
    const adjustments = await client.query(
      `SELECT pa.*, w.full_name AS worker_name
       FROM payroll_adjustments pa
       JOIN workers w ON w.id = pa.worker_id
       WHERE pa.run_id = $1 ORDER BY pa.created_at`,
      [runId],
    );
    const otAdj = await client.query(
      `SELECT * FROM payroll_ot_adjustments WHERE run_id = $1`,
      [runId],
    );
    const blocking = await this.blockingExceptions(
      client,
      run.rows[0].period_start,
      run.rows[0].period_end,
    );
    return {
      ...this.runDto(run.rows[0]),
      lines: lines.rows.map((l) => ({
        id: l.id,
        workerId: l.worker_id,
        workerName: l.worker_name,
        daysPresent: Number(l.days_present),
        halfdays: Number(l.halfdays),
        otHours: Number(l.ot_hours),
        otHoursUnpaid: Number(l.ot_hours_unpaid),
        dailyRate: Number(l.daily_rate),
        basePay: Number(l.base_pay),
        otPay: Number(l.ot_pay),
        adjustments: Number(l.adjustments),
        gross: Number(l.gross),
        detail: l.detail,
      })),
      adjustments: adjustments.rows.map((a) => ({
        id: a.id,
        workerId: a.worker_id,
        workerName: a.worker_name,
        amount: Number(a.amount),
        note: a.note,
        source: a.source,
        sourceRunId: a.source_run_id,
      })),
      otAdjustments: otAdj.rows.map((o) => ({
        id: o.id,
        workerId: o.worker_id,
        day: o.day.toISOString().slice(0, 10),
        deltaHours: Number(o.delta_hours),
        reason: o.reason,
      })),
      blockingExceptions: blocking,
    };
  }

  private async recomputeLines(
    client: import('pg').PoolClient,
    actor: AuthUser,
    runId: string,
  ) {
    const run = await client.query(
      `SELECT * FROM payroll_runs WHERE id = $1`,
      [runId],
    );
    if (!run.rowCount) throw new NotFoundException('Run not found');
    if (isImmutable(run.rows[0].status)) {
      throw new BadRequestException('Cannot recompute an approved/exported run');
    }

    const settings = await client.query(
      `SELECT standard_workday_hours, ot_multiplier FROM company_settings LIMIT 1`,
    );
    const std = Number(settings.rows[0]?.standard_workday_hours ?? 8);
    const otMult = Number(settings.rows[0]?.ot_multiplier ?? 1.25);
    const start = asDateOnly(run.rows[0].period_start);
    const end = asDateOnly(run.rows[0].period_end);

    const dayRows = await client.query(
      `SELECT d.*, w.daily_rate, w.ot_eligible AS worker_ot,
              s.ot_eligible AS site_ot, w.full_name
       FROM day_records d
       JOIN workers w ON w.id = d.worker_id
       LEFT JOIN sites s ON s.id = d.site_id
       WHERE d.day BETWEEN $1::date AND $2::date
         AND d.status <> 'absent'`,
      [start, end],
    );

    const otDeltas = await client.query(
      `SELECT worker_id, day, sum(delta_hours)::float AS delta
       FROM payroll_ot_adjustments WHERE run_id = $1
       GROUP BY worker_id, day`,
      [runId],
    );
    const deltaMap = new Map<string, number>();
    for (const o of otDeltas.rows) {
      deltaMap.set(`${o.worker_id}|${asDateOnly(o.day)}`, Number(o.delta));
    }

    const adj = await client.query(
      `SELECT worker_id, sum(amount)::float AS total
       FROM payroll_adjustments WHERE run_id = $1
       GROUP BY worker_id`,
      [runId],
    );
    const adjMap = new Map<string, number>();
    for (const a of adj.rows) adjMap.set(a.worker_id, Number(a.total));

    // Aggregate per worker across sites (sum hours/status credits for same day).
    type AggDay = DayInput & { rate: number };
    const byWorker = new Map<
      string,
      { rate: number; days: Map<string, AggDay> }
    >();

    for (const r of dayRows.rows) {
      const workerId = r.worker_id as string;
      const day = asDateOnly(r.day);
      const otEligible =
        r.worker_ot === null || r.worker_ot === undefined
          ? Boolean(r.site_ot ?? true)
          : Boolean(r.worker_ot);
      const rate = Number(r.daily_rate ?? 0);
      if (!byWorker.has(workerId)) {
        byWorker.set(workerId, { rate, days: new Map() });
      }
      const bucket = byWorker.get(workerId)!;
      if (rate > bucket.rate) bucket.rate = rate;
      const existing = bucket.days.get(day);
      const hours = Number(r.hours);
      const status = r.status as DayInput['status'];
      if (!existing) {
        bucket.days.set(day, {
          day,
          status,
          hours,
          otEligible,
          otDeltaHours: deltaMap.get(`${workerId}|${day}`) ?? 0,
          rate,
        });
      } else {
        // Multi-site: take max hours and best status credit.
        existing.hours += hours;
        existing.otEligible = existing.otEligible || otEligible;
        if (statusRank(status) > statusRank(existing.status)) {
          existing.status = status;
        }
      }
    }

    await client.query(`DELETE FROM payroll_lines WHERE run_id = $1`, [runId]);

    let workers = 0;
    let manDays = 0;
    let totalOt = 0;
    let totalGross = 0;

    for (const [workerId, data] of byWorker) {
      const days = [...data.days.values()];
      const result = computeGrossPay(
        {
          dailyRate: data.rate,
          days,
          adjustments: adjMap.get(workerId) ?? 0,
        },
        { standardWorkdayHours: std, otMultiplier: otMult },
      );
      await client.query(
        `INSERT INTO payroll_lines
           (tenant_id, run_id, worker_id, days_present, halfdays, ot_hours,
            ot_hours_unpaid, daily_rate, base_pay, ot_pay, adjustments, gross, detail)
         VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid,
                 $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          runId,
          workerId,
          result.daysPresent,
          result.halfdays,
          result.otHours,
          result.otHoursUnpaid,
          data.rate,
          result.basePay,
          result.otPay,
          result.adjustments,
          result.gross,
          JSON.stringify({ days: result.days }),
        ],
      );
      workers++;
      manDays += result.daysPresent + result.halfdays * 0.5;
      totalOt += result.otHours;
      totalGross += result.gross;
    }

    const totals = {
      workers,
      manDays: Math.round(manDays * 100) / 100,
      otHours: Math.round(totalOt * 100) / 100,
      gross: Math.round(totalGross * 100) / 100,
    };
    await client.query(
      `UPDATE payroll_runs SET totals = $2, updated_at = now() WHERE id = $1`,
      [runId, JSON.stringify(totals)],
    );
    void actor;
  }

  async recompute(actor: AuthUser, runId: string) {
    return this.db.withTenant(actor.tenantId, async (client) => {
      await this.assertMutable(client, runId);
      await this.recomputeLines(client, actor, runId);
      return this.getRunInTx(client, runId);
    });
  }

  /** E7-S04 */
  async addOtAdjustment(
    actor: AuthUser,
    runId: string,
    input: { workerId: string; day: string; deltaHours: number; reason: string },
  ) {
    if (!input.reason?.trim()) {
      throw new BadRequestException('Reason required');
    }
    return this.db.withTenant(actor.tenantId, async (client) => {
      await this.assertMutable(client, runId);
      await client.query(
        `INSERT INTO payroll_ot_adjustments
           (tenant_id, run_id, worker_id, day, delta_hours, reason, created_by)
         VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid,
                 $1, $2, $3::date, $4, $5, $6)`,
        [
          runId,
          input.workerId,
          input.day,
          input.deltaHours,
          input.reason.trim(),
          actor.sub,
        ],
      );
      await this.audit.log(client, {
        actor: actor.sub,
        action: 'payroll.ot_adjust',
        entity: `payroll_run:${runId}`,
        after: input,
        reason: input.reason.trim(),
      });
      await this.recomputeLines(client, actor, runId);
      // Edits drop reviewed → draft
      await client.query(
        `UPDATE payroll_runs SET status = 'draft', reviewed_by = NULL, reviewed_at = NULL,
                updated_at = now()
         WHERE id = $1 AND status = 'reviewed'`,
        [runId],
      );
      return this.getRunInTx(client, runId);
    });
  }

  /** E7-S09 */
  async addAdjustment(
    actor: AuthUser,
    runId: string,
    input: { workerId: string; amount: number; note: string },
  ) {
    if (!input.note?.trim()) {
      throw new BadRequestException('Note required');
    }
    return this.db.withTenant(actor.tenantId, async (client) => {
      await this.assertMutable(client, runId);
      await client.query(
        `INSERT INTO payroll_adjustments
           (tenant_id, run_id, worker_id, amount, note, created_by)
         VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid,
                 $1, $2, $3, $4, $5)`,
        [runId, input.workerId, input.amount, input.note.trim(), actor.sub],
      );
      await this.audit.log(client, {
        actor: actor.sub,
        action: 'payroll.adjustment',
        entity: `payroll_run:${runId}`,
        after: input,
        reason: input.note.trim(),
      });
      await this.recomputeLines(client, actor, runId);
      await client.query(
        `UPDATE payroll_runs SET status = 'draft', reviewed_by = NULL, reviewed_at = NULL,
                updated_at = now()
         WHERE id = $1 AND status = 'reviewed'`,
        [runId],
      );
      return this.getRunInTx(client, runId);
    });
  }

  async transition(
    actor: AuthUser,
    runId: string,
    to: RunStatus,
  ) {
    return this.db.withTenant(actor.tenantId, async (client) => {
      const run = await client.query(`SELECT * FROM payroll_runs WHERE id = $1`, [
        runId,
      ]);
      if (!run.rowCount) throw new NotFoundException('Run not found');
      const from = run.rows[0].status as RunStatus;
      if (!canTransition(from, to)) {
        throw new BadRequestException(
          `Illegal transition ${from} → ${to}`,
        );
      }

      if (to === 'approved') {
        const settings = await client.query<{ approve_role: string }>(
          'SELECT approve_role FROM company_settings LIMIT 1',
        );
        const policy = settings.rows[0]?.approve_role ?? 'admin';
        if (policy === 'owner' && actor.role !== 'owner') {
          throw new ForbiddenException(
            'This tenant requires Owner approval for payroll',
          );
        }
        if (policy === 'admin' && actor.role === 'engineer') {
          throw new ForbiddenException('Engineers cannot approve payroll');
        }
        const blocking = await this.blockingExceptions(
          client,
          run.rows[0].period_start,
          run.rows[0].period_end,
        );
        if (blocking.length > 0) {
          throw new BadRequestException({
            message: `Cannot approve: ${blocking.length} blocking exception(s)`,
            blocking,
          });
        }
      }

      if (to === 'exported') {
        await client.query(
          `UPDATE payroll_runs SET status = 'exported', exported_at = now(), updated_at = now()
           WHERE id = $1`,
          [runId],
        );
      } else if (to === 'draft') {
        await client.query(
          `UPDATE payroll_runs SET status = 'draft', reviewed_by = NULL, reviewed_at = NULL,
                  updated_at = now() WHERE id = $1`,
          [runId],
        );
      } else if (to === 'reviewed') {
        await client.query(
          `UPDATE payroll_runs SET status = 'reviewed', reviewed_by = $2, reviewed_at = now(),
                  updated_at = now() WHERE id = $1`,
          [runId, actor.sub],
        );
      } else if (to === 'approved') {
        await client.query(
          `UPDATE payroll_runs SET status = 'approved', approved_by = $2, approved_at = now(),
                  updated_at = now() WHERE id = $1`,
          [runId, actor.sub],
        );
      }

      await this.audit.log(client, {
        actor: actor.sub,
        action: `payroll.${to}`,
        entity: `payroll_run:${runId}`,
        before: { status: from },
        after: { status: to },
      });
      return this.getRunInTx(client, runId);
    });
  }

  /** E7-S05: waive a blocking exception with note. */
  async waiveException(
    actor: AuthUser,
    exceptionId: string,
    note: string,
  ) {
    if (!note?.trim()) throw new BadRequestException('Note required to waive');
    return this.db.withTenant(actor.tenantId, async (client) => {
      const result = await client.query(
        `UPDATE exceptions SET status = 'waived', note = $2, resolved_by = $3,
                resolved_at = now()
         WHERE id = $1 AND status = 'open'
         RETURNING id`,
        [exceptionId, note.trim(), actor.sub],
      );
      if (!result.rowCount) {
        throw new NotFoundException('Open exception not found');
      }
      await this.audit.log(client, {
        actor: actor.sub,
        action: 'exception.waived',
        entity: `exception:${exceptionId}`,
        reason: note.trim(),
      });
      return { status: 'waived' };
    });
  }

  /** E7-S13: post-approval correction → next draft run adjustment. */
  async postApprovalCorrection(
    actor: AuthUser,
    runId: string,
    input: { workerId: string; amount: number; note: string },
  ) {
    return this.db.withTenant(actor.tenantId, async (client) => {
      const run = await client.query(
        `SELECT * FROM payroll_runs WHERE id = $1`,
        [runId],
      );
      if (!run.rowCount) throw new NotFoundException('Run not found');
      if (run.rows[0].status !== 'approved' && run.rows[0].status !== 'exported') {
        throw new BadRequestException(
          'Post-approval corrections only apply to approved/exported runs',
        );
      }
      if (!input.note?.trim()) {
        throw new BadRequestException('Note required');
      }

      // Find or create next draft run after this period.
      let next = await client.query(
        `SELECT * FROM payroll_runs
         WHERE period_start > $1::date AND status = 'draft'
         ORDER BY period_start LIMIT 1`,
        [asDateOnly(run.rows[0].period_end)],
      );
      if (!next.rowCount) {
        const end = new Date(asDateOnly(run.rows[0].period_end) + 'T00:00:00Z');
        const startNext = new Date(end);
        startNext.setUTCDate(end.getUTCDate() + 1);
        const endNext = new Date(startNext);
        endNext.setUTCDate(startNext.getUTCDate() + 6);
        next = await client.query(
          `INSERT INTO payroll_runs
             (tenant_id, period_start, period_end, status, created_by)
           VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid,
                   $1::date, $2::date, 'draft', $3)
           RETURNING *`,
          [
            asDateOnly(startNext),
            asDateOnly(endNext),
            actor.sub,
          ],
        );
      }
      const nextId = next.rows[0].id as string;
      await client.query(
        `INSERT INTO payroll_adjustments
           (tenant_id, run_id, worker_id, amount, note, source, source_run_id, created_by)
         VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid,
                 $1, $2, $3, $4, 'post_approval_correction', $5, $6)`,
        [
          nextId,
          input.workerId,
          input.amount,
          `${input.note.trim()} (from run ${runId})`,
          runId,
          actor.sub,
        ],
      );
      await this.audit.log(client, {
        actor: actor.sub,
        action: 'payroll.post_approval_correction',
        entity: `payroll_run:${nextId}`,
        after: { ...input, sourceRunId: runId },
        reason: input.note.trim(),
      });
      await this.recomputeLines(client, actor, nextId);
      return this.getRunInTx(client, nextId);
    });
  }

  /** E7-S14/S15/S16 exports. Single-worker payslip: format=payslip&workerId=… */
  async export(
    actor: AuthUser,
    runId: string,
    format: 'csv' | 'xlsx' | 'signature-pdf' | 'payslips-zip' | 'payslip',
    workerId?: string,
  ) {
    const run = await this.getRun(actor, runId);
    const period = `${run.periodStart} – ${run.periodEnd}`;

    // Single payslip: allowed on any status (preview while drafting).
    if (format === 'payslip') {
      if (!workerId) {
        throw new BadRequestException('workerId is required for format=payslip');
      }
      const line = run.lines.find((l) => l.workerId === workerId);
      if (!line) {
        throw new NotFoundException('Worker not found on this payroll run');
      }
      const exportLine: ExportLine = {
        workerName: line.workerName,
        daysPresent: line.daysPresent,
        halfdays: line.halfdays,
        otHours: line.otHours,
        adjustments: line.adjustments,
        gross: line.gross,
        dailyRate: line.dailyRate,
      };
      const body = payslipPdf(line.workerName, period, exportLine);
      const hash = createHash('sha256').update(body).digest('hex');
      const filename = payslipDownloadName(line.workerName);
      await this.db.withTenant(actor.tenantId, async (client) => {
        await this.audit.log(client, {
          actor: actor.sub,
          action: 'payroll.export',
          entity: `payroll_run:${runId}`,
          after: {
            format: 'payslip',
            workerId,
            hash,
            bytes: body.length,
          },
        });
      });
      return {
        body,
        contentType: 'application/pdf',
        filename,
        hash,
      };
    }

    if (run.status !== 'approved' && run.status !== 'exported') {
      if (run.status === 'draft' || run.status === 'reviewed') {
        throw new BadRequestException('Approve the run before bulk exporting');
      }
    }
    const lines: ExportLine[] = run.lines.map((l) => ({
      workerName: l.workerName,
      daysPresent: l.daysPresent,
      halfdays: l.halfdays,
      otHours: l.otHours,
      adjustments: l.adjustments,
      gross: l.gross,
      dailyRate: l.dailyRate,
    }));

    let body: Buffer | string;
    let contentType: string;
    let filename: string;

    if (format === 'csv') {
      body = toCsv(lines);
      contentType = 'text/csv; charset=utf-8';
      filename = `payroll-${run.periodStart}.csv`;
    } else if (format === 'xlsx') {
      body = toXlsxXml(lines);
      contentType = 'application/vnd.ms-excel';
      filename = `payroll-${run.periodStart}.xml`;
    } else if (format === 'signature-pdf') {
      body = signatureSheetPdf('All sites', period, lines);
      contentType = 'application/pdf';
      filename = `signatures-${run.periodStart}.pdf`;
    } else {
      // Concatenate payslip PDFs (true zip deferred).
      const parts = run.lines.map((l) =>
        payslipPdf(l.workerName, period, {
          workerName: l.workerName,
          daysPresent: l.daysPresent,
          halfdays: l.halfdays,
          otHours: l.otHours,
          adjustments: l.adjustments,
          gross: l.gross,
          dailyRate: l.dailyRate,
        }),
      );
      body = Buffer.concat(parts);
      contentType = 'application/pdf';
      filename = `payslips-${run.periodStart}.pdf`;
    }

    const buf = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
    const hash = createHash('sha256').update(buf).digest('hex');

    await this.db.withTenant(actor.tenantId, async (client) => {
      if (canTransition(run.status as RunStatus, 'exported') || run.status === 'approved') {
        await client.query(
          `UPDATE payroll_runs SET status = 'exported', exported_at = now(),
                  export_hash = $2, updated_at = now()
           WHERE id = $1 AND status IN ('approved', 'exported')`,
          [runId, hash],
        );
      }
      await this.audit.log(client, {
        actor: actor.sub,
        action: 'payroll.export',
        entity: `payroll_run:${runId}`,
        after: { format, hash, bytes: buf.length },
      });
    });

    return { body: buf, contentType, filename, hash };
  }

  async setOtEligible(
    actor: AuthUser,
    target: { siteId?: string; workerId?: string; otEligible: boolean },
  ) {
    return this.db.withTenant(actor.tenantId, async (client) => {
      if (target.siteId) {
        await client.query(`UPDATE sites SET ot_eligible = $2 WHERE id = $1`, [
          target.siteId,
          target.otEligible,
        ]);
        await this.audit.log(client, {
          actor: actor.sub,
          action: 'site.ot_eligible',
          entity: `site:${target.siteId}`,
          after: { otEligible: target.otEligible },
        });
      }
      if (target.workerId) {
        await client.query(`UPDATE workers SET ot_eligible = $2 WHERE id = $1`, [
          target.workerId,
          target.otEligible,
        ]);
        await this.audit.log(client, {
          actor: actor.sub,
          action: 'worker.ot_eligible',
          entity: `worker:${target.workerId}`,
          after: { otEligible: target.otEligible },
        });
      }
      return { ok: true };
    });
  }

  async setApproveRole(actor: AuthUser, approveRole: 'admin' | 'owner') {
    if (actor.role !== 'owner') {
      throw new ForbiddenException('Only Owner can change approve_role');
    }
    return this.db.withTenant(actor.tenantId, async (client) => {
      await client.query(
        `UPDATE company_settings SET approve_role = $1, updated_at = now()`,
        [approveRole],
      );
      await this.audit.log(client, {
        actor: actor.sub,
        action: 'settings.approve_role',
        entity: 'company_settings',
        after: { approveRole },
      });
      return { approveRole };
    });
  }

  private async blockingExceptions(
    client: import('pg').PoolClient,
    periodStart: Date | string,
    periodEnd: Date | string,
  ) {
    const rows = await client.query(
      `SELECT e.id, e.type, e.worker_id, e.day, e.note, e.severity
       FROM exceptions e
       WHERE e.status = 'open'
         AND e.type = ANY($1::text[])
         AND (e.day IS NULL OR e.day BETWEEN $2::date AND $3::date)
       ORDER BY e.severity, e.created_at
       LIMIT 200`,
      [
        [...BLOCKING_EXCEPTION_TYPES],
        asDateOnly(periodStart),
        asDateOnly(periodEnd),
      ],
    );
    return rows.rows.map((e) => ({
      id: e.id,
      type: e.type,
      workerId: e.worker_id,
      day: e.day ? asDateOnly(e.day) : null,
      note: e.note,
      severity: e.severity,
    }));
  }

  private async assertMutable(
    client: import('pg').PoolClient,
    runId: string,
  ) {
    const run = await client.query(
      `SELECT status FROM payroll_runs WHERE id = $1`,
      [runId],
    );
    if (!run.rowCount) throw new NotFoundException('Run not found');
    if (isImmutable(run.rows[0].status)) {
      throw new BadRequestException(
        'Approved/exported runs are immutable (E7-S12)',
      );
    }
  }

  private runDto(r: {
    id: string;
    period_start: Date | string;
    period_end: Date | string;
    status: string;
    totals: unknown;
    created_at: Date | string;
    reviewed_at: Date | string | null;
    approved_at: Date | string | null;
    exported_at: Date | string | null;
    export_hash: string | null;
  }) {
    return {
      id: r.id,
      periodStart: asDateOnly(r.period_start),
      periodEnd: asDateOnly(r.period_end),
      status: r.status,
      totals: r.totals ?? {},
      createdAt: asIso(r.created_at),
      reviewedAt: r.reviewed_at ? asIso(r.reviewed_at) : null,
      approvedAt: r.approved_at ? asIso(r.approved_at) : null,
      exportedAt: r.exported_at ? asIso(r.exported_at) : null,
      exportHash: r.export_hash,
    };
  }
}

function asDateOnly(v: Date | string): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function asIso(v: Date | string): string {
  if (v instanceof Date) return v.toISOString();
  return new Date(v).toISOString();
}

function statusRank(s: string): number {
  switch (s) {
    case 'ot_candidate':
      return 3;
    case 'present':
      return 2;
    case 'halfday':
      return 1;
    default:
      return 0;
  }
}

