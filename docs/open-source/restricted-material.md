# Restricted material policy

The following material must never be placed in public commits, issues, pull
requests, discussions, CI logs, fixtures, screenshots, or release assets:

- real survivor or participant narratives, identity details, evidence, audio,
  transcripts, media, or exact private locations;
- credentials, tokens, private keys, signing keys, keystores, connection
  strings, signed URLs, environment values, or shell history;
- consent/event logs, production telemetry, raw requests/responses, or private
  support conversations;
- partner agreements, unpublished contact records, incident/risk registers,
  legal advice, or restricted UNICEF review/submission material;
- confidential prompts, raw completions, private system policy, withheld
  red-team corpora, or exploitable security details; and
- production cloud account identifiers or operational configuration not
  already approved for public release.

Use synthetic fixtures that cannot be mistaken for real people. Sanitize logs
to event names, bounded status codes, and non-sensitive identifiers. Report
security issues through `../../SECURITY.md`.

If uncertain, do not publish the material. Open a content-free maintainer issue
or use a private organization channel for review.
