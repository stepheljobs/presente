# Presente

Photo-first attendance and gross payroll for Philippine construction contractors. An engineer photographs the crew at time-in/time-out; face recognition tags workers; admins resolve exceptions and approve payroll from evidence, not memory.

Product docs live in [docs/](docs/) — product brief, PRD, user flows, and the atomic story backlog ([04-atomic-stories.md](docs/04-atomic-stories.md)) that work is delivered against, one story at a time (`E0-S01`, `E0-S02`, …).

## Monorepo layout

| Path | Package | Stack |
|---|---|---|
| `apps/api` | `@presente/api` | NestJS + PostgreSQL (row-level security), raw SQL migrations |
| `apps/web` | `@presente/web` | React + Vite dashboard SPA |
| `apps/mobile` | `@presente/mobile` | Expo / React Native (dev-client workflow) |

## Prerequisites

- Node.js ≥ 22, pnpm ≥ 8
- PostgreSQL ≥ 14 running locally (`brew services start postgresql@14`)
- For mobile on-device work only: Android Studio (or EAS Build)

## First-time setup

```sh
pnpm install

# 1. Create the runtime role and databases.
#    presente_app is intentionally NOT the table owner — that's what makes
#    row-level security apply to the API's queries.
psql -d postgres <<'SQL'
CREATE ROLE presente_app LOGIN PASSWORD 'presente_app_dev';
CREATE DATABASE presente_dev;
CREATE DATABASE presente_test;
SQL

# 2. Configure the API.
cp apps/api/.env.example apps/api/.env
#    Defaults work for local dev; set DATABASE_URL's password to match the
#    role above (presente_app_dev) and pick any JWT_SECRET.

# 3. Run migrations on both databases (runs as the table owner).
cd apps/api
./scripts/migrate.sh up      # presente_dev
pnpm migrate:test            # presente_test

# 4. Seed a demo login (idempotent).
pnpm seed:dev                # owner@demo.ph / presente-dev-123
```

## Running the tests

Postgres must be running and `presente_test` migrated (steps above) — the API e2e suite talks to the real database because the thing under test is largely SQL (RLS policies, grants, idempotent upserts).

```sh
# Everything unit-level across the workspace (API unit + web):
pnpm test

# API unit tests (guards, pure logic):
pnpm --filter @presente/api test

# API e2e tests (auth, RLS isolation, session ingest, uploads, audit log):
pnpm --filter @presente/api test:e2e

# Web unit tests (JWT decode/expiry logic):
pnpm --filter @presente/web test

# Mobile: no test runner yet — typecheck + Android bundle build are the checks:
pnpm --filter @presente/mobile typecheck
cd apps/mobile && pnpm exec expo export --platform android --output-dir /tmp/presente-export
```

What the e2e suites prove, per story:

- `test/rls.e2e-spec.ts` — cross-tenant SELECT returns zero rows; cross-tenant INSERT rejected (E0-S01)
- `test/auth.e2e-spec.ts` — login issues JWT with role/tenant claims; identical generic 401 for wrong password, unknown email, and disabled accounts (E0-S02)
- `src/auth/roles.guard.spec.ts` — one allowed + one denied route per role (E0-S03)
- `test/uploads.e2e-spec.ts` — presigned PUT URLs under `tenants/<id>/…`, content types whitelisted (E0-S04)
- `test/sessions.e2e-spec.ts` — retrying `PUT /sessions/{uuid}` returns a byte-identical response and writes exactly one audit entry; audit rows can't be updated or deleted; clock drift computed from device-sent time (E0-S05, S06, S10)

## Running the apps

```sh
pnpm dev:api    # NestJS on http://localhost:3000
pnpm dev:web    # dashboard on http://localhost:5173
```

Log in to the dashboard with the seeded `owner@demo.ph` / `presente-dev-123`.

Manual API smoke test:

```sh
TOKEN=$(curl -s http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@demo.ph","password":"presente-dev-123"}' | jq -r .accessToken)

curl -s http://localhost:3000/health          # public
curl -s http://localhost:3000/uploads/sign \  # authenticated
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"category":"session-photo","contentType":"image/jpeg"}' | jq
```

### Mobile

SQLCipher and (later) the camera frame processors don't run in Expo Go — a dev build is required:

```sh
cd apps/mobile
pnpm exec expo prebuild
pnpm exec expo run:android     # needs Android Studio / an emulator
```

On the Android emulator the API is reachable at `http://10.0.2.2:3000` (the default). On a physical phone, point the app at your machine's LAN address:

```sh
EXPO_PUBLIC_API_URL=http://<your-lan-ip>:3000 pnpm exec expo start --dev-client
```

## Migrations

Raw SQL files in `apps/api/migrations`, run by node-pg-migrate as the table owner:

```sh
cd apps/api
./scripts/migrate.sh create my-change    # new timestamped .sql file
./scripts/migrate.sh up                  # apply to presente_dev
pnpm migrate:test                        # apply to presente_test
./scripts/migrate.sh down                # roll back one
```

Every table carrying tenant data gets `ENABLE ROW LEVEL SECURITY`, a `tenant_isolation` policy keyed to `current_setting('app.tenant_id')`, and explicit grants to `presente_app` — see `1752200000001_tenants-and-users.sql` for the pattern.
