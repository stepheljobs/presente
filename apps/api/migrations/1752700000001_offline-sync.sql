-- Up Migration

-- E5-S06: sessions from a drifted device are flagged (never blocked).
ALTER TABLE attendance_sessions
  ADD COLUMN clock_drift_flagged boolean NOT NULL DEFAULT false;

-- E5-S05: admin lock on a worker-day. Late engineer tags for that day are
-- suppressed (engineer version audited) — admin version always wins (FR-22).
-- E6-S04 will write fuller before/after snapshots into the same table.
CREATE TABLE worker_day_admin_edits (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  worker_id uuid NOT NULL REFERENCES workers(id),
  site_id uuid REFERENCES sites(id),
  day date NOT NULL,
  edited_by uuid NOT NULL REFERENCES users(id),
  edited_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  before jsonb,
  after jsonb,
  PRIMARY KEY (tenant_id, worker_id, day, site_id)
);

ALTER TABLE worker_day_admin_edits ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON worker_day_admin_edits
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON worker_day_admin_edits TO presente_app;

-- E5-S05: engineer tags that would clobber an admin-edited day.
ALTER TABLE session_tags DROP CONSTRAINT IF EXISTS session_tags_status_check;
ALTER TABLE session_tags
  ADD CONSTRAINT session_tags_status_check
  CHECK (status IN (
    'active', 'pending_confirm', 'rejected', 'ignored_duplicate', 'suppressed_admin'
  ));

-- Down Migration

ALTER TABLE session_tags DROP CONSTRAINT IF EXISTS session_tags_status_check;
ALTER TABLE session_tags
  ADD CONSTRAINT session_tags_status_check
  CHECK (status IN (
    'active', 'pending_confirm', 'rejected', 'ignored_duplicate'
  ));
DROP TABLE worker_day_admin_edits;
ALTER TABLE attendance_sessions DROP COLUMN clock_drift_flagged;
