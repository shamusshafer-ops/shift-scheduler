// ── Validation Utilities ──────────────────────────────────────────────────────
import {
  DAYS, SHIFTS, EXT_PAIRS, FT_MIN_HOURS,
  cellKey, slotHasRole as _slotHasRole,
} from "../constants/index.js";
import { calcHours } from "./hours.js";

// ── slotHasRole ───────────────────────────────────────────────────────────────
// Returns true when a slot has a given role covered — either by an assignment
// with that exact position, OR by any assigned employee who holds that qual.
// Exception: Supervisors assigned as "Supervisor" do NOT contribute their
// personal qualifications to role coverage.
export function slotHasRole(asgn, employees, role) {
  return asgn.some(a => {
    if (a.position === role) return true;
    if (a.position === "Supervisor") return false;
    const emp = employees ? employees.find(e => e.id === a.employeeId) : null;
    return emp && (emp.qualifications || []).includes(role);
  });
}

// ── extCovers ─────────────────────────────────────────────────────────────────
export const extCovers = (ext, day, shiftId) =>
  ext.day === day && EXT_PAIRS.find(p => p.id === ext.pairId)?.covers.includes(shiftId);

// ── Preference Violations ─────────────────────────────────────────────────────
export function getPreferenceViolations(emp, day, shiftId, schedule) {
  const v = [];
  const DAYS_LOCAL = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

  if ((emp.preferredDaysOff || []).includes(day)) {
    v.push({ type: "days_off", msg: `Scheduled on preferred day off (${day})` });
  }
  if ((emp.blockedShifts || []).includes(shiftId)) {
    const label = SHIFTS.find(s => s.id === shiftId)?.label || shiftId;
    v.push({ type: "blocked_shift", msg: `Placed on BLOCKED shift (${label})` });
  }
  if (emp.requiredShift && emp.requiredShift !== shiftId) {
    const shiftLabel = SHIFTS.find(s => s.id === shiftId)?.label || shiftId;
    const reqLabel   = SHIFTS.find(s => s.id === emp.requiredShift)?.label || emp.requiredShift;
    v.push({ type: "wrong_shift_required", msg: `REQUIRED ${reqLabel} — placed on ${shiftLabel}` });
  }
  const prefs = emp.preferredShifts || [];
  if (!emp.requiredShift && prefs.length > 0 && !prefs.includes(shiftId)) {
    const shiftLabel = SHIFTS.find(s => s.id === shiftId)?.label || shiftId;
    const prefLabels = prefs.map(p => SHIFTS.find(s => s.id === p)?.label || p).join(" or ");
    v.push({ type: "wrong_shift", msg: `On ${shiftLabel} (prefers ${prefLabels})` });
  }
  return v;
}

export function getAllPrefViolations(emp, schedule) {
  const all = [];
  DAYS.forEach(day => {
    SHIFTS.forEach(shift => {
      const asgn = schedule[cellKey(day, shift.id)] || [];
      if (!asgn.some(a => a.employeeId === emp.id)) return;
      getPreferenceViolations(emp, day, shift.id, schedule)
        .forEach(viol => all.push({ day, shiftId: shift.id, ...viol }));
    });
  });
  return all;
}

// ── enforceBusinessRules ──────────────────────────────────────────────────────
// Hard gate called before Save, Publish, and Export.
// Returns { violations: [], blocked: bool }
//
// Rules:
//   1. All FT employees must have >= 40 hours
//   2. Every shift must have >= 3 people (NON-NEGOTIABLE)
//   3. Every shift must have at least 1 Medical, 1 Scale, 1 other
export function enforceBusinessRules(schedule, employees, extShifts = []) {
  const violations = [];

  // Rule 1: FT employees >= 40h
  employees.forEach(emp => {
    if (emp.employmentType !== "full-time") return;
    const hours = calcHours(emp.id, schedule, extShifts);
    if (hours < FT_MIN_HOURS) {
      violations.push({
        rule: 1,
        level: "error",
        msg: `${emp.name} has only ${hours}h scheduled (minimum 40h required for full-time).`,
      });
    }
  });

  // Rules 2 & 3: per-shift checks
  DAYS.forEach(day => {
    SHIFTS.forEach(shift => {
      const key  = cellKey(day, shift.id);
      const asgn = schedule[key] || [];

      const cellExt = extShifts.filter(e => extCovers(e, day, shift.id));
      const extBodyCount = cellExt.reduce((n, ext) => {
        const pair = EXT_PAIRS.find(p => p.id === ext.pairId);
        if (!pair) return n;
        const idx = pair.covers.indexOf(shift.id);
        const hasBody = idx === 0 ? !!ext.empAId : idx === 1 ? !!ext.empBId : false;
        return n + (hasBody ? 1 : 0);
      }, 0);
      const totalBodies = asgn.length + extBodyCount;
      const shiftLabel  = `${day} ${shift.label} (${shift.time})`;

      // Rule 2: minimum 3 people
      if (totalBodies < 3) {
        violations.push({
          rule: 2,
          level: "error",
          msg: `${shiftLabel}: only ${totalBodies} person${totalBodies === 1 ? "" : "s"} scheduled (minimum 3 required).`,
        });
      }

      // Rule 3: must have Medical + Scale + 1 other
      const extHasScale   = cellExt.some(e => (e.roles || []).includes("Scale"));
      const extHasMedical = cellExt.some(e => (e.roles || []).includes("Medical"));
      const hasScale   = slotHasRole(asgn, employees, "Scale")   || extHasScale;
      const hasMedical = slotHasRole(asgn, employees, "Medical") || extHasMedical;

      if (!hasScale)   violations.push({ rule: 3, level: "error", msg: `${shiftLabel}: no Scale assigned.` });
      if (!hasMedical) violations.push({ rule: 3, level: "error", msg: `${shiftLabel}: no Medical assigned.` });
      if (hasScale && hasMedical && totalBodies < 3) {
        violations.push({
          rule: 3, level: "error",
          msg: `${shiftLabel}: Scale and Medical present but missing a 3rd person (Guard, 2nd Medic, or 2nd Scale).`,
        });
      }
    });
  });

  return { violations, blocked: violations.some(v => v.level === "error") };
}
