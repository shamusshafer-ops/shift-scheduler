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
| 8 | spread | Σ overtime² — half weight for people who asked for overtime, up to double for people who averaged 8h+/week in recent published weeks (Phase II: the distribution is a setting — Balanced, Volunteers first, Even) |
| 9 | recovery | Σ(16h − rest) for rests under 16h (incl. last week's last duty) + hours past 8 in a block |
| 10 | pattern | Phase II (calendar-accurate, see [phase-2-optimization.md](phase-2-optimization.md)): no known duty-free break of 48h+ (2; 1 if a break at the week's edge already has 24h+), isolated calendar days off and isolated worked calendar days (1 each). Nothing is assumed about next week. *(November 25: no two days off together, read cyclically so Sat+Sun counted as a weekend.)* |
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

### Results

Full tables (every metric, every scenario): [benchmarks/2026-11-25-comparison.md](benchmarks/2026-11-25-comparison.md).
Means per week; lower is better. "Leading objectives" = hard errors, uncovered
hours, full-time shortfall, supervisor 12h days, seven-day weeks, total
overtime, doubles, overtime spread, compared lexicographically per paired seed.

| Scenario (runs) | Leading objectives, paired | Total OT | No 2 days off together | Isolated days off | Quick turnarounds | Rest deficit h | Shift changes | Day↔night | Median s |
|---|---|---|---|---|---|---|---|---|---|
| synth-15 (20) | 20 equal | 8 → 8 | 5.0 → 0.4 | 13.6 → 2.2 | 1.3 → 0 | 10.4 → 0 | 5.7 → 5.8 | 2.0 → 1.7 | 5.6 → 5.6 |
| synth-pto (20) | 20 equal | 16 → 16 | 4.2 → 1.1 | 12.5 → 5.2 | 3.2 → 0.4 | 25.2 → 3.2 | 9.3 → 8.7 | 2.8 → 2.2 | 6.0 → 13.1 |
| synth-noot (20) | 20 equal | 8 → 8 | 5.5 → 0.8 | 14.4 → 3.2 | 1.5 → 0 | 11.6 → 0 | 6.3 → 7.4 | 1.5 → 2.3 | 6.2 → 5.5 |
| synth-tight (20) | 20 equal | 88 → 88 | 0.1 → 0.05 | 9.8 → 8.7 | 2.8 → 0.3 | 22.0 → 2.4 | 6.9 → 5.1 | 1.1 → 1.0 | 30.7 → 17.4 |
| real-0927 (10) | 3 better, 7 equal | 88 → 88 | 1.1 → 0 | 8.8 → 6.8 | 2.4 → 1.8 | 11.2 → 7.2 | 4.1 → 4.0 | 1.5 → 1.8 | 61.2 → 40.5 |
| anon-15 (10) | 1 better, 9 equal | 33.6 → 32.8 | 3.5 → 0.7 | 11.7 → 5.6 | 1.5 → 0 | 12.0 → 0 | 5.8 → 3.9 | 0.8 → 0.3 | 40.0 → 14.2 |

Across three consecutive weeks (history carried forward, 4 seeds each):

| Scenario | Leading objectives, paired | Max cumulative OT per person | Σ squared cumulative OT | People with any OT |
|---|---|---|---|---|
| synth-15 (12 weeks) | 12 equal | 16 → 8 | 320 → 192 | 2 → 3 |
| real-0927 (12 weeks) | 2 better, 10 equal | 60 → 60 | 9552 → 9376 | 9 → 9 |

Reading the results:
- **No regression on any leading objective** in 124 paired weeks; 6 improved
  (less overtime, fewer doubles or a more even spread).
- **Work patterns improved substantially** everywhere: people without two days
  off together, isolated days off and quick turnarounds fell by roughly half
  to all on the normally staffed rosters (e.g. isolated days off −52% to −84%,
  quick turnarounds −87% to −100%).
- **Trade-offs:** with overtime limited to three people (`synth-noot`) shift
  changes rose by 1.1 and day/night flips by 0.75 per week, the cost of giving
  people their days off together (which ranks higher). On the real 12-person
  roster, the overtime spread is more even (Σ OT² −19) but 1.6h more of it falls
  on people who did not ask for overtime, because the spread entry weighs
  evenness against volunteers at half weight.
- **Overtime rotates across weeks:** on `synth-15` the same 8h no longer lands
  on the same person each week.
- **Runtime:** faster on the hard rosters (per-node speed-up). Slower on
  `synth-pto` (6 → 13 s): the baseline's instant "no better week" there came
  from the unsafe PTO bound (defect 1); the corrected search must actually
  search before giving up within its budget.
- **Unchanged:** the real 12-person roster leaves the same 40 Medical/Scale
  hours uncovered in both versions (5 role errors), and the search found no
  better week than autofill's within 1000 nodes in any scenario, so the
  benchmark exercises the polish of search weeks only through the tests.

## 5. Tests

All test files were executed on the final code (Node 22): **401 tests, 401
passed, 0 failed** (baseline: 392 tests, 391 passed; the failure was the
crashing harness script, defect 6).

New (`test-scheduling-intelligence.js`, 9 tests):
- PTO displacement: a No OT full-timer with 40h PTO can still cover a shift
  (fails on the baseline: reported infeasible).
- Phase transition: the overtime week without a supervisor 12h day wins and is
  proven (fails on the baseline: supervisor extension, falsely proven).
- **Optimization oracle**: on 30 random rosters with PTO, locks, No OT and
  overtime-willing staff, the search's proven optimum (days off, overtime)
  equals an exhaustive enumeration of every staffing combination (fails on the
  baseline).
- Role-aware overtime floor; work-pattern measures; equal-overtime ranking;
  pattern entries can never outrank coverage/hours/overtime; three-person
  rotation where no pair swap is legal; polish never worsens a week and keeps
  locks.

Changed: one complete-search UI test now uses a roster where the polish cannot
move the overtime (the old fixture's overtime was legitimately removed by it).
Golden snapshot re-recorded: entries appended to every quality vector, schedules
identical except the three `harness/tight` cases, which end with fewer
uncovered hours (64→56, 64→56, 72→56).

Equivalence check for the search speed-up: same first improvement (node 77, 48h
OT) and same incumbents after 300 nodes on the anonymized roster, 48.5 → 18.7
ms per node.

Browser (Chromium 1.63 via Playwright, CDN libraries served from identical npm
versions): page loads with a seeded roster; AUTOFILL hands off to the complete
search; Weeks found shows the new columns; pause, resume, week preview and Use
best now work; the applied week's overtime goes to the manager approval dialog;
no uncaught page errors. Firefox was not available in this environment and was
not tested; editing, saved data and export were not exercised in the browser
(the export model is covered by `test-excel-export.js`).

## 6. Files changed

| File | Change |
|---|---|
| `ShiftScheduler_latest loop.html` | canonical objective (`QUALITY`, `employeeWorkPattern`, `employeeQuality`); complete-search PTO bound, phase transition, role bounds, per-employee candidate checks; `polishSearchWeek`; swap search with rotations; `rebalanceOvertime` on the canonical vector; `fairnessFromWeeks`, `historicalOvertimeWeight`; `overtimeFloorDetails`; Weeks found columns, proof-scope note, floor explanation |
| `load-core.js` | exports the new functions |
| `test-scheduling-intelligence.js` | new regression and oracle tests |
| `test-complete-search.js` | one fixture adjusted (see §5) |
| `test-autofill-harness.js` | null-patterns crash fixed |
| `fixtures/golden-snapshot.json` | re-recorded (see §5) |
| `tools/bench-scheduler.js`, `tools/check-scripts.js` | benchmark harness; inline-script compile check |
| `.github/workflows/scheduler-tests.yml` | triggers and suites (defect 5) |
| `docs/complete-search.md`, `docs/scheduling-intelligence.md`, `docs/benchmarks/…`, `CLAUDE.md` | documentation |

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
- Browser validation covered Chromium only; Firefox behavior, manual editing, saved data and export in the browser still need a manual check before operational use.

Phase II ([phase-2-optimization.md](phase-2-optimization.md)) addressed several of these: calendar-accurate patterns, structural-shortage proofs, the optimizer, an automated browser check of editing, saved data, export and publication (Chromium; a Firefox run script is provided).
