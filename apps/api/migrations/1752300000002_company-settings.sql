-- Up Migration

CREATE TABLE company_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  -- ISO weekday numbers, 1 = Monday … 7 = Sunday. PH construction default
  -- is Monday–Saturday.
  workdays int[] NOT NULL DEFAULT '{1,2,3,4,5,6}',
  standard_workday_hours numeric(4,2) NOT NULL DEFAULT 8
    CHECK (standard_workday_hours > 0 AND standard_workday_hours <= 24),
  ot_multiplier numeric(5,2) NOT NULL DEFAULT 1.25 CHECK (ot_multiplier >= 1),
  late_grace_minutes int NOT NULL DEFAULT 15
    CHECK (late_grace_minutes >= 0 AND late_grace_minutes <= 240),
  halfday_rule text NOT NULL DEFAULT 'hours_threshold'
    CHECK (halfday_rule IN ('hours_threshold', 'cutoff_time')),
  halfday_threshold_hours numeric(4,2) NOT NULL DEFAULT 4
    CHECK (halfday_threshold_hours > 0),
  halfday_cutoff_time time NOT NULL DEFAULT '12:00',
  payroll_week_start_day int NOT NULL DEFAULT 1
    CHECK (payroll_week_start_day BETWEEN 1 AND 7),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON company_settings
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON company_settings TO presente_app;

-- Down Migration

DROP TABLE company_settings;
