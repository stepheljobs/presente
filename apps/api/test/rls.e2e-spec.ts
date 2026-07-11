import { Pool, PoolClient } from 'pg';

const OWNER_URL =
  process.env.TEST_OWNER_DATABASE_URL ??
  'postgres://localhost:5432/presente_test';
const APP_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://presente_app:presente_app_dev@localhost:5432/presente_test';

describe('E0-S01 row-level security', () => {
  const owner = new Pool({ connectionString: OWNER_URL });
  const app = new Pool({ connectionString: APP_URL });
  let tenantA: string;
  let tenantB: string;

  const asTenant = async <T>(
    tenantId: string | null,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> => {
    const client = await app.connect();
    try {
      await client.query('BEGIN');
      if (tenantId) {
        await client.query('SELECT set_config($1, $2, true)', [
          'app.tenant_id',
          tenantId,
        ]);
      }
      return await fn(client);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  };

  beforeAll(async () => {
    await owner.query('TRUNCATE users, tenants CASCADE');
    const tenants = await owner.query(
      `INSERT INTO tenants (name) VALUES ('Alpha Builders'), ('Beta Construction') RETURNING id`,
    );
    tenantA = tenants.rows[0].id;
    tenantB = tenants.rows[1].id;
    await owner.query(
      `INSERT INTO users (tenant_id, email, password_hash, role) VALUES
       ($1, 'owner-a@example.com', 'x', 'owner'),
       ($2, 'owner-b@example.com', 'x', 'owner')`,
      [tenantA, tenantB],
    );
  });

  afterAll(async () => {
    await owner.query('TRUNCATE users, tenants CASCADE');
    await owner.end();
    await app.end();
  });

  it('sees only own-tenant rows inside tenant context', async () => {
    const rows = await asTenant(tenantA, async (c) => {
      const r = await c.query('SELECT email FROM users');
      return r.rows;
    });
    expect(rows).toEqual([{ email: 'owner-a@example.com' }]);
  });

  it('cross-tenant SELECT by id returns zero rows', async () => {
    const count = await asTenant(tenantA, async (c) => {
      const r = await c.query(
        'SELECT * FROM users WHERE email = $1',
        ['owner-b@example.com'],
      );
      return r.rowCount;
    });
    expect(count).toBe(0);
  });

  it('returns zero rows when no tenant context is set', async () => {
    const count = await asTenant(null, async (c) => {
      const r = await c.query('SELECT * FROM users');
      return r.rowCount;
    });
    expect(count).toBe(0);
  });

  it('rejects INSERT for a different tenant (WITH CHECK)', async () => {
    await expect(
      asTenant(tenantA, (c) =>
        c.query(
          `INSERT INTO users (tenant_id, email, password_hash, role)
           VALUES ($1, 'intruder@example.com', 'x', 'engineer')`,
          [tenantB],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('tenants table only exposes the current tenant', async () => {
    const rows = await asTenant(tenantA, async (c) => {
      const r = await c.query('SELECT name FROM tenants');
      return r.rows;
    });
    expect(rows).toEqual([{ name: 'Alpha Builders' }]);
  });
});
