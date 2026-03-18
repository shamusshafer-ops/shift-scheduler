import { describe, it, expect } from "vitest";
import { buildAutoFill } from "../../src/utils/autofill.js";
import { enforceBusinessRules } from "../../src/utils/validation.js";
import { FT_MIN_HOURS, DAYS, SHIFTS, cellKey } from "../../src/constants/index.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEmp(overrides) {
  return {
    id: overrides.id,
    name: overrides.name || overrides.id,
    employmentType: overrides.employmentType || "full-time",
    qualifications: overrides.qualifications || ["Guard"],
    unavailableDays: [],
    preferredShifts: overrides.preferredShifts || [],
    blockedShifts: [],
    requiredShift: null,
    preferredDaysOff: [],
    overtimePref: "neutral",
    willing16h: false,
    maxShiftsPerWeek: null,
    maxWeekendDays: null,
    ext12hPref: null,
    ...overrides,
  };
}

// 4 employees per shift is the maximum that lets everyone reach 40h:
// 3 slots/day × 7 days = 21 slot-days available per shift per week
// 4 employees × 5 days = 20 needed — leaves 1 slot for makeup pass
// All employees have Guard qual so they can fill any of the 3 roles
function minimalRoster() {
  return [
    // 1st shift — 4 employees
    makeEmp({ id: "1a", qualifications: ["Scale",   "Guard"], preferredShifts: ["first"]  }),
    makeEmp({ id: "1b", qualifications: ["Scale",   "Guard"], preferredShifts: ["first"]  }),
    makeEmp({ id: "1c", qualifications: ["Medical", "Guard"], preferredShifts: ["first"]  }),
    makeEmp({ id: "1d", qualifications: ["Medical", "Guard"], preferredShifts: ["first"]  }),
    // 2nd shift — 4 employees
    makeEmp({ id: "2a", qualifications: ["Scale",   "Guard"], preferredShifts: ["second"] }),
    makeEmp({ id: "2b", qualifications: ["Scale",   "Guard"], preferredShifts: ["second"] }),
    makeEmp({ id: "2c", qualifications: ["Medical", "Guard"], preferredShifts: ["second"] }),
    makeEmp({ id: "2d", qualifications: ["Medical", "Guard"], preferredShifts: ["second"] }),
    // 3rd shift — 4 employees
    makeEmp({ id: "3a", qualifications: ["Scale",   "Guard"], preferredShifts: ["third"]  }),
    makeEmp({ id: "3b", qualifications: ["Scale",   "Guard"], preferredShifts: ["third"]  }),
    makeEmp({ id: "3c", qualifications: ["Medical", "Guard"], preferredShifts: ["third"]  }),
    makeEmp({ id: "3d", qualifications: ["Medical", "Guard"], preferredShifts: ["third"]  }),
  ];
}

// ── Auto-fill output structure ────────────────────────────────────────────────
describe("buildAutoFill — output shape", () => {
  it("returns schedule, hourTracker, and usedPatterns", () => {
    const emps = minimalRoster();
    const { schedule, hourTracker, usedPatterns } = buildAutoFill(emps, {}, null, null, []);
    expect(schedule).toBeDefined();
    expect(hourTracker).toBeDefined();
    expect(usedPatterns).toBeDefined();
  });

  it("produces a slot for every day+shift combination", () => {
    const emps = minimalRoster();
    const { schedule } = buildAutoFill(emps, {}, null, null, []);
    DAYS.forEach(day => {
      SHIFTS.forEach(shift => {
        expect(schedule[cellKey(day, shift.id)]).toBeDefined();
      });
    });
  });
});

// ── Rule 1: FT employees >= 40h ──────────────────────────────────────────────
describe("buildAutoFill — Rule 1: FT employees must reach 40h", () => {
  it("gives every FT employee at least 40h with a large enough roster", () => {
    const emps = minimalRoster();
    const { schedule, hourTracker } = buildAutoFill(emps, {}, null, null, []);
    emps.filter(e => e.employmentType === "full-time").forEach(emp => {
      const hours = hourTracker[emp.id] || 0;
      expect(hours).toBeGreaterThanOrEqual(FT_MIN_HOURS);
    });
  });

  it("tracks hours correctly — hourTracker matches calcHours", () => {
    const { calcHours } = require("../../src/utils/hours.js");
    const emps = minimalRoster();
    const { schedule, hourTracker } = buildAutoFill(emps, {}, null, null, []);
    emps.forEach(emp => {
      const tracked  = hourTracker[emp.id] || 0;
      const computed = calcHours(emp.id, schedule, []);
      expect(tracked).toBe(computed);
    });
  });
});

// ── Rule 2: Minimum 3 people per shift ───────────────────────────────────────
describe("buildAutoFill — Rule 2: minimum 3 people per shift", () => {
  it("fills every shift to at least 3 with a sufficient roster", () => {
    const emps = minimalRoster();
    const { schedule } = buildAutoFill(emps, {}, null, null, []);
    DAYS.forEach(day => {
      SHIFTS.forEach(shift => {
        const asgn = schedule[cellKey(day, shift.id)] || [];
        expect(asgn.length).toBeGreaterThanOrEqual(3);
      });
    });
  });

  it("no shift has more than 3 regular bodies (no over-staffing)", () => {
    const emps = minimalRoster();
    const { schedule } = buildAutoFill(emps, {}, null, null, []);
    DAYS.forEach(day => {
      SHIFTS.forEach(shift => {
        const asgn = schedule[cellKey(day, shift.id)] || [];
        const regular = asgn.filter(a => a.position !== "Supervisor");
        expect(regular.length).toBeLessThanOrEqual(3);
      });
    });
  });
});

// ── Rule 3: Scale + Medical on every shift ───────────────────────────────────
describe("buildAutoFill — Rule 3: Scale and Medical on every shift", () => {
  it("places a Scale-qualified person on every shift", () => {
    const emps = minimalRoster();
    const { schedule } = buildAutoFill(emps, {}, null, null, []);
    DAYS.forEach(day => {
      SHIFTS.forEach(shift => {
        const asgn = schedule[cellKey(day, shift.id)] || [];
        const hasScale = asgn.some(a => {
          const emp = emps.find(e => e.id === a.employeeId);
          return a.position === "Scale" || (emp && emp.qualifications.includes("Scale"));
        });
        expect(hasScale).toBe(true);
      });
    });
  });

  it("places a Medical-qualified person on every shift", () => {
    const emps = minimalRoster();
    const { schedule } = buildAutoFill(emps, {}, null, null, []);
    DAYS.forEach(day => {
      SHIFTS.forEach(shift => {
        const asgn = schedule[cellKey(day, shift.id)] || [];
        const hasMedical = asgn.some(a => {
          const emp = emps.find(e => e.id === a.employeeId);
          return a.position === "Medical" || (emp && emp.qualifications.includes("Medical"));
        });
        expect(hasMedical).toBe(true);
      });
    });
  });
});

// ── enforceBusinessRules passes on a good auto-fill ──────────────────────────
describe("buildAutoFill — full schedule passes enforceBusinessRules", () => {
  it("produces a schedule with zero enforcement violations", () => {
    const emps = minimalRoster();
    const { schedule } = buildAutoFill(emps, {}, null, null, []);
    const { violations, blocked } = enforceBusinessRules(schedule, emps, []);
    if (violations.length > 0) {
      // Print failing violations to help debug
      violations.forEach(v => console.log("VIOLATION:", v.msg));
    }
    expect(blocked).toBe(false);
    expect(violations).toHaveLength(0);
  });
});

// ── Employee-specific constraints ────────────────────────────────────────────
describe("buildAutoFill — employee constraints respected", () => {
  it("never places an employee on their blocked shift", () => {
    const emps = minimalRoster();
    emps[0].blockedShifts = ["second"];
    const { schedule } = buildAutoFill(emps, {}, null, null, []);
    DAYS.forEach(day => {
      const asgn = schedule[cellKey(day, "second")] || [];
      expect(asgn.some(a => a.employeeId === emps[0].id)).toBe(false);
    });
  });

  it("never places an employee on their unavailable days", () => {
    const emps = minimalRoster();
    emps[0].unavailableDays = ["Monday", "Tuesday"];
    const { schedule } = buildAutoFill(emps, {}, null, null, []);
    ["Monday", "Tuesday"].forEach(day => {
      SHIFTS.forEach(shift => {
        const asgn = schedule[cellKey(day, shift.id)] || [];
        expect(asgn.some(a => a.employeeId === emps[0].id)).toBe(false);
      });
    });
  });

  it("respects requiredShift — employee only appears on their locked shift", () => {
    const emps = minimalRoster();
    emps[0].requiredShift = "first";
    emps[0].preferredShifts = ["first"];
    const { schedule } = buildAutoFill(emps, {}, null, null, []);
    ["second", "third"].forEach(shiftId => {
      DAYS.forEach(day => {
        const asgn = schedule[cellKey(day, shiftId)] || [];
        expect(asgn.some(a => a.employeeId === emps[0].id)).toBe(false);
      });
    });
  });

  it("does not double-assign an employee to two shifts on the same day", () => {
    const emps = minimalRoster();
    const { schedule } = buildAutoFill(emps, {}, null, null, []);
    emps.forEach(emp => {
      DAYS.forEach(day => {
        const assignedShifts = SHIFTS.filter(shift =>
          (schedule[cellKey(day, shift.id)] || []).some(a => a.employeeId === emp.id)
        );
        expect(assignedShifts.length).toBeLessThanOrEqual(1);
      });
    });
  });
});
