// ── Hours & Fatigue Utilities ─────────────────────────────────────────────────
import {
  DAYS, SHIFTS, SHIFT_HOURS, EXT_SHIFT_HOURS, EXT_PAIRS,
  ALL_SLOTS, SLOT_OFFSET_HOURS, MAX_CONSECUTIVE_HOURS,
  MAX_CONSECUTIVE_NIGHTS, MIN_REST_HOURS, cellKey,
} from "../constants/index.js";

// ── Basic Hours Calculator ────────────────────────────────────────────────────
export function calcHours(empId, schedule, extShifts = []) {
  let hours = 0;
  Object.values(schedule).forEach(a =>
    a.forEach(x => { if (x.employeeId === empId) hours += SHIFT_HOURS; })
  );
  extShifts.forEach(ext => {
    if (ext.empAId === empId || ext.empBId === empId) hours += EXT_SHIFT_HOURS;
  });
  return hours;
}

// ── Week Stats Summary ────────────────────────────────────────────────────────
export function computeWeekStats(schedule, employees, extShiftsArg = []) {
  const totalSlots = DAYS.reduce((n, d) =>
    SHIFTS.reduce((m, s) => m + (SUP_SLOT_DAY(d, s.id) ? 4 : 3), n), 0
  );
  let totalOk = 0, totalEmpty = 0, totalMissingRole = 0, totalOTHours = 0, underHoursFT = 0;
  const empHours = {};
  employees.forEach(e => { empHours[e.id] = 0; });

  DAYS.forEach(day => {
    SHIFTS.forEach(shift => {
      const asgn = schedule[cellKey(day, shift.id)] || [];
      asgn.forEach(a => { if (empHours[a.employeeId] !== undefined) empHours[a.employeeId] += SHIFT_HOURS; });
      const cellExt = extShiftsArg.filter(e => {
        const pair = EXT_PAIRS.find(p => p.id === e.pairId);
        return pair && e.day === day && pair.covers.includes(shift.id);
      });
      const extScale   = cellExt.some(e => (e.roles || []).includes("Scale"));
      const extMedical = cellExt.some(e => (e.roles || []).includes("Medical"));
      const hasScale   = asgn.some(a => {
        const emp = employees.find(x => x.id === a.employeeId);
        return a.position === "Scale" || (emp && emp.qualifications.includes("Scale"));
      }) || extScale;
      const hasMed = asgn.some(a => {
        const emp = employees.find(x => x.id === a.employeeId);
        return a.position === "Medical" || (emp && emp.qualifications.includes("Medical"));
      }) || extMedical;
      const max = SUP_SLOT_DAY(day, shift.id) ? 4 : 3;
      const extFilled = cellExt.length * 2;
      const effectiveFilled = Math.min(asgn.length + extFilled, max);
      if (!asgn.length && !extFilled) totalEmpty++;
      else if (!hasScale || !hasMed) totalMissingRole++;
      else if (effectiveFilled === max) totalOk++;
    });
  });

  employees.forEach(e => {
    const h = empHours[e.id] || 0;
    if (e.employmentType === "full-time" && h > 40) totalOTHours += h - 40;
    if (e.employmentType === "full-time" && h < 40) underHoursFT++;
  });

  const coveragePct = totalSlots > 0 ? Math.round((totalOk / totalSlots) * 100) : 0;
  return { coveragePct, totalEmpty, totalMissingRole, totalOTHours, underHoursFT, totalOk, totalSlots };
}

// ── Slot Index ────────────────────────────────────────────────────────────────
export const slotIndex = (day, shiftId) =>
  ALL_SLOTS.findIndex(s => s.day === day && s.shiftId === shiftId);

// ── Rest Gap ──────────────────────────────────────────────────────────────────
export function calcRestGap(empId, schedule, day, shiftId) {
  const myStart = SLOT_OFFSET_HOURS(day, shiftId);
  let prevEnd = -Infinity;
  ALL_SLOTS.forEach(({ day: d, shiftId: s }) => {
    const end = SLOT_OFFSET_HOURS(d, s) + SHIFT_HOURS;
    if (end > myStart) return;
    const asgn = schedule[cellKey(d, s)] || [];
    if (asgn.some(a => a.employeeId === empId)) {
      if (end > prevEnd) prevEnd = end;
    }
  });
  if (prevEnd === -Infinity) return Infinity;
  return myStart - prevEnd;
}

// ── Consecutive Nights ────────────────────────────────────────────────────────
export function calcConsecutiveNights(empId, schedule, upToDay, upToShiftId) {
  const idx = slotIndex(upToDay, upToShiftId);
  let count = 0;
  for (let i = idx; i >= 0; i--) {
    const { day, shiftId } = ALL_SLOTS[i];
    if (shiftId !== "third") { count = 0; continue; }
    const asgn = schedule[cellKey(day, shiftId)] || [];
    if (asgn.some(a => a.employeeId === empId)) count++;
    else break;
  }
  return count;
}

// ── Consecutive Hours ─────────────────────────────────────────────────────────
export function calcConsecutiveHours(empId, schedule, day, shiftId, extShifts = []) {
  const blocks = [];

  ALL_SLOTS.forEach(({ day: d, shiftId: s }) => {
    const asgn = schedule[cellKey(d, s)] || [];
    if (asgn.some(a => a.employeeId === empId)) {
      blocks.push([SLOT_OFFSET_HOURS(d, s), SLOT_OFFSET_HOURS(d, s) + SHIFT_HOURS]);
    }
  });

  extShifts.forEach(ext => {
    if (ext.empAId === empId || ext.empBId === empId) {
      const pair = EXT_PAIRS.find(p => p.id === ext.pairId);
      if (!pair) return;
      const dayIdx = DAYS.indexOf(ext.day);
      const startH = ext.pairId === "day" ? dayIdx * 24 + 6 : dayIdx * 24 + 18;
      blocks.push([startH, startH + EXT_SHIFT_HOURS]);
    }
  });

  const propStart = SLOT_OFFSET_HOURS(day, shiftId);
  blocks.push([propStart, propStart + SHIFT_HOURS]);
  blocks.sort((a, b) => a[0] - b[0]);

  const merged = [];
  for (const [s, e] of blocks) {
    if (merged.length && s <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], e);
    } else {
      merged.push([s, e]);
    }
  }

  const hit = merged.find(([s, e]) => s <= propStart && propStart < e);
  return hit ? hit[1] - hit[0] : SHIFT_HOURS;
}

// ── Rest Violation Check ──────────────────────────────────────────────────────
export const isRestViolation = (emp, gap, minRest) =>
  gap < minRest && !(emp.willing16h && gap === 0);

// ── Per-employee consecutive hour cap ────────────────────────────────────────
export const empMaxConsec = (emp) =>
  (emp && emp.willing16h) ? MAX_CONSECUTIVE_HOURS : SHIFT_HOURS;

// ── Fatigue Issues ────────────────────────────────────────────────────────────
export function getFatigueIssues(empId, schedule, cfg, employees) {
  const maxNights = cfg?.maxConsecutiveNights ?? MAX_CONSECUTIVE_NIGHTS;
  const minRest   = cfg?.minRestHours        ?? MIN_REST_HOURS;
  const maxShifts = cfg?.maxConsecutiveShifts ?? 5;
  const issues = [];

  ALL_SLOTS.forEach(({ day, shiftId }) => {
    const asgn = schedule[cellKey(day, shiftId)] || [];
    if (!asgn.some(a => a.employeeId === empId)) return;

    const nights = calcConsecutiveNights(empId, schedule, day, shiftId);
    if (nights > maxNights) {
      issues.push({ day, shiftId, type: "consecutive_nights", count: nights });
    }

    const rest = calcRestGap(empId, schedule, day, shiftId);
    if (rest < minRest && rest !== Infinity) {
      issues.push({ day, shiftId, type: "short_rest", restHours: Math.round(rest * 10) / 10 });
    }

    const emp = employees ? employees.find(e => e.id === empId) : null;
    const maxC = emp ? empMaxConsec(emp) : MAX_CONSECUTIVE_HOURS;
    const consecH = calcConsecutiveHours(empId, schedule, day, shiftId);
    if (consecH > maxC) {
      issues.push({ day, shiftId, type: "over_16h", hours: consecH, cap: maxC });
    }
  });

  return issues;
}
