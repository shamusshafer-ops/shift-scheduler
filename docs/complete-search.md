# Complete schedule search

Autofill no longer treats the fast search's first complete week, or its attempt or plateau limit, as the end of schedule generation. It hands off to a resumable, exhaustive search that looks for the complete week with the **least total overtime**. When the fast search's week is complete, the search only looks for weeks with strictly less overtime than it. The **Complete search** button starts that search directly.

The implementation stays in the single HTML application. It adds no server, external solver package, account, or transmission of employee data.

## Manager workflow

1. Set the week, roster, leave, rules, locks and autofill exclusions as usual. Wait for saves to finish.
2. Use **AUTOFILL** for the fast search followed automatically by complete search when necessary, or use **Complete search** directly.
3. During the search, a progress panel shows the best week so far, the overtime floor (see below), how much of the gap between the first complete week and the floor has been closed, elapsed search time, combinations checked and time since the last improvement. **Pause** retains the current search frontier and **Resume** continues that same search. **Use best now** stops the search at any time and applies the best week found so far (autofill's week if the search has not beaten it yet). **Cancel search** ends it without applying anything.
4. The search applies its best week on its own when it finishes, or after 5 minutes of search time (paused time excluded) without finding a better week.
   Every better week the search finds is listed under **Weeks found**, after autofill's own week, with when it was found, whether all positions are filled, who has no day off, and its overtime. **View** shows a week person by day (the same duty codes as the Excel export, overtime days highlighted, anyone without a day off flagged); **Previous / Next** (or the arrow keys) step through the weeks. **Use this week** stops a running search and applies that week through the normal overtime approval, with the same hard-rule checks against the current draft. The list is kept until the next autofill, and hidden if the roster, rules or time off change.
5. A found candidate goes through the existing independent validator and proposal commit path. Overtime is staged for manager approval; the solver cannot approve it or publish a week.
6. Publish only through the existing publication review, including prior-week verification and saved approvals for that exact schedule.

The complete search tries schedules without overtime first (every employee at most 40 hours worked). It then searches reviewable overtime combinations for employees whose policy allows overtime — also after finding a week in the first phase, unless that week cannot be beaten (no supervisor 12-hour days, everyone with a day off, overtime at the floor), because an overtime week can rank better on a higher objective. No OT remains absolute in both phases. PTO counts toward every full-time employee's 40-hour obligation but is charged only up to 40: extra work displaces PTO credit, so an employee with PTO may still work up to 40 hours without overtime (overtime is hours worked over 40, as in the weekly accounting). Excluded employees remain in the accounting roster, and their existing duties stay fixed.

## Priorities and optimization

Weeks are ranked by the canonical objective (`QUALITY` / `scheduleQuality`, see [scheduling-intelligence.md](scheduling-intelligence.md)): no hard-rule violations; every position filled; every full-timer at 40 credited hours; **as few supervisor 12-hour weekdays as possible**; **everyone has at least one day off**; the least total overtime; then fewer doubles, less overtime concentration, better rest, days off together, fewer shift changes, and preferences.

Monday to Friday the supervisor works 06:00–14:00 in the dedicated supervisor position only. As a last resort he may stay until 18:00 (a 4-hour late stay) as regular second-shift staff in a role he is qualified for, such as Medic. Because it ranks right after complete coverage, it is used only when no other combination completes the week; autofill's heuristic passes never add it. His profile must allow 12 continuous hours (a 12-hour preference), and any other weekday duty or handoff is still a rule violation. A day off is a day of the Sunday–Saturday week on which the employee starts no duty (a 22:00 duty belongs to the day it starts, as for the consecutive-days rule). The issue list warns about anyone without one. Unlike **Max consecutive any shifts = 6**, this is not a hard rule: a complete week always wins over a week with gaps.

The search is branch and bound. Each complete week it finds (after the usual cleanup that removes duties not needed for any hard rule, coverage, full-time hours, exclusions or locks) becomes the incumbent, and the search continues for a strictly better week: fewer supervisor 12-hour weekdays, then more people with a day off, then less total overtime. Total overtime is the sum of every employee's credited hours above 40, the same measure autofill ranks by.

A branch is pruned when it already has more seven-day weeks than the incumbent, or the same number and its overtime so far (which only grows as work is added) plus the uncovered hours that cannot fit in anyone's remaining room under 40 hours worked already reaches the incumbent's overtime. The same argument is applied per role: a role's uncovered hours beyond its qualified holders' remaining room under 40 must also be overtime. When the search exhausts its tree, no week in the duty menu beats the incumbent on supervisor 12-hour days, days off and total overtime, and the panel reports it.

Depth-first search tends to stay deep in its first subtree, so the optimizing search restarts on a Luby schedule (base 600 nodes), breaking ties in a new random order each time and keeping the incumbent. Restart lengths grow without bound, so a restart eventually exhausts the tree and the proof above still holds.

The **overtime floor** shown in the panel (`overtimeLowerBound`, explained by `overtimeFloorDetails`) is a quick lower bound: the larger of the person-hours the week requires minus every employee's generous capacity under 40 hours, and each role's required hours (Scale and Medical every hour, Supervisor weekday first shift) minus its holders' capacity under 40. The panel says which of these sets the floor. It ignores rest, streak and pairing rules, so the real minimum is often higher; it is a floor, not a target. A week that reaches it is proven optimal immediately.

The proof covers supervisor 12-hour days, seven-day weeks and total overtime only. Each week the search finds is then polished (`polishSearchWeek`) by the same lower-level passes as autofill's weeks — overtime rebalancing, then qualified swaps and three-person rotations that improve doubles, overtime spread, rest, days off together, shift changes and preferences — which never worsen a higher objective. These secondary results are improvements, not proofs; the panel says so.

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
| Finished — least overtime possible | The search exhausted its tree; no week in the duty menu has less overtime than the applied one. |
| Finished — autofill's week already has the least overtime | The search found nothing with less overtime than autofill's complete week, so that week was applied. |
| Stopped — best week applied | You chose **Use best now**, or 5 minutes passed without a better week. Less overtime may still be possible. |
| No feasible combination in the current duty menu | Every remaining branch was exhausted or rejected by a necessary constraint/bound. |
| Input or validation error | Data could not be modeled or a candidate failed the independent validator; correct the input or investigate the error. |
| Cancelled | No feasibility conclusion was reached. |
| Inputs changed | The old search cannot apply its result; start a fresh search. |

This separation follows the distinction between feasible, proven infeasible and unknown results documented for constraint solvers in [Google's CP-SAT documentation](https://developers.google.com/optimization/cp/cp_solver). This application uses its own JavaScript search, not OR-Tools.

## Search and pruning

`createCompleteScheduleSearch` owns a snapshot of all inputs. It enumerates legal employee duty bundles, selects an unmet coverage, qualification, source-duty or full-time-hour requirement, and branches over contributors to that requirement. Sibling branches exclude earlier alternatives only after their inclusion branches have been explored; branches are not dropped because of an attempt, depth, node or total-time limit.

Necessary capacity checks include distinct qualified people, available work intervals, continuous-work limits, minimum rest, weekly duty caps, remaining worked-hour allowances (an approved ceiling of 40 or more allows that many hours worked whatever the employee's PTO, because extra work displaces PTO credit), each role's remaining holders' capacity, and full-time shortfalls. Bounds intentionally overestimate possible supply. A bound is used to reject a branch only when even that optimistic supply cannot satisfy demand.

Each candidate is checked against its own employee's duties only: intervals, rule checks and hours are per employee, so this gives the whole-week answer for that employee, and the result is memoized per phase. Staffing limits are re-checked only in the slots the candidate adds work to, since every visited state already respects them. This is an exact speed-up: the same tree is explored.

Every candidate also obeys an exact staffing limit: three regular staff throughout every shift, plus one dedicated Supervisor only on first shift Monday through Friday. Regular duties, extended halves and handoffs count together by actual time overlap; mirrored records count as the same person. A full-time shortfall or missing qualification must be resolved by reassignment within this limit. An overstaffed fixed/locked seed is an input error, and existing locks are retained. The independent assignment, proposal and publication validators enforce the same maximum.

Most policy violations cannot be repaired by adding more work. Short-rest violations receive special handling: an adjoining extension can eliminate a short rest by joining two blocks, but only if the joined block fits the continuous-work limit. A locked handoff's missing source is treated as an outstanding requirement rather than rejected before its source can be added.

The generator yields between work items. The browser controller advances approximately 12ms slices with at most 150 generator steps per slice, then yields back to the event loop. These are responsiveness budgets, not total search limits. Individual work items may take longer. Pause retains the frontier; a week change, unmount or changed input fingerprint invalidates the old controller. The frontier is not persisted across reloads.

## Validation evidence

- At the time this search was introduced, 234 tests passed, including 30 complete-search tests. Current results and the optimization oracle are in [scheduling-intelligence.md](scheduling-intelligence.md).
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

The small **Repair current draft** and **Improve preferences** actions remain local improvement tools with limited budgets. Complete search handles feasibility and overtime when those local moves are insufficient. Global preference optimization, persistent checkpoints and a solver service for very large rosters are separate enhancements. On hard rosters the overtime search may not finish; the best week so far is always available.

Rendered browser interaction and print layout remain unverified in this environment. Browser acceptance is still required before merging the draft PR for operational use.
