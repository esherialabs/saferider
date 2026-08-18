# Local Postgres

The local Docker database uses the canonical owned Postgres migrations in:

```text
infra/postgres/migrations
```

Do not add local-only schema SQL here. Local and AWS staging must use the same migration files so the owned API sees the same tables, enums, indexes, triggers, and seed/reference data in both environments.
