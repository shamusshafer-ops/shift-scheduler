// ── Core Schedule Constants ───────────────────────────────────────────────────

export const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
export const WEEKDAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday"];

export const SHIFTS = [
  { id: "first",  label: "1st Shift", time: "0600 – 1400" },
  { id: "second", label: "2nd Shift", time: "1400 – 2200" },
  { id: "third",  label: "3rd Shift", time: "2200 – 0600" },
];

export const POSITIONS     = ["Guard","Scale","Medical"];
export const ALL_POSITIONS = ["Supervisor", ...POSITIONS];

export const SHIFT_HOURS    = 8;
export const EXT_SHIFT_HOURS = 12;
export const FT_MIN_HOURS   = 40;
export const MAX_CONSECUTIVE_HOURS  = 16;
export const MAX_CONSECUTIVE_NIGHTS = 3;   // fallback — overridden by settings
export const MIN_REST_HOURS         = 12;  // fallback — overridden by settings
export const OT_RELIEF_THRESHOLD    = 56;  // hours before employee is excluded from makeup pass

export const SCHEMA_VERSION   = 2;
export const APP_VERSION_MAJOR = 34;
export const APP_VERSION       = `v${APP_VERSION_MAJOR}.${SCHEMA_VERSION}`;
export const SCHEMA_KEY        = "shift_schema_version";

// ── Extended Shift Pairs ──────────────────────────────────────────────────────
// A 12-hr extended shift pairs two employees to cover a gap:
//   DAY  variant: emp A works 0600–1800 (covers 1st + half of 2nd)
//   NIGHT variant: emp B works 1800–0600 (covers half of 2nd + 3rd)
export const EXT_PAIRS = [
  {
    id: "day",
    label: "Day 12hr",
    time: "0600 – 1800",
    covers: ["first", "second"],
    color: "#7c3aed",
  },
  {
    id: "night",
    label: "Night 12hr",
    time: "1800 – 0600",
    covers: ["second", "third"],
    color: "#0e7490",
  },
];

// ── Default Settings ──────────────────────────────────────────────────────────
export const DEFAULT_SETTINGS = {
  maxConsecutiveNights: 3,
  minRestHours: 12,
  defaultOvertimePref: "neutral",
  rotationMode: "fixed",
};

// ── Slot Helpers ──────────────────────────────────────────────────────────────
export const isWeekday     = (d) => WEEKDAYS.includes(d);
export const SUP_SLOT_DAY  = (d, s) => isWeekday(d) && s === "first";
export const REGULAR_SLOTS = (d, s) => 3;
export const getSlotCount  = (d, s) => SUP_SLOT_DAY(d, s) ? 4 : 3;
export const getAvailPos   = (d, s) => POSITIONS;
export const cellKey       = (d, s) => `${d}__${s}`;
export const extKey        = (day, pairId) => `EXT__${day}__${pairId}`;

// Ordered list of all (day, shiftId) slots across the week in chronological order
export const ALL_SLOTS = DAYS.flatMap(d => SHIFTS.map(s => ({ day: d, shiftId: s.id })));

// Shift start hours for rest-gap calculations
export const SHIFT_START_HOUR = { first: 6, second: 14, third: 22 };
export const SLOT_OFFSET_HOURS = (day, shiftId) =>
  DAYS.indexOf(day) * 24 + SHIFT_START_HOUR[shiftId];
