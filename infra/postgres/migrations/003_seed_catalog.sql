begin;

insert into saferide.providers (name, type, channels, languages, services, phone, hours, is_open, safety_phrase, metadata)
values
  (
    'National GBV Toll-Free Helpline (HAK 1195)',
    'Hotline',
    '{"call": true, "whatsapp": false, "sms": false}'::jsonb,
    array['English', 'Kiswahili'],
    array['GBV support', 'Referral services'],
    '1195',
    '24/7',
    true,
    'Ask for GBV support',
    '{"reviewStatus": "Source-linked national helpline", "sources": [{"title": "Healthcare Assistance Kenya - 1195 Helpline", "url": "https://hakgbv1195.org/"}]}'::jsonb
  ),
  (
    'SafeRide Local Legal Desk',
    'Legal aid',
    '{"call": false, "whatsapp": false, "sms": false}'::jsonb,
    array['English'],
    array['Legal information', 'Evidence preparation'],
    null,
    'Local development only',
    false,
    null,
    '{"reviewStatus": "Local development placeholder; not a release-facing provider"}'::jsonb
  )
on conflict (name) do nothing;

insert into saferide.legal_tags (tag, description, category)
values
  ('harassment', 'Unwanted conduct in transit or public spaces.', 'incident'),
  ('assault', 'Physical assault or threat of physical harm.', 'incident'),
  ('evidence', 'Evidence collection and preservation guidance.', 'workflow')
on conflict (tag) do nothing;

insert into saferide.tips (title, body, category, tags, copy_steps, has_copy_steps, updated_label)
values
  (
    'Preserve evidence safely',
    'Keep original files, avoid editing media, and record context such as time, route, and witnesses.',
    'evidence',
    array['evidence', 'safety'],
    array['Save the original file', 'Record date and location', 'Back up privately'],
    true,
    'Local seed'
  ),
  (
    'Use trusted support channels',
    'When escalating, choose a provider or hotline you trust and avoid sharing more than needed.',
    'support',
    array['support', 'privacy'],
    array[]::text[],
    false,
    'Local seed'
  )
on conflict (title) do nothing;

insert into saferide.schema_migrations (version, name)
values ('003', 'seed_catalog')
on conflict (version) do nothing;

commit;
