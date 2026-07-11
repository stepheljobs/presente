import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { createHash, randomInt } from 'crypto';
import { PoolClient } from 'pg';
import { MESSAGE_DISPATCHER } from '../messaging/dispatcher';
import type { MessageDispatcher } from '../messaging/dispatcher';

export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_SENDS_PER_HOUR = 3;
export const OTP_MAX_ATTEMPTS = 5;

interface OtpRow {
  id: string;
  code_hash: string;
  attempts: number;
  expires_at: Date;
  consumed_at: Date | null;
}

/** Codes are stored hashed; a leaked otp_codes row alone verifies nothing. */
function hashCode(userId: string, code: string): string {
  return createHash('sha256').update(`${userId}:${code}`).digest('hex');
}

@Injectable()
export class OtpService {
  constructor(
    @Inject(MESSAGE_DISPATCHER)
    private readonly dispatcher: MessageDispatcher,
  ) {}

  /**
   * Generates + dispatches a 6-digit code inside the caller's tenant
   * transaction. Rate-limited to 3 sends per rolling hour (E1-S03).
   */
  async issue(
    client: PoolClient,
    user: { id: string; email: string; phone: string | null },
  ): Promise<void> {
    const recent = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM otp_codes
       WHERE user_id = $1 AND created_at > now() - interval '1 hour'`,
      [user.id],
    );
    if (recent.rows[0].n >= OTP_MAX_SENDS_PER_HOUR) {
      throw new HttpException(
        'Too many codes requested — try again in an hour',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Invalidate earlier codes so only the newest one can verify.
    await client.query(
      `UPDATE otp_codes SET consumed_at = now()
       WHERE user_id = $1 AND consumed_at IS NULL`,
      [user.id],
    );

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await client.query(
      `INSERT INTO otp_codes (tenant_id, user_id, code_hash, expires_at)
       VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid,
               $1, $2, now() + make_interval(mins => $3))`,
      [user.id, hashCode(user.id, code), OTP_TTL_MINUTES],
    );

    const body = `Your Presente verification code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes.`;
    await this.dispatcher.sendEmail(user.email, 'Verify your Presente account', body);
    if (user.phone) {
      await this.dispatcher.sendSms(user.phone, body);
    }
  }

  /**
   * Checks a submitted code inside the caller's tenant transaction:
   * ≤5 attempts then lockout; expired codes prompt a resend (E1-S04).
   *
   * Returns an outcome instead of throwing so the attempt increment
   * COMMITS — an exception here would roll the counter back and make
   * lockout unreachable. The caller maps outcomes to HTTP errors after
   * the transaction closes.
   */
  async verify(
    client: PoolClient,
    userId: string,
    code: string,
  ): Promise<'ok' | 'expired' | 'locked' | 'incorrect'> {
    const result = await client.query<OtpRow>(
      `SELECT * FROM otp_codes
       WHERE user_id = $1 AND consumed_at IS NULL
       ORDER BY created_at DESC LIMIT 1
       FOR UPDATE`,
      [userId],
    );
    const otp = result.rows[0];

    if (!otp || otp.expires_at.getTime() <= Date.now()) {
      return 'expired';
    }
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      return 'locked';
    }
    if (otp.code_hash !== hashCode(userId, code)) {
      await client.query(
        'UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1',
        [otp.id],
      );
      return 'incorrect';
    }

    await client.query(
      'UPDATE otp_codes SET consumed_at = now() WHERE id = $1',
      [otp.id],
    );
    return 'ok';
  }
}

export function otpOutcomeToError(
  outcome: 'expired' | 'locked' | 'incorrect',
): HttpException {
  switch (outcome) {
    case 'expired':
      return new BadRequestException('Code expired — request a new one');
    case 'locked':
      return new HttpException(
        'Too many incorrect attempts — request a new code',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    case 'incorrect':
      return new BadRequestException('Incorrect code');
  }
}
