'use strict';
// Autofill step 2 (2026-10-10): handoffs across midnight (10P–10A, 2A–2P),
// split eligibility for the split shapes, and relay repair (a neighbourhood
// re-planned with swings, splits and handoffs).
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('./load-core');
const {cellKey, DAYS, SHIFTS, repairScheduleGaps, repairWithRelays, validateCoverage, validateAssignmentPolicy, employeePolicyIssues,
  analyzeShiftCoverage, handoffSourceDay, relayGapPossible, collectCoverageIntervals} = core;
const E = (id, quals = ['Guard'], extra = {}) => ({id, name:id, employmentType:'part-time', qualifications:quals, unavailableDays:[], blockedShifts:[],
  preferredShifts:[], preferredDaysOff:[], requiredShift:null, maxShiftsPerWeek:null, overtimePref:'neutral', swingEligible:[], ...extra});
const row = (id, position = 'Guard') => ({employeeId:id, position});
const quiet = run => { const l = console.log, w = console.warn; console.log = console.warn = () => {}; try { return run(); } finally { console.log = l; console.warn = w; } };
const cfg = {minRestHours:8, maxConsecutiveShifts:6, maxConsecutiveNights:6};
const context = roster => ({source:roster, accountingRoster:roster, cfg, ptoHoursByEmployee:{}, enrichedPatterns:{},
  validateSchedule:(s, x, e, h = []) => [...validateCoverage(s, roster, x, h).filter(i => i.type !== 'overstaffed'),
    ...validateAssignmentPolicy(s, roster, cfg, {extShifts:x, handoffs:h, ptoHoursByEmployee:{}, empPatterns:{}})]});
const draftFor = (roster, ns, [day, shiftId]) => {
  const issues = context(roster).validateSchedule(ns, [], roster, []).filter(i => i.day === day && i.shiftId === shiftId);
  return {ns, autoExtShifts:[], handoffs:[], usedPatterns:{}, assignLog:{}, hourTracker:{}, issues};
};

test('a handoff names its real source day across midnight', () => {
  assert.equal(handoffSourceDay({day:'Monday', type:'late-stay', sourceShiftId:'third', targetShiftId:'first'}), 'Sunday');
  assert.equal(handoffSourceDay({day:'Monday', type:'early-arrival', sourceShiftId:'first', targetShiftId:'third'}), 'Tuesday');
  assert.equal(handoffSourceDay({day:'Monday', type:'late-stay', sourceShiftId:'first', targetShiftId:'second'}), 'Monday');
  assert.equal(handoffSourceDay({day:'Sunday', type:'late-stay', sourceShiftId:'third', targetShiftId:'first'}), null);
});

test('gap repair has the previous night stay until 10:00 (10P–10A) when only that covers first shift', () => {
  // Monday first is one body short; the only person able to help is h, who
  // works Sunday night and opted into 10P–10A.
  const roster = [E('h', ['Guard'], {swingEligible:['swing-10p-10a']}), E('a'), E('b'), E('n1'), E('n2')];
  const ns = {[cellKey('Monday','first')]:[row('a'), row('b')], [cellKey('Sunday','third')]:[row('h'), row('n1'), row('n2')]};
  const out = quiet(() => repairScheduleGaps(draftFor(roster, ns, ['Monday','first']), context(roster)));
  const h = (out.handoffs || []).find(v => v.employeeId === 'h');
  assert(h, JSON.stringify(out.handoffs));
  assert.deepEqual([h.day, h.type, h.sourceShiftId, h.targetShiftId], ['Monday', 'late-stay', 'third', 'first']);
  assert.deepEqual(validateAssignmentPolicy(out.ns, roster, cfg, {handoffs:out.handoffs}), []);
});

test('gap repair has the next morning arrive at 02:00 (2A–2P) for third shift, and only if opted in', () => {
  const run = eligible => {
    const roster = [E('e', ['Guard'], {swingEligible:eligible ? ['swing-2a-2p'] : []}), E('a'), E('b'), E('m1'), E('m2')];
    const ns = {[cellKey('Monday','third')]:[row('a'), row('b')], [cellKey('Tuesday','first')]:[row('e'), row('m1'), row('m2')]};
    return quiet(() => repairScheduleGaps(draftFor(roster, ns, ['Monday','third']), context(roster)));
  };
  const h = (run(true).handoffs || []).find(v => v.employeeId === 'e');
  assert(h);
  assert.deepEqual([h.day, h.type, h.sourceShiftId, h.targetShiftId], ['Monday', 'early-arrival', 'first', 'third']);
  assert(!(run(false).handoffs || []).some(v => v.employeeId === 'e'), 'not opted in: no 02:00 arrival');
});

test('split eligibility allows the 2P–2A and 2A–2P shapes', () => {
  const late = {day:'Monday', employeeId:'s', type:'late-stay', sourceShiftId:'second', targetShiftId:'third', position:'Guard', hours:4};
  const ns = {[cellKey('Monday','second')]:[row('s')]};
  const types = emp => employeePolicyIssues(emp, ns, cfg, {handoffs:[late]}).map(i => i.type);
  assert(types(E('s')).includes('swing_eligibility'));
  assert(!types(E('s', ['Guard'], {splitShiftEligible:true})).includes('swing_eligibility'));
});

test('relay repair skips a gap no one could reach, without searching', () => {
  // Nobody holds Scale: Saturday first cannot get one by any arrangement.
  const roster = ['a','b','c'].map(id => E(id, ['Guard','Medical']));
  const ns = {[cellKey('Saturday','first')]:roster.map(e => row(e.id, 'Guard'))};
  const c = analyzeShiftCoverage('Saturday', 'first', ns, roster, [], []);
  assert(c.missing.includes('Scale'));
  assert.equal(relayGapPossible('Saturday', 'first', c, roster, cfg, null), false);
});

test('relay repair closes a first-shift Scale gap with a 2P–2A / 2A–2P split', () => {
  // Saturday first has no Scale. Pete (third shift only) and Cam (no first
  // shift) are the only Scale holders; both opted into split shifts. Cam stays
  // until 02:00 after Friday second, Pete works 02:00–14:00 instead of Friday
  // night, and so Saturday first gets its Scale.
  const pete = E('pete', ['Scale','Medical'], {requiredShift:'third', splitShiftEligible:true, ext12hPref:'night'});
  const cam = E('cam', ['Guard','Scale'], {blockedShifts:['first'], splitShiftEligible:true});
  const medics = Array.from({length:9}, (_, i) => E('m' + i, ['Guard','Medical']));
  const roster = [pete, cam, ...medics];
  const ns = {
    [cellKey('Friday','second')]:[row('cam','Scale'), row('m0','Medical'), row('m1')],
    [cellKey('Friday','third')]:[row('pete','Scale'), row('m2','Medical'), row('m3')],
    [cellKey('Saturday','first')]:[row('m4','Medical'), row('m5'), row('m6')],
    [cellKey('Saturday','second')]:[row('m7','Medical'), row('m8'), row('cam','Scale')],
  };
  const others = new Set(DAYS.flatMap(d => SHIFTS.map(s => cellKey(d, s.id))).filter(k => k !== cellKey('Saturday','first')));
  const ctx = {...context(roster), relayTried:others, relayRepairMs:8000, relayGapMs:6000,
    searchInput:{weekStart:'2026-10-11', timeOffReqs:[], weekAvailability:null, history:[], empPatterns:{}, excludedIds:[], trainingBlocks:[]}};
  const input = {ns, autoExtShifts:[], handoffs:[], assignLog:{}};
  const out = quiet(() => repairWithRelays(input, ctx));
  assert(out.relayInfo.applied >= 1, JSON.stringify(out.relayInfo));
  for (const slot of [['Friday','second'], ['Friday','third'], ['Saturday','first'], ['Saturday','second']])
    assert(analyzeShiftCoverage(...slot, out.ns, roster, out.autoExtShifts, out.handoffs).ok, slot.join(' ') + ' covered');
  assert.deepEqual(validateAssignmentPolicy(out.ns, roster, cfg, {extShifts:out.autoExtShifts, handoffs:out.handoffs}), []);
  // Pete is on duty for Saturday first as the Scale.
  const spans = collectCoverageIntervals(out.ns, out.autoExtShifts, out.handoffs);
  const satFirst = core.shiftInterval('Saturday', 'first');
  assert(spans.some(i => i.employeeId === 'pete' && i.start <= satFirst.start && i.end >= satFirst.end));
  // No temporary hold leaks into the result.
  assert(!Object.values(out.ns).flat().some(v => v.locked));
  assert(!out.autoExtShifts.some(e => e.locked) && !out.handoffs.some(h => h.locked));
});
