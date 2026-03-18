// ── App.jsx ───────────────────────────────────────────────────────────────────
// Root component. Wraps the entire app in context providers.
// Tab routing and persistent state live here.

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { ThemeProvider, useTheme } from "./context/ThemeContext.jsx";
import { SettingsProvider, useSettings } from "./context/SettingsContext.jsx";
import { usePersistentState } from "./hooks/usePersistentState.js";
import { runSchemaMigrations } from "./utils/storage.js";
import { SCHEMA_VERSION, APP_VERSION, DAYS, SHIFTS, EXT_PAIRS, FT_MIN_HOURS, cellKey, getSlotCount } from "./constants/index.js";
import { calcHours, getFatigueIssues } from "./utils/hours.js";
import { getAllPrefViolations, extCovers } from "./utils/validation.js";
import { timeOffCoversSlot } from "./utils/autofill.js";
import { PSI_SEED_ROSTER } from "./constants/roster.js";
import { ScheduleGrid } from "./components/schedule/ScheduleGrid.jsx";
import { CoverageDashboard } from "./components/dashboard/CoverageDashboard.jsx";

const TABS = [
  { id: "schedule",  label: "📅 Schedule"  },
  { id: "dashboard", label: "📊 Dashboard" },
];

// ── AppShell ──────────────────────────────────────────────────────────────────
function AppShell() {
  const { theme: t, toggle: toggleTheme } = useTheme();
  const { settings: cfg } = useSettings();

  // ── Persistent state ────────────────────────────────────────────────────
  const [employees,    setEmployees]    = usePersistentState("shift_employees",    PSI_SEED_ROSTER);
  const [schedule,     setSchedule]     = usePersistentState("shift_schedule",     {});
  const [extShifts,    setExtShifts]    = usePersistentState("shift_ext_shifts",   []);
  const [weekStart,    setWeekStart]    = usePersistentState("shift_week_start",   () => {
    const now = new Date(); const sun = new Date(now);
    sun.setDate(now.getDate() - now.getDay());
    return sun.toISOString().slice(0, 10);
  });
  const [history,      setHistory]      = usePersistentState("shift_history",      []);
  const [empPatterns,  setEmpPatterns]  = usePersistentState("shift_patterns",     {});
  const [timeOffReqs,  setTimeOffReqs]  = usePersistentState("shift_timeoff",      []);
  const [savedWeeks,   setSavedWeeks]   = usePersistentState("shift_saved_weeks",  []);
  const [savedRosters, setSavedRosters] = usePersistentState("shift_saved_rosters",[]);
  const [afExclude,    setAfExclude]    = usePersistentState("shift_af_exclude",   []);

  // ── UI state ─────────────────────────────────────────────────────────────
  const [activeTab,       setActiveTabRaw]   = useState("schedule");
  const [pendingAutoFill, setPendingAutoFill] = useState(null);
  const [highlightSlot,   setHighlightSlot]  = useState(null);
  const [scheduleStale,   setScheduleStale]  = useState(false);

  // Tab setter — supports highlight-slot navigation from dashboard
  const setActiveTab = useCallback((tab, opts) => {
    setActiveTabRaw(tab);
    if (opts?.day && opts?.shiftId) setHighlightSlot(opts);
  }, []);

  const navigateToWeek = useCallback((ws) => {
    setWeekStart(ws);
    setActiveTabRaw("schedule");
  }, [setWeekStart]);

  // ── Derived state ─────────────────────────────────────────────────────────
  const empTimeOffDays = useMemo(() => {
    const s = new Set();
    (timeOffReqs || []).filter(r => r.status === "approved").forEach(r => {
      DAYS.forEach(day => {
        if (timeOffCoversSlot(r, day, r.shiftId || "first", weekStart) ||
            (r.type !== "partial" && timeOffCoversSlot(r, day, "first", weekStart))) {
          s.add(r.empId + "__" + day);
        }
      });
    });
    return s;
  }, [timeOffReqs, weekStart]);

  const underHoursCount = useMemo(() =>
    employees.filter(e => e.employmentType === "full-time" && calcHours(e.id, schedule) < FT_MIN_HOURS).length,
  [employees, schedule]);

  const fatigueCount = useMemo(() =>
    employees.filter(e => getFatigueIssues(e.id, schedule, cfg, employees).length > 0).length,
  [employees, schedule, cfg]);

  // ── Header coverage stats ─────────────────────────────────────────────────
  const totalSlots = useMemo(() =>
    DAYS.reduce((n, d) => n + SHIFTS.reduce((m, s) => m + getSlotCount(d, s.id), 0), 0), []);

  const filledSlots = useMemo(() => {
    let count = Object.values(schedule).reduce((s, a) => s + a.length, 0);
    return Math.min(count, totalSlots);
  }, [schedule, totalSlots]);

  return (
    <div style={{minHeight:"100vh",background:t.bg,color:t.text,fontFamily:"'JetBrains Mono','Fira Code','Courier New',monospace"}}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{background:t.surface,borderBottom:"1px solid "+t.border,padding:"16px 28px",display:"flex",justifyContent:"space-between",alignItems:"center",gap:16,flexWrap:"wrap"}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:10,height:10,borderRadius:"50%",background:t.accent,boxShadow:"0 0 10px "+t.accent+"88",flexShrink:0}}/>
          <div>
            <h1 style={{margin:0,fontSize:20,fontWeight:800,letterSpacing:"-.01em"}}>SHIFT SCHEDULER</h1>
            <span style={{fontSize:9,fontWeight:600,color:t.textDim,letterSpacing:".08em"}}>{APP_VERSION}</span>
          </div>
        </div>

        {/* Quick stats */}
        <div style={{display:"flex",gap:16,alignItems:"center",flexWrap:"wrap"}}>
          <div style={{fontSize:11,color:t.textDim,display:"flex",gap:12}}>
            <span style={{color:filledSlots===totalSlots?t.scale:t.textMuted}}>
              {filledSlots}/{totalSlots} slots filled
            </span>
            {underHoursCount > 0 && (
              <span style={{color:t.danger,fontWeight:700}}>⚠ {underHoursCount} FT under 40h</span>
            )}
            {fatigueCount > 0 && (
              <span style={{color:t.fatigue}}>⚠ {fatigueCount} fatigue</span>
            )}
          </div>
          <button onClick={toggleTheme}
            style={{background:t.surfaceAlt,border:"1px solid "+t.border,color:t.textMuted,padding:"6px 12px",borderRadius:6,cursor:"pointer",fontSize:13,fontFamily:"inherit",transition:"all .2s"}}
            onMouseEnter={e=>{e.currentTarget.style.borderColor=t.accent;e.currentTarget.style.color=t.accent;}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor=t.border;e.currentTarget.style.color=t.textMuted;}}>
            {t.name==="dark"?"☀":"☾"}
          </button>
        </div>
      </div>

      {/* ── Tab nav ─────────────────────────────────────────────────────── */}
      <div style={{background:t.surface,borderBottom:"1px solid "+t.border,padding:"0 28px",display:"flex",gap:4}}>
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTabRaw(tab.id)}
            style={{background:"transparent",border:"none",borderBottom:"2px solid "+(activeTab===tab.id?t.accent:"transparent"),color:activeTab===tab.id?t.accent:t.textMuted,padding:"12px 16px",cursor:"pointer",fontSize:12,fontWeight:activeTab===tab.id?700:500,fontFamily:"inherit",transition:"color .15s",marginBottom:-1}}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab content ─────────────────────────────────────────────────── */}
      <div style={{padding:"20px 28px",maxWidth:1400,margin:"0 auto"}}>

        {activeTab === "schedule" && (
          <ScheduleGrid
            employees={employees}
            schedule={schedule}
            setSchedule={setSchedule}
            onOpenTestModal={() => {}}
            pendingAutoFill={pendingAutoFill}
            clearPendingAutoFill={() => setPendingAutoFill(null)}
            savedWeeks={savedWeeks}
            setSavedWeeks={setSavedWeeks}
            history={history}
            setHistory={setHistory}
            highlightSlot={highlightSlot}
            clearHighlightSlot={() => setHighlightSlot(null)}
            extShifts={extShifts}
            setExtShifts={setExtShifts}
            weekStart={weekStart}
            setWeekStart={setWeekStart}
            timeOffReqs={timeOffReqs}
            empTimeOffDays={empTimeOffDays}
            empPatterns={empPatterns}
            setEmpPatterns={setEmpPatterns}
            afExclude={afExclude}
            setAfExclude={setAfExclude}
            scheduleStale={scheduleStale}
            setScheduleStale={setScheduleStale}
          />
        )}

        {activeTab === "dashboard" && (
          <CoverageDashboard
            employees={employees}
            schedule={schedule}
            setSchedule={setSchedule}
            extShifts={extShifts}
            setExtShifts={setExtShifts}
            history={history}
            navigateToWeek={navigateToWeek}
            setActiveTab={setActiveTab}
          />
        )}
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  useEffect(() => { runSchemaMigrations(SCHEMA_VERSION); }, []);

  return (
    <ThemeProvider>
      <SettingsProvider>
        <AppShell />
      </SettingsProvider>
    </ThemeProvider>
  );
}
