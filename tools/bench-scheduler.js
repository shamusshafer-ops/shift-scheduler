'use strict';
// tools/bench-scheduler.js — reproducible before/after benchmark for autofill.
//
// Replays the page's generation pipeline in Node (attempt loop with gap and
// completion repair, overtime rebalance, preference swaps, one relay pass, then
// the branch-and-bound complete search under a fixed NODE budget instead of the
// page's wall-clock idle limit) over a set of scenarios and seeds, and measures
// every result with the independent metrics below, so two versions of the app
// are compared with the same measuring stick.
//
//   node tools/bench-scheduler.js --repo . --out bench.json
//   node tools/bench-scheduler.js --repo /path/to/old/checkout --scenarios synth-15 --seeds 1-5
//   node tools/bench-scheduler.js --compare before.json after.json
//
// After autofill, a version that has the optimizer (createScheduleOptimizer)
// runs it from autofill's week, as the page's Optimize button does; older
// versions run the complete search. Budgets (the same for both engines):
//   --budget nodes --nodes 2000    search nodes (region rebuilds + whole-week
//                                  search); reproducible, optimizer seeded
//   --budget time --seconds 60     wall clock after autofill
//   --mode balanced|fast|deep      optimizer mode (default balanced)
//   --engine search                force the complete search on a new version
//
// --repo points at any checkout of this repository; its own load-core.js and
// HTML are measured. Run one benchmark at a time on an idle machine: the
// heuristic repairs inside autofill have small wall-clock budgets, so a busy CPU
// gives worse weeks. Not a CI test.
const fs = require('fs'), path = require('path');
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1]; };
const flag = name => process.argv.includes('--' + name);
const range = s => s.split(',').flatMap(p => { const [a, b] = p.split('-').map(Number); return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a]; });
const HERE = path.join(__dirname, '..');

// ── Independent metrics (computed only from intervals; no solver code) ──────
// Everything is per Sunday–Saturday week. A duty belongs to the day it starts.
// prevIntervals (optional): the previous week's work, in this week's hours
// (negative), when that week is known. Calendar measures never assume
// anything about next week: a break running to the week's end counts at the
// length already known.
function weekMetrics(core, employees, week, ptoHoursByEmployee = {}, prevIntervals = null) {
  const ns = week.ns || {}, exts = week.autoExtShifts || [], handoffs = week.handoffs || [];
  const all = core.collectCoverageIntervals(ns, exts, handoffs);
  const spans = all.filter(i => !i.carryIn);
  let gap = 0, roleGap = 0;
  for (const day of core.DAYS) for (const s of core.SHIFTS) {
    const c = core.analyzeShiftCoverage(day, s.id, ns, employees, exts, handoffs);
    gap += c.bodyGapHours; roleGap += c.roleGapHours;
  }
  const m = { uncoveredStaffHours: gap, uncoveredRoleHours: roleGap, ftShortfallHours: 0, totalOT: 0, maxOT: 0, employeesWithOT: 0,
    otSquares: 0, otNonPreferred: 0, doubles: 0, longDuties: 0, sevenDayWeeks: 0, noTwoDaysOff: 0, isolatedDaysOff: 0, isolatedWorkDays: 0,
    shiftChanges: 0, dayNightFlips: 0, shortTurnarounds: 0, restDeficitHours: 0, maxConsecutiveDays: 0, supervisorExtensions: 0,
    no48hBreak: 0, no36hBreak: 0, calIsolatedDaysOff: 0, calDaysOff: 0 };
  const supIds = new Set(employees.filter(e => (e.qualifications || []).includes('Supervisor')).map(e => e.id));
  m.supervisorExtensions = handoffs.filter(h => supIds.has(h.employeeId) && h.type === 'late-stay' && h.sourceShiftId === 'first' &&
    h.targetShiftId === 'second' && h.position !== 'Supervisor' && !['Saturday', 'Sunday'].includes(h.day)).length;
  const cls = h => { const t = ((h % 24) + 24) % 24; return t >= 6 && t < 14 ? 'D' : t >= 14 && t < 22 ? 'E' : 'N'; };
  for (const emp of employees) {
    const own = spans.filter(i => i.employeeId === emp.id).sort((a, b) => a.start - b.start);
    const blocks = [];
    for (const i of own) { const b = blocks.at(-1); if (b && i.start <= b.end) b.end = Math.max(b.end, i.end); else blocks.push({ start: i.start, end: i.end }); }
    const worked = blocks.reduce((n, b) => n + b.end - b.start, 0);
    const pto = ptoHoursByEmployee[emp.id] || 0, credited = worked + Math.min(pto, Math.max(0, 40 - worked)), ot = Math.max(0, worked - 40);
    if (emp.employmentType === 'full-time') m.ftShortfallHours += Math.max(0, 40 - credited);
    m.totalOT += ot; m.maxOT = Math.max(m.maxOT, ot); if (ot > 0) m.employeesWithOT++; m.otSquares += ot * ot;
    if (ot > 0 && emp.overtimePref !== 'preferred') m.otNonPreferred += ot;
    // Calendar measures (Sunday 00:00 to Saturday 24:00; work hours 0..168).
    if (blocks.length) {
      const before = [...(prevIntervals || []), ...all.filter(i => i.carryIn)].filter(i => i.employeeId === emp.id);
      const lead = before.length ? blocks[0].start - Math.max(...before.map(i => i.end)) : blocks[0].start;
      const breaks = [lead, ...blocks.slice(1).map((b, n) => b.start - blocks[n].end), 168 - blocks.at(-1).end];
      if (!breaks.some(g => g >= 48)) m.no48hBreak++;
      if (!breaks.some(g => g >= 36)) m.no36hBreak++;
      const workedDay = d => [...own, ...before].some(i => i.start < (d + 1) * 24 && i.end > d * 24);
      const offDays = [0, 1, 2, 3, 4, 5, 6].filter(d => !workedDay(d));
      m.calDaysOff += offDays.length;
      // An isolated calendar day off: worked the day before and the day after (Saturday's next day is unknown).
      for (const d of offDays) if (d < 6 && workedDay(d + 1) && (d > 0 ? workedDay(d - 1) : (prevIntervals || before.length) && workedDay(-1))) m.calIsolatedDaysOff++;
    }
    for (const b of blocks) { if (b.end - b.start > 12) m.doubles++; if (b.end - b.start > 8) m.longDuties++; }
    const days = new Set(own.map(i => Math.floor(i.start / 24)).filter(d => d >= 0 && d < 7));
    if (!days.size) continue;
    if (days.size === 7) m.sevenDayWeeks++;
    // Cyclic week: Saturday is followed by (next) Sunday, so Mon-Fri has its weekend off together.
    const w = d => days.has((d + 7) % 7);
    let twoOff = false, run = 0;
    for (let d = 0; d < 7; d++) { if (!w(d) && !w(d + 1)) twoOff = true; run = w(d) ? run + 1 : 0; m.maxConsecutiveDays = Math.max(m.maxConsecutiveDays, run); }
    if (!twoOff && days.size <= 5) m.noTwoDaysOff++;
    if (days.size < 7) for (let d = 0; d < 7; d++) { if (!w(d) && w(d - 1) && w(d + 1)) m.isolatedDaysOff++; if (w(d) && !w(d - 1) && !w(d + 1)) m.isolatedWorkDays++; }
    for (let n = 1; n < blocks.length; n++) {
      const a = cls(blocks[n - 1].start), b = cls(blocks[n].start), rest = blocks[n].start - blocks[n - 1].end;
      if (a !== b) m.shiftChanges++;
      if ((a === 'D' && b === 'N') || (a === 'N' && b === 'D')) m.dayNightFlips++;
      if (rest < 16) { m.shortTurnarounds++; m.restDeficitHours += 16 - rest; }
    }
  }
  return m;
}

// ── Scenarios ──────────────────────────────────────────────────────────────
function mk(id, type, quals, extra = {}) {
  return { id, name: id, employmentType: type, qualifications: quals, preferredShifts: [], preferredDaysOff: [], unavailableDays: [], blockedShifts: [],
    requiredShift: null, maxShiftsPerWeek: null, willing16h: false, crossShiftOT: false, swingEligible: [], splitShiftEligible: false, inTraining: false,
    availableDaysOfWeek: null, overtimePref: 'neutral', ...extra };
}
function synth15() {
  return [
    mk('sup', 'full-time', ['Supervisor', 'Guard'], { preferredShifts: ['first'] }),
    mk('s1', 'full-time', ['Scale', 'Guard'], { preferredShifts: ['first'] }), mk('m1', 'full-time', ['Medical', 'Guard'], { preferredShifts: ['first'] }),
    mk('d1', 'full-time', ['Scale', 'Medical', 'Guard'], { preferredShifts: ['second'] }), mk('s2', 'full-time', ['Scale', 'Guard'], { preferredShifts: ['second'] }),
    mk('m2', 'full-time', ['Medical', 'Guard'], { preferredShifts: ['second'] }), mk('s3', 'full-time', ['Scale', 'Guard'], { preferredShifts: ['third'] }),
    mk('m3', 'full-time', ['Medical', 'Guard'], { preferredShifts: ['third'] }),
    mk('g1', 'full-time', ['Guard'], { preferredShifts: ['first'], preferredDaysOff: ['Saturday', 'Sunday'] }),
    mk('g2', 'full-time', ['Guard'], { preferredShifts: ['third'] }), mk('g3', 'full-time', ['Guard'], { preferredShifts: ['second'] }),
    mk('p1', 'part-time', ['Guard', 'Scale'], { preferredShifts: ['second'], maxShiftsPerWeek: 3 }),
    mk('p2', 'part-time', ['Guard', 'Medical'], { preferredShifts: ['third'], maxShiftsPerWeek: 3 }),
    mk('o1', 'on-call', ['Guard'], { maxShiftsPerWeek: 4 }), mk('o2', 'on-call', ['Guard', 'Scale', 'Medical'], { maxShiftsPerWeek: 2 }),
  ];
}
const leave = (empId, dates, hours = 8) => dates.map((d, n) => ({ id: empId + '-' + n, empId, type: 'single_day', startDate: d, endDate: d, status: 'approved', paid: true, ptoHoursByDate: { [d]: hours } }));
function loadFixture(file) {
  const d = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', file), 'utf8'));
  const list = d.employees;
  return { employees: list.map(e => ({ unavailableDays: [], blockedShifts: [], preferredShifts: [], preferredDaysOff: [], requiredShift: null, maxShiftsPerWeek: null, swingEligible: [], ...e })),
    cfg: d.settings || d.cfg || {} };
}
const SCENARIOS = {
  // The current 13-person operational roster (saved 2026-10-15). Exact optimum
  // (tools/feasibility_cpsat.py, validated): full coverage, 48h OT, max 8h each.
  'real-current': () => { const f = loadFixture('roster-2026-10-15.json'); return { employees: f.employees, cfg: { maxConsecutiveShifts: 6, maxConsecutiveNights: 6, minRestHours: 8, ...f.cfg } }; },
  // The saved 12-person roster of 2026-09-27 (structural shortage: 88h OT floor).
  'real-0927': () => { const f = loadFixture('roster-2026-09-27.json'); return { employees: f.employees, cfg: { maxConsecutiveShifts: 6, maxConsecutiveNights: 6, minRestHours: 8, ...f.cfg } }; },
  // The anonymized 15-person April roster used by the complete-search tests.
  'anon-15': () => { const f = loadFixture('complete-search-roster.json'); return { employees: f.employees, cfg: f.cfg }; },
  'synth-15': () => ({ employees: synth15(), cfg: { maxConsecutiveShifts: 6, maxConsecutiveNights: 6, minRestHours: 8 } }),
  // Multiple PTO requests, including the dual-qualified employee.
  'synth-pto': () => ({ employees: synth15(), cfg: { maxConsecutiveShifts: 6, maxConsecutiveNights: 6, minRestHours: 8 },
    timeOffReqs: [...leave('d1', ['WEEK+3', 'WEEK+4', 'WEEK+5']), ...leave('g1', ['WEEK+1']), ...leave('m3', ['WEEK+2', 'WEEK+3'])] }),
  // A Medic and a Guard short.
  'synth-tight': () => ({ employees: synth15().filter(e => !['m2', 'g3'].includes(e.id)), cfg: { maxConsecutiveShifts: 6, maxConsecutiveNights: 6, minRestHours: 8 } }),
  // Overtime available only from three people.
  'synth-noot': () => ({ employees: synth15().map(e => ['d1', 'g2', 'o2'].includes(e.id) ? { ...e, overtimePref: 'preferred' } : { ...e, overtimePref: 'blocked' }),
    cfg: { maxConsecutiveShifts: 6, maxConsecutiveNights: 6, minRestHours: 8 } }),
  // Phase II: feasible but difficult Scale shortage. d1 is a Medic only and p1
  // a Guard only, leaving three full-time Scales and a 2-shift on-call: Scale
  // needs 168h a week, they have 136h without overtime.
  'synth-scarce': () => ({ employees: synth15().map(e => e.id === 'd1' ? { ...e, qualifications: ['Medical', 'Guard'] } : e.id === 'p1' ? { ...e, qualifications: ['Guard'] } : e),
    cfg: { maxConsecutiveShifts: 6, maxConsecutiveNights: 6, minRestHours: 8 } }),
  // Phase II: overtime is needed (synth-tight) and four people volunteer for it,
  // two refuse; the rest inherit the site default.
  'synth-volunteers': () => ({ employees: synth15().filter(e => !['m2', 'g3'].includes(e.id))
    .map(e => ['s1', 'm1', 'g1', 'g2'].includes(e.id) ? { ...e, overtimePref: 'preferred' } : ['s3', 'o1'].includes(e.id) ? { ...e, overtimePref: 'blocked' } : e),
    cfg: { maxConsecutiveShifts: 6, maxConsecutiveNights: 6, minRestHours: 8 } }),
  // Phase II: a manager-locked 12-hour day pair on Wednesday (Scale s1 0600-1800,
  // Scale s3 1800-0600) that every engine must keep.
  'synth-locked': () => ({ employees: synth15().map(e => e.id === 's1' ? { ...e, ext12hPref: 'day' } : e.id === 's3' ? { ...e, ext12hPref: 'night' } : e), cfg: { maxConsecutiveShifts: 6, maxConsecutiveNights: 6, minRestHours: 8 },
    extShifts: [{ day: 'Wednesday', pairId: 'day', empAId: 's1', empBId: 's3', locked: true }] }),
};

// ── Pipeline (mirrors runAutoFill + startCompleteSearch on the page) ─────────
function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const quiet = f => { const l = console.log, w = console.warn; console.log = console.warn = () => {}; try { return f(); } finally { console.log = l; console.warn = w; } };
function addDays(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

function makePipeline(repo) {
  const core = require(path.join(repo, 'load-core'));
  const html = fs.readFileSync(path.join(repo, 'ShiftScheduler_latest loop.html'), 'utf8');
  const attemptSrc = html.slice(html.indexOf('    function* attemptSteps(jitter, withProactive = true) {'), html.indexOf('    // ── Commit best result to state'));
  if (!attemptSrc.startsWith('    function* attemptSteps')) throw new Error('runAutoFill attempt body not found in ' + repo);
  const hasOptimizer = typeof core.createScheduleOptimizer === 'function';
  function runWeek(employees, { cfg, weekStart, history = [], empPatterns = {}, timeOffReqs = [], seed = 1, attempts = 10, searchNodes = 4000,
    budget = 'nodes', seconds = 60, engine = 'auto', mode = 'balanced', extShifts: lockedExts = [] }) {
    Math.random = seeded(seed);
    if (global.gc) global.gc();
    const heapStart = process.memoryUsage().heapUsed;
    let heapPeak = heapStart;
    const sample = () => { const h = process.memoryUsage().heapUsed; if (h > heapPeak) heapPeak = h; };
    const t0 = Date.now();
    let firstValidAt = null;
    const empTimeOffDays = core.buildTimeOffAvailability(timeOffReqs, weekStart, null);
    const ptoHoursByEmployee = core.buildPtoCredits(employees, timeOffReqs, weekStart).hoursByEmployee;
    // Fairness from the benchmark's own earlier weeks (the page reads published weeks), when the version supports it.
    const fairnessHistory = core.fairnessFromWeeks ? { byEmployee: core.fairnessFromWeeks(history.slice(-8).map(h => ({ ...h, employees: h.employees || employees }))), weeks: history.map(h => h.weekStart) } : {};
    const enrichedPatterns = core.boundaryPatterns(history, weekStart, empPatterns);
    const validateSchedule = (sched, exts, emps, h) => {
      const options = { extShifts: exts || [], handoffs: h || [], empTimeOffDays, ptoHoursByEmployee, empPatterns: enrichedPatterns };
      const acct = core.buildWeeklyAccounting(employees, sched, exts || [], h || [], timeOffReqs, weekStart, []);
      return [...core.validateCoverage(sched, employees, exts || [], h || []).filter(i => i.type !== 'overstaffed'),
        ...core.validateAssignmentPolicy(sched, employees, cfg, options), ...acct.issues,
        ...employees.flatMap(e => core.stretchIssues(e, sched, cfg, options))];
    };
    const startExts = [...core.carryInRecords(history, weekStart), ...lockedExts];
    const ctx = { schedule: {}, extShifts: startExts, handoffs: [], cfg, empTimeOffDays, source: employees,
      accountingRoster: employees, ptoHoursByEmployee, fairnessHistory, excludeSet: new Set(), enrichedPatterns, preservedSchedule: {},
      preservedHandoffs: [], swingDesig: {}, validateSchedule };
    const scope = new Proxy(ctx, { has: () => true, get: (t, k) => k === Symbol.unscopables ? undefined : (k in t ? t[k] : core[k] ?? global[k]) });
    const attempt = new Function('ctx', `with(ctx){ const attempt=(jitter,withProactive=true)=>{const s=attemptSteps(jitter,withProactive);let st;do{st=s.next();}while(!st.done);return st.value;};\n${attemptSrc}\n return attempt; }`)(scope);
    const searchInput = { weekStart, employees, cfg, schedule: {}, extShifts: startExts, handoffs: [], trainingBlocks: [], timeOffReqs, weekAvailability: null,
      history, empPatterns, excludedIds: [], fairnessHistory };
    const repairContext = { source: employees, accountingRoster: employees, cfg, empTimeOffDays, ptoHoursByEmployee, enrichedPatterns, validateSchedule, fairnessHistory, searchInput };
    const qOpts = { empTimeOffDays, ptoHoursByEmployee, empPatterns: enrichedPatterns, fairnessHistory };
    const finish = r => {
      r = quiet(() => core.rebalanceOvertime(r, repairContext));
      r = quiet(() => core.improveSchedulePreferences(r, repairContext));
      r.issues = validateSchedule(r.ns, r.autoExtShifts, employees, r.handoffs);
      r.errors = r.issues.filter(i => i.level === 'error').length;
      r.quality = core.scheduleQuality(r, employees, cfg, qOpts, {});
      return r;
    };
    const complete = w => { const Q = core.QUALITY; return [Q.hard, Q.coverage, Q.body, Q.shortfall].every(i => w.quality[i] === 0) && w.errors === 0; };
    let best = null, prev = null, plateau = 0, n = 0;
    for (n = 1; n <= attempts; n++) {
      let r = quiet(() => attempt(n > 1, n % 2 === 1));
      if (r.errors > 0) r = quiet(() => core.repairScheduleCompletion(core.repairScheduleGaps(r, repairContext), repairContext));
      r = finish(r);
      if (!best || core.compareScheduleQuality(r.quality, best.quality) < 0) best = r;
      sample();
      if (firstValidAt == null && complete(best)) firstValidAt = Date.now();
      plateau = prev && core.compareScheduleQuality(best.quality, prev) >= 0 ? plateau + 1 : 0;
      prev = [...best.quality];
      const q = best.quality, Q = core.QUALITY;
      if ([Q.hard, Q.coverage, Q.body, Q.shortfall].every(i => q[i] === 0) && best.errors === 0) break;
      if (plateau >= 3) break;
    }
    if (!complete(best)) {
      const relayTried = new Set(), started = Date.now();
      let r = best;
      for (;;) {
        const left = 10000 - (Date.now() - started);
        r = quiet(() => core.repairWithRelays(r, { ...repairContext, relayMaxGaps: 1, relayTried, relayRepairMs: Math.max(0, left) }));
        if (r.relayInfo.done || left <= 0) break;
      }
      r = finish(r);
      if (core.compareScheduleQuality(r.quality, best.quality) < 0) best = r;
      if (firstValidAt == null && complete(best)) firstValidAt = Date.now();
    }
    const heuristicMs = Date.now() - t0;
    const autofillWeek = best;
    const Q = core.QUALITY, q = best.quality, isComplete = complete(best);
    const useOptimizer = engine === 'optimizer' || (engine === 'auto' && hasOptimizer);
    const s0 = Date.now(), timeUp = () => Date.now() - s0 >= seconds * 1000;
    let final = best, applied = 'autofill', bestAt = Date.now(), searchNodesUsed = 0, searchStatus = null, proven = false, extra = {};
    const accept = w => {
      w.issues = validateSchedule(w.ns, w.autoExtShifts, employees, w.handoffs); w.errors = w.issues.filter(i => i.level === 'error').length;
      w.quality = core.scheduleQuality(w, employees, cfg, qOpts, {});
      return w;
    };
    if (useOptimizer) {
      // As the page's Optimize button: autofill's week is the starting point.
      const previousWeekKnown = history.some(h => h.weekStart === addDays(weekStart, -7));
      const reproducible = budget === 'nodes';
      const config = core.hydrateOptimizerConfig({ mode, seed, deterministic: reproducible, idleIterations: reproducible ? 1e9 : undefined, maxIterations: reproducible ? 1e9 : undefined,
        budgets: reproducible ? {} : { maxMs: seconds * 1000, idleMs: seconds * 1000 }, initial: best, initialLabel: "Autofill's week", previousWeekKnown, searchInput });
      const opt = core.createScheduleOptimizer(config);
      const used = sn => sn.regionNodes + (sn.search?.nodes || 0);
      let snap;
      do {
        snap = quiet(() => reproducible ? opt.advance({ iterations: 1, searchSteps: 300 }) : opt.advance({ timeSliceMs: 200 }));
        sample();
      } while (snap.status === 'running' && (reproducible ? used(snap) < searchNodes : !timeUp()));
      if (snap.status === 'running') snap = opt.cancel();
      searchNodesUsed = used(snap); searchStatus = snap.stopReason; proven = snap.proof?.kind === 'proven-selected';
      extra = { proofKind: snap.proof?.kind, iterations: snap.iterations, regionNodes: snap.regionNodes, wholeWeekNodes: snap.search?.nodes || 0,
        poolSize: snap.candidates.length, improvedOverInitial: snap.improvedOverInitial,
        operators: Object.fromEntries(Object.entries(snap.operators).filter(([, v]) => v.tries).map(([k, v]) => [k, { tries: v.tries, newBest: v.newBest, improvements: v.improvements }])) };
      if (snap.best && snap.best.origin !== 'autofill') {
        const w = accept({ ...snap.best.week });
        if (!w.errors || (!complete(best) && core.compareScheduleQuality(w.quality, best.quality) < 0)) {
          final = w; applied = 'optimizer'; bestAt = s0 + snap.timeToBestMs;
          if (firstValidAt == null && snap.timeToFirstValidMs != null) firstValidAt = s0 + snap.timeToFirstValidMs;
        }
      }
    } else {
      // Complete search, as startCompleteSearch: seeded with autofill's week when it is complete.
      const seedArgs = isComplete ? { overtimeBudget: q[Q.overtime], withoutDayOffBudget: q[Q.noDayOff], supervisorExtensionBudget: q[Q.supervisorExtensions] } : {};
      const solver = core.createCompleteScheduleSearch({ ...searchInput, optimizeOvertime: true, ...seedArgs });
      let snap, lastSolution = null, solutionAt = null;
      do {
        snap = quiet(() => solver.advance({ maxSteps: 500, timeSliceMs: 50 }));
        sample();
        if (snap.solution && snap.solution !== lastSolution) { lastSolution = snap.solution; solutionAt = Date.now(); }
      } while (snap.status === 'searching' && (budget === 'nodes' ? snap.nodes < searchNodes : !timeUp()));
      if (snap.status === 'searching') snap = solver.cancel();
      searchNodesUsed = snap.nodes; searchStatus = snap.status; proven = !!snap.optimization?.proven || snap.status === 'no-better';
      if (snap.solution) {
        let w = { ...snap.solution };
        const errs = validateSchedule(w.ns, w.autoExtShifts, employees, w.handoffs).filter(i => i.level === 'error');
        if (!errs.length) {
          // The page polishes a search week through the same post-processing, when the version has it.
          if (core.polishSearchWeek) w = quiet(() => core.polishSearchWeek(w, repairContext));
          final = accept(w); applied = 'search'; bestAt = solutionAt || Date.now();
          if (firstValidAt == null && !final.errors) firstValidAt = bestAt;
        }
      }
    }
    const searchMs = Date.now() - s0;
    final.issues = validateSchedule(final.ns, final.autoExtShifts, employees, final.handoffs);
    const errorTypes = {};
    for (const i of final.issues.filter(i => i.level === 'error')) errorTypes[i.type] = (errorTypes[i.type] || 0) + 1;
    return { final, autofillWeek, ptoHoursByEmployee, info: { attempts: Math.min(n, attempts), heuristicMs, searchMs, searchNodes: searchNodesUsed, searchStatus,
      proven, applied, engine: useOptimizer ? 'optimizer' : 'search', budget, hardErrors: final.issues.filter(i => i.level === 'error').length, errorTypes,
      autofillComplete: isComplete, autofillOT: q[Q.overtime], firstValidMs: firstValidAt == null ? null : firstValidAt - t0, bestMs: bestAt - t0,
      peakHeapMB: +((heapPeak - heapStart) / 1048576).toFixed(1), ...extra } };
  }
  return { core, runWeek };
}

// The previous week's work in this week's hours (negative), for calendar measures.
const shiftBack = (core, week) => week ? core.collectCoverageIntervals(week.ns || {}, week.autoExtShifts || [], week.handoffs || [])
  .filter(i => !i.carryIn).map(i => ({ ...i, start: i.start - 168, end: i.end - 168 })) : null;
// Leading objectives in their canonical order, from the independent metrics.
const lexKey = r => [r.hardErrors, r.uncoveredStaffHours + r.uncoveredRoleHours, r.ftShortfallHours, r.supervisorExtensions, r.sevenDayWeeks, r.totalOT, r.doubles, r.otSquares];
const lexCmp = (u, v) => { const i = u.findIndex((n, k) => n !== v[k]); return i < 0 ? 0 : u[i] < v[i] ? -1 : 1; };
function runScenario(pipe, name, seeds, weeks, runOptions) {
  const sc = SCENARIOS[name]();
  const rows = [];
  for (const seed of seeds) {
    let history = [], empPatterns = {}, weekStart = '2026-10-11', previous = null;
    for (let w = 0; w < weeks; w++) {
      const timeOffReqs = (sc.timeOffReqs || []).map(r => { const d = addDays(weekStart, Number(r.startDate.split('+')[1])); return { ...r, startDate: d, endDate: d, ptoHoursByDate: { [d]: Object.values(r.ptoHoursByDate)[0] } }; });
      const lockedExts = w === 0 ? (sc.extShifts || []) : [];
      const { final, autofillWeek, info, ptoHoursByEmployee } = pipe.runWeek(sc.employees, { cfg: sc.cfg, weekStart, history, empPatterns, timeOffReqs, seed, extShifts: lockedExts, ...runOptions });
      const prev = shiftBack(pipe.core, previous);
      const m = weekMetrics(pipe.core, sc.employees, final, ptoHoursByEmployee, prev);
      const a = weekMetrics(pipe.core, sc.employees, autofillWeek, ptoHoursByEmployee, prev);
      a.hardErrors = autofillWeek.issues.filter(i => i.level === 'error').length;
      const row = { scenario: name, seed, week: w, weekStart, ...info, ...m };
      row.beyondAutofill = -lexCmp(lexKey(row), lexKey(a));
      if (lockedExts.length) row.locksKept = lockedExts.every(x => (final.autoExtShifts || []).some(e => e.day === x.day && e.pairId === x.pairId && e.empAId === x.empAId && (e.empBId || null) === (x.empBId || null)));
      row.autofill = Object.fromEntries(['hardErrors', 'uncoveredStaffHours', 'uncoveredRoleHours', 'ftShortfallHours', 'totalOT', 'maxOT', 'otSquares', 'otNonPreferred', 'doubles', 'sevenDayWeeks', 'supervisorExtensions', 'no48hBreak'].map(k => [k, a[k]]));
      rows.push({ ...row, ptoHoursByEmployee, schedule: { ns: final.ns, autoExtShifts: final.autoExtShifts || [], handoffs: final.handoffs || [] } });
      process.stderr.write(`${name} seed ${seed} week ${w}: err ${info.hardErrors} gap ${m.uncoveredStaffHours + m.uncoveredRoleHours} OT ${a.totalOT}->${m.totalOT} max ${a.maxOT}->${m.maxOT} 7d ${m.sevenDayWeeks} dbl ${m.doubles} ${info.applied} nodes ${info.searchNodes} best@${(info.bestMs / 1000).toFixed(1)}s ${((info.heuristicMs + info.searchMs) / 1000).toFixed(1)}s\n`);
      history = [...history, pipe.core.makeHistoryEntry({ weekStart, schedule: final.ns, extShifts: final.autoExtShifts, handoffs: final.handoffs, employees: sc.employees })];
      empPatterns = final.usedPatterns || empPatterns;
      previous = final;
      weekStart = addDays(weekStart, 7);
    }
  }
  return rows;
}

const KEYS = ['hardErrors', 'uncoveredStaffHours', 'uncoveredRoleHours', 'ftShortfallHours', 'supervisorExtensions', 'sevenDayWeeks', 'totalOT', 'maxOT', 'employeesWithOT',
  'otSquares', 'otNonPreferred', 'doubles', 'longDuties', 'noTwoDaysOff', 'isolatedDaysOff', 'isolatedWorkDays', 'shiftChanges', 'dayNightFlips', 'shortTurnarounds', 'restDeficitHours',
  'no48hBreak', 'no36hBreak', 'calIsolatedDaysOff', 'calDaysOff'];
const TIME_KEYS = ['medianSec', 'worstSec', 'medianFirstValidSec', 'medianBestSec', 'medianPeakHeapMB', 'maxPeakHeapMB', 'meanSearchNodes'];
function aggregate(rows) {
  const by = {};
  for (const r of rows) (by[r.scenario] ||= []).push(r);
  const out = {};
  for (const [name, list] of Object.entries(by)) {
    const mean = k => list.reduce((n, r) => n + (r[k] ?? 0), 0) / list.length;
    const median = xs => { xs = xs.filter(x => x != null).sort((a, b) => a - b); return xs.length ? xs[Math.floor(xs.length / 2)] : null; };
    const times = list.map(r => r.heuristicMs + r.searchMs).sort((a, b) => a - b);
    const sec = ms => ms == null ? null : +(ms / 1000).toFixed(1);
    out[name] = { runs: list.length, completeValidRate: +(list.filter(r => !r.hardErrors && !r.uncoveredStaffHours && !r.uncoveredRoleHours && !r.ftShortfallHours).length / list.length).toFixed(2),
      provenRate: +(list.filter(r => r.proven).length / list.length).toFixed(2), searchApplied: list.filter(r => r.applied !== 'autofill').length,
      beyondAutofill: list.filter(r => r.beyondAutofill > 0).length, worseThanAutofill: list.filter(r => r.beyondAutofill < 0).length,
      ...Object.fromEntries(KEYS.map(k => [k, +mean(k).toFixed(2)])), medianSec: sec(times[Math.floor(times.length / 2)]), worstSec: sec(times.at(-1)),
      medianFirstValidSec: sec(median(list.map(r => r.firstValidMs))), medianBestSec: sec(median(list.map(r => r.bestMs))),
      medianPeakHeapMB: median(list.map(r => r.peakHeapMB)), maxPeakHeapMB: Math.max(...list.map(r => r.peakHeapMB ?? 0)),
      meanSearchNodes: Math.round(mean('searchNodes')) };
  }
  return out;
}

if (require.main === module) {
  if (flag('compare')) {
    const i = process.argv.indexOf('--compare'), [a, b] = [process.argv[i + 1], process.argv[i + 2]].map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
    const A = aggregate(a.rows), B = aggregate(b.rows);
    const lines = [];
    for (const name of Object.keys(A)) {
      if (!B[name]) continue;
      lines.push(`\n## ${name} (${A[name].runs} vs ${B[name].runs} runs; lower is better unless noted)`);
      lines.push('| metric | before | after | change |\n|---|---|---|---|');
      for (const k of ['completeValidRate', 'beyondAutofill', ...KEYS, ...TIME_KEYS]) {
        if (A[name][k] == null && B[name][k] == null) continue;
        const d = A[name][k] == null || B[name][k] == null ? null : +(B[name][k] - A[name][k]).toFixed(2);
        lines.push(`| ${k} | ${A[name][k] ?? '–'} | ${B[name][k] ?? '–'} | ${d == null ? '–' : (d > 0 ? '+' : '') + d} |`);
      }
      // Paired per-run comparison on the canonical leading objectives.
      const pairs = a.rows.filter(r => r.scenario === name).map(r => [r, b.rows.find(s => s.scenario === name && s.seed === r.seed && s.week === r.week)]).filter(p => p[1]);
      let better = 0, worse = 0;
      for (const [x, y] of pairs) { const d = lexCmp(lexKey(y), lexKey(x)); if (d < 0) better++; else if (d > 0) worse++; }
      lines.push(`\nPaired by seed on (errors, gaps, FT shortfall, supervisor 12h, 7-day weeks, OT, doubles, OT spread): ${better} better, ${worse} worse, ${pairs.length - better - worse} equal.`);
      // Across consecutive weeks of one seed: overtime carried by the most-burdened person.
      const multi = rows => { const by = {}; for (const r of rows.filter(r => r.scenario === name)) (by[r.seed] ||= []).push(r);
        const lists = Object.values(by).filter(l => l.length > 1); if (!lists.length) return null;
        const core = require(path.join(HERE, 'load-core')), emps = SCENARIOS[name]().employees;
        const per = lists.map(l => { const tot = {}; for (const r of l) for (const e of emps) tot[e.id] = (tot[e.id] || 0) + core.weeklyEmployeeHours(e, r.schedule.ns, r.schedule.autoExtShifts, r.schedule.handoffs, {}).overtimeHours;
          const v = Object.values(tot); return { max: Math.max(...v), squares: v.reduce((n, x) => n + x * x, 0), people: v.filter(x => x > 0).length }; });
        const m = k => +(per.reduce((n, p) => n + p[k], 0) / per.length).toFixed(1);
        return { max: m('max'), squares: m('squares'), people: m('people') }; };
      const ma = multi(a.rows), mb = multi(b.rows);
      if (ma && mb) lines.push(`Across ${a.rows.filter(r => r.scenario === name && r.seed === a.rows.find(x => x.scenario === name).seed).length} consecutive weeks: max cumulative OT per person ${ma.max} → ${mb.max}; sum of squared cumulative OT ${ma.squares} → ${mb.squares}; people with any OT ${ma.people} → ${mb.people}.`);
    }
    console.log(lines.join('\n'));
    return;
  }
  if (flag('fixture')) {
    // Print one scenario's first week as a fixture for tools/export-duty-model.js.
    const sc = SCENARIOS[arg('fixture')](), weekStart = '2026-10-11';
    const timeOffReqs = (sc.timeOffReqs || []).map(r => { const d = addDays(weekStart, Number(r.startDate.split('+')[1])); return { ...r, startDate: d, endDate: d, ptoHoursByDate: { [d]: Object.values(r.ptoHoursByDate)[0] } }; });
    console.log(JSON.stringify({ source: 'tools/bench-scheduler.js scenario ' + arg('fixture'), settings: sc.cfg, employees: sc.employees, timeOffReqs }, null, 1));
    return;
  }
  if (process.argv.includes("--remeasure")) {
    // Recompute the metrics of stored weeks (e.g. after a metric definition changes).
    const file = arg('remeasure', null), data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const core = require(path.join(HERE, 'load-core'));
    for (const r of data.rows) {
      const prev = r.week > 0 ? data.rows.find(x => x.scenario === r.scenario && x.seed === r.seed && x.week === r.week - 1) : null;
      Object.assign(r, weekMetrics(core, SCENARIOS[r.scenario]().employees, r.schedule, r.ptoHoursByEmployee || {}, shiftBack(core, prev?.schedule)));
    }
    data.summary = aggregate(data.rows);
    fs.writeFileSync(arg('out', file), JSON.stringify(data, null, 1));
    console.log(JSON.stringify(data.summary, null, 1));
    return;
  }
  const repo = path.resolve(arg('repo', HERE));
  const pipe = makePipeline(repo);
  const names = arg('scenarios', Object.keys(SCENARIOS).join(',')).split(',');
  const seeds = range(arg('seeds', '1-20')), weeks = Number(arg('weeks', 1));
  const runOptions = { searchNodes: Number(arg('nodes', 4000)), budget: arg('budget', 'nodes'), seconds: Number(arg('seconds', 60)),
    engine: arg('engine', 'auto'), mode: arg('mode', 'balanced') };
  const rows = [];
  for (const name of names) rows.push(...runScenario(pipe, name, seeds, weeks, runOptions));
  const result = { repo, commit: (() => { try { return require('child_process').execSync('git -C ' + JSON.stringify(repo) + ' rev-parse HEAD').toString().trim(); } catch { return null; } })(),
    args: process.argv.slice(2), recordedAt: new Date().toISOString(), summary: aggregate(rows), rows };
  const out = arg('out', null);
  if (out) fs.writeFileSync(out, JSON.stringify(result, null, 1));
  console.log(JSON.stringify(result.summary, null, 1));
}
module.exports = { weekMetrics, SCENARIOS, makePipeline, aggregate, lexKey, lexCmp };
