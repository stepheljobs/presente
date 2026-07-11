import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import {
  MESSAGE_DISPATCHER,
  MessageDispatcher,
} from '../src/messaging/dispatcher';
import { createTestApp, ownerPool } from './helpers';

/** Captures dispatched messages so tests can read the OTP code. */
class CapturingDispatcher implements MessageDispatcher {
  emails: { to: string; body: string }[] = [];
  sms: { to: string; body: string }[] = [];

  async sendEmail(to: string, _subject: string, body: string) {
    this.emails.push({ to, body });
  }
  async sendSms(to: string, body: string) {
    this.sms.push({ to, body });
  }

  lastCodeFor(email: string): string {
    const body = [...this.emails].reverse().find((e) => e.to === email)?.body;
    const code = body && /\b(\d{6})\b/.exec(body)?.[1];
    if (!code) throw new Error(`no OTP dispatched to ${email}`);
    return code;
  }
}

describe('E1-S02/S03/S04 sign-up, OTP dispatch, verification', () => {
  let app: INestApplication;
  let owner: Pool;
  const dispatcher = new CapturingDispatcher();

  const signup = (email: string, extra: Record<string, unknown> = {}) =>
    request(app.getHttpServer()).post('/auth/signup').send({
      companyName: 'Bagong Tayo Builders',
      email,
      phone: '+63 917 555 0101',
      password: 'long-enough-password',
      ...extra,
    });

  beforeAll(async () => {
    owner = ownerPool();
    await owner.query(
      'TRUNCATE otp_codes, audit_log, attendance_sessions, users, tenants CASCADE',
    );
    app = await createTestApp((builder) =>
      builder.overrideProvider(MESSAGE_DISPATCHER).useValue(dispatcher),
    );
  });

  afterAll(async () => {
    await owner.query(
      'TRUNCATE otp_codes, audit_log, attendance_sessions, users, tenants CASCADE',
    );
    await owner.end();
    await app.close();
  });

  it('creates tenant + unverified owner and dispatches a 6-digit code', async () => {
    const res = await signup('maria@bagongtayo.ph').expect(201);
    expect(res.body.message).toBeDefined();

    const row = await owner.query(
      `SELECT u.status, u.role, t.name FROM users u
       JOIN tenants t ON t.id = u.tenant_id WHERE u.email = $1`,
      ['maria@bagongtayo.ph'],
    );
    expect(row.rows[0]).toEqual({
      status: 'unverified',
      role: 'owner',
      name: 'Bagong Tayo Builders',
    });
    expect(dispatcher.lastCodeFor('maria@bagongtayo.ph')).toMatch(/^\d{6}$/);
    expect(dispatcher.sms.length).toBeGreaterThan(0);
  });

  it('rejects duplicate email with a friendly conflict', async () => {
    const res = await signup('maria@bagongtayo.ph').expect(409);
    expect(res.body.message).toContain('already exists');
  });

  it('blocks login while unverified', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'maria@bagongtayo.ph', password: 'long-enough-password' })
      .expect(401);
  });

  it('wrong code errors; 5 wrong attempts lock the code', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .post('/auth/verify-otp')
        .send({ email: 'maria@bagongtayo.ph', code: '000000' })
        .expect(400);
    }
    // 6th attempt hits the lockout, even with the right code.
    const code = dispatcher.lastCodeFor('maria@bagongtayo.ph');
    await request(app.getHttpServer())
      .post('/auth/verify-otp')
      .send({ email: 'maria@bagongtayo.ph', code })
      .expect(429);
  });

  it('resend issues a fresh code; correct code activates and starts a session', async () => {
    await request(app.getHttpServer())
      .post('/auth/resend-otp')
      .send({ email: 'maria@bagongtayo.ph' })
      .expect(200);

    const code = dispatcher.lastCodeFor('maria@bagongtayo.ph');
    const res = await request(app.getHttpServer())
      .post('/auth/verify-otp')
      .send({ email: 'maria@bagongtayo.ph', code })
      .expect(200);

    expect(res.body.accessToken).toBeDefined();
    expect(res.body.user.role).toBe('owner');

    const status = await owner.query(
      'SELECT status FROM users WHERE email = $1',
      ['maria@bagongtayo.ph'],
    );
    expect(status.rows[0].status).toBe('active');

    // And login now works too.
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'maria@bagongtayo.ph', password: 'long-enough-password' })
      .expect(200);
  });

  it('rate-limits to 3 sends per hour', async () => {
    await signup('rate@limit.ph').expect(201); // send #1
    await request(app.getHttpServer())
      .post('/auth/resend-otp')
      .send({ email: 'rate@limit.ph' })
      .expect(200); // #2
    await request(app.getHttpServer())
      .post('/auth/resend-otp')
      .send({ email: 'rate@limit.ph' })
      .expect(200); // #3
    await request(app.getHttpServer())
      .post('/auth/resend-otp')
      .send({ email: 'rate@limit.ph' })
      .expect(429); // over the limit
  });

  it('a used code cannot be replayed', async () => {
    await signup('replay@test.ph').expect(201);
    const code = dispatcher.lastCodeFor('replay@test.ph');
    await request(app.getHttpServer())
      .post('/auth/verify-otp')
      .send({ email: 'replay@test.ph', code })
      .expect(200);
    await request(app.getHttpServer())
      .post('/auth/verify-otp')
      .send({ email: 'replay@test.ph', code })
      .expect(400);
  });
});
