import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.service';
import { NotificationService } from './notification.service';

/**
 * E9-S02 / S03 / S04 scheduled jobs.
 * Crons run frequently; each job self-gates on tenant timezone + settings.
 */
@Injectable()
export class NotificationJobs {
  private readonly logger = new Logger(NotificationJobs.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly notifications: NotificationService,
  ) {}

  /** Every 15 minutes: engineer no-time-in reminders (E9-S02). */
  @Cron('*/15 * * * *')
  async engineerNoTimeInReminders(): Promise<void> {
    await this.runNoTimeInReminders();
  }

  /** Daily 18:00 Asia/Manila: admin exception digest (E9-S03). */
  @Cron('0 18 * * *', { timeZone: 'Asia/Manila' })
  async adminExceptionDigests(): Promise<void> {
    await this.runAdminDigests();
  }

  /** Sunday 20:00 Asia/Manila: owner weekly summary (E9-S04). */
  @Cron('0 20 * * 0', { timeZone: 'Asia/Manila' })
  async ownerWeeklySummaries(): Promise<void> {
    await this.runOwnerWeeklySummaries();
  }

  async runNoTimeInReminders(): Promise<number> {
    const tenants = await this.listTenants();
    let sent = 0;
    for (const tenantId of tenants) {
      try {
        sent += await this.remindTenantEngineers(tenantId);
      } catch (err) {
        this.logger.warn(
          `no-time-in tenant=${tenantId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    return sent;
  }

  async runAdminDigests(): Promise<number> {
    const tenants = await this.listTenants();
    let sent = 0;
    for (const tenantId of tenants) {
      try {
        if (await this.digestTenantAdmins(tenantId)) sent++;
      } catch (err) {
        this.logger.warn(
          `admin-digest tenant=${tenantId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    return sent;
  }

  async runOwnerWeeklySummaries(): Promise<number> {
    const tenants = await this.listTenants();
    let sent = 0;
    for (const tenantId of tenants) {
      try {
        if (await this.summarizeTenantOwner(tenantId)) sent++;
      } catch (err) {
        this.logger.warn(
          `owner-summary tenant=${tenantId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    return sent;
  }

  private async listTenants(): Promise<string[]> {
    const r = await this.db.query<{ list_tenant_ids: string }>(
      'SELECT list_tenant_ids()',
    );
    return r.rows.map((row) => row.list_tenant_ids);
  }

  private async remindTenantEngineers(tenantId: string): Promise<number> {
    const ctx = await this.db.withTenant(tenantId, async (client) => {
      const settings = await client.query<{
        timezone: string;
        no_time_in_reminder_time: string;
      }>(
        `SELECT timezone, no_time_in_reminder_time::text
         FROM company_settings LIMIT 1`,
      );
      if (!settings.rowCount) return null;
      const tz = settings.rows[0].timezone || 'Asia/Manila';
      const reminder = (settings.rows[0].no_time_in_reminder_time || '08:30:00')
        .slice(0, 5);

      const local = await client.query<{ local_day: string; local_hm: string }>(
        `SELECT
           (now() AT TIME ZONE $1)::date::text AS local_day,
           to_char(now() AT TIME ZONE $1, 'HH24:MI') AS local_hm`,
        [tz],
      );
      const day = local.rows[0].local_day;
      const hm = local.rows[0].local_hm;
      // Fire any time after the configured clock; dedupe enforces once/day.
      if (hm < reminder) return null;

      const engineers = await client.query<{
        id: string;
        email: string;
        phone: string | null;
      }>(
        `SELECT DISTINCT u.id, u.email, u.phone
         FROM users u
         JOIN site_engineers se ON se.user_id = u.id
         JOIN sites s ON s.id = se.site_id AND s.archived_at IS NULL
         WHERE u.role = 'engineer' AND u.status = 'active'
           AND NOT EXISTS (
             SELECT 1 FROM attendance_sessions sess
             WHERE sess.engineer_id = u.id
               AND sess.type = 'time_in'
               AND (sess.device_captured_at AT TIME ZONE $1)::date = $2::date
               AND sess.site_id = se.site_id
           )`,
        [tz, day],
      );
      return { day, engineers: engineers.rows };
    });
    if (!ctx) return 0;

    let sent = 0;
    for (const eng of ctx.engineers) {
      const claimed = await this.notifications.claimDedupe(
        tenantId,
        'no_time_in_reminder',
        eng.id,
        ctx.day,
      );
      if (!claimed) continue;

      await this.notifications.notify({
        tenantId,
        kind: 'no_time_in_reminder',
        title: 'Time-in reminder',
        body: 'No time-in session captured yet for your assigned site(s). Open Presente to photograph the crew.',
        payload: { deepLink: '/capture/site?type=time_in', day: ctx.day },
        target: {
          userId: eng.id,
          email: eng.email,
          phone: eng.phone,
        },
      });
      sent++;
    }
    return sent;
  }

  private async digestTenantAdmins(tenantId: string): Promise<boolean> {
    const ctx = await this.db.withTenant(tenantId, async (client) => {
      const tzRow = await client.query<{ timezone: string }>(
        `SELECT timezone FROM company_settings LIMIT 1`,
      );
      const tz = tzRow.rows[0]?.timezone ?? 'Asia/Manila';
      const dayRow = await client.query<{ d: string }>(
        `SELECT (now() AT TIME ZONE $1)::date::text AS d`,
        [tz],
      );
      const day = dayRow.rows[0].d;

      const open = await client.query<{ type: string; n: string }>(
        `SELECT type, count(*)::text AS n FROM exceptions
         WHERE status = 'open'
         GROUP BY type ORDER BY count(*) DESC`,
      );
      if (!open.rowCount) return null;

      const lines = open.rows.map((r) => `${r.type}: ${r.n}`).join(', ');
      const total = open.rows.reduce((a, r) => a + Number(r.n), 0);
      const body = `${total} unresolved exception(s): ${lines}. Open Presente → Exceptions.`;

      const admins = await client.query<{
        id: string;
        email: string;
        phone: string | null;
      }>(
        `SELECT id, email, phone FROM users
         WHERE role IN ('admin', 'owner') AND status = 'active'`,
      );
      return { day, body, total, admins: admins.rows };
    });
    if (!ctx) return false;

    let any = false;
    for (const admin of ctx.admins) {
      const claimed = await this.notifications.claimDedupe(
        tenantId,
        'admin_exception_digest',
        admin.id,
        ctx.day,
      );
      if (!claimed) continue;
      await this.notifications.notify({
        tenantId,
        kind: 'admin_exception_digest',
        title: 'Daily exception digest',
        body: ctx.body,
        payload: { deepLink: '/exceptions', count: ctx.total },
        target: {
          userId: admin.id,
          email: admin.email,
          phone: admin.phone,
        },
      });
      any = true;
    }
    return any;
  }

  private async summarizeTenantOwner(tenantId: string): Promise<boolean> {
    const ctx = await this.db.withTenant(tenantId, async (client) => {
      const settings = await client.query<{
        timezone: string;
        payroll_week_start_day: number;
      }>(
        `SELECT timezone, payroll_week_start_day FROM company_settings LIMIT 1`,
      );
      if (!settings.rowCount) return null;
      const tz = settings.rows[0].timezone || 'Asia/Manila';
      const bounds = await client.query<{
        start: string;
        end: string;
        today: string;
      }>(
        `WITH local AS (
           SELECT (now() AT TIME ZONE $1)::date AS today
         ),
         start_dow AS (
           SELECT CASE WHEN $2 = 7 THEN 0 ELSE $2 END AS dow
         )
         SELECT
           (today - ((EXTRACT(DOW FROM today)::int - (SELECT dow FROM start_dow) + 7) % 7) - 7)::text AS start,
           (today - ((EXTRACT(DOW FROM today)::int - (SELECT dow FROM start_dow) + 7) % 7) - 1)::text AS end,
           today::text AS today
         FROM local`,
        [tz, settings.rows[0].payroll_week_start_day],
      );
      const { start, end, today } = bounds.rows[0];

      const headcount = await client.query<{ n: string }>(
        `SELECT count(DISTINCT worker_id)::text AS n FROM day_records
         WHERE day BETWEEN $1::date AND $2::date
           AND status IN ('present', 'halfday', 'ot_candidate')`,
        [start, end],
      );
      const exceptions = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM exceptions
         WHERE created_at::date BETWEEN $1::date AND $2::date`,
        [start, end],
      );
      const gross = await client.query<{ g: string | null }>(
        `SELECT sum((totals->>'gross')::numeric)::text AS g
         FROM payroll_runs
         WHERE period_start = $1::date AND period_end = $2::date`,
        [start, end],
      );

      const head = Number(headcount.rows[0]?.n ?? 0);
      const exN = Number(exceptions.rows[0]?.n ?? 0);
      const grossPay = gross.rows[0]?.g
        ? Number(gross.rows[0].g).toFixed(2)
        : '0.00';
      const body = `Week ${start}–${end}: ${head} workers with attendance, gross ₱${grossPay}, ${exN} exceptions.`;

      const owners = await client.query<{
        id: string;
        email: string;
        phone: string | null;
      }>(
        `SELECT id, email, phone FROM users
         WHERE role = 'owner' AND status = 'active'`,
      );

      return {
        today,
        body,
        start,
        end,
        head,
        grossPay,
        exN,
        owners: owners.rows,
      };
    });
    if (!ctx || ctx.owners.length === 0) return false;

    const claimed = await this.notifications.claimDedupe(
      tenantId,
      'owner_weekly_summary',
      'owner',
      ctx.today,
    );
    if (!claimed) return false;

    for (const owner of ctx.owners) {
      await this.notifications.notify({
        tenantId,
        kind: 'owner_weekly_summary',
        title: 'Weekly summary',
        body: ctx.body,
        payload: {
          deepLink: '/reports',
          periodStart: ctx.start,
          periodEnd: ctx.end,
          headcount: ctx.head,
          gross: ctx.grossPay,
          exceptions: ctx.exN,
        },
        target: {
          userId: owner.id,
          email: owner.email,
          phone: owner.phone,
        },
      });
    }
    return true;
  }
}
