'use strict';
// Autofill step 3 (2026-10-10): one-time asks ("What would fix this?") applied
// as locked duties with a waiver, and staffing insights.
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('./load-core');
const {cellKey, employeePolicyIssues, validateAssignmentPolicy, analyzeShiftCoverage, buildTimeOffAvailability,
  findFixSuggestionsSteps, staffingInsightsSteps} = core;
const E = (id, quals = ['Guard'], extra = {}) => ({id, name:id, employmentType:'part-time', qualifications:quals, unavailableDays:[], blockedShifts:[],
  preferredShifts:[], preferredDaysOff:[], requiredShift:null, maxShiftsPerWeek:null, overtimePref:'neutral', swingEligible:[], ...extra});
const row = (id, position = 'Guard', extra = {}) => ({employeeId:id, position, ...extra});
const types = (emp, ns, options = {}) => employeePolicyIssues(emp, ns, {minRestHours:8}, options).map(i => i.type);
const run = steps => { const l = console.log, w = console.warn; console.log = console.warn = () => {}; try { let s; while (!(s = steps.next()).done); return s.value; } finally { console.log = l; console.warn = w; } };
const cfg = {minRestHours:8, maxConsecutiveShifts:6, maxConsecutiveNights:6};

test('a waiver bends only the rules it names, only on its own duty', () => {
  const n = E('n', ['Guard','Scale'], {requiredShift:'third'});
  const waived = row('n', 'Scale', {locked:true, waiver:{rules:['required_shift'], note:'One-time ask'}});
  assert(!types(n, {[cellKey('Monday','first')]:[waived]}).includes('required_shift'));
  // The same person's other off-shift duty is still flagged.
  assert(types(n, {[cellKey('Monday','first')]:[waived], [cellKey('Wednesday','first')]:[row('n')]}).includes('required_shift'));
  // A waiver cannot name a rule outside the waivable list.
  assert(types(n, {[cellKey('Monday','first')]:[row('n', 'Medical', {waiver:{rules:['qualification','required_shift']}})]}).includes('qualification'));
});

test('a waiver never covers approved leave, and a waived double still stops at 16h', () => {
  const g = E('g', ['Guard'], {unavailableDays:['Saturday']});
  const ask = row('g', 'Guard', {locked:true, waiver:{rules:['availability']}});
  assert(!types(g, {[cellKey('Saturday','first')]:[ask]}).includes('availability'), 'usual unavailability is waived');
  const leave = buildTimeOffAvailability([{id:'r1', empId:'g', type:'vacation', status:'approved', startDate:'2026-10-17', endDate:'2026-10-17'}], '2026-10-11');
  assert(types(g, {[cellKey('Saturday','first')]:[ask]}, {empTimeOffDays:leave}).includes('availability'), 'approved leave is not');
  const d = E('d');
  const doubleAsk = row('d', 'Guard', {locked:true, waiver:{rules:['continuous_hours']}});
  assert(!types(d, {[cellKey('Monday','first')]:[row('d')], [cellKey('Monday','second')]:[doubleAsk]}).includes('continuous_hours'));
  assert(types(d, {[cellKey('Monday','first')]:[row('d')], [cellKey('Monday','second')]:[doubleAsk], [cellKey('Monday','third')]:[row('d', 'Guard', {waiver:{rules:['continuous_hours']}})]})
    .includes('continuous_hours'), '24h is never allowed');
});

// A fully staffed week with one gap: Monday first has no Scale. Each shift has
// a team of four rotating (about 40h each; second and third teams keep to their
// shift) and a supervisor holds the weekday
// seat; first shift's team is off on Mondays, covered by three guards who only
// work Mondays. `night`
// (required third shift) and `away` (usually off Monday) also hold Scale.
const scenario = (extra = {}) => {
  const night = E('night', ['Guard','Scale'], {requiredShift:'third', ...extra.night});
  const away = E('away', ['Guard','Scale'], {unavailableDays:['Monday'], ...extra.away});
  const team = (prefix, extra = {}) => [0, 1, 2, 3].map(n => E(prefix + n, ['Guard','Scale','Medical'], extra));
  const a = team('a', {unavailableDays:['Monday']}), b = team('b', {requiredShift:'second'}), c = team('c', {requiredShift:'third'});
  const g = [E('g1', ['Guard','Medical'], {availableDaysOfWeek:['Monday']}), E('g2', ['Guard'], {availableDaysOfWeek:['Monday']}),
    E('g3', ['Guard'], {availableDaysOfWeek:['Monday']})];
  const sup = E('sup', ['Supervisor'], {employmentType:'full-time'});
  const roster = [night, away, ...a, ...b, ...c, ...g, sup];
  const on = (members, d) => members.filter((_, i) => d % 4 !== i).map((e, i) => row(e.id, ['Medical','Scale','Guard'][i]));
  const ns = {};
  core.DAYS.forEach((day, d) => {
    ns[cellKey(day, 'first')] = day === 'Monday' ? g.map((e, i) => row(e.id, i ? 'Guard' : 'Medical')) : on(a, d);
    if (core.isWeekday(day)) ns[cellKey(day, 'first')].push(row('sup', 'Supervisor'));
    ns[cellKey(day, 'second')] = on(b, d);
    ns[cellKey(day, 'third')] = on(c, d);
  });
  return {roster, ns};
};
const context = (roster, timeOff = buildTimeOffAvailability([], '2026-10-11')) => ({source:roster, accountingRoster:roster, cfg, empTimeOffDays:timeOff,
  ptoHoursByEmployee:{}, enrichedPatterns:{}, fairnessHistory:{}, suggestionMs:60000});

test('one-time asks close a gap: off the required shift once, or on a usually unavailable day', () => {
  const {roster, ns} = scenario();
  const out = run(findFixSuggestionsSteps({ns, autoExtShifts:[], handoffs:[]}, context(roster)));
  const monday = out.suggestions.filter(s => s.gapKey === cellKey('Monday','first'));
  const byName = n => monday.find(s => s.employeeId === n);
  assert(byName('night'), JSON.stringify(monday.map(s => s.text)));
  assert(byName('night').rules.includes('required_shift'), JSON.stringify(byName('night').rules));
  assert(byName('night').warnings.includes('night worker switching to a day shift'));
  assert(byName('away') && byName('away').rules.includes('availability'));
  for (const s of [byName('night'), byName('away')]) {
    const w = s.week, c = analyzeShiftCoverage('Monday', 'first', w.ns, roster, w.autoExtShifts, w.handoffs);
    assert(!c.missing.includes('Scale'), s.text);
    const asked = w.ns[cellKey('Monday','first')].find(v => v.employeeId === s.employeeId);
    assert(asked.locked && asked.waiver.note.startsWith('One-time ask'), JSON.stringify(asked));
    assert.equal(w.ns[cellKey('Monday','first')].length, 4, 'headcount kept: the ask replaces a guard');
    assert.deepEqual(validateAssignmentPolicy(w.ns, roster, cfg, {extShifts:w.autoExtShifts, handoffs:w.handoffs}).filter(i => i.employeeId === s.employeeId), []);
  }
});

test('nobody is asked to work through approved leave', () => {
  const {roster, ns} = scenario({night:{blockedShifts:['first','second']}});
  const leave = buildTimeOffAvailability([{id:'r1', empId:'away', type:'vacation', status:'approved', startDate:'2026-10-12', endDate:'2026-10-12'}], '2026-10-11');
  const out = run(findFixSuggestionsSteps({ns, autoExtShifts:[], handoffs:[]}, context(roster, leave)));
  assert(!out.suggestions.some(s => s.employeeId === 'away' && s.gapKey === cellKey('Monday','first')));
});

test('staffing insights name the cross-training that removes a gap', () => {
  // Nobody holds Scale: every shift misses it. Training g1 in Scale removes gap hours.
  const roster = [E('g1', ['Guard','Medical'], {employmentType:'full-time'}), E('g2', ['Guard','Medical'], {employmentType:'full-time'}),
    E('g3', ['Guard','Medical'], {employmentType:'full-time'})];
  const out = run(staffingInsightsSteps({...context(roster), insightMs:120000}));
  const train = out.insights.find(x => x.label === 'Cross-train g1 in Scale');
  assert(train && train.gapDelta < 0, JSON.stringify(out.insights.slice(0, 4)));
  assert(out.insights[0].gapDelta <= train.gapDelta, 'best change first');
});
