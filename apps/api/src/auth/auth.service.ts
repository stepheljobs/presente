import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { DatabaseService } from '../database/database.service';
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

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwtService: JwtService,
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
