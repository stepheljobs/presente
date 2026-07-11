-- Up Migration

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE user_role AS ENUM ('owner', 'admin', 'engineer');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role user_role NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX users_tenant_id_idx ON users (tenant_id);

-- Tenant isolation: every request runs inside a transaction that has executed
-- SET LOCAL app.tenant_id = '<uuid>'. Rows outside that tenant are invisible.
-- NULLIF guards the cast when the setting is absent or empty (policy → false).
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants
  USING (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON users
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- presente_app is a non-owner role, so RLS applies to everything it does.
GRANT SELECT ON tenants TO presente_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON users TO presente_app;

-- Down Migration

DROP TABLE users;
DROP TYPE user_role;
DROP TABLE tenants;
