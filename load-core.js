// load-core.js — loads the extracted plain-JS scheduler core into Node.
// Mirrors the stubbing approach from the previous test-autofill.js pipeline.
"use strict";
const fs = require("fs");

const noop = () => {};
global.React = {
  createElement: () => null,
  useState: () => [null, noop], useEffect: noop, useCallback: (f) => f,
  useMemo: (f) => f(), useRef: () => ({ current: null }),
  useContext: () => ({}), useReducer: () => [null, noop],
  createContext: () => ({ Provider: null, Consumer: null }),
  memo: (c) => c, Fragment: "Fragment",
};
global.document = { lastModified: "2026-03-12" };
global.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };

// Extract the plain-JS core from the HTML if core.js isn't present (repo mode).
// The 3rd <script> tag is the algorithmic core (tags 0-1 are shims) — same
// extraction convention as test-autofill.js.
let src;
if (fs.existsSync(__dirname + "/core.js")) {
  src = fs.readFileSync(__dirname + "/core.js", "utf8");
} else {
  const html = fs.readFileSync(__dirname + "/ShiftScheduler_latest loop.html", "utf8");
  const lines = html.split("\n");
  const starts = [], ends = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === "<script>") starts.push(i);
    if (t === "</script>") ends.push(i);
  }
  if (starts.length < 3) throw new Error("Could not find plain script block");
  const start = starts[2] + 1;
  const end = ends.find(e => e > start);
  src = lines.slice(start, end).join("\n");
}
// indirect eval would lose const/function scope; use Function in global-ish scope via module eval
const exportsList = [
  "buildScheduleExportModel", "scheduleExportDutyLabel", "scheduleExportXml", "scheduleExportHtml", "SCHEDULE_EXPORT_COLORS",
  "buildAutoFill", "calcRestGap", "calcConsecutiveHours", "calcConsecutiveNights",
  "canFillPos", "getAvailPos", "REGULAR_SLOTS", "SUP_SLOT_DAY", "cellKey",
  "DAYS", "SHIFTS", "POSITIONS", "ALL_POSITIONS", "SHIFT_HOURS", "FT_MIN_HOURS",
  "EXT_PAIRS", "EXT_PAIRS_BY_ID", "extCovers", "slotHasRole", "isGuardOnly",
  "isRestViolation", "empMaxConsec", "isWeekday", "violationMinimizerPass",
  "MAX_CONSECUTIVE_HOURS", "extEmpHours", "dayIdx",
  "shiftInterval", "extendedWorkIntervals", "collectCoverageIntervals",
  "analyzeShiftCoverage", "validateCoverage", "coverageIssuesForSlot",
  "validateStaffing", "staffingIssuesForSlot",
  "extendedCoverageFloor", "getEffectiveSlotCount", "getSlotCount",
  "HANDOFF_HOURS", "computeWeekStats",
  "employeePolicyIssues", "validateAssignmentPolicy", "scheduleChangeIssues", "assignmentIssues",
  "proposedSwap", "canWorkExtHalf", "calcHours", "buildPrevWeekData", "boundaryPatterns",
  "filterPolicyAssignments", "getFatigueIssues", "deployProactiveExtShifts", "getPreferredShiftId", "ps",
  "buildPtoCredits", "weeklyEmployeeHours", "normalizedWorkedHours", "buildWeeklyAccounting",
  "validISODate", "dateRangeISO", "weekDatesISO", "isPaidTimeOff", "validPtoHours", "ptoRequestErrors",
  "clockHour", "civilDayOffset", "hasExactTimeOff", "timeOffRequestErrors", "timeOffIntervals", "timeOffRangeLabel", "timeOffCalendarDates",
  "buildTimeOffAvailability", "unavailableWindowErrors", "employeeUnavailableIntervals", "availabilityConflicts", "timeOffCoversSlot", "getTimeOffForDay",
  "canWorkOtherShifts", "overtimeReviewItems", "overtimeInputStamp", "makeOvertimeProposal",
  "canonicalJSON", "publicationSnapshot", "publicationStamp", "publicationOvertimeItems", "createOvertimeDecisions", "currentOvertimeDecision",
  "validatePublication", "createPublicationRecord", "publicationRecordValid", "createPublicationRepository", "publicationRows", "publicationPrintHtml",
  "createCompleteScheduleSearch", "completeSearchSeed", "completeSearchHardIssues", "completeSearchApply", "completeSearchWorkUpperBound",
  "emptyWeekDraft", "validateWeekDraft", "migrateActiveWeek", "readSchedulerStorage", "writeSchedulerStorage",
  "isMissingStorageError", "runSchemaMigrations",
  "selectWeekHistory", "scheduleViewSnapshot", "makeHistoryEntry", "upsertHistoryEntry", "scheduleWeekTransition", "historyDataIssues",
  "hasDutyLocks", "lockedDutyIssues", "preferenceBurden", "buildPreferenceHistory", "preferenceFairnessCost", "improveSchedulePreferences", "buildLockedAutoFill",
  "remainingSlotCapacity", "buildCallOffList", "callOffNeeds", "callOffPosition", "compareScheduleQuality", "scheduleQuality", "repairScheduleCompletion", "buildCompletionDiagnostics",
  "overtimeCreditLimits", "trimOvertimeProposal", "resolveOvertimeProposal", "repairScheduleGaps",
  "overtimeLowerBound", "SEARCH_IDLE_LIMIT_MS", "QUALITY", "employeesWithoutDayOff", "employeeDutyDays", "supervisorExtensions", "isSupervisorExtension",
];
const wrapped = src + "\n;module.exports = {" +
  exportsList.map(n => `${n}: (typeof ${n} !== "undefined" ? ${n} : undefined)`).join(",") + "};";
const Module = require("module");
const m = new Module("core", null);
m._compile(wrapped, __dirname + "/core-wrapped.js");
module.exports = m.exports;
