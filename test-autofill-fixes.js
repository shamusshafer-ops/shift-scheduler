'use strict';
// Regression tests for the 2026-10 review, batch 2 (autofill quality).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const core = require('./load-core');
const {cellKey, DAYS, SHIFTS, deployProactiveExtShifts, extendedWorkIntervals, shiftInterval, repairScheduleGaps,
  validateCoverage, validateAssignmentPolicy, analyzeShiftCoverage} = core;
const html = fs.readFileSync(__dirname + '/ShiftScheduler_latest loop.html', 'utf8');
const E = (id, quals, extra = {}) => ({id, name:id, employmentType:'full-time', qualifications:quals, unavailableDays:[], blockedShifts:[],
  preferredShifts:[], preferredDaysOff:[], requiredShift:null, maxShiftsPerWeek:null, overtimePref:'neutral', ext12hPref:'both', ...extra});
const quiet = run => { const log = console.log, warn = console.warn; console.log = console.warn = () => {}; try { return run(); } finally { console.log = log; console.warn = warn; } };
const overlaps = (a, b) => a.start < b.end && b.start < a.end;

test('Step 0 puts the role provider on the half that actually works the short shift', () => {
  // No third-shift Medical: a 12h pair should bring a Medic onto 22:00-06:00.
  // First and second shift each have two dedicated Scale+Medical staff; only third is short.
  const both = ['Guard','Scale','Medical'];
  const roster = [E('f1',both,{requiredShift:'first'}), E('f2',both,{requiredShift:'first'}),
    E('s1',both,{requiredShift:'second'}), E('s2',both,{requiredShift:'second'}),
    E('t1',['Guard'],{requiredShift:'third'}), E('t2',['Guard','Scale'],{requiredShift:'third'}),
    E('m1',['Guard','Medical'],{preferredShifts:['first']}), E('m2',['Guard','Medical'],{preferredShifts:['first']}),
    E('g1',['Guard']), E('g2',['Guard'])];
  const exts = quiet(() => deployProactiveExtShifts(roster, {maxConsecutiveShifts:5}, new Set(), []));
  assert(exts.length > 0, 'a third-shift Medical deficit gets 12h coverage');
  for (const ext of exts) {
    const third = shiftInterval(ext.day, 'third');
    const medicOnThird = extendedWorkIntervals(ext).some(i => overlaps(i, third) &&
      roster.find(e => e.id === i.employeeId).qualifications.includes('Medical'));
    assert(medicOnThird, `${ext.day} ${ext.pairId}: the Medic works the third-shift half`);
  }
});

test('Step 0 never takes the only person who can hold a role on their own shift', () => {
  // h is the only Medic able to work second shift; moving h onto a 06:00-18:00
  // half to help first shift would leave second shift without Medical 18:00-22:00.
  const roster = [E('p',['Guard','Medical'],{requiredShift:'first'}), E('a',['Guard','Scale'],{requiredShift:'first'}),
    E('h',['Guard','Medical'],{preferredShifts:['second'],blockedShifts:['third']}), E('c',['Guard','Scale'],{preferredShifts:['second'],blockedShifts:['first']}),
    E('n1',['Guard','Scale','Medical'],{requiredShift:'third'}), E('g',['Guard'])];
  const exts = quiet(() => deployProactiveExtShifts(roster, {maxConsecutiveShifts:5}, new Set(), []));
  assert(!exts.some(e => e.empAId === 'h' || e.empBId === 'h'), JSON.stringify(exts));
});

const repairContext = roster => ({source:roster, accountingRoster:roster, cfg:{minRestHours:8}, ptoHoursByEmployee:{}, enrichedPatterns:{},
  validateSchedule:(s, x, e, h = []) => [...validateCoverage(s, roster, x, h).filter(i => i.type !== 'overstaffed'),
    ...validateAssignmentPolicy(s, roster, {minRestHours:8}, {extShifts:x, handoffs:h, ptoHoursByEmployee:{}, empPatterns:{}})]});
// Only the slot under test is handed to the repair as a problem, so it cannot
// spend the candidate on the (deliberately empty) rest of the week.
const draft = (roster, ns, autoExtShifts = [], [day, shiftId]) => {
  const ctx = repairContext(roster);
  const issues = ctx.validateSchedule(ns, autoExtShifts, roster, []).filter(i => i.day === day && i.shiftId === shiftId);
  return {ns, autoExtShifts, handoffs:[], usedPatterns:{}, assignLog:{}, hourTracker:{}, issues};
};

test('gap repair never adds someone to a shift their own 12h duty already overlaps', () => {
  // x works Monday 06:00-18:00; a regular Monday-second row for x would only be
  // an uncounted mirror that hides the missing Medic.
  const roster = [E('x',['Guard','Medical']), E('s',['Guard','Scale']), E('g',['Guard']), E('k',['Guard'])];
  const ns = {[cellKey('Monday','second')]:[{employeeId:'s',position:'Scale'},{employeeId:'g',position:'Guard'}]};
  const ext = {pairId:'day', day:'Monday', empAId:'x', empBId:'k', approvedAt:'auto-fill'};
  const out = quiet(() => repairScheduleGaps(draft(roster, ns, [ext], ['Monday','second']), repairContext(roster)));
  assert(!(out.ns[cellKey('Monday','second')] || []).some(a => a.employeeId === 'x'));
});

test('gap repair swaps a Guard for a missing role in a full shift', () => {
  // Saturday second is full (3 guards) but has no Scale; an idle Scale employee exists.
  const roster = [E('g1',['Guard']), E('g2',['Guard']), E('m',['Guard','Medical']), E('sc',['Guard','Scale'])];
  const ns = {[cellKey('Saturday','second')]:[{employeeId:'g1',position:'Guard'},{employeeId:'g2',position:'Guard'},{employeeId:'m',position:'Medical'}]};
  const before = analyzeShiftCoverage('Saturday','second', ns, roster);
  assert(before.missing.includes('Scale'));
  const out = quiet(() => repairScheduleGaps(draft(roster, ns, [], ['Saturday','second']), repairContext(roster)));
  const after = analyzeShiftCoverage('Saturday','second', out.ns, roster, out.autoExtShifts, out.handoffs);
  assert(!after.missing.includes('Scale'), JSON.stringify(out.ns[cellKey('Saturday','second')]));
  assert.equal(after.count, 3, 'still exactly three people');
});

test('autofill alternates attempts with and without Step 0 so the better plan wins', () => {
  assert(html.includes('running = attemptSteps(attemptNum > 1, attemptNum % 2 === 1);'));
  assert(html.includes('for (const ext of withProactive ? deployProactiveExtShifts('));
});

test('the weekly plan is a 40h block, not the consecutive-day cap', () => {
  assert(html.includes('const planDays    = Math.min(maxShifts, Math.ceil(FT_MIN_HOURS / SHIFT_HOURS));'));
  const step1 = html.slice(html.indexOf('// ── Step 1: Assign each employee a shift + work-block plan'), html.indexOf('// ── Step 2: Build qualification-group peer sets'));
  assert(!/\bmaxShifts\b/.test(step1), 'plan and rest-day steps use planDays, not the fatigue cap');
  assert(step1.includes('const restNeeded = Math.max(0, planDaysOff - unavail.size);'), 'unavailable days count as rest');
  assert(/SHIFTS\.forEach\(shift => \{\n\s+const essential = essentialByShift\[shift\.id\] \|\| \[\];[\s\S]{0,400}const globalRestDays = new Map\(\);/.test(step1), 'rest days are staggered per shift');
});

test('autofill runs in short slices so the page and Cancel stay responsive, with unchanged results', () => {
  const steps = core.buildAutoFillSteps;
  assert.equal(typeof steps, 'function');
  const roster = ['a','b','c','d','e','f','g','h','i','j','k','l'].map(id => E(id, ['Guard','Scale','Medical']));
  const run = sync => {
    let seed = 7, clock = 1.7e12; const rnd = Math.random, now = Date.now;
    Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    Date.now = () => Math.floor(clock += 0.05);
    try { return quiet(() => { if (sync) return core.buildAutoFill(roster, {}, new Set(), {}, [], false, {roster});
      const it = steps(roster, {}, new Set(), {}, [], false, {roster}); let s, yields = 0;
      while (!(s = it.next()).done) yields++; return {...s.value, yields}; }); }
    finally { Math.random = rnd; Date.now = now; }
  };
  const sliced = run(false), whole = run(true);
  assert(sliced.yields >= 20, 'yields during annealing (' + sliced.yields + ')');
  assert.deepEqual(sliced.schedule, whole.schedule, 'identical result');
  const tick = html.slice(html.indexOf('    const tick = () => {'), html.indexOf('    const tick = () => {') + 2500);
  assert(tick.includes('const sliceEnd = Date.now() + 40;') && tick.includes('if (!step.done) { setTimeout(tick, 0); return; }'));
});
