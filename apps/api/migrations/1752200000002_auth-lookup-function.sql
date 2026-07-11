-- Up Migration

-- Login runs before any tenant context exists, so presente_app cannot see
-- users directly (RLS). This owner-owned SECURITY DEFINER function is the
-- single sanctioned global lookup: exact-email match, nothing enumerable.
CREATE FUNCTION auth_lookup_user(p_email text)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  email text,
  password_hash text,
  role user_role,
  status text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT u.id, u.tenant_id, u.email, u.password_hash, u.role, u.status
  FROM users u
  WHERE u.email = lower(p_email)
$$;

REVOKE ALL ON FUNCTION auth_lookup_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_user(text) TO presente_app;

-- Emails are compared lowercased; store them that way too.
CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));

-- Down Migration

DROP INDEX users_email_lower_idx;
DROP FUNCTION auth_lookup_user(text);
