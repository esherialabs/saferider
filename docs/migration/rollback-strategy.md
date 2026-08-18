# Local Migration Rollback Strategy

## Principle

Every local migration step must preserve fast recovery without risking production data.

## Rollback Levers

- Runtime config can point the mobile app at a previous owned API/staging endpoint.
- Docker local data can be reset with `npm run local:reset`.
- Local Expo env files can be switched back to known-good host/port values.
- Each service migration is isolated enough to revert with a focused git commit.

## Do Not

- Rotate local credentials in the middle of debugging unless the environment is stable.
- Run destructive database or object-storage operations against staging or production from local scripts.
- Treat Expo Go local testing as production readiness.

## Branch Strategy

Keep app migration changes on an app/infrastructure branch separate from web-only work. Merge only after local setup, smoke tests, and security review pass.
