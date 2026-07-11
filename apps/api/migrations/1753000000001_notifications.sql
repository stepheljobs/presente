-- Up Migration

-- E9-S01: FCM / Expo push device tokens (per user, multi-device).
CREATE TABLE device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token text NOT NULL,
  platform text NOT NULL DEFAULT 'android'
    CHECK (platform IN ('android', 'ios', 'web')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, token)
);

CREATE INDEX device_tokens_user_idx ON device_tokens (user_id);

ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON device_tokens
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON device_tokens TO presente_app;

-- Delivery log (push + SMS-lite fallback results).
CREATE TABLE notification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid REFERENCES users(id),
  channel text NOT NULL CHECK (channel IN ('push', 'sms', 'email')),
  kind text NOT NULL,
  title text,
  body text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent', 'failed', 'skipped')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notification_log_tenant_idx
  ON notification_log (tenant_id, created_at DESC);
CREATE INDEX notification_log_kind_idx
  ON notification_log (tenant_id, kind, created_at DESC);

ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notification_log
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT ON notification_log TO presente_app;

-- E9-S02: per-tenant reminder clock (HH:MM in tenant timezone).
ALTER TABLE company_settings
  ADD COLUMN no_time_in_reminder_time time NOT NULL DEFAULT '08:30:00';

-- Dedup: one reminder per engineer per day.
CREATE TABLE notification_dedupe (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  kind text NOT NULL,
  subject_key text NOT NULL,
  day date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, kind, subject_key, day)
);

ALTER TABLE notification_dedupe ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notification_dedupe
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT ON notification_dedupe TO presente_app;

-- Down Migration

DROP TABLE notification_dedupe;
ALTER TABLE company_settings DROP COLUMN no_time_in_reminder_time;
DROP TABLE notification_log;
DROP TABLE device_tokens;
