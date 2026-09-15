# Shift Scheduler

## Business Rules (NON-NEGOTIABLE)

### 1. Full-Time Employee Hours
- All full-time employees **must** have at least **40 hours** scheduled per week.

### 2. Exact Staffing Per Shift
- Every shift requires **exactly 3 regular staff**.
- **First shift, Monday through Friday, also requires 1 dedicated Supervisor**: exactly 4 people in total.
- No other shift may have a fourth person. The limit applies throughout each shift, including overlapping extended duties and handoffs.
- Full-time hours and role requirements must be met within these limits; adding surplus employees is not an acceptable repair.

### 3. Shift Role Requirements
Every shift must include at minimum:
| Role | Count |
|------|-------|
| Medic | 1 |
| Scale | 1 |
| Other (Guard, 2nd Medic, or 2nd Scale) | 1 |

### 4. Optimization Goals
- **Speed** — schedules should be generated quickly
- **Efficiency** — minimize gaps, overtime, and unnecessary overlap
- **Simplicity** — easy to read, manage, and edit

---

## Files
- `ShiftScheduler_1_.jsx` — React component version
- `ShiftScheduler_latest loop.html` — Standalone HTML version

## Getting Started
Open `ShiftScheduler_latest loop.html` in a browser for the standalone version,
or import `ShiftScheduler_1_.jsx` into a React project.

## Weekly Excel Export
The standalone app's Excel preview and `.xls` download share the same layout and data:
green Sunday–Saturday date header, abbreviated names, worked hours, shift-group
separators, medical-name shading, color legend, and supervisor approval notice.
The workbook prints in landscape, one page wide, with extra pages for larger rosters.
Exports remain marked **DRAFT**; use the publication workflow for an approved schedule.

| Code | Actual duty |
|------|-------------|
| `1` | 6 a.m.–2 p.m. |
| `2` | 2 p.m.–10 p.m. |
| `3` | 10 p.m.–6 a.m. the following day |
| `12A` | 6 a.m.–6 p.m. |
| `12P` | 6 p.m.–6 a.m. the following day |
| `1+2` / `2+3` | Consecutive 16-hour double |
| `-Scale` | Explicit scale assignment |
| `x` / `Off` / `Vac` | Unscheduled / approved time off / approved vacation |

Early arrival and late stay are combined with the employee's actual duty interval:
only an exact 6–6 duty becomes `12A` or `12P`. Other hours retain explicit times.
Overnight duties appear on their start day; a pair half starting outside the week
is explicitly labeled in the nearest edge cell. Handwritten markings in the
reference are not reproduced.

Blue name/hour cells identify Medical qualifications. Yellow duty cells cross the
40-work-hour weekly threshold; orange flags off-shift or unusual duties and leave
conflicts; green identifies approved time off. Leave never hides assigned work.
The Employee Hours sheet separates worked hours, approved PTO credits, total
credits and overtime. Training times are shown but excluded from the scheduler's
worked-hour accounting. Historical exports use the saved week's data.
