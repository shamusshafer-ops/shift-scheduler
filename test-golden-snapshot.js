// test-golden-snapshot.js — byte-for-byte regression guard for scheduler output.
//
// Runs autofill, Step 0 ext deployment, gap/completion repair and policy
// validation over a fixed set of rosters and seeds, then compares every result
// to fixtures/golden-snapshot.json. Any difference in schedules, extended
// shifts, handoffs or reported issues fails the run.
//
//   node test-golden-snapshot.js          compare against the saved snapshot
//   node test-golden-snapshot.js --write  record a new snapshot
//
// Determinism: Math.random is seeded and Date.now is replaced by a clock that
// advances a fixed step per call, so time-bounded searches stop at the same
// point on every machine.
"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto");

const realNow = Date.now;
let clock = 0;
const STEP_MS = 0.05;
Date.now = () => Math.floor(clock += STEP_MS);
let seedState = 0;
Math.random = () => {
  seedState |= 0; seedState = (seedState + 0x6D2B79F5) | 0;
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const reset = seed => { clock = 1_700_000_000_000; seedState = seed >>> 0; };

const core = require("./load-core.js");
const { SCENARIOS } = require("./test-autofill-harness.js");
const {
  buildAutoFill, deployProactiveExtShifts, repairScheduleGaps, repairScheduleCompletion,
  validateAssignmentPolicy, validateCoverage, scheduleQuality, buildTimeOffAvailability, canonicalJSON,
} = core;

const SNAPSHOT = path.join(__dirname, "fixtures/golden-snapshot.json");
const clone = v => JSON.parse(JSON.stringify(v));
const hash = v => crypto.createHash("sha256").update(canonicalJSON(v)).digest("hex").slice(0, 16);
const quiet = fn => { const l = console.log, w = console.warn; console.log = console.warn = () => {}; try { return fn(); } finally { console.log = l; console.warn = w; } };
// Timing fields differ run to run even under the fake clock's rounding; drop them.
const stripTiming = v => JSON.parse(JSON.stringify(v ?? null, (k, x) => /elapsed|Ms$|ms$/.test(k) ? undefined : x));

const fx = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/autofill-real-roster-drafts.json"), "utf8"));
const backup = JSON.parse(fs.readFileSync(path.join(__dirname, "roster-backup-current.json"), "utf8")).data;
const WEEK = "2026-09-06";

function withAvailabilityVariants(roster) {
  // Exercises recurring unavailable hours and partial/whole-shift leave, the
  // paths a per-day shift availability grid would plug into.
  const emps = clone(roster);
  const ids = emps.filter(e => !e.inTraining).map(e => e.id);
  emps.find(e => e.id === ids[1]).unavailableWindows = [{ day: "Tuesday", startTime: "22:00", endTime: "06:00", endNextDay: true }];
  emps.find(e => e.id === ids[4]).unavailableWindows = [{ day: "Saturday", startTime: "10:00", endTime: "16:00", endNextDay: false }];
  const requests = [
    { id: "g1", empId: ids[2], type: "partial", timeMode: "range", startDate: "2026-09-09", endDate: "2026-09-09", startTime: "13:00", endTime: "17:00", status: "approved" },
    { id: "g2", empId: ids[6], type: "partial", shiftId: "third", startDate: "2026-09-10", endDate: "2026-09-10", status: "approved" },
    { id: "g3", empId: ids[8], type: "single_day", timeMode: "range", startDate: "2026-09-11", endDate: "2026-09-11", startTime: "00:00", endTime: "23:59", status: "approved" },
  ];
  return { emps, timeOff: buildTimeOffAvailability(requests, WEEK) };
}

function autofillCase(emps, cfg, timeOff, patterns, seed) {
  reset(seed);
  return quiet(() => {
    const exts = [];
    for (const ext of deployProactiveExtShifts(emps, cfg, timeOff, [])) exts.push(ext);
    const r = buildAutoFill(emps, cfg, timeOff, patterns, clone(exts), false, { roster: emps });
    const opts = { extShifts: exts, handoffs: [], empTimeOffDays: timeOff, empPatterns: patterns || {} };
    const issues = [...validateCoverage(r.schedule, emps, exts, []), ...validateAssignmentPolicy(r.schedule, emps, cfg, opts)];
    return {
      schedule: r.schedule, step0Exts: exts, shiftsWorked: r.shiftsWorked, policyRejected: r.policyRejected,
      searchInfo: stripTiming(r.searchInfo), issues: issues.map(i => [i.type, i.level, i.msg || i.message]).sort(),
      quality: scheduleQuality({ ns: r.schedule, autoExtShifts: exts, handoffs: [] }, emps, cfg, opts),
    };
  });
}

function repairCases() {
  const roster = fx.roster, cfg = fx.cfg;
  const context = () => ({ source: roster, accountingRoster: roster, cfg, ptoHoursByEmployee: {}, enrichedPatterns: fx.enrichedPatterns,
    validateSchedule: (s, x, e, h = []) => [...validateCoverage(s, roster, x, h).filter(i => i.type !== "overstaffed"),
      ...validateAssignmentPolicy(s, roster, cfg, { extShifts: x, handoffs: h, ptoHoursByEmployee: {}, empPatterns: fx.enrichedPatterns })] });
  const draft = d => ({ ...clone(d), usedPatterns: {}, assignLog: {}, issues: [], hourTracker: {} });
  const pick = r => ({ ns: r.ns, autoExtShifts: r.autoExtShifts, handoffs: r.handoffs, info: stripTiming(r.repairInfo) });
  const out = {};
  reset(7); out["repair/completion"] = quiet(() => pick(repairScheduleCompletion(draft(fx.completionDraft), context())));
  reset(7); out["repair/gaps"] = quiet(() => {
    const d = draft(fx.gapRepairInput), ctx = context();
    d.issues = ctx.validateSchedule(d.ns, d.autoExtShifts, roster, d.handoffs);
    const r = repairScheduleGaps(d, ctx);
    return pick({ ...d, ...r, autoExtShifts: r.autoExtShifts || d.autoExtShifts, handoffs: r.handoffs || d.handoffs });
  });
  return out;
}

function buildAll() {
  const results = {};
  const seeds = [12345, 777, 2026];
  for (const name of Object.keys(SCENARIOS)) for (const seed of seeds) {
    const sc = SCENARIOS[name]();
    results[`harness/${name}/${seed}`] = autofillCase(sc.emps, {}, sc.timeOff, sc.patterns || {}, seed);
  }
  for (const seed of seeds) {
    results[`real-roster/${seed}`] = autofillCase(clone(fx.roster), fx.cfg, new Set(), fx.enrichedPatterns, seed);
    const v = withAvailabilityVariants(fx.roster);
    results[`real-roster-availability/${seed}`] = autofillCase(v.emps, fx.cfg, v.timeOff, fx.enrichedPatterns, seed);
    // Without the only dual-qualified second-shift employee, Step 0 deploys 12h shifts.
    results[`real-roster-step0/${seed}`] = autofillCase(clone(fx.roster).filter(e => e.id !== "psi-5"), fx.cfg, new Set(), fx.enrichedPatterns, seed);
  }
  for (const seed of seeds.slice(0, 2))
    results[`backup-roster/${seed}`] = autofillCase(clone(backup.shift_employees), backup.shift_settings, new Set(), {}, seed);
  Object.assign(results, repairCases());
  return results;
}

const t0 = realNow();
const results = buildAll();
const summary = Object.fromEntries(Object.entries(results).map(([k, v]) => [k, hash(v)]));
const secs = ((realNow() - t0) / 1000).toFixed(1);

if (process.argv.includes("--write")) {
  fs.writeFileSync(SNAPSHOT, JSON.stringify({ recordedAt: new Date(realNow()).toISOString(), summary, results }, null, 1) + "\n");
  console.log(`Recorded ${Object.keys(summary).length} cases to ${path.relative(__dirname, SNAPSHOT)} in ${secs}s`);
} else {
  const saved = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
  const keys = [...new Set([...Object.keys(saved.summary), ...Object.keys(summary)])];
  const diffs = keys.filter(k => saved.summary[k] !== summary[k]);
  for (const k of diffs) {
    const parts = Object.keys({ ...saved.results[k], ...results[k] })
      .filter(p => canonicalJSON(saved.results[k]?.[p] ?? null) !== canonicalJSON(results[k]?.[p] ?? null));
    console.log(`DIFF ${k}: ${parts.join(", ") || "(case missing)"}`);
  }
  console.log(`${keys.length - diffs.length}/${keys.length} cases identical (${secs}s)`);
  process.exitCode = diffs.length ? 1 : 0;
}
