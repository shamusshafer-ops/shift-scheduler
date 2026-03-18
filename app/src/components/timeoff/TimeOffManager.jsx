import { useState } from "react";
import { useTheme } from "../../context/ThemeContext.jsx";
import { SHIFTS } from "../../constants/index.js";

// ── TimeOffCalendar ───────────────────────────────────────────────────────────
function TimeOffCalendar({ employees, timeOffRequests }) {
  const { theme: t } = useTheme();
  const [focusDate,    setFocusDate]    = useState(null);
  const [monthOffset,  setMonthOffset]  = useState(0);

  const today = new Date(); today.setHours(0,0,0,0);

  const dateMap = {};
  (timeOffRequests||[]).forEach(req => {
    const emp = employees.find(e => e.id === req.empId); if (!emp) return;
    const start = new Date(req.startDate+"T00:00:00");
    const end   = new Date((req.endDate||req.startDate)+"T00:00:00");
    for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)) {
      const key = d.toISOString().slice(0,10);
      if (!dateMap[key]) dateMap[key] = [];
      dateMap[key].push({ emp, req });
    }
  });

  const statusDot = s => s==="approved"?t.scale:s==="denied"?t.danger:t.warning;

  const renderMonth = (year, month) => {
    const monthName  = new Date(year,month,1).toLocaleString("default",{month:"long",year:"numeric"});
    const firstDay   = new Date(year,month,1).getDay();
    const daysInMonth= new Date(year,month+1,0).getDate();
    const cells = [];
    for (let i=0;i<firstDay;i++) cells.push(null);
    for (let d=1;d<=daysInMonth;d++) cells.push(d);

    return (
      <div key={`${year}-${month}`} style={{flex:"1 1 260px",minWidth:230}}>
        <div style={{textAlign:"center",fontWeight:700,fontSize:12,color:t.text,marginBottom:8,letterSpacing:".04em"}}>{monthName.toUpperCase()}</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:1}}>
          {["Su","Mo","Tu","We","Th","Fr","Sa"].map(d=>(
            <div key={d} style={{textAlign:"center",fontSize:9,fontWeight:700,color:t.textDim,padding:"3px 0",letterSpacing:".04em"}}>{d}</div>
          ))}
          {cells.map((day,i) => {
            if (!day) return <div key={"e"+i}/>;
            const dateStr=`${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
            const entries=dateMap[dateStr]||[];
            const isToday=dateStr===today.toISOString().slice(0,10);
            const isFocus=focusDate?.dateStr===dateStr;
            return (
              <div key={dateStr}
                onClick={e=>{if(!entries.length){setFocusDate(null);return;}const r=e.currentTarget.getBoundingClientRect();setFocusDate(isFocus?null:{dateStr,entries,x:r.left,y:r.bottom});}}
                style={{position:"relative",textAlign:"center",padding:"4px 2px 3px",borderRadius:4,cursor:entries.length?"pointer":"default",background:isFocus?t.accent+"22":isToday?t.accent+"15":"transparent",border:isToday?"1px solid "+t.accent+"40":"1px solid transparent"}}>
                <div style={{fontSize:10,fontWeight:isToday?800:500,color:isToday?t.accent:t.text,lineHeight:1.2}}>{day}</div>
                {entries.length>0&&(
                  <div style={{display:"flex",justifyContent:"center",gap:1.5,marginTop:2,flexWrap:"wrap"}}>
                    {entries.slice(0,4).map(({req},di)=>(
                      <span key={di} style={{width:5,height:5,borderRadius:"50%",background:statusDot(req.status),flexShrink:0,display:"inline-block"}}/>
                    ))}
                    {entries.length>4&&<span style={{fontSize:7,color:t.textDim,fontWeight:700,lineHeight:"5px"}}>+{entries.length-4}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const months=[];
  for (let i=0;i<3;i++){const d=new Date(today.getFullYear(),today.getMonth()+monthOffset+i,1);months.push({year:d.getFullYear(),month:d.getMonth()});}

  return (
    <div style={{marginBottom:20}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
        <div style={{fontSize:11,fontWeight:700,color:t.textDim,letterSpacing:".06em"}}>CALENDAR VIEW</div>
        <div style={{display:"flex",gap:10,marginLeft:"auto",alignItems:"center"}}>
          {[["Pending",t.warning],["Approved",t.scale],["Denied",t.danger]].map(([label,col])=>(
            <div key={label} style={{display:"flex",alignItems:"center",gap:4}}>
              <span style={{width:7,height:7,borderRadius:"50%",background:col,display:"inline-block"}}/>
              <span style={{fontSize:10,color:t.textDim,fontWeight:600}}>{label}</span>
            </div>
          ))}
          <button onClick={()=>setMonthOffset(o=>o-1)} style={{background:t.surfaceAlt,border:"1px solid "+t.border,color:t.text,padding:"3px 10px",borderRadius:5,cursor:"pointer",fontSize:13,fontFamily:"inherit"}}>‹</button>
          <button onClick={()=>setMonthOffset(0)} style={{background:monthOffset===0?t.accent+"22":"transparent",border:"1px solid "+(monthOffset===0?t.accent:t.border),color:monthOffset===0?t.accent:t.textMuted,padding:"3px 10px",borderRadius:5,cursor:"pointer",fontSize:10,fontWeight:700,fontFamily:"inherit",letterSpacing:".04em"}}>TODAY</button>
          <button onClick={()=>setMonthOffset(o=>o+1)} style={{background:t.surfaceAlt,border:"1px solid "+t.border,color:t.text,padding:"3px 10px",borderRadius:5,cursor:"pointer",fontSize:13,fontFamily:"inherit"}}>›</button>
        </div>
      </div>
      {(timeOffRequests||[]).length===0 ? (
        <div style={{background:t.surface,border:"1px solid "+t.border,borderRadius:8,padding:20,textAlign:"center",color:t.textDim,fontSize:12}}>No time-off requests yet.</div>
      ) : (
        <div style={{background:t.surface,border:"1px solid "+t.border,borderRadius:8,padding:16}}>
          <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>{months.map(({year,month})=>renderMonth(year,month))}</div>
        </div>
      )}
      {focusDate&&<div onClick={()=>setFocusDate(null)} style={{position:"fixed",inset:0,zIndex:9998}}/>}
      {focusDate&&(()=>{
        const d=new Date(focusDate.dateStr+"T00:00:00");
        const label=d.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});
        return(
          <div style={{position:"fixed",left:Math.min(focusDate.x,window.innerWidth-220),top:focusDate.y+6,zIndex:9999,background:t.surface,border:"1px solid "+t.border,borderRadius:8,padding:"10px 14px",minWidth:190,boxShadow:"0 4px 20px rgba(0,0,0,.18)"}}>
            <div style={{fontSize:11,fontWeight:800,color:t.text,marginBottom:8,letterSpacing:".04em"}}>{label.toUpperCase()}</div>
            {focusDate.entries.map(({emp,req},i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:7,marginBottom:5}}>
                <span style={{width:7,height:7,borderRadius:"50%",background:statusDot(req.status),flexShrink:0}}/>
                <span style={{fontSize:12,fontWeight:600,color:t.text,flex:1}}>{emp.name}</span>
                <span style={{fontSize:10,fontWeight:700,color:statusDot(req.status),textTransform:"uppercase",letterSpacing:".04em"}}>{req.status}</span>
              </div>
            ))}
            <div style={{fontSize:10,color:t.textDim,marginTop:6,borderTop:"1px solid "+t.border,paddingTop:6}}>Click again to close</div>
          </div>
        );
      })()}
    </div>
  );
}

// ── TimeOffManager ────────────────────────────────────────────────────────────
export function TimeOffManager({ employees, timeOffRequests, setTimeOffRequests, weekStart }) {
  const { theme: t } = useTheme();
  const uid = () => Math.random().toString(36).slice(2,10);

  const EMPTY_FORM = { empId:"", type:"single_day", startDate:"", endDate:"", shiftId:"", note:"" };
  const [form,      setForm]      = useState(EMPTY_FORM);
  const [errors,    setErrors]    = useState([]);
  const [filter,    setFilter]    = useState("all");
  const [empFilter, setEmpFilter] = useState("all");

  const upd = (k,v) => setForm(f=>({...f,[k]:v}));

  const validate = () => {
    const e=[];
    if (!form.empId)     e.push("Select an employee.");
    if (!form.startDate) e.push("Start date is required.");
    if (form.type==="vacation"&&!form.endDate) e.push("End date required for vacation.");
    if (form.type==="partial"&&!form.shiftId)  e.push("Select a shift for partial time-off.");
    if (form.type==="vacation"&&form.endDate&&form.endDate<form.startDate) e.push("End date must be on or after start date.");
    return e;
  };

  const submit = () => {
    const e=validate(); if(e.length){setErrors(e);return;}
    const endDate=form.type==="vacation"?form.endDate:form.startDate;
    setTimeOffRequests(prev=>[...(prev||[]),{id:uid(),empId:form.empId,type:form.type,status:"pending",startDate:form.startDate,endDate,shiftId:form.type==="partial"?form.shiftId:null,note:form.note.trim(),submittedAt:new Date().toISOString(),reviewedAt:null}]);
    setForm(EMPTY_FORM); setErrors([]);
  };

  const setStatus = (id,status) => setTimeOffRequests(prev=>prev.map(r=>r.id===id?{...r,status,reviewedAt:new Date().toISOString()}:r));
  const remove    = (id) => { if(!window.confirm("Delete this request?")) return; setTimeOffRequests(prev=>prev.filter(r=>r.id!==id)); };

  const statusColor = s => s==="approved"?t.scale:s==="denied"?t.danger:t.warning;
  const statusIcon  = s => s==="approved"?"✓":s==="denied"?"✕":"⏳";
  const typeLabel   = tp => tp==="vacation"?"🏖 Vacation":tp==="single_day"?"📅 Day Off":"⏰ Partial";

  const filtered=(timeOffRequests||[]).filter(r=>filter==="all"||r.status===filter).filter(r=>empFilter==="all"||r.empId===empFilter).sort((a,b)=>b.submittedAt.localeCompare(a.submittedAt));
  const pending =(timeOffRequests||[]).filter(r=>r.status==="pending").length;
  const approved=(timeOffRequests||[]).filter(r=>r.status==="approved").length;
  const denied  =(timeOffRequests||[]).filter(r=>r.status==="denied").length;

  const iS={background:t.surfaceAlt,border:"1px solid "+t.border,color:t.text,padding:"9px 12px",borderRadius:6,outline:"none",fontSize:13,fontFamily:"'JetBrains Mono',monospace",width:"100%",boxSizing:"border-box"};
  const btnS=(active,col)=>({background:active?col+"22":"transparent",border:"1px solid "+(active?col:t.border),color:active?col:t.textMuted,padding:"5px 14px",borderRadius:20,cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit",letterSpacing:".05em"});

  return (
    <div style={{maxWidth:900}}>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
        <div>
          <div style={{fontSize:20,fontWeight:800,color:t.text,letterSpacing:"-.02em"}}>Time Off & Requests</div>
          <div style={{fontSize:12,color:t.textDim,marginTop:2}}>Submit and manage vacation, day-off, and partial-shift requests. Approved requests block auto-fill.</div>
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:10}}>
          {[[" ⏳",pending,t.warning],["✓",approved,t.scale],["✕",denied,t.danger]].map(([icon,count,col])=>(
            <div key={icon} style={{textAlign:"center",minWidth:44}}>
              <div style={{fontSize:18,fontWeight:800,color:col}}>{count}</div>
              <div style={{fontSize:9,color:t.textDim,fontWeight:700}}>{icon}</div>
            </div>
          ))}
        </div>
      </div>

      <TimeOffCalendar employees={employees} timeOffRequests={timeOffRequests}/>

      {/* New request form */}
      <div style={{background:t.surface,border:"1px solid "+t.border,borderRadius:8,padding:"18px 20px",marginBottom:20}}>
        <div style={{fontSize:12,fontWeight:700,color:t.textDim,letterSpacing:".06em",marginBottom:14}}>NEW REQUEST</div>
        {errors.length>0&&<div style={{background:t.danger+"18",border:"1px solid "+t.danger,borderRadius:6,padding:"8px 12px",marginBottom:12,fontSize:12,color:t.danger}}>{errors.map((e,i)=><div key={i}>• {e}</div>)}</div>}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div>
            <label style={{fontSize:11,color:t.textDim,fontWeight:700,display:"block",marginBottom:4}}>EMPLOYEE</label>
            <select value={form.empId} onChange={e=>upd("empId",e.target.value)} style={iS}>
              <option value="">— select —</option>
              {employees.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{fontSize:11,color:t.textDim,fontWeight:700,display:"block",marginBottom:4}}>TYPE</label>
            <select value={form.type} onChange={e=>upd("type",e.target.value)} style={iS}>
              <option value="single_day">📅 Single Day Off</option>
              <option value="vacation">🏖 Vacation Block</option>
              <option value="partial">⏰ Partial (specific shift)</option>
            </select>
          </div>
          <div>
            <label style={{fontSize:11,color:t.textDim,fontWeight:700,display:"block",marginBottom:4}}>{form.type==="vacation"?"START DATE":"DATE"}</label>
            <input type="date" value={form.startDate} onChange={e=>upd("startDate",e.target.value)} style={iS}/>
          </div>
          {form.type==="vacation" ? (
            <div>
              <label style={{fontSize:11,color:t.textDim,fontWeight:700,display:"block",marginBottom:4}}>END DATE</label>
              <input type="date" value={form.endDate} onChange={e=>upd("endDate",e.target.value)} style={iS}/>
            </div>
          ) : form.type==="partial" ? (
            <div>
              <label style={{fontSize:11,color:t.textDim,fontWeight:700,display:"block",marginBottom:4}}>SHIFT</label>
              <select value={form.shiftId} onChange={e=>upd("shiftId",e.target.value)} style={iS}>
                <option value="">— select shift —</option>
                <option value="first">1st Shift (0600–1400)</option>
                <option value="second">2nd Shift (1400–2200)</option>
                <option value="third">3rd Shift (2200–0600)</option>
              </select>
            </div>
          ) : <div/>}
          <div style={{gridColumn:"1/-1"}}>
            <label style={{fontSize:11,color:t.textDim,fontWeight:700,display:"block",marginBottom:4}}>NOTE (optional)</label>
            <input value={form.note} onChange={e=>upd("note",e.target.value)} placeholder="Reason or notes..." style={iS}/>
          </div>
        </div>
        <div style={{marginTop:14,display:"flex",justifyContent:"flex-end"}}>
          <button onClick={submit} style={{background:t.accent,color:"#fff",border:"none",padding:"9px 22px",borderRadius:6,cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"inherit"}}>+ Submit Request</button>
        </div>
      </div>

      {/* Filter bar */}
      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
        <div style={{display:"flex",gap:6}}>
          {[["all","ALL",t.accent],["pending","PENDING",t.warning],["approved","APPROVED",t.scale],["denied","DENIED",t.danger]].map(([v,l,col])=>(
            <button key={v} onClick={()=>setFilter(v)} style={btnS(filter===v,col)}>{l}</button>
          ))}
        </div>
        <select value={empFilter} onChange={e=>setEmpFilter(e.target.value)} style={{...iS,width:"auto",padding:"5px 12px",fontSize:11,marginLeft:"auto"}}>
          <option value="all">All employees</option>
          {employees.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </div>

      {/* Request list */}
      {filtered.length===0 ? (
        <div style={{background:t.surface,border:"1px solid "+t.border,borderRadius:8,padding:"32px 20px",textAlign:"center",color:t.textDim,fontSize:13}}>
          {(timeOffRequests||[]).length===0?"No requests yet — submit one above.":"No requests match the current filter."}
        </div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {filtered.map(r=>{
            const emp=employees.find(e=>e.id===r.empId);
            const col=statusColor(r.status);
            const dateRange=r.type==="vacation"?r.startDate+" → "+r.endDate:r.startDate+(r.type==="partial"?" · "+{first:"1st",second:"2nd",third:"3rd"}[r.shiftId]+" shift":"");
            return(
              <div key={r.id} style={{background:t.surface,border:"1px solid "+t.border,borderLeft:"3px solid "+col,borderRadius:8,padding:"14px 16px",display:"flex",alignItems:"flex-start",gap:14}}>
                <div style={{minWidth:32,textAlign:"center",paddingTop:2}}><span style={{fontSize:16,color:col}}>{statusIcon(r.status)}</span></div>
                <div style={{flex:1}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,flexWrap:"wrap"}}>
                    <span style={{fontSize:13,fontWeight:700,color:t.text}}>{emp?.name||"Unknown"}</span>
                    <span style={{fontSize:10,background:col+"22",color:col,padding:"2px 8px",borderRadius:10,fontWeight:700}}>{r.status.toUpperCase()}</span>
                    <span style={{fontSize:10,color:t.textDim}}>{typeLabel(r.type)}</span>
                  </div>
                  <div style={{fontSize:12,color:t.accent,fontWeight:600,marginBottom:r.note?4:0}}>{dateRange}</div>
                  {r.note&&<div style={{fontSize:11,color:t.textMuted,fontStyle:"italic"}}>"{r.note}"</div>}
                  <div style={{fontSize:10,color:t.textDim,marginTop:4}}>
                    Submitted {new Date(r.submittedAt).toLocaleDateString()}
                    {r.reviewedAt&&" · Reviewed "+new Date(r.reviewedAt).toLocaleDateString()}
                  </div>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:6,flexShrink:0}}>
                  {r.status!=="approved"&&<button onClick={()=>setStatus(r.id,"approved")} style={{background:t.scale+"22",border:"1px solid "+t.scale,color:t.scale,padding:"4px 12px",borderRadius:5,cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit",whiteSpace:"nowrap"}}>✓ Approve</button>}
                  {r.status!=="denied"&&<button onClick={()=>setStatus(r.id,"denied")} style={{background:t.danger+"18",border:"1px solid "+t.danger,color:t.danger,padding:"4px 12px",borderRadius:5,cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit",whiteSpace:"nowrap"}}>✕ Deny</button>}
                  <button onClick={()=>remove(r.id)} style={{background:"transparent",border:"1px solid "+t.border,color:t.textDim,padding:"4px 12px",borderRadius:5,cursor:"pointer",fontSize:11,fontFamily:"inherit"}}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
