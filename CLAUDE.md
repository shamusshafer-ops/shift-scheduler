# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the App

No build step is needed. Open `ShiftScheduler_latest loop.html` directly in a browser. Babel transpiles JSX at runtime via CDN.

- **Working file:** `ShiftScheduler_latest loop.html` (~11,800 lines) — the only HTML file; `ShiftScheduler_latest.html` was removed
- **React component:** `ShiftScheduler_1_.jsx` (for import into a React project)

## Architecture

The app is a single-file browser application using **Preact** (via CDN) with Babel for JSX. There is no bundler, no npm, and no server.

### Storage
State is persisted via a dual-storage strategy:
- **Primary:** `window.storage` (Claude artifacts runner API)
- **Fallback:** `localStorage`

Storage keys:
- `shift_employees` — employee roster array
- `shift_schedule_*` — weekly schedule data
- `shift_schema_version` — tracks migration state

The `usePersistentState(key, fallback)` hook wraps this logic and returns `[value, setValue, loaded]`.

### Scheduling Algorithm
The autofill system is a constraint satisfaction solver with multiple passes:
1. **FT-First Reservation** — reserves slots for full-time employees
2. **Weighted soft-preference scoring** — respects preferred shifts, days off, fatigue
3. **CSP autofill + bottleneck prioritization** — fills hardest-to-cover slots first
4. **Directed Local Search (smart swapping)** — post-fill optimization via swaps

### Shift & Data Model

**Shifts:** `first` (0600–1400), `second` (1400–2200), `third` (2200–0600)
**Extended 12h:** Day (0600–1800), Night (1800–0600)
**Positions:** Guard, Scale, Medical (+ Supervisor on Monday 1st Shift)

Schedule is keyed as `"Day__shiftId"` (e.g., `"Monday__first"`), mapping to an array of `{ employeeId, position }` assignment objects.

Employee objects include: qualifications, employmentType, unavailableDays, blockedShifts, requiredShift, overtimePref, willing16h, inTraining, swingEligible, crossShiftOT, and more. See `roster-backup-current.json` for the full shape.

**Schema version:** managed by `SCHEMA_VERSION` constant; migrations live in `EMP_MIGRATIONS`.

### Business Rules (Hard Constraints)
- Full-time employees must have ≥ 40 hours/week
- Every shift requires minimum 3 people
- Every shift must have 1 Medic, 1 Scale, and 1 other (Guard/2nd Medic/2nd Scale)
- Overtime requires explicit approval (OvertimeModal workflow)

### Key UI Components
- `ScheduleGrid` — main weekly grid with slot assignment
- `EmpPicker` — modal for assigning employees to slots
- `EmployeeManager` — add/edit/remove employees from roster
- `OvertimeModal` — approval flow when employee would exceed 40h
- `UnderHoursBanner` — warns when full-time employees are under 40h
- `ThemeCtx` — dark/light theme provider

## Roster Backup
`roster-backup-current.json` is a versioned snapshot. Format: `{ version, exportedAt, employeeCount, employees[] }`. Current version: `v35.2-csp`.
