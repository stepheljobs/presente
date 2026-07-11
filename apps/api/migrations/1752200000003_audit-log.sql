-- Up Migration

CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  actor uuid,
  action text NOT NULL,
  entity text NOT NULL,
  before jsonb,
  after jsonb,
  reason text,
  ts timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_tenant_entity_idx ON audit_log (tenant_id, entity);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_log
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Append-only: the runtime role can read and insert, never update or delete
-- (NFR-6). Corrections are new entries, not edits.
GRANT SELECT, INSERT ON audit_log TO presente_app;

-- Down Migration

DROP TABLE audit_log;
