import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Pool } from 'pg';
import request from 'supertest';
import {
  MESSAGE_DISPATCHER,
  MessageDispatcher,
} from '../src/messaging/dispatcher';
import { createTestApp, ownerPool } from './helpers';

class CapturingDispatcher implements MessageDispatcher {
  emails: { to: string; body: string }[] = [];
  async sendEmail(to: string, _subject: string, body: string) {
    this.emails.push({ to, body });
  }
  async sendSms() {}

  lastLinkTokenFor(email: string): string {
    const body = [...this.emails].reverse().find((e) => e.to === email)?.body;
    const token = body && /token=([A-Za-z0-9_-]+)/.exec(body)?.[1];
    if (!token) throw new Error(`no invite link sent to ${email}`);
    return token;
  }
}

describe('E1-S05/S07 invites + acceptance', () => {
  let app: INestApplication;
  let owner: Pool;
  let ownerToken: string;
  let adminToken: string;
  const dispatcher = new CapturingDispatcher();

  beforeAll(async () => {
    owner = ownerPool();
    await owner.query('TRUNCATE invites, otp_codes, audit_log, users, tenants CASCADE');
    const t = await owner.query(
      `INSERT INTO tenants (name) VALUES ('Alpha Builders') RETURNING id`,
    );
    const tenantId = t.rows[0].id;
    const users = await owner.query(
      `INSERT INTO users (tenant_id, email, password_hash, role) VALUES
       ($1, 'owner@alpha.ph', 'x', 'owner'),
       ($1, 'admin@alpha.ph', 'x', 'admin') RETURNING id, email, role`,
      [tenantId],
    );
    app = await createTestApp((builder) =>
      builder.overrideProvider(MESSAGE_DISPATCHER).useValue(dispatcher),
    );
    const jwt = app.get(JwtService);
    ownerToken = jwt.sign({
      sub: users.rows[0].id,
      tenantId,
      email: 'owner@alpha.ph',
      role: 'owner',
    });
    adminToken = jwt.sign({
      sub: users.rows[1].id,
      tenantId,
      email: 'admin@alpha.ph',
      role: 'admin',
    });
  });

  afterAll(async () => {
    await owner.query('TRUNCATE invites, otp_codes, audit_log, users, tenants CASCADE');
    await owner.end();
    await app.close();
  });

  const invite = (token: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/invites')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  it('owner invites an engineer; email carries a 7-day accept link', async () => {
    const res = await invite(ownerToken, {
      email: 'ramon@site.ph',
      role: 'engineer',
    }).expect(201);
    expect(res.body.status).toBe('pending');
    const days =
      (Date.parse(res.body.expiresAt) - Date.now()) / (24 * 3600 * 1000);
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
    expect(dispatcher.lastLinkTokenFor('ramon@site.ph')).toBeTruthy();
  });

  it('public token endpoint describes the invite', async () => {
    const token = dispatcher.lastLinkTokenFor('ramon@site.ph');
    const res = await request(app.getHttpServer())
      .get(`/invites/token/${token}`)
      .expect(200);
    expect(res.body).toEqual({
      email: 'ramon@site.ph',
      role: 'engineer',
      companyName: 'Alpha Builders',
    });
  });

  it('accept sets password, activates the user, and starts a session', async () => {
    const token = dispatcher.lastLinkTokenFor('ramon@site.ph');
    const res = await request(app.getHttpServer())
      .post(`/invites/token/${token}/accept`)
      .send({ password: 'engineer-pass-1' })
      .expect(200);
    expect(res.body.user.role).toBe('engineer');
    expect(res.body.accessToken).toBeDefined();

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'ramon@site.ph', password: 'engineer-pass-1' })
      .expect(200);
  });

  it('a used token cannot be reused', async () => {
    const token = dispatcher.lastLinkTokenFor('ramon@site.ph');
    await request(app.getHttpServer())
      .post(`/invites/token/${token}/accept`)
      .send({ password: 'another-pass-123' })
      .expect(404);
  });

  it('admin may invite engineers but not admins', async () => {
    await invite(adminToken, { email: 'eng2@site.ph', role: 'engineer' })
      .expect(201);
    await invite(adminToken, { email: 'admin2@site.ph', role: 'admin' })
      .expect(403);
    await invite(ownerToken, { email: 'admin2@site.ph', role: 'admin' })
      .expect(201);
  });

  it('owner can revoke a pending invite; revoked token stops working', async () => {
    await invite(ownerToken, { email: 'gone@site.ph', role: 'engineer' })
      .expect(201);
    const token = dispatcher.lastLinkTokenFor('gone@site.ph');
    const list = await request(app.getHttpServer())
      .get('/invites')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const target = list.body.find(
      (i: { email: string }) => i.email === 'gone@site.ph',
    );

    // Admin cannot revoke (Owner-only per AC).
    await request(app.getHttpServer())
      .delete(`/invites/${target.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/invites/${target.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/invites/token/${token}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/invites/token/${token}/accept`)
      .send({ password: 'whatever-123' })
      .expect(404);
  });

  it('expired invites cannot be accepted', async () => {
    await invite(ownerToken, { email: 'late@site.ph', role: 'engineer' })
      .expect(201);
    const token = dispatcher.lastLinkTokenFor('late@site.ph');
    await owner.query(
      `UPDATE invites SET expires_at = now() - interval '1 minute'
       WHERE email = 'late@site.ph'`,
    );
    await request(app.getHttpServer())
      .post(`/invites/token/${token}/accept`)
      .send({ password: 'too-late-12345' })
      .expect(404);
  });

  it('inviting an existing user is a friendly conflict', async () => {
    await invite(ownerToken, { email: 'admin@alpha.ph', role: 'engineer' })
      .expect(409);
  });
});
