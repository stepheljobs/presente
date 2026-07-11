import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { AuditService } from '../audit/audit.service';
import type { AuthUser, Role } from '../auth/roles';
import { DatabaseService } from '../database/database.service';
import { MESSAGE_DISPATCHER } from '../messaging/dispatcher';
import type { MessageDispatcher } from '../messaging/dispatcher';

export const INVITE_TTL_DAYS = 7;

interface InviteRow {
  id: string;
  email: string;
  role: Role;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
  created_at?: Date;
}

interface InviteLookupRow extends InviteRow {
  tenant_id: string;
  company_name: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function isUsable(invite: InviteRow): boolean {
  return (
    !invite.accepted_at &&
    !invite.revoked_at &&
    invite.expires_at.getTime() > Date.now()
  );
}

@Injectable()
export class InvitesService {
  private readonly webUrl: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly jwtService: JwtService,
    config: ConfigService,
    @Inject(MESSAGE_DISPATCHER)
    private readonly dispatcher: MessageDispatcher,
  ) {
    this.webUrl = config.get('WEB_URL', 'http://localhost:5173');
  }

  /** E1-S05: create invite + email the accept link. Admins can invite
   * engineers; only the Owner can invite another Admin. */
  async create(
    actor: AuthUser,
    dto: { email: string; role: 'admin' | 'engineer'; phone?: string },
  ) {
    if (dto.role === 'admin' && actor.role !== 'owner') {
      throw new ForbiddenException('Only the Owner can invite Admins');
    }

    const token = randomBytes(32).toString('base64url');
    const invite = await this.db.withTenant(actor.tenantId, async (client) => {
      const existingUser = await client.query(
        'SELECT 1 FROM users WHERE lower(email) = lower($1)',
        [dto.email],
      );
      if (existingUser.rowCount) {
        throw new ConflictException('That email already has an account');
      }
      const result = await client.query<InviteRow>(
        `INSERT INTO invites (tenant_id, email, phone, role, token_hash,
                              invited_by, expires_at)
         VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid,
                 lower($1), $2, $3, $4, $5,
                 now() + make_interval(days => $6))
         RETURNING id, email, role, expires_at, accepted_at, revoked_at, created_at`,
        [dto.email, dto.phone ?? null, dto.role, hashToken(token), actor.sub, INVITE_TTL_DAYS],
      );
      await this.audit.log(client, {
        actor: actor.sub,
        action: 'invite.create',
        entity: `invite:${result.rows[0].id}`,
        after: { email: dto.email, role: dto.role },
      });
      return result.rows[0];
    });

    const link = `${this.webUrl}/accept-invite?token=${token}`;
    await this.dispatcher.sendEmail(
      dto.email,
      `You're invited to Presente`,
      `You've been invited to join Presente as ${dto.role}. Accept here (expires in ${INVITE_TTL_DAYS} days): ${link}`,
    );
    return this.toDto(invite);
  }

  async list(actor: AuthUser) {
    return this.db.withTenant(actor.tenantId, async (client) => {
      const result = await client.query<InviteRow>(
        `SELECT id, email, role, expires_at, accepted_at, revoked_at, created_at
         FROM invites ORDER BY created_at DESC`,
      );
      return result.rows.map((r) => this.toDto(r));
    });
  }

  /** E1-S05: revocable by Owner. */
  async revoke(actor: AuthUser, id: string) {
    await this.db.withTenant(actor.tenantId, async (client) => {
      const result = await client.query(
        `UPDATE invites SET revoked_at = now()
         WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL`,
        [id],
      );
      if (result.rowCount === 0) {
        throw new NotFoundException('No pending invite with that id');
      }
      await this.audit.log(client, {
        actor: actor.sub,
        action: 'invite.revoke',
        entity: `invite:${id}`,
      });
    });
    return { revoked: true };
  }

  /** Public: accept-page details. */
  async describe(token: string) {
    const invite = await this.lookup(token);
    if (!invite || !isUsable(invite)) {
      throw new NotFoundException('This invite link is invalid or expired');
    }
    return {
      email: invite.email,
      role: invite.role,
      companyName: invite.company_name,
    };
  }

  /** E1-S07: set password, activate, start a session; token single-use. */
  async accept(token: string, password: string) {
    const invite = await this.lookup(token);
    if (!invite || !isUsable(invite)) {
      throw new NotFoundException('This invite link is invalid or expired');
    }

    const passwordHash = await argon2.hash(password);
    let created: { user_id: string; tenant_id: string; email: string; role: Role };
    try {
      const result = await this.db.query<{
        user_id: string;
        tenant_id: string;
        email: string;
        role: Role;
      }>('SELECT * FROM invite_accept($1, $2)', [
        hashToken(token),
        passwordHash,
      ]);
      created = result.rows[0];
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e.code === '23505') {
        throw new ConflictException('That email already has an account');
      }
      if (e.message?.includes('invite_invalid')) {
        throw new BadRequestException('This invite link is invalid or expired');
      }
      throw err;
    }

    await this.db.withTenant(created.tenant_id, (client) =>
      this.audit.log(client, {
        actor: created.user_id,
        action: 'invite.accept',
        entity: `invite:${invite.id}`,
      }),
    );

    const payload: AuthUser = {
      sub: created.user_id,
      tenantId: created.tenant_id,
      email: created.email,
      role: created.role,
    };
    return {
      accessToken: this.jwtService.sign(payload),
      user: { id: created.user_id, email: created.email, role: created.role },
    };
  }

  private async lookup(token: string): Promise<InviteLookupRow | undefined> {
    const result = await this.db.query<InviteLookupRow>(
      'SELECT * FROM invite_lookup($1)',
      [hashToken(token)],
    );
    return result.rows[0];
  }

  private toDto(row: InviteRow) {
    return {
      id: row.id,
      email: row.email,
      role: row.role,
      expiresAt: row.expires_at.toISOString(),
      status: row.accepted_at
        ? 'accepted'
        : row.revoked_at
          ? 'revoked'
          : row.expires_at.getTime() <= Date.now()
            ? 'expired'
            : 'pending',
    };
  }
}
