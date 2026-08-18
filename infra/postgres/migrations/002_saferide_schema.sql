begin;

create schema if not exists saferide;

create or replace function saferide.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  create type saferide.draft_status as enum ('draft', 'queued', 'submitted', 'archived', 'closed');
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create type saferide.case_status as enum ('submitted', 'in_review', 'referred', 'closed');
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create type saferide.attachment_status as enum ('pending_upload', 'uploaded', 'hash_mismatch', 'rejected', 'deleted');
exception
  when duplicate_object then null;
end;
$$;

create table if not exists saferide.profiles (
  id uuid primary key,
  email text,
  display_name text,
  phone text,
  role text not null default 'survivor',
  auth_provider text not null default 'local',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists saferide.auth_users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  password_hash text,
  role text not null default 'survivor',
  user_metadata jsonb not null default '{}'::jsonb,
  refresh_token_hash text,
  refresh_token_expires_at timestamptz,
  is_anonymous boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists saferide.providers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  type text not null,
  channels jsonb not null default '{}'::jsonb,
  languages text[] not null default '{}'::text[],
  services text[] not null default '{}'::text[],
  phone text,
  address text,
  distance text,
  coordinates jsonb,
  hours text,
  is_open boolean,
  safety_phrase text,
  metadata jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists saferide.legal_tags (
  id uuid primary key default gen_random_uuid(),
  tag text not null unique,
  description text,
  category text,
  updated_at timestamptz not null default now()
);

create table if not exists saferide.tips (
  id uuid primary key default gen_random_uuid(),
  title text not null unique,
  body text not null,
  category text,
  updated_label text,
  tags text[] not null default '{}'::text[],
  copy_steps text[] not null default '{}'::text[],
  has_copy_steps boolean not null default false,
  sources jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists saferide.drafts (
  id text primary key default gen_random_uuid()::text,
  owner_id uuid not null,
  payload jsonb not null,
  status saferide.draft_status not null default 'draft',
  last_autosave timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists saferide.cases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  draft_id text references saferide.drafts on delete set null,
  pathway text,
  status saferide.case_status not null default 'submitted',
  summary jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists saferide.case_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references saferide.cases on delete cascade,
  owner_id uuid,
  event_type text not null,
  payload jsonb,
  request_id text,
  created_at timestamptz not null default now()
);

create table if not exists saferide.attachments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  draft_id text references saferide.drafts on delete cascade,
  case_id uuid references saferide.cases on delete cascade,
  bucket text not null,
  bucket_path text not null unique,
  mime_type text,
  size_bytes integer,
  sha256 text,
  expected_sha256 text,
  upload_manifest jsonb not null default '{}'::jsonb,
  retention jsonb not null default '{}'::jsonb,
  antivirus_status text not null default 'not_scanned',
  status saferide.attachment_status not null default 'pending_upload',
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attachments_draft_or_case check (
    (draft_id is not null)::int + (case_id is not null)::int = 1
  )
);

create table if not exists saferide.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  mode text,
  created_at timestamptz not null default now(),
  last_activity timestamptz not null default now()
);

create table if not exists saferide.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references saferide.chat_sessions on delete cascade,
  owner_id uuid,
  role text not null,
  content text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create table if not exists saferide.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null,
  resource_type text not null,
  resource_id text,
  request_id text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_profiles_email on saferide.profiles(email);
create index if not exists idx_auth_users_email on saferide.auth_users(lower(email));
create index if not exists idx_auth_users_refresh_token_hash on saferide.auth_users(refresh_token_hash);
create index if not exists idx_drafts_owner_updated on saferide.drafts(owner_id, updated_at desc);
create index if not exists idx_cases_owner_created on saferide.cases(owner_id, created_at desc);
create index if not exists idx_case_events_case on saferide.case_events(case_id, created_at);
create index if not exists idx_attachments_owner on saferide.attachments(owner_id);
create index if not exists idx_attachments_case on saferide.attachments(case_id);
create index if not exists idx_chat_sessions_owner on saferide.chat_sessions(owner_id, last_activity desc);
create index if not exists idx_chat_messages_session on saferide.chat_messages(session_id, created_at);
create index if not exists idx_audit_events_actor on saferide.audit_events(actor_id, created_at desc);

drop trigger if exists touch_profiles_updated_at on saferide.profiles;
create trigger touch_profiles_updated_at before update on saferide.profiles
for each row execute function saferide.touch_updated_at();

drop trigger if exists touch_auth_users_updated_at on saferide.auth_users;
create trigger touch_auth_users_updated_at before update on saferide.auth_users
for each row execute function saferide.touch_updated_at();

drop trigger if exists touch_drafts_updated_at on saferide.drafts;
create trigger touch_drafts_updated_at before update on saferide.drafts
for each row execute function saferide.touch_updated_at();

drop trigger if exists touch_cases_updated_at on saferide.cases;
create trigger touch_cases_updated_at before update on saferide.cases
for each row execute function saferide.touch_updated_at();

drop trigger if exists touch_attachments_updated_at on saferide.attachments;
create trigger touch_attachments_updated_at before update on saferide.attachments
for each row execute function saferide.touch_updated_at();

create or replace function saferide.notify_chat_message()
returns trigger
language plpgsql
as $$
begin
  perform pg_notify(
    'saferide_chat_messages',
    json_build_object(
      'sessionId', new.session_id,
      'messageId', new.id,
      'ownerId', new.owner_id,
      'createdAt', new.created_at
    )::text
  );
  return new;
end;
$$;

drop trigger if exists chat_message_notify on saferide.chat_messages;
create trigger chat_message_notify
after insert on saferide.chat_messages
for each row execute function saferide.notify_chat_message();

insert into saferide.schema_migrations (version, name)
values ('002', 'saferide_schema')
on conflict (version) do nothing;

commit;
