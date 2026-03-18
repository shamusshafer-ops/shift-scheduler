// ── App.jsx ───────────────────────────────────────────────────────────────────
// Root component. Wraps the entire app in context providers.
// Tab routing and main state live here.

import { useState, useEffect } from "react";
import { ThemeProvider, useTheme } from "./context/ThemeContext.jsx";
import { SettingsProvider, useSettings } from "./context/SettingsContext.jsx";
import { usePersistentState } from "./hooks/usePersistentState.js";
import { runSchemaMigrations } from "./utils/storage.js";
import { SCHEMA_VERSION, APP_VERSION } from "./constants/index.js";
import { dark } from "./constants/themes.js";

// ── AppShell ──────────────────────────────────────────────────────────────────
// Inner shell rendered inside providers — has access to theme/settings context.
function AppShell() {
  const { theme: t, toggle: toggleTheme } = useTheme();
  const { settings } = useSettings();

  const [employees,    setEmployees]    = usePersistentState("shift_employees",      []);
  const [schedule,     setSchedule]     = usePersistentState("shift_schedule",       {});
  const [extShifts,    setExtShifts]    = usePersistentState("shift_ext_shifts",     []);
  const [weekStart,    setWeekStart]    = usePersistentState("shift_week_start",     null);
  const [history,      setHistory]      = usePersistentState("shift_history",        []);
  const [empPatterns,  setEmpPatterns]  = usePersistentState("shift_emp_patterns",   {});
  const [timeOffReqs,  setTimeOffReqs]  = usePersistentState("shift_time_off",       []);
  const [savedWeeks,   setSavedWeeks]   = usePersistentState("shift_saved_weeks",    []);
  const [savedRosters, setSavedRosters] = usePersistentState("shift_saved_rosters",  []);
  const [afExclude,    setAfExclude]    = usePersistentState("shift_af_exclude",     []);

  const [activeTab, setActiveTab] = useState("schedule");

  return (
    <div style={{
      minHeight: "100vh",
      background: t.bg,
      color: t.text,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    }}>
      {/* Header */}
      <div style={{background:t.surface,borderBottom:"1px solid "+t.border,padding:"10px 20px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{fontSize:14,fontWeight:800,letterSpacing:".06em",color:t.accent}}>
          SHIFT SCHEDULER
          <span style={{fontSize:9,color:t.textDim,fontWeight:400,marginLeft:8}}>{APP_VERSION}</span>
        </div>
        <button onClick={toggleTheme} style={{background:"transparent",border:"1px solid "+t.border,color:t.textMuted,padding:"4px 12px",borderRadius:5,cursor:"pointer",fontSize:11,fontFamily:"inherit"}}>
          {t.name === "dark" ? "☀ Light" : "☾ Dark"}
        </button>
      </div>

      {/* Placeholder — full tab system to be wired once all components are extracted */}
      <div style={{padding:"40px 20px",textAlign:"center",color:t.textMuted}}>
        <div style={{fontSize:32,marginBottom:12}}>🔧</div>
        <div style={{fontSize:14,fontWeight:700,marginBottom:6,color:t.text}}>Vite Migration In Progress</div>
        <div style={{fontSize:12}}>
          All business logic and utilities are extracted and tested.<br/>
          Component extraction in progress — use <code>ShiftScheduler_latest.html</code> for production.
        </div>
        <div style={{marginTop:24,fontSize:11,color:t.textDim}}>
          {employees.length} employee{employees.length !== 1 ? "s" : ""} in storage
          {" · "}{Object.keys(schedule).length} schedule slots
        </div>
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  useEffect(() => {
    runSchemaMigrations(SCHEMA_VERSION);
  }, []);

  return (
    <ThemeProvider>
      <SettingsProvider>
        <AppShell />
      </SettingsProvider>
    </ThemeProvider>
  );
}
