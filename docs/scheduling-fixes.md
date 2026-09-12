# Scheduling reliability fixes

## Confirmed business rules

- Three distinct, independently qualified regular employees must be present throughout every shift.
- A dual-qualified employee may provide both Scale and Medical coverage. This does not reduce the three-person minimum.
- A separately assigned supervisor is the fourth person on Monday–Friday first shift.
- Approved PTO counts toward a full-time employee's 40-hour weekly requirement but supplies no staffing coverage.
- Employees authorized to work other shifts may do so before or after reaching 40 hours.
- An employee's “No OT” restriction is absolute.

## Step 1: Continuous coverage

Implemented in the standalone working application, `ShiftScheduler_latest loop.html`.

`collectCoverageIntervals` normalizes existing regular, extended, swing, split, and handoff records without changing the saved-data schema. `analyzeShiftCoverage` checks every staffing change within an eight-hour shift. `validateCoverage` provides structured diagnostics with the uncovered time ranges.

- Coverage uses distinct employee IDs and current roster qualifications. Unknown employees and trainees cannot satisfy required staffing.
- A handoff supplies its recorded hours only and requires an actual source assignment at the adjoining boundary.
- Duplicate records cannot multiply a person's coverage. Extended records own their actual hours when a regular cell mirrors the same employee.
- Extended-shift capacity reduces regular staffing requirements only when it is present throughout the slot. Complementary halves can supply one continuous position.
- Day/night employee B start times are explicit. Overnight intervals extend into the next day; Saturday carry-out never wraps into this week's Sunday.
- Autofill's extended-role planning, final validation, gap repair, coverage indicators, dashboard, and weekly coverage statistics share the interval calculation.
- Cleanup retains assignments whose removal would worsen coverage. The committed extended-shift list includes retained manual assignments and clears obsolete automatic records.
- Production repair checks whether each proposed handoff actually reduces uncovered hours, continuing until the whole interval is covered or candidates run out.

Time coordinates are civil hours from Sunday 00:00 of the selected week. This is a coverage model, not a payroll/DST elapsed-hours calculation. Previous-week carry-in records must be supplied by future cross-week integration; this change does not infer missing history.

Run the focused regression suite with:

```sh
node --test test-coverage.js
```

It includes extraction of the actual UI validator and gap-repair function so changes to those paths are exercised. `SEEDS=12345 node test-autofill.js` is a diagnostic roster run, not a release gate: remaining defects can still produce invalid schedules. Its coverage checks now use production `validateCoverage` and report missing roles as errors.

The older `ShiftScheduler_1_.jsx` component is not the standalone working application and is not updated by this step.

## Step 2: Shared assignment policy and fatigue

`employeePolicyIssues` now evaluates the actual work intervals for qualifications,
trainee status, the dedicated weekday supervisor position, availability, approved
leave days, blocked shifts, required-shift authorization, weekly duty/weekend-day
caps, consecutive days/nights, overlapping work, continuous hours, rest and No OT.
`assignmentIssues` checks proposed placements; `scheduleChangeIssues` checks a
whole proposed change before it is accepted. Existing errors can be reduced;
new or worsened restrictions cannot be approved as preference warnings.

- Backtracking and local-search candidates use the policy. Legacy post-processing
  also passes through a final chronological acceptance check. Rejected assignments
  leave visible gaps for repair; the result includes rejection reasons. This
  fallback preserves hard rules but can reduce coverage on constrained rosters.
  Replacing the remaining heuristic post-processing with a single constrained
  optimizer remains future work.
- Gap repairs check the changed employee's whole week and both sides of the
  affected duty. Failed transactions restore schedule cells, hours and handoffs,
  including deleting a newly created cell on rollback.
- Manual assignment, movement, substitution, call-off replacement, swaps,
  extended-shift approval, dashboard quick fill/OT relief and the violation
  minimizer reject changes that add hard violations. A same-cell swap updates
  both people atomically. Ordinary removal can still leave a visible vacancy.
- Cross-shift authorization is valid before 40 hours. No OT is a hard 40-work-hour
  ceiling for all employment types, including extended work and handoffs. PTO's
  effect on credited weekly hours is the next step; this is not yet PTO-aware
  weekly-obligation or overtime-approval accounting.
- Consecutive nights no longer reset while scanning daytime slots. Sunday and
  Saturday within one week are not adjacent. Rest is checked before and after a
  change. Explicit 12-hour eligibility permits 12 hours without requiring consent
  for a 16-hour double; mirrored extended records do not inflate continuous hours.
- Extended halves check actual start times, all overlapped blocked shifts and
  each employee's day/night, swing or split eligibility. A day-pair's second
  employee therefore needs night-half eligibility.
- Previous-week rest and streaks come from the immediately preceding dated
  history entry, including stored extended shifts and handoffs. History saves
  retain those records. Missing history is not inferred from stale rotation data;
  it remains a limit on cross-week validation.
- The production validator and fatigue displays use the same policy. Existing
  imported schedules/manual extended records remain inspectable with errors;
  this step does not prevent loading old saves or implement a publication gate.

Verification: `node --test test-coverage.js test-policy.js` passes 37 tests,
including the actual production validator, repair, manual-commit and generation
functions. A feasible 19-person fixture fills all 68 assignments with complete
continuous coverage and zero policy violations. All inline scripts compile with
Babel and a scope check finds no new unresolved references. Browser interaction
was not exercised because a browser executable was unavailable.

## Step 3: PTO credits and employee accounting

`buildPtoCredits` reads explicit `ptoHoursByDate` entries from approved requests.
`weeklyEmployeeHours` keeps actual work and PTO separate; `buildWeeklyAccounting`
returns a row for every roster employee and structured errors for each full-time
shortfall. The target remains 40 hours even when a weekly shift cap makes that
target impossible. Part-time and on-call employees have no invented minimum;
zero-work employees remain listed as not scheduled.

- Time Off now accepts paid hours for each request date, including an explicit
  zero for a regular day off. Vacation is paid; a single day or specific-shift
  request can be marked paid. Older approved vacations without paid-hour records
  produce a review error. No weekday pattern or eight-hour allowance is inferred.
- Pending, denied and unpaid leave has no credit. Date ranges are clipped to the
  selected week. Identical duplicate approvals count once; conflicting amounts,
  invalid dates, unknown employees and invalid hour amounts produce errors.
  Fractions are retained. Credit records outside an approved range do not count.
- Autofill's FT priority, weekly objective and makeup passes target the remaining
  work hours after PTO. Actual work tracking and continuous coverage stay separate.
  The No OT scheduling ceiling now uses work plus PTO, consistent with the
  confirmed 40-hour rule. This is application scheduling policy, not a statutory
  overtime/payroll determination.
- The production validator checks the entire roster even when autofill filters
  candidates or excludes people. A full-time shortfall is an error. A new weekly
  employee table lists work, PTO, credited total, target, status and exclusions.
  Alerts, roster totals, dashboard FT status and the minimizer use credited hours.
  PTO changes immediately refresh the schedule's validation results.
- Autofill reserves existing excluded employees' positions and qualifications,
  including the dedicated supervisor, and preserves their assignments. Exclusion
  prevents new automatic assignments; it does not erase people or waive their
  weekly obligation. Preserved invalid assignments remain visible with errors.
- History saves retain PTO requests. The week-ending export uses explicit PTO
  hours in its OTHER row and stops if PTO credits need review. The regular
  schedule export's work-hour columns still describe work, rather than paid
  credit totals. Full payroll/export auditing remains separate work.

Verification: `node --test test-coverage.js test-policy.js test-pto.js` passes 54
tests. These include the actual approval control, production validator and
generation worker, 32h work + 8h PTO, a full PTO week, crossing week/month dates,
duplicate/conflicting approvals, missing or invalid credit data, fractional
credits, excluded employees and supervisor preservation, and PTO-aware autofill
with all 68 assignments filled. Inline scripts compile with Babel; scope checks
find no new unresolved references. Browser interaction has not been exercised.

At this step, partial requests still block their existing whole day/shift
availability representation; step 5 replaces that representation with intervals.
Some fractional remaining obligations cannot be met with the existing eight-hour
assignments/four-hour handoffs. They stay explicit shortfalls rather than being
rounded away. Missing history and legacy PTO data require manager review.
Overtime denial repair follows in step 4; the publication gate remains separate.

## Step 4: Overtime proposals and denial repair

Autofill now stages the complete proposed schedule, extended shifts, handoffs,
rotation data and assignment log before overtime review. Every employment type
with work plus PTO above 40 hours appears in the review, including an empty
starting schedule and employees who prefer overtime. No OT cannot be waived.

- The canonical roster field `canWorkOtherShifts` controls permission to work
  outside a required shift before or after 40 hours. Older `crossShiftOT` values
  remain readable; an explicit new value takes precedence. The roster control
  explains that shift permission and overtime approval are separate decisions.
- Canceling review or an in-progress autofill search leaves the live schedule
  unchanged. A changed week, roster, rules, leave, history, exclusions or schedule
  invalidates a pending proposal. Accepted proposals apply together with one undo
  snapshot; undo and redo now include handoffs, rotation data and the log.
- Approval grants only the credited total actually reviewed for each employee.
  Denial removes over-budget regular duties, individual extended-shift halves and
  handoffs. Extended mirrors are removed with their owner; the partner's duty is
  retained. PTO credit stays intact.
- Repair targets coverage worsened by denial, checking qualifications, rest,
  availability and all shared hard rules. It cannot transfer unapproved overtime
  to another employee or exceed an approved total. A fresh final validation runs
  before committing. Unrepairable coverage and full-time shortfalls remain errors
  on the draft; they are not represented as a complete schedule.

Verification: `node --test test-coverage.js test-policy.js test-pto.js
test-overtime.js` passes 72 tests. The overtime tests exercise production staging,
commit and repair paths, including empty schedules, preferred overtime, all
employment types, PTO, extended halves, handoffs, stale proposals, cancellation,
exact approval ceilings and feasible/infeasible repairs. Inline scripts compile
with Babel and scope checks find no new unresolved references. Browser
interaction has not been exercised.

Limits: approvals are scoped to an autofill proposal; this step does not add a
persistent approval audit or route every manual edit through overtime review.
Denial removes whole duties and repair uses the existing regular-duty and handoff
strategies; it does not invent arbitrary short shifts or new extended pairs.
These constraints can leave visible gaps or hour shortfalls. A publication gate
is still required before a draft can be certified complete.

## Step 5: Partial-day leave and recurring unavailable hours

Approved leave now becomes exact civil-time intervals instead of whole-day
autofill exclusions. The shared policy compares those intervals with actual work,
including each extended half, mirrored records and handoffs. Candidate domains,
extended-shift planning, gap repair, manual changes and final validation use those
checks. Work may start exactly when leave ends; one minute of overlap is blocked.

- Time Off offers exact start/end times and an explicit end date for overnight
  requests, or a whole-shift option. Existing partial requests with only a shift
  retain that full shift, including third shift's next-day hours. Managers can
  edit leave times and paid hours together. Invalid timing cannot be approved.
  Changing timing preserves the request's current approval/denial status.
- A single-day or vacation date means the actual calendar day, midnight to
  midnight. It therefore blocks the overlapping portion of the preceding night.
  Requests from the previous/next week also apply when their hours overlap the
  current week's work. Saturday carry-out never wraps onto the same Sunday.
- The employee editor adds recurring unavailable-hour windows, with an explicit
  next-day option. These repeat across week boundaries and supplement the older
  whole-day restrictions and allowed-day lists, whose duty-day meaning remains
  unchanged. They are hard availability restrictions, not preferences.
- The request list displays actual times. The calendar includes overnight dates
  and excludes an end date reached exactly at midnight. Existing save/roster
  serialization retains the new fields. Derived availability keeps the legacy
  Set interface for older callers but stores new restrictions in
  `intervalsByEmployee`; no partial request becomes a whole-day key. This derived
  object must be rebuilt from requests, not serialized as a Set.
- Invalid imported approved timing produces review errors and blocks assigning
  that employee until corrected. Malformed recurring windows also require
  correction. Pending and denied requests impose no leave restriction. Paid
  hours remain explicit per date and are never inferred from the leave duration.

Verification: `node --test test-coverage.js test-policy.js test-pto.js
test-overtime.js test-availability.js` passes 97 tests. The 25 availability cases
cover minute boundaries, midnight, adjacent weeks, civil dates across DST/year
changes, legacy shifts, malformed data, recurring windows, extended halves,
handoffs, manual changes, request submission/approval/editing and fresh validation.
Two production generation fixtures fill all 68 assignments with zero coverage or
policy errors: one uses another shift after partial leave, and one replaces an
overlapping assignment while preserving the employee's other available days.
Inline scripts compile with Babel; scope checks find no new unresolved names.
Browser interaction has not been exercised.

Limits: the generator still uses existing eight-hour assignments, extended
duties and handoffs. It does not split a regular shift into arbitrary custom-hour
segments. Short remaining availability or fractional PTO obligations can therefore
leave explicit gaps or shortfalls. Existing PTO conflict handling still requires
review of conflicting daily credit amounts. Civil-time coverage is not a DST
payroll calculation, and importing missing previous-week work remains separate.

## Step 6: Completeness ranking, linked repairs and shortage explanations

Autofill compares actual schedule quality in priority order: hard-rule errors,
uncovered staffing/qualification hours, full-time credited-hour shortfalls,
excess hours, preferences and assignment changes. An unchanged error-message
count no longer hides a meaningful coverage improvement or prematurely advances
the plateau counter. Partial search snapshots also use coverage and employee
hours instead of only assignment count. Planned shift preferences no longer act
as hard penalties that compete with a full-time hour shortfall; actual required
shift restrictions remain enforced by assignment policy.

- The regular-duty capacity upper bound counts multiple possible duties for
  double-shift volunteers and removes the invented six-day ceiling. Weekly duty
  caps still apply. Undoing the second duty of a double retains the first duty's
  working-day marker. The assignment search reports its termination reason,
  elapsed time and node count; a partial-mode return is not labeled complete.
- `repairScheduleCompletion` can relocate up to two existing regular duties and
  backfill the resulting vacancies. All intermediate holes remain private.
  A transaction is accepted only when it improves the quality ranking, adds no
  hard violation, worsens no shift's body/role coverage and increases no
  full-time employee's hour shortfall. Excluded employees cannot be moved;
  extended records and their mirrored cells are preserved. Invalidated handoffs
  fail the final policy check. Only changed assignments get new explanation logs.
- Autofill runs linked repair after its existing gap/handoff repair. When
  coverage is complete, repair can replace part-time work to satisfy a full-time
  shortfall, preserving staffing capacity and qualifications. It does not add
  unnecessary fourth/fifth regular employees to solve an hour shortage.
- The new **Repair current draft** button uses this bounded search on the live
  draft instead of rebuilding the week. It cannot raise anyone above their
  current credited total or 40 hours, whichever is greater; No OT remains
  absolute. A successful result uses the complete proposal, freshness, overtime
  review and undo flow from step 4. Pending approval blocks a second repair.
  An unsuccessful search leaves the current draft unchanged.
- **Why the draft is incomplete** shows each remaining gap's time range, missing
  qualifications, potential candidates and their current obstacles, such as
  leave, rest, weekly duty caps or exclusion. It lists all full-time hour
  shortfalls separately. Candidate eligibility describes the current arrangement,
  not global feasibility. The last-autofill status distinguishes a complete
  candidate from an attempt/plateau stop or an assignment-search limit. Final
  coverage and hard-rule validation still determine whether a candidate is valid.

Verification: `node --test test-coverage.js test-policy.js test-pto.js
test-overtime.js test-availability.js test-completion.js` passes 116 tests.
The 19 completion cases include a three-slot linked repair that the old repair
cannot solve, failed-branch rollback, excluded assignments, approval ceilings,
extended mirrors, separate supervisor coverage, full-time PTO-aware makeup
without overstaffing, bounded search, diagnostics, actual autofill comparison,
the production repair control and double-duty search rollback. Existing complete
68-assignment generation fixtures remain passing. Inline scripts compile with
Babel; scope checks find no new unresolved names. Browser interaction has not
been exercised.

Limits: this is bounded heuristic search, not a proof of feasibility or optimality.
The linked repair defaults to 600ms/2,000 explored placements, at most two duty
relocations per branch and eight accepted transactions. It preserves existing
extended pairs and cannot repair every custom-hour or longer-chain scenario.
Legacy generation/post-processing remains, with shared policy filtering and
final validation. Diagnostics do not claim that individually available candidates
can jointly satisfy the whole week. Preference fairness across multiple weeks,
arbitrary assignment locks and a publication gate remain separate work.

## Step 7: Validated publication, saved approvals and complete print rows

Publishing now creates a separate saved snapshot after fresh validation. It
recalculates continuous coverage, distinct qualified staffing, the separate
weekday supervisor, hard assignment rules, approved leave and PTO-aware weekly
obligations. Full-time shortages block publication. Part-time and on-call staff
have no invented minimum; all employees appear in the published record.

- Previous-week work must be present so rest and consecutive-duty checks include
  the week boundary. The manager must confirm that the saved prior week includes
  every employee's actual work, including extended shifts and handoffs. An empty
  prior week is appropriate only when nobody worked. The existing history
  selection prefers the last manual record for that week, otherwise its last
  autosave; managers must verify that this is the actual record.
- Every credited total above forty needs a saved, named overtime decision for
  the exact reviewed schedule, roster, leave, rules and prior-week history.
  Preferred overtime is not approval. A later denial supersedes an earlier
  approval for that snapshot; changed inputs require review again. No OT remains
  absolute. Autofill saves the reviewed decisions before applying its staged
  proposal, retaining denials and separate approvals for a changed final result.
  Storage failure or a stale proposal leaves the live draft unchanged.
- Publication requires a manager name and fresh validation again against the
  latest saved approval ledger. Pending proposals, running searches and unread
  schedule inputs block it. Approval/publication writes are serialized within
  the app, acknowledged and read back before success is reported. Failed reads,
  malformed records, quota errors and verification mismatches block confirmation.
  Late asynchronous hydration cannot overwrite explicitly restored data.
- A publication owns its snapshot. Later live edits make the current draft
  unpublished without rewriting old publications. If inputs change while a write
  is pending, the saved reviewed snapshot remains historical and the UI says that
  the changed draft requires a new review. Printing uses a validated saved record
  and the current approval ledger, so a subsequent denial blocks reprinting.
- The published print view lists every employee once, including unscheduled
  people and employees working outside preferred shifts. It shows actual duty
  times and positions, extended duties, handoffs, PTO, worked hours and credited
  totals. Saturday carry-out duties remain visible and mirrored assignments do
  not add duplicate hours. Names and other printed values are HTML-escaped.
- Ordinary saved weeks and schedule Excel exports are explicitly drafts. The
  separate weekending payroll export remains an accounting export. Publication
  records, approvals, handoffs and training blocks are included in full backups;
  backup creation fails if the publication ledger cannot be read. Valid backup
  restore can recover a damaged ledger. Older backups without a publication key
  preserve the current archive. The existing general backup restore is not an
  atomic transaction across all application keys.

Verification: `node --test test-coverage.js test-policy.js test-pto.js
 test-overtime.js test-availability.js test-completion.js test-publication.js`
passes 147 tests. The 31 publication cases cover complete and blocked schedules,
PTO obligations, prior-week fatigue, stale/revoked approvals, write/read failures,
reloads, input ownership, backup recovery, all-employee print rows, asynchronous
startup and the production approval/publication callbacks. All four inline
scripts compile with Babel, with no new unresolved identifiers. Browser
interaction and print layout have not been exercised.

Limits: these are local application records, not a shared server audit system.
Manager names are self-entered; records are not authenticated or tamper-proof.
Browser storage can be cleared or exhaust its quota, so retained backups remain
necessary. Separate tabs/devices do not have a transactional shared ledger;
use one editing session for approval and publication. The app cannot establish
whether a manager's imported prior-week work record is factually complete.
A passed gate certifies the represented data under the implemented rules; it
does not make the bounded generator a proof of feasibility.

## Step 8: Duty locks and preference fairness across published weeks

Regular assignments, extended pairs and handoffs can now be locked in the
**Assignment locks and preference fairness** panel. Locks are stored on the
actual duty records, so they travel with saved weeks, publications, backups and
undo snapshots. Toggling a lock is an explicit action with one undo record.

- The shared change validator rejects removal or modification of locked records.
  A locked handoff also requires its source duty to remain. Extended pairs are
  locked as a complete pair, not as independent halves. Ordinary assignment
  edits, swaps, substitutions, relief, extended-duty removal and final proposal
  commits use this guard. Clearing the draft is disabled while locks remain;
  employee deletion is blocked when that employee owns a locked duty.
- Autofill switches to bounded repair of the existing draft whenever a lock is
  present. It fills around the protected work and excluded employees instead of
  clearing the week. Linked repair cannot relocate a locked regular assignment;
  existing extended duties and handoffs remain intact. Successive autofill
  attempts continue from the prior protected result. Invalid locked work stays
  visible and blocks the final commit/publication rather than being discarded.
- Overtime denial allocates the available budget to locked duties and the
  sources of locked handoffs first. It removes unlocked work when that can meet
  the ceiling. If keeping the locked work is incompatible with the decision,
  the proposal is left unapplied and the manager is told to unlock or revise it.
  Locking never waives No OT, leave, qualifications, rest or other hard rules.
- Fairness uses one latest valid publication per week from the previous eight
  calendar weeks. It excludes drafts, the current/future week and invalid records.
  Past preference conflicts use the employee preferences saved in that week's
  publication. Missing weeks and missing employees contribute no invented data.
  Historical publications describe planned work, not verified attendance.
- Preference burden measures worked hours on stated preferred days off and
  outside stated preferred shifts, with the existing preference-strength weights.
  Extended work is divided at shift boundaries, so a twelve-hour duty is not
  treated as twelve hours on its starting shift. The historical ratio of weighted
  conflict hours to worked hours adds a bounded weight between one and three to
  current preference conflicts. Nights/weekends are not assumed undesirable.
- Autofill runs a final preference-swap pass before selecting and validating its
  result. **Improve preferences** applies the same pass to the current draft.
  Only qualified regular-duty swaps are considered; employee hours and duty
  counts stay the same, no slot loses coverage, excluded staff and locks remain
  protected, and the shared hard-policy checks still apply. Coverage, full-time
  obligations and overtime rank ahead of preference cost. An unsuccessful search
  leaves the draft unchanged. Changed assignments receive an explanation log;
  successful proposals use the existing freshness, overtime-review and undo flow.
  Changes to the relevant publication history invalidate an in-flight proposal.

Verification: `node --test test-coverage.js test-policy.js test-pto.js
 test-overtime.js test-availability.js test-completion.js test-publication.js
 test-locks-fairness.js` passes 169 tests. The 22 new cases include a complete
68-assignment week built from one locked duty, invalid locks, excluded staff,
locked handoff sources, overtime budget allocation, publication serialization,
historical selection and deduplication, history-weighted equivalent-coverage
swaps, hard-rule priority, unchanged employee hours, bounded search, and the
production lock, autofill, preference and commit controls. Existing production
callback tests were updated to supply the newly required history/draft inputs;
their assertions remain unchanged. All four inline scripts compile with Babel,
and scope checks find no new unresolved names. Browser interaction and print
layout have not been exercised.

Limits: locked generation is a bounded repair path, not the unrestricted rebuild
search. Each attempt allows up to 1.5 seconds, 10,000 placements and 128 accepted
transactions; the existing ten-attempt/plateau stop still applies. It preserves
existing extended records and does not invent new custom-hour duties. Preference
improvement allows up to 500ms, 1,200 candidate swaps and twelve accepted swaps by
default. It is a local improvement, not a proof of global fairness or optimality.
Role/availability differences can limit which employees can trade duties.
The ordinary smaller repair budget from step 6 remains unchanged. Explicit whole
roster/week restore and undo/redo restore their saved snapshots, including lock
state; locks are editing safeguards, not access controls. Changing lock metadata
also changes the publication fingerprint and requires a fresh review.

## Follow-up validation and solver work

The eight planned correction stages are implemented locally. Remaining work is
browser interaction and print-layout validation, runs against the manager's
current roster and actual prior-week work, and additional repair moves or a
stronger solver for cases the bounded search cannot complete. The publication
gate continues to block an incomplete result rather than treating a stopped
search as proof that staffing is impossible.

## Integration audit follow-up

The combined implementation received a further rule, persistence and UI integration review. See [integration-audit.md](integration-audit.md) for confirmed defects, corrections, migration behavior and remaining acceptance checks. The suite now contains 204 passing tests, including 35 integration regressions. Active weeks are saved as one complete weekly record, and navigation archives and restores complete weeks.
