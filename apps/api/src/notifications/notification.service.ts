import { Inject, Injectable, Logger } from '@nestjs/common';
import { PoolClient } from 'pg';
import type { AuthUser } from '../auth/roles';
import { DatabaseService } from '../database/database.service';
import {
  MESSAGE_DISPATCHER,
  type MessageDispatcher,
} from '../messaging/dispatcher';

export type NotifyChannel = 'push' | 'sms' | 'email';

export interface NotifyTarget {
  userId: string;
  email?: string | null;
  phone?: string | null;
}

export interface NotifyInput {
  tenantId: string;
  kind: string;
  title: string;
  body: string;
  payload?: Record<string, unknown>;
  /** Prefer push; fall back to SMS then email (FR-36 SMS-lite). */
  target: NotifyTarget;
}

/**
 * E9-S01: notification abstraction — push (stub/FCM-ready) + SMS-lite fallback.
 * Delivery outcomes always land in notification_log.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly db: DatabaseService,
    @Inject(MESSAGE_DISPATCHER)
    private readonly messaging: MessageDispatcher,
  ) {}

  async registerDevice(
    actor: AuthUser,
    input: { token: string; platform?: 'android' | 'ios' | 'web' },
  ) {
    if (!input.token?.trim()) {
      throw new Error('token required');
    }
    return this.db.withTenant(actor.tenantId, async (client) => {
      await client.query(
        `INSERT INTO device_tokens (tenant_id, user_id, token, platform)
         VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid,
                 $1, $2, $3)
         ON CONFLICT (user_id, token) DO UPDATE SET
           last_seen_at = now(),
           platform = excluded.platform`,
        [actor.sub, input.token.trim(), input.platform ?? 'android'],
      );
      return { registered: true };
    });
  }

  async unregisterDevice(actor: AuthUser, token: string) {
    return this.db.withTenant(actor.tenantId, async (client) => {
      await client.query(
        `DELETE FROM device_tokens WHERE user_id = $1 AND token = $2`,
        [actor.sub, token],
      );
      return { removed: true };
    });
  }

  /**
   * Send to one user: try all device tokens (push), else SMS if phone, else email.
   */
  async notify(input: NotifyInput): Promise<{ channel: NotifyChannel; status: string }> {
    return this.db.withTenant(input.tenantId, async (client) => {
      const tokens = await client.query<{ token: string; platform: string }>(
        `SELECT token, platform FROM device_tokens WHERE user_id = $1`,
        [input.target.userId],
      );

      if (tokens.rowCount && tokens.rowCount > 0) {
        let anyOk = false;
        let lastErr: string | null = null;
        for (const t of tokens.rows) {
          try {
            await this.sendPush(t.token, t.platform, input);
            anyOk = true;
          } catch (err) {
            lastErr = err instanceof Error ? err.message : String(err);
            this.logger.warn(`push failed token=${t.token.slice(0, 12)}… ${lastErr}`);
          }
        }
        await this.log(client, {
          userId: input.target.userId,
          channel: 'push',
          kind: input.kind,
          title: input.title,
          body: input.body,
          payload: input.payload,
          status: anyOk ? 'sent' : 'failed',
          error: anyOk ? null : lastErr,
        });
        if (anyOk) return { channel: 'push', status: 'sent' };
        // fall through to SMS/email
      }

      if (input.target.phone) {
        try {
          await this.messaging.sendSms(
            input.target.phone,
            `${input.title}: ${input.body}`,
          );
          await this.log(client, {
            userId: input.target.userId,
            channel: 'sms',
            kind: input.kind,
            title: input.title,
            body: input.body,
            payload: input.payload,
            status: 'sent',
          });
          return { channel: 'sms', status: 'sent' };
        } catch (err) {
          await this.log(client, {
            userId: input.target.userId,
            channel: 'sms',
            kind: input.kind,
            title: input.title,
            body: input.body,
            payload: input.payload,
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (input.target.email) {
        try {
          await this.messaging.sendEmail(
            input.target.email,
            input.title,
            input.body,
          );
          await this.log(client, {
            userId: input.target.userId,
            channel: 'email',
            kind: input.kind,
            title: input.title,
            body: input.body,
            payload: input.payload,
            status: 'sent',
          });
          return { channel: 'email', status: 'sent' };
        } catch (err) {
          await this.log(client, {
            userId: input.target.userId,
            channel: 'email',
            kind: input.kind,
            title: input.title,
            body: input.body,
            payload: input.payload,
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
          });
          return { channel: 'email', status: 'failed' };
        }
      }

      await this.log(client, {
        userId: input.target.userId,
        channel: 'push',
        kind: input.kind,
        title: input.title,
        body: input.body,
        payload: input.payload,
        status: 'skipped',
        error: 'no device token, phone, or email',
      });
      return { channel: 'push', status: 'skipped' };
    });
  }

  /**
   * Stub push provider (E9-S01). Production swaps for FCM HTTP v1.
   * Expo push tokens (ExponentPushToken[…]) are logged as accepted.
   */
  private async sendPush(
    token: string,
    platform: string,
    input: NotifyInput,
  ): Promise<void> {
    this.logger.log(
      `PUSH platform=${platform} token=${token.slice(0, 24)}… kind=${input.kind} title="${input.title}"`,
    );
    // Simulate provider acceptance; real FCM would POST here.
    if (!token.trim()) throw new Error('empty token');
  }

  private async log(
    client: PoolClient,
    entry: {
      userId: string | null;
      channel: NotifyChannel;
      kind: string;
      title: string;
      body: string;
      payload?: Record<string, unknown>;
      status: 'sent' | 'failed' | 'skipped';
      error?: string | null;
    },
  ) {
    await client.query(
      `INSERT INTO notification_log
         (tenant_id, user_id, channel, kind, title, body, payload, status, error)
       VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid,
               $1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        entry.userId,
        entry.channel,
        entry.kind,
        entry.title,
        entry.body,
        JSON.stringify(entry.payload ?? {}),
        entry.status,
        entry.error ?? null,
      ],
    );
  }

  /** Claim a dedupe slot; returns false if already sent today. */
  async claimDedupe(
    tenantId: string,
    kind: string,
    subjectKey: string,
    day: string,
  ): Promise<boolean> {
    return this.db.withTenant(tenantId, async (client) => {
      const r = await client.query(
        `INSERT INTO notification_dedupe (tenant_id, kind, subject_key, day)
         VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid,
                 $1, $2, $3::date)
         ON CONFLICT DO NOTHING
         RETURNING 1`,
        [kind, subjectKey, day],
      );
      return (r.rowCount ?? 0) > 0;
    });
  }
}
