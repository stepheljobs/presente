-- Up Migration

CREATE TABLE sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  client text,
  address text,
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  -- Geofence radius in meters (FR-4): 50–1,000, default 150.
  radius_m int NOT NULL DEFAULT 150 CHECK (radius_m BETWEEN 50 AND 1000),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sites_tenant_idx ON sites (tenant_id);

ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sites
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON sites TO presente_app;

CREATE TABLE site_engineers (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (site_id, user_id)
);

CREATE INDEX site_engineers_user_idx ON site_engineers (user_id);

ALTER TABLE site_engineers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON site_engineers
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, DELETE ON site_engineers TO presente_app;

-- Down Migration

DROP TABLE site_engineers;
DROP TABLE sites;
