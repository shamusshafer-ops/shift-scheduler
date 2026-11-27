'use strict';
// Regressions for the canonical objective, complete-search correctness and the
// schedule polish (see docs/scheduling-intelligence.md).
const test = require('node:test'), assert = require('node:assert/strict'), c = require('./load-core');
const e = (id, extra = {}) => ({ id, name: id, employmentType: 'part-time', qualifications: ['Guard', 'Scale', 'Medical'], overtimePref: 'blocked', ...extra });
const a = (id, position = 'Guard', locked = true) => ({ employeeId: id, position, locked });
const input = (employees, extra = {}) => ({ weekStart: '2026-09-06', employees, targetSlots: ['Sunday__second'], cfg: { minRestHours: 12, maxConsecutiveShifts: 5, maxConsecutiveNights: 4 }, ...extra });
function finish(search, maxMs = 60000) {
  const start = Date.now(); let r;
  do { r = search.advance({ maxSteps: 10000, timeSliceMs: 40 }); if (Date.now() - start > maxMs) assert.fail('fixture exceeded its budget; no conclusion drawn'); } while (r.status === 'searching');
  return r;
}
const pto = (empId, dates, hours = 8) => dates.map((d, n) => ({ id: empId + n, empId, type: 'single_day', startDate: d, endDate: d, status: 'approved', paid: true, ptoHoursByDate: { [d]: hours } }));

test('PTO is displaced by extra work: a No OT full-timer with 40h PTO can still cover a shift', () => {
  const roster = ['ft', 'b', 'c'].map(id => e(id, { availableDaysOfWeek: ['Sunday'], requiredShift: 'second' })); roster[0].employmentType = 'full-time';
  const i = input(roster, { timeOffReqs: pto('ft', ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']) });
  for (const optimizeOvertime of [false, true]) {
    const r = finish(c.createCompleteScheduleSearch({ ...i, optimizeOvertime }));
    assert.equal(r.status, 'feasible', 'the old bound subtracted credited PTO from the room and reported this week infeasible');
    const h = c.weeklyEmployeeHours(roster[0], r.solution.ns, [], [], { ft: 40 });
    assert.equal(h.workedHours, 8); assert.equal(h.creditedHours, 40); assert.equal(h.overtimeHours, 0);
  }
});

test('ending the regular-hours phase does not claim optimality over a better overtime week', () => {
  const p = (id, extra) => e(id, { qualifications: ['Guard'], availableDaysOfWeek: ['Monday'], ...extra });
  const roster = [p('sup', { qualifications: ['Supervisor', 'Medical', 'Guard'], requiredShift: 'first', canWorkOtherShifts: true, ext12hPref: 'day' }),
    p('f1', { qualifications: ['Scale', 'Medical'], requiredShift: 'first' }), p('f2', { requiredShift: 'first' }), p('f3', { requiredShift: 'first' }),
    p('g1', { qualifications: ['Scale', 'Guard'], requiredShift: 'second' }), p('g2', { requiredShift: 'second' }),
    p('night', { qualifications: ['Medical', 'Guard'], requiredShift: 'third', canWorkOtherShifts: true, ext12hPref: 'night', maxShiftsPerWeek: 1 }),
    p('n2', { qualifications: ['Scale', 'Guard'], requiredShift: 'third' }), p('n3', { requiredShift: 'third' }),
    // A second-shift Medic already at 40h this week who accepts overtime.
    e('m2', { qualifications: ['Medical', 'Guard'], requiredShift: 'second', overtimePref: 'preferred', availableDaysOfWeek: c.DAYS.slice(1) })];
  const schedule = Object.fromEntries(['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(d => [d + '__second', [a('m2')]]));
  const i = input(roster, { schedule, targetSlots: ['Monday__first', 'Monday__second', 'Monday__third'], cfg: { minRestHours: 8, maxConsecutiveShifts: 7, maxConsecutiveNights: 4 } });
  const r = finish(c.createCompleteScheduleSearch({ ...i, optimizeOvertime: true }));
  assert.equal(r.status, 'feasible'); assert.equal(r.phase, 'overtime-review', 'the overtime phase must still run after a regular-hours incumbent');
  assert.equal(r.optimization.bestSupervisorExtensions, 0, 'eight approved overtime hours outrank the supervisor\'s 12-hour day');
  assert.equal(r.optimization.bestOvertime, 8); assert(r.optimization.proven);
  assert(!r.solution.handoffs.some(h => c.isSupervisorExtension(h)));
});

test('complete-search optimum matches an exhaustive oracle on 30 rosters with PTO, locks and overtime', () => {
  const days = ['Sunday', 'Monday', 'Tuesday'], combos = [];
  for (let x = 0; x < 5; x++) for (let y = x + 1; y < 5; y++) for (let z = y + 1; z < 5; z++) combos.push([x, y, z]);
  let seed = 4242; const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  let feasibleTrials = 0, overtimeTrials = 0;
  for (let trial = 0; trial < 30; trial++) {
    const roster = [], schedule = {}, timeOffReqs = [];
    for (let n = 0; n < 5; n++) {
      const ft = rand() < 0.4, emp = e('e' + n, { employmentType: ft ? 'full-time' : 'part-time', requiredShift: 'second', qualifications: n < 2 ? ['Guard', 'Scale', 'Medical'] : ['Guard'],
        overtimePref: rand() < 0.5 ? 'blocked' : 'neutral', availableDaysOfWeek: c.DAYS.filter(d => !days.includes(d) || rand() < 0.85) });
      roster.push(emp);
      const later = ['Wednesday', 'Thursday', 'Friday', 'Saturday'];
      if (rand() < 0.5) for (const d of later) (schedule[d + '__second'] ||= []).push(a(emp.id));            // 32h locked
      else if (ft) timeOffReqs.push(...pto(emp.id, ['2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12'])); // 32h PTO
    }
    const cfg = { minRestHours: 12, maxConsecutiveShifts: 7, maxConsecutiveNights: 4 };
    const ptoHours = c.buildPtoCredits(roster, timeOffReqs, '2026-09-06').hoursByEmployee, empTimeOffDays = c.buildTimeOffAvailability(timeOffReqs, '2026-09-06');
    let best = null;
    for (const x of combos) for (const y of combos) for (const z of combos) {
      const s = JSON.parse(JSON.stringify(schedule));
      [x, y, z].forEach((ids, j) => { s[days[j] + '__second'] = ids.map(n => a('e' + n, 'Guard', false)); });
      if (!days.every(d => c.analyzeShiftCoverage(d, 'second', s, roster).ok)) continue;
      if (c.validateAssignmentPolicy(s, roster, cfg, { ptoHoursByEmployee: ptoHours, empTimeOffDays }).length) continue;
      if (roster.some(v => c.weeklyEmployeeHours(v, s, [], [], ptoHours).shortfallHours > 0)) continue;
      const value = [c.employeesWithoutDayOff(roster, s).length, roster.reduce((n, v) => n + c.weeklyEmployeeHours(v, s, [], [], ptoHours).overtimeHours, 0)];
      if (!best || value[0] < best[0] || (value[0] === best[0] && value[1] < best[1])) best = value;
    }
    const r = finish(c.createCompleteScheduleSearch(input(roster, { schedule, timeOffReqs, cfg, targetSlots: days.map(d => d + '__second'), optimizeOvertime: true })));
    assert.equal(r.status === 'feasible', !!best, 'feasibility mismatch, trial ' + trial);
    if (!best) continue;
    feasibleTrials++; if (best[1] > 0) overtimeTrials++;
    assert(r.optimization.proven, 'trial ' + trial + ' finished without a proof');
    assert.deepEqual([r.optimization.bestWithoutDayOff, r.optimization.bestOvertime], best, 'optimum mismatch, trial ' + trial);
  }
  assert(feasibleTrials >= 10 && overtimeTrials >= 3, `fixture too easy: ${feasibleTrials} feasible, ${overtimeTrials} needing overtime`);
});

test('the overtime floor counts each role\'s hours against only the people qualified for it', () => {
  const guards = Array.from({ length: 14 }, (_, n) => e('g' + n, { employmentType: 'full-time', qualifications: ['Guard'] }));
  const scale = [e('s1', { qualifications: ['Scale'] }), e('s2', { qualifications: ['Scale'] }), e('s3', { qualifications: ['Scale'] })];
  const medic = [0, 1, 2, 3, 4].map(n => e('m' + n, { qualifications: ['Medical'] })), sup = e('sup', { qualifications: ['Supervisor'] });
  // 168 Scale hours, three Scale holders with 40h of room each: 48h must be overtime,
  // even though everyone together has room for every coverage hour.
  const roster = [...guards, ...scale, ...medic, sup];
  assert.equal(c.overtimeLowerBound(roster), 168 - 3 * 40);
  assert.equal(c.overtimeLowerBound(guards.slice(0, 12)), 544 - 12 * 40, 'a role nobody holds gives no floor (the week is infeasible, not costly)');
});

test('work-pattern measures: actual breaks, calendar days, quick turnarounds and shift changes', () => {
  const span = (day, shiftId) => ({ employeeId: 'x', source: 'regular', ...c.shiftInterval(day, shiftId) });
  const w = (duties, pattern, known) => c.employeeWorkPattern('x', duties.map(d => span(...d)), pattern, known);
  const pick = (r, ...k) => Object.fromEntries(k.map(x => [x, r[x]]));
  const monFri = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map(d => [d, 'first']);
  // Without last week, Mon-Fri has no known 48h break; the open one before Monday
  // (30h so far) may still become one: 1, not 2. Nothing assumed about next week.
  assert.deepEqual(pick(w(monFri), 'recovery', 'pattern', 'transitions', 'breaks48', 'longestBreakHours'),
    { recovery: 0, pattern: 1, transitions: 0, breaks48: 0, longestBreakHours: 34 });
  // With last week known (Mon-Fri first shifts) the weekend is a real 64h break.
  const lastWeek = [-6, -5, -4, -3, -2].map(d => ({ start: d * 24 + 6, end: d * 24 + 14 }));
  assert.deepEqual(pick(w(monFri, { prevWorkIntervals: lastWeek }), 'pattern', 'transitions', 'breaks48', 'longestBreakHours'),
    { pattern: 0, transitions: 0, breaks48: 1, longestBreakHours: 64 });
  // Sun-Thu: Friday and Saturday off, known inside the week.
  assert.equal(w(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'].map(d => [d, 'first'])).pattern, 0);
  // Scattered: no known 48h break, Mon, Wed and Fri isolated days off, Tue and Thu isolated workdays
  // (Sunday is not judged without last week; Saturday never, next Sunday is unknown).
  assert.equal(w([['Sunday', 'first'], ['Tuesday', 'first'], ['Thursday', 'first'], ['Saturday', 'first']]).pattern, 2 + 3 + 2);
  // Second shift then first shift next morning: 8h rest (8h short of 16) and one shift change.
  assert.deepEqual(pick(w([['Monday', 'second'], ['Tuesday', 'first']]), 'recovery', 'transitions'), { recovery: 8, transitions: 1 });
  // First to third (day to night) counts as two.
  assert.equal(w([['Monday', 'first'], ['Wednesday', 'third']]).transitions, 2);
  // Last week's Saturday night counts for Sunday's rest.
  assert.equal(c.employeeWorkPattern('x', [span('Sunday', 'first')], { prevWorkIntervals: [{ start: -2, end: 6 }] }).recovery, 16);
  // Overnight work makes the next calendar day a worked day: thirds Mon, Tue and Thu
  // touch Mon-Fri, so only Sunday and Saturday are calendar days off.
  const thirds = w([['Monday', 'third'], ['Tuesday', 'third'], ['Thursday', 'third']]);
  assert.deepEqual(pick(thirds, 'calendarDaysOff', 'dutyFreeDays'), { calendarDaysOff: 2, dutyFreeDays: 4 });
  // Carry-in work from last week counts for rest; its hours do not start a duty this week.
  const carry = { employeeId: 'x', start: -2, end: 10, carryIn: true, source: 'extended' };
  const r = c.employeeWorkPattern('x', [carry, span('Sunday', 'third')]);
  assert.equal(r.recovery, 4, '12h rest after the carried-in late stay');
  // An early arrival (02:00-14:00) is a day block, a late stay after nights a night block.
  assert.equal(c.blockShiftClass({ start: 2, end: 14 }), 0);
  assert.equal(c.blockShiftClass({ start: 22, end: 34 }), 2);
  // The old cyclic reading remains available for reporting only.
  assert.equal(c.repeatingWeekPattern('x', monFri.map(d => span(...d))), 0);
});

test('with equal overtime, days off together and fewer quick turnarounds rank better', () => {
  const roster = [e('x', { employmentType: 'full-time', overtimePref: 'neutral' })];
  const week = days => ({ ns: Object.fromEntries(days.map(([d, s]) => [d + '__' + s, [a('x', 'Guard', false)]])), autoExtShifts: [], handoffs: [] });
  const together = week([['Monday', 'first'], ['Tuesday', 'first'], ['Wednesday', 'first'], ['Thursday', 'first'], ['Friday', 'first']]);
  const scattered = week([['Sunday', 'first'], ['Monday', 'first'], ['Wednesday', 'first'], ['Thursday', 'first'], ['Saturday', 'first']]);
  const flipping = week([['Monday', 'second'], ['Tuesday', 'first'], ['Wednesday', 'third'], ['Friday', 'first'], ['Saturday', 'first']]);
  const q = w => c.scheduleQuality(w, roster, {}, { skipPolicy: true });
  for (const w of [together, scattered, flipping]) assert.equal(q(w)[c.QUALITY.overtime], 0);
  assert(c.compareScheduleQuality(q(together), q(scattered)) < 0);
  assert(c.compareScheduleQuality(q(together), q(flipping)) < 0);
  assert(q(flipping)[c.QUALITY.recovery] > 0 && q(flipping)[c.QUALITY.transitions] > 0);
});

test('pattern measures never outrank coverage, hours, seven-day weeks or overtime', () => {
  const v = o => { const q = Array(14).fill(0); for (const [k, x] of Object.entries(o)) q[c.QUALITY[k]] = x; return q; };
  assert(c.compareScheduleQuality(v({ overtime: 1 }), v({ recovery: 999, pattern: 999, transitions: 999, preferences: 999 })) > 0);
  assert(c.compareScheduleQuality(v({ coverage: 1 }), v({ overtime: 80 })) > 0);
  assert(c.compareScheduleQuality(v({ spread: 1 }), v({ recovery: 50 })) > 0, 'overtime concentration outranks rest');
  assert(c.compareScheduleQuality(v({ pattern: 1 }), v({ preferences: 50 })) > 0, 'days off together outrank stated preferences');
});

test('a three-person rotation fixes preferences no pairwise swap can reach', () => {
  // Each pair swap puts someone on a shift they are blocked from; the rotation does not.
  const roster = [e('A', { preferredShifts: ['second'], blockedShifts: ['third'] }), e('B', { preferredShifts: ['third'], blockedShifts: ['first'] }),
    e('C', { preferredShifts: ['first'], blockedShifts: ['second'] })];
  const input = { ns: { Monday__first: [a('A', 'Guard', false)], Monday__second: [a('B', 'Guard', false)], Monday__third: [a('C', 'Guard', false)] }, autoExtShifts: [], handoffs: [], assignLog: {} };
  const r = c.improveSchedulePreferences(input, { source: roster, accountingRoster: roster, cfg: { minRestHours: 8 } });
  assert.equal(r.preferenceInfo.transactions, 1);
  assert.deepEqual(['first', 'second', 'third'].map(s => r.ns['Monday__' + s][0].employeeId), ['C', 'A', 'B']);
  assert.equal(r.preferenceInfo.after, 0);
  assert.deepEqual(c.validateAssignmentPolicy(r.ns, roster, { minRestHours: 8 }), []);
});

test('polishing a search week never worsens it and keeps locked duties', () => {
  const roster = [e('x', { employmentType: 'full-time', overtimePref: 'neutral', availableDaysOfWeek: c.DAYS }), e('y', { employmentType: 'full-time', overtimePref: 'neutral', availableDaysOfWeek: c.DAYS })];
  // x works six days (8h overtime) while y works four; Saturday's duty is locked to x.
  const ns = {};
  for (const d of c.DAYS.slice(0, 6)) ns[d + '__first'] = [a('x', 'Guard', d === 'Saturday')];
  ns.Saturday__first = [a('x', 'Guard', true)];
  for (const d of ['Sunday', 'Monday', 'Tuesday', 'Wednesday']) ns[d + '__second'] = [a('y', 'Guard', false)];
  const week = { ns, autoExtShifts: [], handoffs: [] }, ctx = { source: roster, accountingRoster: roster, cfg: { minRestHours: 8, maxConsecutiveShifts: 7 } };
  const q = w => c.scheduleQuality(w, roster, ctx.cfg, {});
  const out = c.polishSearchWeek(week, ctx);
  assert(c.compareScheduleQuality(q(out), q(week)) < 0, 'the polish moves overtime off x');
  assert(out.ns.Saturday__first.some(v => v.employeeId === 'x' && v.locked), 'locked duty kept');
  assert.equal(q(out)[c.QUALITY.hard], 0);
  const again = c.polishSearchWeek(out, ctx);
  assert(c.compareScheduleQuality(q(again), q(out)) <= 0);
});
