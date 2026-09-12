"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const core = require("./load-core");
const { analyzeShiftCoverage: coverage, validateCoverage, extendedWorkIntervals,
  extendedCoverageFloor, extCovers, DAYS, SHIFTS, cellKey, computeWeekStats } = core;
const emp = (id, qualifications = ["Guard"], extra = {}) =>
  ({ id, name: id, qualifications, employmentType: "part-time", ...extra });
const assignment = (employeeId, position = "Guard") => ({ employeeId, position });
const roster = [emp("dual", ["Scale", "Medical"]), emp("g1"), emp("g2"),
  emp("med", ["Medical"]), emp("scale", ["Scale"]), emp("sup", ["Supervisor", "Scale", "Medical"])];
const regulars = [assignment("dual", "Scale"), assignment("g1"), assignment("g2")];
const ext = (pairId, empAId = "g1", empBId = "g2", day = "Sunday") => ({ pairId, empAId, empBId, day });

// Exercise the real UI validator, not a copied validator with different rules.
const html = fs.readFileSync(__dirname + "/ShiftScheduler_latest loop.html", "utf8");
const start = html.indexOf("const validateSchedule = useCallback(") + "const validateSchedule = useCallback(".length;
const end = html.indexOf("\n  }, [", start) + "\n  }".length;
assert(start > 0 && end > start, "production validator must be extractable");
const productionValidator = (employees) => new Function(...Object.keys(core), "employees", "extShifts", "cfg", "empTimeOffDays", "empPatterns", "history", "weekStart", "timeOffReqs", "afExclude", "ptoHoursByEmployee",
  "return " + html.slice(start, end))(...Object.values(core), employees, [], {}, new Set(), {}, [], "2026-09-06", [], [], {});
const slotIssues = (issues, day = "Sunday", shift = "second") => issues.filter(i => i.day === day && i.shiftId === shift);

test("dual qualified regular covers both roles, with three distinct people", () => {
  assert.equal(coverage("Sunday", "first", { Sunday__first: regulars }, roster).ok, true);
  assert.equal(coverage("Sunday", "first", { Sunday__first: regulars.slice(0, 2) }, roster).ok, false);
});

test("weekday supervisor is a separate fourth person and cannot supply regular roles", () => {
  let sched = { Monday__first: [...regulars, assignment("sup", "Supervisor")] };
  assert.equal(coverage("Monday", "first", sched, roster).ok, true);
  sched.Monday__first = [assignment("sup", "Supervisor"), assignment("g1"), assignment("g2"), assignment("med", "Medical")];
  assert.deepEqual(coverage("Monday", "first", sched, roster).missing, ["Scale"]);
  sched.Monday__first = [...regulars, assignment("med", "Medical")];
  assert.equal(coverage("Monday", "first", sched, roster).isFull, false);
  assert.deepEqual(coverage("Monday", "first", sched, roster).missing, ["Supervisor"]);
});

test("one four-hour handoff leaves four hours short in the production validator", () => {
  const sched = { Sunday__first: [assignment("med", "Medical")],
    Sunday__second: [assignment("scale", "Scale"), assignment("g1")] };
  const handoffs = [{ day: "Sunday", sourceShiftId: "first", targetShiftId: "second",
    employeeId: "med", position: "Medical", type: "late-stay", hours: 4 }];
  const c = coverage("Sunday", "second", sched, roster, [], handoffs);
  assert.equal(c.bodyGapHours, 4);
  assert.equal(c.roleGapHours, 4);
  const issues = slotIssues(productionValidator(roster)(sched, [], roster, handoffs));
  assert.equal(issues.length, 2);
  assert(issues.every(i => i.msg.includes("18:00–22:00")));
});

test("complementary handoffs fill the whole shift, duplicate halves do not", () => {
  const emps = [...roster, emp("med2", ["Medical"])];
  const sched = { Sunday__first: [assignment("med", "Medical")], Sunday__third: [assignment("med2", "Medical")],
    Sunday__second: [assignment("scale", "Scale"), assignment("g1")] };
  const h = { day: "Sunday", sourceShiftId: "first", targetShiftId: "second", employeeId: "med", type: "late-stay", hours: 4 };
  assert.equal(coverage("Sunday", "second", sched, emps, [], [h, { ...h }]).bodyGapHours, 4);
  const second = { ...h, sourceShiftId: "third", employeeId: "med2", type: "early-arrival" };
  assert.equal(coverage("Sunday", "second", sched, emps, [], [h, second]).ok, true);
});

test("orphan and incorrectly oriented handoffs do not create coverage", () => {
  const sched = { Sunday__second: [assignment("dual", "Scale"), assignment("g1")] };
  const h = { day: "Sunday", sourceShiftId: "first", targetShiftId: "second", employeeId: "g2", type: "late-stay", hours: 4 };
  assert.equal(coverage("Sunday", "second", sched, roster, [], [h]).bodyGapHours, 8);
  sched.Sunday__third = [assignment("g2")];
  assert.equal(coverage("Sunday", "second", sched, roster, [], [{ ...h, sourceShiftId: "third" }]).bodyGapHours, 8);
});

test("extended pair uses each person's own times and qualifications", () => {
  const sched = { Sunday__first: [assignment("scale", "Scale"), assignment("g2")] };
  const exts = [ext("day", "g1", "med")];
  const c = coverage("Sunday", "first", sched, roster, exts);
  assert.equal(c.isFull, true);
  assert.equal(c.hasMedical, false);
  assert(slotIssues(productionValidator(roster)(sched, exts, roster), "Sunday", "first").some(i => i.role === "Medical"));
  assert.deepEqual(extendedWorkIntervals(ext("day")).map(i => [i.start, i.end]), [[6, 18], [18, 30]]);
  assert.deepEqual(extendedWorkIntervals(ext("night")).map(i => [i.start, i.end]), [[18, 30], [6, 18]]);
});

test("extended capacity floor recognizes complementary halves and missing partners", () => {
  assert.equal(extendedCoverageFloor("Sunday", "second", [ext("day")], roster), 1);
  assert.equal(extendedCoverageFloor("Sunday", "second", [ext("day", "g1", null)], roster), 0);
  assert.equal(extendedCoverageFloor("Sunday", "third", [ext("day")], roster), 1);
  const c = coverage("Sunday", "second", { Sunday__second: [assignment("scale", "Scale"), assignment("g2")] }, roster,
    [ext("day", "med", "g1")]);
  assert.equal(c.hasMedical, false, "medic works only the first half");
});

test("swing starts at 10:00 and mirror cells never fabricate 06:00 coverage", () => {
  const sched = { Sunday__first: [...regulars] };
  const exts = [ext("swing-10a-10p", "g2", "med")];
  const c = coverage("Sunday", "first", sched, roster, exts);
  assert.equal(c.bodyGapHours, 4);
  assert.equal(c.count, 2);
  assert.equal(extendedCoverageFloor("Sunday", "first", exts, roster), 0);
  assert.equal(extendedCoverageFloor("Monday", "first", exts, roster), 0);
});

test("split partner covers after 02:00 and the following first shift", () => {
  const pair = ext("split");
  assert.deepEqual(extendedWorkIntervals(pair).map(i => [i.start, i.end]), [[14, 26], [26, 38]]);
  assert.equal(extendedCoverageFloor("Sunday", "third", [pair], roster), 1);
  assert.equal(extendedCoverageFloor("Monday", "first", [pair], roster), 1);
  assert.equal(extendedCoverageFloor("Sunday", "third", [ext("split", null, "g2")], roster), 0);
});

test("Saturday carry-out does not wrap into this week's Sunday", () => {
  const pair = ext("split", "g1", "g2", "Saturday");
  assert.equal(extCovers(pair, "Saturday", "third"), true);
  assert.equal(extCovers(pair, "Sunday", "first"), false);
  assert.equal(extendedCoverageFloor("Sunday", "first", [pair], roster), 0);
});

test("02:00 swing covers early morning, not the same day's 22:00 shift", () => {
  const pair = ext("swing-2a-2p", "g1", null);
  assert.equal(extCovers(pair, "Sunday", "first"), true);
  assert.equal(extCovers(pair, "Sunday", "third"), false);
});

test("duplicate records, unknown employees, and trainees cannot fill extra bodies", () => {
  let c = coverage("Sunday", "first", { Sunday__first: [regulars[0], regulars[1], regulars[1], assignment("unknown")] }, roster);
  assert.equal(c.count, 2);
  const emps = roster.map(e => e.id === "dual" ? { ...e, inTraining: true } : e);
  c = coverage("Sunday", "first", { Sunday__first: regulars }, emps);
  assert.equal(c.count, 2);
  assert.deepEqual(c.missing, ["Scale", "Medical"]);
  assert.equal(extendedCoverageFloor("Sunday", "first", [ext("day"), ext("day")], roster), 1);
});

test("complete week validates and reports 100 percent coverage", () => {
  const sched = {};
  for (const d of DAYS) for (const s of SHIFTS) sched[cellKey(d, s.id)] =
    [...regulars, ...(core.SUP_SLOT_DAY(d, s.id) ? [assignment("sup", "Supervisor")] : [])];
  assert.deepEqual(validateCoverage(sched, roster), []);
  assert.equal(computeWeekStats(sched, roster, []).coveragePct, 100);
});

test("sub-hour gaps are retained rather than rounded into full coverage", () => {
  const sched = { Sunday__first: [assignment("g2")], Sunday__second: regulars.slice(0, 2), Sunday__third: [assignment("med", "Medical")] };
  const handoffs = [
    { day: "Sunday", sourceShiftId: "first", targetShiftId: "second", employeeId: "g2", type: "late-stay", hours: 3.75 },
    { day: "Sunday", sourceShiftId: "third", targetShiftId: "second", employeeId: "med", type: "early-arrival", hours: 4 }
  ];
  const c = coverage("Sunday", "second", sched, roster, [], handoffs);
  assert.equal(c.bodyGapHours, 0.25);
  assert(slotIssues(validateCoverage(sched, roster, [], handoffs))[0].msg.includes("17:45–18:00"));
});

test("production gap repair keeps searching after the first four-hour handoff", () => {
  const source = [emp("scale", ["Scale"], { requiredShift: "second" }),
    emp("g1", ["Guard"], { requiredShift: "second" }),
    emp("med", ["Medical"], { requiredShift: "first", crossShiftOT: true, ext12hPref: "both", maxShiftsPerWeek: 1 }),
    emp("med2", ["Medical"], { requiredShift: "third", crossShiftOT: true, ext12hPref: "both", maxShiftsPerWeek: 1 })];
  const ns = { Sunday__second: [assignment("scale", "Scale"), assignment("g1")],
    Sunday__first: [assignment("med", "Medical")], Sunday__third: [assignment("med2", "Medical")] };
  const a = html.indexOf("const repairGaps = result =>");
  const b = html.indexOf("// ── Iterative loop with diagnostic escalation", a);
  assert(a >= 0 && b > a);
  const repair = new Function(...Object.keys(core), "source", "empTimeOffDays", "cfg", "validateSchedule", "ps", "enrichedPatterns", "accountingRoster", "ptoHoursByEmployee",
    "const fairnessHistory={};"+html.slice(a, b) + "\nreturn repairGaps;")(...Object.values(core), source, new Set(), {}, productionValidator(source), () => 1, {}, source, {});
  const issues = slotIssues(validateCoverage(ns, source));
  const result = repair({ ns, autoExtShifts: [], hourTracker: { scale: 8, g1: 8, med: 8, med2: 8 }, handoffs: [], issues });
  assert.equal(result.handoffs.length, 2);
  assert.equal(coverage("Sunday", "second", result.ns, source, [], result.handoffs).ok, true);
  assert.deepEqual(slotIssues(result.issues), []);
});
