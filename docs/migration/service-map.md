# Local Service Map

| Service | Local Port | Purpose | Persistence |
| --- | ---: | --- | --- |
| Postgres | 5432 | Owned relational data store | Docker volume |
| MinIO | 9000 | Evidence object storage | Docker volume |
| MinIO Console | 9001 | Local storage inspection | Docker volume |
| Redis | 6379 | Pub/sub, queues, websocket scaling prep | Docker volume |
| API auth routes | 3333 | Local auth and JWT issuance | Postgres |
| SafeRide API | 3333 | REST API, metrics, health | Stateless |
| WebSocket Gateway | 3334 | Socket.IO chat realtime scaffold | Stateless |
| Prometheus | 9090 | Metrics collection | Docker volume |
| Grafana | 3001 | Local dashboards | Docker volume |

## Health Checks

- API: `/health`, `/ready`, `/metrics`
- WebSocket gateway: `/health`, `/metrics`
- Prometheus scrapes API and websocket metrics.

## Reset Boundary

`npm run local:reset` removes local volumes and returns the stack to a clean rehearsal state.
