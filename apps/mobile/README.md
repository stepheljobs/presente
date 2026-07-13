# `@presente/mobile`

Expo / React Native field app for site engineers (attendance capture, enrollment, offline sync).

Requires a **dev build** for SQLCipher, camera, and full offline — Expo Go is limited.

**Push / `expo-notifications`:** disabled in Expo Go and Metro dev. The real package throws on import in Expo Go (SDK 53+ Android), so `metro.config.js` stubs it unless `NODE_ENV=production` or `EXPO_PUBLIC_ENABLE_PUSH=true`. After changing this, restart Metro with cache clear: `pnpm exec expo start -c`.

See the [root README](../../README.md#mobile-engineer).

## Local dev

```sh
# monorepo root: install + API running
pnpm install
pnpm dev:api

cd apps/mobile
pnpm exec expo prebuild
pnpm exec expo run:android
```

| Environment | API base URL |
|-------------|--------------|
| Android emulator | `http://10.0.2.2:3000` (default `EXPO_PUBLIC_API_URL`) |
| Physical device | `EXPO_PUBLIC_API_URL=http://<lan-ip>:3000` |

## Features (by epic)

| Area | Details |
|------|---------|
| **Auth (E0)** | Login; JWT in SecureStore |
| **Enrollment (E3)** | Consent (EN/TL), signature/paper, guided face poses |
| **Capture (E4)** | Time in/out, site GPS default, multi-photo, tag/visitor, summary |
| **Sync (E5)** | Encrypted SQLite queue, compress/upload, sync pill, backoff |
| **Corrections (E6)** | Request correction; see decisions |
| **Push (E9)** | Expo push token registered on login (**production only**; off in `__DEV__` / Expo Go) |

## Scripts

```sh
pnpm --filter @presente/mobile typecheck
pnpm --filter @presente/mobile start      # Expo (prefer --dev-client after prebuild)
```

## Stack

Expo SDK 57, expo-router, expo-camera, expo-location, expo-sqlite (SQLCipher), expo-notifications, expo-secure-store.
