# Local Auth Flow

## Target

```text
Expo Go
  -> local auth email/password auth
  -> JWT access token
  -> SafeRide API Authorization: Bearer <token>
  -> API verifies JWT and scopes queries by owner_id
```

## Mobile Adapter

`src/lib/auth/authClient.ts` owns the local auth session shape and persists tokens through `src/lib/secureStoreAdapter.ts`. It no longer imports hosted backend client types.

Local guest mode stores only a protected `local-guest` marker through the same SecureStore-backed adapter so app restarts do not force another no-account sign-in tap. The marker is not an API token, is excluded from privacy exports, and is cleared by sign-out and local privacy delete.

## API Middleware

`apps/api/src/middleware/auth.ts` verifies local auth JWTs with `local auth_JWT_SECRET`, creates/updates `saferide.profiles`, and attaches `auth.userId` to requests.

## Password Recovery

Password reset is unavailable in this local/release build until a real token issuance, hashed-token storage, delivery provider, callback, and password update flow exists. The owned auth API returns `501 not_implemented` from `/auth/recover`, and the mobile app shows unavailable copy instead of claiming a reset link was sent.

## Risks

- Do not smoke-test password reset links in this build; treat any release requirement for account recovery as a blocker for a future implemented reset flow.
- Anonymous sign-in depends on local auth configuration and may fall back to local guest mode.
- JWT secret rotation must be rehearsed before staging.
