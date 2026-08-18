# SafeRide Core Component Contract

This contract sits on top of `src/theme/tokens.ts` and `Saferide_Design_Style_System.md`. It gives screen rewrite agents a shared component vocabulary so Home, report, evidence, cases, support, consent, and settings do not invent new one-off cards, rows, banners, or status labels.

## Component Surface

| Need | Component | Contract |
| --- | --- | --- |
| Primary and secondary actions | `Button`, `IconButton`, `SafetyAction` | Use `Button` for text commands, `IconButton` for icon-only tools with a required `accessibilityLabel`, and `SafetyAction` for high-stress Home/report actions. Support disabled/loading states and semantic tones. |
| Page grouping | `Section`, `SectionHeader`, `FormSection`, `Card` | Use `Section` for unframed page groups, `SectionHeader` for shared header/action layouts, `FormSection` for framed form groups, and `Card` only for genuinely grouped repeated content or pressable surfaces. Do not nest cards. |
| Lists and settings | `ListRow`, `ProviderRow`, `EvidenceRow`, `CaseTimelineItem` | Use rows for repeated items, settings, provider directory entries, evidence vault items, and case events. Each row exposes title, status, description, trailing metadata, and accessible press behavior. |
| Forms | `Input`, `Textarea`, `Select`, `Checkbox`, `Switch` | Use label/helper/error props instead of local text blocks. Pass clear labels for every touchable control and avoid screen-local field chrome. |
| Status and feedback | `StatePill`, `StatusBanner`, `Badge`, `Chip`, `LoadingState`, `EmptyState`, `ErrorState`, `UnavailableState`, `OfflineBanner`, `ToastProvider/useToast` | Use semantic tones for success, warning, destructive, critical, info, offline, queued, evidence, privacy, consent, support, case, and unavailable states. Do not create raw hex status pills or banners in screens. |
| Report progress | `ProgressStepper` | Use for report steps and consent/review flows. It supports complete/current/upcoming/error states and optional step press callbacks. |
| Consent | `ConsentSummary` | Use before data leaves the device. Items must say what is included, what is excluded, recipient/pathway, and retention or deletion limitations. |
| Modal/sheet patterns | `Sheet`, `Dialog` | Use `Sheet` for mobile bottom-sheet choices and `Dialog` for confirmation or destructive decisions. Keep primary/destructive actions visually separated. |

## Examples

```tsx
import {
  Button,
  IconButton,
  OfflineBanner,
  ProgressStepper,
  SafetyAction,
  StatePill,
  StatusBanner,
} from '../components/ui';

<OfflineBanner queuedCount={2} onPress={openOfflineQueue} />

<StatusBanner
  title="Evidence upload queued"
  message="Files stay local until SafeRide can reach the service."
  tone="queued"
  icon="cloud-upload-outline"
/>

<StatePill label="Local only" tone="privacy" icon="phone-portrait-outline" />

<SafetyAction
  title="Continue draft"
  description="Last saved locally 4 minutes ago"
  icon="document-text-outline"
  statusLabel="Local only"
  onPress={resumeDraft}
/>

<ProgressStepper
  currentStepId="evidence"
  steps={[
    { id: 'what', label: 'What happened' },
    { id: 'where', label: 'Where and when' },
    { id: 'evidence', label: 'Evidence' },
    { id: 'consent', label: 'Consent' },
  ]}
/>

<IconButton
  icon="close"
  accessibilityLabel="Close support options"
  onPress={closeSheet}
/>

<Button title="Submit when online" loading={isSubmitting} disabled={!canSubmit} />
```

```tsx
import { ConsentSummary, EvidenceRow, ProviderRow } from '../components/ui';

<EvidenceRow
  title="Vehicle plate photo"
  kind="Photo"
  status="queued"
  detail="Will upload when the phone is online"
  privacyLabels={['Metadata removal requested']}
/>

<ProviderRow
  name="Verified support provider"
  serviceType="GBV support"
  availabilityLabel="Network required"
  verified
/>

<ConsentSummary
  pathwayLabel="Provider referral"
  recipientLabel="Verified support provider"
  retentionNote="You can request deletion later. Remote deletion is not instant."
  items={[
    { id: 'narrative', label: 'Report narrative', included: true, tone: 'consent' },
    { id: 'evidence', label: 'Evidence files', included: true, tone: 'evidence' },
    { id: 'identity', label: 'Legal name', included: false, description: 'Not added to this report' },
  ]}
/>
```

## Accessibility Requirements

- Icon-only controls must use `IconButton` or pass an explicit `accessibilityLabel`.
- Pressable `Card`, `ListRow`, `SafetyAction`, provider rows, evidence rows, and timeline actions must expose the real destination or action in the label or hint.
- Touch targets should stay at or above `touchTargets.minimum` from `src/theme/tokens.ts`.
- Loading controls should keep their label visible where possible and set busy/disabled state.
- Do not hide unavailable actions as successful states. Disable them or show `ErrorState`, `OfflineBanner`, or an honest badge.

## Reusable State Vocabulary

Use these semantic tones instead of visual color names:

- `privacy`: local-only mode, sensitive fields, redaction requested, identity visibility.
- `queued`: per-object pending upload/sync/replay state.
- `offline`: app/network state, API unreachable, local fallback.
- `evidence`: evidence capture, attached files, processing requested/applied.
- `consent`: final sharing checkpoint, data manifest, recipient confirmation.
- `support`: provider directory, support resources, cached provider catalog.
- `case`: current case timeline, submitted/closed/local draft case status.
- `unavailable`: disabled or not-implemented actions that must not look successful.
- `critical` and `destructive`: critical state versus destructive action.

## Old One-Off Patterns To Migrate

- Home feature tiles with local styles should become `SafetyAction`, `ListRow`, `OfflineBanner`, and `EmptyState` modules during the Safety Command Center rewrite.
- Report step headers and ad hoc step chips should move to `ProgressStepper`.
- Evidence cards in `EvidenceDetail` should move to `EvidenceRow` with explicit `local`, `queued`, `uploaded`, `failed`, `processing`, or `unavailable` status.
- Provider cards in `ReferralPicker` should move to `ProviderRow` and stop duplicating badge/channel styles.
- Case event blocks in `CaseDetail` should move to `CaseTimelineItem`.
- Consent checklist blocks in `ConsentGate` should move to `ConsentSummary`; redaction labels must say `requested` unless processing actually completed.
- Settings rows in `Settings`, `PrivacyData`, `SafetySettings`, and `LanguageAccessibility` should move to `ListRow`, `Switch`, `Checkbox`, and `Badge` instead of local row layouts.
- Screen-local empty/error/offline/loading/unavailable copy should move to `EmptyState`, `ErrorState`, `LoadingState`, `UnavailableState`, `StatusBanner`, and `OfflineBanner`.
- Raw color literals for status pills, borders, shadows, and disabled surfaces should be replaced with theme tokens or `ComponentTone` variants.

## Boundaries

This issue adds reusable primitives and documentation only. It does not rewrite full screens, change navigation, implement report business logic, alter evidence processing, or claim unavailable privacy/security behavior.
