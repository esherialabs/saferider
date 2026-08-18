# SafeRide Local Migration Setup

This setup is for local development only. It is the proving ground for owned infrastructure before staging or production cutover.

## Start

```bash
cp infra/local/.env.example infra/local/.env
cp .env.example .env.local
cp .env.example .env.development
npm --prefix apps/api install
npm run local:up
npm start
```

The committed example files use local-only values that pass the API validators so a fresh checkout can start without first inventing secrets. Replace them before any shared, staging, or production environment. If you edit the local JWT value, keep it at least 32 characters.

Use Expo Go against the API URLs from `.env.local`.

## Expo Web Preview

Web preview is available for local visual QA only:

```bash
npm run web
```

Keep Android/device QA as the release path. Before using web preview, set `EXPO_PUBLIC_LOCAL_ASSISTANT_ENABLED=false` and `EXPO_PUBLIC_LOCAL_ASSISTANT_PREFER_ON_DEVICE=false` in `.env.local`; the web preview should not be used to validate the on-device assistant or native Android permission/storage behavior. If the local API stack is not running, use web only for layout/navigation inspection and note that API-backed flows were not exercised.

For direct API development outside Docker Compose, use `apps/api/.env.example` as the matching template. It points auth to `http://localhost:3333/auth`, uses `AUTH_JWT_SECRET`, and matches the local host ports exposed by `infra/local/docker-compose.yml`.

For Expo Go on a physical phone, replace `localhost` in `.env.local` and `infra/local/.env` with your computer's LAN IP, and set:

```bash
LOCAL_PUBLIC_HOST=192.168.x.x
EXPO_PUBLIC_API_BASE_URL=http://192.168.x.x:3333/api
EXPO_PUBLIC_WS_BASE_URL=ws://192.168.x.x:3334
EXPO_PUBLIC_AUTH_BASE_URL=http://192.168.x.x:3333/auth
EXPO_PUBLIC_STORAGE_BASE_URL=http://192.168.x.x:9000/evidence
EXPO_PUBLIC_RUNTIME_CONFIG_URL=http://192.168.x.x:3333/api/config/runtime
```

Restart Docker Compose after changing `LOCAL_PUBLIC_HOST` so signed MinIO URLs and runtime config use the device-reachable host.

## Local URLs

- API: `http://localhost:3333`
- API health: `http://localhost:3333/health`
- Runtime config: `http://localhost:3333/api/config/runtime`
- WebSocket gateway: `ws://localhost:3334`
- MinIO API: `http://localhost:9000`
- MinIO console: `http://localhost:9001`
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3001`

## Reset

```bash
npm run local:reset
```

This removes local Docker volumes. It must never be pointed at staging or production resources.

Local Postgres initializes from the canonical owned migrations in `infra/postgres/migrations`. AWS staging uses the same SQL files through the temporary migration runner, so schema and seed/reference data stay aligned without Supabase.

## Current Scope

This branch creates the local owned-infrastructure foundation and backend contracts. The mobile app now routes migrated auth, catalog, draft, case/evidence, chat, and offline replay paths through the owned API/local stack.
