import { describe, it, expect } from "vitest";
import { enforceBusinessRules, slotHasRole } from "../../src/utils/validation.js";
import { cellKey, DAYS, SHIFTS } from "../../src/constants/index.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEmp(overrides) {
  return {
    id: overrides.id || "emp-1",
    name: overrides.name || "Test Employee",
    employmentType: overrides.employmentType || "full-time",
    qualifications: overrides.qualifications || ["Guard"],
    unavailableDays: [],
    preferredShifts: [],
    blockedShifts: [],
    requiredShift: null,
    preferredDaysOff: [],
    overtimePref: "neutral",
    willing16h: false,
    ...overrides,
  };
}

// Build a minimal schedule with N people on every shift of every day.
// Each person gets a position from the provided rotation.
function fullSchedule(employees, positionMap = {}) {
  const schedule = {};
  DAYS.forEach(day => {
    SHIFTS.forEach(shift => {
      schedule[cellKey(day, shift.id)] = employees.map(emp => ({
        employeeId: emp.id,
        position: positionMap[emp.id] || "Guard",
      }));
    });
  });
  return schedule;
}

// ── Rule 1: FT employees must have >= 40h ────────────────────────────────────
describe("Rule 1 — FT minimum 40h", () => {
  it("passes when all FT employees have exactly 40h", () => {
    // 5 shifts × 8h = 40h per employee across Mon–Fri
    const emp = makeEmp({ id: "ft-1", qualifications: ["Scale", "Medical"] });
    const schedule = {};
    // Give emp exactly 5 shifts (40h)
    ["Monday","Tuesday","Wednesday","Thursday","Friday"].forEach(day => {
      schedule[cellKey(day, "first")] = [
        { employeeId: "ft-1", position: "Scale" },
        { employeeId: "ft-2", position: "Medical" },
        { employeeId: "ft-3", position: "Guard" },
      ];
    });
    // Fill remaining days/shifts minimally
    DAYS.forEach(day => {
      SHIFTS.forEach(shift => {
        const key = cellKey(day, shift.id);
        if (!schedule[key]) {
          schedule[key] = [
            { employeeId: "ft-1", position: "Scale" },
            { employeeId: "ft-2", position: "Medical" },
            { employeeId: "ft-3", position: "Guard" },
          ];
        }
      });
    });
    const ft1 = makeEmp({ id: "ft-1", qualifications: ["Scale"] });
    const ft2 = makeEmp({ id: "ft-2", qualifications: ["Medical"] });
    const ft3 = makeEmp({ id: "ft-3", qualifications: ["Guard"] });
    const { violations, blocked } = enforceBusinessRules(schedule, [ft1, ft2, ft3]);
    const rule1Violations = violations.filter(v => v.rule === 1);
    expect(rule1Violations).toHaveLength(0);
  });

  it("flags FT employee with 0 hours", () => {
    const ft = makeEmp({ id: "ft-zero", name: "Zero Hours", qualifications: ["Scale"] });
    // Schedule has 3 people but ft-zero is not included
    const schedule = {};
    DAYS.forEach(day => SHIFTS.forEach(shift => {
      schedule[cellKey(day, shift.id)] = [
        { employeeId: "other-1", position: "Scale" },
        { employeeId: "other-2", position: "Medical" },
        { employeeId: "other-3", position: "Guard" },
      ];
    }));
    const others = [
      makeEmp({ id: "other-1", qualifications: ["Scale"] }),
      makeEmp({ id: "other-2", qualifications: ["Medical"] }),
      makeEmp({ id: "other-3", qualifications: ["Guard"] }),
    ];
    const { violations } = enforceBusinessRules(schedule, [ft, ...others]);
    const rule1 = violations.filter(v => v.rule === 1);
    expect(rule1.length).toBeGreaterThan(0);
    expect(rule1[0].msg).toContain("Zero Hours");
    expect(rule1[0].msg).toContain("0h");
  });

  it("does NOT flag part-time or on-call employees under 40h", () => {
    const pt = makeEmp({ id: "pt-1", name: "Part Timer", employmentType: "part-time", qualifications: ["Guard"] });
    const oc = makeEmp({ id: "oc-1", name: "On Call",   employmentType: "on-call",   qualifications: ["Scale"] });
    // Minimal valid schedule with 3 FT people at 40h
    const ft1 = makeEmp({ id: "ft-1", qualifications: ["Scale"] });
    const ft2 = makeEmp({ id: "ft-2", qualifications: ["Medical"] });
    const ft3 = makeEmp({ id: "ft-3", qualifications: ["Guard"] });
    const schedule = fullSchedule([ft1, ft2, ft3], { "ft-1": "Scale", "ft-2": "Medical", "ft-3": "Guard" });
    const { violations } = enforceBusinessRules(schedule, [ft1, ft2, ft3, pt, oc]);
    const rule1 = violations.filter(v => v.rule === 1);
    expect(rule1.every(v => !v.msg.includes("Part Timer") && !v.msg.includes("On Call"))).toBe(true);
  });
});

// ── Rule 2: Every shift must have >= 3 people ─────────────────────────────────
describe("Rule 2 — Minimum 3 people per shift (non-negotiable)", () => {
  it("passes when every shift has exactly 3 people", () => {
    const ft1 = makeEmp({ id: "ft-1", qualifications: ["Scale"] });
    const ft2 = makeEmp({ id: "ft-2", qualifications: ["Medical"] });
    const ft3 = makeEmp({ id: "ft-3", qualifications: ["Guard"] });
    const schedule = fullSchedule([ft1, ft2, ft3], { "ft-1": "Scale", "ft-2": "Medical", "ft-3": "Guard" });
    const { violations } = enforceBusinessRules(schedule, [ft1, ft2, ft3]);
    const rule2 = violations.filter(v => v.rule === 2);
    expect(rule2).toHaveLength(0);
  });

  it("flags any shift with fewer than 3 people", () => {
    const ft1 = makeEmp({ id: "ft-1", qualifications: ["Scale"] });
    const ft2 = makeEmp({ id: "ft-2", qualifications: ["Medical"] });
    const ft3 = makeEmp({ id: "ft-3", qualifications: ["Guard"] });
    const schedule = fullSchedule([ft1, ft2, ft3], { "ft-1": "Scale", "ft-2": "Medical", "ft-3": "Guard" });
    // Remove one person from Monday 1st shift
    schedule[cellKey("Monday", "first")] = [
      { employeeId: "ft-1", position: "Scale" },
      { employeeId: "ft-2", position: "Medical" },
    ];
    const { violations, blocked } = enforceBusinessRules(schedule, [ft1, ft2, ft3]);
    const rule2 = violations.filter(v => v.rule === 2);
    expect(rule2.length).toBeGreaterThan(0);
    expect(blocked).toBe(true);
  });

  it("flags an empty shift", () => {
    const ft1 = makeEmp({ id: "ft-1", qualifications: ["Scale"] });
    const ft2 = makeEmp({ id: "ft-2", qualifications: ["Medical"] });
    const ft3 = makeEmp({ id: "ft-3", qualifications: ["Guard"] });
    const schedule = fullSchedule([ft1, ft2, ft3], { "ft-1": "Scale", "ft-2": "Medical", "ft-3": "Guard" });
    schedule[cellKey("Sunday", "third")] = [];
    const { violations } = enforceBusinessRules(schedule, [ft1, ft2, ft3]);
    const rule2 = violations.filter(v => v.rule === 2 && v.msg.includes("Sunday"));
    expect(rule2.length).toBeGreaterThan(0);
  });

  it("blocked is true when ANY rule 2 violation exists", () => {
    const ft1 = makeEmp({ id: "ft-1", qualifications: ["Scale"] });
    const ft2 = makeEmp({ id: "ft-2", qualifications: ["Medical"] });
    const schedule = fullSchedule([ft1, ft2], { "ft-1": "Scale", "ft-2": "Medical" });
    const { blocked } = enforceBusinessRules(schedule, [ft1, ft2]);
    expect(blocked).toBe(true);
  });
});

// ── Rule 3: Every shift needs Medical + Scale + 1 other ──────────────────────
describe("Rule 3 — Required roles per shift", () => {
  it("passes when every shift has Scale, Medical, and a Guard", () => {
    const ft1 = makeEmp({ id: "ft-1", qualifications: ["Scale"] });
    const ft2 = makeEmp({ id: "ft-2", qualifications: ["Medical"] });
    const ft3 = makeEmp({ id: "ft-3", qualifications: ["Guard"] });
    const schedule = fullSchedule([ft1, ft2, ft3], { "ft-1": "Scale", "ft-2": "Medical", "ft-3": "Guard" });
    const { violations } = enforceBusinessRules(schedule, [ft1, ft2, ft3]);
    const rule3 = violations.filter(v => v.rule === 3);
    expect(rule3).toHaveLength(0);
  });

  it("flags a shift missing Medical", () => {
    const ft1 = makeEmp({ id: "ft-1", qualifications: ["Scale"] });
    const ft2 = makeEmp({ id: "ft-2", qualifications: ["Guard"] });
    const ft3 = makeEmp({ id: "ft-3", qualifications: ["Guard"] });
    const schedule = fullSchedule([ft1, ft2, ft3], { "ft-1": "Scale", "ft-2": "Guard", "ft-3": "Guard" });
    const { violations } = enforceBusinessRules(schedule, [ft1, ft2, ft3]);
    const rule3 = violations.filter(v => v.rule === 3 && v.msg.toLowerCase().includes("medical"));
    expect(rule3.length).toBeGreaterThan(0);
  });

  it("flags a shift missing Scale", () => {
    const ft1 = makeEmp({ id: "ft-1", qualifications: ["Medical"] });
    const ft2 = makeEmp({ id: "ft-2", qualifications: ["Guard"] });
    const ft3 = makeEmp({ id: "ft-3", qualifications: ["Guard"] });
    const schedule = fullSchedule([ft1, ft2, ft3], { "ft-1": "Medical", "ft-2": "Guard", "ft-3": "Guard" });
    const { violations } = enforceBusinessRules(schedule, [ft1, ft2, ft3]);
    const rule3 = violations.filter(v => v.rule === 3 && v.msg.toLowerCase().includes("scale"));
    expect(rule3.length).toBeGreaterThan(0);
  });

  it("accepts a 2nd Medic as the 3rd person (no Guard required)", () => {
    const ft1 = makeEmp({ id: "ft-1", qualifications: ["Scale"] });
    const ft2 = makeEmp({ id: "ft-2", qualifications: ["Medical"] });
    const ft3 = makeEmp({ id: "ft-3", qualifications: ["Medical"] });
    const schedule = fullSchedule([ft1, ft2, ft3], { "ft-1": "Scale", "ft-2": "Medical", "ft-3": "Medical" });
    const { violations } = enforceBusinessRules(schedule, [ft1, ft2, ft3]);
    const rule3 = violations.filter(v => v.rule === 3);
    expect(rule3).toHaveLength(0);
  });

  it("accepts a 2nd Scale as the 3rd person", () => {
    const ft1 = makeEmp({ id: "ft-1", qualifications: ["Scale"] });
    const ft2 = makeEmp({ id: "ft-2", qualifications: ["Medical"] });
    const ft3 = makeEmp({ id: "ft-3", qualifications: ["Scale"] });
    const schedule = fullSchedule([ft1, ft2, ft3], { "ft-1": "Scale", "ft-2": "Medical", "ft-3": "Scale" });
    const { violations } = enforceBusinessRules(schedule, [ft1, ft2, ft3]);
    const rule3 = violations.filter(v => v.rule === 3);
    expect(rule3).toHaveLength(0);
  });
});

// ── slotHasRole ───────────────────────────────────────────────────────────────
describe("slotHasRole", () => {
  const employees = [
    makeEmp({ id: "a", qualifications: ["Scale", "Medical"] }),
    makeEmp({ id: "b", qualifications: ["Guard"] }),
  ];

  it("returns true when position matches directly", () => {
    const asgn = [{ employeeId: "a", position: "Scale" }];
    expect(slotHasRole(asgn, employees, "Scale")).toBe(true);
  });

  it("returns true via employee qualification even if position differs", () => {
    // Employee 'a' is assigned as Guard but qualifies as Medical
    const asgn = [{ employeeId: "a", position: "Guard" }];
    expect(slotHasRole(asgn, employees, "Medical")).toBe(true);
  });

  it("returns false when Supervisor position is assigned (no qual bleed)", () => {
    const supEmp = makeEmp({ id: "sup", qualifications: ["Supervisor", "Scale"] });
    const asgn = [{ employeeId: "sup", position: "Supervisor" }];
    expect(slotHasRole(asgn, [supEmp], "Scale")).toBe(false);
  });

  it("returns false when role is not present", () => {
    const asgn = [{ employeeId: "b", position: "Guard" }];
    expect(slotHasRole(asgn, employees, "Medical")).toBe(false);
  });
});
