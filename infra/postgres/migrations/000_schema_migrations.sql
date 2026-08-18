create schema if not exists saferide;

create table if not exists saferide.schema_migrations (
  version text primary key,
  name text not null,
  applied_at timestamptz not null default now()
);

insert into saferide.schema_migrations (version, name)
values ('000', 'schema_migrations')
on conflict (version) do nothing;
