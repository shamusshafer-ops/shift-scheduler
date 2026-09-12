# Complete schedule search

Autofill no longer treats the fast search's attempt or plateau limit as the end of schedule generation. If that search leaves an incomplete candidate, it hands off to a resumable, exhaustive feasibility search. The **Complete search** button starts that search directly.

The implementation stays in the single HTML application. It adds no server, external solver package, account, or transmission of employee data.

## Manager workflow

1. Set the week, roster, leave, rules, locks and autofill exclusions as usual. Wait for saves to finish.
2. Use **AUTOFILL** for the fast search followed automatically by complete search when necessary, or use **Complete search** directly.
3. During complete search, **Pause** retains the current search frontier. **Resume complete search** continues that same search. Cancel ends it without a feasibility conclusion.
4. A found candidate goes through the existing independent validator and proposal commit path. Overtime is staged for manager approval; the solver cannot approve it or publish a week.
5. Publish only through the existing publication review, including prior-week verification and saved approvals for that exact schedule.

The complete search tries schedules within 40 credited hours per employee first. If all those combinations fail, it searches reviewable overtime combinations for employees whose policy allows overtime. No OT remains absolute in both phases. PTO counts toward the ceiling and every full-time employee's 40-hour obligation. Excluded employees remain in the accounting roster, and their existing duties stay fixed.

The first complete candidate is not necessarily the least expensive or fairest schedule. Candidate ordering favors less added overtime, then stated preferences and fewer added hours. A final cleanup removes duties that can be removed while preserving all hard rules, coverage, full-time hours, exclusions and locks. This is not proof of globally minimal overtime or optimal preferences.

## What “complete” means

The finite generated duty menu includes:

- Regular 8-hour duties in every day/shift slot, including authorized cross-shift work before 40 hours.
- Every eligible 12-hour extended, swing and split half defined by `EXT_PAIRS`, including halves crossing into the next day.
- Adjoining 4-hour early-arrival or late-stay handoffs with their source duties, including extensions on both sides when the continuous-work cap permits them.
- Existing fixed duties, including locked custom-duration handoffs, locked extended records and their regular display mirrors.

Both coverage and qualifications are checked continuously across actual interval boundaries. Three distinct regular people remain required; dual qualifications can provide Scale and Medical simultaneously, and the weekday first-shift supervisor remains separate.

The solver may rearrange any unlocked duty belonging to an included employee. It is not restricted to moving one or two people, preserving an earlier greedy assignment, or keeping an unlocked extended-duty choice.

**Scope matters:** exhaustion proves that no schedule exists in this generated duty menu with these saved rules, prior-week inputs, locked duties and exclusions. It does not prove impossibility after changing those inputs or adding different custom shift lengths. New arbitrary-duration duties are not generated. No prior-week records or PTO amounts are invented; missing or incomplete history still blocks publication.

## Result meanings

| Result | Meaning |
| --- | --- |
| Searching | Work remains in the frontier; there is no infeasibility conclusion. |
| Paused | The frontier is retained in memory and can be resumed with unchanged inputs. |
| Complete candidate found | The supported staffing and employee-hour constraints have a solution. Approval and publication review still apply. |
| No feasible combination in the current duty menu | Every remaining branch was exhausted or rejected by a necessary constraint/bound. |
| Input or validation error | Data could not be modeled or a candidate failed the independent validator; correct the input or investigate the error. |
| Cancelled | No feasibility conclusion was reached. |
| Inputs changed | The old search cannot apply its result; start a fresh search. |

This separation follows the distinction between feasible, proven infeasible and unknown results documented for constraint solvers in [Google's CP-SAT documentation](https://developers.google.com/optimization/cp/cp_solver). This application uses its own JavaScript search, not OR-Tools.

## Search and pruning

`createCompleteScheduleSearch` owns a snapshot of all inputs. It enumerates legal employee duty bundles, selects an unmet coverage, qualification, source-duty or full-time-hour requirement, and branches over contributors to that requirement. Sibling branches exclude earlier alternatives only after their inclusion branches have been explored; branches are not dropped because of an attempt, depth, node or total-time limit.

Necessary capacity checks include distinct qualified people, available work intervals, continuous-work limits, minimum rest, weekly duty caps, remaining credited-hour allowances and full-time shortfalls. Bounds intentionally overestimate possible supply. A bound is used to reject a branch only when even that optimistic supply cannot satisfy demand.

Most policy violations cannot be repaired by adding more work. Short-rest violations receive special handling: an adjoining extension can eliminate a short rest by joining two blocks, but only if the joined block fits the continuous-work limit. A locked handoff's missing source is treated as an outstanding requirement rather than rejected before its source can be added.

The generator yields between work items. The browser controller advances approximately 12ms slices with at most 150 generator steps per slice, then yields back to the event loop. These are responsiveness budgets, not total search limits. Individual work items may take longer. Pause retains the frontier; a week change, unmount or changed input fingerprint invalidates the old controller. The frontier is not persisted across reloads.

## Validation evidence

- **234 tests pass**, including **30 complete-search tests** and all 204 preceding regressions.
- An independent exhaustive oracle checked all three-person regular staffing combinations for three slots across 24 generated constrained rosters; feasibility results agreed with the complete search.
- Fixtures cover continuous 12-hour and handoff coverage, separate supervisors, dual qualifications, previous-week rest, PTO, full-time obligations, locks, exclusions, six-day No OT conflicts, overtime-only weeks, stale callbacks, cancellation and resumption.
- The saved 15-person roster dated April 12, 2026 completed in approximately **1.8 seconds** in the local Node benchmark after the capacity and ordering corrections. Its candidate had no coverage, hard-policy or full-time-accounting errors. It contained **52 overtime hours across five employees**, requiring approval; that is a candidate total, not a proven minimum. The saved rules for that benchmark allow seven consecutive days/nights and eight hours of rest. No live schedule was changed or published.
- An anonymized version of those scheduling constraints is included in `fixtures/complete-search-roster.json`; employee names, IDs and notes from the saved roster are not included.
- All four inline scripts compile with Babel; scope comparison finds no new unresolved identifiers.

Run:

```sh
node --test test-coverage.js test-policy.js test-pto.js test-overtime.js test-availability.js test-completion.js test-publication.js test-locks-fairness.js test-integration-audit.js test-complete-search.js
```

## Remaining limits

Exhaustive search can still take substantial time and memory on difficult inputs. This change removes arbitrary termination of feasibility search; it does not make every scheduling problem quick. Cancellation, reload, browser termination or resource exhaustion does not establish infeasibility.

The small **Repair current draft** and **Improve preferences** actions remain local improvement tools with limited budgets. Complete search handles feasibility when those local moves are insufficient. Global overtime minimization, global preference optimization, persistent checkpoints and a solver service for very large rosters are separate enhancements.

Rendered browser interaction and print layout remain unverified in this environment. Browser acceptance is still required before merging the draft PR for operational use.
