"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const core = require("./load-core");
const { DAYS, employeePolicyIssues: check, assignmentIssues, scheduleChangeIssues,
  proposedSwap, canWorkExtHalf, calcConsecutiveNights, boundaryPatterns, validateAssignmentPolicy } = core;
const emp = (extra = {}) => ({ id: "e", name: "Employee", qualifications: ["Guard"], employmentType: "full-time", ...extra });
const a = (id = "e", position = "Guard") => ({ employeeId: id, position });
const sched = (days, sid = "first") => Object.fromEntries(days.map(day => [day + "__" + sid, [a()]]));
const types = issues => issues.map(i => i.type);
const options = extra => ({ extShifts: [], handoffs: [], empTimeOffDays: new Set(), empPatterns: {}, ...extra });

test("night counter walks nights, not intervening daytime slots", () => {
  const s = sched(["Sunday", "Monday", "Tuesday"], "third");
  assert.equal(calcConsecutiveNights("e", s, "Tuesday", "third"), 3);
  assert.equal(calcConsecutiveNights("e", s, "Wednesday", "third"), 3);
  assert(types(assignmentIssues(emp(), "Wednesday", "third", "Guard", s)).includes("consecutive_nights"));
  assert(!types(check(emp(), s)).includes("consecutive_nights"));
});

test("same-week Saturday never extends the Sunday run", () => {
  assert.deepEqual(check(emp(), sched(["Sunday", "Monday", "Thursday", "Friday", "Saturday"]), { maxConsecutiveShifts: 3 }), []);
});

test("rest is checked after an inserted shift as well as before it", () => {
  const issues = assignmentIssues(emp(), "Sunday", "third", "Guard", sched(["Monday"], "second"));
  assert(types(issues).includes("short_rest")); // Sun night ends 06:00, Mon afternoon starts 14:00.
});

test("a willing double is allowed, but 24 continuous hours is not", () => {
  const e = emp({ willing16h: true });
  assert.deepEqual(assignmentIssues(e, "Sunday", "second", "Guard", sched(["Sunday"])), []);
  const s = { ...sched(["Sunday"]), ...sched(["Sunday"], "second") };
  assert(types(assignmentIssues(e, "Sunday", "third", "Guard", s)).includes("continuous_hours"));
  assert(types(assignmentIssues(emp(), "Sunday", "second", "Guard", sched(["Sunday"]))).includes("continuous_hours"));
});

test("forty hours across four days cannot hide a first-and-third split double", () => {
  for (const willing16h of [false, true]) {
    const e = emp({ willing16h, overtimePref: "blocked" });
    const s = { ...sched(["Sunday", "Tuesday", "Thursday", "Friday"]), ...sched(["Sunday"], "third") };
    assert.equal(core.normalizedWorkedHours(e.id, s), 40);
    const issues = check(e, s, { minRestHours: 8 });
    assert.deepEqual(types(issues), ["split_double"]);
    assert.equal(issues[0].day, "Sunday");
    assert.equal(issues[0].shiftId, "third");
    for (const [existing, added] of [["first", "third"], ["third", "first"]])
      assert(types(assignmentIssues(e, "Sunday", added, "Guard", sched(["Sunday"], existing), { minRestHours: 8 })).includes("split_double"));
    const repaired = { ...s, Sunday__third: [], Saturday__first: [a()] };
    assert.deepEqual(scheduleChangeIssues(s, repaired, [e], { minRestHours: 8 }), []);
    assert.equal(core.normalizedWorkedHours(e.id, repaired), 40);
    assert(types(scheduleChangeIssues(repaired, s, [e], { minRestHours: 8 })).includes("split_double"));
  }
});

test("same-day split detection uses actual blocks without rejecting continuous duties or overnight work", () => {
  const e = emp({ willing16h: true, ext12hPref: "day" });
  for (const first of ["first", "second"])
    assert.deepEqual(check(e, { ...sched(["Sunday"], first), ...sched(["Sunday"], first === "first" ? "second" : "third") }, { minRestHours: 8 }), []);
  assert.deepEqual(check(e, sched(["Sunday", "Monday"], "third"), { minRestHours: 8 }), []);
  const ext = [{ day: "Sunday", pairId: "day", empAId: "e" }];
  assert.deepEqual(check(e, { ...sched(["Sunday"]), ...sched(["Sunday"], "second") }, {}, options({ extShifts: ext })), []);
  const split = { ...sched(["Sunday"]), ...sched(["Sunday"], "third") };
  assert(types(check(e, split, { minRestHours: 0 }, options({ extShifts: ext }))).includes("split_double"));
  assert(types(core.getFatigueIssues(e.id, split, { minRestHours: 8 }, [e], [])).includes("split_double"));
});

test("qualified twelve-hour work is allowed without sixteen-hour consent", () => {
  const e = emp({ ext12hPref: "day" });
  const exts = [{ day: "Sunday", pairId: "day", empAId: "e" }];
  assert.deepEqual(check(e, {}, {}, options({ extShifts: exts })), []);
  assert.deepEqual(check(e, sched(["Sunday"]), {}, options({ extShifts: exts })), [], "mirror is not a second duty");
});

test("extended half eligibility uses its actual hours and every blocked shift", () => {
  assert.equal(canWorkExtHalf(emp({ ext12hPref: "day" }), "day", 1), false);
  assert.equal(canWorkExtHalf(emp({ ext12hPref: "night" }), "day", 1), true);
  assert.equal(canWorkExtHalf(emp({ ext12hPref: "both", blockedShifts: ["second"] }), "day", 0), false);
  assert.equal(canWorkExtHalf(emp({ ext12hPref: "day", requiredShift: "third", crossShiftOT: true }), "day", 0), true);
  assert.equal(canWorkExtHalf(emp(), "missing", 0), false);
});

test("authorized cross-shift work is allowed below forty hours", () => {
  assert.deepEqual(assignmentIssues(emp({ requiredShift: "first", crossShiftOT: true }), "Sunday", "second", "Guard", {}), []);
  assert(types(assignmentIssues(emp({ requiredShift: "first" }), "Sunday", "second", "Guard", {})).includes("required_shift"));
});

test("availability, PTO days and exact qualifications are hard rules", () => {
  assert(types(assignmentIssues(emp({ availableDaysOfWeek: ["Tuesday"] }), "Monday", "first", "Guard", {})).includes("availability"));
  assert(types(assignmentIssues(emp(), "Monday", "first", "Guard", {}, {}, options({ empTimeOffDays: new Set(["e__Monday"]) }))).includes("availability"));
  assert(types(assignmentIssues(emp({ qualifications: ["Medical"] }), "Monday", "first", "Guard", {})).includes("qualification"));
});

test("supervisor must occupy the additional weekday first-shift position", () => {
  const e = emp({ qualifications: ["Guard", "Supervisor"] });
  assert.deepEqual(assignmentIssues(e, "Monday", "first", "Supervisor", {}), []);
  assert(types(assignmentIssues(e, "Monday", "first", "Guard", {})).includes("supervisor_slot"));
  assert(types(assignmentIssues(e, "Monday", "second", "Supervisor", {})).includes("supervisor_slot"));
});

test("weekly duty cap includes extended work; weekend cap counts days", () => {
  assert.deepEqual(check(emp({ willing16h: true, maxWeekendDays: 1 }), { ...sched(["Sunday"]), ...sched(["Sunday"], "second") }), []);
  assert(types(check(emp({ maxWeekendDays: 1 }), sched(["Sunday", "Saturday"]))).includes("weekend_days"));
  assert(types(check(emp({ ext12hPref: "day", maxShiftsPerWeek: 1 }), sched(["Tuesday"]), {}, options({ extShifts: [{ day: "Sunday", pairId: "day", empAId: "e" }] }))).includes("weekly_shifts"));
});

test("No OT is absolute for every employment type and includes extended hours", () => {
  for (const employmentType of ["full-time", "part-time", "on-call"]) {
    const e = emp({ overtimePref: "blocked", employmentType });
    const s = sched(["Sunday", "Monday", "Tuesday", "Thursday", "Friday"]);
    assert.deepEqual(check(e, s), []);
    assert(types(assignmentIssues(e, "Saturday", "first", "Guard", s)).includes("no_overtime"));
  }
  const e = emp({ overtimePref: "blocked", ext12hPref: "day" });
  const exts = ["Sunday", "Monday", "Tuesday", "Thursday"].map(day => ({ day, pairId: "day", empAId: "e" }));
  assert(types(check(e, {}, {}, options({ extShifts: exts }))).includes("no_overtime"));
});

test("handoffs need authorization and cannot evade hours or rest limits", () => {
  const h = { day: "Friday", employeeId: "e", position: "Guard", sourceShiftId: "first", targetShiftId: "second", type: "late-stay", hours: 4 };
  const s = sched(["Sunday", "Monday", "Tuesday", "Thursday", "Friday"]);
  const e = emp({ ext12hPref: "day", overtimePref: "blocked" });
  assert(types(check(e, s, {}, options({ handoffs: [h] }))).includes("no_overtime"));
  assert(types(check(emp({ ext12hPref: "day", requiredShift: "first" }), s, {}, options({ handoffs: [h] }))).includes("required_shift"));
  assert(types(check(e, {}, {}, options({ handoffs: [h] }))).includes("invalid_handoff"));
});

test("actual previous week extends nights and rest, stale patterns do not", () => {
  const history = [{ weekStart: "2026-08-30", schedule: sched(["Thursday", "Friday", "Saturday"], "third") }];
  const p = boundaryPatterns(history, "2026-09-06", {});
  assert(types(check(emp(), sched(["Sunday"], "third"), {}, options({ empPatterns: p }))).includes("consecutive_nights"));
  assert(types(check(emp(), sched(["Sunday"]), {}, options({ empPatterns: p }))).includes("continuous_hours"));
  assert.deepEqual(check(emp(), sched(["Sunday"]), {}, options({ empPatterns: boundaryPatterns([], "2026-09-06", { e: { trailingDays: 7 } }) })), []);
});

test("previous extended shift and handoff affect next week's rest", () => {
  const extHistory = [{ weekStart: "2026-08-30", schedule: {}, extShifts: [{ day: "Saturday", pairId: "swing-10p-10a", empAId: "e" }] }];
  const p = boundaryPatterns(extHistory, "2026-09-06", {});
  assert(types(check(emp(), sched(["Sunday"], "second"), {}, options({ empPatterns: p }))).includes("short_rest"));
});

test("swap is atomic even within one cell, and uses new positions' qualifications", () => {
  const before = { Sunday__first: [a("e", "Medical"), a("g")] };
  const src = { day: "Sunday", shiftId: "first", employeeId: "e", position: "Medical" };
  const tgt = { ...src, employeeId: "g", position: "Guard" };
  const after = proposedSwap(before, src, tgt);
  assert.deepEqual(after.Sunday__first, [a("g", "Medical"), a("e")]);
  assert.equal(new Set(after.Sunday__first.map(a => a.employeeId)).size, 2);
  assert(types(scheduleChangeIssues(before, after, [emp({ qualifications: ["Medical", "Guard"] }), emp({ id: "g" })])).includes("qualification"));
});

test("repairs may fix an imported violation but cannot add a new one", () => {
  const e = emp({ unavailableDays: ["Sunday"] });
  const before = sched(["Sunday"]), after = sched(["Tuesday"]);
  assert.deepEqual(scheduleChangeIssues(before, after, [e]), []);
  assert(types(scheduleChangeIssues(after, before, [e])).includes("availability"));
});

test("unknown employees and duplicate extended assignments are rejected", () => {
  assert(types(validateAssignmentPolicy(sched(["Sunday"]), [])).includes("unknown_employee"));
  const ext = { day: "Sunday", pairId: "day", empAId: "e" };
  assert(types(check(emp({ ext12hPref: "day" }), {}, {}, options({ extShifts: [ext, { ...ext }] }))).includes("overlap"));
});

const html = fs.readFileSync(__dirname + "/ShiftScheduler_latest loop.html", "utf8");
test("production manual commit blocks forward-rest violations and accepts a valid move", () => {
  const start = html.indexOf("  const commitAssignmentChange =");
  const end = html.indexOf("  const commitExtendedChange =", start);
  let state = sched(["Monday"], "second"), alerts = [];
  const commit = new Function(...Object.keys(core), "schedule", "employees", "cfg", "policyOptions", "isReadOnly", "setSchedule", "showAlert", "manualInputIsCurrent",
    html.slice(start, end) + "return commitAssignmentChange;")(...Object.values(core), state, [emp()], {}, options(), false,
      fn => { state = fn(state); }, alert => alerts.push(alert), () => true);
  assert.equal(commit(s => ({ ...s, Sunday__third: [a()] })), false);
  assert.equal(alerts.length, 1);
  assert.equal(state.Sunday__third, undefined);
  assert.equal(commit(s => ({ ...s, Wednesday__second: [a()] })), true);
  assert.equal(state.Wednesday__second.length, 1);
});

test("production gap repair cannot add an unavailable or No OT employee", () => {
  const start = html.indexOf("    const repairGaps = result =>");
  const end = html.indexOf("// ── Iterative loop with diagnostic escalation", start);
  const employee = emp({ qualifications: ["Guard", "Scale", "Medical"], overtimePref: "blocked", availableDaysOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] });
  const roster = [employee];
  const repair = new Function(...Object.keys(core), "source", "empTimeOffDays", "cfg", "validateSchedule", "ps", "enrichedPatterns", "accountingRoster", "ptoHoursByEmployee",
    "const fairnessHistory={};"+html.slice(start, end) + "return repairGaps;")(...Object.values(core), roster, new Set(), {}, () => [], () => 1, {}, roster, {});
  const ns = sched(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
  const result = repair({ ns, autoExtShifts: [], hourTracker: { e: 40 }, handoffs: [],
    issues: [{ type: "coverage", day: "Saturday", shiftId: "first", have: 0, need: 3 }] });
  assert.equal((result.ns.Saturday__first || []).length, 0);
  assert.equal(result.hourTracker.e, 40);
});

test("fatigue display agrees with policy for willing doubles and mirrored twelve-hour shifts", () => {
  const double = { ...sched(["Sunday"]), ...sched(["Sunday"], "second") };
  assert.deepEqual(core.getFatigueIssues("e", double, {}, [emp({ willing16h: true })], []), []);
  const ext = [{ day: "Sunday", pairId: "swing-10a-10p", empAId: "e" }];
  assert.equal(core.calcConsecutiveHours("e", sched(["Sunday"]), "Sunday", "first", ext), 12);
});

test("a repair cannot relocate an availability violation to a different day", () => {
  const e = emp({ unavailableDays: ["Sunday", "Monday"] });
  assert(types(scheduleChangeIssues(sched(["Sunday"]), sched(["Monday"]), [e])).includes("availability"));
});

test("production generation returns complete coverage for a feasible qualified roster", () => {
  const roster = [];
  // Two teams alternate three/four days; all regular staff are dual-qualified.
  for (const sid of ["first", "second", "third"]) for (let group = 0; group < 2; group++) for (let n = 0; n < 3; n++)
    roster.push(emp({ id: `${sid}-${group}-${n}`, name: `${sid}-${group}-${n}`, qualifications: ["Guard", "Scale", "Medical"],
      employmentType: "part-time", overtimePref: "blocked", requiredShift: sid,
      availableDaysOfWeek: group ? DAYS.slice(3) : DAYS.slice(0, 3), maxShiftsPerWeek: 4 }));
  roster.push(emp({ id: "sup", name: "Supervisor", qualifications: ["Supervisor"], requiredShift: "first", overtimePref: "blocked" }));
  const cfg = { maxConsecutiveNights: 4, minRestHours: 12, maxConsecutiveShifts: 5 };
  const start = html.indexOf("    const attempt = (jitter, withProactive = true) => {");
  const end = html.indexOf("    // ── Commit best result", start);
  const validate = (schedule, extShifts, employees, handoffs = []) => [
    ...core.validateCoverage(schedule, employees, extShifts, handoffs),
    ...validateAssignmentPolicy(schedule, employees, cfg, options({ extShifts, handoffs }))];
  const attempt = new Function(...Object.keys(core), "source", "cfg", "empTimeOffDays", "enrichedPatterns", "extShifts", "swingDesig", "validateSchedule", "accountingRoster", "ptoHoursByEmployee", "preservedSchedule", "preservedHandoffs", "excludeSet",
    "const schedule=preservedSchedule,handoffs=preservedHandoffs,fairnessHistory={};"+html.slice(start, end) + "return attempt;")(...Object.values(core), roster, cfg, new Set(), {}, [], {}, validate, roster, {}, {}, [], new Set());
  const result = attempt(false);
  assert.equal(result.errors, 0, JSON.stringify(result.issues));
  assert.equal(core.validateCoverage(result.ns, roster, result.autoExtShifts, result.handoffs).length, 0);
  assert.equal(validateAssignmentPolicy(result.ns, roster, cfg, options({ extShifts: result.autoExtShifts, handoffs: result.handoffs })).length, 0);
  assert.equal(Object.values(result.ns).flat().length, 68);
});

test("a handoff that works a swing's hours requires that swing to be selected", () => {
  const s = sched(["Saturday"]);
  const early = { day: "Friday", employeeId: "e", type: "early-arrival", sourceShiftId: "first", targetShiftId: "third", position: "Guard", hours: 4 };
  const late = { day: "Saturday", employeeId: "e", type: "late-stay", sourceShiftId: "first", targetShiftId: "second", position: "Guard", hours: 4 };
  assert(types(check(emp(), s, {}, options({ handoffs: [early] }))).includes("swing_eligibility"));
  assert(!types(check(emp({ swingEligible: ["swing-2a-2p"] }), s, {}, options({ handoffs: [early] }))).includes("swing_eligibility"));
  // 0600–1800 is a 12-hour day, not a swing.
  assert(!types(check(emp(), s, {}, options({ handoffs: [late] }))).includes("swing_eligibility"));
});

test("a supervisor's early arrival for Friday's third shift is Saturday work, not a weekday duty", () => {
  const sup = emp({ qualifications: ["Supervisor", "Scale", "Guard"], swingEligible: ["swing-2a-2p"] });
  const early = day => ({ day, employeeId: "e", type: "early-arrival", sourceShiftId: "first", targetShiftId: "third", position: "Scale", hours: 4 });
  // Friday night's 02:00–06:00 tail joined to Saturday first = a weekend 2A–2P.
  assert(!types(check(sup, { Saturday__first: [a("e", "Scale")] }, {}, options({ handoffs: [early("Friday")] }))).includes("supervisor_slot"));
  // Thursday night's tail falls on Friday morning, when the supervisor must supervise.
  assert(types(check(sup, { Friday__first: [a("e", "Scale")] }, {}, options({ handoffs: [early("Thursday")] }))).includes("supervisor_slot"));
});

test("a weekday supervisor may stay 14:00–18:00 as regular staff after supervising, and nothing else", () => {
  const sup = emp({ qualifications: ["Supervisor", "Medical", "Guard"], ext12hPref: "day" });
  const late = position => ({ day: "Monday", employeeId: "e", type: "late-stay", sourceShiftId: "first", targetShiftId: "second", position, hours: 4 });
  const s = { Monday__first: [a("e", "Supervisor")] };
  assert.deepEqual(types(check(sup, s, {}, options({ handoffs: [late("Medical")] }))), []);
  assert(types(check(sup, s, {}, options({ handoffs: [late("Supervisor")] }))).includes("supervisor_slot"));
  assert(types(check(sup, { ...s, Monday__second: [a("e", "Medical")] })).includes("supervisor_slot"), "a full second shift is still not allowed");
  assert.equal(core.supervisorExtensions([sup], [late("Medical")]), 1);
  assert.equal(core.supervisorExtensions([emp({ qualifications: ["Medical"] })], [late("Medical")]), 0, "only supervisors are counted");
});
