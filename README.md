# Presente

Photo-first attendance and gross payroll for Philippine construction contractors. An engineer photographs the crew at time-in/time-out; face recognition tags workers; admins resolve exceptions and approve payroll from evidence, not memory.

Product docs live in [docs/](docs/) — product brief, PRD, user flows, and the atomic story backlog ([04-atomic-stories.md](docs/04-atomic-stories.md)).

## Status (v1 backlog)

| Epic | Name | Surface |
|------|------|---------|
| **E0** | Platform foundations | Multi-tenant RLS, auth, uploads, audit, session ingest |
| **E1** | Tenant & account setup | Sign-up, OTP, invites, company settings |
| **E2** | Projects & sites | Sites, geofences, engineer assignment, nearest site |
| **E3** | Worker enrollment | Profiles, consent, face enrollment, CSV import |
| **E4** | Attendance capture | Mobile time-in/out, photos, recognition banding, tags |
| **E5** | Offline & sync | Encrypted queue, auto-sync, conflict rules, clock drift |
| **E6** | Day records & corrections | Day recompute, admin edit, engineer corrections |
| **E7** | Gross payroll | Runs, OT, adjustments, approve, CSV/PDF export |
| **E8** | Dashboard & reports | Today view, exceptions queue, tagging, padding reports |
| **E9** | Notifications | Push/SMS/email abstraction, reminders, digests |

**Not in v1 backlog yet:** SaaS **billing** (how Presente charges contractors — pricing still open). Gross payroll is *worker pay computation*, not product billing. Money movement and statutory deductions remain out of scope.

## Monorepo layout

| Path | Package | Stack |
|------|---------|--------|
| `apps/api` | `@presente/api` | NestJS + PostgreSQL (row-level security), raw SQL migrations |
| `apps/web` | `@presente/web` | React + Vite dashboard SPA |
| `apps/mobile` | `@presente/mobile` | Expo / React Native (dev-client workflow) |

## Prerequisites

- Node.js ≥ 22, pnpm ≥ 8
- PostgreSQL ≥ 14 running locally (`brew services start postgresql@14`)
- For mobile on-device work: Android Studio (or EAS Build)

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
# Unit-level across the workspace (API unit + web):
pnpm test

# API unit tests (guards, pure logic — banding, payroll compute, …):
pnpm --filter @presente/api test

# API e2e (real Postgres):
pnpm --filter @presente/api test:e2e

# Web unit tests (JWT decode/expiry):
pnpm --filter @presente/web test

# Mobile: typecheck is the automated check (no Jest suite yet):
pnpm --filter @presente/mobile typecheck
```

### API e2e suites (by area)

| Suite | Covers |
|-------|--------|
| `test/rls.e2e-spec.ts` | Tenant isolation (E0-S01) |
| `test/auth.e2e-spec.ts` | Login / JWT claims (E0-S02) |
| `test/uploads.e2e-spec.ts` | Signed uploads (E0-S04) |
| `test/sessions.e2e-spec.ts` | Idempotent ingest, audit, clock drift (E0-S05/S06/S10) |
| `test/signup.e2e-spec.ts` / `invites` / `settings` | Tenant onboarding (E1) |
| `test/sites.e2e-spec.ts` | Sites, assignment, geofence (E2) |
| `test/workers.e2e-spec.ts` / `enrollment.e2e-spec.ts` | Workers & biometrics (E3) |
| `test/capture.e2e-spec.ts` | Recognition, tags, reconciliation (E4) |
| `test/sync.e2e-spec.ts` | Drift, admin-wins conflict, recognition reconcile (E5) |
| `test/day-records.e2e-spec.ts` | Day records, corrections, no-biometric (E6) |
| `test/payroll.e2e-spec.ts` | Runs, OT, approve, export (E7) |
| `test/dashboard.e2e-spec.ts` | Today, exceptions, admin tag, reports (E8) |
| `test/notifications.e2e-spec.ts` | Devices, reminders, digests (E9) |

## Running the apps

```sh
pnpm dev:api    # NestJS on http://localhost:3000
pnpm dev:web    # dashboard on http://localhost:5173
```

Log in with the seeded **`owner@demo.ph` / `presente-dev-123`**.

### Web dashboard routes

| Path | Purpose |
|------|---------|
| `/` | Today — site headcount, photo feed, device sync |
| `/exceptions` | Exception queue + typed resolvers |
| `/sessions/:id` | Admin photo tagging workspace |
| `/attendance` | Day records, admin edits, correction review |
| `/payroll` | Payroll runs, matrix, approve, export |
| `/reports` | Attendance/OT/exception reports, padding indicators |
| `/sites`, `/workers`, `/settings` | Setup |

### Mobile (engineer)

SQLCipher, camera, and push registration need a **dev build** (not Expo Go):

```sh
cd apps/mobile
pnpm exec expo prebuild
pnpm exec expo run:android     # needs Android Studio / an emulator
```

| Flow | Screens |
|------|---------|
| Auth | Login (token in SecureStore) |
| Enrollment | Consent → profile → face poses |
| Capture | Site select → camera → tag → summary |
| Sync | Offline queue, sync pill, background/network drain |
| Corrections | Request correction; see approve/reject |
| Push | Expo token registered on login (E9) |

On the Android emulator the API is `http://10.0.2.2:3000` (default). On a physical phone:

```sh
EXPO_PUBLIC_API_URL=http://<your-lan-ip>:3000 pnpm exec expo start --dev-client
```

### API smoke test

```sh
TOKEN=$(curl -s http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@demo.ph","password":"presente-dev-123"}' | jq -r .accessToken)

curl -s http://localhost:3000/health
curl -s http://localhost:3000/dashboard/today \
  -H "Authorization: Bearer $TOKEN" | jq
```

## Migrations

Raw SQL in `apps/api/migrations`, applied by node-pg-migrate as the table owner:

```sh
cd apps/api
./scripts/migrate.sh create my-change    # new timestamped .sql file
./scripts/migrate.sh up                  # presente_dev
pnpm migrate:test                        # presente_test
./scripts/migrate.sh down                # roll back one
```

| Migration | Epic |
|-----------|------|
| `…0001`–`…0004` | E0 tenants, auth, audit, sessions |
| `…signup` / settings / invites | E1 |
| `…sites` | E2 |
| `…workers-consents-enrollment` | E3 |
| `…attendance-capture` | E4 |
| `…offline-sync` | E5 |
| `…day-records` | E6 |
| `…payroll` | E7 |
| `…notifications` | E9 |

Every tenant-scoped table gets `ENABLE ROW LEVEL SECURITY`, a `tenant_isolation` policy on `current_setting('app.tenant_id')`, and grants to `presente_app` — see `1752200000001_tenants-and-users.sql`.

## Package READMEs

- [apps/api/README.md](apps/api/README.md) — NestJS API
- [apps/web/README.md](apps/web/README.md) — dashboard SPA
- [apps/mobile/README.md](apps/mobile/README.md) — Expo field app
