# Local-First Migration Architecture

## Target Flow

```text
Expo Go
  -> SafeRide API
  -> Postgres / MinIO / local auth / Redis
```

The mobile app no longer has a direct database/storage client path. Runtime config points it at owned API, auth, websocket, and storage endpoints.

## Components

- PostgreSQL 16 local database with `saferide` schema and migration-ready tables.
- MinIO S3-compatible storage with private `evidence` bucket.
- Redis for pub/sub, queues, and future websocket scaling.
- local auth for local email/password JWT issuance.
- Node.js TypeScript API in `apps/api`.
- Socket.IO websocket gateway with Redis adapter.
- Prometheus and Grafana from day one.

## API Boundaries

Controllers validate requests and call services/repositories. They do not own SQL directly. Authorization is handled by JWT middleware and repository queries scope by `owner_id`.

## Migration Strategy

1. Keep Expo Go behavior stable while moving services behind the owned API.
2. Validate local auth, catalog, drafts, cases, evidence, chat, and offline replay.
3. Rehearse data restore and storage hash verification locally.
4. Promote only after staging has production-like data and rollback checks.
