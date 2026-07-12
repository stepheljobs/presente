# `@presente/api`

NestJS API for Presente: multi-tenant attendance, day records, payroll, dashboard, and notifications.

Full setup, migrations, and test commands live in the [root README](../../README.md).

## Local dev

```sh
# from monorepo root
cp apps/api/.env.example apps/api/.env   # first time
pnpm --filter @presente/api migrate      # or: cd apps/api && ./scripts/migrate.sh up
pnpm seed:dev
pnpm dev:api                             # http://localhost:3000
```

## Layout

| Path | Role |
|------|------|
| `src/auth` | Login, JWT, roles (Owner / Admin / Engineer) |
| `src/sites` | Sites, geofences, nearest, engineer assignment |
| `src/workers` | Profiles, enrollment, consent, CSV import |
| `src/sessions` | Capture ingest, recognition pass, tags, exceptions |
| `src/day-records` | Day recompute, admin edit, corrections |
| `src/payroll` | Runs, gross compute, exports |
| `src/dashboard` | Today, reports, padding, evidence pack |
| `src/notifications` | Device tokens, push/SMS/email, scheduled jobs |
| `migrations/` | Raw SQL + RLS policies |

## Tests

```sh
pnpm --filter @presente/api test          # unit (Jest)
pnpm --filter @presente/api test:e2e      # e2e against presente_test
```

E2e requires Postgres with `presente_test` migrated (`pnpm migrate:test` from this package).

## Access logs

Every request (except `GET /health`) is logged as `METHOD /path status durationMs` to:

1. **Console** — Nest `HTTP` logger (shows under `[api]` when using `pnpm dev`)
2. **File** — `storage/logs/access.log` (gitignored; ISO timestamp prefix)

```sh
# watch the file while the API is running
tail -f apps/api/storage/logs/access.log
```

Disable with `HTTP_LOG=false`. Console-only with `HTTP_LOG_FILE=false`. Off automatically when `NODE_ENV=test`.

## Notes

- App connects as `presente_app` so RLS applies; migrations run as the table owner.
- Face recognition uses a stub provider until a cloud service (e.g. AWS Rekognition) is wired.
- Push notifications log delivery; swap the stub for FCM HTTP v1 when ready.
