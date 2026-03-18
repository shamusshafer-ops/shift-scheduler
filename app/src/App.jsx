// ── App.jsx ───────────────────────────────────────────────────────────────────
import { useState, useEffect, useMemo, useCallback } from "react";
import { ThemeProvider, useTheme } from "./context/ThemeContext.jsx";
import { SettingsProvider, useSettings } from "./context/SettingsContext.jsx";
import { usePersistentState } from "./hooks/usePersistentState.js";
import { runSchemaMigrations } from "./utils/storage.js";
import {
  SCHEMA_VERSION, APP_VERSION, DAYS, SHIFTS, EXT_PAIRS,
  FT_MIN_HOURS, cellKey, getSlotCount,
} from "./constants/index.js";
import { dark, light } from "./constants/themes.js";
import { calcHours, getFatigueIssues } from "./utils/hours.js";
import { getAllPrefViolations } from "./utils/validation.js";
import { extCovers } from "./utils/extShifts.js";
import { timeOffCoversSlot } from "./utils/autofill.js";
import { PSI_SEED_ROSTER } from "./constants/roster.js";
import { ScheduleGrid } from "./components/schedule/ScheduleGrid.jsx";
import { CoverageDashboard } from "./components/dashboard/CoverageDashboard.jsx";
import { EmployeeManager } from "./components/employees/EmployeeManager.jsx";
import { TimeOffManager } from "./components/timeoff/TimeOffManager.jsx";
import { SettingsPanel } from "./components/settings/SettingsPanel.jsx";

const TABS = [
  { id: "employees", label: "▣ Employees" },
  { id: "schedule",  label: "▦ Schedule"  },
  { id: "dashboard", label: "▤ Dashboard" },
  { id: "timeoff",   label: "📅 Time Off"  },
  { id: "settings",  label: "⚙ Settings"  },
];

function AppShell() {
  const { theme: t, toggle: toggleTheme } = useTheme();
  const { settings: cfg } = useSettings();

  // ── Persistent state ──────────────────────────────────────────────────────
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
  const [settings,     setSettings]     = usePersistentState("shift_settings",     {});
  const [themeName,    setThemeNameRaw] = usePersistentState("shift_theme",        "dark");
  const [customSeed,   setCustomSeed]   = usePersistentState("shift_custom_seed",  null);

  const setThemeName = (name) => { setThemeNameRaw(name); };

  // ── UI state ──────────────────────────────────────────────────────────────
  const [activeTab,       setActiveTabRaw]    = useState("schedule");
  const [pendingAutoFill, setPendingAutoFill] = useState(null);
  const [highlightSlot,   setHighlightSlot]  = useState(null);
  const [scheduleStale,   setScheduleStale]  = useState(false);

  const setActiveTab = useCallback((tab, opts) => {
    setActiveTabRaw(tab);
    if (opts?.day && opts?.shiftId) setHighlightSlot(opts);
  }, []);

  const navigateToWeek = useCallback((ws) => {
    setWeekStart(ws); setActiveTabRaw("schedule");
  }, [setWeekStart]);

  // ── Derived stats for header ───────────────────────────────────────────────
  const empTimeOffDays = useMemo(() => {
    const s = new Set();
    (timeOffReqs||[]).filter(r=>r.status==="approved").forEach(r=>{
      DAYS.forEach(day=>{
        if(timeOffCoversSlot(r,day,r.shiftId||"first",weekStart)||(r.type!=="partial"&&timeOffCoversSlot(r,day,"first",weekStart))){
          s.add(r.empId+"__"+day);
        }
      });
    });
    return s;
  }, [timeOffReqs, weekStart]);

  const underHoursCount = useMemo(() =>
    employees.filter(e=>e.employmentType==="full-time"&&calcHours(e.id,schedule)<FT_MIN_HOURS).length
  , [employees, schedule]);

  const fatigueCount = useMemo(() =>
    employees.filter(e=>getFatigueIssues(e.id,schedule,cfg,employees).length>0).length
  , [employees, schedule, cfg]);

  const prefViolCount = useMemo(() =>
    employees.filter(e=>getAllPrefViolations(e,schedule).length>0).length
  , [employees, schedule]);

  const unmetReqs = useMemo(() => {
    let c=0;
    DAYS.forEach(d=>SHIFTS.forEach(s=>{
      const a=schedule[cellKey(d,s.id)]||[];
      if(!a.length) return;
      const cellExt=(extShifts||[]).filter(e=>extCovers(e,d,s.id));
      const hasScale=a.some(x=>x.position==="Scale")||cellExt.some(e=>(e.roles||[]).includes("Scale"));
      const hasMed=a.some(x=>x.position==="Medical")||cellExt.some(e=>(e.roles||[]).includes("Medical"));
      if(!hasScale||!hasMed) c++;
    }));
    return c;
  }, [schedule, extShifts]);

  const pendingTimeOff = (timeOffReqs||[]).filter(r=>r.status==="pending").length;
  const dashBadge = unmetReqs+underHoursCount+fatigueCount+prefViolCount;

  return (
    <div style={{minHeight:"100vh",background:t.bg,color:t.text,fontFamily:"'JetBrains Mono','Fira Code','Courier New',monospace"}}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{background:t.surface,borderBottom:"1px solid "+t.border,padding:"20px 28px",display:"flex",justifyContent:"space-between",alignItems:"center",gap:16,flexWrap:"wrap"}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:10,height:10,borderRadius:"50%",background:t.accent,boxShadow:"0 0 10px "+t.accent+"88",flexShrink:0}}/>
          <div>
            <h1 style={{margin:0,fontSize:20,fontWeight:800,letterSpacing:"-.01em"}}>SHIFT SCHEDULER</h1>
            <span style={{fontSize:9,fontWeight:600,color:t.textDim,letterSpacing:".08em"}}>{APP_VERSION}</span>
          </div>
        </div>
        <div style={{display:"flex",gap:16,alignItems:"center",fontSize:11,flexWrap:"wrap",color:t.textDim}}>
          {underHoursCount>0&&<span style={{color:t.danger,fontWeight:700}}>⚠ UNDER 40H: {underHoursCount} FT</span>}
          {fatigueCount>0&&<span style={{color:t.fatigue}}>⚠ FATIGUE: {fatigueCount} staff</span>}
          {prefViolCount>0&&<span style={{color:t.warning}}>⚠ PREF VIOLATIONS: {prefViolCount} staff</span>}
          {savedWeeks.length>0&&<span>SAVED WEEKS: <span style={{color:t.accent,fontWeight:700}}>{savedWeeks.length}</span></span>}
          <button onClick={toggleTheme}
            style={{background:t.surfaceAlt,border:"1px solid "+t.border,color:t.textMuted,padding:"6px 12px",borderRadius:6,cursor:"pointer",fontSize:13,fontFamily:"inherit"}}
            onMouseEnter={e=>{e.currentTarget.style.borderColor=t.accent;e.currentTarget.style.color=t.accent;}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor=t.border;e.currentTarget.style.color=t.textMuted;}}>
            {t.name==="dark"?"☀":"☾"}
          </button>
        </div>
      </div>

      {/* ── Tab nav ─────────────────────────────────────────────────────────── */}
      <div style={{background:t.surface,borderBottom:"1px solid "+t.border,padding:"0 28px",display:"flex",gap:0}}>
        {TABS.map(tab=>(
          <button key={tab.id} onClick={()=>setActiveTabRaw(tab.id)}
            style={{background:"transparent",border:"none",borderBottom:"2px solid "+(activeTab===tab.id?t.accent:"transparent"),color:activeTab===tab.id?t.text:t.textMuted,padding:"12px 24px",cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"inherit",letterSpacing:".05em",textTransform:"uppercase",transition:"all .2s",display:"flex",alignItems:"center",gap:7}}>
            {tab.label}
            {tab.id==="dashboard"&&dashBadge>0&&<span style={{background:t.danger,color:"#fff",fontSize:9,fontWeight:800,padding:"1px 6px",borderRadius:10,lineHeight:1.4}}>{dashBadge}</span>}
            {tab.id==="timeoff"&&pendingTimeOff>0&&<span style={{background:t.warning,color:"#000",fontSize:9,fontWeight:800,padding:"1px 6px",borderRadius:10,lineHeight:1.4}}>{pendingTimeOff}</span>}
          </button>
        ))}
      </div>

      {/* ── Tab content ─────────────────────────────────────────────────────── */}
      <div style={{padding:"24px 28px"}}>

        {activeTab==="employees"&&(
          <EmployeeManager
            employees={employees} setEmployees={setEmployees}
            schedule={schedule} setSchedule={setSchedule}
            savedRosters={savedRosters} setSavedRosters={setSavedRosters}
            onOpenTestModal={()=>{}} afExclude={afExclude} setAfExclude={setAfExclude}
            customSeed={customSeed} setCustomSeed={setCustomSeed}/>
        )}

        {activeTab==="schedule"&&(
          <ScheduleGrid
            employees={employees} schedule={schedule} setSchedule={setSchedule}
            onOpenTestModal={()=>{}}
            pendingAutoFill={pendingAutoFill} clearPendingAutoFill={()=>setPendingAutoFill(null)}
            savedWeeks={savedWeeks} setSavedWeeks={setSavedWeeks}
            history={history} setHistory={setHistory}
            highlightSlot={highlightSlot} clearHighlightSlot={()=>setHighlightSlot(null)}
            extShifts={extShifts} setExtShifts={setExtShifts}
            weekStart={weekStart} setWeekStart={setWeekStart}
            timeOffReqs={timeOffReqs} empTimeOffDays={empTimeOffDays}
            empPatterns={empPatterns} setEmpPatterns={setEmpPatterns}
            afExclude={afExclude} setAfExclude={setAfExclude}
            scheduleStale={scheduleStale} setScheduleStale={setScheduleStale}/>
        )}

        {activeTab==="dashboard"&&(
          <CoverageDashboard
            employees={employees} schedule={schedule} setSchedule={setSchedule}
            extShifts={extShifts} setExtShifts={setExtShifts} history={history}
            navigateToWeek={navigateToWeek} setActiveTab={setActiveTab}/>
        )}

        {activeTab==="timeoff"&&(
          <TimeOffManager
            employees={employees} timeOffRequests={timeOffReqs}
            setTimeOffRequests={setTimeOffReqs} weekStart={weekStart}/>
        )}

        {activeTab==="settings"&&(
          <SettingsPanel
            settings={settings} setSettings={setSettings}
            employees={employees} setEmployees={setEmployees}
            setSchedule={setSchedule} setExtShifts={setExtShifts}
            setTimeOffReqs={setTimeOffReqs} setSavedWeeks={setSavedWeeks}
            setHistory={setHistory} setEmpPatterns={setEmpPatterns}
            empPatterns={empPatterns} setWeekStart={setWeekStart}
            setSavedRosters={setSavedRosters}
            themeName={themeName} setThemeName={setThemeName}/>
        )}

      </div>
    </div>
  );
}

export default function App() {
  useEffect(() => { runSchemaMigrations(SCHEMA_VERSION); }, []);
  return (
    <ThemeProvider>
      <SettingsProvider>
        <AppShell/>
      </SettingsProvider>
    </ThemeProvider>
  );
}
