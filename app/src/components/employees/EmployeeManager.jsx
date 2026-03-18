import { useState, useMemo, useEffect } from "react";
import { useTheme } from "../../context/ThemeContext.jsx";
import { useSettings } from "../../context/SettingsContext.jsx";
import {
  DAYS, SHIFTS, ALL_POSITIONS, FT_MIN_HOURS, SHIFT_HOURS, cellKey,
} from "../../constants/index.js";
import { positionColor } from "../../constants/themes.js";
import { PSI_SEED_ROSTER } from "../../constants/roster.js";
import { calcHours, getFatigueIssues } from "../../utils/hours.js";
import {
  MaxShiftsPerWeekToggle, OtPrefToggle, Willing16hToggle,
  Ext12hPrefToggle, AvailabilityEditor, PreferenceEditor,
} from "./index.jsx";

// ── AfExcludeGroupToggles ─────────────────────────────────────────────────────
function AfExcludeGroupToggles({ employees, afExclude, setAfExclude, t }) {
  const groups = [
    { label: "FT",  filter: e => e.employmentType === "full-time" },
    { label: "PT",  filter: e => e.employmentType === "part-time" },
    { label: "OC",  filter: e => e.employmentType === "on-call" },
  ];
  return (
    <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
      <span style={{fontSize:10,color:t.textDim,fontWeight:600}}>Exclude from fill:</span>
      {groups.map(({ label, filter }) => {
        const ids = employees.filter(filter).map(e => e.id);
        const allExcluded = ids.length > 0 && ids.every(id => (afExclude||[]).includes(id));
        return (
          <button key={label} onClick={() => {
            setAfExclude(prev => {
              const s = new Set(prev||[]);
              if (allExcluded) { ids.forEach(id => s.delete(id)); }
              else             { ids.forEach(id => s.add(id));    }
              return [...s];
            });
          }} style={{
            background: allExcluded ? t.danger+"20" : "transparent",
            border: "1px solid " + (allExcluded ? t.danger : t.border),
            color: allExcluded ? t.danger : t.textDim,
            padding: "2px 8px", borderRadius: 4, cursor: "pointer",
            fontSize: 10, fontWeight: 700, fontFamily: "inherit",
          }}>{label}</button>
        );
      })}
    </div>
  );
}

// ── EmployeeManager ───────────────────────────────────────────────────────────
export function EmployeeManager({
  employees, setEmployees, schedule, setSchedule,
  savedRosters, setSavedRosters,
  onOpenTestModal, afExclude, setAfExclude,
  customSeed, setCustomSeed,
}) {
  const { theme: t } = useTheme();
  const cfg = useSettings();

  const EMPTY_NEW = {
    name:"", quals:["Guard"], type:"full-time", unavail:[], prefShifts:[],
    blockedShifts:[], requiredShift:null, prefDaysOff:[], overtimePref:"neutral",
    willing16h:false, maxShiftsPerWeek:null, ext12hPref:null, maxWeekendDays:null,
  };

  const [newForm,           setNewForm]           = useState(EMPTY_NEW);
  const [editState,         setEditState]         = useState(null);
  const [errors,            setErrors]            = useState([]);
  const [search,            setSearch]            = useState("");
  const [confirmClearAll,   setConfirmClearAll]   = useState(false);
  const [confirmSeedRoster, setConfirmSeedRoster] = useState(false);
  const [showAddForm,       setShowAddForm]       = useState(false);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape" && editState) { setEditState(null); e.preventDefault(); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [editState]);

  // Form field shorthands
  const newName          = newForm.name;
  const newQuals         = newForm.quals;
  const newType          = newForm.type;
  const newUnavail       = newForm.unavail;
  const newPrefShifts    = newForm.prefShifts    || [];
  const newBlockedShifts = newForm.blockedShifts || [];
  const newRequiredShift = newForm.requiredShift || null;
  const newPrefDaysOff   = newForm.prefDaysOff;
  const setNewName          = (v) => setNewForm(f => ({...f, name: v}));
  const setNewQuals         = (v) => setNewForm(f => ({...f, quals: typeof v === "function" ? v(f.quals) : v}));
  const setNewType          = (v) => setNewForm(f => ({...f, type: v}));
  const setNewUnavail       = (v) => setNewForm(f => ({...f, unavail: v}));
  const setNewPrefShifts    = (v) => setNewForm(f => ({...f, prefShifts:    typeof v === "function" ? v(f.prefShifts||[])    : v}));
  const setNewBlockedShifts = (v) => setNewForm(f => ({...f, blockedShifts: typeof v === "function" ? v(f.blockedShifts||[]) : v}));
  const setNewRequiredShift = (v) => setNewForm(f => ({...f, requiredShift: v}));
  const setNewPrefDaysOff   = (v) => setNewForm(f => ({...f, prefDaysOff: v}));

  const editId          = editState?.id ?? null;
  const editPrefShifts    = editState?.prefShifts    || [];
  const editBlockedShifts = editState?.blockedShifts || [];
  const editRequiredShift = editState?.requiredShift || null;
  const editPrefDaysOff   = editState?.prefDaysOff   ?? [];
  const setEditPrefShifts    = (v) => setEditState(s => ({...s, prefShifts:    typeof v === "function" ? v(s?.prefShifts||[])    : v}));
  const setEditBlockedShifts = (v) => setEditState(s => ({...s, blockedShifts: typeof v === "function" ? v(s?.blockedShifts||[]) : v}));
  const setEditRequiredShift = (v) => setEditState(s => ({...s, requiredShift: v}));
  const setEditPrefDaysOff   = (v) => setEditState(s => ({...s, prefDaysOff: v}));

  const toggleQ = (pos, arr, set) =>
    set(arr.includes(pos) ? arr.filter(x => x !== pos) : [...arr, pos]);

  const addEmployee = () => {
    const name = newName.trim();
    if (!name) return;
    if (!newQuals.length) { setErrors(["Select at least one position."]); setTimeout(() => setErrors([]), 3000); return; }
    if (employees.some(e => e.name.toLowerCase() === name.toLowerCase())) { setErrors(["Name already exists."]); setTimeout(() => setErrors([]), 3000); return; }
    setEmployees(p => [...p, {
      id: Date.now().toString(), name, qualifications: [...newQuals],
      employmentType: newType, unavailableDays: [...newUnavail],
      preferredShifts: [...(newPrefShifts||[])], blockedShifts: [...(newBlockedShifts||[])],
      requiredShift: newRequiredShift||null, preferredDaysOff: [...newPrefDaysOff],
      overtimePref: newForm.overtimePref||"neutral", willing16h: newForm.willing16h||false,
      maxShiftsPerWeek: newForm.maxShiftsPerWeek??null, ext12hPref: newForm.ext12hPref??null,
    }]);
    setNewForm(EMPTY_NEW); setErrors([]);
  };

  const deleteEmployee = (id) => {
    setEmployees(p => p.filter(e => e.id !== id));
    setSchedule(p => { const n={...p}; Object.keys(n).forEach(k=>{n[k]=n[k].filter(a=>a.employeeId!==id)}); return n; });
  };

  const saveEdit = () => {
    const s = editState; if (!s) return;
    const name = (s.name||"").trim();
    if (!name || !(s.quals||[]).length) return;
    setEmployees(p => p.map(e => e.id === s.id ? {
      ...e, name, qualifications: [...(s.quals||[])], employmentType: s.type||"full-time",
      unavailableDays: [...(s.unavail||[])], preferredShifts: [...(s.prefShifts||[])],
      blockedShifts: [...(s.blockedShifts||[])], requiredShift: s.requiredShift||null,
      preferredDaysOff: [...(s.prefDaysOff||[])], overtimePref: s.overtimePref||"neutral",
      willing16h: s.willing16h||false, maxShiftsPerWeek: s.maxShiftsPerWeek??null,
      ext12hPref: s.ext12hPref??null, maxWeekendDays: s.maxWeekendDays!==undefined?s.maxWeekendDays:null,
      notes: (s.notes||"").trim(),
    } : e));
    setEditState(null);
  };

  const shiftHours = useMemo(() => {
    const c = {}; employees.forEach(e => (c[e.id] = 0));
    Object.values(schedule).forEach(a => a.forEach(x => { if (c[x.employeeId] !== undefined) c[x.employeeId] += SHIFT_HOURS; }));
    return c;
  }, [schedule, employees]);

  const filtered = employees.filter(e =>
    e.name.toLowerCase().includes(search.toLowerCase()) ||
    e.qualifications.some(q => q.toLowerCase().includes(search.toLowerCase()))
  );

  const iS = { background:t.surfaceAlt, border:"1px solid "+t.border, color:t.text,
    padding:"10px 14px", borderRadius:6, outline:"none", fontSize:14,
    fontFamily:"'JetBrains Mono',monospace" };

  const TypeToggle = ({ val, set }) => (
    <div style={{display:"flex",borderRadius:6,overflow:"hidden",border:"1px solid "+t.border,width:"fit-content"}}>
      {[["full-time","FT"],["part-time","PT"],["on-call","OC"]].map(([v, label]) => (
        <button key={v} onClick={() => set(v)} style={{
          background: val===v ? (v==="full-time"?t.accent:v==="part-time"?t.scale:t.warning) : t.surfaceAlt,
          color: val===v ? "#fff" : t.textMuted, border:"none", padding:"7px 16px",
          cursor:"pointer", fontSize:11, fontWeight:700, fontFamily:"inherit",
        }}>{label}</button>
      ))}
    </div>
  );

  const QualBtns = ({ quals, toggle }) => (
    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
      {ALL_POSITIONS.map(pos => {
        const on = quals.includes(pos);
        const pc = positionColor(pos, t);
        return (
          <button key={pos} onClick={() => toggle(pos)} style={{
            background: on?pc+"20":t.surfaceAlt, border:"1.5px solid "+(on?pc:t.border),
            color: on?pc:t.textDim, padding:"7px 14px", borderRadius:6,
            cursor:"pointer", fontSize:12, fontWeight:600, fontFamily:"inherit",
            display:"flex", alignItems:"center", gap:6,
          }}>
            <span style={{width:13,height:13,borderRadius:3,border:"1.5px solid "+(on?pc:t.textDim),
              background:on?pc:"transparent",display:"flex",alignItems:"center",justifyContent:"center",
              fontSize:9,color:"#fff",flexShrink:0}}>{on?"✓":""}</span>
            {pos}
          </button>
        );
      })}
    </div>
  );

  return (
    <div>
      {/* Test mode banner */}
      <div style={{marginBottom:20,padding:"14px 18px",background:t.accent+"0a",border:"1px dashed "+t.accent+"55",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
        <div>
          <div style={{fontSize:13,fontWeight:700,color:t.accent,marginBottom:3}}>🧪 Test Mode</div>
          <div style={{fontSize:11,color:t.textDim}}>Generate a randomized roster and auto-fill the schedule to preview staffing coverage.</div>
        </div>
        <button onClick={onOpenTestModal} style={{background:t.accent,color:"#fff",border:"none",padding:"9px 18px",borderRadius:6,cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit",whiteSpace:"nowrap",flexShrink:0}}>GENERATE TEST ROSTER</button>
      </div>

      {errors.length > 0 && <div style={{background:t.dangerDim,border:"1px solid "+t.danger,borderRadius:6,padding:"10px 16px",marginBottom:16,fontSize:13,color:t.name==="dark"?"#fca5a5":t.danger}}>{errors[0]}</div>}

      {/* Add employee */}
      <div style={{marginBottom:16}}>
        <button onClick={() => { setShowAddForm(o => !o); if (showAddForm) setNewForm(EMPTY_NEW); }}
          style={{display:"flex",alignItems:"center",gap:8,padding:"7px 16px",background:showAddForm?t.accent+"22":t.surfaceAlt,border:"1px solid "+(showAddForm?t.accent:t.border),borderRadius:showAddForm?"6px 6px 0 0":6,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700,color:showAddForm?t.accent:t.textDim,width:"100%",justifyContent:"flex-start"}}>
          <span style={{fontSize:14}}>{showAddForm?"−":"+"}</span>
          <span>Add Employee</span>
          <span style={{marginLeft:"auto",fontSize:10,fontWeight:400,color:t.textDim,opacity:.8}}>{showAddForm?"click to cancel":"click to expand"}</span>
        </button>
        {showAddForm && (
          <div style={{background:t.surface,border:"1px solid "+t.accent,borderTop:"none",borderRadius:"0 0 6px 6px",padding:20}}>
            <div style={{display:"flex",gap:16,flexWrap:"wrap",alignItems:"flex-start"}}>
              <div style={{flex:"1 1 180px"}}>
                <label style={{display:"block",fontSize:11,color:t.textDim,marginBottom:6}}>NAME</label>
                <input autoFocus value={newName} onChange={e=>setNewName(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&addEmployee()} placeholder="Enter employee name"
                  style={{...iS,width:"100%",boxSizing:"border-box"}}/>
              </div>
              <div>
                <label style={{display:"block",fontSize:11,color:t.textDim,marginBottom:6}}>TYPE</label>
                <TypeToggle val={newType} set={setNewType}/>
              </div>
              <div style={{flex:"1 1 320px"}}>
                <label style={{display:"block",fontSize:11,color:t.textDim,marginBottom:6}}>QUALIFIED POSITIONS</label>
                <QualBtns quals={newQuals} toggle={p=>toggleQ(p,newQuals,setNewQuals)}/>
                <AvailabilityEditor emp={{unavailableDays:newUnavail}} onUpdate={setNewUnavail}/>
                <PreferenceEditor prefShifts={newPrefShifts} setPrefShifts={setNewPrefShifts} blockedShifts={newBlockedShifts} setBlockedShifts={setNewBlockedShifts} requiredShift={newRequiredShift} setRequiredShift={setNewRequiredShift} daysOff={newPrefDaysOff} setDaysOff={setNewPrefDaysOff}/>
                <OtPrefToggle val={newForm.overtimePref||"neutral"} set={v=>setNewForm(f=>({...f,overtimePref:v}))} isFT={newType==="full-time"}/>
                <Willing16hToggle val={newForm.willing16h||false} set={v=>setNewForm(f=>({...f,willing16h:v}))}/>
                <Ext12hPrefToggle val={newForm.ext12hPref??null} set={v=>setNewForm(f=>({...f,ext12hPref:v}))}/>
                <MaxShiftsPerWeekToggle val={newForm.maxShiftsPerWeek??null} set={v=>setNewForm(f=>({...f,maxShiftsPerWeek:v}))}/>
              </div>
              <button onClick={() => { addEmployee(); setShowAddForm(false); }}
                style={{background:t.accent,color:"#fff",border:"none",padding:"10px 20px",borderRadius:6,cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"inherit",alignSelf:"flex-end"}}>ADD</button>
            </div>
          </div>
        )}
      </div>

      {/* Search */}
      {employees.length > 0 && (
        <div style={{marginBottom:16}}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by name or position..."
            style={{...iS,width:"100%",maxWidth:360,boxSizing:"border-box"}}/>
        </div>
      )}

      {/* Employee table */}
      {filtered.length===0&&employees.length===0 ? (
        <div style={{textAlign:"center",padding:48,color:t.textDim,fontSize:14}}>
          <div style={{fontSize:32,marginBottom:12}}>◇</div>No employees yet. Add your team above or use Test Mode.
        </div>
      ) : filtered.length===0 ? (
        <div style={{textAlign:"center",padding:32,color:t.textDim,fontSize:13}}>No matches found.</div>
      ) : (
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead>
            <tr style={{borderBottom:"2px solid "+t.border}}>
              {["Name","Type","Shift","Quals","Days Off","Hrs",""].map(h => (
                <th key={h} style={{padding:"6px 14px",textAlign:"left",fontSize:10,fontWeight:700,color:t.textDim,letterSpacing:".06em",whiteSpace:"nowrap"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(emp => {
              const hours    = shiftHours[emp.id]||0;
              const isFT     = emp.employmentType==="full-time";
              const ftTarget = (emp.maxShiftsPerWeek??null)!==null ? emp.maxShiftsPerWeek*SHIFT_HOURS : FT_MIN_HOURS;
              const isUnder  = isFT&&hours<ftTarget;
              const fatigueIssues = getFatigueIssues(emp.id, schedule, cfg, employees);

              return editId===emp.id ? (
                <tr key={emp.id}><td colSpan={7} style={{padding:"4px 0"}}>
                  <div style={{padding:"14px 16px",background:t.surfaceAlt,border:"1px solid "+t.accent,borderRadius:6,display:"flex",flexDirection:"column",gap:12}}>
                    <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"center"}}>
                      <input value={editState?.name||""} onChange={e=>setEditState(s=>({...s,name:e.target.value}))}
                        style={{...iS,flex:"1 1 200px",boxSizing:"border-box"}}/>
                      <TypeToggle val={editState?.type||"full-time"} set={v=>setEditState(s=>({...s,type:v}))}/>
                    </div>
                    <QualBtns quals={editState?.quals||[]} toggle={p=>toggleQ(p,editState?.quals||[],v=>setEditState(s=>({...s,quals:typeof v==="function"?v(s.quals):v})))}/>
                    <AvailabilityEditor emp={{unavailableDays:editState?.unavail||[]}} onUpdate={v=>setEditState(s=>({...s,unavail:v}))}/>
                    <PreferenceEditor prefShifts={editPrefShifts} setPrefShifts={setEditPrefShifts} blockedShifts={editBlockedShifts} setBlockedShifts={setEditBlockedShifts} requiredShift={editRequiredShift} setRequiredShift={setEditRequiredShift} daysOff={editPrefDaysOff} setDaysOff={setEditPrefDaysOff}/>
                    <OtPrefToggle val={editState?.overtimePref||"neutral"} set={v=>setEditState(s=>({...s,overtimePref:v}))} isFT={(editState?.type||"full-time")==="full-time"}/>
                    <Willing16hToggle val={editState?.willing16h||false} set={v=>setEditState(s=>({...s,willing16h:v}))}/>
                    <Ext12hPrefToggle val={editState?.ext12hPref??null} set={v=>setEditState(s=>({...s,ext12hPref:v}))}/>
                    <MaxShiftsPerWeekToggle val={editState?.maxShiftsPerWeek??null} set={v=>setEditState(s=>({...s,maxShiftsPerWeek:v}))}/>
                    <div style={{display:"flex",flexDirection:"column",gap:4}}>
                      <label style={{fontSize:10,fontWeight:700,color:t.textDim,letterSpacing:".06em"}}>NOTES</label>
                      <textarea value={editState?.notes||""} onChange={e=>setEditState(s=>({...s,notes:e.target.value}))}
                        placeholder="Certifications, restrictions, notes..." rows={3}
                        style={{...iS,resize:"vertical",fontFamily:"inherit",fontSize:12,lineHeight:1.5,padding:"8px 10px",width:"100%",boxSizing:"border-box"}}/>
                    </div>
                    <div style={{display:"flex",gap:8}}>
                      <button onClick={saveEdit} style={{background:t.scale,color:"#fff",border:"none",padding:"8px 16px",borderRadius:5,cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit"}}>SAVE</button>
                      <button onClick={()=>setEditState(null)} style={{background:"transparent",color:t.textMuted,border:"1px solid "+t.border,padding:"8px 16px",borderRadius:5,cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit"}}>Cancel <span style={{fontSize:10,opacity:.6,fontWeight:400}}>Esc</span></button>
                    </div>
                  </div>
                </td></tr>
              ) : (
                <tr key={emp.id}
                  onClick={() => setEditState({id:emp.id,name:emp.name,quals:emp.qualifications||[],type:emp.employmentType||"full-time",unavail:emp.unavailableDays||[],prefShifts:emp.preferredShifts||[],blockedShifts:emp.blockedShifts||[],requiredShift:emp.requiredShift||null,prefDaysOff:emp.preferredDaysOff||[],overtimePref:emp.overtimePref||"neutral",willing16h:emp.willing16h||false,maxShiftsPerWeek:emp.maxShiftsPerWeek??null,ext12hPref:emp.ext12hPref??null,maxWeekendDays:emp.maxWeekendDays??null,notes:emp.notes||""})}
                  style={{cursor:"pointer",borderBottom:"1px solid "+t.border,background:fatigueIssues.length?t.fatigue+"08":isUnder?t.danger+"06":t.surface,transition:"background .12s"}}
                  onMouseEnter={e=>e.currentTarget.style.background=t.accent+"0d"}
                  onMouseLeave={e=>e.currentTarget.style.background=fatigueIssues.length?t.fatigue+"08":isUnder?t.danger+"06":t.surface}>
                  <td style={{padding:"9px 14px",maxWidth:200}}>
                    <div style={{fontWeight:600,fontSize:13,whiteSpace:"nowrap"}}>{emp.name}</div>
                    {fatigueIssues.length>0&&<div style={{fontSize:9,color:t.fatigue}}>⚠ {fatigueIssues.length} fatigue</div>}
                    {isUnder&&<div style={{fontSize:9,color:t.danger}}>⚠ {hours}h / {ftTarget}h</div>}
                    {emp.notes&&<div style={{fontSize:9,color:t.textDim,fontStyle:"italic",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:180}} title={emp.notes}>📝 {emp.notes}</div>}
                  </td>
                  <td style={{padding:"9px 10px",whiteSpace:"nowrap"}}>
                    <span style={{fontSize:10,fontWeight:700,padding:"2px 7px",borderRadius:4,background:(isFT?t.accent:emp.employmentType==="on-call"?t.warning:t.scale)+"20",color:isFT?t.accent:emp.employmentType==="on-call"?t.warning:t.scale,border:"1px solid "+(isFT?t.accent:emp.employmentType==="on-call"?t.warning:t.scale)+"40"}}>
                      {isFT?"FT":emp.employmentType==="on-call"?"OC":"PT"}
                    </span>
                  </td>
                  <td style={{padding:"9px 10px",fontSize:11,whiteSpace:"nowrap"}}>
                    {emp.requiredShift&&<span style={{color:t.danger,fontWeight:700,fontSize:10}}>⚠ {SHIFTS.find(s=>s.id===emp.requiredShift)?.label}</span>}
                    {!emp.requiredShift&&(emp.preferredShifts||[]).length>0&&<span style={{color:t.accent,fontSize:10}}>★ {(emp.preferredShifts||[]).map(s=>SHIFTS.find(x=>x.id===s)?.label||s).join("/")}</span>}
                    {!emp.requiredShift&&!(emp.preferredShifts||[]).length&&<span style={{color:t.textDim,fontSize:10}}>Any</span>}
                  </td>
                  <td style={{padding:"9px 10px"}}>
                    <span style={{display:"flex",gap:3,alignItems:"center",flexShrink:0}}>
                      {ALL_POSITIONS.map(p=>(
                        <span key={p} title={p} style={{width:8,height:8,borderRadius:"50%",display:"inline-block",flexShrink:0,background:(emp.qualifications||[]).includes(p)?positionColor(p,t):t.border,border:"1px solid "+((emp.qualifications||[]).includes(p)?positionColor(p,t):t.textDim)}}/>
                      ))}
                    </span>
                  </td>
                  <td style={{padding:"9px 10px",fontSize:10,color:t.textDim,whiteSpace:"nowrap"}}>
                    {(emp.preferredDaysOff||[]).length>0?(emp.preferredDaysOff||[]).map(d=>d.substring(0,3)).join(", "):<span style={{color:t.border}}>—</span>}
                  </td>
                  <td style={{padding:"9px 10px",textAlign:"center"}}>
                    {isFT&&<span style={{fontSize:11,fontWeight:700,color:hours>=48?t.danger:hours>=40?t.scale:hours>0?t.warning:t.textDim}}>{hours>0?hours+"h":"—"}</span>}
                  </td>
                  <td style={{padding:"9px 10px",whiteSpace:"nowrap"}}>
                    <div style={{display:"flex",gap:6,alignItems:"center"}}>
                      <button onClick={e=>{e.stopPropagation();setAfExclude(prev=>(prev||[]).includes(emp.id)?prev.filter(x=>x!==emp.id):[...(prev||[]),emp.id]);}}
                        title={(afExclude||[]).includes(emp.id)?"Include in autofill":"Exclude from autofill"}
                        style={{background:(afExclude||[]).includes(emp.id)?t.danger+"20":"transparent",border:"1px solid "+((afExclude||[]).includes(emp.id)?t.danger:t.border),color:(afExclude||[]).includes(emp.id)?t.danger:t.textDim,cursor:"pointer",fontSize:10,fontWeight:700,padding:"2px 6px",borderRadius:4,whiteSpace:"nowrap"}}>
                        {(afExclude||[]).includes(emp.id)?"⊘":"⚡"}
                      </button>
                      <button onClick={e=>{e.stopPropagation();deleteEmployee(emp.id);}}
                        style={{background:"transparent",border:"none",color:t.textDim,cursor:"pointer",fontSize:12,padding:"2px 4px"}} title="Remove employee">✕</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Footer bar */}
      <div style={{marginTop:16,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
        <div style={{fontSize:11,color:t.textDim}}>
          {employees.length} employee{employees.length!==1?"s":""} total &bull; {employees.filter(e=>e.employmentType==="full-time").length} FT &bull; {employees.filter(e=>e.employmentType==="part-time").length} PT &bull; {employees.filter(e=>e.employmentType==="on-call").length} OC &bull; {employees.filter(e=>e.qualifications.includes("Scale")).length} Scale &bull; {employees.filter(e=>e.qualifications.includes("Medical")).length} Medical
          {(afExclude||[]).length>0&&<span style={{color:t.danger,fontWeight:700}}> &bull; {(afExclude||[]).length} excluded from autofill</span>}
        </div>
        <AfExcludeGroupToggles employees={employees} afExclude={afExclude||[]} setAfExclude={setAfExclude} t={t}/>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          {/* Load PSI Roster */}
          {confirmSeedRoster ? (
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:11,color:t.scale,fontWeight:600}}>Load PSI roster? Current employees will be replaced.</span>
              <button onClick={()=>{setEmployees(PSI_SEED_ROSTER);setSchedule({});setConfirmSeedRoster(false);}} style={{background:t.scale,color:"#fff",border:"none",padding:"6px 14px",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>Yes, load</button>
              <button onClick={()=>setConfirmSeedRoster(false)} style={{background:"transparent",color:t.textMuted,border:"1px solid "+t.border,padding:"6px 14px",borderRadius:6,cursor:"pointer",fontSize:11,fontFamily:"inherit"}}>Cancel</button>
            </div>
          ) : (
            <button onClick={()=>setConfirmSeedRoster(true)} style={{background:"transparent",color:t.scale,border:"1px solid "+t.scale+"60",padding:"6px 14px",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"inherit"}}>↺ Load PSI Roster</button>
          )}
          {/* Save as Default */}
          {employees.length>0&&(
            <button id="save-default-btn" onClick={()=>{setCustomSeed(JSON.parse(JSON.stringify(employees)));const btn=document.getElementById("save-default-btn");if(btn){btn.textContent="✓ Saved as Default!";setTimeout(()=>{btn.textContent="⭐ Save as Default";},2000);}}}
              style={{background:"transparent",color:t.accent,border:"1px solid "+t.accent+"60",padding:"6px 14px",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"inherit"}}>⭐ Save as Default</button>
          )}
          {/* Clear All */}
          {employees.length>0&&(confirmClearAll ? (
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:11,color:t.danger,fontWeight:600}}>Clear all {employees.length} employees?</span>
              <button onClick={()=>{setEmployees([]);setSchedule({});setConfirmClearAll(false);}} style={{background:t.danger,color:"#fff",border:"none",padding:"6px 14px",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>Yes, clear</button>
              <button onClick={()=>setConfirmClearAll(false)} style={{background:"transparent",color:t.textMuted,border:"1px solid "+t.border,padding:"6px 14px",borderRadius:6,cursor:"pointer",fontSize:11,fontFamily:"inherit"}}>Cancel</button>
            </div>
          ) : (
            <button onClick={()=>setConfirmClearAll(true)} style={{background:"transparent",color:t.danger,border:"1px solid "+t.danger+"60",padding:"6px 14px",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"inherit"}}>✕ Clear All</button>
          ))}
        </div>
      </div>
    </div>
  );
}
