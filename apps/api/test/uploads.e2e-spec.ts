import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { createTestApp } from './helpers';

describe('E0-S04 signed upload URLs', () => {
  let app: INestApplication;
  let tenantId: string;
  let token: string;

  beforeAll(async () => {
    process.env.STORAGE_ENDPOINT = 'https://fsn1.your-objectstorage.com';
    process.env.STORAGE_REGION = 'fsn1';
    process.env.STORAGE_BUCKET = 'presente-test';
    process.env.STORAGE_ACCESS_KEY_ID = 'test-key';
    process.env.STORAGE_SECRET_ACCESS_KEY = 'test-secret';
    process.env.UPLOAD_URL_TTL_SECONDS = '900';
    app = await createTestApp();
    tenantId = randomUUID();
    token = app.get(JwtService).sign({
      sub: randomUUID(),
      tenantId,
      email: 'eng@alpha.ph',
      role: 'engineer',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a time-limited signed PUT URL under the tenant prefix', async () => {
    const res = await request(app.getHttpServer())
      .post('/uploads/sign')
      .set('Authorization', `Bearer ${token}`)
      .send({ category: 'session-photo', contentType: 'image/jpeg' })
      .expect(200);

    expect(res.body.key).toMatch(
      new RegExp(`^tenants/${tenantId}/session-photo/[0-9a-f-]{36}\\.jpg$`),
    );
    expect(res.body.expiresInSeconds).toBe(900);
    const url = new URL(res.body.url);
    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.pathname).toContain(`tenants/${tenantId}/`);
  });

  it('rejects disallowed content types and categories', async () => {
    await request(app.getHttpServer())
      .post('/uploads/sign')
      .set('Authorization', `Bearer ${token}`)
      .send({ category: 'session-photo', contentType: 'application/x-sh' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/uploads/sign')
      .set('Authorization', `Bearer ${token}`)
      .send({ category: 'malware', contentType: 'image/jpeg' })
      .expect(400);
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer())
      .post('/uploads/sign')
      .send({ category: 'session-photo', contentType: 'image/jpeg' })
      .expect(401);
  });
});
