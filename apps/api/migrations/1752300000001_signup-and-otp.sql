-- Up Migration

ALTER TABLE users ADD COLUMN phone text;

-- Sign-up predates any tenant context, so tenant + provisional owner are
-- created through this owner-owned function (same rationale as
-- auth_lookup_user). Duplicate email surfaces as unique_violation on
-- users_email_lower_idx for the API to map to a friendly conflict.
CREATE FUNCTION signup_create_tenant(
  p_company text,
  p_email text,
  p_phone text,
  p_password_hash text
)
RETURNS TABLE (tenant_id uuid, user_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t_id uuid;
  u_id uuid;
BEGIN
  INSERT INTO tenants (name) VALUES (p_company) RETURNING id INTO t_id;
  INSERT INTO users (tenant_id, email, password_hash, role, status, phone)
  VALUES (t_id, lower(p_email), p_password_hash, 'owner', 'unverified', p_phone)
  RETURNING id INTO u_id;
  RETURN QUERY SELECT t_id, u_id;
END
$$;

REVOKE ALL ON FUNCTION signup_create_tenant(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION signup_create_tenant(text, text, text, text) TO presente_app;

CREATE TABLE otp_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  code_hash text NOT NULL,
  purpose text NOT NULL DEFAULT 'signup',
  attempts int NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX otp_codes_user_idx ON otp_codes (user_id, created_at DESC);

ALTER TABLE otp_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON otp_codes
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON otp_codes TO presente_app;

-- Down Migration

DROP TABLE otp_codes;
DROP FUNCTION signup_create_tenant(text, text, text, text);
ALTER TABLE users DROP COLUMN phone;
