'use strict';
// tools/roster-interventions.js — what would make a roster's week coverable?
// For each hypothetical change (and selected pairs), solve the week exactly with
// tools/feasibility_cpsat.py (uncovered role hours, supervisor 12h days,
// seven-day weeks, total overtime, max individual overtime, in that order),
// rebuild the solver's week in the app and validate it independently.
//   node tools/roster-interventions.js fixtures/roster-2026-09-27.json [--seconds 120] > report.json
// Requires Python 3 with OR-Tools (pip install ortools). Analysis only.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const fixture = process.argv[2], seconds = process.argv.includes('--seconds') ? process.argv[process.argv.indexOf('--seconds') + 1] : '120';
const roster = JSON.parse(fs.readFileSync(fixture, 'utf8')).employees, byName = n => roster.find(e => e.name === n);
const tmp = fs.mkdtempSync('/tmp/interventions-');
const solve = (label, changes) => {
  const ch = path.join(tmp, 'changes.json'); fs.writeFileSync(ch, JSON.stringify(changes));
  const model = path.join(tmp, 'model.json'), sol = path.join(tmp, 'sol.json');
  fs.writeFileSync(model, execFileSync('node', [path.join(__dirname, 'export-duty-model.js'), fixture, '--changes', ch], { maxBuffer: 1 << 28 }));
  fs.writeFileSync(sol, execFileSync('python3', [path.join(__dirname, 'feasibility_cpsat.py'), model, '--seconds', seconds, '--min-gap'], { maxBuffer: 1 << 28 }));
  const s = JSON.parse(fs.readFileSync(sol, 'utf8'));
  const check = JSON.parse(execFileSync('node', [path.join(__dirname, 'export-duty-model.js'), fixture, '--changes', ch, '--check', sol]).toString());
  const v = k => s.stages.find(x => x.objective === k);
  const row = { label, changes, status: s.status, provenOptimal: s.stages.every(x => x.status === 'OPTIMAL'),
    uncoveredRoleHours: v('uncovered role hours')?.value, supervisorExtensions: v('supervisor 12-hour days')?.value, sevenDayWeeks: v('seven-day weeks')?.value,
    totalOvertime: v('total overtime')?.value, maxOvertime: v('max individual overtime')?.value, validated: check.valid,
    nonCoverageErrors: (check.errors || []).filter(e => !/^(role|coverage)/.test(e)), hours: s.hours };
  process.stderr.write(`${label}: gaps ${row.uncoveredRoleHours} OT ${row.totalOvertime} max ${row.maxOvertime} ${row.provenOptimal ? 'proven' : s.status} ${check.valid ? 'validated' : 'validator: ' + (check.errors || []).length + ' errors'}\n`);
  return row;
};
const crossTrain = (name, q) => ({ id: byName(name).id, set: { qualifications: [...new Set([...byName(name).qualifications, q])] } });
const scaleTrainees = roster.filter(e => !e.qualifications.includes('Scale') && e.employmentType === 'full-time').map(e => e.name);
const rows = [solve('Current roster', [])];
for (const n of scaleTrainees) rows.push(solve(`Cross-train ${n} for Scale`, [crossTrain(n, 'Scale')]));
rows.push(solve('Second Supervisor: cross-train J Parks', [crossTrain('J Parks', 'Supervisor')]));
for (const n of ['L Hillenburg', 'D Pete']) rows.push(solve(`${n} may also work first shift`, [{ id: byName(n).id, set: { requiredShift: null } }]));
rows.push(solve('H Cameron may work first shift', [{ id: byName('H Cameron').id, set: { blockedShifts: [] } }]));
rows.push(solve('Hire one full-time Scale/Guard (no restrictions)', [{ add: { id: 'new-scale', name: 'New Scale hire', employmentType: 'full-time', qualifications: ['Scale', 'Guard'], overtimePref: 'neutral' } }]));
rows.push(solve('Hire one part-time Scale/Guard, weekday first shift only (5 shifts)', [{ add: { id: 'new-pt', name: 'New PT Scale', employmentType: 'part-time', qualifications: ['Scale', 'Guard'],
  overtimePref: 'blocked', requiredShift: 'first', availableDaysOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], maxShiftsPerWeek: 5 } }]));
process.stdout.write(JSON.stringify({ fixture, recordedAt: new Date().toISOString(), seconds: +seconds, rows }, null, 1));
