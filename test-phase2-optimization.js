'use strict';
// Phase II regressions: carry-in and fixed duties in the search and its floor,
// effective overtime preference, the optimizer (candidate pool, bound sharing,
// neighborhood rebuilds) and its reporting. See docs/phase-2-optimization.md.
const test = require('node:test'), assert = require('node:assert/strict'), c = require('./load-core');
const e = (id, extra = {}) => ({ id, name: id, employmentType: 'full-time', qualifications: ['Guard', 'Scale', 'Medical'], overtimePref: 'neutral', ...extra });
const a = (id, position = 'Guard', locked = false) => ({ employeeId: id, position, ...(locked ? { locked: true } : {}) });
const finish = (search, maxMs = 120000) => { const t = Date.now(); let r; do { r = search.advance({ maxSteps: 5000, timeSliceMs: 100 }); if (Date.now() - t > maxMs) assert.fail('fixture exceeded its budget'); } while (r.status === 'searching'); return r; };
const cfg = { minRestHours: 8, maxConsecutiveShifts: 7, maxConsecutiveNights: 7 };
// 13 full-timers (one supervisor) and a part-timer limited to two second shifts:
// 536h of room under 40 against 544h of coverage.
const tightRoster = () => [e('sup', { qualifications: ['Supervisor', 'Guard'] }), ...Array.from({ length: 12 }, (_, n) => e('e' + n)),
  e('p', { employmentType: 'part-time', maxShiftsPerWeek: 2, requiredShift: 'second' })];
// Last week's Saturday third, extended by e0 through Sunday first shift (a 16h double).
const carry = { carryIn: true, pairId: 'carry-in', day: 'Sunday', employeeId: 'e0', position: 'Guard', start: -2, end: 14, fromSource: 'regular' };

test('carry-in work stays fixed in the complete search and its coverage is not this week\'s demand', () => {
  const roster = tightRoster();
  assert.equal(c.overtimeLowerBound(roster), 8, 'without carry-in, 544h - 536h');
  const fixed = { ns: {}, autoExtShifts: [carry], handoffs: [] };
  assert.equal(c.overtimeLowerBound(roster, { fixed }), 0, 'carry-in covers 8 of Sunday first shift\'s hours; those are last week\'s');
  const r = finish(c.createCompleteScheduleSearch({ weekStart: '2026-09-06', employees: roster, cfg, extShifts: [carry], optimizeOvertime: true }));
  assert.equal(r.status, 'feasible');
  assert.equal(r.optimization.bestOvertime, 0, 'the old search dropped the carry-in and claimed 8h was proven optimal');
  assert(r.optimization.proven);
  // No row duplicates e0's own carried-in work (it would credit last week's hours to this week).
  assert(!(r.solution.ns.Sunday__first || []).some(x => x.employeeId === 'e0'));
  assert(r.solution.autoExtShifts.some(x => x.carryIn && x.employeeId === 'e0'));
  const issues = [...c.validateCoverage(r.solution.ns, roster, r.solution.autoExtShifts, r.solution.handoffs), ...c.validateAssignmentPolicy(r.solution.ns, roster, cfg,
    { extShifts: r.solution.autoExtShifts, handoffs: r.solution.handoffs })].filter(i => i.level === 'error');
  assert.deepEqual(issues, []);
});

test('the overtime floor counts locked duties outside ordinary availability and adds nothing for excluded staff', () => {
  const roster = [...Array.from({ length: 13 }, (_, n) => e('g' + n, { requiredShift: 'first' })), e('sup', { qualifications: ['Supervisor'] })];
  const free = c.overtimeFloorDetails(roster);
  // g0 is locked on third shift twice (a permitted exception to his required first shift).
  const ns = { Monday__third: [a('g0', 'Guard', true)], Tuesday__third: [a('g0', 'Guard', true)] };
  const withLocks = c.overtimeFloorDetails(roster, { fixed: { ns, autoExtShifts: [], handoffs: [] } });
  assert(withLocks.floor <= free.floor, 'fixed work can only add capacity');
  // An excluded employee contributes only fixed work.
  const without = c.overtimeFloorDetails(roster, { excludedIds: ['g1'] });
  assert(without.general.roomUnder40 <= free.general.roomUnder40 - 40 + 1e-9);
});

test('a neutral employee inherits the site\'s default overtime preference everywhere', () => {
  const emp = e('x', { overtimePref: 'neutral' });
  assert.equal(c.effectiveOvertimePref(emp, { defaultOvertimePref: 'preferred' }), 'preferred');
  assert.equal(c.effectiveOvertimePref({ ...emp, overtimePref: 'blocked' }, { defaultOvertimePref: 'preferred' }), 'blocked');
  // Quality halves the spread weight for people who (effectively) want overtime.
  const ns = Object.fromEntries(c.DAYS.slice(0, 6).map(d => [d + '__first', [a('x')]]));
  const spread = cfgArg => c.employeeQuality(emp, ns, [], [], c.collectCoverageIntervals(ns, [], []), cfgArg, {})[c.QUALITY.spread];
  assert.equal(spread({ defaultOvertimePref: 'neutral' }), 64);
  assert.equal(spread({ defaultOvertimePref: 'preferred' }), 32, 'before the fix the neutral employee kept full weight');
});

test('search bound sharing: an offered week tightens the bound and an exhausted search proves it best', () => {
  const roster = ['a', 'b', 'c'].map(id => e(id, { employmentType: 'part-time', availableDaysOfWeek: ['Sunday'], requiredShift: 'second', overtimePref: 'blocked' }));
  const s = c.createCompleteScheduleSearch({ weekStart: '2026-09-06', employees: roster, cfg, targetSlots: ['Sunday__second'], optimizeOvertime: true });
  assert.equal(s.offerBound([0, 0, 0]), true);
  assert.equal(s.offerBound([0, 0, 4]), false, 'a worse value never loosens the bound');
  const r = finish(s);
  assert.equal(r.status, 'no-better');
  assert.match(r.reasons[0], /best week already found/);
});

// A synthetic 15-person week: autofill's result is the optimizer's starting point.
const { makePipeline, SCENARIOS } = require('./tools/bench-scheduler.js');
const pipe = makePipeline(__dirname);
const sc = SCENARIOS['anon-15'](), weekStart = '2026-10-11';
const quiet = f => { const l = console.log, w = console.warn; console.log = console.warn = () => {}; try { return f(); } finally { console.log = l; console.warn = w; } };
const autofill = quiet(() => pipe.runWeek(sc.employees, { cfg: sc.cfg, weekStart, seed: 1, searchNodes: 0, attempts: 2 })).final;
const ctxFor = (emps, extra = {}) => {
  const empTimeOffDays = c.buildTimeOffAvailability([], weekStart, null);
  const validateSchedule = (ns, x, roster, h) => [...c.validateCoverage(ns, emps, x, h).filter(i => i.type !== 'overstaffed'),
    ...c.validateAssignmentPolicy(ns, emps, sc.cfg, { extShifts: x, handoffs: h, empTimeOffDays, ptoHoursByEmployee: {} })];
  return { source: emps.filter(x => !(extra.excludedIds || []).includes(x.id)), accountingRoster: emps, cfg: sc.cfg, empTimeOffDays, ptoHoursByEmployee: {}, enrichedPatterns: {}, fairnessHistory: {}, validateSchedule };
};
const optimizerFor = (initial, extra = {}) => c.createScheduleOptimizer({ mode: 'balanced', seed: 7, deterministic: true, idleIterations: 1e9, maxIterations: extra.iterations || 12,
  initial, searchInput: { weekStart, employees: sc.employees, cfg: sc.cfg, schedule: extra.schedule || {}, extShifts: [], handoffs: [], timeOffReqs: [], history: [], empPatterns: {},
    excludedIds: extra.excludedIds || [] }, context: ctxFor(sc.employees, extra), globalSearch: extra.globalSearch });
const run = opt => { let s; do { s = opt.advance({ iterations: 1, searchSteps: 300 }); } while (s.status === 'running'); return s; };

test('candidate pool: the best week by the canonical objective wins, whatever order weeks arrive in', () => {
  const q = w => c.scheduleQuality(w, sc.employees, sc.cfg, {});
  // Two valid weeks with equal leading objectives: arrival order must not matter.
  const run1 = run(optimizerFor(autofill, { iterations: 6, globalSearch: false }));
  const other = run1.candidates.find(x => x.id !== run1.best.id && x.complete);
  assert(other, 'fixture needs a second valid week');
  const better = c.compareScheduleQuality(q(other.week), q(run1.best.week)) < 0 ? other.week : run1.best.week;
  const worse = better === other.week ? run1.best.week : other.week;
  for (const order of [[worse, better], [better, worse]]) {
    const o = optimizerFor(null, { globalSearch: false });
    for (const w of order) o.offer(w, 'test');
    assert.deepEqual(o.snapshot().best.quality, q(better));
  }
  // A week failing independent validation never outranks a clean one, even with less overtime.
  const broken = JSON.parse(JSON.stringify(better));
  broken.ns.Monday__second = broken.ns.Monday__second.slice(0, 1);
  const o = optimizerFor(null, { globalSearch: false });
  o.offer(better, 'test'); o.offer(broken, 'test');
  assert.equal(o.snapshot().best.errors, 0);
});

test('optimizer: reproducible, never worse than autofill, explains rankings, states proof scope', () => {
  const s1 = run(optimizerFor(autofill)), s2 = run(optimizerFor(autofill));
  assert.deepEqual(s1.best.quality, s2.best.quality, 'same seed and budgets, same result');
  assert(c.compareScheduleQuality(s1.best.quality, s1.initialQuality) <= 0);
  assert.equal(s1.best.errors, 0);
  assert(s1.best.complete);
  assert(['best-found', 'proven-selected'].includes(s1.proof.kind));
  assert.doesNotMatch(s1.proof.text, /all objectives/i);
  for (const cand of s1.candidates.filter(x => x.explanation)) assert.match(cand.explanation.text, /Ranks (above|below)|Equal/);
  // The whole-week search's bound follows the best valid week.
  const o = s1.search?.optimization;
  if (o) assert(o.bound[2] <= s1.best.quality[c.QUALITY.overtime] + 1e-9);
});

test('optimizer: rebuilds keep manager locks and never move excluded employees', () => {
  // Lock two of autofill's duties and exclude one employee.
  const keys = Object.keys(autofill.ns).filter(k => autofill.ns[k].length);
  const locked = [keys[0], keys[5]].map(k => [k, autofill.ns[k][0].employeeId]);
  const excludedId = autofill.ns[keys[9]][0].employeeId;
  const initial = JSON.parse(JSON.stringify(autofill));
  for (const [k, id] of locked) initial.ns[k] = initial.ns[k].map(x => x.employeeId === id ? { ...x, locked: true } : x);
  const excludedDuties = Object.entries(initial.ns).flatMap(([k, rows]) => rows.filter(x => x.employeeId === excludedId).map(x => k)).sort();
  const s = run(optimizerFor(initial, { iterations: 10, schedule: initial.ns, excludedIds: [excludedId] }));
  for (const cand of s.candidates) {
    for (const [k, id] of locked) assert(cand.week.ns[k].some(x => x.employeeId === id && x.locked), 'lock kept in ' + cand.origin);
    const duties = Object.entries(cand.week.ns).flatMap(([k, rows]) => rows.filter(x => x.employeeId === excludedId).map(x => k)).sort();
    assert.deepEqual(duties, excludedDuties, 'excluded employee untouched in ' + cand.origin);
    // No temporary lock leaks into a candidate.
    const lockedCount = Object.values(cand.week.ns).flat().filter(x => x.locked).length;
    assert.equal(lockedCount, locked.length, 'only manager locks remain in ' + cand.origin);
  }
});

test('explainRanking names the entry that decides', () => {
  const v = o => { const q = Array(14).fill(0); for (const [k, x] of Object.entries(o)) q[c.QUALITY[k]] = x; return q; };
  const r = c.explainRanking(v({ overtime: 24, pattern: 9 }), v({ overtime: 32, pattern: 2 }));
  assert.equal(r.decidedBy, 'overtime'); assert.equal(r.better, 'first');
  assert.match(r.text, /total overtime hours 24 vs 32/);
  assert.equal(c.explainRanking(v({}), v({})).decidedBy, null);
});
