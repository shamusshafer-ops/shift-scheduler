// harness.js — empirical evaluation of buildAutoFill.
// Roster modeled on a ~15-person paper-mill security site:
// 1 Supervisor, Scale/Medical specialists, Guard-only FT, PT, on-call.
"use strict";
const core = require("./load-core.js");
const {
  buildAutoFill, DAYS, SHIFTS, cellKey, REGULAR_SLOTS, SUP_SLOT_DAY,
  SHIFT_HOURS, FT_MIN_HOURS, calcRestGap, calcConsecutiveHours,
  calcConsecutiveNights, isRestViolation, empMaxConsec,
} = core;

// ── Roster builder ─────────────────────────────────────────────────────────
function mkEmp(id, name, type, quals, extra = {}) {
  return {
    id, name, employmentType: type, qualifications: quals,
    preferredShifts: [], preferredDaysOff: [], unavailableDays: [],
    blockedShifts: [], requiredShift: null, maxShiftsPerWeek: null,
    maxWeekendDays: null, willing16h: false, crossShiftOT: false,
    swingEligible: [], splitShiftEligible: false, inTraining: false,
    availableDaysOfWeek: null, overtimePref: "neutral",
    prefStrength: { shift: 1, daysOff: 1, overtime: 1 },
    notes: "", ...extra,
  };
}

function baseRoster() {
  return [
    mkEmp("e1",  "Sup Adams",    "full-time", ["Supervisor","Guard"]),
    mkEmp("e2",  "Scale Baker",  "full-time", ["Scale","Guard"],   { preferredShifts:["first"] }),
    mkEmp("e3",  "Med Carter",   "full-time", ["Medical","Guard"], { preferredShifts:["first"] }),
    mkEmp("e4",  "Dual Davis",   "full-time", ["Scale","Medical","Guard"], { preferredShifts:["second"] }),
    mkEmp("e5",  "Scale Evans",  "full-time", ["Scale","Guard"],   { preferredShifts:["second"] }),
    mkEmp("e6",  "Med Foster",   "full-time", ["Medical","Guard"], { preferredShifts:["second"] }),
    mkEmp("e7",  "Scale Grant",  "full-time", ["Scale","Guard"],   { preferredShifts:["third"] }),
    mkEmp("e8",  "Med Harris",   "full-time", ["Medical","Guard"], { preferredShifts:["third"] }),
    mkEmp("e9",  "Guard Irwin",  "full-time", ["Guard"],           { preferredShifts:["first"], preferredDaysOff:["Saturday","Sunday"] }),
    mkEmp("e10", "Guard Jones",  "full-time", ["Guard"],           { preferredShifts:["third"] }),
    mkEmp("e11", "Guard Klein",  "full-time", ["Guard"],           { preferredShifts:["second"] }),
    mkEmp("e12", "PT Lopez",     "part-time", ["Guard","Scale"],   { preferredShifts:["second"], maxShiftsPerWeek: 3 }),
    mkEmp("e13", "PT Moore",     "part-time", ["Guard","Medical"], { preferredShifts:["third"],  maxShiftsPerWeek: 3 }),
    mkEmp("e14", "OC Nash",      "on-call",   ["Guard"],           { maxShiftsPerWeek: 4 }),
    mkEmp("e15", "OC Owens",     "on-call",   ["Guard","Scale","Medical"], { maxShiftsPerWeek: 2 }),
  ];
}

// Scenario variants
const SCENARIOS = {
  baseline: () => ({ emps: baseRoster(), timeOff: new Set(), patterns: null, exts: [] }),
  pto_specialist: () => {
    const emps = baseRoster();
    const timeOff = new Set();
    ["Wednesday","Thursday","Friday"].forEach(d => timeOff.add("e4__" + d)); // dual-qual out 3 days
    return { emps, timeOff, patterns: null, exts: [] };
  },
  tight: () => { // drop one medical + one guard → understaffed pressure
    const emps = baseRoster().filter(e => !["e6","e11"].includes(e.id));
    return { emps, timeOff: new Set(), patterns: null, exts: [] };
  },
  infeasible_day: () => { // both 3rd-shift specialists off Tuesday → impossible role coverage
    const emps = baseRoster();
    const timeOff = new Set(["e7__Tuesday","e8__Tuesday","e15__Tuesday","e4__Tuesday","e13__Tuesday"]);
    return { emps, timeOff, patterns: null, exts: [] };
  },
  carryover: () => { // pattern memory + trailing-day pressure from previous week
    const emps = baseRoster();
    const patterns = {};
    ["e2","e3","e4","e5","e6","e7","e8","e9","e10","e11"].forEach((id,i) => {
      patterns[id] = { blockStart: i % 7, shiftId: ["first","second","third"][i % 3], trailingDays: i % 2 === 0 ? 3 : 0 };
    });
    return { emps, timeOff: new Set(), patterns, exts: [] };
  },
  multi_pref: () => { // employees with multiple preferred shifts (the "any"-group path)
    const emps = baseRoster();
    emps.find(e=>e.id==="e9").preferredShifts = ["first","second"];
    emps.find(e=>e.id==="e10").preferredShifts = ["second","third"];
    return { emps, timeOff: new Set(), patterns: null, exts: [] };
  },
};

// ── Validator: mirrors production validateSchedule + hard fatigue rules ────
function validate(sched, emps, timeOff, patterns, exts) {
  const errors = [];
  const E = (m) => errors.push(m);
  const rmap = Object.fromEntries(emps.map(e => [e.id, e]));

  for (const day of DAYS) for (const shift of SHIFTS) {
    const key = cellKey(day, shift.id);
    const asgn = sched[key] || [];
    const regNeed = REGULAR_SLOTS(day, shift.id);
    const supNeed = SUP_SLOT_DAY(day, shift.id) ? 1 : 0;
    if (asgn.length < regNeed + supNeed) E(`GAP ${day}/${shift.id} ${asgn.length}/${regNeed+supNeed}`);
    if (supNeed && !asgn.some(a => a.position === "Supervisor")) E(`NOSUP ${day}`);
    const regs = asgn.filter(a => a.position !== "Supervisor");
    const hasS = regs.some(a => (rmap[a.employeeId]?.qualifications||[]).includes("Scale"));
    const hasM = regs.some(a => (rmap[a.employeeId]?.qualifications||[]).includes("Medical"));
    if (!hasS) E(`NOSCALE ${day}/${shift.id}`);
    if (!hasM) E(`NOMED ${day}/${shift.id}`);
    // dupes
    const seen = new Set();
    for (const a of asgn) {
      if (seen.has(a.employeeId)) E(`DUPE ${rmap[a.employeeId]?.name} ${day}/${shift.id}`);
      seen.add(a.employeeId);
    }
  }

  const shiftCount = {}, weekendCount = {}, dayShifts = {};
  for (const day of DAYS) for (const shift of SHIFTS) {
    for (const a of (sched[cellKey(day, shift.id)] || [])) {
      const emp = rmap[a.employeeId];
      if (!emp) { E(`GHOST ${a.employeeId}`); continue; }
      if ((emp.unavailableDays||[]).includes(day)) E(`UNAVAIL ${emp.name} ${day}`);
      if ((emp.blockedShifts||[]).includes(shift.id)) E(`BLOCKED ${emp.name} ${shift.id}`);
      if (emp.requiredShift && emp.requiredShift !== shift.id) E(`REQSHIFT ${emp.name} on ${shift.id}`);
      if (timeOff && timeOff.has(emp.id + "__" + day)) E(`TIMEOFF ${emp.name} ${day}`);
      shiftCount[emp.id] = (shiftCount[emp.id]||0) + 1;
      if (["Saturday","Sunday"].includes(day)) weekendCount[emp.id] = (weekendCount[emp.id]||0)+1;
      (dayShifts[emp.id+"__"+day] = dayShifts[emp.id+"__"+day] || []).push(shift.id);
      // fatigue (hard rules the algorithm enforces internally)
      const gap = calcRestGap(emp.id, sched, day, shift.id, exts || [], patterns);
      if (isRestViolation(emp, gap, 12)) E(`REST ${emp.name} ${day}/${shift.id} gap=${gap}`);
      if (calcConsecutiveHours(emp.id, sched, day, shift.id, exts || []) > empMaxConsec(emp))
        E(`CONSEC_HRS ${emp.name} ${day}/${shift.id}`);
      if (shift.id === "third" && calcConsecutiveNights(emp.id, sched, day, shift.id) > 3)
        E(`NIGHTS ${emp.name} ${day}`);
    }
  }
  for (const emp of emps) {
    if (emp.maxShiftsPerWeek != null && (shiftCount[emp.id]||0) > emp.maxShiftsPerWeek)
      E(`MAXSHIFTS ${emp.name} ${shiftCount[emp.id]}>${emp.maxShiftsPerWeek}`);
    if (emp.maxWeekendDays != null && (weekendCount[emp.id]||0) > emp.maxWeekendDays)
      E(`MAXWKND ${emp.name}`);
  }
  for (const [dk, list] of Object.entries(dayShifts)) {
    if (list.length > 1) {
      const [empId] = dk.split("__");
      if (!rmap[empId]?.willing16h) E(`DOUBLE ${rmap[empId]?.name} ${dk.split("__")[1]}`);
    }
  }
  // consecutive days incl. cross-week tail
  for (const emp of emps) {
    const worked = DAYS.map(d => SHIFTS.some(s => (sched[cellKey(d,s.id)]||[]).some(a => a.employeeId === emp.id)));
    const tail = (patterns && patterns[emp.id]?.trailingDays) || 0;
    let streak = worked[0] ? tail + 1 : 0, max = streak;
    for (let i = 1; i < 7; i++) { streak = worked[i] ? streak + 1 : 0; max = Math.max(max, streak); }
    if (max > 5) E(`CONSEC_DAYS ${emp.name} ${max}`);
  }
  return errors;
}

function softMetrics(sched, emps) {
  const hours = {};
  for (const day of DAYS) for (const shift of SHIFTS)
    for (const a of (sched[cellKey(day, shift.id)] || []))
      hours[a.employeeId] = (hours[a.employeeId]||0) + SHIFT_HOURS;
  let ftUnder = 0, ftOT = 0, dayOffHits = 0, prefMiss = 0;
  for (const e of emps) {
    const h = hours[e.id] || 0;
    if (e.employmentType === "full-time") {
      if (h < FT_MIN_HOURS) ftUnder += FT_MIN_HOURS - h;
      if (h > FT_MIN_HOURS) ftOT += h - FT_MIN_HOURS;
    }
  }
  for (const day of DAYS) for (const shift of SHIFTS)
    for (const a of (sched[cellKey(day, shift.id)] || [])) {
      const e = emps.find(x => x.id === a.employeeId);
      if (!e) continue;
      if ((e.preferredDaysOff||[]).includes(day)) dayOffHits++;
      const prefs = e.preferredShifts || [];
      if (prefs.length && !prefs.includes(shift.id)) prefMiss++;
    }
  return { ftUnder, ftOT, dayOffHits, prefMiss };
}

// ── Runner ────────────────────────────────────────────────────────────────
const origLog = console.log;
function seedRandom(seed) {
  // mulberry32 — deterministic runs so before/after comparisons are apples-to-apples
  let a = seed >>> 0;
  Math.random = function() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function run(scenarioName, quiet = true, seed = 12345) {
  seedRandom(seed);
  const sc = SCENARIOS[scenarioName]();
  if (quiet) console.log = () => {};
  const t0 = process.hrtime.bigint();
  const result = buildAutoFill(sc.emps, {}, sc.timeOff, sc.patterns, sc.exts); result.ns = result.schedule;
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log = origLog;
  const errors = validate(result.ns, sc.emps, sc.timeOff, sc.patterns, sc.exts);
  const soft = softMetrics(result.ns, sc.emps);
  return { ms, errors, soft, result };
}

if (require.main === module) {
  const names = process.argv[2] ? [process.argv[2]] : Object.keys(SCENARIOS);
  for (const name of names) {
    const { ms, errors, soft } = run(name);
    const errSummary = {};
    errors.forEach(e => { const t = e.split(" ")[0]; errSummary[t] = (errSummary[t]||0)+1; });
    console.log(`\n=== ${name} === ${ms.toFixed(0)}ms`);
    console.log(`hard errors: ${errors.length}`, Object.keys(errSummary).length ? errSummary : "");
    if (errors.length) errors.slice(0, 12).forEach(e => console.log("  •", e));
    console.log(`soft: ftUnder=${soft.ftUnder}h ftOT=${soft.ftOT}h dayOffHits=${soft.dayOffHits} prefMiss=${soft.prefMiss}`);
  }
}
module.exports = { SCENARIOS, run, validate, softMetrics };
