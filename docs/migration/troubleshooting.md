# Local Migration Troubleshooting

## Compose Fails Immediately

Check that `infra/local/.env` exists and that placeholder values were replaced.

```bash
cp infra/local/.env.example infra/local/.env
```

## API Is Unhealthy

```bash
docker compose --env-file infra/local/.env -f infra/local/docker-compose.yml logs api
docker compose --env-file infra/local/.env -f infra/local/docker-compose.yml ps
```

Then check:

- Postgres is healthy.
- Redis is healthy.
- MinIO bucket initialization completed.
- `local auth_JWT_SECRET` is at least 32 bytes.

## Expo Cannot Reach Localhost

Expo Go on a physical device cannot reach the development machine through `localhost`. Use the machine LAN IP in `.env.local`:

```text
EXPO_PUBLIC_API_BASE_URL=http://<lan-ip>:3333/api
EXPO_PUBLIC_WS_BASE_URL=ws://<lan-ip>:3334
EXPO_PUBLIC_AUTH_BASE_URL=http://<lan-ip>:3333/auth
EXPO_PUBLIC_STORAGE_BASE_URL=http://<lan-ip>:9000/evidence
```

## Expo Web Preview Does Not Start

Run `npm install` first so the Expo SDK and web preview dependencies are present, then confirm `.env.local` has the required public `EXPO_PUBLIC_*` values from `.env.example`. Web preview is a local visual QA aid only; use `npm run web` after setting `EXPO_PUBLIC_LOCAL_ASSISTANT_ENABLED=false` and `EXPO_PUBLIC_LOCAL_ASSISTANT_PREFER_ON_DEVICE=false` for that run.

On locked-down Linux hosts, Expo may print a React Native DevTools Chrome sandbox error while Metro continues serving the app. Treat that as a host tooling limitation if `http://localhost:<port>` loads and the web bundle compiles; do not treat it as Android/device QA evidence.

## Secret Scan Blocks Commit

Install `gitleaks` for better results. The fallback scan is intentionally conservative and may require manual review of false positives.
