# `@presente/web`

React + Vite dashboard for Presente admins and owners.

See the [root README](../../README.md) for monorepo setup and the seed login.

## Local dev

```sh
# from monorepo root (API should be on :3000)
pnpm dev:web    # http://localhost:5173
```

Optional: `VITE_API_URL` if the API is not at `http://localhost:3000`.

**Demo login:** `owner@demo.ph` / `presente-dev-123`

## Routes

| Path | Epic | Description |
|------|------|-------------|
| `/login`, `/signup`, `/verify`, `/accept-invite` | E1 | Auth & onboarding |
| `/` | E8 | Today — headcount, photo feed, devices |
| `/exceptions` | E8 | Exception queue & resolvers |
| `/sessions/:id` | E8 | Admin tagging workspace |
| `/attendance` | E6 | Day records, edits, corrections |
| `/payroll` | E7 | Payroll runs, matrix, export |
| `/reports` | E8 | Reports & padding indicators |
| `/sites` | E2 | Sites & geofences |
| `/workers` | E3 | Workers, approvals, CSV |
| `/settings` | E1 | Company settings |

## Scripts

```sh
pnpm --filter @presente/web test        # unit (Vitest) — auth helpers
pnpm --filter @presente/web build       # production build to dist/
```

## Stack

React 19, React Router, Vite, TypeScript. Map pin UI uses Leaflet on the sites page.
