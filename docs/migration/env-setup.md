# Migration Environment Setup

## Files

- `.env.local`: Expo Go local runtime values.
- `.env.development`: Expo development runtime values.
- `.env.docker`: reserved for compose integrations outside `infra/local`.
- `infra/local/.env`: Docker Compose service credentials and ports.
- `apps/api/.env`: optional API-only local development outside Docker.

Only example files are committed.

## Client-Safe Variables

These may be visible in Expo Go:

- `EXPO_PUBLIC_ENVIRONMENT`
- `EXPO_PUBLIC_API_BASE_URL`
- `EXPO_PUBLIC_API_TIMEOUT_MS`
- `EXPO_PUBLIC_WS_BASE_URL`
- `EXPO_PUBLIC_AUTH_BASE_URL`
- `EXPO_PUBLIC_STORAGE_BASE_URL`
- `EXPO_PUBLIC_RUNTIME_CONFIG_URL`
- `EXPO_PUBLIC_CONFIG_REFRESH_SECONDS`
- `EXPO_PUBLIC_OPENAI_ENABLED`
- `EXPO_PUBLIC_RELEASE_ENDPOINT_HOSTS`
- `EXPO_PUBLIC_RELEASE_STORAGE_HOSTS`
- `EXPO_PUBLIC_LOCAL_ASSISTANT_*`
- `EXPO_PUBLIC_AZURE_OPENAI_TRANSCRIPTION_ENABLED`

## Environment Matrix

| Target | `EXPO_PUBLIC_ENVIRONMENT` | Endpoint rules | Runtime config |
| --- | --- | --- | --- |
| Expo Go / local simulator | `development` or `local` | `http://localhost`, `ws://localhost`, or LAN IPs are allowed | Optional but recommended |
| EAS development client | `development` | Local or remote development endpoints are allowed | Optional but recommended |
| EAS preview | `staging` | Public owned `https://` API/auth and `wss://` websocket endpoints only; hosts must be listed in `EXPO_PUBLIC_RELEASE_ENDPOINT_HOSTS` | Required |
| EAS production | `production` | Public owned `https://` API/auth and `wss://` websocket endpoints only; hosts must be listed in `EXPO_PUBLIC_RELEASE_ENDPOINT_HOSTS` | Required |

For preview and production, `EXPO_PUBLIC_RELEASE_ENDPOINT_HOSTS` must list the exact expected CloudFront API/auth/websocket/runtime-config hostnames, and `EXPO_PUBLIC_RELEASE_STORAGE_HOSTS` must list the exact expected staging storage hostnames. `app.config.js` fails release-like config resolution when `EAS_BUILD_PROFILE=preview`, `EAS_BUILD_PROFILE=production`, `EXPO_PUBLIC_ENVIRONMENT=staging`, or `EXPO_PUBLIC_ENVIRONMENT=production` attempts to use localhost, LAN/private addresses, `http://`, `ws://`, `.local` hostnames, Supabase hosts, a missing runtime config URL, or a host outside those allowlists.

This gate validates the configured public endpoint family only. It does not prove that a staging or production backend is deployed, healthy, or approved for release.

## Private Variables

These must stay server-side:

- Postgres credentials
- local auth JWT secret
- MinIO access keys
- OpenAI, Azure, and Helicone keys
- Future JWT signing and storage credentials
- AWS SSM parameter names, RDS endpoints, secret ARNs, database usernames, and generated database passwords

## Git Hooks

Enable local hooks once per checkout:

```bash
git config core.hooksPath .githooks
```

The hook runs `node scripts/scan-secrets.mjs --staged`. Run `npm run secrets:scan` for a full-tree scan before opening a PR.
