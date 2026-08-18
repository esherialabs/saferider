# SafeRide Navigation Shell Patterns

This migration note defines the Phase 1 shell contract for SRMOD screen work. It consumes the Safety Command Center IA, token/theme foundation, core component contract, copy guide, and screen inventory. It is not a report business-flow rewrite.

## Implemented Shell Contract

- Bottom tabs are `Home`, `Report`, `Cases`, and `Support`. `Settings` is a root stack route opened from the app header.
- The tab header uses `AppHeader` with token colors, one-line title/subtitle behavior, network state, Settings access, and a Quick Exit button that opens the calculator decoy screen.
- `ShellScreen` owns safe-area layout, scroll-page layout, keyboard-safe layout, sticky footer placement, status bar color, and network/offline banner placement.
- `NetworkStatusBanner` surfaces offline, queued, and sync-error states without implying that remote work has completed.
- `CompactReportHeader` combines a compact title area, Quick Exit, and `ProgressStepper` for report steps.
- `StickyFooterActions` keeps primary and secondary actions docked above the bottom inset with consistent button behavior.
- `ScreenTemplates.tsx` provides templates for dashboard, report step, list/detail, settings, chat, and consent screens.

## Template Use

- Dashboard: use `DashboardTemplate` for Home/Safety Command Center modules. Use `SafetyAction`, `Section`, `Badge`, `OfflineBanner`, and concise state rows instead of decorative feature tiles.
- Report step: use `ReportStepTemplate` with `REPORT_SHELL_STEPS`, sticky footer actions, and `keyboardSafe` for forms.
- List/detail: use `ListDetailTemplate` for Cases and CaseDetail list/detail surfaces with local/queued/remote state rows.
- Settings: use `SettingsTemplate` for grouped settings rows. Unsupported controls must be disabled or unavailable, not successful.
- Chat: use `ChatTemplate` for support/chat surfaces with a keyboard-safe composer and clear online/offline assistant state.
- Consent: use `ConsentTemplate` for data manifests, consent confirmations, and queued/online submit states.

## Modal And Sheet Rules

- Use `Sheet` or `Dialog` only for contained decisions, previews, confirmations, and secondary filters.
- Do not put large report steps, provider selection, or settings hubs inside modal cards.
- Every sheet needs a title, accessible dismissal, and a non-destructive default action.
- Destructive actions need explicit confirmation and honest data-state copy.

## Migration Checklist

### Home

- Replace search and tile layouts with state-driven `DashboardTemplate` sections.
- Show active draft, queued submit, failed evidence upload, offline/local-only, and no-data states from real services.
- Keep quick exit in the header and emergency/help language Kenya-specific.
- Remove any control that does not navigate or perform real work.

### Reporting

- Use `ReportStepTemplate` on report steps as they are migrated.
- Keep `REPORT_SHELL_STEPS` as the shared stepper order unless product changes the journey.
- Keep referral and escalation data collection before `ConsentGate`; do not duplicate the route-flow fix.
- Use sticky footer actions for continue/back/decide-later flows.

### Settings

- Keep Settings out of the bottom tab bar.
- Use grouped rows under `SettingsTemplate` for account, safety, privacy/data, language/accessibility, and legal/about.
- Unsupported privacy, export, deletion, accessibility, or stealth controls must be disabled or labelled unavailable.

### Chat And Support

- Treat `Support` as the tab; chat is one support mode.
- Keep local assistant, offline, unavailable, and queued-message states visible.
- Do not claim legal advice, emergency response, or provider handoff beyond implemented behavior.

### Cases

- Use `ListDetailTemplate` for case lists and details as those screens migrate.
- Show draft, local-only, queued, submitted, failed, deletion-requested, and closed states distinctly.
- Keep export, delete, evidence download, and amend actions unavailable unless the backing workflow exists.

## Verification Notes For Future Screen Migrations

- Check small Android portrait widths for header, tab label, button, and status text overflow.
- Run `npx tsc --noEmit`, focused tests, `npm run secrets:scan`, and `git diff --check` for every shell migration PR.
- Search for stale `Chat` and `Settings` tab assumptions after navigation changes.
- Do not treat dark/high-contrast scaffold support as visually approved until screen-by-screen QA is done.
