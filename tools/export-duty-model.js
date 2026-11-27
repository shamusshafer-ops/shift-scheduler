'use strict';
// tools/export-duty-model.js — export one week's exact coverage problem, in the
// app's own terms, for an independent solver (tools/feasibility_cpsat.py).
//
// The model is the complete search's duty menu (every legal single duty per
// employee, from searchCandidates) plus every pair of one employee's duties
// that the app's own rule checker rejects together (overlap, short rest,
// same-day split blocks, continuous-work caps, ...). Coverage is exact per
// hour: three regular staff, a separate Supervisor on weekday first shift,
// Scale and Medical every hour (except proven structural gaps if asked).
// Chains of three adjacent duties breaking the continuous-work cap are in the
// model too. Other rules spanning three or more duties are not, so it is a
// relaxation: "infeasible" proves no valid week exists in this duty menu;
// a "feasible" answer is checked by the app's validator (--check) before it
// counts as proof.
//
//   node tools/export-duty-model.js fixtures/roster-2026-09-27.json [--changes changes.json] [--waive-structural] > model.json
//   python3 tools/feasibility_cpsat.py model.json > solution.json
//   node tools/export-duty-model.js fixtures/roster-2026-09-27.json [--changes ...] --check solution.json
const fs = require('fs'), path = require('path');
const c = require(path.join(__dirname, '..', 'load-core'));
const argv = process.argv.slice(2), arg = n => { const i = argv.indexOf('--' + n); return i < 0 ? null : argv[i + 1]; };
const fixture = JSON.parse(fs.readFileSync(argv[0], 'utf8'));
let employees = (fixture.employees || []).map(e => ({ unavailableDays: [], blockedShifts: [], preferredShifts: [], preferredDaysOff: [], requiredShift: null,
  maxShiftsPerWeek: null, swingEligible: [], ...e }));
const cfg = { maxConsecutiveShifts: 6, maxConsecutiveNights: 6, minRestHours: 8, ...(fixture.settings || fixture.cfg || {}) };
// --changes: [{ id, set: {field: value} } | { add: employee }] — hypothetical roster changes.
if (arg('changes')) for (const ch of JSON.parse(fs.readFileSync(arg('changes'), 'utf8'))) {
  if (ch.add) employees.push({ unavailableDays: [], blockedShifts: [], preferredShifts: [], preferredDaysOff: [], requiredShift: null, maxShiftsPerWeek: null, swingEligible: [], ...ch.add });
  else employees = employees.map(e => e.id === ch.id ? { ...e, ...ch.set } : e);
}
const weekStart = arg('week') || '2026-10-11';
const input = { weekStart, employees, cfg, timeOffReqs: fixture.timeOffReqs || [] };
const availability = c.buildTimeOffAvailability(input.timeOffReqs, weekStart, null);
const pto = c.buildPtoCredits(employees, input.timeOffReqs, weekStart).hoursByEmployee;
const basic = { empTimeOffDays: availability, ptoHoursByEmployee: pto, empPatterns: {} };
const candidates = c.searchCandidates(employees, new Set(), cfg, basic, availability, {});
const byId = new Map(employees.map(e => [e.id, e]));
const empty = { ns: {}, autoExtShifts: [], handoffs: [] };
const weekOf = list => list.reduce((s, cand) => s && c.completeSearchApply(s, cand), empty);

if (arg('check')) {
  const sol = JSON.parse(fs.readFileSync(arg('check'), 'utf8'));
  if (sol.status !== 'FEASIBLE' && sol.status !== 'OPTIMAL') { console.log(JSON.stringify({ checked: false, status: sol.status })); process.exit(0); }
  const week = weekOf(sol.chosen.map(i => candidates[i]));
  if (!week) { console.log(JSON.stringify({ checked: true, valid: false, reason: 'chosen duties overlap' })); process.exit(0); }
  const issues = [...c.validateCoverage(week.ns, employees, week.autoExtShifts, week.handoffs), ...c.validateAssignmentPolicy(week.ns, employees, cfg,
    { extShifts: week.autoExtShifts, handoffs: week.handoffs, empTimeOffDays: availability, ptoHoursByEmployee: pto })].filter(i => i.level === 'error');
  const q = c.scheduleQuality(week, employees, cfg, { empTimeOffDays: availability, ptoHoursByEmployee: pto });
  const hours = Object.fromEntries(employees.map(e => [e.name, c.weeklyEmployeeHours(e, week.ns, week.autoExtShifts, week.handoffs, pto).workedHours]));
  if (arg('out')) fs.writeFileSync(arg('out'), JSON.stringify(week));
  console.log(JSON.stringify({ checked: true, valid: issues.length === 0, errors: issues.map(i => i.type + ': ' + i.msg), quality: q, hours }, null, 1));
  process.exit(0);
}

const conflicts = [];
for (let i = 0; i < candidates.length; i++) for (let j = i + 1; j < candidates.length; j++) {
  const a = candidates[i], b = candidates[j];
  if (a.employeeId !== b.employeeId) continue;
  // Two variants of the same base duty (with different handoffs) are one duty.
  const sameBase = a.base.source === b.base.source && a.base.start === b.base.start && a.base.end === b.base.end;
  const w = !sameBase && weekOf([a, b]);
  if (!w || c.completeSearchHardIssues(byId.get(a.employeeId), w, cfg, basic).length) conflicts.push([i, j]);
}
// Chains of three duties (e.g. 8h + 8h + 8h back to back) can break the
// continuous-work cap even when every pair is legal: forbid those triples.
const conflictSet = new Set(conflicts.map(([i, j]) => i + ',' + j));
const triples = [];
const touches = (x, y) => x.spans.some(p => y.spans.some(q => p.end >= q.start && q.end >= p.start));
for (let i = 0; i < candidates.length; i++) for (let j = i + 1; j < candidates.length; j++) {
  const a = candidates[i], b = candidates[j];
  if (a.employeeId !== b.employeeId || conflictSet.has(i + ',' + j) || !touches(a, b)) continue;
  for (let k = j + 1; k < candidates.length; k++) {
    const d = candidates[k];
    if (d.employeeId !== a.employeeId || conflictSet.has(i + ',' + k) || conflictSet.has(j + ',' + k) || !(touches(a, d) || touches(b, d))) continue;
    const w = weekOf([a, b, d]);
    if (!w || c.completeSearchHardIssues(byId.get(a.employeeId), w, cfg, basic).length) triples.push([i, j, k]);
  }
}
let structural = [];
if (argv.includes('--waive-structural')) {
  const cap = c.coverageCapability(input, { candidates });
  structural = cap.shortages.flatMap(s => s.missing.filter(m => ['Scale', 'Medical', 'Supervisor'].includes(m)).map(role => ({ day: s.day, shiftId: s.shiftId, role, start: s.start, end: s.end })));
}
const supHours = [], slotOfHour = [];
for (const day of c.DAYS) for (const s of c.SHIFTS) { const i = c.shiftInterval(day, s.id); for (let h = i.start; h < i.end; h++) { slotOfHour[h] = { day, shiftId: s.id }; if (c.SUP_SLOT_DAY(day, s.id)) supHours.push(h); } }
const out = {
  weekStart, cfg, structural,
  employees: employees.map(e => ({ id: e.id, name: e.name, type: e.employmentType, quals: e.qualifications || [], ot: c.effectiveOvertimePref(e, cfg),
    maxShifts: e.maxShiftsPerWeek ?? null, pto: pto[e.id] || 0, inTraining: !!e.inTraining })),
  candidates: candidates.map((cand, i) => {
    const spans = cand.spans.filter(s => !s.carryIn).map(s => ({ start: s.start, end: s.end, position: s.position }));
    let hours = 0, end = -Infinity; for (const s of [...spans].sort((x, y) => x.start - y.start)) { hours += Math.max(0, s.end - Math.max(end, s.start)); end = Math.max(end, s.end); }
    const days = [...new Set(spans.map(x => Math.floor(x.start / 24)).filter(d => d >= 0 && d < 7))];
    return { i, emp: cand.employeeId, hours, day: Math.floor(cand.base.start / 24), days, supExt: c.supervisorExtensions([byId.get(cand.employeeId)], cand.handoffs || []) > 0, spans, label: `${byId.get(cand.employeeId).name} ${cand.base.source} ${cand.base.start}-${cand.base.end}` +
      (cand.handoffs || []).map(h => ` +${h.type} ${h.targetShiftId}`).join('') };
  }),
  conflicts, triples, supHours, hours: Object.keys(slotOfHour).map(Number).sort((a, b) => a - b), regularPerHour: 3,
};
process.stdout.write(JSON.stringify(out));
