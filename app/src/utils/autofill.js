// ── Auto-Fill Engine ──────────────────────────────────────────────────────────
// Goal: each employee works consecutive days on a consistent shift, then takes
// their days off together — matching preferredShift and preferredDaysOff as
// closely as possible.
//
// Steps:
//   1. Pre-assign each employee a shift + rotating work-block plan for the week
//   2. Build qualification peer groups for fairness scoring
//   3. Fill slots in chronological order using scored ranking
//   4. FT makeup pass — bring any FT employee still under 40h up to exactly 40h
//   5. PT fill pass — fill remaining open slots with part-time employees
//   5b. On-call fill pass — last resort
//   6. Violation minimizer — swap out hard-violation assignments

import {
  DAYS, SHIFTS, POSITIONS, EXT_PAIRS, FT_MIN_HOURS, SHIFT_HOURS,
  MAX_CONSECUTIVE_NIGHTS, MIN_REST_HOURS,
  REGULAR_SLOTS, SUP_SLOT_DAY, getAvailPos, cellKey, isWeekday, ALL_SLOTS,
} from "../constants/index.js";
import {
  calcHours, calcRestGap, calcConsecutiveNights, calcConsecutiveHours,
  isRestViolation, empMaxConsec,
} from "./hours.js";
import { slotHasRole, extCovers } from "./validation.js";

const OT_RELIEF_THRESHOLD = 48;

// Guard-only: qualifications contain Guard but NOT Scale or Medical
export const isGuardOnly = (e) => {
  const q = e.qualifications || [];
  return q.includes("Guard") && !q.includes("Scale") && !q.includes("Medical");
};

// Supervisor position rules
export const canFillPos = (emp, pos, day) => {
  const isSup = (emp.qualifications || []).includes("Supervisor");
  if (isSup && isWeekday(day)) return pos === "Supervisor";
  if (isSup && (pos === "Scale" || pos === "Medical")) return false;
  return (emp.qualifications || []).includes(pos);
};

const isSupLastResort = (emp, pos, day) =>
  !isWeekday(day) &&
  (emp.qualifications || []).includes("Supervisor") &&
  (pos === "Scale" || pos === "Medical");

const dayIdx = (d) => DAYS.indexOf(d);

// ── Time-off helpers ──────────────────────────────────────────────────────────
export function timeOffCoversSlot(req, dayName, shiftId, weekStartISO) {
  if (req.status !== "approved") return false;
  const weekBase = new Date(weekStartISO + "T00:00:00");
  const di = DAYS.indexOf(dayName);
  const slotDate = new Date(weekBase);
  slotDate.setDate(weekBase.getDate() + di);
  const slotISO = slotDate.toISOString().slice(0, 10);
  if (slotISO < req.startDate || slotISO > req.endDate) return false;
  if (req.type === "partial" && req.shiftId !== shiftId) return false;
  return true;
}

export function getTimeOffForDay(timeOffRequests, empId, dayName, weekStartISO, shiftId) {
  return (timeOffRequests || []).filter(r =>
    r.empId === empId &&
    timeOffCoversSlot(r, dayName, shiftId ?? "first", weekStartISO) &&
    (shiftId == null || r.type !== "partial" || r.shiftId === shiftId)
  );
}

// ── Violation Minimizer (Step 6) ──────────────────────────────────────────────
export function violationMinimizerPass(ns, sourceEmps, cfg, empTimeOffDays, extShiftsArg, plan, hourTracker, shiftsWorked) {
  const maxNights = cfg?.maxConsecutiveNights ?? MAX_CONSECUTIVE_NIGHTS;
  const minRest   = cfg?.minRestHours ?? MIN_REST_HOURS;
  const MAX_SWEEPS = 3;
  const isFT  = (e) => e.employmentType === "full-time";
  const isSup = (e) => (e.qualifications || []).includes("Supervisor");

  const isClean = (emp, day, shiftId, sched) => {
    if ((emp.unavailableDays || []).includes(day)) return false;
    if (empTimeOffDays && empTimeOffDays.has(emp.id + "__" + day)) return false;
    if ((emp.blockedShifts || []).includes(shiftId)) return false;
    if (emp.requiredShift && emp.requiredShift !== shiftId) return false;
    if (isFT(emp) && !isSup(emp)) {
      const p = plan[emp.id];
      if (p && p.shiftId !== shiftId) return false;
    }
    if (isRestViolation(emp, calcRestGap(emp.id, sched, day, shiftId), minRest)) return false;
    if (calcConsecutiveHours(emp.id, sched, day, shiftId) > empMaxConsec(emp)) return false;
    if (shiftId === "third" && calcConsecutiveNights(emp.id, sched, day, shiftId) >= maxNights) return false;
    return true;
  };

  const severity = (emp, day, shiftId) => {
    if ((emp.unavailableDays || []).includes(day)) return 100;
    if (empTimeOffDays && empTimeOffDays.has(emp.id + "__" + day)) return 95;
    if ((emp.blockedShifts || []).includes(shiftId)) return 90;
    if (emp.requiredShift && emp.requiredShift !== shiftId) return 80;
    if (isFT(emp) && !isSup(emp)) {
      const p = plan[emp.id];
      if (p && p.shiftId !== shiftId) return 70;
    }
    return 0;
  };

  let fixCount = 0;
  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    let swapsThisSweep = 0;
    for (const day of DAYS) {
      for (const shift of SHIFTS) {
        const key  = cellKey(day, shift.id);
        const asgn = ns[key] || [];
        for (let ai = 0; ai < asgn.length; ai++) {
          const a   = asgn[ai];
          const emp = sourceEmps.find(e => e.id === a.employeeId);
          if (!emp || severity(emp, day, shift.id) === 0) continue;
          const testSched = { ...ns, [key]: ns[key].filter(x => x.employeeId !== emp.id) };
          const candidates = sourceEmps.filter(cand => {
            if (cand.id === emp.id) return false;
            if (!canFillPos(cand, a.position, day)) return false;
            if (asgn.some(x => x.employeeId === cand.id)) return false;
            if ((extShiftsArg || []).some(ext => {
              const pair = EXT_PAIRS.find(p => p.id === ext.pairId);
              if (!pair || !pair.covers.includes(shift.id)) return false;
              return ext.empAId === cand.id || ext.empBId === cand.id;
            })) return false;
            if (!isClean(cand, day, shift.id, testSched)) return false;
            if (isFT(cand) && (hourTracker[cand.id] || 0) >= OT_RELIEF_THRESHOLD) return false;
            if (cand.employmentType === "on-call") return false;
            return true;
          });
          if (!candidates.length) continue;
          candidates.sort((ca, cb) => {
            const ha = hourTracker[ca.id] || 0, hb = hourTracker[cb.id] || 0;
            const au = isFT(ca) && ha < FT_MIN_HOURS, bu = isFT(cb) && hb < FT_MIN_HOURS;
            if (au && !bu) return -1; if (!au && bu) return 1;
            return ha - hb;
          });
          const winner = candidates[0];
          ns[key] = [...asgn.slice(0, ai), { employeeId: winner.id, position: a.position }, ...asgn.slice(ai + 1)];
          hourTracker[emp.id]     = Math.max(0, (hourTracker[emp.id] || 0) - SHIFT_HOURS);
          hourTracker[winner.id]  = (hourTracker[winner.id] || 0) + SHIFT_HOURS;
          shiftsWorked[winner.id] = (shiftsWorked[winner.id] || 0) + 1;
          swapsThisSweep++; fixCount++;
          break;
        }
      }
    }
    if (swapsThisSweep === 0) break;
  }
  return { ns, fixCount };
}

// ── Main Auto-Fill Builder ────────────────────────────────────────────────────
export function buildAutoFill(sourceEmps, cfg, empTimeOffDays, empPatterns, extShiftsArg) {
  const maxNights  = cfg?.maxConsecutiveNights ?? MAX_CONSECUTIVE_NIGHTS;
  const minRest    = cfg?.minRestHours ?? MIN_REST_HOURS;
  const maxShifts  = cfg?.maxConsecutiveShifts ?? 5;
  const daysOff    = Math.max(1, 7 - maxShifts);
  const ns         = {};
  const hourTracker  = {};
  const dayWorked    = {};
  const shiftsWorked = {};
  sourceEmps.forEach(e => {
    hourTracker[e.id]  = 0;
    dayWorked[e.id]    = new Set();
    shiftsWorked[e.id] = 0;
  });

  // ── Step 1: Assign each employee a shift + work-block plan ───────────────
  const plan = {};
  const shiftGroups = { first: [], second: [], third: [], any: [] };

  sourceEmps.forEach(e => {
    const prefs = e.preferredShifts || [];
    if ((e.qualifications || []).includes("Supervisor")) {
      shiftGroups.first.push(e);
    } else if (e.requiredShift && shiftGroups[e.requiredShift]) {
      shiftGroups[e.requiredShift].push(e);
    } else if (prefs.length === 1 && shiftGroups[prefs[0]]) {
      shiftGroups[prefs[0]].push(e);
    } else if (prefs.length > 1) {
      shiftGroups.any.push(e);
    } else if (empPatterns && empPatterns[e.id]?.shiftId && shiftGroups[empPatterns[e.id].shiftId]) {
      shiftGroups[empPatterns[e.id].shiftId].push(e);
    } else {
      shiftGroups.any.push(e);
    }
  });

  const shiftNeeds = SHIFTS.map(s => ({ id: s.id, count: shiftGroups[s.id].length }));
  shiftGroups.any.forEach(e => {
    const lightest = shiftNeeds.slice().sort((a, b) => a.count - b.count)[0];
    shiftGroups[lightest.id].push(e);
    lightest.count++;
  });

  SHIFTS.forEach(shift => {
    const group = shiftGroups[shift.id];
    if (!group.length) return;
    const ftGroupSize = group.filter(e => e.employmentType === "full-time").length || 1;
    let ftIdx = 0;

    group.forEach((emp) => {
      const freshBlockStart = Math.floor((ftIdx / ftGroupSize) * 7);
      const prevPattern = empPatterns && empPatterns[emp.id];
      const freshBlockStartEff = emp.requiredShift ? 0 : freshBlockStart;
      const rotationMode = cfg?.rotationMode ?? "fixed";
      const advancement = rotationMode === "rolling" ? 1 : (maxShifts + daysOff);
      const blockStart = prevPattern?.blockStart !== undefined
        ? (prevPattern.blockStart + advancement) % 7
        : freshBlockStartEff;

      const preferredOff = new Set(emp.preferredDaysOff || []);
      const workDays = new Set();
      let placed = 0;

      for (let offset = 0; offset < 7 && placed < maxShifts; offset++) {
        const d = DAYS[(blockStart + offset) % 7];
        if (!preferredOff.has(d) && !(emp.unavailableDays || []).includes(d)) {
          workDays.add(d); placed++;
        }
      }
      if (placed < maxShifts) {
        for (let offset = 0; offset < 7 && placed < maxShifts; offset++) {
          const d = DAYS[(blockStart + offset) % 7];
          if (!workDays.has(d) && !(emp.unavailableDays || []).includes(d)) {
            workDays.add(d); placed++;
          }
        }
      }

      if (emp.employmentType !== "full-time") {
        const ptAvail = new Set(DAYS.filter(d =>
          !(emp.unavailableDays || []).includes(d) && !(emp.preferredDaysOff || []).includes(d)
        ));
        const ptWorkDays = ptAvail.size > 0 ? ptAvail
          : new Set(DAYS.filter(d => !(emp.unavailableDays || []).includes(d)));
        plan[emp.id] = { shiftId: shift.id, workDays: ptWorkDays, isPT: true, maxShiftsPerWeek: emp.maxShiftsPerWeek ?? null };
      } else if ((emp.qualifications || []).includes("Supervisor")) {
        const supWorkDays = new Set(DAYS.filter(d => isWeekday(d) && !(emp.unavailableDays || []).includes(d)));
        let supPlaced = supWorkDays.size;
        for (let offset = 0; offset < 7 && supPlaced < maxShifts; offset++) {
          const d = DAYS[(blockStart + offset) % 7];
          if (!supWorkDays.has(d) && !(emp.unavailableDays || []).includes(d)) {
            supWorkDays.add(d); supPlaced++;
          }
        }
        plan[emp.id] = { shiftId: "first", workDays: supWorkDays, maxShiftsPerWeek: emp.maxShiftsPerWeek ?? null, blockStart };
      } else {
        plan[emp.id] = { shiftId: shift.id, workDays, maxShiftsPerWeek: emp.maxShiftsPerWeek ?? null, blockStart };
      }
      if (emp.employmentType === "full-time") ftIdx++;
    });
  });

  // ── Step 2: Qualification peer groups for fairness scoring ───────────────
  const qualGroups = {};
  POSITIONS.forEach(pos => {
    qualGroups[pos] = sourceEmps.filter(e => e.qualifications.includes(pos)).map(e => e.id);
  });
  const peerMinHours = (emp) => {
    const peerIds = new Set();
    emp.qualifications.forEach(q => (qualGroups[q] || []).forEach(id => peerIds.add(id)));
    peerIds.delete(emp.id);
    if (!peerIds.size) return 0;
    return Math.min(...[...peerIds].map(id => hourTracker[id] || 0));
  };

  // ── Score function ────────────────────────────────────────────────────────
  const empScore = (emp, day, shiftId, targetPos) => {
    if ((emp.unavailableDays || []).includes(day)) return null;
    if (empTimeOffDays && empTimeOffDays.has(emp.id + "__" + day)) return null;
    if (!getAvailPos(day, shiftId).some(p => emp.qualifications.includes(p))) return null;
    if (isRestViolation(emp, calcRestGap(emp.id, ns, day, shiftId), minRest)) return null;
    if (calcConsecutiveHours(emp.id, ns, day, shiftId) > empMaxConsec(emp)) return null;
    if (shiftId === "third" && calcConsecutiveNights(emp.id, ns, day, shiftId) >= maxNights) return null;
    if (emp.requiredShift && emp.requiredShift !== shiftId) return null;
    if ((emp.blockedShifts || []).includes(shiftId)) return null;
    const isSupervisorEmp = (emp.qualifications || []).includes("Supervisor");
    if (isSupervisorEmp && isWeekday(day)) return null;

    const empPlan  = plan[emp.id];
    const myHours  = hourTracker[emp.id] || 0;
    const isFT     = emp.employmentType === "full-time";
    const empMaxW  = empPlan?.maxShiftsPerWeek ?? emp.maxShiftsPerWeek ?? null;
    if (empMaxW !== null && (shiftsWorked[emp.id] || 0) >= empMaxW) return null;
    if (isFT && empPlan && empPlan.shiftId !== shiftId) return null;

    const ptPrefMismatch = (!isFT && (emp.preferredShifts || []).length > 0
      && !(emp.preferredShifts || []).includes(shiftId)) ? 800 : 0;
    const shiftMismatch  = empPlan && empPlan.shiftId === shiftId ? 0 : 20;
    const onPlannedShift = shiftMismatch + ptPrefMismatch;
    const onWorkDay      = empPlan && empPlan.workDays.has(day) ? 0 : (isFT ? 40 : 10);

    const todayIdx = dayIdx(day);
    const prevTail = (empPatterns && empPatterns[emp.id]?.trailingDays) || 0;
    let consec = 0;
    for (let i = todayIdx - 1; i >= 0; i--) {
      if (dayWorked[emp.id].has(DAYS[i])) consec++; else break;
    }
    if (todayIdx > 0 && consec === todayIdx && prevTail) consec += prevTail;
    if (consec >= maxShifts) return null;

    const empAvailPos = getAvailPos(day, shiftId).filter(p => emp.qualifications.includes(p));
    const anyQualFtAvailableUnder40 = !isFT && empAvailPos.some(pos =>
      (qualGroups[pos] || []).some(id => {
        const peer = sourceEmps.find(e => e.id === id);
        if (!peer || peer.employmentType !== "full-time") return false;
        if ((hourTracker[id] || 0) >= FT_MIN_HOURS) return false;
        if ((peer.unavailableDays || []).includes(day)) return false;
        if ((peer.blockedShifts || []).includes(shiftId)) return false;
        if (peer.requiredShift && peer.requiredShift !== shiftId) return false;
        if (!getAvailPos(day, shiftId).some(p => peer.qualifications.includes(p))) return false;
        const peerPlan = plan[id];
        if (peerPlan && !peerPlan.workDays.has(day)) return false;
        return true;
      })
    );
    const ptPenalty = anyQualFtAvailableUnder40 ? 200 : 0;

    const hasPtOption = emp.qualifications.some(q =>
      (qualGroups[q] || []).some(id => {
        const peer = sourceEmps.find(e => e.id === id);
        if (!peer || peer.employmentType === "full-time") return false;
        if (!getAvailPos(day, shiftId).some(p => peer.qualifications.includes(p))) return false;
        if ((peer.unavailableDays || []).includes(day)) return false;
        if ((peer.blockedShifts || []).includes(shiftId)) return false;
        if (peer.requiredShift && peer.requiredShift !== shiftId) return false;
        const peerPrefs = peer.preferredShifts || [];
        if (peerPrefs.length > 0 && !peerPrefs.includes(shiftId)) return false;
        return true;
      })
    );

    const empOtPref = emp.overtimePref && emp.overtimePref !== "neutral"
      ? emp.overtimePref : (cfg?.defaultOvertimePref || "neutral");
    const otPref = isFT ? empOtPref : "neutral";
    if (isFT && myHours >= FT_MIN_HOURS && otPref === "blocked") return null;

    const ftOtPenalty  = (isFT && myHours >= FT_MIN_HOURS && hasPtOption && otPref !== "preferred") ? 600 : 0;
    const fairPenalty  = Math.max(0, myHours - peerMinHours(emp)) * 15;

    let underHoursBoost = 0;
    if (isFT && myHours < FT_MIN_HOURS && ptPenalty === 0 && ftOtPenalty === 0) {
      const daysProcessed = dayIdx(day) + 1;
      const pace = Math.round(FT_MIN_HOURS * daysProcessed / 7);
      const behindBy = Math.max(0, pace - myHours);
      underHoursBoost = Math.min(behindBy * 15, onWorkDay + fairPenalty);
    }

    const supWeekendPenalty = ((emp.qualifications || []).includes("Supervisor") && !isWeekday(day)) ? 2000 : 0;

    const quals = emp.qualifications || [];
    const isGuardSlot     = targetPos === "Guard";
    const hasSpecialist   = quals.includes("Scale") || quals.includes("Medical");
    const specialistCount = (quals.includes("Scale") ? 1 : 0) + (quals.includes("Medical") ? 1 : 0);
    const roleStretchPenalty = isGuardSlot && hasSpecialist ? (specialistCount >= 2 ? 250 : 150) : 0;

    return onPlannedShift + onWorkDay + ptPenalty + ftOtPenalty + fairPenalty
      - underHoursBoost + supWeekendPenalty + roleStretchPenalty;
  };

  // ── Step 3: Fill the schedule slot by slot ────────────────────────────────
  for (const day of DAYS) {
    for (const shift of SHIFTS) {
      const key  = cellKey(day, shift.id);
      const asgn = [];
      const used = new Set();

      (extShiftsArg || []).forEach(ext => {
        const pair = EXT_PAIRS.find(p => p.id === ext.pairId);
        if (!pair) return;
        const idx = pair.covers.indexOf(shift.id);
        if (idx === 0 && ext.empAId) used.add(ext.empAId);
        if (idx === 1 && ext.empBId) used.add(ext.empBId);
      });

      const rankScoreRelaxed = (emp, shiftId) => {
        const empPlan = plan[emp.id];
        const isFT = emp.employmentType === "full-time";
        if (!isFT) return null;
        if (empPlan && empPlan.shiftId !== shiftId) return null;
        if ((emp.unavailableDays || []).includes(day)) return null;
        if (empTimeOffDays && empTimeOffDays.has(emp.id + "__" + day)) return null;
        if ((emp.blockedShifts || []).includes(shiftId)) return null;
        const myHours = hourTracker[emp.id] || 0;
        if (myHours >= OT_RELIEF_THRESHOLD) return null;
        if (isRestViolation(emp, calcRestGap(emp.id, ns, day, shiftId), minRest)) return null;
        if (calcConsecutiveHours(emp.id, ns, day, shiftId) > empMaxConsec(emp)) return null;
        const restDayPenalty = (empPlan && !empPlan.workDays.has(day)) ? 500 : 0;
        const fairPenalty    = Math.max(0, myHours - peerMinHours(emp)) * 15;
        return restDayPenalty + fairPenalty + (myHours >= FT_MIN_HOURS ? 600 : 0);
      };

      const assign = (emp, position) => {
        hourTracker[emp.id]  = (hourTracker[emp.id] || 0) + SHIFT_HOURS;
        shiftsWorked[emp.id] = (shiftsWorked[emp.id] || 0) + 1;
        dayWorked[emp.id].add(day);
        asgn.push({ employeeId: emp.id, position });
        used.add(emp.id);
      };

      const regularCount = () => asgn.filter(a => a.position !== "Supervisor").length;

      const activeExts = (extShiftsArg || []).filter(e => extCovers(e, day, shift.id));
      const extBodyCount = activeExts.reduce((n, ext) => {
        const pair = EXT_PAIRS.find(p => p.id === ext.pairId);
        if (!pair) return n;
        const idx = pair.covers.indexOf(shift.id);
        return n + ((idx === 0 ? !!ext.empAId : idx === 1 ? !!ext.empBId : false) ? 1 : 0);
      }, 0);
      const effectiveSlots = Math.max(0, REGULAR_SLOTS(day, shift.id) - extBodyCount);

      const extRoleCheck = (role) => activeExts.some(e => {
        const pair = EXT_PAIRS.find(p => p.id === e.pairId);
        if (!pair) return false;
        const idx = pair.covers.indexOf(shift.id);
        const presentId  = idx === 0 ? e.empAId : idx === 1 ? e.empBId : null;
        const presentEmp = presentId ? sourceEmps.find(x => x.id === presentId) : null;
        const roles = presentEmp
          ? ["Scale", "Medical"].filter(r => presentEmp.qualifications.includes(r))
          : (e.roles || []);
        return roles.includes(role);
      });
      const extAlreadyScale   = extRoleCheck("Scale");
      const extAlreadyMedical = extRoleCheck("Medical");

      // Supervisor slot (weekday 1st only)
      if (SUP_SLOT_DAY(day, shift.id)) {
        const supPick = sourceEmps.find(e =>
          !used.has(e.id) &&
          (e.qualifications || []).includes("Supervisor") &&
          !(e.unavailableDays || []).includes(day) &&
          !(empTimeOffDays && empTimeOffDays.has(e.id + "__" + day))
        );
        if (supPick) assign(supPick, "Supervisor");
      }

      const ranked = sourceEmps
        .map(e => { const s = empScore(e, day, shift.id); return s === null ? null : { e, s }; })
        .filter(Boolean)
        .sort((a, b) => a.s - b.s);

      // Required roles first: Scale, then Medical
      for (const role of ["Scale", "Medical"]) {
        if (regularCount() >= effectiveSlots) break;
        if (asgn.some(a => a.position === role)) continue;
        if (role === "Scale"   && extAlreadyScale)   continue;
        if (role === "Medical" && extAlreadyMedical) continue;
        const pick = ranked.find(({ e }) => !used.has(e.id) && canFillPos(e, role, day) && !isSupLastResort(e, role, day))
                  || ranked.find(({ e }) => !used.has(e.id) && canFillPos(e, role, day));
        if (pick) assign(pick.e, role);
      }

      const hasGuardOnlyAvailable = () =>
        sourceEmps.some(e =>
          !used.has(e.id) && isGuardOnly(e) &&
          canFillPos(e, "Guard", day) &&
          empScore(e, day, shift.id, "Guard") !== null
        );

      const WEEKEND_DAYS = new Set(["Saturday", "Sunday"]);
      const isWeekendDay = WEEKEND_DAYS.has(day);
      const weekendDaysWorked = (empId) =>
        [...(dayWorked[empId] || new Set())].filter(d => WEEKEND_DAYS.has(d)).length;
      const atWeekendCap = (emp) =>
        isWeekendDay && emp.maxWeekendDays != null &&
        weekendDaysWorked(emp.id) >= emp.maxWeekendDays;

      const buildRankedPos = () => {
        const nowHasSc = slotHasRole(asgn, sourceEmps, "Scale");
        const nowHasMd = slotHasRole(asgn, sourceEmps, "Medical");
        return sourceEmps
          .map(e => {
            const ap = getAvailPos(day, shift.id).filter(p => canFillPos(e, p, day));
            if (!ap.length) return null;
            const needSc = !nowHasSc && !extAlreadyScale;
            const needMe = !nowHasMd && !extAlreadyMedical;
            const likelyPos = (needSc && ap.includes("Scale"))   ? "Scale"
                            : (needMe && ap.includes("Medical")) ? "Medical"
                            : ap.includes("Guard")               ? "Guard"
                            : ap[0];
            const s = empScore(e, day, shift.id, likelyPos);
            return s === null ? null : { e, s, likelyPos };
          })
          .filter(Boolean)
          .sort((a, b) => a.s - b.s);
      };

      // Pass A: fill Scale/Medical + Guard-only employees for Guard slots
      for (const { e } of buildRankedPos()) {
        if (regularCount() >= effectiveSlots) break;
        if (used.has(e.id)) continue;
        const ap = getAvailPos(day, shift.id).filter(p => canFillPos(e, p, day));
        if (!ap.length) continue;
        const needScale   = !slotHasRole(asgn, sourceEmps, "Scale")   && !extAlreadyScale;
        const needMedical = !slotHasRole(asgn, sourceEmps, "Medical") && !extAlreadyMedical;
        let pos;
        if      (needScale   && ap.includes("Scale"))   pos = "Scale";
        else if (needMedical && ap.includes("Medical")) pos = "Medical";
        else if (ap.includes("Guard"))                  pos = "Guard";
        else pos = ap[0];
        if (pos === "Guard" && !isGuardOnly(e) && hasGuardOnlyAvailable()) continue;
        if (atWeekendCap(e)) continue;
        assign(e, pos);
      }

      // Pass B: allow specialists to fill Guard if needed
      if (regularCount() < effectiveSlots) {
        for (const { e } of buildRankedPos()) {
          if (regularCount() >= effectiveSlots) break;
          if (used.has(e.id)) continue;
          const ap = getAvailPos(day, shift.id).filter(p => canFillPos(e, p, day));
          if (!ap.length) continue;
          const needScale   = !slotHasRole(asgn, sourceEmps, "Scale")   && !extAlreadyScale;
          const needMedical = !slotHasRole(asgn, sourceEmps, "Medical") && !extAlreadyMedical;
          let pos;
          if      (needScale   && ap.includes("Scale"))   pos = "Scale";
          else if (needMedical && ap.includes("Medical")) pos = "Medical";
          else if (ap.includes("Guard"))                  pos = "Guard";
          else pos = ap[0];
          if (atWeekendCap(e)) continue;
          assign(e, pos);
        }
      }

      // Rest-day escape hatch
      const hatchNeedsScale   = !slotHasRole(asgn, sourceEmps, "Scale")   && !extAlreadyScale;
      const hatchNeedsMedical = !slotHasRole(asgn, sourceEmps, "Medical") && !extAlreadyMedical;
      if (regularCount() < effectiveSlots || hatchNeedsScale || hatchNeedsMedical) {
        const relaxed = sourceEmps
          .map(e => ({ e, score: rankScoreRelaxed(e, shift.id) }))
          .filter(x => x.score !== null && !used.has(x.e.id))
          .sort((a, b) => a.score - b.score);
        for (const { e } of relaxed) {
          const stillNeedsScale   = !slotHasRole(asgn, sourceEmps, "Scale")   && !extAlreadyScale;
          const stillNeedsMedical = !slotHasRole(asgn, sourceEmps, "Medical") && !extAlreadyMedical;
          if (regularCount() >= effectiveSlots && !stillNeedsScale && !stillNeedsMedical) break;
          if (regularCount() >= effectiveSlots) continue;
          const ap = getAvailPos(day, shift.id).filter(p => canFillPos(e, p, day));
          if (!ap.length) continue;
          let pos;
          if      (stillNeedsScale   && ap.includes("Scale"))   pos = "Scale";
          else if (stillNeedsMedical && ap.includes("Medical")) pos = "Medical";
          else if (ap.includes("Guard"))                        pos = "Guard";
          else pos = ap[0];
          if (pos === "Guard" && !isGuardOnly(e) && hasGuardOnlyAvailable()) continue;
          if (atWeekendCap(e)) continue;
          assign(e, pos);
        }
      }

      ns[key] = asgn;
    }
  }

  // ── Shared slot helpers for Steps 4/5/5b ─────────────────────────────────
  const slotCap = (day, shiftId) =>
    Math.max(0, REGULAR_SLOTS(day, shiftId) -
      (extShiftsArg || []).reduce((n, ext) => {
        const pair = EXT_PAIRS.find(p => p.id === ext.pairId);
        if (!pair) return n;
        const idx = pair.covers.indexOf(shiftId);
        return n + ((idx === 0 ? !!ext.empAId : idx === 1 ? !!ext.empBId : false) ? 1 : 0);
      }, 0));

  const slotAssigned = (asgn, day, shiftId) => {
    const s = new Set(asgn.map(a => a.employeeId));
    (extShiftsArg || []).forEach(ext => {
      const pair = EXT_PAIRS.find(p => p.id === ext.pairId);
      if (!pair) return;
      const idx = pair.covers.indexOf(shiftId);
      if (idx === 0 && ext.empAId) s.add(ext.empAId);
      if (idx === 1 && ext.empBId) s.add(ext.empBId);
    });
    return s;
  };

  const pickPosition = (emp, asgn, day, shiftId) => {
    const ap = getAvailPos(day, shiftId).filter(p => canFillPos(emp, p, day));
    if (!ap.length) return null;
    if (!slotHasRole(asgn, sourceEmps, "Scale")   && ap.includes("Scale"))   return "Scale";
    if (!slotHasRole(asgn, sourceEmps, "Medical") && ap.includes("Medical")) return "Medical";
    if (ap.includes("Guard")) return "Guard";
    return ap[0];
  };

  const weekendCapHit = (emp, day) => {
    if (!["Saturday", "Sunday"].includes(day)) return false;
    if (emp.maxWeekendDays == null) return false;
    const worked = [...(dayWorked[emp.id] || new Set())]
      .filter(d => ["Saturday", "Sunday"].includes(d)).length;
    return worked >= emp.maxWeekendDays;
  };

  // ── Step 4: FT makeup pass ────────────────────────────────────────────────
  const ftShort = () => sourceEmps.filter(e =>
    e.employmentType === "full-time" && (hourTracker[e.id] || 0) < FT_MIN_HOURS
  );

  for (let sweep = 0; sweep < 2 && ftShort().length > 0; sweep++) {
    for (const day of DAYS) {
      for (const shift of SHIFTS) {
        const key  = cellKey(day, shift.id);
        const asgn = ns[key] || [];
        const cap  = slotCap(day, shift.id);
        if (asgn.length >= cap) continue;
        const assigned = slotAssigned(asgn, day, shift.id);

        const candidates = ftShort()
          .filter(e => {
            const empPlan = plan[e.id];
            if (empPlan && empPlan.shiftId !== shift.id) return false;
            if (assigned.has(e.id)) return false;
            if ((e.unavailableDays || []).includes(day)) return false;
            if (empTimeOffDays && empTimeOffDays.has(e.id + "__" + day)) return false;
            if ((e.blockedShifts || []).includes(shift.id)) return false;
            if (e.requiredShift && e.requiredShift !== shift.id) return false;
            if (isRestViolation(e, calcRestGap(e.id, ns, day, shift.id), minRest)) return false;
            if (calcConsecutiveHours(e.id, ns, day, shift.id) > empMaxConsec(e)) return false;
            if (shift.id === "third" && calcConsecutiveNights(e.id, ns, day, shift.id) >= maxNights) return false;
            if (!getAvailPos(day, shift.id).some(p => e.qualifications.includes(p))) return false;
            return true;
          })
          .sort((a, b) => (hourTracker[a.id] || 0) - (hourTracker[b.id] || 0));

        for (const emp of candidates) {
          if (asgn.length >= cap) break;
          if ((hourTracker[emp.id] || 0) >= FT_MIN_HOURS) continue;
          const pos = pickPosition(emp, asgn, day, shift.id);
          if (!pos) continue;
          if (pos === "Guard" && !isGuardOnly(emp)) continue;
          if (weekendCapHit(emp, day)) continue;
          hourTracker[emp.id]  = (hourTracker[emp.id]  || 0) + SHIFT_HOURS;
          shiftsWorked[emp.id] = (shiftsWorked[emp.id] || 0) + 1;
          dayWorked[emp.id].add(day);
          asgn.push({ employeeId: emp.id, position: pos });
          assigned.add(emp.id);
        }
        ns[key] = asgn;
      }
    }
  }

  // ── Step 5: PT fill pass ──────────────────────────────────────────────────
  for (const day of DAYS) {
    for (const shift of SHIFTS) {
      const key  = cellKey(day, shift.id);
      const asgn = ns[key] || [];
      const cap  = slotCap(day, shift.id);
      if (asgn.length >= cap) continue;
      const assigned = slotAssigned(asgn, day, shift.id);

      const ptCandidates = sourceEmps
        .filter(e => {
          if (e.employmentType !== "part-time") return false;
          if (assigned.has(e.id)) return false;
          const prefs = e.preferredShifts || [];
          if (prefs.length > 0 && !prefs.includes(shift.id)) return false;
          if ((e.unavailableDays || []).includes(day)) return false;
          if (empTimeOffDays && empTimeOffDays.has(e.id + "__" + day)) return false;
          if ((e.blockedShifts || []).includes(shift.id)) return false;
          if (e.requiredShift && e.requiredShift !== shift.id) return false;
          if (isRestViolation(e, calcRestGap(e.id, ns, day, shift.id), minRest)) return false;
          if (calcConsecutiveHours(e.id, ns, day, shift.id) > empMaxConsec(e)) return false;
          if (shift.id === "third" && calcConsecutiveNights(e.id, ns, day, shift.id) >= maxNights) return false;
          if (!getAvailPos(day, shift.id).some(p => e.qualifications.includes(p))) return false;
          if (e.maxShiftsPerWeek !== null && (shiftsWorked[e.id] || 0) >= e.maxShiftsPerWeek) return false;
          return true;
        })
        .sort((a, b) => (hourTracker[a.id] || 0) - (hourTracker[b.id] || 0));

      for (const emp of ptCandidates) {
        if (asgn.length >= cap) break;
        const pos = pickPosition(emp, asgn, day, shift.id);
        if (!pos) continue;
        if (pos === "Guard" && !isGuardOnly(emp)) continue;
        if (weekendCapHit(emp, day)) continue;
        hourTracker[emp.id]  = (hourTracker[emp.id]  || 0) + SHIFT_HOURS;
        shiftsWorked[emp.id] = (shiftsWorked[emp.id] || 0) + 1;
        dayWorked[emp.id].add(day);
        asgn.push({ employeeId: emp.id, position: pos });
        assigned.add(emp.id);
      }
      ns[key] = asgn;
    }
  }

  // ── Step 5b: On-call fill pass ────────────────────────────────────────────
  for (const day of DAYS) {
    for (const shift of SHIFTS) {
      const key  = cellKey(day, shift.id);
      const asgn = ns[key] || [];
      const cap  = slotCap(day, shift.id);
      if (asgn.length >= cap) continue;
      const assigned = slotAssigned(asgn, day, shift.id);

      const ocCandidates = sourceEmps
        .filter(e => {
          if (e.employmentType !== "on-call") return false;
          if (assigned.has(e.id)) return false;
          const prefs = e.preferredShifts || [];
          if (prefs.length > 0 && !prefs.includes(shift.id)) return false;
          if ((e.unavailableDays || []).includes(day)) return false;
          if (empTimeOffDays && empTimeOffDays.has(e.id + "__" + day)) return false;
          if ((e.blockedShifts || []).includes(shift.id)) return false;
          if (e.requiredShift && e.requiredShift !== shift.id) return false;
          if (isRestViolation(e, calcRestGap(e.id, ns, day, shift.id), minRest)) return false;
          if (calcConsecutiveHours(e.id, ns, day, shift.id) > empMaxConsec(e)) return false;
          if (shift.id === "third" && calcConsecutiveNights(e.id, ns, day, shift.id) >= maxNights) return false;
          if (!getAvailPos(day, shift.id).some(p => e.qualifications.includes(p))) return false;
          if (e.maxShiftsPerWeek !== null && (shiftsWorked[e.id] || 0) >= e.maxShiftsPerWeek) return false;
          return true;
        })
        .sort((a, b) => (hourTracker[a.id] || 0) - (hourTracker[b.id] || 0));

      for (const emp of ocCandidates) {
        if (asgn.length >= cap) break;
        const pos = pickPosition(emp, asgn, day, shift.id);
        if (!pos) continue;
        if (pos === "Guard" && !isGuardOnly(emp)) continue;
        if (weekendCapHit(emp, day)) continue;
        hourTracker[emp.id]  = (hourTracker[emp.id]  || 0) + SHIFT_HOURS;
        shiftsWorked[emp.id] = (shiftsWorked[emp.id] || 0) + 1;
        dayWorked[emp.id].add(day);
        asgn.push({ employeeId: emp.id, position: pos, isOnCall: true });
        assigned.add(emp.id);
      }
      ns[key] = asgn;
    }
  }

  // Capture FT rotation patterns for week-to-week continuity
  const usedPatterns = {};
  Object.keys(plan).forEach(empId => {
    const p   = plan[empId];
    const emp = sourceEmps.find(e => e.id === empId);
    if (!emp || emp.employmentType !== "full-time") return;
    let trailingDays = 0;
    for (let i = DAYS.length - 1; i >= 0; i--) {
      const worked = SHIFTS.some(s => (ns[cellKey(DAYS[i], s.id)] || []).some(a => a.employeeId === empId));
      if (worked) trailingDays++; else break;
    }
    usedPatterns[empId] = { blockStart: p.blockStart ?? 0, shiftId: p.shiftId, trailingDays };
  });

  // ── Step 6: Violation minimizer ───────────────────────────────────────────
  const { fixCount } = violationMinimizerPass(
    ns, sourceEmps, cfg, empTimeOffDays, extShiftsArg, plan, hourTracker, shiftsWorked
  );
  if (fixCount > 0) console.log(`[AutoFill] Violation minimizer fixed ${fixCount} slot(s)`);

  return { schedule: ns, hourTracker, usedPatterns };
}
