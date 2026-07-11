-- Up Migration

-- E6-S01: one day-record per worker/date/site (transfer → multiple sites same day).
CREATE TABLE day_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  worker_id uuid NOT NULL REFERENCES workers(id),
  site_id uuid REFERENCES sites(id),
  day date NOT NULL,
  time_in timestamptz,
  time_out timestamptz,
  hours numeric(6,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'absent'
    CHECK (status IN ('present', 'halfday', 'absent', 'ot_candidate')),
  source text NOT NULL DEFAULT 'photo'
    CHECK (source IN ('photo', 'manual', 'corrected', 'no_biometric')),
  no_biometric_consent boolean NOT NULL DEFAULT false,
  -- Session UUIDs that contributed photos/tags to this day segment.
  session_ids uuid[] NOT NULL DEFAULT '{}',
  photo_ids uuid[] NOT NULL DEFAULT '{}',
  within_fence boolean,
  mock_location boolean,
  geofence_distance_m int,
  admin_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, worker_id, day, site_id)
);

CREATE INDEX day_records_day_idx ON day_records (tenant_id, day);
CREATE INDEX day_records_worker_idx ON day_records (worker_id, day);

ALTER TABLE day_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON day_records
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON day_records TO presente_app;

-- E6-S05/S06: engineer correction requests.
CREATE TABLE correction_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  day_record_id uuid REFERENCES day_records(id) ON DELETE SET NULL,
  worker_id uuid NOT NULL REFERENCES workers(id),
  site_id uuid REFERENCES sites(id),
  day date NOT NULL,
  engineer_id uuid NOT NULL REFERENCES users(id),
  proposed jsonb NOT NULL,
  reason text NOT NULL,
  photo_key text,
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'approved', 'rejected')),
  review_note text,
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX correction_requests_status_idx
  ON correction_requests (tenant_id, status, created_at DESC);

ALTER TABLE correction_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON correction_requests
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON correction_requests TO presente_app;

-- E6-S08: permanent marker for consent-declined / manual-attendance workers.
ALTER TABLE workers
  ADD COLUMN no_biometric_consent boolean NOT NULL DEFAULT false;

-- Exception types used by transfer visibility + weekly no-biometric digest.
ALTER TABLE exceptions DROP CONSTRAINT IF EXISTS exceptions_type_check;
ALTER TABLE exceptions ADD CONSTRAINT exceptions_type_check CHECK (type IN (
  'missing_time_out', 'missing_time_in', 'manual_tag',
  'recognition_disagreement', 'geofence', 'mock_location',
  'clock_drift', 'enrollment_approval', 'correction_request',
  'site_transfer', 'no_biometric_consent'
));

-- Down Migration

ALTER TABLE exceptions DROP CONSTRAINT IF EXISTS exceptions_type_check;
ALTER TABLE exceptions ADD CONSTRAINT exceptions_type_check CHECK (type IN (
  'missing_time_out', 'missing_time_in', 'manual_tag',
  'recognition_disagreement', 'geofence', 'mock_location',
  'clock_drift', 'enrollment_approval', 'correction_request'
));
ALTER TABLE workers DROP COLUMN no_biometric_consent;
DROP TABLE correction_requests;
DROP TABLE day_records;
