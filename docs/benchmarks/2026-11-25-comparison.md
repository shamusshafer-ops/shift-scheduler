# Benchmark comparison — baseline 01e4214 vs improve/scheduling-intelligence

Recorded 2026-11-25 on a 2-core Linux container, Node 22. Complete search: 1000-node budget per week. Before: `01e4214cd759cd6322256fee99db726ec0eb1adb`, after: `bc6dcf4a216cd20c7111f2e932e271a2f53e8963`. Reproduce with `node tools/bench-scheduler.js --repo <checkout> --scenarios ... --seeds ... --nodes 1000 --out file.json` and `--compare before.json after.json`.

### synth

## synth-15 (20 vs 20 runs; lower is better unless noted)
| metric | before | after | change |
|---|---|---|---|
| completeValidRate | 1 | 1 | 0 |
| hardErrors | 0 | 0 | 0 |
| uncoveredStaffHours | 0 | 0 | 0 |
| uncoveredRoleHours | 0 | 0 | 0 |
| ftShortfallHours | 0 | 0 | 0 |
| supervisorExtensions | 0 | 0 | 0 |
| sevenDayWeeks | 0 | 0 | 0 |
| totalOT | 8 | 8 | 0 |
| maxOT | 8 | 8 | 0 |
| employeesWithOT | 1 | 1 | 0 |
| otSquares | 64 | 64 | 0 |
| otNonPreferred | 8 | 8 | 0 |
| doubles | 0 | 0 | 0 |
| longDuties | 0 | 0 | 0 |
| noTwoDaysOff | 5 | 0.4 | -4.6 |
| isolatedDaysOff | 13.6 | 2.15 | -11.45 |
| isolatedWorkDays | 6.35 | 0.9 | -5.45 |
| shiftChanges | 5.7 | 5.75 | +0.05 |
| dayNightFlips | 1.95 | 1.7 | -0.25 |
| shortTurnarounds | 1.3 | 0 | -1.3 |
| restDeficitHours | 10.4 | 0 | -10.4 |
| medianSec | 5.6 | 5.6 | 0 |
| worstSec | 6.7 | 7.7 | +1 |

Paired by seed on (errors, gaps, FT shortfall, supervisor 12h, 7-day weeks, OT, doubles, OT spread): 0 better, 0 worse, 20 equal.

## synth-pto (20 vs 20 runs; lower is better unless noted)
| metric | before | after | change |
|---|---|---|---|
| completeValidRate | 1 | 1 | 0 |
| hardErrors | 0 | 0 | 0 |
| uncoveredStaffHours | 0 | 0 | 0 |
| uncoveredRoleHours | 0 | 0 | 0 |
| ftShortfallHours | 0 | 0 | 0 |
| supervisorExtensions | 0 | 0 | 0 |
| sevenDayWeeks | 0 | 0 | 0 |
| totalOT | 16 | 16 | 0 |
| maxOT | 8 | 8 | 0 |
| employeesWithOT | 2 | 2 | 0 |
| otSquares | 128 | 128 | 0 |
| otNonPreferred | 16 | 16 | 0 |
| doubles | 0 | 0 | 0 |
| longDuties | 0 | 0 | 0 |
| noTwoDaysOff | 4.15 | 1.1 | -3.05 |
| isolatedDaysOff | 12.5 | 5.15 | -7.35 |
| isolatedWorkDays | 6.6 | 2.2 | -4.4 |
| shiftChanges | 9.25 | 8.7 | -0.55 |
| dayNightFlips | 2.8 | 2.2 | -0.6 |
| shortTurnarounds | 3.15 | 0.4 | -2.75 |
| restDeficitHours | 25.2 | 3.2 | -22 |
| medianSec | 6 | 13.1 | +7.1 |
| worstSec | 13.6 | 20.9 | +7.3 |

Paired by seed on (errors, gaps, FT shortfall, supervisor 12h, 7-day weeks, OT, doubles, OT spread): 0 better, 0 worse, 20 equal.

## synth-noot (20 vs 20 runs; lower is better unless noted)
| metric | before | after | change |
|---|---|---|---|
| completeValidRate | 1 | 1 | 0 |
| hardErrors | 0 | 0 | 0 |
| uncoveredStaffHours | 0 | 0 | 0 |
| uncoveredRoleHours | 0 | 0 | 0 |
| ftShortfallHours | 0 | 0 | 0 |
| supervisorExtensions | 0 | 0 | 0 |
| sevenDayWeeks | 0 | 0 | 0 |
| totalOT | 8 | 8 | 0 |
| maxOT | 8 | 8 | 0 |
| employeesWithOT | 1 | 1 | 0 |
| otSquares | 64 | 64 | 0 |
| otNonPreferred | 0 | 0 | 0 |
| doubles | 0 | 0 | 0 |
| longDuties | 0 | 0 | 0 |
| noTwoDaysOff | 5.45 | 0.8 | -4.65 |
| isolatedDaysOff | 14.4 | 3.15 | -11.25 |
| isolatedWorkDays | 6.85 | 1.15 | -5.7 |
| shiftChanges | 6.25 | 7.35 | +1.1 |
| dayNightFlips | 1.5 | 2.25 | +0.75 |
| shortTurnarounds | 1.45 | 0 | -1.45 |
| restDeficitHours | 11.6 | 0 | -11.6 |
| medianSec | 6.2 | 5.5 | -0.7 |
| worstSec | 8 | 7.1 | -0.9 |

Paired by seed on (errors, gaps, FT shortfall, supervisor 12h, 7-day weeks, OT, doubles, OT spread): 0 better, 0 worse, 20 equal.

## synth-tight (20 vs 20 runs; lower is better unless noted)
| metric | before | after | change |
|---|---|---|---|
| completeValidRate | 1 | 1 | 0 |
| hardErrors | 0 | 0 | 0 |
| uncoveredStaffHours | 0 | 0 | 0 |
| uncoveredRoleHours | 0 | 0 | 0 |
| ftShortfallHours | 0 | 0 | 0 |
| supervisorExtensions | 0 | 0 | 0 |
| sevenDayWeeks | 2 | 2 | 0 |
| totalOT | 88 | 88 | 0 |
| maxOT | 16 | 16 | 0 |
| employeesWithOT | 9 | 9 | 0 |
| otSquares | 960 | 960 | 0 |
| otNonPreferred | 88 | 88 | 0 |
| doubles | 0 | 0 | 0 |
| longDuties | 0 | 0 | 0 |
| noTwoDaysOff | 0.1 | 0.05 | -0.05 |
| isolatedDaysOff | 9.8 | 8.65 | -1.15 |
| isolatedWorkDays | 4.6 | 2.8 | -1.8 |
| shiftChanges | 6.85 | 5.05 | -1.8 |
| dayNightFlips | 1.1 | 1 | -0.1 |
| shortTurnarounds | 2.75 | 0.3 | -2.45 |
| restDeficitHours | 22 | 2.4 | -19.6 |
| medianSec | 30.7 | 17.4 | -13.3 |
| worstSec | 40.8 | 19.1 | -21.7 |

Paired by seed on (errors, gaps, FT shortfall, supervisor 12h, 7-day weeks, OT, doubles, OT spread): 0 better, 0 worse, 20 equal.

### real

## real-0927 (10 vs 10 runs; lower is better unless noted)
| metric | before | after | change |
|---|---|---|---|
| completeValidRate | 0 | 0 | 0 |
| hardErrors | 5 | 5 | 0 |
| uncoveredStaffHours | 0 | 0 | 0 |
| uncoveredRoleHours | 40 | 40 | 0 |
| ftShortfallHours | 0 | 0 | 0 |
| supervisorExtensions | 0 | 0 | 0 |
| sevenDayWeeks | 1 | 1 | 0 |
| totalOT | 88 | 88 | 0 |
| maxOT | 20 | 20 | 0 |
| employeesWithOT | 8.9 | 9 | +0.1 |
| otSquares | 1056 | 1036.8 | -19.2 |
| otNonPreferred | 68.8 | 70.4 | +1.6 |
| doubles | 0.4 | 0.2 | -0.2 |
| longDuties | 4.4 | 4.2 | -0.2 |
| noTwoDaysOff | 1.1 | 0 | -1.1 |
| isolatedDaysOff | 8.8 | 6.8 | -2 |
| isolatedWorkDays | 1 | 0 | -1 |
| shiftChanges | 4.1 | 4 | -0.1 |
| dayNightFlips | 1.5 | 1.8 | +0.3 |
| shortTurnarounds | 2.4 | 1.8 | -0.6 |
| restDeficitHours | 11.2 | 7.2 | -4 |
| medianSec | 61.2 | 40.5 | -20.7 |
| worstSec | 78.3 | 53 | -25.3 |

Paired by seed on (errors, gaps, FT shortfall, supervisor 12h, 7-day weeks, OT, doubles, OT spread): 3 better, 0 worse, 7 equal.

## anon-15 (10 vs 10 runs; lower is better unless noted)
| metric | before | after | change |
|---|---|---|---|
| completeValidRate | 1 | 1 | 0 |
| hardErrors | 0 | 0 | 0 |
| uncoveredStaffHours | 0 | 0 | 0 |
| uncoveredRoleHours | 0 | 0 | 0 |
| ftShortfallHours | 0 | 0 | 0 |
| supervisorExtensions | 0 | 0 | 0 |
| sevenDayWeeks | 0 | 0 | 0 |
| totalOT | 33.6 | 32.8 | -0.8 |
| maxOT | 8 | 8 | 0 |
| employeesWithOT | 4.2 | 4.1 | -0.1 |
| otSquares | 268.8 | 262.4 | -6.4 |
| otNonPreferred | 33.6 | 32.8 | -0.8 |
| doubles | 0 | 0 | 0 |
| longDuties | 0 | 0 | 0 |
| noTwoDaysOff | 3.5 | 0.7 | -2.8 |
| isolatedDaysOff | 11.7 | 5.6 | -6.1 |
| isolatedWorkDays | 5.4 | 2.6 | -2.8 |
| shiftChanges | 5.8 | 3.9 | -1.9 |
| dayNightFlips | 0.8 | 0.3 | -0.5 |
| shortTurnarounds | 1.5 | 0 | -1.5 |
| restDeficitHours | 12 | 0 | -12 |
| medianSec | 40 | 14.2 | -25.8 |
| worstSec | 50.1 | 16.4 | -33.7 |

Paired by seed on (errors, gaps, FT shortfall, supervisor 12h, 7-day weeks, OT, doubles, OT spread): 1 better, 0 worse, 9 equal.

### multi

## synth-15 (12 vs 12 runs; lower is better unless noted)
| metric | before | after | change |
|---|---|---|---|
| completeValidRate | 1 | 1 | 0 |
| hardErrors | 0 | 0 | 0 |
| uncoveredStaffHours | 0 | 0 | 0 |
| uncoveredRoleHours | 0 | 0 | 0 |
| ftShortfallHours | 0 | 0 | 0 |
| supervisorExtensions | 0 | 0 | 0 |
| sevenDayWeeks | 0 | 0 | 0 |
| totalOT | 8 | 8 | 0 |
| maxOT | 8 | 8 | 0 |
| employeesWithOT | 1 | 1 | 0 |
| otSquares | 64 | 64 | 0 |
| otNonPreferred | 8 | 8 | 0 |
| doubles | 0 | 0 | 0 |
| longDuties | 0 | 0 | 0 |
| noTwoDaysOff | 5.58 | 0.25 | -5.33 |
| isolatedDaysOff | 14.92 | 1.75 | -13.17 |
| isolatedWorkDays | 6.58 | 0.58 | -6 |
| shiftChanges | 6 | 6.08 | +0.08 |
| dayNightFlips | 1.58 | 1.08 | -0.5 |
| shortTurnarounds | 1.42 | 0 | -1.42 |
| restDeficitHours | 11.33 | 0 | -11.33 |
| medianSec | 5.3 | 4.9 | -0.4 |
| worstSec | 6.2 | 5.9 | -0.3 |

Paired by seed on (errors, gaps, FT shortfall, supervisor 12h, 7-day weeks, OT, doubles, OT spread): 0 better, 0 worse, 12 equal.
Across 3 consecutive weeks: max cumulative OT per person 16 → 8; sum of squared cumulative OT 320 → 192; people with any OT 2 → 3.

## real-0927 (12 vs 12 runs; lower is better unless noted)
| metric | before | after | change |
|---|---|---|---|
| completeValidRate | 0 | 0 | 0 |
| hardErrors | 5 | 5 | 0 |
| uncoveredStaffHours | 0 | 0 | 0 |
| uncoveredRoleHours | 40 | 40 | 0 |
| ftShortfallHours | 0 | 0 | 0 |
| supervisorExtensions | 0 | 0 | 0 |
| sevenDayWeeks | 1 | 1 | 0 |
| totalOT | 88.67 | 88 | -0.67 |
| maxOT | 20 | 20 | 0 |
| employeesWithOT | 9 | 9 | 0 |
| otSquares | 1072 | 1056 | -16 |
| otNonPreferred | 68 | 68 | 0 |
| doubles | 0.58 | 0.5 | -0.08 |
| longDuties | 4.58 | 4.5 | -0.08 |
| noTwoDaysOff | 0.83 | 0.08 | -0.75 |
| isolatedDaysOff | 8.17 | 6.67 | -1.5 |
| isolatedWorkDays | 0.92 | 0 | -0.92 |
| shiftChanges | 3.75 | 3.33 | -0.42 |
| dayNightFlips | 0.83 | 0.83 | 0 |
| shortTurnarounds | 2.58 | 1.5 | -1.08 |
| restDeficitHours | 12.67 | 6 | -6.67 |
| medianSec | 47.3 | 31.4 | -15.9 |
| worstSec | 57.1 | 55.9 | -1.2 |

Paired by seed on (errors, gaps, FT shortfall, supervisor 12h, 7-day weeks, OT, doubles, OT spread): 2 better, 0 worse, 10 equal.
Across 3 consecutive weeks: max cumulative OT per person 60 → 60; sum of squared cumulative OT 9552 → 9376; people with any OT 9 → 9.
