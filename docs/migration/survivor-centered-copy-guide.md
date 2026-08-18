# SafeRide Survivor-Centered Copy Guide

Status: Phase 1 modernization guidance. Requires product, safeguarding, legal, and Kenya-context review before release copy is treated as final.

This guide defines the reusable copy rules for SafeRide modernization. It is for UI labels, empty states, consent gates, error messages, onboarding, help content, and support/referral flows. It does not give user-specific emergency, legal, medical, or counselling advice.

## Voice Principles

- Calm: use plain, steady language. Avoid urgency unless the action is truly time-sensitive.
- Practical: say what the app can do now, what the user controls, and what remains manual.
- Non-judgmental: never ask why the user did or did not act. Avoid blame, pressure, or "should have".
- Honest: describe implemented protections precisely. Do not use stronger safety, privacy, legal, AI, or response claims than the app enforces.
- Kenyan-context aware: support language should fit Kenya deployment, provider catalogs, GBV referral pathways, P3/OB references, local emergency numbers, and English-first/Kiswahili-ready content.
- Survivor-led: the user chooses whether to save, share, report, export, delete, or seek support.

## Naming

- User-facing product name: `SafeRide`.
- Avoid user-facing `Safe Ride` and `Saferide` except where referring to an internal package, model, URL, or legacy code identifier.
- Assistant label: `SafeRide assistant` or `on-device assistant`, not a human-sounding counsellor name.
- Report object labels:
  - Before submission: `draft`, `incident draft`, or `private report draft`.
  - After user sends to SafeRide API: `submitted report` or `case record`.
  - After referral is selected: `support brief`, not `provider handoff` unless a provider receives it through an implemented integration.
- Pathway names:
  - `Save privately`
  - `Share a route safety update`
  - `Ask for support`
  - `Prepare a formal report`

## Claims The App Must Not Make

Do not say these unless product and engineering confirm the behavior is implemented, tested, and in the current release:

- Legal: `legal advice`, `legal expert`, `court-ready`, `official report`, `guaranteed admissible`, `we will file for you`, or statute/offence certainty.
- Encryption: `end-to-end encryption`, `advanced encryption`, `encrypted vault`, `encrypts all files`, `sealed`, or `tamper-proof` unless the exact data class is protected that way.
- Redaction: `automatic face blur`, `automatic metadata removal`, `automatic redaction`, `names removed`, or `anonymous` unless the app performs and verifies that processing before sharing.
- Anonymity: `anonymous` if logs, device identifiers, IP address, location, provider contact, uploaded media, account identity, or free text could identify the user. Prefer `without your name` or `with limited identifying details` when that is what is true.
- Emergency response: `emergency services are alerted`, `police are notified`, `immediate response`, or `call 911` for Kenya release surfaces unless the region and dial behavior are intentionally configured.
- Provider handoff: `connected`, `matched`, `verified provider`, `professional guidance`, or `confidential briefing` unless the catalog freshness, provider verification, delivery channel, and confidentiality promise are true.
- Data deletion/export: `delete forever`, `erase everywhere`, `secure export`, or `redactions applied` unless remote copies, shared files, backups, and media processing match that claim.
- AI: `understands`, `diagnoses`, `classifies accurately`, `knows the law`, or `gives legal advice`. Use `suggests`, `may help`, `review`, and `you decide`.

## Privacy And Safety Copy

Use data-class-specific wording.

| If the implementation protects | Prefer this copy | Avoid |
| --- | --- | --- |
| Draft text and queued payloads are encrypted at rest | `App drafts and queued messages are protected on this device.` | `Everything is encrypted.` |
| Media files are stored locally but not file-level encrypted | `Attached files stay on this device until you choose to share or export them.` | `Encrypted evidence files.` |
| Nothing is automatically uploaded | `Nothing is sent until you review and choose to send.` | `No data sharing` without context. |
| A setting requests redaction but processing is not verified | `Review files before sharing. Some details may still be visible.` | `Faces blurred`, `metadata removed`, or `automatic redaction`. |
| User can delete local drafts | `This removes drafts stored on this device.` | `Deletes everything forever.` |

Every privacy-control label should answer:

- What data is affected?
- Where does it stay or go?
- Who can receive it?
- What can still reveal identity?
- Can the user review or undo the action?

## Emergency And Kenya Support Language

- Do not default Kenya copy to `911`. The current Home screen has `Emergency - Call 911`; replace that pattern with regional copy such as `Emergency options`, `Call local emergency support`, or `Open emergency contacts`.
- Keep emergency numbers in a single reviewed source, not scattered across screens. The app currently references `911`, `116`, `1195`, `999`, and `112`; release copy must use one reviewed Kenya support policy.
- For Kenya GBV support, prefer copy patterns that reference a verified catalog entry and last-reviewed date, for example: `Call the National GBV Helpline listed in SafeRide support contacts. Availability and numbers can change.`
- If a specific number is shown, include its purpose and scope: `1195 - National GBV Helpline, toll-free in Kenya, 24/7 according to reviewed source`.
- For police or emergency services, say what the app does: `This opens your phone dialer. SafeRide does not contact police for you.`
- Do not guarantee response time, confidentiality by third parties, police action, medical availability, or provider acceptance.
- Use `support provider`, `GBV recovery centre`, `legal aid provider`, or `hotline`. Avoid `rescuer`, `legal expert`, or `emergency responder` unless that role is verified.

Source maintenance:

- `assets/data/providers.json` is the app provider catalog.
- `assets/data/tips.json` is educational support content and should carry source dates.
- Product/legal should verify Kenya support numbers against official or trusted sources before release. Current external review references include Healthcare Assistance Kenya 1195 (`https://hakgbv1195.org/`) and UN Women coverage of Kenya's 1195 helpline (`https://africa.unwomen.org/en/stories/news/2024/10/kenyas-national-toll-free-helpline-1195-a-lifeline-for-gender-based-violence-survivors`).

## Consent Copy Pattern

Consent gates must use this structure:

1. Action: `You are about to send...`
2. Recipient: `to [provider/API/support channel]...`
3. Contents: `This includes [specific fields].`
4. Exclusions: `This does not include [raw media/name/contact] unless selected.`
5. Limits: `SafeRide cannot guarantee provider response or legal outcome.`
6. Control: `You can go back, edit, or cancel.`

Use:

- `Review before sending`
- `Send this support brief`
- `Share route safety details`
- `Save privately on this device`
- `You can return and edit before anything is sent`

Avoid:

- `Send securely` unless the exact channel is secure and described.
- `Send anonymously` unless identifying fields, logs, files, and transport metadata are addressed.
- `Official channels` unless the recipient channel is official and integrated.
- `Escalate for action` if the app only queues or prepares a packet.

## Screen-Specific Guidance

### Home

- Primary actions should be concrete: `Start a report`, `Continue draft`, `Open support chat`, `View cases`, `Learn`.
- Emergency CTA should be regional and truthful:
  - Replace `Emergency - Call 911` with `Emergency options`.
  - Dialog pattern: `Choose what to open. SafeRide will not contact anyone unless you choose an option.`
  - Dialer pattern: `Open phone dialer for [number/purpose]`.
- Search placeholder should not imply global capability. Prefer `Search reports, tips, and support`.
- If a disguised trigger is present, accessibility labels should describe the visible affordance without exposing unsafe hidden behavior.

### Reporting Flow

- Use `report`, `draft`, and `incident details` instead of `case` until the user submits.
- Ask for facts in neutral language:
  - `What happened?`
  - `When did it happen?`
  - `Where did it happen?`
  - `Add details only if you want to.`
- Avoid police-report pressure. Use: `Reporting to police or a provider is your choice.`
- For legal tags, use `suggested tags`, `possible category`, and `review this`. Avoid `offence confirmed`.

### Evidence

- Evidence status labels should describe state, not legal strength:
  - `Added on this device`
  - `Saved in draft`
  - `Queued for upload`
  - `Uploaded; hash recorded`
  - `Upload failed; retry available`
  - `Transcript ready - review before using`
  - `Redaction requested - review file before sharing`
- Avoid `court-ready`, `verified evidence`, `tamper-proof`, `forensic`, or `admissible` unless reviewed by legal/product.
- For privacy toggles:
  - Replace `Encrypt evidence files` with `Protect supported draft data` or a data-class-specific label until media encryption is verified.
  - Replace `Automatically blur faces` with `Request face blur before sharing` unless processing runs and saves verified output.
  - Replace `Strip location and device info from files` with `Remove supported metadata before sharing` only if true for every supported file type.

### Consent

- Checklist rows should be explicit: `Included`, `Not included`, `Optional`, `Unavailable offline`.
- Redaction chips must represent completed work, not desired settings. Use `Face blur requested` or `Face blur applied to 2 photos` based on actual state.
- Identity labels:
  - `No name included`
  - `Alias included`
  - `Provider may see your phone number if you call or message`
  - `Location may still identify you`
- Button labels should name the action: `Send support brief`, `Queue route safety update`, `Save private draft`.

### Chat And AI

- The chat is not a lawyer, counsellor, clinician, or emergency dispatcher.
- Standard disclaimer: `SafeRide may make mistakes. This is general information, not legal, medical, or counselling advice. You decide what to use.`
- For AI suggestions:
  - Use `AI suggestions`, `Possible tags`, `Why this may fit`, `Review`, `Accept`, `Dismiss`.
  - Pair confidence labels with limits: `High match to your draft, not a legal conclusion.`
- Offline fallback should not create urgency beyond known public guidance. Prefer `Saved offline. If you need urgent help, use your reviewed emergency contacts.`
- Avoid giving personalized medical/legal instructions in dynamic chat copy unless produced through a reviewed content source.

### Provider Referral

- If providers are cached, say `Showing saved provider listings from [date]`.
- If offline with no cache, say `Provider list is unavailable offline. You can save a number to use later.`
- Consent preview: `You will review the brief before anything is sent.`
- Provider labels:
  - `Listed support provider` if catalog verification is not current.
  - `Verified on [date]` only if there is a verification process and timestamp.
- Avoid `connected with`, `matched with`, `expert support`, and `confidential briefing` unless the delivery and confidentiality terms are implemented and reviewed.

### Data Deletion And Export

- Deletion copy must state scope:
  - `This removes drafts, evidence, backups, and settings stored on this device.`
  - `It does not remove files you already exported, shared, or sent to another service.`
  - `You have 10 seconds to undo.`
- Avoid `delete all data` if remote records, provider copies, exported files, or OS backups remain.
- Export copy must state risk:
  - `Export creates a local file. Other apps may store or share it after you choose them.`
  - `Raw media can reveal identity. Review before including it.`
  - `Redactions apply only to files marked as processed.`
- If export integrity uses hashes, say `hash recorded` or `integrity file included`, not `tamper-proof`.

### Offline States

- Offline messages should name what is possible now and what will wait.
- Good patterns:
  - `Saved on this device. We will try to send when you are online.`
  - `Queued for sending. You can review it before retrying.`
  - `Provider list is unavailable offline. Saved contacts may still appear.`
  - `Sync failed. Your draft is still saved on this device.`
- Avoid:
  - `All queued items synchronized` unless every item succeeded.
  - `Message sent` when it is only queued.
  - `Anonymous upload queued` unless anonymization has already been applied and verified.

## Old Copy To Replace

| Current/old copy pattern | Problem | Replacement pattern |
| --- | --- | --- |
| `Welcome to Safe Ride` | Inconsistent product name. | `Welcome to SafeRide` |
| `Advanced encryption protects your data` | Overbroad and not data-class-specific. | `Supported drafts and queues are protected on this device.` |
| `End-to-end encryption` | Implies E2E semantics not implemented. | `Protected local drafts and queued messages.` |
| `Encrypted, local vault` | Implies all files/media are encrypted. | `Save a private draft on this device.` |
| `Local encryption` | Too broad. | `Device-protected app drafts` |
| `Anonymous sharing` | Overclaims if metadata, location, logs, or text can identify. | `Share without your name; review details that could identify you.` |
| `Automatic redaction` | Overclaims if processing is not verified. | `Review and remove identifying details before sharing.` |
| `Automatic face blurring` | Overclaims if no processed output exists. | `Request face blur before sharing; review the result.` |
| `Metadata removal` | Overclaims if not all file types are handled. | `Remove supported metadata before sharing.` |
| `Emergency - Call 911` | US-centric for Kenya release. | `Emergency options` or `Open local emergency contacts` |
| `Legal expert matching` | Overstates provider and AI capability. | `Find listed legal aid and support providers.` |
| `Professional guidance` | Implies credentialed advice. | `Support information from listed providers.` |
| `Send securely` | Needs channel-specific security proof. | `Send support brief` or `Queue report for sending` |
| `Send anonymously` | Needs anonymity proof. | `Send without your name` plus identity limits. |
| `Data Wiped` | Overstates deletion scope. | `Device data removed` |
| `All queued items synchronized` | Overstates if partial sync is possible. | `[count] queued item(s) sent. [count] still waiting.` |

## Error And Empty-State Copy

- State the problem, preserve user agency, and give the next action.
- Use `Please try again` only with a clear retry path.
- Do not blame connectivity, device storage, or user input in a way that adds shame.
- Good patterns:
  - `Save failed. Your draft is still open. Try again.`
  - `Upload failed. The file is still on this device.`
  - `Chat is unavailable right now. You can keep writing; messages will save offline.`
  - `Provider update failed. Saved provider listings are still available.`
  - `This field needs a date. Use an estimate if you are not sure.`
- Avoid:
  - `Invalid victim statement`
  - `You must report`
  - `No evidence`
  - `Failed to protect file`
  - `Unsafe`

## Localization And Accessibility

English source copy should be translation-ready:

- Use short sentences, active voice, and one idea per sentence.
- Avoid idioms, slang, legal jargon, and metaphors that are hard to translate.
- Keep sentence fragments acceptable for small UI labels.
- Use `Kiswahili` for the language name in English copy. Avoid mixing English and Kiswahili in one sentence unless reviewed.
- Keep support numbers, laws, provider names, county names, and dates in structured data so they can be localized or updated.
- Do not concatenate translated strings around variables. Use full-sentence templates.
- Avoid all caps except exact typed confirmations such as `DELETE`.
- Accessibility labels must describe the visible action. Do not rely on emoji alone.
- Buttons and chips should fit large text. Prefer short verbs: `Review`, `Send`, `Save`, `Delete`, `Undo`.
- Error messages should be readable by screen readers without requiring visual color context.

## Agent Checklist

Before editing survivor-facing copy, confirm:

- [ ] Product name is `SafeRide` in user-facing text.
- [ ] The copy says what the app does now, not what the roadmap intends.
- [ ] Legal, medical, counselling, emergency, and AI claims are clearly limited.
- [ ] Privacy language names the data class and action: draft, queue, media, export, provider brief, route update.
- [ ] Consent copy identifies recipient, contents, exclusions, limits, and user control.
- [ ] Emergency/support language uses Kenya-reviewed source data and does not default to US-only numbers.
- [ ] Provider language does not promise handoff, response, confidentiality, or verification unless implemented.
- [ ] Evidence/redaction/encryption wording matches actual processing state.
- [ ] Offline copy distinguishes saved, queued, sent, failed, and retry states.
- [ ] Delete/export copy explains local scope and already-shared/remote-copy limits.
- [ ] Chat/AI copy says suggestions are not legal advice and users decide what to keep.
- [ ] English source is short, plain, accessible, and ready for future Kiswahili localization.
- [ ] Empty/error states give a next action without blame.
- [ ] Any support number, legal reference, provider listing, or medical time window has a reviewed source and date.
