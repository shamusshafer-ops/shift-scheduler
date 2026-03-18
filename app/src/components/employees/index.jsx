import { useState, useMemo } from "react";
import { useTheme } from "../../context/ThemeContext.jsx";
import { useSettings } from "../../context/SettingsContext.jsx";
import { DAYS, SHIFTS, ALL_POSITIONS } from "../../constants/index.js";
import { positionColor, shiftColor } from "../../constants/themes.js";
import { calcHours, getFatigueIssues } from "../../utils/hours.js";

// ── MaxShiftsPerWeekToggle ────────────────────────────────────────────────────
export function MaxShiftsPerWeekToggle({ val, set }) {
  const { theme: t } = useTheme();
  const capped = val !== null && val !== undefined;
  const current = capped ? val : 1;
  return (
    <div style={{marginTop:12}}>
      <div style={{fontSize:11,color:t.textDim,fontWeight:600,letterSpacing:".04em",marginBottom:6}}>WEEKLY SHIFT LIMIT</div>
      <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
        <button onClick={() => set(capped ? null : 1)} style={{
          background:capped?t.accent+"22":t.surfaceAlt, border:"1.5px solid "+(capped?t.accent:t.border),
          color:capped?t.accent:t.textDim, padding:"6px 14px", borderRadius:6, cursor:"pointer",
          fontSize:11, fontWeight:700, fontFamily:"inherit", display:"flex", alignItems:"center", gap:6,
        }}>
          <span style={{width:7,height:7,borderRadius:"50%",flexShrink:0,background:capped?t.accent:t.textDim}}/>
          {capped ? `Capped — ${current} shift${current!==1?"s":""}/week` : "Unlimited shifts"}
        </button>
        {capped && (
          <div style={{display:"flex",alignItems:"center",gap:4}}>
            {[1,2,3,4,5].map(n => (
              <button key={n} onClick={() => set(n)} style={{
                width:30, height:30, borderRadius:5, border:"1.5px solid", cursor:"pointer",
                fontSize:12, fontWeight:700, fontFamily:"inherit",
                background:current===n?t.accent:t.surfaceAlt,
                borderColor:current===n?t.accent:t.border,
                color:current===n?"#fff":t.textDim,
              }}>{n}</button>
            ))}
          </div>
        )}
      </div>
      <div style={{marginTop:5,fontSize:10,color:capped?t.accent:t.textDim}}>
        {capped
          ? `Auto-fill will assign at most ${current} shift${current!==1?"s":""}/week.`
          : "No weekly shift limit — employee scheduled based on type and availability."}
      </div>
    </div>
  );
}

// ── OtPrefToggle ──────────────────────────────────────────────────────────────
export function OtPrefToggle({ val, set, isFT }) {
  const { theme: t } = useTheme();
  if (!isFT) return null;
  const OPTIONS = [
    { v:"blocked",   label:"No OT",      color:t.danger },
    { v:"neutral",   label:"Neutral",    color:t.textMuted },
    { v:"preferred", label:"Prefers OT", color:t.scale },
  ];
  return (
    <div>
      <div style={{fontSize:11,color:t.textDim,fontWeight:600,letterSpacing:".04em",marginBottom:6}}>OVERTIME PREFERENCE</div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
        {OPTIONS.map(({ v, label, color }) => (
          <button key={v} onClick={() => set(v)} style={{
            background:val===v?color+"22":t.surfaceAlt, border:"1.5px solid "+(val===v?color:t.border),
            color:val===v?color:t.textDim, padding:"6px 14px", borderRadius:6, cursor:"pointer",
            fontSize:11, fontWeight:700, fontFamily:"inherit", display:"flex", alignItems:"center", gap:5,
          }}>
            <span style={{width:7,height:7,borderRadius:"50%",background:val===v?color:t.textDim,flexShrink:0}}/>
            {label}
          </button>
        ))}
      </div>
      {val === "blocked" && <div style={{marginTop:5,fontSize:10,color:t.danger}}>⛔ Hard block — will never be placed past 40h in auto-fill or manually.</div>}
      {val === "preferred" && <div style={{marginTop:5,fontSize:10,color:t.scale}}>✓ Will be filled into extra shifts first and bypasses the OT approval prompt.</div>}
    </div>
  );
}

// ── Willing16hToggle ──────────────────────────────────────────────────────────
export function Willing16hToggle({ val, set }) {
  const { theme: t } = useTheme();
  const active = val === true;
  return (
    <div style={{marginTop:12}}>
      <div style={{fontSize:11,color:t.textDim,fontWeight:600,letterSpacing:".04em",marginBottom:6}}>16-HOUR SHIFT AVAILABILITY</div>
      <button onClick={() => set(!active)} style={{
        background:active?t.warning+"22":t.surfaceAlt, border:"1.5px solid "+(active?t.warning:t.border),
        color:active?t.warning:t.textDim, padding:"6px 14px", borderRadius:6, cursor:"pointer",
        fontSize:11, fontWeight:700, fontFamily:"inherit", display:"flex", alignItems:"center", gap:6,
      }}>
        <span style={{width:7,height:7,borderRadius:"50%",flexShrink:0,background:active?t.warning:t.textDim}}/>
        {active ? "Willing — 16h shifts OK" : "Not willing — 8h shifts only"}
      </button>
      <div style={{marginTop:5,fontSize:10,color:active?t.warning:t.textDim,lineHeight:1.5}}>
        {active
          ? "⚠ Employee may be scheduled for back-to-back 8h shifts (up to 16h consecutive). All rest rules still apply."
          : "Will not be placed in slots that would result in more than 8 consecutive hours."}
      </div>
    </div>
  );
}

// ── Ext12hPrefToggle ──────────────────────────────────────────────────────────
export function Ext12hPrefToggle({ val, set }) {
  const { theme: t } = useTheme();
  const OPTIONS = [
    { v: null,    label: "Not available",   color: t.textDim },
    { v: "day",   label: "Day 12hr only",   color: "#7c3aed" },
    { v: "night", label: "Night 12hr only", color: "#0e7490" },
    { v: "both",  label: "Day or Night",    color: t.accent  },
  ];
  return (
    <div style={{marginTop:12}}>
      <div style={{fontSize:11,color:t.textDim,fontWeight:600,letterSpacing:".04em",marginBottom:6}}>12-HOUR SHIFT AVAILABILITY</div>
      <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
        {OPTIONS.map(opt => {
          const active = val === opt.v;
          return (
            <button key={String(opt.v)} onClick={() => set(opt.v)} style={{
              background:active?opt.color+"22":t.surfaceAlt, border:"1.5px solid "+(active?opt.color:t.border),
              color:active?opt.color:t.textDim, padding:"5px 12px", borderRadius:6, cursor:"pointer",
              fontSize:11, fontWeight:active?700:500, fontFamily:"inherit",
              display:"flex", alignItems:"center", gap:5,
            }}>
              <span style={{width:6,height:6,borderRadius:"50%",flexShrink:0,background:active?opt.color:t.textDim}}/>
              {opt.label}
            </button>
          );
        })}
      </div>
      <div style={{marginTop:5,fontSize:10,color:t.textDim}}>
        {val === null
          ? "Employee will not be considered for any 12-hour extended shifts."
          : `${OPTIONS.find(o => o.v === val)?.label} — will appear in 12hr pairing suggestions.`}
      </div>
    </div>
  );
}

// ── AvailabilityEditor ────────────────────────────────────────────────────────
export function AvailabilityEditor({ emp, onUpdate }) {
  const { theme: t } = useTheme();
  const unavail = emp.unavailableDays || [];
  const toggle = (day) => {
    onUpdate(unavail.includes(day) ? unavail.filter(d => d !== day) : [...unavail, day]);
  };
  return (
    <div style={{marginTop:10}}>
      <div style={{fontSize:10,color:t.textDim,fontWeight:700,letterSpacing:".06em",marginBottom:6}}>UNAVAILABLE DAYS</div>
      <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
        {DAYS.map(day => {
          const off = unavail.includes(day);
          return (
            <button key={day} onClick={() => toggle(day)} style={{
              background:off?t.danger+"18":t.surfaceAlt, border:"1.5px solid "+(off?t.danger:t.border),
              color:off?t.danger:t.textDim, padding:"4px 9px", borderRadius:5, cursor:"pointer",
              fontSize:10, fontWeight:off?700:500, fontFamily:"inherit",
            }}>
              {day.substring(0, 3)}{off && <span style={{marginLeft:4,fontSize:9}}>✕</span>}
            </button>
          );
        })}
      </div>
      {unavail.length > 0 && <div style={{marginTop:5,fontSize:10,color:t.danger}}>Off: {unavail.join(", ")}</div>}
    </div>
  );
}

// ── PreferenceEditor ──────────────────────────────────────────────────────────
export function PreferenceEditor({ prefShifts, setPrefShifts, blockedShifts, setBlockedShifts, requiredShift, setRequiredShift, daysOff, setDaysOff }) {
  const { theme: t } = useTheme();

  const toggleDay = (day) => {
    if (daysOff.includes(day)) {
      setDaysOff(daysOff.filter(d => d !== day));
    } else {
      const next = daysOff.length < 2 ? [...daysOff, day] : [daysOff[1], day];
      setDaysOff(next);
    }
  };

  const togglePref = (sid) => {
    if ((blockedShifts||[]).includes(sid)) return;
    const cur = prefShifts || [];
    if (cur.includes(sid)) {
      setPrefShifts(cur.filter(s => s !== sid));
      if (requiredShift === sid) setRequiredShift(null);
    } else {
      setPrefShifts([...cur, sid]);
    }
  };

  const toggleBlocked = (sid) => {
    if ((prefShifts||[]).includes(sid)) return;
    const cur = blockedShifts || [];
    setBlockedShifts(cur.includes(sid) ? cur.filter(s => s !== sid) : [...cur, sid]);
  };

  const toggleRequired = (sid) => {
    if (!(prefShifts||[]).includes(sid)) return;
    setRequiredShift(requiredShift === sid ? null : sid);
  };

  return (
    <div style={{marginTop:10}}>
      <div style={{fontSize:10,color:t.textDim,fontWeight:700,letterSpacing:".06em",marginBottom:8}}>SCHEDULE PREFERENCES</div>
      <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
        <div style={{flex:"1 1 260px"}}>
          <div style={{fontSize:9,color:t.textDim,marginBottom:6}}>SHIFT PREFERENCES</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 80px 80px 80px",gap:3,marginBottom:4}}>
            <div/>
            {["Preferred","Blocked","Required"].map(h => (
              <div key={h} style={{fontSize:8,fontWeight:700,color:t.textDim,letterSpacing:".05em",textAlign:"center"}}>{h}</div>
            ))}
          </div>
          {SHIFTS.map(s => {
            const isPref    = (prefShifts||[]).includes(s.id);
            const isBlocked = (blockedShifts||[]).includes(s.id);
            const isReq     = requiredShift === s.id;
            const col       = shiftColor(s.id, t);
            return (
              <div key={s.id} style={{display:"grid",gridTemplateColumns:"1fr 80px 80px 80px",gap:3,marginBottom:4,alignItems:"center"}}>
                <div style={{fontSize:10,fontWeight:600,color:t.text,paddingLeft:2}}>
                  {s.label}<span style={{fontSize:8,color:t.textDim,marginLeft:4}}>{s.time}</span>
                </div>
                <button onClick={() => !isBlocked && togglePref(s.id)} style={{
                  fontSize:9,fontWeight:700,padding:"4px 0",borderRadius:5,fontFamily:"inherit",
                  cursor:!isBlocked?"pointer":"not-allowed",opacity:!isBlocked?1:0.4,
                  background:isPref?col+"25":t.surfaceAlt, border:"1.5px solid "+(isPref?col:t.border), color:isPref?col:t.textDim,
                }}>{isPref?"★ Yes":"—"}</button>
                <button onClick={() => !isPref && toggleBlocked(s.id)} style={{
                  fontSize:9,fontWeight:700,padding:"4px 0",borderRadius:5,fontFamily:"inherit",
                  cursor:!isPref?"pointer":"not-allowed",opacity:!isPref?1:0.4,
                  background:isBlocked?t.danger+"25":t.surfaceAlt, border:"1.5px solid "+(isBlocked?t.danger:t.border), color:isBlocked?t.danger:t.textDim,
                }}>{isBlocked?"🚫 No":"—"}</button>
                <button onClick={() => isPref && toggleRequired(s.id)} style={{
                  fontSize:9,fontWeight:700,padding:"4px 0",borderRadius:5,fontFamily:"inherit",
                  cursor:isPref?"pointer":"not-allowed",opacity:isPref?1:0.3,
                  background:isReq?t.danger+"20":t.surfaceAlt, border:"1.5px solid "+(isReq?t.danger:t.border), color:isReq?t.danger:t.textDim,
                }}>{isReq?"⚠ Lock":"—"}</button>
              </div>
            );
          })}
          {requiredShift && (
            <div style={{fontSize:9,color:t.danger,marginTop:4,padding:"4px 8px",background:t.danger+"10",borderRadius:4,border:"1px solid "+t.danger+"30"}}>
              ⚠ Required: will never be placed on any other shift
            </div>
          )}
        </div>
        <div style={{flex:1,minWidth:200}}>
          <div style={{fontSize:9,color:t.textDim,marginBottom:5}}>PREFERRED DAYS OFF <span style={{fontWeight:400}}>(pick 2)</span></div>
          <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
            {DAYS.map(day => {
              const on = daysOff.includes(day);
              const order = daysOff.indexOf(day);
              return (
                <button key={day} onClick={() => toggleDay(day)} style={{
                  fontSize:10,fontWeight:on?700:500,padding:"4px 8px",borderRadius:5,fontFamily:"inherit",cursor:"pointer",position:"relative",
                  background:on?t.accent+"22":t.surfaceAlt, border:"1.5px solid "+(on?t.accent:t.border), color:on?t.accent:t.textDim,
                }}>
                  {day.substring(0, 3)}
                  {on && <span style={{position:"absolute",top:-4,right:-4,width:14,height:14,borderRadius:"50%",background:t.accent,color:"#fff",fontSize:8,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800}}>{order+1}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── EmployeeRow (single employee card in the table) ───────────────────────────
export function EmployeeRow({ emp, schedule, extShifts, afExclude, setAfExclude, onEdit, onDelete, cfg }) {
  const { theme: t } = useTheme();
  const isFT = emp.employmentType === "full-time";
  const hours = calcHours(emp.id, schedule, extShifts || []);
  const isUnder = isFT && hours < 40;
  const fatigueIssues = useMemo(() => getFatigueIssues(emp.id, schedule, cfg, [emp]), [emp.id, schedule, cfg]);
  const ftTarget = 40;

  return (
    <tr
      onClick={() => onEdit(emp)}
      style={{cursor:"pointer",borderBottom:"1px solid "+t.border,background:fatigueIssues.length?t.fatigue+"08":isUnder?t.danger+"06":t.surface,transition:"background .12s"}}
      onMouseEnter={e => e.currentTarget.style.background=t.accent+"0d"}
      onMouseLeave={e => e.currentTarget.style.background=fatigueIssues.length?t.fatigue+"08":isUnder?t.danger+"06":t.surface}
    >
      <td style={{padding:"9px 14px",maxWidth:200}}>
        <div style={{fontWeight:600,fontSize:13,whiteSpace:"nowrap"}}>{emp.name}</div>
        {fatigueIssues.length > 0 && <div style={{fontSize:9,color:t.fatigue}}>⚠ {fatigueIssues.length} fatigue</div>}
        {isUnder && <div style={{fontSize:9,color:t.danger}}>⚠ {hours}h / {ftTarget}h</div>}
        {emp.notes && <div style={{fontSize:9,color:t.textDim,fontStyle:"italic",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:180}} title={emp.notes}>📝 {emp.notes}</div>}
      </td>
      <td style={{padding:"9px 10px",whiteSpace:"nowrap"}}>
        <span style={{fontSize:10,fontWeight:700,padding:"2px 7px",borderRadius:4,
          background:(isFT?t.accent:emp.employmentType==="on-call"?t.warning:t.scale)+"20",
          color:isFT?t.accent:emp.employmentType==="on-call"?t.warning:t.scale,
          border:"1px solid "+(isFT?t.accent:emp.employmentType==="on-call"?t.warning:t.scale)+"40"}}>
          {isFT?"FT":emp.employmentType==="on-call"?"OC":"PT"}
        </span>
      </td>
      <td style={{padding:"9px 10px",fontSize:11,whiteSpace:"nowrap"}}>
        {emp.requiredShift && <span style={{color:t.danger,fontWeight:700,fontSize:10}}>⚠ {SHIFTS.find(s=>s.id===emp.requiredShift)?.label}</span>}
        {!emp.requiredShift && (emp.preferredShifts||[]).length > 0 && <span style={{color:t.accent,fontSize:10}}>★ {(emp.preferredShifts||[]).map(s=>SHIFTS.find(x=>x.id===s)?.label||s).join("/")}</span>}
        {!emp.requiredShift && !(emp.preferredShifts||[]).length && <span style={{color:t.textDim,fontSize:10}}>Any</span>}
      </td>
      <td style={{padding:"9px 10px"}}>
        <span style={{display:"flex",gap:3,alignItems:"center",flexShrink:0}}>
          {ALL_POSITIONS.map(p => (
            <span key={p} title={p} style={{width:8,height:8,borderRadius:"50%",display:"inline-block",flexShrink:0,background:(emp.qualifications||[]).includes(p)?positionColor(p,t):t.border,border:"1px solid "+((emp.qualifications||[]).includes(p)?positionColor(p,t):t.textDim)}}/>
          ))}
        </span>
      </td>
      <td style={{padding:"9px 10px",fontSize:10,color:t.textDim,whiteSpace:"nowrap"}}>
        {(emp.preferredDaysOff||[]).length > 0 ? (emp.preferredDaysOff||[]).map(d=>d.substring(0,3)).join(", ") : <span style={{color:t.border}}>—</span>}
      </td>
      <td style={{padding:"9px 10px",textAlign:"center"}}>
        {isFT && <span style={{fontSize:11,fontWeight:700,color:hours>=48?t.danger:hours>=40?t.scale:hours>0?t.warning:t.textDim}}>{hours>0?hours+"h":"—"}</span>}
      </td>
      <td style={{padding:"9px 10px",whiteSpace:"nowrap"}}>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <button
            onClick={e => { e.stopPropagation(); setAfExclude(prev => (prev||[]).includes(emp.id) ? prev.filter(x=>x!==emp.id) : [...(prev||[]),emp.id]); }}
            title={(afExclude||[]).includes(emp.id)?"Include in autofill":"Exclude from autofill"}
            style={{background:(afExclude||[]).includes(emp.id)?t.danger+"20":"transparent",border:"1px solid "+((afExclude||[]).includes(emp.id)?t.danger:t.border),color:(afExclude||[]).includes(emp.id)?t.danger:t.textDim,cursor:"pointer",fontSize:10,fontWeight:700,padding:"2px 6px",borderRadius:4,whiteSpace:"nowrap"}}>
            {(afExclude||[]).includes(emp.id)?"⊘":"⚡"}
          </button>
          <button onClick={e => { e.stopPropagation(); onDelete(emp.id); }}
            style={{background:"transparent",border:"none",color:t.textDim,cursor:"pointer",fontSize:12,padding:"2px 4px"}}
            title="Remove employee">✕</button>
        </div>
      </td>
    </tr>
  );
}
