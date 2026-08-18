begin;

alter table saferide.consent_records
  drop constraint if exists consent_records_purpose_check;
alter table saferide.consent_records
  add constraint consent_records_purpose_check check (purpose in (
    'pathway_submission', 'anonymous_aggregate', 'analytics', 'research',
    'model_training', 'partner_follow_up'
  ));

create unique index if not exists consent_records_id_owner_unique
  on saferide.consent_records(id, owner_id);
drop index if exists saferide.consent_records_one_active_aggregate;

alter table saferide.anonymous_route_signals
  add column if not exists ingestion_id uuid;
update saferide.anonymous_route_signals
set ingestion_id = gen_random_uuid()
where ingestion_id is null;
alter table saferide.anonymous_route_signals
  alter column ingestion_id set not null;
create unique index if not exists anonymous_route_signals_ingestion_dimension_unique
  on saferide.anonymous_route_signals(ingestion_id, area_id, time_bucket, category);

alter table saferide.cases
  add column if not exists consent_record_id uuid,
  add column if not exists submission_idempotency_key uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'cases_consent_owner_fk'
      and conrelid = 'saferide.cases'::regclass
  ) then
    alter table saferide.cases
      add constraint cases_consent_owner_fk
      foreign key (consent_record_id, owner_id)
      references saferide.consent_records(id, owner_id);
  end if;
end;
$$;

create unique index if not exists cases_owner_submission_idempotency_unique
  on saferide.cases(owner_id, submission_idempotency_key)
  where submission_idempotency_key is not null;
create unique index if not exists cases_owner_draft_unique
  on saferide.cases(owner_id, draft_id)
  where draft_id is not null;
create unique index if not exists case_events_one_submission_per_case
  on saferide.case_events(case_id, event_type)
  where event_type = 'submission';

update saferide.retention_policies
set policy_version = 'privacy-controls.2026-07-30.2'
where policy_version = 'privacy-controls.2026-07-30.1';

commit;
