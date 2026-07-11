import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../database/database.service';

export interface CompanySettings {
  workdays: number[];
  standardWorkdayHours: number;
  otMultiplier: number;
  lateGraceMinutes: number;
  halfdayRule: 'hours_threshold' | 'cutoff_time';
  halfdayThresholdHours: number;
  halfdayCutoffTime: string;
  payrollWeekStartDay: number;
}

export const DEFAULT_SETTINGS: CompanySettings = {
  workdays: [1, 2, 3, 4, 5, 6],
  standardWorkdayHours: 8,
  otMultiplier: 1.25,
  lateGraceMinutes: 15,
  halfdayRule: 'hours_threshold',
  halfdayThresholdHours: 4,
  halfdayCutoffTime: '12:00',
  payrollWeekStartDay: 1,
};

interface SettingsRow {
  workdays: number[];
  standard_workday_hours: string;
  ot_multiplier: string;
  late_grace_minutes: number;
  halfday_rule: 'hours_threshold' | 'cutoff_time';
  halfday_threshold_hours: string;
  halfday_cutoff_time: string;
  payroll_week_start_day: number;
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** Absent row = untouched defaults; no row is written until first save. */
  async get(tenantId: string): Promise<CompanySettings> {
    return this.db.withTenant(tenantId, async (client) => {
      const result = await client.query<SettingsRow>(
        'SELECT * FROM company_settings WHERE tenant_id = $1',
        [tenantId],
      );
      return result.rows[0] ? toDto(result.rows[0]) : DEFAULT_SETTINGS;
    });
  }

  async update(
    tenantId: string,
    actor: string,
    next: CompanySettings,
  ): Promise<CompanySettings> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await client.query<SettingsRow>(
        'SELECT * FROM company_settings WHERE tenant_id = $1',
        [tenantId],
      );
      const result = await client.query<SettingsRow>(
        `INSERT INTO company_settings
           (tenant_id, workdays, standard_workday_hours, ot_multiplier,
            late_grace_minutes, halfday_rule, halfday_threshold_hours,
            halfday_cutoff_time, payroll_week_start_day, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
         ON CONFLICT (tenant_id) DO UPDATE SET
           workdays = excluded.workdays,
           standard_workday_hours = excluded.standard_workday_hours,
           ot_multiplier = excluded.ot_multiplier,
           late_grace_minutes = excluded.late_grace_minutes,
           halfday_rule = excluded.halfday_rule,
           halfday_threshold_hours = excluded.halfday_threshold_hours,
           halfday_cutoff_time = excluded.halfday_cutoff_time,
           payroll_week_start_day = excluded.payroll_week_start_day,
           updated_at = now()
         RETURNING *`,
        [
          tenantId,
          next.workdays,
          next.standardWorkdayHours,
          next.otMultiplier,
          next.lateGraceMinutes,
          next.halfdayRule,
          next.halfdayThresholdHours,
          next.halfdayCutoffTime,
          next.payrollWeekStartDay,
        ],
      );
      await this.audit.log(client, {
        actor,
        action: 'settings.update',
        entity: 'company_settings',
        before: before.rows[0] ? toDto(before.rows[0]) : DEFAULT_SETTINGS,
        after: toDto(result.rows[0]),
      });
      return toDto(result.rows[0]);
    });
  }
}

function toDto(row: SettingsRow): CompanySettings {
  return {
    workdays: row.workdays,
    standardWorkdayHours: Number(row.standard_workday_hours),
    otMultiplier: Number(row.ot_multiplier),
    lateGraceMinutes: row.late_grace_minutes,
    halfdayRule: row.halfday_rule,
    halfdayThresholdHours: Number(row.halfday_threshold_hours),
    // time column serializes as HH:MM:SS — trim to HH:MM.
    halfdayCutoffTime: row.halfday_cutoff_time.slice(0, 5),
    payrollWeekStartDay: row.payroll_week_start_day,
  };
}
