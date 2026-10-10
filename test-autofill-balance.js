'use strict';
// Autofill step 1 (2026-10-10): week-only consecutive-day/night preferences,
// doubles and overtime spread in the ranking, overtime rebalance, Step 0 pairs
// that cover the whole short shift.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const core = require('./load-core');
const {cellKey, DAYS, employeePolicyIssues, stretchIssues, scheduleQuality, QUALITY, rebalanceOvertime, weeklyEmployeeHours,
  validateAssignmentPolicy, deployProactiveExtShifts, extendedWorkIntervals, shiftInterval, buildTimeOffAvailability, boundaryPatterns} = core;
const E = (id, quals = ['Guard'], extra = {}) => ({id, name:id, employmentType:'full-time', qualifications:quals, unavailableDays:[], blockedShifts:[],
  preferredShifts:[], preferredDaysOff:[], requiredShift:null, maxShiftsPerWeek:null, overtimePref:'neutral', ...extra});
const on = (days, sid, id, position = 'Guard') => Object.fromEntries(days.map(d => [cellKey(d, sid), [{employeeId:id, position}]]));
const merge = (...parts) => { const out = {}; for (const p of parts) for (const [k, a] of Object.entries(p)) out[k] = [...(out[k] || []), ...a]; return out; };
const quiet = run => { const l = console.log, w = console.warn; console.log = console.warn = () => {}; try { return run(); } finally { console.log = l; console.warn = w; } };

test('a 7-day week is a preference warning, not a hard rule, and is counted within the week only', () => {
  const g = E('g'), week = on(DAYS, 'first', 'g'), cfg = {maxConsecutiveShifts:6, maxConsecutiveNights:6, minRestHours:8};
  assert(!employeePolicyIssues(g, week, cfg).some(i => i.type === 'consecutive_days'));
  assert.deepEqual(stretchIssues(g, week, cfg).map(i => [i.type, i.level]), [['consecutive_days', 'warn']]);
  // Autofill's own planning keeps to the preference.
  assert(employeePolicyIssues(g, week, cfg, {strictStretches:true}).some(i => i.type === 'consecutive_days'));
  // Six days this week after six days last week: fine (the run restarts on Sunday).
  const history = [{weekStart:'2026-10-04', schedule:on(DAYS.slice(1), 'first', 'g')}];
  const p = boundaryPatterns(history, '2026-10-11', {});
  const six = on(DAYS.slice(0, 6), 'first', 'g');
  assert.deepEqual(employeePolicyIssues(g, six, cfg, {empPatterns:p, strictStretches:true}).filter(i => i.type === 'consecutive_days'), []);
  assert.deepEqual(stretchIssues(g, six, cfg), []);
});

test('with total overtime equal, a week without a double ranks better, then the more even spread', () => {
  const a = E('a', ['Guard'], {willing16h:true}), b = E('b');
  const roster = [a, b], cfg = {minRestHours:8};
  // a: 48h with a Monday 1+2 double; b: 40h.
  const withDouble = merge(on(['Monday','Tuesday','Wednesday','Thursday','Friday'], 'first', 'a'), on(['Monday'], 'second', 'a'),
    on(['Monday','Tuesday','Wednesday','Thursday','Friday'], 'second', 'b'));
  // Same hours, the extra 8h on a separate day.
  const noDouble = merge(on(['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'], 'first', 'a'),
    on(['Monday','Tuesday','Wednesday','Thursday','Friday'], 'second', 'b'));
  const q = s => scheduleQuality({ns:s, autoExtShifts:[], handoffs:[]}, roster, cfg, {skipPolicy:true});
  assert.equal(q(withDouble)[QUALITY.overtime], q(noDouble)[QUALITY.overtime]);
  assert.equal(q(withDouble)[QUALITY.doubles], 1);
  assert(core.compareScheduleQuality(q(noDouble), q(withDouble)) < 0);
  // 56h + 40h ranks below 48h + 48h.
  const piled = merge(on(DAYS, 'first', 'a'), on(DAYS.slice(1, 6), 'second', 'b'));
  const even = merge(on(DAYS.slice(0, 6), 'first', 'a'), on(DAYS.slice(1, 6), 'second', 'b'), on(['Saturday'], 'second', 'b'));
  assert.equal(q(piled)[QUALITY.overtime], q(even)[QUALITY.overtime]);
  assert(q(even)[QUALITY.spread] < q(piled)[QUALITY.spread]);
});

test('rebalance moves duties off the person carrying the overtime without adding any', () => {
  const a = E('a'), b = E('b'), roster = [a, b], cfg = {minRestHours:8, maxConsecutiveShifts:6, maxConsecutiveNights:6};
  const ns = merge(on(DAYS, 'first', 'a'), on(['Monday','Tuesday','Wednesday','Thursday'], 'second', 'b'));
  const context = {source:roster, accountingRoster:roster, cfg, ptoHoursByEmployee:{}, enrichedPatterns:{}};
  const out = rebalanceOvertime({ns, autoExtShifts:[], handoffs:[], assignLog:{}}, context);
  const h = (e, s) => weeklyEmployeeHours(e, s, [], [], {}).creditedHours;
  assert.equal(h(a, ns), 56); assert.equal(h(b, ns), 32);
  assert(out.rebalanceInfo.moves > 0);
  assert(h(a, out.ns) <= 48 && h(b, out.ns) >= 40, `a ${h(a, out.ns)} b ${h(b, out.ns)}`);
  assert.equal(h(a, out.ns) + h(b, out.ns), 88, 'same duties, only moved');
  assert.deepEqual(validateAssignmentPolicy(out.ns, roster, cfg, {}), []);
  for (const key of Object.keys(ns)) assert.equal(out.ns[key].length, ns[key].length, key + ' keeps its headcount');
});

test('rebalance breaks a double by handing one half to someone free that day', () => {
  const a = E('a', ['Guard'], {willing16h:true}), b = E('b'), c = E('c'), roster = [a, b, c], cfg = {minRestHours:8, maxConsecutiveShifts:6};
  const ns = merge(on(['Monday','Tuesday','Wednesday','Thursday','Friday'], 'first', 'a'), on(['Monday'], 'second', 'a'),
    on(['Tuesday','Wednesday','Thursday','Friday','Saturday'], 'second', 'b'), on(['Tuesday','Wednesday','Thursday','Friday','Saturday'], 'third', 'c'));
  const out = rebalanceOvertime({ns, autoExtShifts:[], handoffs:[], assignLog:{}}, {source:roster, accountingRoster:roster, cfg, ptoHoursByEmployee:{}, enrichedPatterns:{}});
  const spans = core.collectCoverageIntervals(out.ns, [], []);
  assert.equal(core.doubleShiftCount(spans), 0, JSON.stringify(out.ns));
  for (const key of Object.keys(ns)) assert.equal(out.ns[key].length, ns[key].length, key + ' keeps its headcount');
});

test('Step 0 never leaves the only second-shift Scale on half a shift with a partner who lacks Scale', () => {
  const fx = JSON.parse(fs.readFileSync(__dirname + '/fixtures/roster-2026-09-27.json', 'utf8'));
  const roster = fx.employees.map(e => ({unavailableDays:[], blockedShifts:[], preferredShifts:[], preferredDaysOff:[], requiredShift:null, maxShiftsPerWeek:null, ...e}));
  const byId = new Map(roster.map(e => [e.id, e]));
  const exts = quiet(() => deployProactiveExtShifts(roster, fx.settings, buildTimeOffAvailability([], '2026-10-11'), []));
  for (const ext of exts) {
    const second = shiftInterval(ext.day, 'second');
    const halves = extendedWorkIntervals(ext).filter(i => i.start < second.end && second.start < i.end);
    if (halves.length !== 2) continue;
    const scale = halves.map(i => (byId.get(i.employeeId).qualifications || []).includes('Scale'));
    assert(!(scale[0] !== scale[1] && halves.some(i => i.employeeId === 'psi-8')),
      `${ext.day} ${ext.pairId}: Cameron covers only part of second shift and the partner has no Scale`);
  }
});
