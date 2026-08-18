# SafeRide Design-System Usage And Visual QA Guide

This guide is the practical usage layer for the SafeRide design system. Use it with:

- `Saferide_Design_Style_System.md` for tokens, theme modes, and accessibility baselines.
- `docs/migration/core-component-contract.md` for reusable component APIs.
- `docs/migration/navigation-shell-patterns.md` for app shell and screen templates.
- `docs/migration/survivor-centered-copy-guide.md` for wording and unsupported-claim rules.
- `src/screens/__fixtures__/DesignSystemFixtures.tsx` for a repo-native fixture screen.

The goal is consistency during SRMOD screen migrations. This guide does not replace release QA, device QA, product legal review, or the final accessibility/performance review.

## Component Catalog

| Need | Use | Required states |
| --- | --- | --- |
| Primary commands | `Button` | default, secondary, outline, ghost, destructive, loading, disabled |
| Icon-only tools | `IconButton` | required `accessibilityLabel`, loading, disabled, quick-exit labels |
| High-stress action rows | `SafetyAction` | actionable, disabled/unavailable, status label, no chevron when unavailable |
| Page groups | `Section`, `SectionHeader`, `FormSection` | plain by default, framed only when grouping helps scanning, required/error form states |
| Repeated surfaces | `Card` | selected, disabled, pressable, no nested cards |
| List and settings rows | `ListRow` | compact/regular/spacious, selected, disabled, trailing status |
| Forms | `Input`, `Textarea`, `Select`, `Checkbox`, `Switch` | helper, error, disabled, offline/unavailable copy |
| Status labels | `StatePill`, `Badge`, `Chip` | success, warning, destructive, critical, info, offline, queued, privacy, consent, evidence, support, case, unavailable intent |
| Report progress | `ProgressStepper` | complete, current, upcoming, error |
| System states | `StatusBanner`, `LoadingState`, `EmptyState`, `ErrorState`, `UnavailableState`, `OfflineBanner` | loading, empty, offline, queued, unavailable, error, retry, queued count |
| Consent manifests | `ConsentSummary` | included, excluded, recipient, retention/deletion caveat |
| Domain rows | `EvidenceRow`, `ProviderRow`, `CaseTimelineItem` | local, queued, failed, uploaded, cached, blocked, current |
| Shell and templates | `AppHeader`, `CompactReportHeader`, `ShellScreen`, `DashboardTemplate`, `ReportStepTemplate`, `ListDetailTemplate`, `SettingsTemplate`, `ChatTemplate`, `ConsentTemplate` | safe area, keyboard safe, sticky footer, quick exit, network banner |

## Composition Rules

- Use templates first. Pick the closest screen template, then compose sections and rows inside it.
- Use `Section` for page structure and `Card` for repeated items or genuinely framed content. Do not put cards inside cards.
- Pass intent to components instead of raw colors. Use `tone`, `variant`, `status`, and semantic labels. Prefer `queued`, `support`, `case`, and `unavailable` tones when those states are the real product condition.
- Keep disabled and unavailable different from success. If a capability is not implemented, disable it or show an unavailable state.
- Keep privacy, consent, and evidence copy literal. Say `Metadata removal requested` only when processing is not proven; say `Processed` only after a real processor completes.
- Keep emergency and provider language honest. SafeRide can show support options; it must not claim emergency dispatch or confirmed provider handoff unless that workflow exists.
- Keep Home dense and state-driven. Use `SafetyAction`, `OfflineBanner`, recent rows, and status strips instead of decorative tiles.
- Keep destructive actions visually separated and confirmation-gated. Use `destructive` tone plus a clear consequence.

## Do And Do Not

| Do | Do not |
| --- | --- |
| Use `SafetyAction` for `Continue draft`, `Add evidence`, `Get support`, and unavailable high-stress actions. | Recreate Home feature tiles with screen-local borders, shadows, and icons. |
| Use `EvidenceRow` statuses such as `local`, `queued`, `failed`, `uploaded`, `processing`, and `unavailable`. | Show a generic green success state while uploads, redaction, or metadata work is only requested. |
| Use `ConsentSummary` before data leaves the device. | Hide identity, recipient, retention, or deletion limitations in long paragraph copy. |
| Use `ProviderRow` with `verified`, `cached`, and `availabilityLabel`. | Suggest a provider received a referral before the app has submitted it and received a real response. |
| Use `CaseTimelineItem` for case events and blocked states. | Use free-form timeline cards that blur local, queued, submitted, and failed states. |
| Use `StatusBanner`, `OfflineBanner`, `StatePill`, and per-object queued labels. | Let spinners stand in for offline, blocked, unavailable, or retryable work. |
| Use disabled buttons/rows for unavailable settings and explain the condition. | Let unavailable settings look enabled or toast fake success. |

## Accessibility Requirements

- Minimum touch target is 44 x 44 pt; preferred primary action height is 52 pt.
- Icon-only actions must have a useful `accessibilityLabel` and, when needed, `accessibilityHint`.
- Loading actions must set busy/disabled state and keep enough label context visible.
- Screen-reader labels for evidence, providers, and cases must include the object name and state.
- Dynamic type must be allowed. Critical safety, consent, privacy, and legal copy must wrap instead of disappearing behind ellipses.
- Focus order follows visual task order: header, urgent banner, primary action, secondary actions, detail rows, footer actions.
- Destructive actions need an explicit confirmation path and must not sit adjacent to a primary submit action without separation.

## Fixture Surface

`src/screens/__fixtures__/DesignSystemFixtures.tsx` is a manual visual QA surface. It is intentionally not registered in production navigation.

To inspect it temporarily:

1. In `App.tsx`, import `DesignSystemFixtures` from `./src/screens/__fixtures__/DesignSystemFixtures`.
2. Inside `AppContent`, temporarily add a fixture-readiness effect after the local state declarations:

   ```tsx
   useEffect(() => {
     setNavigationReady(true);
   }, []);
   ```

   This keeps the existing splash-screen readiness flow working while `RootNavigator` is not mounted.

3. Temporarily render `<DesignSystemFixtures />` in place of `<RootNavigator onReady={() => setNavigationReady(true)} />`.
4. Keep the existing `SafeAreaProvider`, `SimpleThemeProvider`, `OnlineProvider`, `AuthProvider`, `OnboardingProvider`, and `ToastProvider` wrappers.
5. Revert both temporary edits before committing or shipping.

Do not add the fixture to the bottom tabs or a user-facing route. It is for local screenshots, visual review, and component contract checks.

## Fixture Coverage

The fixture includes:

- Report stepper states: complete, current, upcoming, and error.
- Evidence rows: local only, queued, uploaded, failed, processing requested, and unavailable.
- Consent summary: included and excluded data, provider recipient, retention/deletion caveat.
- Provider rows: verified online, cached offline, and unavailable network-required states.
- Case timeline rows: complete, current, pending, failed, and blocked.
- Offline/status banners: standard offline, queued work, provider cached, support, case, and unavailable states.
- State examples: loading, empty, offline, error, unavailable, success, disabled, destructive, and privacy-sensitive.
- Form examples: `FormSection`, helper text, required state, disabled state, validation error, textarea, select, checkbox, and switch.
- Text-overflow examples: long report labels, long provider names, and compact metadata rows.

## Visual QA Steps

Run these checks before using a new component pattern in a screen migration PR:

1. Start the app and mount the fixture locally.
2. Capture screenshots at 360 x 740 and 320 x 568 portrait widths.
3. Increase system text size to at least Extra Large and re-check primary actions, row titles, badges, and consent copy.
4. Switch the theme provider to `light`, `dark`, and `highContrast` manually only for fixture review. Do not expose dark or high-contrast as user settings until screen-by-screen QA is complete.
5. Toggle airplane mode and verify offline copy remains honest. The fixture uses static examples, so production screens still need real offline journey QA.
6. Check that destructive examples remain visually distinct and are not next to a primary submit action without context.
7. Check that privacy-sensitive labels say `requested`, `local only`, `queued`, `unavailable`, or `processed` according to actual behavior.
8. Confirm long labels wrap without overlapping icons, badges, rows, or footer actions.
9. Run the relevant TypeScript/tests plus `npm run secrets:scan` and `git diff --check`.

## Known Limitations

- No screenshots are committed in this PR because this environment does not provide device or simulator visual capture.
- The fixture is a static component-state surface. It does not prove production navigation, offline replay, evidence upload, provider referral, case deletion, or device permission behavior.
- Dark and high-contrast modes are token/provider scaffolds. Treat fixture review as early signal only until each production screen is migrated and checked.
- Primary buttons are intentionally solid and token-driven. Do not reintroduce decorative gradients in screen-local action styles.
- ESH-3897 remains the release QA matrix. ESH-3953 remains the later accessibility, text-overflow, and performance review.

## Migration Checklist

- [ ] New UI uses existing tokens/components before adding another primitive.
- [ ] No raw hex colors, local shadows, or custom status pills were added.
- [ ] Every visible state maps to implemented behavior or an unavailable state.
- [ ] Empty, loading, offline, error, success, disabled, destructive, and privacy-sensitive states are covered.
- [ ] Small-screen and long-text behavior is checked.
- [ ] Screen-reader labels are present for icon-only and pressable row controls.
- [ ] Unsupported privacy, AI, legal, emergency, provider, deletion, and export claims are absent.
