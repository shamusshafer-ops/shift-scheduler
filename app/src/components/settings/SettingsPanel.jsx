import { useState } from "react";
import { useTheme } from "../../context/ThemeContext.jsx";
import { useSettings } from "../../context/SettingsContext.jsx";
import { DEFAULT_SETTINGS, APP_VERSION } from "../../constants/index.js";
import { dark, light } from "../../constants/themes.js";
import { lsGet, lsSet } from "../../utils/storage.js";

// ── AppVersionFooter ──────────────────────────────────────────────────────────
function AppVersionFooter() {
  const { theme: t } = useTheme();
  return (
    <div style={{marginTop:32,paddingTop:16,borderTop:"1px solid "+t.border,fontSize:10,color:t.textDim,textAlign:"center",letterSpacing:".04em"}}>
      SHIFT SCHEDULER {APP_VERSION} — Built with Vite + React
    </div>
  );
}

// ── SettingsPanel ─────────────────────────────────────────────────────────────
export function SettingsPanel({
  settings, setSettings,
  employees, setEmployees,
  setSchedule, setExtShifts, setTimeOffReqs, setSavedWeeks, setHistory,
  setEmpPatterns, empPatterns, setWeekStart, setSavedRosters,
  themeName, setThemeName,
}) {
  const { theme: t } = useTheme();
  const { settings: cfg } = useSettings();
  const [settingsTab, setSettingsTab] = useState("rules");
  const [resetConfirm, setResetConfirm] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);

  const update = (key, val) => setSettings(s => ({ ...DEFAULT_SETTINGS, ...s, [key]: val }));
  const resetToDefaults = () => { setSettings(DEFAULT_SETTINGS); setResetConfirm(false); };

  const iS = {
    background:t.surfaceAlt, border:"1px solid "+t.border, color:t.text,
    padding:"10px 14px", borderRadius:6, outline:"none", fontSize:14,
    fontFamily:"'JetBrains Mono',monospace", width:"100%", boxSizing:"border-box",
  };

  const Section = ({ title, children }) => (
    <div style={{background:t.surface,border:"1px solid "+t.border,borderRadius:8,padding:20,marginBottom:20}}>
      <h3 style={{margin:"0 0 16px",fontSize:13,fontWeight:700,color:t.textMuted,textTransform:"uppercase",letterSpacing:".06em"}}>{title}</h3>
      {children}
    </div>
  );

  const Row = ({ label, desc, children }) => (
    <div style={{display:"flex",alignItems:"flex-start",gap:20,marginBottom:20,paddingBottom:20,borderBottom:"1px solid "+t.border}}>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontWeight:600,fontSize:13,color:t.text,marginBottom:4}}>{label}</div>
        <div style={{fontSize:11,color:t.textDim,lineHeight:1.5}}>{desc}</div>
      </div>
      <div style={{flexShrink:0,width:200}}>{children}</div>
    </div>
  );

  const Stepper = ({ value, min, max, step=1, onChange, unit="" }) => (
    <div style={{display:"flex",alignItems:"center",gap:8}}>
      <button onClick={() => onChange(Math.max(min, value-step))}
        style={{width:32,height:32,borderRadius:6,border:"1px solid "+t.border,background:t.surface,color:t.text,cursor:"pointer",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"inherit"}}>−</button>
      <div style={{flex:1,textAlign:"center",fontSize:18,fontWeight:700,color:t.accent,minWidth:60}}>
        {value}<span style={{fontSize:11,color:t.textDim,fontWeight:400,marginLeft:4}}>{unit}</span>
      </div>
      <button onClick={() => onChange(Math.min(max, value+step))}
        style={{width:32,height:32,borderRadius:6,border:"1px solid "+t.border,background:t.surface,color:t.text,cursor:"pointer",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"inherit"}}>+</button>
    </div>
  );

  const SP_TABS = [
    { id:"rules",      label:"Rules"      },
    { id:"rotation",   label:"Rotation"   },
    { id:"appearance", label:"Appearance" },
    { id:"data",       label:"Data"       },
  ];

  return (
    <div>
      {/* Sub-tabs */}
      <div style={{display:"flex",gap:2,flexWrap:"wrap",marginBottom:20,borderBottom:"1px solid "+t.border}}>
        {SP_TABS.map(tab => (
          <button key={tab.id} onClick={() => setSettingsTab(tab.id)}
            style={{padding:"7px 16px",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600,border:"none",background:"transparent",color:settingsTab===tab.id?t.accent:t.textDim,borderBottom:"2px solid "+(settingsTab===tab.id?t.accent:"transparent"),marginBottom:-1,transition:"color .15s,border-color .15s"}}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Rules tab */}
      {settingsTab === "rules" && <>
        <Section title="Consecutive Shifts">
          <Row label="Max consecutive night shifts" desc="Employees assigned to 3rd shift more than this many shifts in a row will trigger a fatigue warning. Auto-fill avoids exceeding this limit. Default: 3.">
            <Stepper value={cfg.maxConsecutiveNights} min={1} max={14} unit="nights" onChange={v=>update("maxConsecutiveNights",v)}/>
          </Row>
          <Row label="Max consecutive any shifts" desc="Maximum consecutive shifts before auto-fill enforces a break. Default: 5.">
            <Stepper value={cfg.maxConsecutiveShifts??5} min={1} max={14} unit="shifts" onChange={v=>update("maxConsecutiveShifts",v)}/>
          </Row>
        </Section>
        <Section title="Rest Between Shifts">
          <Row label="Minimum rest hours between shifts" desc="Minimum hours required between the end of one shift and the start of the next. Default: 12h.">
            <Stepper value={cfg.minRestHours} min={1} max={24} unit="hours" onChange={v=>update("minRestHours",v)}/>
          </Row>
        </Section>
        <Section title="Overtime Default">
          <Row label="Default overtime preference" desc="Global default for employees with Neutral OT preference.">
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {[{v:"blocked",label:"No OT",color:t.danger},{v:"neutral",label:"Neutral",color:t.textMuted},{v:"preferred",label:"Prefer OT",color:t.scale}].map(({v,label,color})=>{
                const active=(cfg.defaultOvertimePref||"neutral")===v;
                return(
                  <button key={v} onClick={()=>update("defaultOvertimePref",v)}
                    style={{display:"flex",alignItems:"center",gap:10,padding:"9px 14px",borderRadius:6,cursor:"pointer",border:"1.5px solid "+(active?color:t.border),background:active?color+"18":t.surfaceAlt,fontFamily:"inherit",transition:"all .15s"}}>
                    <span style={{width:9,height:9,borderRadius:"50%",flexShrink:0,background:active?color:t.textDim}}/>
                    <div style={{fontSize:12,fontWeight:700,color:active?color:t.text}}>{label}</div>
                    {active&&<span style={{marginLeft:"auto",fontSize:10,fontWeight:700,color}}>✓</span>}
                  </button>
                );
              })}
            </div>
          </Row>
        </Section>
        <div style={{display:"flex",justifyContent:"flex-end",marginBottom:8}}>
          <button onClick={resetToDefaults} style={{background:"transparent",border:"1px solid "+t.border,color:t.textMuted,padding:"6px 14px",borderRadius:6,cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit"}}>⟳ Reset to Defaults</button>
        </div>
      </>}

      {/* Rotation tab */}
      {settingsTab === "rotation" && (
        <Section title="Weekly Rotation">
          <Row label="Rotation mode" desc="Fixed: same days off every week. Rolling: days off advance by one day each week.">
            <div style={{display:"flex",gap:8,flexDirection:"column"}}>
              {["fixed","rolling"].map(mode => {
                const active=(cfg.rotationMode??"fixed")===mode;
                const color=mode==="rolling"?t.scale:t.textMuted;
                return(
                  <button key={mode} onClick={()=>update("rotationMode",mode)}
                    style={{display:"flex",alignItems:"center",gap:10,padding:"9px 14px",borderRadius:6,cursor:"pointer",fontFamily:"inherit",border:"1.5px solid "+(active?color:t.border),background:active?color+"18":t.surfaceAlt,transition:"all .15s"}}>
                    <span style={{width:9,height:9,borderRadius:"50%",flexShrink:0,background:active?color:t.textDim}}/>
                    <div style={{fontSize:12,fontWeight:700,color:active?color:t.text}}>{mode==="fixed"?"Fixed — same days off every week":"Rolling — advances each week"}</div>
                    {active&&<span style={{marginLeft:"auto",fontSize:10,fontWeight:700,color}}>✓ Active</span>}
                  </button>
                );
              })}
            </div>
          </Row>
        </Section>
      )}

      {/* Appearance tab */}
      {settingsTab === "appearance" && (
        <Section title="Theme">
          <Row label="Color theme" desc="Switch between dark and light mode.">
            <div style={{display:"flex",gap:8}}>
              {[{id:"dark",label:"☾ Dark"},{id:"light",label:"☀ Light"}].map(({id,label})=>{
                const active=themeName===id;
                return(
                  <button key={id} onClick={()=>setThemeName(id)}
                    style={{flex:1,padding:"9px 14px",borderRadius:6,cursor:"pointer",fontFamily:"inherit",border:"1.5px solid "+(active?t.accent:t.border),background:active?t.accent+"18":t.surfaceAlt,color:active?t.accent:t.textMuted,fontWeight:active?700:500,fontSize:12,transition:"all .15s"}}>
                    {label}{active&&" ✓"}
                  </button>
                );
              })}
            </div>
          </Row>
        </Section>
      )}

      {/* Data tab */}
      {settingsTab === "data" && (
        <Section title="Data Management">
          <Row label="Clear all data" desc="Permanently removes all employees, schedules, history, and settings. Cannot be undone.">
            {clearConfirm ? (
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                <div style={{fontSize:12,color:t.danger,fontWeight:700}}>Are you sure? This cannot be undone.</div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>{
                    setEmployees([]); setSchedule({}); setExtShifts([]); setTimeOffReqs([]);
                    setSavedWeeks([]); setHistory([]); setEmpPatterns({}); setSavedRosters([]);
                    setSettings(DEFAULT_SETTINGS); setClearConfirm(false);
                  }} style={{flex:1,background:t.danger,color:"#fff",border:"none",padding:"8px 0",borderRadius:5,cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>Yes, clear all</button>
                  <button onClick={()=>setClearConfirm(false)} style={{flex:1,background:"transparent",border:"1px solid "+t.border,color:t.textMuted,padding:"8px 0",borderRadius:5,cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={()=>setClearConfirm(true)} style={{background:"transparent",border:"1px solid "+t.danger+"60",color:t.danger,padding:"9px 14px",borderRadius:6,cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit",width:"100%"}}>⚠ Clear All Data</button>
            )}
          </Row>
          <Row label="Export data" desc="Download all your data as a JSON backup file.">
            <button onClick={()=>{
              const data={employees,settings,version:APP_VERSION,exportedAt:new Date().toISOString()};
              const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
              const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="shift-scheduler-backup.json";a.click();
            }} style={{background:t.accent+"18",border:"1px solid "+t.accent+"50",color:t.accent,padding:"9px 14px",borderRadius:6,cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit",width:"100%"}}>↓ Export JSON Backup</button>
          </Row>
        </Section>
      )}

      <AppVersionFooter/>
    </div>
  );
}
