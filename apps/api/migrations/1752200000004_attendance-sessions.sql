-- Up Migration

CREATE TABLE attendance_sessions (
  -- Client-generated UUID: the idempotency key for offline sync (FR-22).
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  type text NOT NULL CHECK (type IN ('time_in', 'time_out')),
  site_id uuid,
  engineer_id uuid NOT NULL REFERENCES users(id),
  device_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Trusted time (E0-S10): device clock preserved, server clock authoritative.
  device_captured_at timestamptz NOT NULL,
  device_sent_at timestamptz NOT NULL,
  server_received_at timestamptz NOT NULL DEFAULT now(),
  clock_drift_seconds integer NOT NULL
);

CREATE INDEX attendance_sessions_tenant_idx ON attendance_sessions (tenant_id);

ALTER TABLE attendance_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON attendance_sessions
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON attendance_sessions TO presente_app;

-- Down Migration

DROP TABLE attendance_sessions;
