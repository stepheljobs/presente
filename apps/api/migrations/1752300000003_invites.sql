-- Up Migration

CREATE TABLE invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  email text NOT NULL,
  phone text,
  role user_role NOT NULL CHECK (role IN ('admin', 'engineer')),
  -- Only the SHA-256 of the link token is stored; the raw token exists
  -- solely in the dispatched email/SMS.
  token_hash text NOT NULL UNIQUE,
  invited_by uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX invites_tenant_idx ON invites (tenant_id, created_at DESC);

ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invites
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON invites TO presente_app;

-- Acceptance happens before any authentication, so lookup and accept are
-- SECURITY DEFINER (same rationale as auth_lookup_user).
CREATE FUNCTION invite_lookup(p_token_hash text)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  email text,
  role user_role,
  expires_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz,
  company_name text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT i.id, i.tenant_id, i.email, i.role, i.expires_at,
         i.accepted_at, i.revoked_at, t.name
  FROM invites i JOIN tenants t ON t.id = i.tenant_id
  WHERE i.token_hash = p_token_hash
$$;

CREATE FUNCTION invite_accept(p_token_hash text, p_password_hash text)
RETURNS TABLE (user_id uuid, tenant_id uuid, email text, role user_role)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv invites%ROWTYPE;
  u_id uuid;
BEGIN
  SELECT * INTO inv FROM invites i
  WHERE i.token_hash = p_token_hash FOR UPDATE;

  IF inv.id IS NULL OR inv.accepted_at IS NOT NULL
     OR inv.revoked_at IS NOT NULL OR inv.expires_at <= now() THEN
    RAISE EXCEPTION 'invite_invalid' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO users (tenant_id, email, password_hash, role, status, phone)
  VALUES (inv.tenant_id, lower(inv.email), p_password_hash, inv.role,
          'active', inv.phone)
  RETURNING id INTO u_id;

  UPDATE invites SET accepted_at = now() WHERE id = inv.id;

  RETURN QUERY SELECT u_id, inv.tenant_id, lower(inv.email), inv.role;
END
$$;

REVOKE ALL ON FUNCTION invite_lookup(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION invite_accept(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION invite_lookup(text) TO presente_app;
GRANT EXECUTE ON FUNCTION invite_accept(text, text) TO presente_app;

-- Down Migration

DROP FUNCTION invite_accept(text, text);
DROP FUNCTION invite_lookup(text);
DROP TABLE invites;
