# Scheduler integration audit — September 12, 2026

This review examined the combined eight-stage scheduler changes in draft PR #5, starting at remote commit `0633225287c80e97d23ca3db5c992ee3ac344f93`. It checked rule enforcement, generation and repair, saved state, history, overtime approval, publication, copied weeks, employee removal, and UI callbacks. Confirmed defects were fixed on the existing review branch.

## Findings and corrections

| Priority | Defect and consequence | Correction and evidence |
| --- | --- | --- |
| High | A supervisor qualified for Medical could leave a weekday first-shift Supervisor duty through a handoff and supply regular staffing on second shift. This bypassed the dedicated supervisor rule. | Handoffs now enforce the same weekday supervisor position restrictions as regular and extended work. A production policy regression reproduces and blocks the case. |
| High | A Friday third-shift worker could stay into Saturday first shift without Saturday counting toward weekend or consecutive-day limits. Previous-week history also lost that sixth day. | Handoff target days count as working days in current policy checks and prior-week streaks. The Mon–Fri plus Saturday fixture now reports both relevant limits and six trailing days. Ordinary overnight work retains its starting-day convention. |
| High | Changing the week changed the date attached to the live draft. The history autosave helper was never called, so navigation could lose the relationship between dates and duties. | Navigation first saves the complete current week, then loads the most recently saved target week or an empty draft. Archive failure or an intervening edit prevents replacement. Automatic history now runs after input saves complete. |
| High | Regular duties, extended shifts, handoffs, training annotations and the date used separate storage keys. Interruptions could leave a mixture of weeks or proposal versions. | The active draft now uses one `shift_active_week` record. Migration preserves legacy keys and verifies the new record by reading it back. Proposals, undo/redo, clearing and full-week loading use complete weekly updates. |
| High | Persistent setters marked data ready before asynchronous saves finished and ignored write failures. Concurrent writes could finish out of order. Startup migration could race hydration or stamp a version after a failed write. | Writes are serialized per key; readiness remains false until the newest write is acknowledged. Read/save errors are visible and block publication. Startup awaits schema and weekly migration. Tests cover delayed reads, denied access, quota errors, unacknowledged writes, retry and write ordering. |
| High | History views used the selected regular schedule alongside the current week’s dates, roster, extended duties, handoffs or leave. Preview/popout components independently reread live data. | History now supplies a consistent view snapshot to the grid, Excel preview/export and popout. New history includes roster, PTO and training annotations. Exiting history only changes the view; it does not write the live draft. Date labels derive directly from the viewed week. |
| High | Saved templates included only regular assignments. Loading one could retain unrelated current extended duties or handoffs and miss the complete-proposal overtime review. | Templates save all weekly duty types and training annotations. Loading replaces them together through hard-rule and lock checks, with overtime staged for review. Current-week leave remains authoritative. Legacy regular-only templates supply empty extended/handoff/training lists. |
| High | Updating a named historical record in place did not move its array position. Reverse-array selection could use an older previous-week record and miss Saturday work. | History selection uses actual save timestamps with a stable fallback. Fatigue/publication retains the explicit preference for manual history; week navigation selects the latest draft of either type. Malformed previous-week duties now produce blocking validation issues. |
| High | A pending asynchronous approval could commit after the schedule grid unmounted. Delayed manual confirmations could likewise act on another week or changed rules. Undo history could cross week boundaries. | Unmount invalidates pending work and cancels the search. Manual commits verify the input snapshot is current. The grid remounts for a different week, resetting week-specific undo and modal state. Tests exercise stale callbacks and cancellation. |
| Medium | Roster clearing removed only regular assignments. Removing an employee left extended halves and handoffs referring to an unknown employee. | Whole-roster resets clear all weekly duties and training annotations. Individual removal clears the employee’s regular assignments, extended halves and handoffs while preserving an extended partner. Locked duties still prevent removal. |
| Medium | Backup restore ignored failed writes and could report success. An invalid publication ledger was rejected only after other restored data had already changed. | Weekly data and publication records are checked before writes. Failed writes stop restoration and report possible partial progress. Backups include the new active record and refreshed legacy aliases; active-week reads and publication reads must succeed. |
| Medium | Settings offered up to 14 consecutive days/nights, while publication supports and validates a range ending at seven. | Both controls now use the implemented maximum of seven. Existing out-of-range imported settings remain visible validation failures rather than silently changing the manager’s rules. |

The storage change also required two lifecycle corrections: the session counter increments only once instead of reacting to every save-readiness transition, and generated-roster autofill waits for saved inputs and automatic history before consuming its pending request.

## Validation

- **204 tests pass:** the existing 169 regressions plus 35 new integration audit tests.
- New tests use the production core, storage hook and extracted production callbacks; they cover navigation sequencing, complete proposal writes, stale manual confirmations, employee removal, backup preflight and startup ordering.
- All four inline scripts compile with Babel. Scope comparison against the pre-audit branch finds no new unresolved identifiers.
- `git diff --check` passes.
- The GitHub Actions workflow includes the new audit suite on pushes and pull requests.

Reproduce with:

```sh
node --test test-coverage.js test-policy.js test-pto.js test-overtime.js test-availability.js test-completion.js test-publication.js test-locks-fairness.js test-integration-audit.js
```

The existing rules remain: continuous coverage by three distinct qualified regular people; dual qualification is acceptable; a separate fourth supervisor on weekday first shift; approved PTO counts toward the full-time 40-hour obligation; authorized cross-shift work may happen before 40; No OT is an absolute credited-hour limit; part-time/on-call staff have no invented full-time minimum.

## Remaining limits and practical next checks

1. **Browser and print acceptance remain outstanding.** This environment has no browser executable. Compilation and callback tests do not establish drag/drop behavior, modal layering, Excel rendering, popout sizing, print pagination, or browser-specific storage behavior. Keep the PR as a draft until those are checked with a representative roster, leave, extended duties and handoffs.
2. **Feasibility follow-up implemented:** [Complete search](complete-search.md) now takes over when the fast search leaves gaps and exhausts the supported duty combinations without a total attempt/time cutoff. It distinguishes proven exhaustion within its stated menu from cancellation. Global preference and overtime optimality are still not guaranteed.
3. **Prior-week records still need manager verification.** Manual history takes precedence for fatigue/publication. A newer automatic draft does not silently supersede a reviewed manual record. History records reflect saved plans, so actual call-offs and substitutions must be reconciled before confirming previous-week work.
4. **Legacy history cannot reconstruct missing facts.** Older records lacking employee snapshots use the current roster, and missing old PTO/extended/handoff data cannot be recovered from code. New records preserve those fields. Published records remain the reliable frozen snapshot for reprinting.
5. **Backup restoration across different data categories is not a database transaction.** The weekly bundle is one write, but restoring roster, settings, history and the publication ledger takes multiple writes. A later failure can leave a partial restore; the UI now says so. Strict startup loading also stops on corrupted stored JSON rather than replacing it with defaults; recovery of such corruption may require restoring storage from a known-good backup outside the normal loaded app.
6. **Storage is still local and manager identity is self-entered.** Per-key queues protect this app instance, not simultaneous editing in multiple tabs/devices. The system does not provide an authenticated, centrally coordinated publication ledger. A shared backend with version checks and authenticated approvals is still needed for that use case.
7. **Keep a backup when upgrading.** Migration retains the old five weekly keys for recovery, but future edits use `shift_active_week`. An older HTML build will read stale legacy keys. Exporting a fresh backup from this build refreshes the legacy aliases for compatibility; an old build should not be used to continue editing the same storage.

This review gives evidence for the corrected paths. It is not a claim that no defects remain, and it does not replace checking a real published week against operational staffing requirements.
