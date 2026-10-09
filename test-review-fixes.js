'use strict';
// Regression tests for the 2026-10 program review, batch 1: availability
// regressions, data-loss paths, the violation-fix coverage guard and the
// swing-shaped extension rule.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const core = require('./load-core');
const html = fs.readFileSync(__dirname + '/ShiftScheduler_latest loop.html', 'utf8');
const extract = (start, end) => { const a = html.indexOf(start), b = html.indexOf(end, a); assert(a >= 0 && b > a, 'extract ' + start); return html.slice(a, b); };
const evaluate = (body, scope = {}) => { const all = {...core, ...scope}; return new Function(...Object.keys(all), body)(...Object.values(all)); };
const {DAYS, cellKey} = core;
const week = '2026-10-04';
const emp = (extra = {}) => ({id:'e', name:'E', qualifications:['Guard','Medical'], employmentType:'full-time',
  unavailableDays:[], blockedShifts:[], preferredShifts:[], preferredDaysOff:[], requiredShift:null, ...extra});

test('a required-shift exception survives being marked on most days of the week', () => {
  const pete = emp({requiredShift:'third', preferredShifts:['third']});
  for (const n of [3, 4, 7]) {
    const g = core.composeAvailabilityGrid(pete);
    DAYS.slice(0, n).forEach(d => { g[d].second = 'prefer'; });
    const saved = {...pete, ...core.decomposeAvailabilityGrid(g, pete)};
    assert.deepEqual(saved.preferredShifts, ['third'], n + ' days: never folded into the weekly list');
    for (const d of DAYS.slice(0, n)) assert.equal(core.canWorkShiftOnDay(saved, d, 'second', null), true, n + ' days: ' + d);
    assert.deepEqual(core.composeAvailabilityGrid(saved), g, n + ' days: grid unchanged');
  }
  const flexible = emp({requiredShift:'third', canWorkOtherShifts:true});
  const g = core.composeAvailabilityGrid(flexible);
  DAYS.forEach(d => { g[d].second = 'prefer'; });
  assert(core.decomposeAvailabilityGrid(g, flexible).preferredShifts.includes('second'), 'cross-shift staff keep the weekly list');
});

test('overtime approvals stamp the same snapshot that publication checks', () => {
  const body = extract('const snapshotFor=p=>publicationSnapshot({', '});');
  assert(body.includes('weekAvailability'));
});

test('week overrides are pruned against today, not the week being viewed', () => {
  const effect = extract('// Pruned against today\'s week', '}, [weekAvailLoaded]);');
  assert(effect.includes('new Date()') && !/pruneWeekAvailability\(weekAvailabilityStore, weekStart\)/.test(effect));
  assert(extract('const manualSaveToHistory = useCallback(', '}, [').includes('weekAvailability'), 'manual saves keep week overrides');
});

test('backups with weeks published under older rules restore; tampered records do not', async () => {
  const snapshot = {ruleVersion:1, weekStart:'2026-03-01', employees:[], schedule:{}, extShifts:[], handoffs:[], timeOffReqs:[], cfg:{}, trainingBlocks:[], previousWeek:null};
  const record = {id:'old', status:'published', priorWeekConfirmed:true, publishedBy:'S', publishedAt:'2026-03-01T12:00:00Z',
    snapshot, stamp:core.publicationStamp(snapshot), approvals:[]};
  assert.equal(core.publicationRecordValid(record), false, 'today\'s rules reject the old snapshot');
  assert.equal(core.publicationRecordIntact(record), true);
  let saved = null;
  const repo = core.createPublicationRepository({read:async()=>saved, write:async v=>{ saved = JSON.parse(JSON.stringify(v)); return true; }});
  await repo.restore({schemaVersion:1, approvals:[], publications:[record]});
  assert.equal(saved.publications.length, 1);
  saved = null;
  await assert.rejects(repo.restore({schemaVersion:1, approvals:[], publications:[{...record, stamp:'tampered'}]}), /invalid publication/);
  assert.equal(saved, null, 'nothing written');
});

test('after a failed read, edits are refused instead of overwriting saved data', async () => {
  const stored = {key:'[{"id":"e1"},{"id":"e2"}'}; // truncated JSON
  const states = [], effects = []; let cursor = 0;
  const scope = {_hasWinStorage:true, useRef:v=>({current:v}),
    useState:init=>{ const i = cursor++; states[i] = typeof init === 'function' ? init() : init; return [states[i], v=>{ states[i] = typeof v === 'function' ? v(states[i]) : v; }]; },
    useEffect:f=>effects.push(f), useCallback:f=>f,
    window:{storage:{get:async k=>({value:stored[k]}), set:async(k,v)=>{ stored[k] = v; return true; }}}};
  const hook = evaluate(extract('function usePersistentState(', '// ── Hours calculator') + 'return usePersistentState;', scope);
  const [, setVal] = hook('key', []); effects.forEach(f => f());
  await new Promise(r => setTimeout(r, 10));
  await assert.rejects(setVal(p => [...p, {id:'new'}]), /could not be read/);
  assert.equal(stored.key, '[{"id":"e1"},{"id":"e2"}', 'saved data untouched');
  assert.match(states[2], /could not be read/);
});

test('the empty "Load PSI Roster" button is gone', () => {
  assert(!html.includes('Load PSI Roster'));
  assert(!html.includes('confirmSeedRoster'));
});

test('a preference fix that would drop the only Medic is detected as losing coverage', () => {
  const shortfall = evaluate(extract('function coverageShortfall(', 'function MinimizeViolationsPanel(') + 'return coverageShortfall;');
  const E = (id, q) => ({id, name:id, employmentType:'part-time', qualifications:q});
  const emps = [E('s1',['Scale','Guard']), E('m1',['Medical','Guard']), E('g1',['Guard'])];
  const before = {[cellKey('Tuesday','second')]:[{employeeId:'s1',position:'Scale'},{employeeId:'m1',position:'Medical'},{employeeId:'g1',position:'Guard'}]};
  const after = {[cellKey('Tuesday','second')]:[{employeeId:'s1',position:'Scale'},{employeeId:'g1',position:'Guard'}]};
  const a = shortfall(before, emps), b = shortfall(after, emps);
  assert(b.bodies > a.bodies && b.roles > a.roles);
  const panel = extract('function MinimizeViolationsPanel(', '  const TYPE_META');
  assert.equal(panel.match(/keepsCoverage\((schedule|cur), result\)/g).length, 2, 'both Fix and Fix All check coverage');
  assert(panel.includes('onBeforeChange?.()'), 'fixes are undoable');
});

test('swing-shaped early/late extensions follow the swing rule, not the required-shift rule', () => {
  const hill = emp({id:'h', qualifications:['Guard','Scale','Medical'], requiredShift:'third', swingEligible:['swing-10p-10a']});
  const sched = {[cellKey('Monday','third')]:[{employeeId:'h',position:'Scale'}]};
  // Stays from Monday's third shift into Tuesday's first (06:00-10:00): the day is the target shift's day.
  const handoff = {id:'x', day:'Tuesday', employeeId:'h', sourceShiftId:'third', targetShiftId:'first', type:'late-stay', position:'Guard', hours:4};
  const kinds = e => core.employeePolicyIssues(e, sched, {minRestHours:8}, {handoffs:[handoff]}).map(i => i.type);
  assert(!kinds(hill).includes('invalid_handoff'), 'the handoff itself is valid');
  assert(!kinds(hill).includes('required_shift'), 'eligible: allowed like the swing');
  const notEligible = kinds({...hill, swingEligible:[]});
  assert(notEligible.includes('swing_eligibility'), 'not eligible: still blocked');
});

test('on weekends the supervisor may work any shift and position they hold, within their own restrictions', () => {
  const sup = emp({id:'s', qualifications:['Supervisor','Scale','Medical','Guard'], blockedShifts:['third']});
  for (const pos of ['Scale','Medical','Guard']) assert.equal(core.canFillPos(sup, pos, 'Saturday'), true, pos);
  assert.equal(core.canFillPos(sup, 'Scale', 'Monday'), false, 'weekdays: supervisor seat only');
  assert.equal(core.canFillPos(sup, 'Supervisor', 'Monday'), true);
  const issues = (day, sid, pos, e = sup) => core.employeePolicyIssues(e, {[cellKey(day, sid)]:[{employeeId:'s', position:pos}]}, {}, {}).map(i => i.type);
  assert.deepEqual(issues('Saturday','second','Scale'), [], 'weekend 2nd as Scale is fine');
  assert(issues('Sunday','third','Medical').includes('blocked_shift'), 'their own blocked shift still applies');
  assert(issues('Saturday','second','Scale', {...sup, requiredShift:'first'}).includes('required_shift'), 'and their required shift');
  assert(issues('Tuesday','second','Guard').length > 0, 'weekday shifts other than the 1st-shift post stay blocked');
  assert.equal(core.ruleBlockedShiftReason(sup, 'Saturday', 'second'), null);
  assert.match(core.ruleBlockedShiftReason(sup, 'Tuesday', 'second'), /weekdays/);
});
