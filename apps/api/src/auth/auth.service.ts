import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { DatabaseService } from '../database/database.service';
import { OtpService, otpOutcomeToError } from './otp.service';
import { AuthUser, Role } from './roles';

// Verified when the email doesn't match any user, so response time doesn't
// reveal whether an account exists.
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$Bg32hiI8/lUXVAlZ7utIHw$O0n/lenCU+YsMi3s/FOe6UgMeKdMRLCxaL3XIB9tywU';

interface UserRow {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string;
  role: Role;
  status: string;
}

const SIGNUP_ACCEPTED_MESSAGE =
  'If this email is new, a verification code has been sent.';

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwtService: JwtService,
    private readonly otpService: OtpService,
  ) {}

  static hashPassword(password: string): Promise<string> {
    return argon2.hash(password);
  }

  async login(email: string, password: string) {
    const result = await this.db.query<UserRow>(
      'SELECT * FROM auth_lookup_user($1)',
      [email],
    );
    const user = result.rows[0];

    const valid = await argon2.verify(
      user?.password_hash ?? DUMMY_HASH,
      password,
    );
    if (!user || !valid || user.status !== 'active') {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.session(user);
  }

  /** E1-S02: create tenant + provisional (unverified) Owner, send OTP. */
  async signup(dto: {
    companyName: string;
    email: string;
    phone?: string;
    password: string;
  }) {
    const passwordHash = await argon2.hash(dto.password);
    let created: { tenant_id: string; user_id: string };
    try {
      const result = await this.db.query<{
        tenant_id: string;
        user_id: string;
      }>('SELECT * FROM signup_create_tenant($1, $2, $3, $4)', [
        dto.companyName,
        dto.email,
        dto.phone ?? null,
        passwordHash,
      ]);
      created = result.rows[0];
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException(
          'An account with this email already exists — try signing in instead.',
        );
      }
      throw err;
    }

    await this.db.withTenant(created.tenant_id, (client) =>
      this.otpService.issue(client, {
        id: created.user_id,
        email: dto.email.toLowerCase(),
        phone: dto.phone ?? null,
      }),
    );
    return { message: SIGNUP_ACCEPTED_MESSAGE };
  }

  /** E1-S04: correct OTP activates the Owner and starts a session. */
  async verifyOtp(email: string, code: string) {
    const user = await this.lookup(email);
    if (!user || user.status === 'disabled') {
      // Same shape as a wrong code — no account enumeration.
      throw otpOutcomeToError('incorrect');
    }

    const outcome = await this.db.withTenant(
      user.tenant_id,
      async (client) => {
        const result = await this.otpService.verify(client, user.id, code);
        if (result === 'ok' && user.status !== 'active') {
          await client.query(
            `UPDATE users SET status = 'active' WHERE id = $1`,
            [user.id],
          );
        }
        return result;
      },
    );

    if (outcome !== 'ok') throw otpOutcomeToError(outcome);
    return this.session(user);
  }

  /** E1-S04: expired OTP offers resend. Response is account-agnostic. */
  async resendOtp(email: string) {
    const user = await this.lookup(email);
    if (user && user.status === 'unverified') {
      await this.db.withTenant(user.tenant_id, (client) =>
        this.otpService.issue(client, {
          id: user.id,
          email: user.email,
          phone: null,
        }),
      );
    }
    return { message: SIGNUP_ACCEPTED_MESSAGE };
  }

  private async lookup(email: string): Promise<UserRow | undefined> {
    const result = await this.db.query<UserRow>(
      'SELECT * FROM auth_lookup_user($1)',
      [email],
    );
    return result.rows[0];
  }

  private session(user: UserRow) {
    const payload: AuthUser = {
      sub: user.id,
      tenantId: user.tenant_id,
      email: user.email,
      role: user.role,
    };
    return {
      accessToken: this.jwtService.sign(payload),
      user: { id: user.id, email: user.email, role: user.role },
    };
  }
}
