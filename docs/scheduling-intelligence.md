# Scheduling intelligence: audit, objective and results

This document records the November 2026 review of the autofill and complete-search
solver (baseline `01e4214`, branch `improve/scheduling-intelligence`): what was
confirmed wrong, what was changed, how it was measured, and what remains.
Business rules are unchanged; no hard constraint was relaxed.

## 1. Audit

### Confirmed defects (reproduced, now covered by regression tests)

| # | Defect | Effect | Evidence | Fix |
|---|---|---|---|---|
| 1 | **PTO capacity pruning.** The complete search measured each employee's remaining room as *ceiling − credited hours*. PTO is charged only up to 40 (extra work displaces PTO credit), so an employee with PTO can work more than *40 − PTO* hours without overtime. | Legal weeks were pruned. The search reported **"No feasible combination"** for a week that exists, and could report **"autofill's week is already the best possible"** without a valid proof. | `test-scheduling-intelligence.js` "PTO is displaced…" fails on the baseline (status `infeasible`; the hand-built week passes every rule). The baseline's instant "no better week" on the PTO benchmark scenario relied on this bound. | Room is measured in hours worked (`maxWorked − worked`), matching `weeklyEmployeeHours` and the policy validator. |
| 2 | **Phase transition.** After exhausting the no-overtime phase with an incumbent, the search stopped and marked the week **proven optimal**. | A week using the supervisor's 12-hour day (or a seven-day week) was applied and labeled optimal although an overtime week ranks better on that higher objective. | Same test file, "ending the regular-hours phase…": baseline returns `supervisorExtensions 1, proven true`; the correct answer is 0 extensions with 8h approved overtime. | The overtime-review phase runs with the incumbent as its bound unless the incumbent cannot be beaten. |
| 3 | **Equal-overtime weeks were indistinguishable to the search, and its week was never improved further.** The search's objective has three entries (supervisor 12h days, seven-day weeks, overtime); its week was applied as found. | Search weeks could carry needless doubles, concentrated overtime, scattered days off. | Code reading; benchmark below. | `polishSearchWeek` runs the canonical lower-level passes on every search week (§3). |
| 4 | **The swap search accepted only preference improvements.** `improveSchedulePreferences` required the preference entry to fall, and only tried pair swaps. | Moves that would give someone their days off together, remove a quick turnaround, or that needed three people, were never taken. | Code reading; benchmark below. | Any canonical improvement is accepted; three-person rotations added (§3). |
| 5 | **CI coverage gaps.** `test-autofill-balance.js`, `test-autofill-relays.js` and `test-fix-suggestions.js` ran in CI but did not trigger it; `test-step0.js` and `test-golden-snapshot.js` never ran; fixtures/tools changes did not trigger it. | Regressions could merge unnoticed. | `.github/workflows/scheduler-tests.yml`. | Triggers on all `test-*.js`, `fixtures/**`, `tools/**`; runs the missing suites; adds a Babel compile check of the inline scripts. |
| 6 | `test-autofill-harness.js` crashed (null patterns). | The harness (also imported by the golden snapshot's scenarios) could not run standalone. | Baseline run: `TypeError … reading 'e1'`. | Passes `{}`. |

### Documentation discrepancy reconciled

`docs/complete-search.md` said *"PTO counts toward the ceiling"*, while the weekly
accounting, policy validator and overtime approval treat overtime as **hours worked
over 40** with PTO charged only up to 40. The implementation's accounting is the
business rule (it is what approval and publication enforce); the search and the
document now follow it. Credited hours (worked + charged PTO) still decide the
full-time obligation.

### Suspected issues examined and not confirmed

- **Pruning before surplus trimming.** Bounds are computed on partial states,
  while leaf weeks are trimmed afterwards. Safe: any trimmed week is itself
  reachable as a leaf along branches consistent with it, and every bound on that
  path is at most its value.
- **Luby restarts and proofs.** Restart lengths grow without bound; the final
  restart exhausts the tree, so proofs hold (the oracle test checks this).
- **`overtimeLowerBound` with PTO.** Already measured room in hours worked, so it
  was safe; it was strengthened (role floors), not corrected.

### Solver limitations found (not defects)

- The complete search spent ~48 ms per node re-validating whole weeks for each of
  ~475 candidates (§5).
- Pattern quality (days off together, rest, shift changes) was not measured
  anywhere, so no pass could optimize it.
- Historical fairness covered stated preferences only, not overtime.

## 2. Canonical objective

One lexicographic vector (`QUALITY`, `scheduleQuality`) is used by generation
(best partial), gap/completion repair, rebalancing, the swap search, candidate
selection across attempts, the complete search's polish step and the Weeks
found ranking. `employeeQuality` returns the per-person entries, so local moves
are ranked by exactly the same objective as whole weeks.

| # | Entry | Meaning |
|---|---|---|
| 0 | hard | hard-rule violations |
| 1–2 | coverage, body | uncovered position + qualification hours; uncovered people |
| 3 | shortfall | full-time credited hours below 40 |
| 4 | supervisorExtensions | supervisor's weekday 12-hour days (last resort) |
| 5 | noDayOff | seven-day workweeks (day a duty starts) |
| 6 | overtime | total hours worked over 40 |
| 7 | doubles | continuous blocks over 12h |
| 8 | spread | Σ overtime² — half weight for people who asked for overtime, up to double for people who averaged 8h+/week in recent published weeks |
| 9 | recovery | Σ(16h − rest) for rests under 16h (incl. last week's last duty) + hours past 8 in a block |
| 10 | pattern | no two days off together (2), isolated single days off (1 each), isolated single workdays (1 each); the week is read cyclically so Sat+Sun is a weekend |
| 11 | transitions | shift changes between consecutive blocks (first↔third counts 2) |
| 12 | preferences | stated shift/day-off conflicts, weighted by prior published weeks |
| 13 | changes | assignments changed from the baseline (repairs) |

Entries 0–8 and 12–13 keep their previous order. Entries 9–11 are new and sit
below overtime concentration and above stated preferences, as in the requested
hierarchy. They are preferences: none is a hard rule, and none can compensate
for a worse higher entry. Trade-off to note: because days off together (10) rank
above shift changes (11), a swap may add a shift change to give someone two days
off together; the benchmark reports both.

## 3. Changes to the solver

**Complete search**
- PTO-correct capacity and overtime bounds (defect 1).
- Overtime-review phase after a regular-hours incumbent (defect 2).
- Role-aware bounds: each role's uncovered hours beyond its holders' remaining
  room under 40 are overtime; a role whose holders cannot supply its uncovered
  hours prunes the branch. Same argument for the displayed floor.
- Per-employee candidate checking with memoization; staffing re-checked only in
  touched slots. Exact: the same tree is explored (verified: identical
  improvement nodes and incumbents), 48.5 → 18.7 ms/node on the anonymized
  15-person roster.
- Every found week is polished (`polishSearchWeek`) before it is listed or
  applied; the panel states that the proof covers supervisor 12h days, days off
  and total overtime only.

**Local improvement**
- `improveSchedulePreferences` (now the schedule polish): pair swaps and
  three-person rotations of unlocked regular duties among included employees,
  starting from the people whose weeks rank worst below overtime; a move is
  kept only if the touched slots and people rank strictly better on the
  canonical objective and no rule is newly broken. Budget 4000 moves / 500 ms.
- `rebalanceOvertime` ranks moves with `employeeQuality`.

**Fairness and history**
- `fairnessFromWeeks`: per-employee hours, preference conflicts, overtime and
  doubles over the last eight published weeks (only weeks the employee worked).
- `historicalOvertimeWeight` scales the spread entry, so equal-total weeks give
  overtime to people who have carried less of it recently. It cannot add
  overtime (total overtime ranks above it).

**Comparison and diagnostics**
- Weeks found shows positions, days off, total overtime, max individual
  overtime, doubles, rest, days off together, shift changes and preferences.
- `overtimeFloorDetails` explains what sets the overtime floor ("coverage needs
  544h; everyone together has at most 456h within 40h each", or a role's
  holders) and warns when a role cannot be covered at all.

Not added: optimization modes (no demonstrated value yet over one canonical
objective), an external solver, Web Worker execution, a multi-week planning
horizon. See §7.

## 4. Benchmark

`tools/bench-scheduler.js` replays the page's pipeline in Node: the attempt loop
with gap and completion repair, rebalance, the swap search, one relay pass on an
incomplete best week, then the complete search seeded like the page — with a
fixed **node budget (1000 nodes)** instead of the page's 5-minute idle limit, so
both versions get equal search effort. Every week is measured with independent
metrics computed from intervals only (`weekMetrics`), so both versions are
judged by the same measuring stick. Weeks are stored, so metrics can be
recomputed (`--remeasure`).

Scenarios: `synth-15` (15-person synthetic roster, normal staffing), `synth-pto`
(three PTO requests incl. the dual-qualified employee), `synth-noot` (overtime
allowed for three people only), `synth-tight` (a Medic and a Guard short),
`real-0927` (the saved 12-person roster; structural shortage), `anon-15` (the
anonymized 15-person roster). Seeds 1–20 for synthetic scenarios, 1–10 for the
two real rosters, plus three consecutive weeks (history carried forward) for
`synth-15` and `real-0927`, seeds 1–4.

Caveat: autofill's repair passes have small wall-clock budgets, so results
depend somewhat on CPU load; both versions ran on the same 2-core machine, one
benchmark per core.

RESULTS_PLACEHOLDER

## 5. Tests

TESTS_PLACEHOLDER

## 6. Files changed

FILES_PLACEHOLDER

## 7. Remaining limitations

- Proofs cover supervisor 12h days, seven-day weeks and total overtime within
  the search's duty menu. Doubles, spread, rest, days off together, shift
  changes and preferences are improved by local search, not proven optimal.
- The complete search still costs ~19 ms per node; difficult rosters do not
  finish and stop at the idle limit with the best week found.
- Pattern measures read one week cyclically; rest and shift changes use the
  previous published week. A multi-week planning horizon is not implemented.
- Overtime fairness averages over weeks an employee worked; it does not yet
  normalize for qualifications, availability or eligibility.
- The shortage explanation covers the overtime floor's drivers; the existing
  "What would fix this?" and staffing insights remain the simulation-based
  advice. Per-shift qualification shortages are not yet quantified.
- `ShiftScheduler_1_.jsx` (the older React component) was not updated.
- BROWSER_PLACEHOLDER
