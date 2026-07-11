-- Up Migration

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE worker_status AS ENUM ('active', 'pending_approval', 'deactivated');

CREATE TABLE workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  full_name text NOT NULL,
  nickname text,
  photo_key text,
  position text,
  daily_rate numeric(10,2) CHECK (daily_rate >= 0),
  phone text,
  -- Optional government ID, AES-256 at rest via pgp_sym_encrypt (NFR-5).
  gov_id_enc bytea,
  start_date date,
  end_date date,
  status worker_status NOT NULL DEFAULT 'active',
  -- Biometric pipeline: none → pending (photos captured, template not yet
  -- generated) → enrolled (provider template exists).
  biometric_status text NOT NULL DEFAULT 'none'
    CHECK (biometric_status IN ('none', 'pending', 'enrolled')),
  face_provider text,
  -- Provider face/template id, encrypted at rest like the gov ID.
  face_id_enc bytea,
  face_indexed_at timestamptz,
  retention_until timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workers_tenant_idx ON workers (tenant_id, status);

ALTER TABLE workers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workers
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON workers TO presente_app;

-- E2-S04: worker rosters per site (a worker may be on several).
CREATE TABLE site_workers (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  worker_id uuid NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  PRIMARY KEY (site_id, worker_id)
);

CREATE INDEX site_workers_worker_idx ON site_workers (worker_id);

ALTER TABLE site_workers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON site_workers
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, DELETE ON site_workers TO presente_app;

-- E3-S06: consent records are legal artifacts — insert-only for the app
-- role, retained even after biometric deletion (NFR-5).
CREATE TABLE consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  worker_id uuid NOT NULL REFERENCES workers(id),
  type text NOT NULL CHECK (type IN ('signature', 'paper')),
  artifact_key text NOT NULL,
  stroke_data jsonb,
  language text NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'tl')),
  engineer_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX consents_worker_idx ON consents (worker_id);

ALTER TABLE consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON consents
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT ON consents TO presente_app;

-- E3-S07/S09: the 4-pose enrollment shots; deletable for E3-S12 purge.
CREATE TABLE enrollment_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  worker_id uuid NOT NULL REFERENCES workers(id),
  pose text NOT NULL CHECK (pose IN ('front', 'left', 'right', 'hard_hat')),
  storage_key text NOT NULL,
  sha256 text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX enrollment_photos_worker_idx ON enrollment_photos (worker_id);

ALTER TABLE enrollment_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON enrollment_photos
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, DELETE ON enrollment_photos TO presente_app;

-- E3-S11: tenant-configurable biometric retention (default 12 months).
ALTER TABLE company_settings
  ADD COLUMN biometric_retention_months int NOT NULL DEFAULT 12
  CHECK (biometric_retention_months BETWEEN 1 AND 120);

-- Down Migration

ALTER TABLE company_settings DROP COLUMN biometric_retention_months;
DROP TABLE enrollment_photos;
DROP TABLE consents;
DROP TABLE site_workers;
DROP TABLE workers;
DROP TYPE worker_status;
