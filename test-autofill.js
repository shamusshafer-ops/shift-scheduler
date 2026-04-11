// test-autofill.js — VM-based test harness for buildAutoFill
//
// Extracts the plain <script> block from ShiftScheduler_latest loop.html,
// evals it in a Node VM with minimal browser stubs, then runs buildAutoFill
// against roster-backup-current.json under several scenarios and reports
// metrics. No mutations to the HTML. Writes test-autofill-baseline.json for
// future regression comparison.

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const HTML_PATH    = path.join(__dirname, 'ShiftScheduler_latest loop.html');
const ROSTER_PATH  = path.join(__dirname, 'roster-backup-current.json');
const BASELINE_OUT = path.join(__dirname, 'test-autofill-baseline.json');

const HTML   = fs.readFileSync(HTML_PATH,   'utf8');
const ROSTER = JSON.parse(fs.readFileSync(ROSTER_PATH, 'utf8'));

// ── Extract the plain <script> block (3rd <script> tag in the file) ─────────
function extractPlainScriptBlock(html) {
  const lines = html.split('\n');
  const starts = [];
  const ends   = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === '<script>') starts.push(i);
    if (t === '</script>') ends.push(i);
  }
  // Tags 0 and 1 are the two shim blocks; tag 2 is the main plain-JS block.
  if (starts.length < 3) throw new Error('Could not find plain script block');
  const start = starts[2] + 1;
  const end   = ends.find(e => e > start);
  if (end == null) throw new Error('Unterminated plain script block');
  return lines.slice(start, end).join('\n');
}

const scriptBody = extractPlainScriptBlock(HTML);

// The VM context's top-level `const` bindings aren't visible on the sandbox
// object, so we append an explicit exports epilog that assigns the symbols we
// need onto `globalThis` (which IS the sandbox inside the VM).
const EXPORTS = [
  'buildAutoFill', 'deployProactiveExtShifts', 'canWorkExtHalf', 'slotHasRole',
  'DAYS', 'SHIFTS', 'EXT_PAIRS', 'REGULAR_SLOTS', 'SUP_SLOT_DAY', 'cellKey',
  'SHIFT_HOURS', 'isWeekday', 'getSlotCount',
];
const scriptWithExports = scriptBody + '\n;(function(){\n' +
  EXPORTS.map(n => `  try { globalThis.${n} = ${n}; } catch(_) {}`).join('\n') +
  '\n})();\n';

// ── Browser stubs ──────────────────────────────────────────────────────────
const memStore = {};
const localStorageStub = {
  getItem: (k) => (k in memStore ? memStore[k] : null),
  setItem: (k, v) => { memStore[k] = String(v); },
  removeItem: (k) => { delete memStore[k]; },
  key: (i) => Object.keys(memStore)[i] || null,
  get length() { return Object.keys(memStore).length; },
};

const documentStub = { lastModified: new Date().toUTCString() };

// React stub — buildAutoFill/deployProactiveExtShifts don't actually call hooks,
// but the top-level `const { useState, ... } = React;` destructure needs these
// symbols to exist. `createElement` is only called by the Icon helper at render
// time, which we never reach.
const ReactStub = {
  createElement: () => null,
  useState: (v) => [v, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => (typeof fn === 'function' ? fn() : fn),
  useRef: (v) => ({ current: v }),
  useContext: () => null,
  useReducer: (_r, v) => [v, () => {}],
  createContext: () => ({ Provider: null, Consumer: null }),
  memo: (c) => c,
  Fragment: 'Fragment',
};

const windowStub = {}; // no .storage → lsGet/lsSet fall through to localStorage

// Quiet the script block's console.* chatter during eval; still surface real errors.
const ctxConsole = {
  log:   () => {},
  warn:  () => {},
  error: (...a) => console.error('[vm]', ...a),
};

const sandbox = {
  React:        ReactStub,
  window:       windowStub,
  document:     documentStub,
  localStorage: localStorageStub,
  console:      ctxConsole,
  // Globals that run-in-context doesn't auto-provide
  Math, Date, Array, Object, String, Number, Boolean, Set, Map, WeakMap, WeakSet,
  JSON, Promise, Symbol, Error, RegExp, Proxy, Reflect,
  isNaN, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
  setTimeout: () => 0, clearTimeout: () => {},
};
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);

try {
  vm.runInContext(scriptWithExports, ctx, { filename: 'ShiftScheduler::plain-script' });
} catch (e) {
  console.error('Failed to eval plain script block:');
  console.error(e);
  process.exit(1);
}

// ── Pull out what we need from the VM context ─────────────────────────────
const {
  buildAutoFill, deployProactiveExtShifts, canWorkExtHalf, slotHasRole,
  DAYS, SHIFTS, EXT_PAIRS, REGULAR_SLOTS, SUP_SLOT_DAY, cellKey,
  SHIFT_HOURS, isWeekday,
} = ctx;

if (typeof buildAutoFill !== 'function') {
  console.error('buildAutoFill not found on VM context after eval');
  process.exit(1);
}

// ── Standalone validateSchedule (adapted from HTML:9718-9848) ─────────────
// We keep it in the harness so the test doesn't depend on the Babel block.
function validateSchedule(sched, exts, emps) {
  const issues = [];
  const E = (msg) => issues.push({ level: 'error', msg });
  const W = (msg) => issues.push({ level: 'warn',  msg });
  const rmap = Object.fromEntries((emps || []).map(e => [e.id, e]));
  const allExts = exts || [];

  const extBodyCount = (day, shiftId) => {
    let n = 0;
    for (const ext of allExts) {
      const pair = EXT_PAIRS.find(p => p.id === ext.pairId);
      if (!pair) continue;
      const idx = pair.covers.indexOf(shiftId);
      if (idx === 0 && ext.empAId && ext.day === day) n++;
      if (idx === 1 && ext.empBId && ext.day === day) n++;
    }
    return n;
  };

  DAYS.forEach(day => {
    SHIFTS.forEach(shift => {
      const regNeed   = REGULAR_SLOTS(day, shift.id);
      const supNeed   = SUP_SLOT_DAY(day, shift.id) ? 1 : 0;
      const totalNeed = regNeed + supNeed;
      const key  = cellKey(day, shift.id);
      const asgn = sched[key] || [];
      const extBodies = extBodyCount(day, shift.id);
      const regCount  = asgn.length + extBodies;
      const supCount  = asgn.filter(a => a.position === 'Supervisor').length;
      const total     = regCount + supCount;

      if (total < totalNeed) {
        E(`Coverage gap: ${day} ${shift.id} ${total}/${totalNeed}`);
      }
      if (isWeekday(day) && shift.id === 'first' && supNeed > 0 && supCount === 0) {
        E(`No supervisor on ${day} 1st shift`);
      }

      // Role coverage (Scale/Medical) — warning only, matches app semantics.
      const regs = asgn.filter(a => a.position !== 'Supervisor');
      const hasScale   = regs.some(a => (rmap[a.employeeId]?.qualifications || []).includes('Scale'));
      const hasMedical = regs.some(a => (rmap[a.employeeId]?.qualifications || []).includes('Medical'));
      const extEmpsHere = allExts
        .filter(ext => ext.day === day)
        .flatMap(ext => {
          const pair = EXT_PAIRS.find(p => p.id === ext.pairId);
          if (!pair || pair.covers.indexOf(shift.id) < 0) return [];
          return [ext.empAId, ext.empBId].filter(Boolean).map(id => rmap[id]).filter(Boolean);
        });
      const extHasScale   = extEmpsHere.some(e => (e.qualifications || []).includes('Scale'));
      const extHasMedical = extEmpsHere.some(e => (e.qualifications || []).includes('Medical'));
      if (!hasScale   && !extHasScale)   W(`No Scale on ${day} ${shift.id}`);
      if (!hasMedical && !extHasMedical) W(`No Medical on ${day} ${shift.id}`);

      // Hard-constraint violations on this cell.
      for (const a of asgn) {
        const emp = rmap[a.employeeId];
        if (!emp) continue;
        if ((emp.unavailableDays || []).includes(day))
          E(`${emp.name} on unavailable day ${day} (${shift.id})`);
        if ((emp.blockedShifts || []).includes(shift.id))
          E(`${emp.name} on blocked shift ${shift.id} (${day})`);
        if (emp.requiredShift && emp.requiredShift !== shift.id)
          E(`${emp.name} on ${shift.id} but required ${emp.requiredShift} (${day})`);
      }
    });
  });

  // FT hour totals (regular shifts only — ext hours are extra).
  const hoursByEmp = {};
  DAYS.forEach(day => {
    SHIFTS.forEach(shift => {
      (sched[cellKey(day, shift.id)] || []).forEach(a => {
        hoursByEmp[a.employeeId] = (hoursByEmp[a.employeeId] || 0) + SHIFT_HOURS;
      });
    });
  });
  (emps || []).forEach(emp => {
    if (emp.employmentType !== 'full-time') return;
    const h = hoursByEmp[emp.id] || 0;
    if (h < 40) W(`${emp.name} has ${h}h (under 40h)`);
    if (h > 48) W(`${emp.name} has ${h}h (over 48h)`);
  });

  return issues;
}

// ── Metrics scorer ────────────────────────────────────────────────────────
function scoreRun(sched, exts, emps, elapsedMs) {
  const issues = validateSchedule(sched, exts, emps);
  const errors = issues.filter(i => i.level === 'error');
  const warns  = issues.filter(i => i.level === 'warn');
  const coverageErrors = errors.filter(e => /^Coverage gap/.test(e.msg)).length;
  const hardViolations = errors.length - coverageErrors;
  const ftUnder40 = warns.filter(w => /under 40h/.test(w.msg)).length;
  const ftOver48  = warns.filter(w => /over 48h/.test(w.msg)).length;
  const noScale   = warns.filter(w => /^No Scale/.test(w.msg)).length;
  const noMedical = warns.filter(w => /^No Medical/.test(w.msg)).length;

  const empMap = Object.fromEntries(emps.map(e => [e.id, e]));
  let prefShiftMisses = 0;
  let prefDayOffHits  = 0;
  let assignmentsTotal = 0;
  DAYS.forEach(day => {
    SHIFTS.forEach(shift => {
      const asgn = sched[cellKey(day, shift.id)] || [];
      assignmentsTotal += asgn.length;
      for (const a of asgn) {
        const emp = empMap[a.employeeId];
        if (!emp) continue;
        const prefs = emp.preferredShifts || [];
        if (prefs.length && !prefs.includes(shift.id)) prefShiftMisses++;
        if ((emp.preferredDaysOff || []).includes(day)) prefDayOffHits++;
      }
    });
  });

  return {
    elapsedMs,
    errors: errors.length,
    warns:  warns.length,
    coverageErrors,
    hardViolations,
    ftUnder40,
    ftOver48,
    noScale,
    noMedical,
    prefShiftMisses,
    prefDayOffHits,
    assignmentsTotal,
    extShifts: (exts || []).length,
    errorSample: errors.slice(0, 8).map(e => e.msg),
  };
}

// ── Reactive ext-shift loop (adapted from HTML:9905-10007) ────────────────
// Mirrors the app's post-CSP ext-shift placement so the baseline reflects
// the same ns/autoExtShifts the running app commits. swingDesig is left
// empty — baseline assumes no user-designated swing employees.
function runReactiveExtLoop(ns, source, proactiveExts, shiftsWorked) {
  const autoExtShifts = [...proactiveExts];
  const usedExtPairs  = new Set(proactiveExts.map(e => e.day + '__' + e.pairId));

  DAYS.forEach(day => {
    EXT_PAIRS.forEach(pair => {
      if (usedExtPairs.has(day + '__' + pair.id)) return;

      if (pair.isSwing) {
        const hasGap = pair.covers.some(shiftId => {
          const asgn = ns[cellKey(day, shiftId)] || [];
          const bodies = asgn.filter(a => !(source.find(x => x.id === a.employeeId)?.inTraining)).length;
          return bodies < REGULAR_SLOTS(day, shiftId);
        });
        if (!hasGap) return;
        const alreadyOnCoveredSlot = (empId) => pair.covers.some(shiftId =>
          (ns[cellKey(day, shiftId)] || []).some(a => a.employeeId === empId));
        const cands = source.filter(emp => {
          if ((emp.unavailableDays || []).includes(day)) return false;
          if (emp.maxShiftsPerWeek != null && (shiftsWorked[emp.id] || 0) >= emp.maxShiftsPerWeek) return false;
          if (alreadyOnCoveredSlot(emp.id)) return false;
          return canWorkExtHalf(emp, pair.id, 0);
        });
        if (!cands.length) return;
        const empA = cands[0];
        autoExtShifts.push({
          pairId: pair.id, day, empAId: empA.id, empBId: null,
          roles: ['Scale','Medical'].filter(r => empA.qualifications.includes(r)),
          approvedAt: 'auto-fill', auto: true,
        });
        usedExtPairs.add(day + '__' + pair.id);
        return;
      }

      // Standard 12-hr pair
      const neededRoles = [];
      pair.covers.forEach(shiftId => {
        const asgn = ns[cellKey(day, shiftId)] || [];
        if (!slotHasRole(asgn, source, 'Scale'))   neededRoles.push('Scale');
        if (!slotHasRole(asgn, source, 'Medical')) neededRoles.push('Medical');
      });
      const uniqueNeeded = [...new Set(neededRoles)];
      if (!uniqueNeeded.length) return;

      const hasRoom = pair.covers.every(shiftId => {
        const asgn = ns[cellKey(day, shiftId)] || [];
        const regCount = asgn.filter(a => a.position !== 'Supervisor').length;
        return regCount < REGULAR_SLOTS(day, shiftId);
      });
      if (!hasRoom) return;

      const onSlot = (empId, shiftId) =>
        (ns[cellKey(day, shiftId)] || []).some(a => a.employeeId === empId);

      const candidates = source.filter(emp => {
        if ((emp.unavailableDays || []).includes(day)) return false;
        if (pair.covers.every(s => onSlot(emp.id, s))) return false;
        if (!uniqueNeeded.every(r => (emp.qualifications || []).includes(r))) return false;
        if (emp.maxShiftsPerWeek != null && (shiftsWorked[emp.id] || 0) >= emp.maxShiftsPerWeek) return false;
        if (!emp.willing16h) return false;
        return canWorkExtHalf(emp, pair.id, 0) || canWorkExtHalf(emp, pair.id, 1);
      });

      for (let i = 0; i < candidates.length; i++) {
        for (let j = i + 1; j < candidates.length; j++) {
          const a = candidates[i], b = candidates[j];
          const abOk = canWorkExtHalf(a, pair.id, 0) && canWorkExtHalf(b, pair.id, 1)
                    && !onSlot(a.id, pair.covers[0]) && !onSlot(b.id, pair.covers[1]);
          const baOk = canWorkExtHalf(b, pair.id, 0) && canWorkExtHalf(a, pair.id, 1)
                    && !onSlot(b.id, pair.covers[0]) && !onSlot(a.id, pair.covers[1]);
          const [empA, empB] = abOk ? [a, b] : baOk ? [b, a] : [null, null];
          if (!empA || !empB) continue;
          const combinedRoles = [...new Set([
            ...['Scale','Medical'].filter(r => empA.qualifications.includes(r)),
            ...['Scale','Medical'].filter(r => empB.qualifications.includes(r)),
          ])];
          autoExtShifts.push({
            pairId: pair.id, day, empAId: empA.id, empBId: empB.id,
            roles: combinedRoles, approvedAt: 'auto-fill', auto: true,
          });
          usedExtPairs.add(day + '__' + pair.id);
          break;
        }
        if (usedExtPairs.has(day + '__' + pair.id)) break;
      }
    });
  });

  return autoExtShifts;
}

// ── Single non-jitter attempt ─────────────────────────────────────────────
function runAttempt(source, cfg, empTimeOffDays, empPatterns) {
  const t0 = Date.now();
  const proactiveExts = deployProactiveExtShifts(source, cfg, empTimeOffDays, []);
  const { schedule: ns, shiftsWorked } = buildAutoFill(
    source, cfg, empTimeOffDays, empPatterns || {}, [...proactiveExts], false
  );
  const autoExtShifts = runReactiveExtLoop(ns, source, proactiveExts, shiftsWorked);
  return { ns, autoExtShifts, elapsed: Date.now() - t0 };
}

// ── Scenarios ─────────────────────────────────────────────────────────────
const baseEmps = ROSTER.data.shift_employees;
const cfg      = ROSTER.data.shift_settings || {};

function ptoAllWeek(emps, nameFragment) {
  const target = emps.find(e => e.name.toLowerCase().includes(nameFragment.toLowerCase()));
  if (!target) throw new Error(`No employee matching "${nameFragment}"`);
  return emps.map(e => e.id === target.id
    ? { ...e, unavailableDays: [...DAYS] }
    : e);
}
function removeMatching(emps, pred) {
  return emps.filter(e => !pred(e));
}

const scenarios = [
  {
    name: 'base',
    describe: 'untouched roster',
    emps: baseEmps,
  },
  {
    name: 'harms-pto',
    describe: 'Harms unavailable all week',
    emps: ptoAllWeek(baseEmps, 'Harms'),
  },
  {
    name: 'no-2nd-shift-medical',
    describe: 'drop FT Medical employees assigned/preferring 2nd shift',
    emps: removeMatching(baseEmps, e =>
      e.employmentType === 'full-time' &&
      (e.qualifications || []).includes('Medical') &&
      (e.requiredShift === 'second' || (e.preferredShifts || []).includes('second'))),
  },
];

const results = {};
for (const sc of scenarios) {
  try {
    const { ns, autoExtShifts, elapsed } = runAttempt(sc.emps, cfg, null, {});
    const score = scoreRun(ns, autoExtShifts, sc.emps, elapsed);
    results[sc.name] = { describe: sc.describe, rosterSize: sc.emps.length, ...score };

    console.log(`\n── ${sc.name} (${sc.describe}, n=${sc.emps.length}) ──`);
    console.log(`   elapsed          ${elapsed}ms`);
    console.log(`   errors           ${score.errors}  (${score.coverageErrors} coverage, ${score.hardViolations} hard-violation)`);
    console.log(`   warns            ${score.warns}  (${score.ftUnder40} FT<40h, ${score.ftOver48} FT>48h, ${score.noScale} noScale, ${score.noMedical} noMedical)`);
    console.log(`   prefShiftMisses  ${score.prefShiftMisses}`);
    console.log(`   prefDayOffHits   ${score.prefDayOffHits}`);
    console.log(`   assignments      ${score.assignmentsTotal} regular slots`);
    console.log(`   ext-shifts       ${score.extShifts} placed`);
    if (score.errorSample.length) {
      console.log('   first errors:');
      for (const m of score.errorSample) console.log('     • ' + m);
    }
  } catch (e) {
    console.error(`\n── ${sc.name}: FAILED ──`);
    console.error(e);
    results[sc.name] = { describe: sc.describe, error: String(e) };
  }
}

fs.writeFileSync(BASELINE_OUT, JSON.stringify({
  capturedAt: new Date().toISOString(),
  rosterVersion: ROSTER._meta?.version || 'unknown',
  rosterSize: baseEmps.length,
  scenarios: results,
}, null, 2));

console.log(`\nBaseline → ${path.relative(process.cwd(), BASELINE_OUT)}`);
