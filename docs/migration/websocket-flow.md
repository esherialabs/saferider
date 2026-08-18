# WebSocket Flow

## Scope

Only chat realtime is in scope for the first local replacement. Presence, typing indicators, and global feeds are intentionally out of scope.

## Target Flow

```text
Expo app
  -> Socket.IO connection with Bearer token
  -> WebSocket gateway verifies local auth JWT
  -> client joins chat:<sessionId>
  -> API persists chat_messages
  -> Redis pub/sub publishes message event
  -> gateway emits to room
```

## Current Scaffold

- Socket.IO gateway exists in `apps/api/src/websocket/server.ts`.
- Redis adapter is configured for future horizontal scaling.
- Auth is required on connect.
- Metrics track active connections and disconnect reasons.
- Mobile chat subscriptions use the owned WebSocket endpoint from runtime config.
