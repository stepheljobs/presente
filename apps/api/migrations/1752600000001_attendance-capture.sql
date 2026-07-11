-- Up Migration

-- E4-S05/S06/S07: GPS fix, geofence result, and mock-location flag live on
-- the session. Flags never block capture (FR-17/FR-18) — they feed the
-- exception queue.
ALTER TABLE attendance_sessions
  ADD COLUMN lat double precision,
  ADD COLUMN lng double precision,
  ADD COLUMN gps_status text NOT NULL DEFAULT 'no_fix'
    CHECK (gps_status IN ('fix', 'no_fix')),
  ADD COLUMN distance_m int,
  ADD COLUMN within_fence boolean,
  ADD COLUMN mock_location boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT attendance_sessions_site_fk
    FOREIGN KEY (site_id) REFERENCES sites(id);

-- E4-S04/S08/S09: photos bound to a session; client hash recorded at
-- capture, tamper_flag set when server-side re-hash mismatches.
CREATE TABLE session_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  session_id uuid NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  storage_key text NOT NULL,
  sha256_client text,
  tamper_flag boolean NOT NULL DEFAULT false,
  recognition_status text NOT NULL DEFAULT 'pending'
    CHECK (recognition_status IN ('pending', 'done', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX session_photos_session_idx ON session_photos (session_id);

ALTER TABLE session_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON session_photos
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON session_photos TO presente_app;

-- E4-S09..S15/S17: one row per face decision. status 'ignored_duplicate'
-- implements duplicate time-in protection (earliest-in retained).
CREATE TABLE session_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  session_id uuid NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  photo_id uuid REFERENCES session_photos(id) ON DELETE CASCADE,
  worker_id uuid REFERENCES workers(id),
  band text CHECK (band IN ('high', 'confirm', 'unrecognized')),
  confidence numeric(4,3),
  source text NOT NULL
    CHECK (source IN ('auto', 'confirmed', 'manual', 'visitor')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'pending_confirm', 'rejected', 'ignored_duplicate')),
  notice jsonb,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX session_tags_session_idx ON session_tags (session_id);
CREATE INDEX session_tags_worker_idx ON session_tags (worker_id, created_at);

ALTER TABLE session_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON session_tags
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON session_tags TO presente_app;

-- E4-S21: recognition between a marked pair is forced to confirm-band.
CREATE TABLE lookalike_pairs (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  worker_a uuid NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  worker_b uuid NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (worker_a, worker_b),
  CHECK (worker_a < worker_b)
);

ALTER TABLE lookalike_pairs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON lookalike_pairs
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, DELETE ON lookalike_pairs TO presente_app;

-- E8-S04 (pulled forward — E4-S19 depends on it): single typed exception
-- queue. Severity: 1 highest.
CREATE TABLE exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  type text NOT NULL CHECK (type IN (
    'missing_time_out', 'missing_time_in', 'manual_tag',
    'recognition_disagreement', 'geofence', 'mock_location',
    'clock_drift', 'enrollment_approval', 'correction_request'
  )),
  severity int NOT NULL DEFAULT 3 CHECK (severity BETWEEN 1 AND 5),
  worker_id uuid REFERENCES workers(id),
  session_id uuid REFERENCES attendance_sessions(id),
  site_id uuid REFERENCES sites(id),
  day date,
  note text,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved', 'waived')),
  resolved_by uuid REFERENCES users(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX exceptions_queue_idx ON exceptions (tenant_id, status, severity, created_at);
-- One exception per (type, worker, site, day) regardless of status keeps
-- the sweep idempotent and lets left-early notes suppress regeneration.
CREATE UNIQUE INDEX exceptions_dedupe_idx
  ON exceptions (tenant_id, type, worker_id, site_id, day)
  WHERE worker_id IS NOT NULL AND day IS NOT NULL;

ALTER TABLE exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON exceptions
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON exceptions TO presente_app;

-- E4-S10: tenant-tunable confidence bands (NFR-3); NFR-8 timezone.
ALTER TABLE company_settings
  ADD COLUMN recognition_high_threshold numeric(4,3) NOT NULL DEFAULT 0.900,
  ADD COLUMN recognition_confirm_threshold numeric(4,3) NOT NULL DEFAULT 0.700,
  ADD COLUMN timezone text NOT NULL DEFAULT 'Asia/Manila',
  ADD CONSTRAINT recognition_band_order
    CHECK (recognition_confirm_threshold < recognition_high_threshold);

-- The nightly exception sweep (E4-S19) iterates tenants outside any tenant
-- context; expose ids only.
CREATE FUNCTION list_tenant_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$ SELECT id FROM tenants $$;

REVOKE ALL ON FUNCTION list_tenant_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_tenant_ids() TO presente_app;

-- Down Migration

DROP FUNCTION list_tenant_ids();
ALTER TABLE company_settings
  DROP COLUMN recognition_high_threshold,
  DROP COLUMN recognition_confirm_threshold,
  DROP COLUMN timezone;
DROP TABLE exceptions;
DROP TABLE lookalike_pairs;
DROP TABLE session_tags;
DROP TABLE session_photos;
ALTER TABLE attendance_sessions
  DROP CONSTRAINT attendance_sessions_site_fk,
  DROP COLUMN lat, DROP COLUMN lng, DROP COLUMN gps_status,
  DROP COLUMN distance_m, DROP COLUMN within_fence, DROP COLUMN mock_location;
