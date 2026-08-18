begin;

create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

insert into saferide.schema_migrations (version, name)
values ('001', 'extensions')
on conflict (version) do nothing;

commit;
