import { useState, useMemo, useEffect, useCallback, createContext, useContext } from "react";

const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const WEEKDAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday"];
const SHIFTS = [
  { id: "first",  label: "1st Shift", time: "0600 – 1400" },
  { id: "second", label: "2nd Shift", time: "1400 – 2200" },
  { id: "third",  label: "3rd Shift", time: "2200 – 0600" },
];
const POSITIONS = ["Guard","Scale","Medical"];
const ALL_POSITIONS = ["Supervisor",...POSITIONS];
const SHIFT_HOURS = 8;
const FT_MIN_HOURS = 40;

const isWeekday   = (d) => WEEKDAYS.includes(d);
const getSlotCount= (d,s) => (isWeekday(d) && s==="first" ? 4 : 3);
const getAvailPos = (d,s) => (isWeekday(d) && s==="first" ? ALL_POSITIONS : POSITIONS);
const cellKey     = (d,s) => d+"__"+s;

const dark = {
  name:"dark", bg:"#0f1117", surface:"#1a1d27", surfaceAlt:"#22262f",
  border:"#2d3241", text:"#e8eaf0", textMuted:"#8b90a0", textDim:"#5c6070",
  accent:"#4a9eff", supervisor:"#f0a030", guard:"#4a9eff",
  scale:"#50c878", medical:"#e05070", shiftFirst:"#fbbf24",
  shiftSecond:"#60a5fa", shiftThird:"#a78bfa", danger:"#ef4444",
  dangerDim:"#7f1d1d", warning:"#f59e0b", warningDim:"#78350f",
};
const light = {
  name:"light", bg:"#f0f1f5", surface:"#ffffff", surfaceAlt:"#f7f8fa",
  border:"#d8dae0", text:"#1a1d27", textMuted:"#5c6070", textDim:"#8b90a0",
  accent:"#2a6fd6", supervisor:"#c47f10", guard:"#2a6fd6",
  scale:"#1a8a4a", medical:"#c03050", shiftFirst:"#b8860b",
  shiftSecond:"#2a6fd6", shiftThird:"#7c5cbf", danger:"#dc2626",
  dangerDim:"#fde8e8", warning:"#d97706", warningDim:"#fef3c7",
};

const pC = (p,t) => ({Supervisor:t.supervisor,Guard:t.guard,Scale:t.scale,Medical:t.medical}[p]||t.textMuted);
const sC = (id,t)=> ({first:t.shiftFirst,second:t.shiftSecond,third:t.shiftThird}[id]||t.textMuted);

const ThemeCtx = createContext();
const useTheme = () => useContext(ThemeCtx);

function usePersistentState(key, fallback) {
  const [val, setValRaw] = useState(fallback);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get(key);
        if (r && r.value !== undefined) setValRaw(JSON.parse(r.value));
      } catch {}
      setLoaded(true);
    })();
  }, [key]);
  const setVal = useCallback((updater) => {
    setValRaw((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      try { window.storage.set(key, JSON.stringify(next)); } catch {}
      return next;
    });
  }, [key]);
  return [val, setVal, loaded];
}

// hours worked per employee given a schedule map
function calcHours(empId, schedule) {
  let shifts = 0;
  Object.values(schedule).forEach(a => a.forEach(x => { if (x.employeeId === empId) shifts++; }));
  return shifts * SHIFT_HOURS;
}

// ── Overtime Approval Modal ───────────────────────────────────────────────────
function OvertimeModal({ items, onApprove, onCancel }) {
  const t = useTheme();
  const [approved, setApproved] = useState({});
  const toggle = (id) => setApproved(p => ({ ...p, [id]: !p[id] }));
  const allApproved = items.every(i => approved[i.emp.id]);

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}}>
      <div style={{background:t.surface,border:"1px solid "+t.warning,borderRadius:10,padding:28,maxWidth:480,width:"100%",boxShadow:"0 20px 60px rgba(0,0,0,0.5)"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
          <span style={{fontSize:22}}>⚠️</span>
          <h2 style={{margin:0,fontSize:16,fontWeight:700,color:t.warning}}>OVERTIME APPROVAL REQUIRED</h2>
        </div>
        <p style={{margin:"0 0 20px",fontSize:12,color:t.textMuted}}>
          The following Full-Time employees would exceed 40 hours/week. Approve each to proceed or cancel to skip them.
        </p>
        <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:20}}>
          {items.map(({emp, currentHours, newHours}) => (
            <div key={emp.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",background:t.surfaceAlt,border:"1px solid "+(approved[emp.id]?t.warning:t.border),borderRadius:6}}>
              <input type="checkbox" id={"ot_"+emp.id} checked={!!approved[emp.id]} onChange={()=>toggle(emp.id)}
                style={{width:16,height:16,cursor:"pointer",accentColor:t.warning}} />
              <label htmlFor={"ot_"+emp.id} style={{flex:1,cursor:"pointer"}}>
                <div style={{fontWeight:700,fontSize:13,color:t.text}}>{emp.name}</div>
                <div style={{fontSize:11,color:t.textMuted,marginTop:2}}>
                  Current: <span style={{color:t.text,fontWeight:600}}>{currentHours}h</span>
                  {" → "}
                  <span style={{color:t.warning,fontWeight:700}}>{newHours}h</span>
                  {" "}
                  <span style={{color:t.warning,fontSize:10}}>({newHours - 40}h OT)</span>
                </div>
              </label>
              {approved[emp.id] && <span style={{fontSize:11,color:t.warning,fontWeight:700}}>APPROVED ✓</span>}
            </div>
          ))}
        </div>
        <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
          <button onClick={onCancel} style={{background:"transparent",color:t.textMuted,border:"1px solid "+t.border,padding:"9px 20px",borderRadius:6,cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit"}}>
            CANCEL AUTO-FILL
          </button>
          <button onClick={()=>onApprove(approved)} style={{background:t.warning,color:"#000",border:"none",padding:"9px 20px",borderRadius:6,cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>
            PROCEED ({Object.values(approved).filter(Boolean).length}/{items.length} approved)
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Under-Hours Banner ────────────────────────────────────────────────────────
function UnderHoursBanner({ employees, schedule }) {
  const t = useTheme();
  const underHours = useMemo(() => {
    return employees.filter(e => {
      if (e.employmentType !== "full-time") return false;
      return calcHours(e.id, schedule) < FT_MIN_HOURS;
    }).map(e => ({ emp: e, hours: calcHours(e.id, schedule) }));
  }, [employees, schedule]);

  if (!underHours.length) return null;

  return (
    <div style={{background:t.dangerDim,border:"1px solid "+t.danger,borderRadius:6,padding:"10px 16px",marginBottom:16,fontSize:12}}>
      <div style={{fontWeight:700,color:t.danger,marginBottom:6,fontSize:13}}>⚠ UNDER 40 HOURS — FULL-TIME EMPLOYEES</div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {underHours.map(({emp,hours}) => (
          <span key={emp.id} style={{background:t.danger+"20",border:"1px solid "+t.danger+"50",padding:"3px 10px",borderRadius:4,color:t.name==="dark"?"#fca5a5":t.danger,fontWeight:600}}>
            {emp.name}: {hours}h / 40h
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Employee Manager ──────────────────────────────────────────────────────────
function EmployeeManager({ employees, setEmployees, schedule, setSchedule }) {
  const t = useTheme();
  const [newName,  setNewName]  = useState("");
  const [newQuals, setNewQuals] = useState(["Guard"]);
  const [newType,  setNewType]  = useState("full-time");
  const [editId,   setEditId]   = useState(null);
  const [editName, setEditName] = useState("");
  const [editQuals,setEditQuals]= useState([]);
  const [editType, setEditType] = useState("full-time");
  const [errors,   setErrors]   = useState([]);
  const [search,   setSearch]   = useState("");

  const toggleQ = (pos,arr,set) => set(arr.includes(pos)?arr.filter(x=>x!==pos):[...arr,pos]);

  const addEmployee = () => {
    const name = newName.trim();
    if (!name) return;
    if (!newQuals.length) { setErrors(["Select at least one position."]); setTimeout(()=>setErrors([]),3000); return; }
    if (employees.some(e=>e.name.toLowerCase()===name.toLowerCase())) { setErrors(["Name already exists."]); setTimeout(()=>setErrors([]),3000); return; }
    setEmployees(p=>[...p,{id:Date.now().toString(),name,qualifications:[...newQuals],employmentType:newType}]);
    setNewName(""); setNewQuals(["Guard"]); setNewType("full-time"); setErrors([]);
  };

  const removeEmployee = (id) => {
    setEmployees(p=>p.filter(e=>e.id!==id));
    setSchedule(p=>{ const n={...p}; Object.keys(n).forEach(k=>{n[k]=n[k].filter(a=>a.employeeId!==id)}); return n; });
  };

  const saveEdit = () => {
    if (!editName.trim()||!editQuals.length) return;
    setEmployees(p=>p.map(e=>e.id===editId?{...e,name:editName.trim(),qualifications:[...editQuals],employmentType:editType}:e));
    setEditId(null);
  };

  const shiftHours = useMemo(()=>{
    const c={}; employees.forEach(e=>(c[e.id]=0));
    Object.values(schedule).forEach(a=>a.forEach(x=>{ if(c[x.employeeId]!==undefined) c[x.employeeId]+=SHIFT_HOURS; }));
    return c;
  },[schedule,employees]);

  const filtered = employees.filter(e=>
    e.name.toLowerCase().includes(search.toLowerCase())||
    e.qualifications.some(q=>q.toLowerCase().includes(search.toLowerCase()))
  );

  const iS = { background:t.surfaceAlt, border:"1px solid "+t.border, color:t.text,
    padding:"10px 14px", borderRadius:6, outline:"none", fontSize:14,
    fontFamily:"'JetBrains Mono',monospace" };

  const TypeToggle = ({ val, set }) => (
    <div style={{display:"flex",borderRadius:6,overflow:"hidden",border:"1px solid "+t.border,width:"fit-content"}}>
      {[["full-time","FT"],["part-time","PT"]].map(([v,label])=>(
        <button key={v} onClick={()=>set(v)} style={{
          background:val===v?(v==="full-time"?t.accent:t.scale):t.surfaceAlt,
          color:val===v?"#fff":t.textMuted,
          border:"none", padding:"7px 16px", cursor:"pointer",
          fontSize:11, fontWeight:700, fontFamily:"inherit", transition:"all .2s",
        }}>{label}</button>
      ))}
    </div>
  );

  const QualBtns = ({quals,toggle}) => (
    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
      {ALL_POSITIONS.map(pos=>{
        const on=quals.includes(pos);
        return (
          <button key={pos} onClick={()=>toggle(pos)} style={{
            background:on?pC(pos,t)+"20":t.surfaceAlt, border:"1.5px solid "+(on?pC(pos,t):t.border),
            color:on?pC(pos,t):t.textDim, padding:"7px 14px", borderRadius:6,
            cursor:"pointer", fontSize:12, fontWeight:600, fontFamily:"inherit",
            display:"flex", alignItems:"center", gap:6,
          }}>
            <span style={{width:13,height:13,borderRadius:3,border:"1.5px solid "+(on?pC(pos,t):t.textDim),background:on?pC(pos,t):"transparent",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:"#fff",flexShrink:0}}>{on?"✓":""}</span>
            {pos}
          </button>
        );
      })}
    </div>
  );

  return (
    <div>
      {errors.length>0 && <div style={{background:t.dangerDim,border:"1px solid "+t.danger,borderRadius:6,padding:"10px 16px",marginBottom:16,fontSize:13,color:t.name==="dark"?"#fca5a5":t.danger}}>{errors[0]}</div>}

      <div style={{background:t.surface,border:"1px solid "+t.border,borderRadius:8,padding:20,marginBottom:24}}>
        <h3 style={{margin:"0 0 16px",fontSize:14,fontWeight:600,color:t.textMuted}}>+ ADD EMPLOYEE</h3>
        <div style={{display:"flex",gap:16,flexWrap:"wrap",alignItems:"flex-end"}}>
          <div style={{flex:"1 1 180px"}}>
            <label style={{display:"block",fontSize:11,color:t.textDim,marginBottom:6}}>NAME</label>
            <input value={newName} onChange={e=>setNewName(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&addEmployee()}
              placeholder="Enter employee name"
              style={{...iS,width:"100%",boxSizing:"border-box"}} />
          </div>
          <div>
            <label style={{display:"block",fontSize:11,color:t.textDim,marginBottom:6}}>TYPE</label>
            <TypeToggle val={newType} set={setNewType} />
          </div>
          <div style={{flex:"1 1 320px"}}>
            <label style={{display:"block",fontSize:11,color:t.textDim,marginBottom:6}}>QUALIFIED POSITIONS</label>
            <QualBtns quals={newQuals} toggle={p=>toggleQ(p,newQuals,setNewQuals)} />
          </div>
          <button onClick={addEmployee} style={{background:t.accent,color:"#fff",border:"none",padding:"10px 20px",borderRadius:6,cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"inherit"}}>ADD</button>
        </div>
      </div>

      {employees.length>0 && <div style={{marginBottom:16}}><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by name or position..." style={{...iS,width:"100%",maxWidth:360,boxSizing:"border-box"}} /></div>}

      {filtered.length===0&&employees.length===0 ? (
        <div style={{textAlign:"center",padding:48,color:t.textDim,fontSize:14}}><div style={{fontSize:32,marginBottom:12}}>◇</div>No employees yet. Add your team above.</div>
      ) : filtered.length===0 ? (
        <div style={{textAlign:"center",padding:32,color:t.textDim,fontSize:13}}>No matches found.</div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 60px 1fr 80px 80px",gap:12,padding:"8px 16px",fontSize:11,color:t.textDim,textTransform:"uppercase",letterSpacing:".05em"}}>
            <span>Name</span><span>Type</span><span>Qualifications</span><span>Hours</span><span>Actions</span>
          </div>
          {filtered.map(emp=>{
            const hours = shiftHours[emp.id]||0;
            const isFT = emp.employmentType === "full-time";
            const isUnder = isFT && hours < FT_MIN_HOURS;
            const isOver  = hours > 40;
            return editId===emp.id ? (
              <div key={emp.id} style={{padding:"14px 16px",background:t.surfaceAlt,border:"1px solid "+t.accent,borderRadius:6,display:"flex",flexDirection:"column",gap:12}}>
                <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"center"}}>
                  <input value={editName} onChange={e=>setEditName(e.target.value)} style={{...iS,flex:"1 1 200px",boxSizing:"border-box"}} />
                  <TypeToggle val={editType} set={setEditType} />
                </div>
                <QualBtns quals={editQuals} toggle={p=>toggleQ(p,editQuals,setEditQuals)} />
                <div style={{display:"flex",gap:8}}>
                  <button onClick={saveEdit} style={{background:t.scale,color:"#fff",border:"none",padding:"8px 16px",borderRadius:5,cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit"}}>SAVE</button>
                  <button onClick={()=>setEditId(null)} style={{background:"transparent",color:t.textMuted,border:"1px solid "+t.border,padding:"8px 16px",borderRadius:5,cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit"}}>CANCEL</button>
                </div>
              </div>
            ) : (
              <div key={emp.id} style={{display:"grid",gridTemplateColumns:"1fr 60px 1fr 80px 80px",gap:12,alignItems:"center",padding:"12px 16px",background:t.surface,border:"1px solid "+(isUnder?t.danger+"60":t.border),borderRadius:6}}>
                <span style={{fontWeight:600,fontSize:14}}>{emp.name}</span>
                <span style={{fontSize:10,fontWeight:700,padding:"2px 7px",borderRadius:4,textAlign:"center",
                  background:(emp.employmentType==="full-time"?t.accent:t.scale)+"20",
                  color:emp.employmentType==="full-time"?t.accent:t.scale,
                  border:"1px solid "+(emp.employmentType==="full-time"?t.accent:t.scale)+"40"}}>
                  {emp.employmentType==="full-time"?"FT":"PT"}
                </span>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {emp.qualifications.map(q=>(<span key={q} style={{fontSize:10,color:pC(q,t),fontWeight:700,background:pC(q,t)+"15",border:"1px solid "+pC(q,t)+"30",padding:"2px 8px",borderRadius:4}}>{q}</span>))}
                </div>
                <span style={{fontSize:12,fontWeight:700,color:isOver?t.warning:isUnder?t.danger:hours===40?t.scale:t.text}}>
                  {hours}h{isFT?" / 40h":""}
                  {isUnder && " ⚠"}{isOver && " OT"}
                </span>
                <div style={{display:"flex",gap:6}}>
                  <button onClick={()=>{setEditId(emp.id);setEditName(emp.name);setEditQuals([...emp.qualifications]);setEditType(emp.employmentType||"full-time");}} style={{background:"transparent",border:"none",color:t.accent,cursor:"pointer",fontSize:13,padding:2}} title="Edit">✎</button>
                  <button onClick={()=>removeEmployee(emp.id)} style={{background:"transparent",border:"none",color:t.textDim,cursor:"pointer",fontSize:14,padding:2}} onMouseEnter={e=>e.target.style.color=t.danger} onMouseLeave={e=>e.target.style.color=t.textDim} title="Delete">✕</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div style={{marginTop:16,fontSize:11,color:t.textDim}}>
        {employees.length} employee{employees.length!==1?"s":""} total{" • "}
        {employees.filter(e=>e.employmentType==="full-time").length} FT{" • "}
        {employees.filter(e=>e.employmentType!=="full-time").length} PT{" • "}
        {employees.filter(e=>e.qualifications.includes("Scale")).length} Scale-qualified{" • "}
        {employees.filter(e=>e.qualifications.includes("Medical")).length} Medical-qualified
      </div>
    </div>
  );
}

// ── Emp Picker ────────────────────────────────────────────────────────────────
function EmpPicker({emp,day,sid,st,assign,getPos,schedule}) {
  const t = useTheme();
  const [sel,setSel] = useState(null);
  const pos = getPos(emp,day,sid);
  if (!pos.length) return null;

  const currentHours = calcHours(emp.id, schedule);
  const wouldBeOver  = emp.employmentType==="full-time" && currentHours >= 40;

  const doAssign = (position) => {
    if (wouldBeOver) {
      if (!window.confirm(`${emp.name} is already at ${currentHours}h this week (${currentHours+SHIFT_HOURS}h after this shift).\n\nApprove overtime?`)) return;
    }
    assign(day,sid,emp.id,position);
  };

  if (sel===null) return (
    <button onClick={()=>{
      if (pos.length===1) doAssign(pos[0]);
      else { let d=pos[0]; if(!st.hasScale&&pos.includes("Scale")) d="Scale"; else if(!st.hasMedical&&pos.includes("Medical")) d="Medical"; setSel(d); }
    }} style={{background:t.surface,border:"1px solid "+(wouldBeOver?t.warning:t.border),borderRadius:3,color:t.text,cursor:"pointer",fontSize:10,padding:"5px 8px",textAlign:"left",fontFamily:"inherit",fontWeight:600,display:"flex",alignItems:"center",justifyContent:"space-between",gap:6}}
       onMouseEnter={e=>e.currentTarget.style.borderColor=wouldBeOver?t.warning:t.accent} onMouseLeave={e=>e.currentTarget.style.borderColor=wouldBeOver?t.warning:t.border}>
      <span>{emp.name}{wouldBeOver && <span style={{color:t.warning,marginLeft:4,fontSize:9}}>OT</span>}</span>
      <span style={{display:"flex",gap:3}}>{pos.map(p=>(<span key={p} style={{width:6,height:6,borderRadius:"50%",background:pC(p,t),display:"inline-block"}}/>))}</span>
    </button>
  );
  return (
    <div style={{display:"flex",gap:4,alignItems:"center",background:t.surface,border:"1px solid "+t.accent,borderRadius:3,padding:"3px 6px"}}>
      <span style={{fontSize:10,fontWeight:600,flex:1}}>{emp.name}{wouldBeOver && <span style={{color:t.warning,marginLeft:3,fontSize:9}}>OT</span>}</span>
      <select value={sel} onChange={e=>setSel(e.target.value)} style={{background:t.surfaceAlt,border:"1px solid "+t.border,color:t.text,fontSize:9,padding:"2px 4px",borderRadius:2,fontFamily:"inherit",cursor:"pointer"}}>
        {pos.map(p=>(<option key={p} value={p}>{p}</option>))}
      </select>
      <button onClick={()=>doAssign(sel)} style={{background:t.accent,border:"none",color:"#fff",fontSize:9,padding:"3px 6px",borderRadius:2,cursor:"pointer",fontWeight:700,fontFamily:"inherit"}}>✓</button>
    </div>
  );
}

// ── Schedule Grid ─────────────────────────────────────────────────────────────
function ScheduleGrid({employees,schedule,setSchedule}) {
  const t = useTheme();
  const [editingCell,setEditingCell] = useState(null);
  const [dragEmp,setDragEmp] = useState(null);
  const [overtimeItems, setOvertimeItems] = useState(null);
  const [pendingSchedule, setPendingSchedule] = useState(null);

  const getAsgn     = (d,s) => schedule[cellKey(d,s)]||[];
  const getName     = (id)  => employees.find(e=>e.id===id)?.name||"?";
  const getAssignable=(emp,d,s)=>getAvailPos(d,s).filter(p=>emp.qualifications.includes(p));
  const unassigned  = (d,s) => { const ids=getAsgn(d,s).map(a=>a.employeeId); return employees.filter(e=>!ids.includes(e.id)); };

  const assignEmp = (d,s,eid,pos) => {
    const key=cellKey(d,s); const cur=schedule[key]||[];
    if (cur.length>=getSlotCount(d,s)||cur.some(a=>a.employeeId===eid)) return;
    setSchedule(p=>({...p,[key]:[...cur,{employeeId:eid,position:pos}]}));
    setEditingCell(null);
  };

  const removeAsgn = (d,s,eid) => {
    const key=cellKey(d,s);
    setSchedule(p=>({...p,[key]:(p[key]||[]).filter(a=>a.employeeId!==eid)}));
  };

  const getStatus = (d,s) => {
    const a=getAsgn(d,s);
    const hasScale=a.some(x=>x.position==="Scale");
    const hasMed=a.some(x=>x.position==="Medical");
    const isFull=a.length>=getSlotCount(d,s);
    const missing=[...(!hasScale?["Scale"]:[]),...(!hasMed?["Medical"]:[])];
    return {hasScale,hasMedical:hasMed,isFull,missing,ok:missing.length===0};
  };

  const handleDrop = (d,s) => {
    if (!dragEmp) return;
    const cur=getAsgn(d,s);
    if (cur.length>=getSlotCount(d,s)||cur.some(a=>a.employeeId===dragEmp.id)) return;
    const ap=getAssignable(dragEmp,d,s); if (!ap.length) return;
    const st=getStatus(d,s); let pos=ap[0];
    if (!st.hasScale&&ap.includes("Scale")) pos="Scale";
    else if (!st.hasMedical&&ap.includes("Medical")) pos="Medical";
    else if (isWeekday(d)&&s==="first"&&!cur.some(a=>a.position==="Supervisor")&&ap.includes("Supervisor")) pos="Supervisor";
    // check overtime for manual drop
    const currentHours = calcHours(dragEmp.id, schedule);
    if (dragEmp.employmentType==="full-time" && currentHours >= 40) {
      if (!window.confirm(`${dragEmp.name} is at ${currentHours}h this week. Approve overtime?`)) { setDragEmp(null); return; }
    }
    assignEmp(d,s,dragEmp.id,pos); setDragEmp(null);
  };

  // Build tentative schedule, then check for FT employees going over 40h
  const autoFill = () => {
    const ns={}; const el=[...employees]; if (!el.length) return;

    // Track hours in the new schedule being built
    const hourTracker = {};
    employees.forEach(e => { hourTracker[e.id] = 0; });

    for (const day of DAYS) {
      for (const shift of SHIFTS) {
        const key=cellKey(day,shift.id); const slots=getSlotCount(day,shift.id);
        const asgn=[]; const used=new Set();

        const tryAdd = (emp, position) => {
          hourTracker[emp.id] = (hourTracker[emp.id]||0) + SHIFT_HOURS;
          asgn.push({employeeId:emp.id,position}); used.add(emp.id);
        };

        const sc=el.find(e=>e.qualifications.includes("Scale")&&!used.has(e.id));
        if (sc) tryAdd(sc,"Scale");
        const md=el.find(e=>e.qualifications.includes("Medical")&&!used.has(e.id));
        if (md) tryAdd(md,"Medical");
        if (isWeekday(day)&&shift.id==="first") {
          const su=el.find(e=>e.qualifications.includes("Supervisor")&&!used.has(e.id));
          if (su) tryAdd(su,"Supervisor");
        }
        while (asgn.length<slots) {
          const rem=el.filter(e=>!used.has(e.id)); if (!rem.length) break;
          const emp=rem[0];
          const ap=getAvailPos(day,shift.id).filter(p=>emp.qualifications.includes(p));
          tryAdd(emp, ap.includes("Guard")?"Guard":(ap[0]||emp.qualifications[0]));
        }
        ns[key]=asgn; el.push(el.shift());
      }
    }

    // Find FT employees that would go over 40h
    const otItems = employees
      .filter(e => e.employmentType==="full-time" && (hourTracker[e.id]||0) > 40)
      .map(e => ({ emp: e, currentHours: 0, newHours: hourTracker[e.id] }));

    if (otItems.length > 0) {
      setPendingSchedule(ns);
      setOvertimeItems(otItems);
    } else {
      setSchedule(ns);
    }
  };

  const handleOvertimeApproval = (approved) => {
    if (!pendingSchedule) return;
    // Remove unapproved OT employees from schedule
    const unapprovedIds = new Set(
      overtimeItems.filter(i => !approved[i.emp.id]).map(i => i.emp.id)
    );
    if (unapprovedIds.size > 0) {
      // Re-run auto-fill but exclude unapproved employees from any slot that would push them over 40
      const hourTracker = {};
      employees.forEach(e => { hourTracker[e.id] = 0; });
      const cleaned = {};
      Object.keys(pendingSchedule).forEach(key => {
        cleaned[key] = pendingSchedule[key].filter(a => {
          if (!unapprovedIds.has(a.employeeId)) { hourTracker[a.employeeId]=(hourTracker[a.employeeId]||0)+SHIFT_HOURS; return true; }
          const emp = employees.find(e=>e.id===a.employeeId);
          if (!emp) return false;
          if ((hourTracker[a.employeeId]||0) + SHIFT_HOURS > 40) return false;
          hourTracker[a.employeeId]=(hourTracker[a.employeeId]||0)+SHIFT_HOURS;
          return true;
        });
      });
      setSchedule(cleaned);
    } else {
      setSchedule(pendingSchedule);
    }
    setOvertimeItems(null);
    setPendingSchedule(null);
  };

  const handleOvertimeCancel = () => {
    setOvertimeItems(null);
    setPendingSchedule(null);
  };

  if (!employees.length) return <div style={{textAlign:"center",padding:48,color:t.textDim,fontSize:14}}><div style={{fontSize:32,marginBottom:12}}>◇</div>Add employees first to build a schedule.</div>;

  return (
    <>
      {overtimeItems && <OvertimeModal items={overtimeItems} onApprove={handleOvertimeApproval} onCancel={handleOvertimeCancel} />}

      <UnderHoursBanner employees={employees} schedule={schedule} />

      <div style={{display:"flex",gap:20,marginBottom:12,fontSize:12,flexWrap:"wrap"}}>
        {ALL_POSITIONS.map(p=>(<span key={p} style={{display:"flex",alignItems:"center",gap:6}}><span style={{width:10,height:10,borderRadius:2,background:pC(p,t)}}/><span style={{color:t.textMuted}}>{p}</span></span>))}
        <span style={{color:t.textDim}}>|</span>
        {SHIFTS.map(s=>(<span key={s.id} style={{display:"flex",alignItems:"center",gap:6}}><span style={{width:10,height:3,borderRadius:1,background:sC(s.id,t)}}/><span style={{color:t.textMuted}}>{s.label} ({s.time})</span></span>))}
      </div>

      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:20,padding:"8px 14px",background:t.accent+"10",border:"1px solid "+t.accent+"25",borderRadius:6,fontSize:11,color:t.textMuted}}>
        <span style={{color:t.accent,fontWeight:700}}>ℹ</span>
        Every shift requires at least one <span style={{color:t.scale,fontWeight:700,margin:"0 3px"}}>Scale</span> and one <span style={{color:t.medical,fontWeight:700,margin:"0 3px"}}>Medical</span>. Full-Time employees must reach 40h/week.
      </div>

      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:16,padding:"10px 14px",background:t.surfaceAlt,border:"1px solid "+t.border,borderRadius:6}}>
        <span style={{fontSize:10,color:t.textDim,fontWeight:600,alignSelf:"center",marginRight:8}}>DRAG:</span>
        {employees.map(emp=>{
          const hours = calcHours(emp.id, schedule);
          const isFT = emp.employmentType==="full-time";
          return (
            <span key={emp.id} draggable onDragStart={()=>setDragEmp(emp)} onDragEnd={()=>setDragEmp(null)}
              style={{fontSize:10,fontWeight:600,padding:"4px 10px",borderRadius:4,background:t.surface,border:"1px solid "+(isFT&&hours>40?t.warning:t.border),cursor:"grab",color:t.text,display:"flex",alignItems:"center",gap:4}}>
              {emp.name}
              <span style={{fontSize:9,color:isFT&&hours<40?t.danger:isFT&&hours>40?t.warning:t.textDim}}>{hours}h</span>
              <span style={{display:"flex",gap:2}}>{emp.qualifications.map(q=>(<span key={q} style={{width:5,height:5,borderRadius:"50%",background:pC(q,t)}}/>))}</span>
            </span>
          );
        })}
      </div>

      <div style={{overflowX:"auto"}}>
        <div style={{minWidth:900}}>
          <div style={{display:"grid",gridTemplateColumns:"100px repeat(7,1fr)",gap:2,marginBottom:2}}>
            <div/>
            {DAYS.map(d=>(<div key={d} style={{background:t.surfaceAlt,padding:"10px 8px",textAlign:"center",fontSize:12,fontWeight:700,letterSpacing:".04em",borderRadius:"4px 4px 0 0",color:isWeekday(d)?t.text:t.textMuted}}>{d.substring(0,3).toUpperCase()}</div>))}
          </div>

          {SHIFTS.map(shift=>(
            <div key={shift.id} style={{display:"grid",gridTemplateColumns:"100px repeat(7,1fr)",gap:2,marginBottom:2}}>
              <div style={{background:t.surface,padding:"12px 10px",display:"flex",flexDirection:"column",justifyContent:"center",borderLeft:"3px solid "+sC(shift.id,t),borderRadius:"4px 0 0 4px"}}>
                <div style={{fontSize:12,fontWeight:700}}>{shift.label}</div>
                <div style={{fontSize:10,color:t.textDim,marginTop:2}}>{shift.time}</div>
              </div>

              {DAYS.map(day=>{
                const asgn=getAsgn(day,shift.id);
                const max=getSlotCount(day,shift.id);
                const st=getStatus(day,shift.id);
                const isEd=editingCell?.day===day&&editingCell?.shiftId===shift.id;
                const warn=asgn.length>0&&!st.ok;
                return (
                  <div key={day}
                    onDragOver={e=>{e.preventDefault();e.currentTarget.style.borderColor=t.accent;}}
                    onDragLeave={e=>{e.currentTarget.style.borderColor=warn?t.warning+"60":t.border;}}
                    onDrop={e=>{e.preventDefault();e.currentTarget.style.borderColor=warn?t.warning+"60":t.border;handleDrop(day,shift.id);}}
                    style={{background:warn?t.warningDim+"30":t.surface,border:"1px solid "+(warn?t.warning+"60":t.border),borderRadius:4,padding:8,minHeight:105,display:"flex",flexDirection:"column",gap:4,transition:"border-color .2s"}}>

                    {warn && <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:2}}>
                      {st.missing.map(r=>(<span key={r} style={{fontSize:8,fontWeight:700,color:t.warning,background:t.warning+"18",border:"1px solid "+t.warning+"30",padding:"1px 5px",borderRadius:3}}>⚠ NEED {r.toUpperCase()}</span>))}
                    </div>}

                    {asgn.map(a=>(
                      <div key={a.employeeId} style={{display:"flex",alignItems:"center",gap:5,padding:"4px 6px",background:pC(a.position,t)+"15",border:"1px solid "+pC(a.position,t)+"30",borderRadius:4,fontSize:11}}>
                        <span style={{width:6,height:6,borderRadius:"50%",background:pC(a.position,t),flexShrink:0}}/>
                        <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:600,fontSize:10}}>{getName(a.employeeId)}</span>
                        <span style={{fontSize:9,color:pC(a.position,t),fontWeight:700,flexShrink:0}}>{a.position.substring(0,3).toUpperCase()}</span>
                        <button onClick={()=>removeAsgn(day,shift.id,a.employeeId)} style={{background:"transparent",border:"none",color:t.textDim,cursor:"pointer",fontSize:10,padding:"0 2px",lineHeight:1}}>✕</button>
                      </div>
                    ))}

                    {!st.isFull&&!isEd && (
                      <button onClick={()=>setEditingCell({day,shiftId:shift.id})}
                        style={{background:t.accent+"10",border:"1px dashed "+t.border,borderRadius:4,color:t.textDim,cursor:"pointer",fontSize:11,padding:"4px 0",fontFamily:"inherit",transition:"all .2s",marginTop:"auto"}}
                        onMouseEnter={e=>{e.target.style.borderColor=t.accent;e.target.style.color=t.accent;}}
                        onMouseLeave={e=>{e.target.style.borderColor=t.border;e.target.style.color=t.textDim;}}>
                        + Add ({asgn.length}/{max})
                      </button>
                    )}

                    {isEd && (
                      <div style={{background:t.surfaceAlt,border:"1px solid "+t.accent,borderRadius:4,padding:6,marginTop:"auto"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                          <span style={{fontSize:10,color:t.textMuted,fontWeight:600}}>SELECT</span>
                          <button onClick={()=>setEditingCell(null)} style={{background:"transparent",border:"none",color:t.textDim,cursor:"pointer",fontSize:12}}>✕</button>
                        </div>
                        <div style={{maxHeight:130,overflowY:"auto",display:"flex",flexDirection:"column",gap:3}}>
                          {unassigned(day,shift.id).filter(e=>getAssignable(e,day,shift.id).length>0).map(emp=>(
                            <EmpPicker key={emp.id} emp={emp} day={day} sid={shift.id} st={st} assign={assignEmp} getPos={getAssignable} schedule={schedule}/>
                          ))}
                          {unassigned(day,shift.id).filter(e=>getAssignable(e,day,shift.id).length>0).length===0 && (
                            <div style={{fontSize:10,color:t.textDim,textAlign:"center",padding:4}}>No qualified employees</div>
                          )}
                        </div>
                      </div>
                    )}

                    {st.isFull&&st.ok && <div style={{fontSize:9,color:t.scale,textAlign:"center",marginTop:"auto",fontWeight:700,letterSpacing:".05em"}}>● FULL</div>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div style={{display:"flex",gap:12,marginTop:20}}>
        <button onClick={autoFill} style={{background:t.scale,color:"#fff",border:"none",padding:"10px 20px",borderRadius:6,cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"inherit"}}>⚡ AUTO-FILL</button>
        <button onClick={()=>setSchedule({})} style={{background:"transparent",color:t.danger,border:"1px solid "+t.danger,padding:"10px 20px",borderRadius:6,cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"inherit"}}>CLEAR</button>
      </div>
    </>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function ShiftScheduler() {
  const [themeName, setThemeName, themeLoaded] = usePersistentState("shift_theme","dark");
  const [employees, setEmployees, empLoaded]   = usePersistentState("shift_employees",[]);
  const [schedule,  setSchedule,  schedLoaded] = usePersistentState("shift_schedule",{});
  const [activeTab, setActiveTab] = useState("schedule");

  const t = themeName==="dark" ? dark : light;

  const totalSlots  = useMemo(()=>{ let n=0; DAYS.forEach(d=>SHIFTS.forEach(s=>(n+=getSlotCount(d,s.id)))); return n; },[]);
  const filledSlots = useMemo(()=>Object.values(schedule).reduce((s,a)=>s+a.length,0),[schedule]);
  const unmetReqs   = useMemo(()=>{
    let c=0;
    DAYS.forEach(d=>SHIFTS.forEach(s=>{
      const a=schedule[cellKey(d,s.id)]||[];
      if (a.length>0&&(!a.some(x=>x.position==="Scale")||!a.some(x=>x.position==="Medical"))) c++;
    }));
    return c;
  },[schedule]);

  const underHoursCount = useMemo(()=>
    employees.filter(e=>e.employmentType==="full-time"&&calcHours(e.id,schedule)<FT_MIN_HOURS).length
  ,[employees,schedule]);

  if (!themeLoaded||!empLoaded||!schedLoaded) return (
    <div style={{minHeight:"100vh",background:dark.bg,display:"flex",alignItems:"center",justifyContent:"center",color:dark.textMuted,fontFamily:"monospace",fontSize:14}}>Loading…</div>
  );

  return (
    <ThemeCtx.Provider value={t}>
      <div style={{minHeight:"100vh",background:t.bg,color:t.text,fontFamily:"'JetBrains Mono','Fira Code','Courier New',monospace"}}>

        <div style={{background:t.surface,borderBottom:"1px solid "+t.border,padding:"20px 28px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:4}}>
              <div style={{width:10,height:10,borderRadius:"50%",background:t.accent,boxShadow:"0 0 10px "+t.accent+"88"}}/>
              <h1 style={{margin:0,fontSize:22,fontWeight:700,letterSpacing:"-.02em"}}>SHIFT SCHEDULER</h1>
            </div>
            <p style={{margin:0,fontSize:12,color:t.textMuted,paddingLeft:24}}>24/7 Operations — 8-Hour Rotations — Scale & Medical Required</p>
          </div>
          <button onClick={()=>setThemeName(p=>p==="dark"?"light":"dark")} title="Toggle theme"
            style={{background:t.surfaceAlt,border:"1px solid "+t.border,color:t.textMuted,padding:"8px 14px",borderRadius:6,cursor:"pointer",fontSize:14,fontFamily:"inherit",display:"flex",alignItems:"center",gap:6}}
            onMouseEnter={e=>{e.currentTarget.style.borderColor=t.accent;e.currentTarget.style.color=t.accent;}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor=t.border;e.currentTarget.style.color=t.textMuted;}}>
            {themeName==="dark"?"☀":"☽"}
          </button>
        </div>

        <div style={{display:"flex",gap:24,padding:"14px 28px",background:t.surface,borderBottom:"1px solid "+t.border,fontSize:12,flexWrap:"wrap"}}>
          <span><span style={{color:t.textMuted}}>ROSTER:</span> <span style={{color:t.accent,fontWeight:700}}>{employees.length}</span></span>
          <span><span style={{color:t.textMuted}}>FILLED:</span> <span style={{color:filledSlots===totalSlots?t.scale:t.supervisor,fontWeight:700}}>{filledSlots}/{totalSlots}</span></span>
          <span><span style={{color:t.textMuted}}>SHIFTS/WEEK:</span> <span style={{fontWeight:700}}>21</span></span>
          {unmetReqs>0 && <span><span style={{color:t.warning}}>⚠ COVERAGE:</span> <span style={{color:t.warning,fontWeight:700}}>{unmetReqs}</span></span>}
          {underHoursCount>0 && <span><span style={{color:t.danger}}>⚠ UNDER 40H:</span> <span style={{color:t.danger,fontWeight:700}}>{underHoursCount} FT</span></span>}
          <span style={{marginLeft:"auto",color:t.textDim,fontSize:10}}>Auto-saved across sessions</span>
        </div>

        <div style={{display:"flex",padding:"0 28px",background:t.surface,borderBottom:"1px solid "+t.border}}>
          {[{id:"employees",label:"▣ Employees"},{id:"schedule",label:"▦ Schedule"}].map(tab=>(
            <button key={tab.id} onClick={()=>setActiveTab(tab.id)} style={{background:"transparent",border:"none",borderBottom:activeTab===tab.id?"2px solid "+t.accent:"2px solid transparent",color:activeTab===tab.id?t.text:t.textMuted,padding:"12px 24px",cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"inherit",letterSpacing:".05em",textTransform:"uppercase",transition:"all .2s"}}>{tab.label}</button>
          ))}
        </div>

        <div style={{padding:"24px 28px"}}>
          {activeTab==="employees" && <EmployeeManager employees={employees} setEmployees={setEmployees} schedule={schedule} setSchedule={setSchedule}/>}
          {activeTab==="schedule"  && <ScheduleGrid employees={employees} schedule={schedule} setSchedule={setSchedule}/>}
        </div>
      </div>
    </ThemeCtx.Provider>
  );
}
