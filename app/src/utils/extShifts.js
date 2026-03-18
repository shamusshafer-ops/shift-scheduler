// ── Extended Shift Utilities ──────────────────────────────────────────────────
import { EXT_PAIRS, cellKey } from "../constants/index.js";
import { slotHasRole } from "./validation.js";

// Does an extendedShift record cover a given (day, shiftId)?
export const extCovers = (ext, day, shiftId) =>
  ext.day === day && EXT_PAIRS.find(p => p.id === ext.pairId)?.covers.includes(shiftId);

// Get all extended shift records for a day
export const getExtForDay = (extShifts, day) => extShifts.filter(e => e.day === day);

// Which roles does an employee bring to an ext shift (Scale/Medical only)
export const extRoles = (emp) =>
  ["Scale", "Medical"].filter(r => emp.qualifications.includes(r));

// Can an employee work one half of a 12hr ext pair?
// slotIndex: 0 = first half (empA), 1 = second half (empB)
// ext12hPref: null=not available, "day"=day only, "night"=night only, "both"=either
export const canWorkExtHalf = (emp, pairId, slotIndex) => {
  const pair = EXT_PAIRS.find(p => p.id === pairId);
  if (!pair) return true;
  const shiftId = pair.covers[slotIndex];
  if ((emp.blockedShifts || []).includes(shiftId)) return false;
  if (emp.requiredShift && emp.requiredShift !== shiftId) return false;
  const pref = emp.ext12hPref || null;
  if (pref === null) return false;
  if (pref === "both") return true;
  if (pref === "day"   && pairId !== "day")   return false;
  if (pref === "night" && pairId !== "night") return false;
  return true;
};

// Human-readable reason why canWorkExtHalf returned false
export const extHalfConflictReason = (emp, pairId, slotIndex) => {
  const pair = EXT_PAIRS.find(p => p.id === pairId);
  if (!pair) return null;
  const shiftId = pair.covers[slotIndex];
  const label = { first: "1st", second: "2nd", third: "3rd" }[shiftId] || shiftId;
  if ((emp.blockedShifts || []).includes(shiftId))
    return `${emp.name} has ${label} shift blocked`;
  if (emp.requiredShift && emp.requiredShift !== shiftId)
    return `${emp.name} is locked to ${{ first:"1st", second:"2nd", third:"3rd" }[emp.requiredShift] || emp.requiredShift} shift`;
  const pref = emp.ext12hPref || null;
  if (pref === null) return `${emp.name} is not available for 12-hour shifts`;
  if (pref === "day"   && pairId !== "day")   return `${emp.name} is only available for Day 12hr shifts`;
  if (pref === "night" && pairId !== "night") return `${emp.name} is only available for Night 12hr shifts`;
  return null;
};

// Effective slot cap accounting for ext-shift bodies already covering this slot
export const getEffectiveSlotCount = (day, shiftId, extShifts = []) => {
  const base = (day === "Saturday" || day === "Sunday" ||
    !["Monday","Tuesday","Wednesday","Thursday","Friday"].includes(day) ||
    shiftId !== "first") ? 3 : 4;
  const extBodies = extShifts.reduce((n, ext) => {
    const pair = EXT_PAIRS.find(p => p.id === ext.pairId);
    if (!pair || !pair.covers.includes(shiftId)) return n;
    const idx = pair.covers.indexOf(shiftId);
    return n + ((idx === 0 ? !!ext.empAId : idx === 1 ? !!ext.empBId : false) ? 1 : 0);
  }, 0);
  return Math.max(0, base - extBodies);
};

// Find candidate 12hr extended shift pairs to cover a role gap on a given day.
// Returns up to 6 suggestions: { pairId, pair, day, empA, empB, neededRoles, coveredGaps }
export function findExtShiftPairs(day, employees, schedule, extShifts) {
  const pairs = [];

  for (const pair of EXT_PAIRS) {
    const coveredGaps = pair.covers.flatMap(shiftId => {
      const asgn = schedule[cellKey(day, shiftId)] || [];
      const missing = [];
      if (!slotHasRole(asgn, employees, "Scale"))   missing.push("Scale");
      if (!slotHasRole(asgn, employees, "Medical")) missing.push("Medical");
      return missing.map(role => ({ shiftId, role }));
    });
    if (!coveredGaps.length) continue;

    const alreadyUsed = extShifts.some(e => e.day === day && e.pairId === pair.id);
    if (alreadyUsed) continue;

    const neededRoles = [...new Set(coveredGaps.map(g => g.role))];

    const candidates = employees.filter(emp => {
      if ((emp.unavailableDays || []).includes(day)) return false;
      const alreadyInBoth = pair.covers.every(shiftId => {
        const asgn = schedule[cellKey(day, shiftId)] || [];
        return asgn.some(a => a.employeeId === emp.id);
      });
      if (alreadyInBoth) return false;
      return neededRoles.every(role => emp.qualifications.includes(role));
    });

    if (candidates.length < 1) continue;

    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const empA = candidates[i];
        const empB = candidates[j];
        const aRoles = extRoles(empA);
        const bRoles = extRoles(empB);
        const sharedRoles = neededRoles.filter(r => aRoles.includes(r) && bRoles.includes(r));
        if (sharedRoles.length !== neededRoles.length) continue;
        const aOk = canWorkExtHalf(empA, pair.id, 0) && canWorkExtHalf(empB, pair.id, 1);
        const bOk = canWorkExtHalf(empB, pair.id, 0) && canWorkExtHalf(empA, pair.id, 1);
        if (!aOk && !bOk) continue;
        const [finalA, finalB] = aOk ? [empA, empB] : [empB, empA];
        pairs.push({ pairId: pair.id, pair, day, empA: finalA, empB: finalB, neededRoles, coveredGaps });
        if (pairs.length >= 6) return pairs;
      }
    }

    // Single-person 12hr as last resort
    if (!pairs.length) {
      for (const emp of candidates) {
        if (neededRoles.every(r => emp.qualifications.includes(r))) {
          pairs.push({ pairId: pair.id, pair, day, empA: emp, empB: null, neededRoles, coveredGaps });
          break;
        }
      }
    }
  }
  return pairs;
}
