import { useState } from "react";
import {
  DAYS, SHIFTS, EXT_PAIRS,
  cellKey, getSlotCount, isWeekday,
  MIN_REST_HOURS, MAX_CONSECUTIVE_NIGHTS,
} from "../../constants/index.js";
import { positionColor } from "../../constants/themes.js";
import { extCovers } from "../../utils/extShifts.js";
import { slotHasRole } from "../../utils/validation.js";
import {
  calcHours, calcRestGap, calcConsecutiveHours,
  calcConsecutiveNights, empMaxConsec,
} from "../../utils/hours.js";
import { canFillPos } from "../../utils/autofill.js";
import { timeOffCoversSlot } from "../../utils/autofill.js";

// ── SubIndicator ──────────────────────────────────────────────────────────────
export function SubIndicator({ subSource, employees, onCancel }) {
  const srcEmp = employees.find(e => e.id === subSource.employeeId);
  const shiftLabel = { first:"1st", second:"2nd", third:"3rd" }[subSource.shiftId] || subSource.shiftId;
  return (
    <div style={{position:"sticky",bottom:16,zIndex:200,display:"flex",alignItems:"center",gap:10,background:"#0f1f0f",border:"2px solid #22c55e",borderRadius:10,padding:"10px 16px",marginTop:16,boxShadow:"0 4px 24px #0008"}}>
      <span style={{fontSize:16}}>⇄</span>
      <div style={{flex:1}}>
        <div style={{fontSize:12,fontWeight:700,color:"#22c55e"}}>SUB MODE</div>
        <div style={{fontSize:11,color:"#bbf7d0",marginTop:1}}>
          Subbing out: <strong style={{color:"#22c55e"}}>{srcEmp?.name}</strong>
          {" "}({shiftLabel} · {subSource.day} · {subSource.position})
          {" — "}click a name below to replace them
        </div>
      </div>
      <button onClick={onCancel} style={{background:"#22c55e22",border:"1.5px solid #22c55e",color:"#22c55e",borderRadius:6,padding:"6px 14px",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit",whiteSpace:"nowrap"}}>
        ✕ Cancel Sub
      </button>
    </div>
  );
}

// ── SwapIndicator ─────────────────────────────────────────────────────────────
export function SwapIndicator({ swapSource, employees, onCancel }) {
  const srcEmp = employees.find(e => e.id === swapSource.employeeId);
  const shiftLabel = { first:"1st", second:"2nd", third:"3rd" }[swapSource.shiftId] || swapSource.shiftId;
  return (
    <div style={{position:"sticky",bottom:16,zIndex:200,display:"flex",alignItems:"center",gap:10,background:"#1c1917",border:"2px solid #f59e0b",borderRadius:10,padding:"10px 16px",marginTop:16,boxShadow:"0 4px 24px #0008"}}>
      <span style={{fontSize:16}}>🔄</span>
      <div style={{flex:1}}>
        <div style={{fontSize:12,fontWeight:700,color:"#f59e0b"}}>SWAP MODE</div>
        <div style={{fontSize:11,color:"#d4c89a",marginTop:1}}>
          Selected: <strong style={{color:"#f59e0b"}}>{srcEmp?.name}</strong>
          {" "}({shiftLabel} · {swapSource.day} · {swapSource.position})
          {" — "}now click any other name to swap
        </div>
      </div>
      <button onClick={onCancel} style={{background:"#f59e0b22",border:"1.5px solid #f59e0b",color:"#f59e0b",borderRadius:6,padding:"6px 14px",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit",whiteSpace:"nowrap"}}>
        ✕ Cancel Swap
      </button>
    </div>
  );
}

// ── HistoryBar ────────────────────────────────────────────────────────────────
export function HistoryBar({ history, viewingHistory, setViewingHistory, setSchedule, setWeekStart, liveSchedule, liveWeekStart, t }) {
  if (!history || history.length === 0) return null;
  const sorted = [...history].sort((a,b) => (b.savedAt||b.weekStart||"").localeCompare(a.savedAt||a.weekStart||""));
  const currentHistIdx = viewingHistory ? sorted.findIndex(h => h.weekStart===viewingHistory.weekStart && h.savedAt===viewingHistory.savedAt) : -1;
  const canPrev = viewingHistory ? currentHistIdx > 0 : false;
  const canNext = viewingHistory ? currentHistIdx < sorted.length - 1 : false;
  const historyLabel = (h) => `${h.isAutoSave?"Auto":"Saved"}: ${h.weekStart||""} ${h.label?"· "+h.label:""}`.trim();

  return (
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,fontSize:11,flexWrap:"wrap"}}>
      <span style={{color:t.textDim,fontWeight:600}}>History:</span>
      <button onClick={() => canPrev && setViewingHistory(sorted[currentHistIdx-1])} disabled={!canPrev}
        style={{background:"transparent",border:"1px solid "+t.border,color:canPrev?t.text:t.textDim,padding:"2px 8px",borderRadius:4,cursor:canPrev?"pointer":"default",fontSize:11}}>◀</button>
      <select
        value={viewingHistory ? currentHistIdx : "__live__"}
        onChange={e => {
          const v = e.target.value;
          if (v === "__live__") { setViewingHistory(null); if(liveSchedule) setSchedule(liveSchedule); if(liveWeekStart) setWeekStart(liveWeekStart); }
          else setViewingHistory(sorted[parseInt(v)]);
        }}
        style={{fontSize:11,padding:"2px 6px",borderRadius:4,border:"1px solid "+t.border,background:t.surfaceAlt,color:t.text,flex:1,minWidth:160}}>
        <option value="__live__">▶ Current (live)</option>
        {sorted.map((h,i) => <option key={i} value={i}>{historyLabel(h)}</option>)}
      </select>
      <button onClick={() => canNext && setViewingHistory(sorted[currentHistIdx+1])} disabled={!canNext}
        style={{background:"transparent",border:"1px solid "+t.border,color:canNext?t.text:t.textDim,padding:"2px 8px",borderRadius:4,cursor:canNext?"pointer":"default",fontSize:11}}>▶</button>
      {viewingHistory && (
        <button onClick={() => { setViewingHistory(null); if(liveSchedule) setSchedule(liveSchedule); if(liveWeekStart) setWeekStart(liveWeekStart); }}
          style={{background:t.accent+"22",border:"1px solid "+t.accent,color:t.accent,padding:"2px 8px",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:700}}>
          ✕ Exit History
        </button>
      )}
    </div>
  );
}

// ── WeekPickerBar ─────────────────────────────────────────────────────────────
export function WeekPickerBar({ weekStart, setWeekStart, stepWeek, t }) {
  const [y,m,d] = (weekStart||"2024-01-07").split("-").map(Number);
  const sun = new Date(y, m-1, d, 12);
  const fmtHeader = (offset) => {
    const dt = new Date(sun); dt.setDate(sun.getDate() + offset);
    return String(dt.getMonth()+1).padStart(2,"0")+"/"+String(dt.getDate()).padStart(2,"0");
  };
  const monthName = sun.toLocaleString("default", { month:"long", year:"numeric" });

  return (
    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,fontSize:11,flexWrap:"wrap"}}>
      <button onClick={() => stepWeek(-1)} style={{background:t.surfaceAlt,border:"1px solid "+t.border,color:t.text,padding:"4px 12px",borderRadius:5,cursor:"pointer",fontSize:13,fontWeight:700}}>‹</button>
      <span style={{fontSize:13,fontWeight:700,color:t.text,minWidth:160,textAlign:"center"}}>{monthName} — Week of {fmtHeader(0)}</span>
      <button onClick={() => stepWeek(1)} style={{background:t.surfaceAlt,border:"1px solid "+t.border,color:t.text,padding:"4px 12px",borderRadius:5,cursor:"pointer",fontSize:13,fontWeight:700}}>›</button>
      <span style={{fontSize:10,color:t.textDim,margin:"0 4px"}}>|</span>
      <label style={{fontSize:11,color:t.textDim,fontWeight:600}}>Jump to:</label>
      <input type="date" value={weekStart||""} onChange={e => {
        const v = e.target.value; if(!v) return;
        const dt = new Date(v+"T12:00:00"); dt.setDate(dt.getDate() - dt.getDay());
        setWeekStart(dt.toISOString().slice(0,10));
      }} style={{fontSize:11,padding:"3px 6px",borderRadius:4,border:"1px solid "+t.border,background:t.surfaceAlt,color:t.text}}/>
      <div style={{marginLeft:"auto",display:"flex",gap:4}}>
        {[0,1,2,3,4,5,6].map(offset => (
          <span key={offset} style={{fontSize:9,color:t.textDim,padding:"1px 4px",background:t.surfaceAlt,borderRadius:3,border:"1px solid "+t.border+"60"}}>
            {["Su","Mo","Tu","We","Th","Fr","Sa"][offset]} {fmtHeader(offset)}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── EmpPicker ─────────────────────────────────────────────────────────────────
export function EmpPicker({ emp, day, sid, st, assign, getPos, schedule, extShifts, timeOffReqs, weekStart, subSource, onSub, cfg }) {
  const [sel, setSel] = useState(null);
  const pos = getPos(emp, day, sid);
  if (!pos.length) return null;

  const currentHours  = calcHours(emp.id, schedule);
  const wouldBeOver   = emp.employmentType === "full-time" && currentHours >= 40;
  const isUnavailable = (emp.unavailableDays||[]).includes(day);
  const restGap       = calcRestGap(emp.id, schedule, day, sid);
  const consecH       = calcConsecutiveHours(emp.id, schedule, day, sid, extShifts);
  const shortRest     = restGap < (cfg?.minRestHours ?? MIN_REST_HOURS) && restGap !== Infinity;
  const consNights    = sid === "third" ? calcConsecutiveNights(emp.id, schedule, day, sid) : 0;
  const tooManyNights = consNights >= (cfg?.maxConsecutiveNights ?? MAX_CONSECUTIVE_NIGHTS);
  const hasFatigueWarning = shortRest || tooManyNights;
  const isSubMode = subSource && subSource.day === day && subSource.shiftId === sid;
  const warningColor = isSubMode ? "#22c55e" : isUnavailable ? "#ef4444" : hasFatigueWarning ? "#f97316" : wouldBeOver ? "#f59e0b" : "#2d3241";

  const doAssign = (position) => {
    if (isSubMode) { onSub(subSource, emp.id, subSource.position); return; }
    const empOtPref = emp.overtimePref && emp.overtimePref !== "neutral" ? emp.overtimePref : (cfg?.defaultOvertimePref || "neutral");
    const otPref    = emp.employmentType === "full-time" ? empOtPref : "neutral";
    const warns = [];
    if (isUnavailable) warns.push(`${emp.name} is marked unavailable on ${day}.`);
    const hasApprovedTimeOff = (timeOffReqs||[]).some(r => r.empId===emp.id && r.status==="approved" && timeOffCoversSlot(r, day, sid, weekStart));
    if (hasApprovedTimeOff) warns.push(`${emp.name} has approved time off on ${day}.`);
    if (consecH > empMaxConsec(emp)) return;
    if (shortRest) warns.push(`Only ${Math.round(restGap*10)/10}h rest since last shift (min ${cfg?.minRestHours ?? MIN_REST_HOURS}h).`);
    if (tooManyNights) warns.push(`${consNights} consecutive night shifts exceeds the ${cfg?.maxConsecutiveNights ?? MAX_CONSECUTIVE_NIGHTS}-shift limit.`);
    if (wouldBeOver) {
      if (otPref === "blocked") warns.push(`${emp.name} prefers NO overtime — currently at ${currentHours}h.`);
      else warns.push(`${emp.name} is at ${currentHours}h this week — overtime.`);
    }
    if (warns.length && !window.confirm(warns.join("\n\n")+"\n\nAssign anyway?")) return;
    assign(day, sid, emp.id, position);
  };

  const badge = isUnavailable ? "OFF" : tooManyNights ? `${consNights}N` : shortRest ? `${Math.round(restGap)}h` : null;
  const badgeColor = isUnavailable ? "#ef4444" : "#f97316";

  if (sel === null) return (
    <button onClick={() => {
      if (pos.length === 1) { doAssign(pos[0]); return; }
      const d = !st.hasScale && pos.includes("Scale") ? "Scale"
              : !st.hasMedical && pos.includes("Medical") ? "Medical"
              : pos.includes("Guard") ? "Guard" : pos[0];
      setSel(d); doAssign(d);
    }} style={{background:"#1a1d27",border:"1px solid "+warningColor,borderRadius:3,color:"#e8eaf0",cursor:"pointer",fontSize:10,padding:"5px 8px",textAlign:"left",fontFamily:"inherit",fontWeight:600,display:"flex",alignItems:"center",justifyContent:"space-between",gap:6,opacity:isUnavailable?0.6:1}}
      onMouseEnter={e=>e.currentTarget.style.borderColor="#4a9eff"}
      onMouseLeave={e=>e.currentTarget.style.borderColor=warningColor}>
      <span style={{display:"flex",alignItems:"center",gap:4}}>
        {emp.name}
        {badge && <span style={{color:badgeColor,fontSize:8,fontWeight:800,background:badgeColor+"20",padding:"1px 4px",borderRadius:2}}>{badge}</span>}
        {wouldBeOver && !badge && <span style={{color:"#f59e0b",fontSize:8}}>OT</span>}
      </span>
      <span style={{display:"flex",gap:3}}>
        {pos.map(p => <span key={p} style={{width:6,height:6,borderRadius:"50%",background:positionColor(p,{supervisor:"#f0a030",guard:"#4a9eff",scale:"#50c878",medical:"#e05070"}),display:"inline-block"}}/>)}
      </span>
    </button>
  );

  return (
    <div style={{display:"flex",gap:4,alignItems:"center",background:"#1a1d27",border:"1px solid #4a9eff",borderRadius:3,padding:"3px 6px"}}>
      <span style={{fontSize:10,fontWeight:600,flex:1}}>{emp.name}</span>
      <select value={sel} onChange={e=>setSel(e.target.value)} style={{background:"#22262f",border:"1px solid #2d3241",color:"#e8eaf0",fontSize:9,padding:"2px 4px",borderRadius:2,fontFamily:"inherit",cursor:"pointer"}}>
        {pos.map(p => <option key={p} value={p}>{p}</option>)}
      </select>
      <button onClick={() => doAssign(sel)} style={{background:"#4a9eff",border:"none",color:"#fff",fontSize:9,padding:"3px 6px",borderRadius:2,cursor:"pointer",fontWeight:700,fontFamily:"inherit"}}>✓</button>
    </div>
  );
}

// ── EmpPickerSearch ───────────────────────────────────────────────────────────
export function EmpPickerSearch({ day, shift, subSource, employees, unassigned, getAssignable, assignEmp, schedule, extShifts, timeOffReqs, weekStart, executeSub, st, setEditingCell, setSubSource, t, cfg }) {
  const [pickSearch, setPickSearch] = useState("");
  const pickList = (subSource && subSource.day===day && subSource.shiftId===shift.id
    ? employees.filter(e => e.id !== subSource.employeeId && getAssignable(e,day,shift.id).length>0)
    : unassigned(day,shift.id).filter(e=>getAssignable(e,day,shift.id).length>0)
  ).filter(e => !pickSearch || e.name.toLowerCase().includes(pickSearch.toLowerCase()));

  return (
    <>
      <input autoFocus placeholder="Search…" value={pickSearch}
        onChange={e=>setPickSearch(e.target.value)}
        onKeyDown={e=>{ if(e.key==="Escape"){setPickSearch(""); setEditingCell(null); setSubSource(null);} }}
        style={{width:"100%",boxSizing:"border-box",padding:"3px 7px",fontSize:10,borderRadius:4,border:"1px solid "+t.accent,background:t.surfaceAlt,color:t.text,fontFamily:"inherit",marginBottom:4,outline:"none"}}/>
      <div style={{maxHeight:120,overflowY:"auto",display:"flex",flexDirection:"column",gap:3}}>
        {pickList.map(emp => (
          <EmpPicker key={emp.id} emp={emp} day={day} sid={shift.id} st={st}
            assign={assignEmp} getPos={getAssignable} schedule={schedule} extShifts={extShifts||[]}
            timeOffReqs={timeOffReqs} weekStart={weekStart} subSource={subSource} onSub={executeSub} cfg={cfg}/>
        ))}
        {pickList.length === 0 && <div style={{fontSize:10,color:t.textDim,textAlign:"center",padding:4}}>{pickSearch?"No match":"No eligible employees"}</div>}
      </div>
    </>
  );
}

// ── SchedulePopout ────────────────────────────────────────────────────────────
export function SchedulePopout({ schedule, extShifts, employees, weekStart, onClose }) {
  const [pos,  setPos]  = useState({ x: 40, y: 60 });
  const [size, setSize] = useState({ w: 960, h: 520 });

  const onDragStart = (e) => {
    if (e.button !== 0) return; e.preventDefault();
    const sx = e.clientX - pos.x, sy = e.clientY - pos.y;
    const move = (ev) => setPos({ x: ev.clientX - sx, y: ev.clientY - sy });
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };
  const onResizeStart = (e) => {
    e.stopPropagation(); e.preventDefault();
    const sx = e.clientX, sy = e.clientY, sw = size.w, sh = size.h;
    const move = (ev) => setSize({ w: Math.max(600, sw+ev.clientX-sx), h: Math.max(300, sh+ev.clientY-sy) });
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };

  const [wy,wm,wd] = (weekStart||"2024-01-07").split("-").map(Number);
  const sun = new Date(wy, wm-1, wd, 12);
  const fmtDate = (offset) => {
    const d = new Date(sun); d.setDate(sun.getDate() + offset);
    return String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
  };

  const getPopoutStatus = (day, shiftId) => {
    const asgn = schedule[cellKey(day, shiftId)] || [];
    const cellExt = (extShifts||[]).filter(e => extCovers(e, day, shiftId));
    const hasScale   = slotHasRole(asgn, employees, "Scale")   || cellExt.some(e=>(e.roles||[]).includes("Scale"));
    const hasMedical = slotHasRole(asgn, employees, "Medical") || cellExt.some(e=>(e.roles||[]).includes("Medical"));
    const missing = [...(!hasScale?["Scale"]:[]),...(!hasMedical?["Medical"]:[])];
    return { missing, ok: missing.length===0, count: asgn.length, max: getSlotCount(day, shiftId) };
  };

  // Inline minimal theme for popout (always dark)
  const t = { bg:"#0f1117", surface:"#1a1d27", surfaceAlt:"#22262f", border:"#2d3241", text:"#e8eaf0", textDim:"#5c6070", accent:"#4a9eff", warning:"#f59e0b" };

  return (
    <div style={{position:"fixed",left:pos.x,top:pos.y,width:size.w,height:size.h,background:t.bg,border:"1.5px solid "+t.border,borderRadius:10,boxShadow:"0 8px 40px rgba(0,0,0,.6)",display:"flex",flexDirection:"column",zIndex:99999,overflow:"hidden",fontFamily:"inherit"}}>
      <div onMouseDown={onDragStart} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 14px",background:t.surface,borderBottom:"1px solid "+t.border,cursor:"grab",userSelect:"none",flexShrink:0}}>
        <span style={{fontSize:12,fontWeight:700,color:t.text,flex:1}}>⛶ Pop-out</span>
        <span style={{fontSize:10,color:t.textDim}}>drag to move · drag corner to resize</span>
        <button onMouseDown={e=>e.stopPropagation()} onClick={onClose} style={{background:"transparent",border:"none",color:t.textDim,fontSize:16,cursor:"pointer",lineHeight:1,padding:"2px 4px"}}>✕</button>
      </div>
      <div style={{flex:1,overflowX:"auto",overflowY:"auto",padding:"10px 12px"}}>
        <div style={{minWidth:820}}>
          <div style={{display:"grid",gridTemplateColumns:"78px repeat(7,1fr)",gap:2,marginBottom:2}}>
            <div/>
            {DAYS.map((d,di) => (
              <div key={d} style={{background:t.surfaceAlt,padding:"5px 6px",textAlign:"center",borderRadius:"4px 4px 0 0",color:isWeekday(d)?t.text:"#5c6070"}}>
                <div style={{fontSize:10,fontWeight:700,letterSpacing:".04em"}}>{d.substring(0,3).toUpperCase()}</div>
                <div style={{fontSize:9,color:t.textDim,marginTop:1}}>{fmtDate(di)}</div>
              </div>
            ))}
          </div>
          {SHIFTS.map(shift => (
            <div key={shift.id} style={{display:"grid",gridTemplateColumns:"78px repeat(7,1fr)",gap:2,marginBottom:2}}>
              <div style={{background:t.surfaceAlt,padding:"6px 8px",borderRadius:"4px 0 0 4px",display:"flex",flexDirection:"column",justifyContent:"center"}}>
                <div style={{fontSize:10,fontWeight:700,color:t.text}}>{shift.label}</div>
                <div style={{fontSize:9,color:t.textDim}}>{shift.time}</div>
              </div>
              {DAYS.map(day => {
                const asgn = schedule[cellKey(day,shift.id)]||[];
                const st = getPopoutStatus(day,shift.id);
                const cellExt = (extShifts||[]).filter(e=>extCovers(e,day,shift.id));
                const bg = !asgn.length&&!cellExt.length?t.bg:!st.ok?t.warning+"12":t.surface;
                const bdr= !asgn.length&&!cellExt.length?t.border:!st.ok?t.warning+"55":t.accent+"30";
                return (
                  <div key={day} style={{background:bg,border:"1px solid "+bdr,borderRadius:4,padding:"5px 6px",display:"flex",flexDirection:"column",gap:3,minHeight:58}}>
                    {asgn.map(a => {
                      const emp=employees.find(e=>e.id===a.employeeId); if(!emp) return null;
                      const pc = positionColor(a.position,{supervisor:"#f0a030",guard:"#4a9eff",scale:"#50c878",medical:"#e05070"});
                      return (
                        <div key={a.employeeId} style={{display:"flex",alignItems:"center",gap:4,background:t.surfaceAlt,borderRadius:3,padding:"3px 5px"}}>
                          <span style={{width:6,height:6,borderRadius:"50%",background:pc,flexShrink:0}}/>
                          <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:600,fontSize:10,color:t.text}}>{emp.name}</span>
                          <span style={{fontSize:8,color:pc,fontWeight:700,flexShrink:0}}>{a.position.substring(0,3).toUpperCase()}</span>
                        </div>
                      );
                    })}
                    {cellExt.map((ext,ei) => {
                      const pair=EXT_PAIRS.find(p=>p.id===ext.pairId);
                      const empId=pair?.covers[0]===shift.id?ext.empAId:(ext.empBId||ext.empAId);
                      const extEmp=employees.find(e=>e.id===empId); if(!extEmp) return null;
                      const ec=pair?.id==="day"?"#7c3aed":"#0e7490";
                      return (
                        <div key={"x"+ei} style={{display:"flex",alignItems:"center",gap:4,background:ec+"12",border:"1px dashed "+ec+"60",borderRadius:3,padding:"3px 5px"}}>
                          <span style={{fontSize:8,flexShrink:0}}>⏱</span>
                          <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:600,fontSize:10,color:ec}}>{extEmp.name}</span>
                          <span style={{fontSize:8,color:ec,fontWeight:700,flexShrink:0}}>12H</span>
                        </div>
                      );
                    })}
                    {asgn.length>0 && st.missing.length>0 && <div style={{fontSize:8,color:t.warning,fontWeight:700,marginTop:"auto"}}>⚠ {st.missing.join(" + ")}</div>}
                    <div style={{fontSize:8,color:t.textDim,marginTop:"auto",textAlign:"right"}}>{st.count}/{st.max}</div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div onMouseDown={onResizeStart} style={{position:"absolute",right:0,bottom:0,width:18,height:18,cursor:"se-resize",display:"flex",alignItems:"flex-end",justifyContent:"flex-end",padding:3,color:t.textDim,fontSize:11,userSelect:"none"}}>⊡</div>
    </div>
  );
}
