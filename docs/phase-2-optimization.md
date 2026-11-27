# Phase II: advanced optimization and operational reliability

Branch `improve/phase-2-optimization`, built on `0875f36` (the November 25
branch `improve/scheduling-intelligence`, PR #9). Business rules are unchanged:
no hard constraint was relaxed, nothing is waived automatically, overtime still
needs a manager's approval and publication review is unchanged.
`ShiftScheduler_1_.jsx` was not modified (see §10).

## Summary for management

- **Current roster (13 people, saved 2026-10-15, with S. McCall).** Every
  position and qualification can be covered. An independent exact solver
  proves the least possible overtime is **48 hours a week, at most 8 hours per
  person**, with no doubles and everyone with a day off. Autofill alone leaves
  a full-timer 8 hours short; the November 25 app typically ends at 56 hours
  with a double shift. Given two minutes, the new optimizer reached the proven
  48-hour minimum in 2 of 3 runs (otherwise 56 hours) with no doubles; in the
  node-budget runs that reached it, the app itself proved it optimal (§6).
- **September 27 roster (12 people).** Proven: 40 Scale hours a week on weekday
  first shift (06:00–14:00) cannot be covered by anyone with these
  qualifications and availability, and no schedule can avoid at least 88 hours
  of overtime. The smallest fix is to cross-train one of J. Parks, T. Bentley,
  O. Anderson or T. Saunders for Scale, or to let L. Hillenburg or D. Pete also
  work first shift (§5).
- **Optimizer.** AUTOFILL now hands its week to an optimizer that rebuilds parts
  of the week exactly (adaptive large-neighborhood search) alongside the
  existing whole-week search, in a background Web Worker. Modes: Fast draft,
  Balanced (default), Deep. Every result states what is proven and what is not.
- **Decisions needed:** see §9 (supervisor-only rule for the supervisor on
  weekday first shift, default overtime distribution, Fast mode's purpose,
  retiring the old React component).

## 1. Baseline

The work starts from `0875f36` as pushed (verified against the remote). The
November 25 records are preserved unchanged
([benchmarks/2026-11-25-comparison.md](benchmarks/2026-11-25-comparison.md));
the November 25 code was re-measured here with the new benchmark tool and the
same scenarios, and its results match the earlier record (for example 8 h, 16 h
and 88 h of overtime on `synth-15`, `synth-pto` and `synth-tight`, 88 h on
`real-0927`). The golden snapshot (31 autofill and repair cases) produces
identical schedules on both versions; only the stored quality values changed,
because the work-pattern measures are now calendar-accurate (§3).

## 2. Audit

### Confirmed defects (reproduced; regression tests in `test-phase2-optimization.js`)

| # | Defect | Effect | Fix |
|---|---|---|---|
| 1 | **Carry-in dropped by the search.** `completeSearchSeed` kept locked extended duties but dropped carry-in records (last week's work running into Sunday). | The search staffed those hours again, even with the same employee as a row duplicating his own carried-in double; last week's hours were credited to this week and passed validation. | Carry-in records stay fixed in every search; they count for staffing and rest, never for this week's hours. |
| 2 | **Overtime floor ignored carry-in, locks and exclusions.** `overtimeFloorDetails` counted carry-in-covered hours as this week's demand and capped fixed (locked) duties by ordinary availability. | With the floor, the search claimed a **false proof** (8 h "optimal" where a 0 h week exists). | The floor subtracts carry-in coverage hour by hour (people and roles), credits each person's fixed hours, and gives excluded staff only their fixed work. |
| 3 | **"Neutral" overtime preference did not inherit the site default** in the objective and two autofill orderings (the rule checks did). | With the site default "preferred", neutral employees were ranked as non-volunteers. | `effectiveOvertimePref()` is used everywhere. |
| 4 | **Work patterns assumed next week repeats this one.** The pattern entry read the week cyclically (Saturday next to Sunday). | Saturday + Sunday off counted as a weekend even when next week's Sunday is worked; a Monday–Friday worker was assumed rested. | Calendar-accurate breaks (24/36/48 h) from actual work, last week's work when known, nothing assumed about next week (§3). The cyclic measure is kept for reporting only. |
| 5 | **Weeks found elsewhere did not bound the search.** A better week produced by polishing or another engine left the whole-week search hunting for weeks that could not beat it. | Wasted search; its "no better week" could not refer to the best week actually held. | `offerBound()` tightens the search's bound with any valid week; the message then says "no better week than the best already found". |
| 6 | **No search move targeted a full-timer short of 40 hours.** Region rebuilds kept each full-timer's current hours as the floor. | On the current roster autofill leaves a full-timer 8 h short and Fast mode often could not repair it. | A *shortfall* neighborhood rebuilds the days a short full-timer could still work with a 40-hour floor. |

Found and fixed during development (not in the baseline): a region rebuild
could orphan a handoff whose source duty was cleared (the slot it covered is
now part of the rebuild); reproducible runs depended on wall-clock budgets
(cost is measured in search nodes); the whole-week search was starved of work
in reproducible runs (it now gets a fixed node share).

### Examined and not confirmed

- **Candidate cache keys** cover every input candidate generation reads
  (roster, rules, week, time off, availability, patterns, exclusions, fairness);
  fixed duties are applied after generation, so sharing candidates between
  searches of the same week is safe.
- **Touched slots / restricted candidates.** A region rebuild may use only
  duties touching its target slots; every slot that lost work (including
  through a cleared handoff source) is a target, so no slot is left uncovered
  by construction, and every rebuilt week is re-validated independently.
- **Luby restarts and floor termination.** Restart lengths grow without bound,
  and the floor stops the search only when the floor is a true lower bound
  (after fix 2), so proofs hold.

### Conflicts to resolve (flagged, not changed)

- **Supervisor on weekday first shift.** The policy check (`supervisor_slot`)
  lets a Supervisor-qualified employee work weekday first shift only in the
  supervisor post. A second supervisor therefore cannot cover Scale there, and
  the "cross-train a second supervisor" fix does not help (§5). CLAUDE.md
  describes "1 additional dedicated Supervisor"; whether a second qualified
  person may work that shift as regular staff is a management decision.
- **Carry-in rows.** If a week's own schedule holds a row overlapping that
  employee's carried-in duty, coverage counts both while saving strips the
  carry-in. The optimizer never creates such rows; a manager-edited week could.
  Proposed: treat such a row as a rule error (needs sign-off before changing).

## 3. Optimizer

`createScheduleOptimizer` (core script, testable in Node) runs after autofill and
from the **Optimize** button:

- **Candidate pool.** Every week produced (autofill's, the whole-week search's,
  every rebuild) is polished, validated independently and offered to a pool of
  up to 6 meaningfully different weeks, ranked by the canonical objective. A
  week failing validation never ranks above a clean one; equal weeks are kept
  once. The best complete week bounds the whole-week search.
- **Adaptive large-neighborhood search.** Each iteration clears part of the
  best (sometimes another pooled) week and rebuilds it **exactly** with the
  complete search restricted to that area; ties on the searched objectives are
  broken by the canonical objective. Neighborhoods: one day, several days,
  weekend, one shift across days, the worst employees' duties, the worst
  pattern employees, people with the same qualifications, around a gap,
  **a full-timer's open days (shortfall)**, PTO days, extended duties and
  handoffs, random slots. Productive neighborhoods are chosen more often
  (reward per node or per second), a neighborhood's rebuild budget grows after
  three failures, and **every stall raises all budgets**, so long stalls get
  multi-day rebuilds that move overtime between several people (Balanced up to
  6,400 nodes per rebuild, Deep 19,200). Identical rebuilds are never
  repeated (tabu).
- **Completing the week comes first.** While no complete week is held, the
  whole-week search (which looks for any complete week first) gets a turn every
  iteration and a larger share, rebuilds start mid-ladder (Fast mode, which has
  no whole-week search, starts at its largest), and the idle stop does not
  apply.
- **Whole-week search** (`createCompleteScheduleSearch`) keeps running in
  Balanced and Deep for proofs.
- **Reproducible runs** (tests, benchmark): seeded, budgets in search nodes.
- **Proof status, stated on every result:**

  | Status | Meaning |
  |---|---|
  | Proven best for selected objectives | Complete and valid; the whole-week search proved no week has fewer supervisor 12 h days, people without a day off or total overtime. Lower measures were improved, not proven. |
  | Best found | Complete and valid; not proven optimal. |
  | Locally improved | Fast mode (no whole-week search). |
  | Proven infeasible | No complete week exists in the duty menu with these rules, locks and exclusions. |
  | Unknown | No complete week found yet; whether one exists is not known. |

  When some role hours are proven uncoverable (§4), the status adds that the
  week leaves only those hours uncovered, and the panel lists the shortage.
- **Modes.** Fast draft (local search only; stops 4 s after the last
  improvement, at 15 s, or up to 90 s while the week is still incomplete),
  Balanced (default; stops 60 s after the last improvement or at 4 minutes),
  Deep (5 minutes / 30 minutes).
- **Web Worker.** The optimizer runs in a Worker built from the page's own core
  script, so the page stays responsive; if a Worker cannot start it runs in
  short slices on the page. Pause, Resume, Cancel, Use best now, stale-input
  protection (inputs changed → nothing is applied), and page-side
  re-validation of the chosen week are kept; overtime is staged for approval.
- **Weeks found** lists the pooled weeks with the measures managers compare
  (positions, days off, overtime, max overtime, overtime not asked for,
  doubles, people without a 48 h break, quick turnarounds, shift changes,
  preferences, changes) and why each ranks below the best ("Ranks below: total
  overtime hours 64 vs 56; everything ranked higher is equal").

### Calendar-accurate recovery

Rest, breaks and shift changes use actual work: carry-in and the previous
published week when known; nothing is assumed about next week (an open break
at the week's end counts only the hours known). Pattern entry (`QUALITY.pattern`):
2 if no known duty-free break of 48 h+ (1 if a break at the week's edge already
has 24 h+ and may still become one), plus isolated calendar days off and
isolated worked calendar days (overnight work from the evening before makes a
day worked).

### Overtime distribution

Settings → *Overtime distribution* chooses how overtime is spread among people
allowed to work it (`QUALITY.spread`): **Balanced** (default; squared overtime,
volunteers at half weight), **Volunteers first** (overtime of non-volunteers
weighs far more), **Even** (squared overtime, preferences ignored). Neutral
employees inherit the site default. Recent published weeks raise the weight of
people who carried overtime lately. None of these overrides No OT or approval.

### Not done (documented)

- **Multi-week look-ahead.** Weeks are optimized one at a time; next week is
  never assumed. Fairness across weeks uses published history only.
- **Opportunity-adjusted fairness** (normalizing overtime by qualification and
  availability) is not implemented; history weighting is by hours only.
- **Distinct construction strategies.** Autofill remains the single construction;
  diversity comes from the rebuild neighborhoods and the pool.
- **In-app proof of a local gap** (e.g. a single-slot subproblem) beyond the
  hour-by-hour capability proof below.

## 4. Structural shortages

`coverageCapability` proves shortages before searching: for every hour it
counts the distinct people who could work it at all (rules, availability,
blocked and required shifts), and the distinct capable people per role. If an
hour needs more Scale or Medical (or the separate Supervisor) than anyone could
provide, those hours are proven uncoverable. This is a relaxation: it proves
less than the exact model in §5 (on the September roster it proves 20 of the 40
uncoverable hours, 10:00–14:00 on weekdays, so the app reports that week as
incomplete with an unknown status rather than complete within proven limits). The optimizer then treats a week
leaving only those hours uncovered as complete within proven limits, still
reports them as gaps (never waived), and explains them in the panel.

## 5. Roster feasibility (exact analysis)

`tools/export-duty-model.js` exports one week exactly in the app's own terms:
the complete search's duty menu, every pair of one person's duties the app's
rule checker rejects together, and three-duty chains breaking the
continuous-work cap. `tools/feasibility_cpsat.py` solves it with OR-Tools CP-SAT
lexicographically (uncovered role hours, supervisor 12 h days, seven-day weeks,
total overtime, most overtime on one person), and every solution is checked by
the app's own validator before it counts. Offline analysis only; the app does
not use it.

### Current roster (fixtures/roster-2026-10-15.json, 13 people)

| Measure | Exact optimum (validated) |
|---|---|
| Uncovered position/role hours | 0 |
| Supervisor 12-hour days | 0 |
| Seven-day weeks | 0 |
| Total overtime | **48 h** (proven) |
| Most overtime on one person | **8 h** (proven) |

Optimal hours: S. Shafer 48, H. Cameron 48, O. Anderson 48, T. Bentley 48,
J. Parks 44, L. Hillenberg 44, T. Saunders 44, C. Hefron 44, S. McCall 40,
L. Shepard 40, K. Messer 40, D. Pete 40, T. Beverly 16 (part-time). The
optimum uses six 12-hour halves and gives T. Beverly both her available
second shifts.

### September 27 roster (fixtures/roster-2026-09-27.json, 12 people)

Proven: weekday first shift needs Scale 06:00–14:00 and nobody available then
can cover it beyond the supervisor post: **40 role hours a week cannot be
covered**, with at least **88 h** of overtime, at most 20 h on one person, and
one seven-day week. Smallest interventions (each solved exactly and validated;
`tools/roster-interventions.js`):

| Change | Uncovered role h | 7-day weeks | Overtime | Max per person |
|---|---|---|---|---|
| None (current) | 40 | 1 | 88 | 20 |
| Cross-train J. Parks for Scale | **0** | 0 | 88 | 12 |
| Cross-train T. Bentley for Scale | **0** | 0 | 88 | 12 |
| Cross-train O. Anderson for Scale | **0** | 0 | 88 | 12 |
| Cross-train T. Saunders for Scale | **0** | 0 | 88 | 12 |
| Cross-train C. Hefron for Scale | **0** | 0 | 88 | 16 |
| Cross-train K. Messer for Scale | **0** | 1 | 88 | 20 |
| Cross-train L. Shepard for Scale | 40 | 1 | 88 | 16 |
| Second supervisor (cross-train J. Parks) | 40 | 0 | 88 | 20 |
| L. Hillenburg may also work first shift | **0** | 0 | 88 | 12 |
| D. Pete may also work first shift | **0** | 0 | 88 | 12 |
| H. Cameron may work first shift | **0** | 0 | 88 | 32 |
| Hire one full-time Scale/Guard | **0** | 0 | **48** | 12 |
| Hire one part-time Scale/Guard, weekday first only | **0** | 1 | **48** | 20 |

All rows are proven optimal for their changed roster. The second-supervisor
row does not help because of the supervisor-only rule (§2, §9). Cross-training
alone fixes coverage but not the overtime: 88 h is the minimum with 12 people.

## 6. Benchmarks

`tools/bench-scheduler.js` replays the page's pipeline in Node: autofill (attempts,
gap and completion repair, rebalancing, swaps, relays), then the engine — for
November 25 the complete search seeded with autofill's week, for Phase II the
optimizer in Balanced mode from autofill's week, as the Optimize button runs it.
Every week is measured with the same independent metrics (`weekMetrics`,
computed from intervals only; calendar measures added in Phase II). Budgets are
equal for both: **search nodes** (whole-week search, plus region rebuilds for
Phase II; reproducible) or **wall-clock seconds after autofill**. One version
per core on a 2-core machine. Exact references come from §5 (CP-SAT, validated):
proven optima for `real-current` (48 h), `real-0927`, `anon-15` (8 h, at most
4 h per person), `synth-15`, `synth-pto` and `synth-noot`; feasible references
whose seven-day-week stage was not proven for `synth-tight`, `synth-scarce`
and `synth-volunteers`. New scenarios: `real-current` (the current roster),
`synth-scarce` (feasible but tight Scale shortage), `synth-volunteers`
(overtime needed, four volunteers, two refusals), `synth-locked` (a locked
12-hour pair the engines must keep).

Full tables, every metric: [benchmarks/2026-11-27-phase2-comparison.md](benchmarks/2026-11-27-phase2-comparison.md).
Means per week, November 25 → Phase II; lower is better. "Paired" compares the
leading objectives (errors, uncovered hours, full-time shortfall, supervisor
12 h days, seven-day weeks, total overtime, doubles, overtime spread) seed by seed.

### Real rosters, equal node budget (12,000 nodes, 6 seeds)

| Roster | Paired | Total OT | Max OT | OT not asked | Doubles | Reaches exact optimum | Time to best (median s) | Peak heap MB |
|---|---|---|---|---|---|---|---|---|
| Current (real-current) | **6 better**, 0 worse | 57.3 → **53.3** | 12 → 12.7 | 36.7 → 26.7 | 0.8 → **0** | 0/6 → **2/6** | 115 → 79 | 185 → 94 |
| Anonymized 15 (anon-15) | **6 better**, 0 worse | 32 → **22** | 8 → 7.3 | 32 → 22 | 0 → 0.2 | 0/6 → 0/6 | 4 → 41 | 190 → 104 |
| September 27 (real-0927) | equal | 88 → 88 | 20 → 20 | 69 → 67 | 0.3 → 0.3 | 6/6 → 6/6 | 34 → 50 | 91 → 76 |

On the current roster both runs that reached 48 h were also **proven** by the
app itself ("Proven best for supervisor 12-hour days, people with a day off and
total overtime"): once the optimizer offered the 48-hour week as a bound, the
whole-week search exhausted its tree. November 25 ended at 56 h with a double
in 5 of 6 runs and 64 h in one.

### Equal wall-clock budget (120 s after autofill, 3 seeds)

| Roster | Paired | Total OT | Doubles | Reaches exact optimum | Time to best (median s) |
|---|---|---|---|---|---|
| Current (real-current) | **3 better** | 56 → **50.7** | 1 → **0** | 0/3 → **2/3** | 144 → 91 |
| Anonymized 15 (anon-15) | **3 better** | 32 → **24** | 0 → 0 | 0/3 → 0/3 | 4 → 11 |
| September 27 (real-0927) | equal | 88 → 88 | 0.7 → 0.7 | 3/3 → 3/3 | 24 → 45 |
| synth-tight | equal | 88 → 88 | 0 → 0 | 3/3 → 3/3 | 9 → 20 |

### Three consecutive weeks (history and carry-in; 3,000 nodes, 4 seeds)

| Scenario (weeks) | Paired | Complete & valid | Total OT | Max OT | Doubles |
|---|---|---|---|---|---|
| Current roster (12) | **10 better**, 2 worse | 8/12 → **10/12** | 59.3 → 58 | 18.7 → **14.7** | 1 → **0.4** |
| synth-15 (12) | equal | 12/12 → 12/12 | 8 → 8 | 8 → 8 | 0 → 0 |

After the first week each version plans from its own history, so later weeks
are compared seed by seed but no longer from identical inputs.

### Synthetic scenarios, equal node budget (3,000 nodes, 20 seeds each, 140 weeks)

Both versions match the exact reference on every leading objective in all 120
weeks that have one (8, 16, 8, 88, 32 and 88 h of overtime) and give 8 h in all
20 `synth-locked` weeks, so they are equal there; both keep the locked 12-hour
pair in 20/20 weeks. Differences are in lower measures:
people without a 48-hour break fall slightly (e.g. `synth-locked` 9 → 6.7,
`synth-scarce` 8.8 → 7.8), shift changes rise (+0.9 to +2.8 per week except
`synth-locked`, −0.5).

### Trade-offs and regressions, stated plainly

- **Lower measures.** Phase II ranks calendar rest (48-hour breaks, isolated
  days) above shift changes, and overtime above both. With less overtime it
  often uses more shift changes and quick turnarounds: `anon-15` 22 h instead
  of 32 h of overtime, but quick turnarounds 0 → 2.2 and shift changes 4 → 9.5
  per week. Overtime ranks higher by the agreed hierarchy; the table shows the
  cost.
- **Max overtime on the current roster** stays at 12 h even in 48-hour weeks
  (the exact model's 48-hour week has at most 8 h): under the Balanced overtime
  distribution volunteers count at half weight, so 12 h on a volunteer
  (L. Hillenberg in these weeks) can rank better than 8 h on someone who did not
  ask. Under the *Even* setting the 8-hour spread ranks better.
- **Runtime on easy rosters.** November 25 stops as soon as its search proves
  autofill's week cannot be beaten on the three searched objectives; Phase II
  keeps improving lower measures until its budget or idle limit, so a synthetic
  week takes 12–30 s instead of 2–28 s (time to the best week is similar). On
  the page this is the idle limit (Balanced: 60 s without improvement).
- **Two multi-week weeks were worse** than November 25 (one left a full-timer
  short at 3,000 nodes where November 25 completed it; one has more overtime).
  At small budgets the outcome depends on which rebuilds run first.
- **The exact optimum is not always reached:** 2 of 6 runs on the current
  roster in 12,000 nodes, none on `anon-15` (best 16 h vs the 8 h optimum).
- **Memory:** peak heap per week is lower on the real rosters (e.g. 185 → 94 MB)
  and higher on easy synthetic rosters (18 → 52 MB) where November 25 stops
  early.
- **Fast mode** varies between runs (48–64 h on the current roster in the
  browser runs); it stops seconds after its last improvement.

## 7. Browser acceptance

`tools/browser-acceptance.py` drives the page in a real browser (Playwright),
seeded with the current roster in a fresh profile, page served from a local web
server. Chromium (Google Chrome for Testing 153, headless), final code: **28 of 28 checks
passed**, no page errors:

- Page loads; Fast/Balanced/Deep offered. AUTOFILL hands the week to the
  optimizer, which runs in a Web Worker. Pause stops progress (counters frozen),
  Resume continues.
- The finished week is complete and valid and is staged for overtime approval;
  Weeks found shows the comparison columns and why lower weeks rank below.
- Denying overtime leaves the schedule unchanged; choosing a listed week and
  approving overtime applies it (68/68 positions).
- The schedule persists across a reload. Removing an assignment and Undo work.
  Dragging a roster employee into the open slot works (staged for overtime
  approval because the week has overtime).
- Previous week and back keeps the live week. Saving a named week lists it.
- Excel export: preview, then the workbook downloads (the page's download
  fallback; the browser's native save dialog cannot be automated).
- Publication review lists blocking issues and overtime decisions; after the
  previous week is saved, the prior-week check confirmed and the overtime
  approved for that exact schedule, publishing succeeds and the saved
  publication prints (opened in its print window).
- Deep mode runs and Cancel stops it without changing the schedule. Use best
  now stops Balanced mode and stages the best week for approval.

Observed: Fast mode results vary between runs on the current roster (48–64 h of
overtime, 15–40 s, longer when autofill's week is incomplete) because it has no
whole-week search and stops seconds after its last improvement; Balanced is the
default for that reason. The step-by-step report is in
[acceptance/2026-11-27-chromium.json](acceptance/2026-11-27-chromium.json).

**Firefox** could not be installed in this environment (the Playwright Firefox
download and system packages are blocked). Run the same check yourself:

```
pip install playwright
python -m playwright install firefox chromium
python tools/browser-acceptance.py --browser firefox --out acceptance-firefox
```

It writes `report.json` and screenshots. Opening the page as `file://` (option
`--file`) made Chromium under Playwright occasionally lose all of the page's
localStorage on reload (verified with instrumented storage: no script removed
anything); the tool therefore serves the page from a local web server.

## 8. Tests

Full suite on the final code (Node 22): **407 tests, 407 passed, 0 failed**;
golden snapshot 31/31 cases identical. New tests
(`test-phase2-optimization.js`, run in CI) cover every defect in §2: carry-in
kept fixed, floor with carry-in, locks and exclusions, neutral preference
inheriting the default, `offerBound`, pool ordering independence and
validation ranking, reproducibility, never worse than autofill, explanations
and proof scope, locks and exclusions preserved through rebuilds, the
shortfall rebuild, and `explainRanking`. The calendar-pattern test was
rewritten for calendar semantics; the optimizer UI tests (pause, resume,
cancel, stale and replaced runs, commit and overtime staging, validator
rejection, Use best now, idle finish, canonical best, choosing a listed week)
replace the old complete-search panel tests.

## 9. Management decisions

1. **Supervisor on weekday first shift** — keep "supervisor post only" (a
   second Supervisor-qualified person cannot work that shift as Scale/Guard),
   or allow it? Only the latter makes a second supervisor useful for coverage.
2. **Overtime distribution default** — Balanced (current), Volunteers first or
   Even. On rosters where overtime is unavoidable, Volunteers first puts more
   of it on volunteers at the cost of a less even spread.
3. **Fast mode** — keep as a quick draft (results vary) or remove it so every
   run uses Balanced.
4. **Carry-in rows** — make a schedule row overlapping the same person's
   carried-in duty a rule error.
5. **September roster** — if it is still relevant: cross-train one Scale (or
   allow first shift for L. Hillenburg / D. Pete), and consider a hire to cut
   the 88 h overtime floor to 48 h.
6. **Old React component** — archive `ShiftScheduler_1_.jsx` (§10).

## 10. ShiftScheduler_1_.jsx

The 679-line React component from the initial commit. It is not used by the
working page, the tests or the tools. Its autofill fills slots greedily without
rest, consecutive-day or 40-hour checks, it has no extended shifts, handoffs,
PTO, locks, publication or approval records, and it reads and writes the old
`shift_employees` / `shift_schedule` keys. It no longer represents the
application and could mislead anyone importing it. It was left unchanged;
archiving it (or labeling it "legacy prototype" in the README) is recommended.

## 11. Reproduce

```
node --test test-*.js && node test-golden-snapshot.js
node tools/bench-scheduler.js --repo . --scenarios real-current --seeds 1-6 --budget nodes --nodes 12000 --out new.json
node tools/bench-scheduler.js --repo /path/to/0875f36 --scenarios real-current --seeds 1-6 --budget nodes --nodes 12000 --out nov25.json
node tools/bench-scheduler.js --compare nov25.json new.json
node tools/export-duty-model.js fixtures/roster-2026-10-15.json > model.json
python3 tools/feasibility_cpsat.py model.json > solution.json
node tools/export-duty-model.js fixtures/roster-2026-10-15.json --check solution.json
```
