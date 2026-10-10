'use strict';
// tools/eval-autofill.js — measure autofill the way the app runs it.
//
// Replays runAutoFill (attempt loop, gap + completion repair, overtime
// rebalance, preference swaps, best-of ranking) in Node on a roster, optionally
// over several consecutive weeks so last week's work constrains the next.
// The attempt body is sliced from the app's runAutoFill callback, so this
// measures the real code, not a copy.
//
//   node tools/eval-autofill.js                       9-27 roster, seeds 1-3, one week
//   node tools/eval-autofill.js --weeks 4 --grid      four rolling weeks, print each grid
//   node tools/eval-autofill.js --roster file.json --seeds 1,2,3,4,5
//
// Searches are time-boxed, so run one measurement at a time: a busy CPU gives
// worse weeks. Not a CI test.
const fs = require('fs'), path = require('path');
const REPO = path.join(__dirname, '..');
const core = require(path.join(REPO, 'load-core'));

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1]; };
const flag = name => process.argv.includes('--' + name);

function loadRoster(file) {
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = d.employees || d.rosters?.[0]?.employees || d.data?.shift_employees;
  if (!Array.isArray(list)) throw new Error('No employees in ' + file);
  const employees = list.map(e => ({ unavailableDays: [], blockedShifts: [], preferredShifts: [], preferredDaysOff: [], requiredShift: null,
    maxShiftsPerWeek: null, swingEligible: [], ...e }));
  return { employees, settings: d.settings || d.data?.shift_settings || {} };
}

const html = fs.readFileSync(path.join(REPO, 'ShiftScheduler_latest loop.html'), 'utf8');
const attemptSrc = html.slice(html.indexOf('    function* attemptSteps(jitter, withProactive = true) {'), html.indexOf('    // ── Commit best result to state'));
if (!attemptSrc.startsWith('    function* attemptSteps')) throw new Error('runAutoFill attempt body not found');

function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const quiet = f => { const l = console.log, w = console.warn; console.log = console.warn = () => {}; try { return f(); } finally { console.log = l; console.warn = w; } };

function runWeek(employees, { cfg, weekStart, history = [], empPatterns = {}, seed = 1, attempts = 10 }) {
  Math.random = seeded(seed);
  const empTimeOffDays = core.buildTimeOffAvailability([], weekStart, null);
  const ptoHoursByEmployee = {}, fairnessHistory = {};
  const enrichedPatterns = core.boundaryPatterns(history, weekStart, empPatterns);
  const validateSchedule = (sched, exts, emps, h) => {
    const options = { extShifts: exts || [], handoffs: h || [], empTimeOffDays, ptoHoursByEmployee, empPatterns: enrichedPatterns };
    const acct = core.buildWeeklyAccounting(employees, sched, exts || [], h || [], [], weekStart, []);
    return [...core.validateCoverage(sched, employees, exts || [], h || []).filter(i => i.type !== 'overstaffed'),
      ...core.validateAssignmentPolicy(sched, employees, cfg, options), ...acct.issues,
      ...employees.flatMap(e => core.stretchIssues(e, sched, cfg, options))];
  };
  const ctx = { schedule: {}, extShifts: core.carryInRecords(history, weekStart), handoffs: [], cfg, empTimeOffDays, source: employees,
    accountingRoster: employees, ptoHoursByEmployee, fairnessHistory, excludeSet: new Set(), enrichedPatterns, preservedSchedule: {},
    preservedHandoffs: [], swingDesig: {}, validateSchedule };
  const scope = new Proxy(ctx, { has: () => true, get: (t, k) => k === Symbol.unscopables ? undefined : (k in t ? t[k] : core[k] ?? global[k]) });
  const attempt = new Function('ctx', `with(ctx){ const attempt=(jitter,withProactive=true)=>{const s=attemptSteps(jitter,withProactive);let st;do{st=s.next();}while(!st.done);return st.value;};\n${attemptSrc}\n return attempt; }`)(scope);
  const repairContext = { source: employees, accountingRoster: employees, cfg, empTimeOffDays, ptoHoursByEmployee, enrichedPatterns, validateSchedule, fairnessHistory,
    searchInput: { weekStart, timeOffReqs: [], weekAvailability: null, history, empPatterns, excludedIds: [], trainingBlocks: [] },
    ...JSON.parse(process.env.REPAIR_OPTS || '{}') };
  const finish = r => {
    r = quiet(() => core.rebalanceOvertime(r, repairContext));
    r = quiet(() => core.improveSchedulePreferences(r, repairContext));
    r.issues = validateSchedule(r.ns, r.autoExtShifts, employees, r.handoffs);
    r.errors = r.issues.filter(i => i.level === 'error').length;
    r.quality = core.scheduleQuality(r, employees, cfg, { empTimeOffDays, ptoHoursByEmployee, empPatterns: enrichedPatterns, fairnessHistory }, {});
    return r;
  };
  let best = null, prev = null, plateau = 0;
  for (let n = 1; n <= attempts; n++) {
    let r = quiet(() => attempt(n > 1, n % 2 === 1));
    if (r.errors > 0) r = quiet(() => core.repairScheduleCompletion(core.repairScheduleGaps(r, repairContext), repairContext));
    r = finish(r);
    r.attempt = n;
    if (!best || core.compareScheduleQuality(r.quality, best.quality) < 0) best = r;
    plateau = prev && core.compareScheduleQuality(best.quality, prev) >= 0 ? plateau + 1 : 0;
    prev = [...best.quality];
    if (plateau >= 3) break;
  }
  // As the page: once, on the best week, relay repair (one neighbourhood per tick).
  if (best.errors > 0) {
    const relayTried = new Set(), started = Date.now(), total = Number(process.env.RELAY_TOTAL_MS) || 10000;
    let r = best;
    for (;;) {
      const left = total - (Date.now() - started);
      r = quiet(() => core.repairWithRelays(r, { ...repairContext, relayMaxGaps: 1, relayTried, relayRepairMs: Math.max(0, left) }));
      if (r.relayInfo.done || left <= 0) break;
    }
    best.relayMs = Date.now() - started;
    r = finish(r);
    if (core.compareScheduleQuality(r.quality, best.quality) < 0) { r.attempt = best.attempt; r.relayMs = best.relayMs; best = r; }
  }
  best.overtimeFloor = core.overtimeLowerBound(employees, { empTimeOffDays, ptoHoursByEmployee });
  return best;
}

function grid(employees, r) {
  const spans = core.collectCoverageIntervals(r.ns, r.autoExtShifts || [], r.handoffs || []);
  const hh = h => String(((h % 24) + 24) % 24).padStart(2, '0');
  const label = (i, day) => {
    if (i.source !== 'regular') return (i.source === 'handoff' ? 'h' : 'x') + hh(i.start) + '-' + hh(i.end);
    const sid = core.SHIFTS.find(s => core.shiftInterval(day, s.id).start === i.start).id;
    return { first: '1', second: '2', third: '3' }[sid] + (i.position && i.position !== 'Guard' ? i.position[0] : '');
  };
  const rows = ['Name'.padEnd(14) + core.DAYS.map(d => d.slice(0, 3).padEnd(10)).join('') + ' hrs  OT'];
  for (const e of employees) {
    const cells = core.DAYS.map((d, di) => spans.filter(i => i.employeeId === e.id && Math.floor(i.start / 24) === di)
      .sort((a, b) => a.start - b.start).map(i => label(i, d)).join('+') || '.');
    const h = core.weeklyEmployeeHours(e, r.ns, r.autoExtShifts || [], r.handoffs || [], {});
    rows.push(e.name.padEnd(14) + cells.map(c => c.padEnd(10)).join('') + String(h.creditedHours).padStart(4) + String(h.overtimeHours).padStart(4));
  }
  return rows.join('\n');
}

function summarize(employees, r) {
  const q = Object.fromEntries(Object.entries(core.QUALITY).map(([k, i]) => [k, r.quality[i]]));
  const hours = employees.map(e => core.weeklyEmployeeHours(e, r.ns, r.autoExtShifts || [], r.handoffs || [], {}).creditedHours);
  const errors = {};
  for (const i of r.issues.filter(i => i.level === 'error')) errors[i.type] = (errors[i.type] || 0) + 1;
  return { errors: r.errors, byType: errors, gapHours: q.coverage, overtime: q.overtime, floor: r.overtimeFloor, doubles: q.doubles,
    maxHours: Math.max(...hours), noDayOff: q.noDayOff, preferences: q.preferences, relayMs: r.relayMs };
}

if (require.main === module) {
  const loaded = loadRoster(arg('roster', path.join(REPO, 'fixtures/roster-2026-09-27.json'))), settings = loaded.settings;
  // --set "D Pete,L Hillenburg" --as '{"splitShiftEligible":true}' tries a roster change without editing the file.
  const changed = arg('set', '').split(',').filter(Boolean), patch = JSON.parse(arg('as', '{}'));
  const employees = loaded.employees.map(e => changed.includes(e.name) ? { ...e, ...patch } : e);
  const cfg = { maxConsecutiveShifts: 6, maxConsecutiveNights: 6, minRestHours: 8, ...settings, ...JSON.parse(arg('cfg', '{}')) };
  const seeds = arg('seeds', '1,2,3').split(',').map(Number), weeks = Number(arg('weeks', 1));
  console.log('settings', JSON.stringify(cfg));
  for (const seed of seeds) {
    let history = [], empPatterns = {}, weekStart = arg('week', '2026-10-11');
    for (let w = 0; w < weeks; w++) {
      const r = runWeek(employees, { cfg, weekStart, history, empPatterns, seed });
      console.log(`seed ${seed} week ${weekStart}`, JSON.stringify(summarize(employees, r)));
      if (flag('grid')) console.log(grid(employees, r) + '\n');
      history = [...history, core.makeHistoryEntry({ weekStart, schedule: r.ns, extShifts: r.autoExtShifts, handoffs: r.handoffs, employees })];
      empPatterns = r.usedPatterns || empPatterns;
      const next = new Date(weekStart + 'T12:00:00Z'); next.setUTCDate(next.getUTCDate() + 7); weekStart = next.toISOString().slice(0, 10);
    }
  }
}
module.exports = { runWeek, loadRoster, grid, summarize };
