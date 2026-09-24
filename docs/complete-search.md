# Complete schedule search and overtime optimization

Autofill uses its fast search to obtain a complete candidate, then passes that candidate to resumable overtime optimization. It no longer commits the first valid result just because coverage and full-time hours are satisfied. The **Complete search** button starts the same optimizer directly and retains the current draft as an incumbent if it passes validation.

The implementation stays in the single HTML application. It adds no server, external solver package, account, or transmission of employee data.

## Manager workflow

1. Set the week, roster, leave, rules, locks and autofill exclusions as usual. Wait for saves to finish.
2. Use **AUTOFILL** or **Complete search**.
3. The progress panel shows the best valid overtime total found and an optimistic lower bound. **Minimum overtime proven** appears only when the candidate meets a valid bound or every potentially better combination has been exhausted.
4. **Pause** retains the frontier. **Resume complete search** continues it with unchanged inputs. **Use best found** stops the search and submits the retained candidate to independent validation and normal overtime approval. It is available while searching or paused; accepting early does not assert optimality. **Cancel search** leaves the draft unchanged.
5. Any overtime still requires manager approval. The search cannot approve overtime or publish a week. Denial, repairs, edits or changed inputs may change the result; a proof applies to the searched candidate and inputs.
6. Publish only through the existing publication review, including prior-week verification and saved approvals for that exact schedule.

The objective is total credited overtime hours: the sum across employees of `max(0, worked hours + approved PTO - 40)`. It uses the application's existing credited-hour policy, not wage rates or a new payroll calculation. No OT remains absolute, and full-time minimums, qualifications, rest, split-double restrictions, exact staffing, locks and exclusions remain hard constraints.

With no incumbent, the solver tries 40-hour ceilings first and then overtime combinations if necessary. A validated initial candidate lets it start optimization immediately. Each valid candidate is compared by total overtime first, then stated preference fairness. Equal-overtime preference improvements may be retained, but global preference optimality is not promised. Zero overtime establishes the minimum immediately.

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
| Searching with a best result | A complete valid candidate is retained while alternatives are explored. Its overtime minimum is not yet proven. |
| Minimum overtime proven | A candidate meets a valid lower bound, or all potentially better combinations were exhausted. Approval and publication review still apply. |
| Best found accepted | The user stopped optimization and selected its best candidate. This does not prove the minimum. |
| No feasible combination in the current duty menu | Every remaining branch was exhausted or rejected by a necessary constraint/bound. |
| Input or validation error | Data could not be modeled or a candidate failed the independent validator; correct the input or investigate the error. |
| Cancelled | The search stopped without applying a candidate. Cancellation never establishes infeasibility or optimality. |
| Inputs changed | The old search cannot apply its result; start a fresh search. |

This separation follows the distinction between feasible, proven infeasible and unknown results documented for constraint solvers in [Google's CP-SAT documentation](https://developers.google.com/optimization/cp/cp_solver). This application uses its own JavaScript search, not OR-Tools.

## Search and pruning

`createCompleteScheduleSearch` owns a snapshot of all inputs. It enumerates legal employee duty bundles, selects an unmet coverage, qualification, source-duty or full-time-hour requirement, and branches over contributors to that requirement. Sibling branches exclude earlier alternatives only after their inclusion branches have been explored; branches are not dropped because of an attempt, depth, node or total-time limit.

The solver retains the best complete result instead of returning from the first feasible leaf. Branch-and-bound rejects states whose existing overtime or optimistic remaining-hour bound already exceeds that result. Search only adds work, so existing overtime cannot decrease inside a branch. Missing body-hours already include the dedicated supervisor; qualification gaps are not added again because Scale and Medical may be supplied by the same person. Available straight-time capacity deliberately overestimates supply. Only a bound at the unrestricted root is reported as a global lower bound; bounds from restricted branches cannot establish a global minimum.

A warm start must independently pass coverage, hard policy, full-time accounting, exact locks and exclusions. It supplies an upper bound without fixing its unlocked assignments. The search still explores the entire generated menu. Arbitrary custom duties in an existing candidate are retained only as that candidate; the search does not generate every possible custom duration.

Necessary capacity checks include distinct qualified people, available work intervals, continuous-work limits, minimum rest, weekly duty caps, remaining credited-hour allowances and full-time shortfalls. Bounds intentionally overestimate possible supply. A bound is used to reject a branch only when even that optimistic supply cannot satisfy demand.

Every candidate also obeys an exact staffing limit: three regular staff throughout every shift, plus one dedicated Supervisor only on first shift Monday through Friday. Regular duties, extended halves and handoffs count together by actual time overlap; mirrored records count as the same person. A full-time shortfall or missing qualification must be resolved by reassignment within this limit. An overstaffed fixed/locked seed is an input error, and existing locks are retained. The independent assignment, proposal and publication validators enforce the same maximum.

Most policy violations cannot be repaired by adding more work. Short-rest violations receive special handling: an adjoining extension can eliminate a short rest by joining two blocks, but only if the joined block fits the continuous-work limit. A locked handoff's missing source is treated as an outstanding requirement rather than rejected before its source can be added.

The generator yields between work items. The browser controller advances approximately 12ms slices with at most 150 generator steps per slice, then yields back to the event loop. These are responsiveness budgets, not total search limits. Individual work items may take longer. Pause retains the frontier; a week change, unmount or changed input fingerprint invalidates the old controller. The frontier is not persisted across reloads.

## Validation evidence

- **276 regression tests**, including **39 complete-search tests**.
- An independent exhaustive oracle checks feasibility on 24 constrained rosters and minimum overtime on 16 additional PTO/qualification-constrained rosters, both from scratch and from deliberately expensive warm starts.
- Regression cases cover a positive minimum proved by exhaustion, a supervisor lower-bound counterexample, rejected warm starts, best-result snapshot isolation, cancellation without proof, pause/resume, early acceptance, stale inputs, independent validation failure and exact-schedule overtime staging.
- All existing staffing, split-double, rest, leave, locks, publication and Excel-export regressions are included.
- The anonymized 15-person fixture remains a full-coverage/employee-hours regression. Its test requires a usable candidate without requiring a potentially lengthy optimality proof. In a local timed optimization run it improved from 56 to 48 to 40 overtime hours. At that point the lower bound was 8, so the result correctly remained **unproven**. Timing and best result depend on run duration and inputs; this is not a claim about a live schedule.
- All four inline scripts compile; scope comparison against main finds no new unresolved identifiers.
- Production controller functions are exercised directly by automated tests. A rendered browser test could not run because the available Chromium download failed; visual browser acceptance remains outstanding.

Run:

```sh
node --test test-coverage.js test-staffing.js test-excel-export.js test-policy.js test-pto.js test-overtime.js test-availability.js test-completion.js test-publication.js test-locks-fairness.js test-integration-audit.js test-complete-search.js
```

## Remaining limits

Exhaustive optimization can take substantial time and memory. There is no total search cutoff. A time-sliced advance, pause, cancellation, reload, browser termination or resource exhaustion does not prove infeasibility or optimality. The frontier is held in memory and is lost on reload.

The small **Repair current draft** and **Improve preferences** actions remain local improvement tools with limited budgets. Global preference optimization, persistent checkpoints and a solver service for very large rosters remain separate enhancements.
