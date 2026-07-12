-- Up Migration

-- E7-S03: OT eligibility toggles (site default + per-worker override).
ALTER TABLE sites
  ADD COLUMN ot_eligible boolean NOT NULL DEFAULT true;
ALTER TABLE workers
  ADD COLUMN ot_eligible boolean; -- null = inherit site

-- E7-S11: who may approve payroll runs.
ALTER TABLE company_settings
  ADD COLUMN approve_role text NOT NULL DEFAULT 'admin'
    CHECK (approve_role IN ('admin', 'owner'));

-- E7-S01: payroll run state machine Draft → Reviewed → Approved → Exported.
CREATE TABLE payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'reviewed', 'approved', 'exported')),
  created_by uuid REFERENCES users(id),
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  exported_at timestamptz,
  export_hash text,
  totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, period_start, period_end)
);

ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payroll_runs
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON payroll_runs TO presente_app;

-- One line per worker in a run (aggregated week).
CREATE TABLE payroll_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  run_id uuid NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  worker_id uuid NOT NULL REFERENCES workers(id),
  days_present numeric(6,2) NOT NULL DEFAULT 0,
  halfdays numeric(6,2) NOT NULL DEFAULT 0,
  ot_hours numeric(8,2) NOT NULL DEFAULT 0,
  ot_hours_unpaid numeric(8,2) NOT NULL DEFAULT 0,
  daily_rate numeric(10,2) NOT NULL DEFAULT 0,
  base_pay numeric(12,2) NOT NULL DEFAULT 0,
  ot_pay numeric(12,2) NOT NULL DEFAULT 0,
  adjustments numeric(12,2) NOT NULL DEFAULT 0,
  gross numeric(12,2) NOT NULL DEFAULT 0,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (run_id, worker_id)
);

CREATE INDEX payroll_lines_run_idx ON payroll_lines (run_id);

ALTER TABLE payroll_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payroll_lines
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON payroll_lines TO presente_app;

-- E7-S04: manual OT per worker-day (within a run).
CREATE TABLE payroll_ot_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  run_id uuid NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  worker_id uuid NOT NULL REFERENCES workers(id),
  day date NOT NULL,
  delta_hours numeric(6,2) NOT NULL,
  reason text NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE payroll_ot_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payroll_ot_adjustments
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, DELETE ON payroll_ot_adjustments TO presente_app;

-- E7-S09 / E7-S13: free-form adjustments (allowance / cash advance / post-approval).
CREATE TABLE payroll_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  run_id uuid NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  worker_id uuid NOT NULL REFERENCES workers(id),
  amount numeric(12,2) NOT NULL,
  note text NOT NULL,
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'post_approval_correction')),
  source_run_id uuid REFERENCES payroll_runs(id),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE payroll_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payroll_adjustments
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, DELETE ON payroll_adjustments TO presente_app;

-- Down Migration

DROP TABLE payroll_adjustments;
DROP TABLE payroll_ot_adjustments;
DROP TABLE payroll_lines;
DROP TABLE payroll_runs;
ALTER TABLE company_settings DROP COLUMN approve_role;
ALTER TABLE workers DROP COLUMN ot_eligible;
ALTER TABLE sites DROP COLUMN ot_eligible;
