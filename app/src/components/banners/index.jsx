import { useMemo } from "react";
import { useTheme } from "../../context/ThemeContext.jsx";
import { useSettings } from "../../context/SettingsContext.jsx";
import { calcHours, getFatigueIssues } from "../../utils/hours.js";
import { getAllPrefViolations } from "../../utils/validation.js";
import { positionColor } from "../../constants/themes.js";
import {
  EXT_PAIRS, FT_MIN_HOURS,
  MAX_CONSECUTIVE_NIGHTS, MIN_REST_HOURS,
} from "../../constants/index.js";

// ── ExtShiftBanner ────────────────────────────────────────────────────────────
export function ExtShiftBanner({ extShifts, employees, onRemove }) {
  const { theme: t } = useTheme();
  if (!extShifts.length) return null;
  const getName = (id) => employees.find(e => e.id === id)?.name || "?";
  const empColor = "#7c3aed";

  return (
    <div style={{background:empColor+"10",border:"1px solid "+empColor+"40",borderRadius:6,padding:"10px 16px",marginBottom:12,fontSize:12}}>
      <div style={{fontWeight:700,color:empColor,marginBottom:8,fontSize:13}}>
        ⏱ ACTIVE 12-HOUR EXTENDED SHIFTS ({extShifts.length})
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:5}}>
        {extShifts.map((ext, i) => {
          const pair = EXT_PAIRS.find(p => p.id === ext.pairId);
          return (
            <div key={i} style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",padding:"6px 10px",background:t.surface,borderRadius:5,border:"1px solid "+empColor+"25"}}>
              <span style={{fontSize:10,fontWeight:700,color:empColor,background:empColor+"18",padding:"2px 7px",borderRadius:3}}>{pair?.label}</span>
              <span style={{fontWeight:700,fontSize:11}}>{ext.day}</span>
              <span style={{fontSize:11,color:t.textMuted}}>{pair?.time}</span>
              <span style={{fontSize:11,display:"flex",alignItems:"center",gap:4}}>
                <span style={{fontSize:9,fontWeight:700,color:"#7c3aed",background:"#7c3aed18",padding:"1px 4px",borderRadius:2}}>DAY</span>
                {getName(ext.empAId)}
              </span>
              {ext.empBId && (
                <span style={{fontSize:11,display:"flex",alignItems:"center",gap:4}}>
                  <span style={{color:t.textDim}}>·</span>
                  <span style={{fontSize:9,fontWeight:700,color:"#0e7490",background:"#0e749018",padding:"1px 4px",borderRadius:2}}>NIGHT</span>
                  {getName(ext.empBId)}
                </span>
              )}
              {ext.auto && <span style={{fontSize:9,color:t.textDim,fontStyle:"italic",marginLeft:2}}>auto</span>}
              <span style={{marginLeft:"auto",display:"flex",gap:4}}>
                {(ext.roles||[]).map(r => (
                  <span key={r} style={{fontSize:9,fontWeight:700,padding:"1px 5px",borderRadius:3,background:positionColor(r,t)+"18",color:positionColor(r,t),border:"1px solid "+positionColor(r,t)+"30"}}>{r}</span>
                ))}
              </span>
              <button onClick={() => onRemove(i)}
                style={{background:"transparent",border:"none",color:t.textDim,cursor:"pointer",fontSize:12,padding:"0 2px",fontFamily:"inherit"}}
                onMouseEnter={e => e.target.style.color="#ef4444"}
                onMouseLeave={e => e.target.style.color=t.textDim}
                title="Remove extended shift">✕</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── UnderHoursBanner ──────────────────────────────────────────────────────────
export function UnderHoursBanner({ employees, schedule, extShifts }) {
  const { theme: t } = useTheme();
  const underHours = useMemo(() =>
    employees
      .filter(e => e.employmentType === "full-time" && calcHours(e.id, schedule, extShifts) < FT_MIN_HOURS)
      .map(e => ({ emp: e, hours: calcHours(e.id, schedule, extShifts) }))
  , [employees, schedule, extShifts]);

  if (!underHours.length) return null;

  return (
    <div style={{background:t.dangerDim,border:"1px solid "+t.danger,borderRadius:6,padding:"10px 16px",marginBottom:12,fontSize:12}}>
      <div style={{fontWeight:700,color:t.danger,marginBottom:6,fontSize:13}}>⚠ UNDER 40 HOURS — FULL-TIME EMPLOYEES</div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {underHours.map(({ emp, hours }) => (
          <span key={emp.id} style={{background:t.danger+"20",border:"1px solid "+t.danger+"50",padding:"3px 10px",borderRadius:4,color:t.name==="dark"?"#fca5a5":t.danger,fontWeight:600}}>
            {emp.name}: {hours}h / 40h
          </span>
        ))}
      </div>
    </div>
  );
}

// ── FatigueBanner ─────────────────────────────────────────────────────────────
export function FatigueBanner({ employees, schedule }) {
  const { theme: t } = useTheme();
  const { settings: cfg } = useSettings();

  const issues = useMemo(() => {
    const result = [];
    employees.forEach(emp => {
      const empIssues = getFatigueIssues(emp.id, schedule, cfg, employees);
      if (empIssues.length) result.push({ emp, issues: empIssues });
    });
    return result;
  }, [employees, schedule, cfg]);

  if (!issues.length) return null;

  return (
    <div style={{background:t.fatigueDim,border:"1px solid "+t.fatigue,borderRadius:6,padding:"10px 16px",marginBottom:12,fontSize:12}}>
      <div style={{fontWeight:700,color:t.fatigue,marginBottom:8,fontSize:13}}>⚠ FATIGUE WARNINGS</div>
      <div style={{display:"flex",flexDirection:"column",gap:5}}>
        {issues.map(({ emp, issues: empIssues }) => (
          <div key={emp.id} style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
            <span style={{fontWeight:700,color:t.text,fontSize:11,minWidth:120}}>{emp.name}</span>
            {empIssues.map((iss, i) => (
              <span key={i} style={{background:t.fatigue+"20",border:"1px solid "+t.fatigue+"50",padding:"2px 8px",borderRadius:4,color:t.fatigue,fontWeight:600,fontSize:10}}>
                {iss.type === "over_16h"
                  ? `${iss.hours}h consecutive (cap: ${iss.cap}h) on ${iss.day}`
                  : iss.type === "consecutive_nights"
                  ? `${iss.count} consecutive night shifts (${iss.day})`
                  : `Only ${iss.restHours}h rest before ${iss.day} ${iss.shiftId}`}
              </span>
            ))}
          </div>
        ))}
      </div>
      <div style={{marginTop:8,fontSize:10,color:t.textDim}}>
        Max {cfg?.maxConsecutiveNights ?? MAX_CONSECUTIVE_NIGHTS} consecutive night shifts • Min {cfg?.minRestHours ?? MIN_REST_HOURS}h rest between shifts
      </div>
    </div>
  );
}

// ── PreferenceViolationBanner ─────────────────────────────────────────────────
export function PreferenceViolationBanner({ employees, schedule }) {
  const { theme: t } = useTheme();

  const violations = useMemo(() => {
    const all = [];
    employees.forEach(emp => {
      const v = getAllPrefViolations(emp, schedule);
      if (v.length) all.push({ emp, violations: v });
    });
    return all;
  }, [employees, schedule]);

  if (!violations.length) return null;

  const hardCount = violations.reduce((n, { violations: v }) => n + v.filter(x => x.type === "blocked_shift" || x.type === "wrong_shift_required").length, 0);
  const softCount = violations.reduce((n, { violations: v }) => n + v.filter(x => x.type !== "blocked_shift" && x.type !== "wrong_shift_required").length, 0);

  return (
    <div style={{background:hardCount > 0 ? t.dangerDim : t.warningDim, border:"1px solid "+(hardCount > 0 ? t.danger : t.warning), borderRadius:6, padding:"10px 16px", marginBottom:12, fontSize:12}}>
      <div style={{fontWeight:700, color:hardCount > 0 ? t.danger : t.warning, marginBottom:6, fontSize:13}}>
        {hardCount > 0 ? `⚠ ${hardCount} HARD VIOLATION${hardCount !== 1 ? "S" : ""}` : `ℹ ${softCount} PREFERENCE CONFLICT${softCount !== 1 ? "S" : ""}`}
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:4}}>
        {violations.map(({ emp, violations: v }) => (
          <div key={emp.id} style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
            <span style={{fontWeight:700,fontSize:11,color:t.text,minWidth:120}}>{emp.name}</span>
            {v.map((viol, i) => {
              const isHard = viol.type === "blocked_shift" || viol.type === "wrong_shift_required";
              return (
                <span key={i} style={{fontSize:10,fontWeight:600,padding:"1px 7px",borderRadius:4,
                  background:(isHard ? t.danger : t.warning)+"20",
                  color:isHard ? t.danger : t.warning,
                  border:"1px solid "+(isHard ? t.danger : t.warning)+"40"}}>
                  {viol.msg}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
