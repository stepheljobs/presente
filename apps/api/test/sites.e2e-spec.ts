import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Pool } from 'pg';
import request from 'supertest';
import { createTestApp, ownerPool } from './helpers';

// Two BGC-area sites and one far site in Quezon City.
const BGC_A = { lat: 14.5513, lng: 121.0498 };
const BGC_B = { lat: 14.5547, lng: 121.0244 };
const QC = { lat: 14.676, lng: 121.0437 };

describe('E2 sites: CRUD, assignment, archive, nearest', () => {
  let app: INestApplication;
  let owner: Pool;
  let adminToken: string;
  let engineerToken: string;
  let engineerId: string;
  let siteA: string;
  let siteB: string;
  let siteFar: string;

  const authed = (method: 'get' | 'post' | 'put', path: string, token: string) =>
    request(app.getHttpServer())[method](path).set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    owner = ownerPool();
    await owner.query(
      'TRUNCATE site_engineers, sites, invites, audit_log, users, tenants CASCADE',
    );
    const t = await owner.query(
      `INSERT INTO tenants (name) VALUES ('Alpha Builders') RETURNING id`,
    );
    const tenantId = t.rows[0].id;
    const users = await owner.query(
      `INSERT INTO users (tenant_id, email, password_hash, role) VALUES
       ($1, 'admin@alpha.ph', 'x', 'admin'),
       ($1, 'eng@alpha.ph', 'x', 'engineer') RETURNING id`,
      [tenantId],
    );
    engineerId = users.rows[1].id;
    app = await createTestApp();
    const jwt = app.get(JwtService);
    adminToken = jwt.sign({
      sub: users.rows[0].id,
      tenantId,
      email: 'admin@alpha.ph',
      role: 'admin',
    });
    engineerToken = jwt.sign({
      sub: engineerId,
      tenantId,
      email: 'eng@alpha.ph',
      role: 'engineer',
    });
  });

  afterAll(async () => {
    await owner.query(
      'TRUNCATE site_engineers, sites, invites, audit_log, users, tenants CASCADE',
    );
    await owner.end();
    await app.close();
  });

  it('creates sites with default radius applied by DTO and clamps enforced', async () => {
    const a = await authed('post', '/sites', adminToken)
      .send({ name: 'Tower A', client: 'Ayala', radiusM: 150, ...BGC_A })
      .expect(201);
    siteA = a.body.id;
    expect(a.body.radiusM).toBe(150);
    expect(a.body.archived).toBe(false);

    const b = await authed('post', '/sites', adminToken)
      .send({ name: 'Tower B', radiusM: 300, ...BGC_B })
      .expect(201);
    siteB = b.body.id;

    const far = await authed('post', '/sites', adminToken)
      .send({ name: 'QC Warehouse', radiusM: 500, ...QC })
      .expect(201);
    siteFar = far.body.id;

    // Radius outside 50–1,000 m rejected.
    await authed('post', '/sites', adminToken)
      .send({ name: 'Bad', radiusM: 30, ...BGC_A })
      .expect(400);
    await authed('post', '/sites', adminToken)
      .send({ name: 'Bad', radiusM: 1500, ...BGC_A })
      .expect(400);
  });

  it('engineer cannot create sites', async () => {
    await authed('post', '/sites', engineerToken)
      .send({ name: 'Rogue', radiusM: 150, ...BGC_A })
      .expect(403);
  });

  it('engineer sees only assigned sites (API filter proven)', async () => {
    let list = await authed('get', '/sites', engineerToken).expect(200);
    expect(list.body).toEqual([]);

    await authed('put', `/sites/${siteA}/engineers`, adminToken)
      .send({ userIds: [engineerId] })
      .expect(200);
    await authed('put', `/sites/${siteFar}/engineers`, adminToken)
      .send({ userIds: [engineerId] })
      .expect(200);

    list = await authed('get', '/sites', engineerToken).expect(200);
    expect(list.body.map((s: { name: string }) => s.name).sort()).toEqual([
      'QC Warehouse',
      'Tower A',
    ]);

    // Admin sees all three.
    const all = await authed('get', '/sites', adminToken).expect(200);
    expect(all.body).toHaveLength(3);
  });

  it('non-engineer users are ignored in assignment', async () => {
    const admins = await owner.query(
      `SELECT id FROM users WHERE email = 'admin@alpha.ph'`,
    );
    const res = await authed('put', `/sites/${siteB}/engineers`, adminToken)
      .send({ userIds: [admins.rows[0].id] })
      .expect(200);
    expect(res.body.engineerIds).toEqual([]);
  });

  it('nearest returns assigned sites sorted by distance with meters', async () => {
    const res = await authed(
      'get',
      `/sites/nearest?lat=${BGC_A.lat}&lng=${BGC_A.lng}`,
      engineerToken,
    ).expect(200);
    expect(res.body.map((s: { name: string }) => s.name)).toEqual([
      'Tower A',
      'QC Warehouse',
    ]);
    expect(res.body[0].distanceM).toBeLessThan(50);
    expect(res.body[1].distanceM).toBeGreaterThan(10_000);
  });

  it('archive hides from engineer picker, keeps admin visibility, unarchive restores', async () => {
    await authed('post', `/sites/${siteA}/archive`, adminToken).expect(201);

    const engineerList = await authed('get', '/sites', engineerToken).expect(200);
    expect(engineerList.body.map((s: { name: string }) => s.name)).toEqual([
      'QC Warehouse',
    ]);

    const adminList = await authed('get', '/sites', adminToken).expect(200);
    const archived = adminList.body.find(
      (s: { id: string }) => s.id === siteA,
    );
    expect(archived.archived).toBe(true);

    await authed('post', `/sites/${siteA}/unarchive`, adminToken).expect(201);
    const restored = await authed('get', '/sites', engineerToken).expect(200);
    expect(restored.body).toHaveLength(2);
  });

  it('update edits fields and audits', async () => {
    await authed('put', `/sites/${siteB}`, adminToken)
      .send({ name: 'Tower B Phase 2', radiusM: 250, ...BGC_B })
      .expect(200);
    const audit = await owner.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE action LIKE 'site.%'`,
    );
    // create ×3, assign ×3, archive + unarchive, update.
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(9);
  });
});
