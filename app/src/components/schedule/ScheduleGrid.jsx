import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTheme } from "../../context/ThemeContext.jsx";
import { useSettings } from "../../context/SettingsContext.jsx";
import {
  DAYS, SHIFTS, EXT_PAIRS, SHIFT_HOURS,
  cellKey, isWeekday, SUP_SLOT_DAY, getAvailPos,
  getSlotCount,
} from "../../constants/index.js";
import { positionColor, shiftColor } from "../../constants/themes.js";
import { calcHours, calcRestGap, calcConsecutiveHours, calcConsecutiveNights, empMaxConsec, getFatigueIssues } from "../../utils/hours.js";
import { slotHasRole, getPreferenceViolations, enforceBusinessRules } from "../../utils/validation.js";
import { extCovers, getEffectiveSlotCount } from "../../utils/extShifts.js";
import { buildAutoFill, canFillPos, canWorkExtHalf, timeOffCoversSlot } from "../../utils/autofill.js";
import { extHalfConflictReason } from "../../utils/extShifts.js";
import { findExtShiftPairs } from "../../utils/extShifts.js";
import { EnforcementBlockModal, OvertimeModal } from "../modals/index.jsx";
import { UnderHoursBanner, FatigueBanner, ExtShiftBanner } from "../banners/index.jsx";
import {
  SwapIndicator, SubIndicator, HistoryBar, WeekPickerBar,
  EmpPickerSearch, SchedulePopout,
} from "./ScheduleSubComponents.jsx";

export function ScheduleGrid({
  employees, schedule, setSchedule,
  onOpenTestModal, pendingAutoFill, clearPendingAutoFill,
  savedWeeks, setSavedWeeks, history, setHistory,
  highlightSlot, clearHighlightSlot,
  extShifts, setExtShifts, weekStart, setWeekStart,
  timeOffReqs, empTimeOffDays, empPatterns, setEmpPatterns,
  afExclude, setAfExclude,
  scheduleStale: scheduleStaleP, setScheduleStale: setScheduleStaleProp,
}) {
  const { theme: t } = useTheme();
  const { settings: cfg } = useSettings();

  // ── Local state ───────────────────────────────────────────────────────────
  const [editingCell,     setEditingCell]    = useState(null);
  const [swapSource,      setSwapSource]     = useState(null);
  const [subSource,       setSubSource]      = useState(null);
  const [dragEmp,         setDragEmp]        = useState(null);
  const [dragOver,        setDragOver]       = useState(null);
  const [overtimeItems,   setOvertimeItems]  = useState(null);
  const [pendingSchedule, setPendingSchedule]= useState(null);
  const [pendingExtList,  setPendingExtList] = useState([]);
  const [showCopyModal,   setShowCopyModal]  = useState(false);
  const [showPopout,      setShowPopout]     = useState(false);
  const [showPublish,     setShowPublish]    = useState(false);
  const [viewingHistory,  setViewingHistory] = useState(null);
  const [histSaveLabel,   setHistSaveLabel]  = useState("");
  const [showHistSave,    setShowHistSave]   = useState(false);
  const [scheduleIssues,  setScheduleIssues] = useState(null);
  const [enforcementBlock,setEnforcementBlock]=useState(null);
  const [extSuggestions,  setExtSuggestions] = useState(null);
  const [manualPairDay,   setManualPairDay]  = useState(null);
  const cellRefs = useRef({});

  const scheduleStale    = scheduleStaleP ?? false;
  const setScheduleStale = setScheduleStaleProp ?? (() => {});

  // Esc key handler
  useEffect(() => {
    const handler = (e) => {
      if (e.key !== "Escape") return;
      if (swapSource)  { setSwapSource(null); e.preventDefault(); return; }
      if (subSource)   { setSubSource(null); setEditingCell(null); e.preventDefault(); return; }
      if (dragEmp)     { setDragEmp(null); e.preventDefault(); return; }
      if (editingCell) { setEditingCell(null); e.preventDefault(); return; }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [swapSource, subSource, dragEmp, editingCell]);

  // Highlight scroll
  useEffect(() => {
    if (!highlightSlot) return;
    const key = cellKey(highlightSlot.day, highlightSlot.shiftId);
    const el = cellRefs.current[key];
    if (el) {
      el.scrollIntoView({ behavior:"smooth", block:"center" });
      el.style.outline = "3px solid " + t.accent;
      el.style.outlineOffset = "2px";
      const timer = setTimeout(() => { el.style.outline = ""; el.style.outlineOffset = ""; clearHighlightSlot?.(); }, 2000);
      return () => clearTimeout(timer);
    }
  }, [highlightSlot]);

  // Stale detection
  const prevEmpsRef = useRef(null);
  useEffect(() => {
    if (prevEmpsRef.current === null) { prevEmpsRef.current = employees; return; }
    const prefChanged = employees.some(emp => {
      const prev = prevEmpsRef.current.find(e => e.id === emp.id);
      if (!prev) return true;
      return (
        JSON.stringify(emp.preferredShifts||[]) !== JSON.stringify(prev.preferredShifts||[]) ||
        JSON.stringify(emp.blockedShifts||[]) !== JSON.stringify(prev.blockedShifts||[]) ||
        emp.requiredShift !== prev.requiredShift ||
        JSON.stringify(emp.preferredDaysOff||[]) !== JSON.stringify(prev.preferredDaysOff||[]) ||
        JSON.stringify(emp.unavailableDays||[]) !== JSON.stringify(prev.unavailableDays||[]) ||
        JSON.stringify(emp.qualifications) !== JSON.stringify(prev.qualifications)
      );
    });
    if (prefChanged && Object.keys(schedule).length > 0) setScheduleStale(true);
    prevEmpsRef.current = employees;
  }, [employees]);

  // ── Derived state ─────────────────────────────────────────────────────────
  const displaySchedule = viewingHistory ? viewingHistory.schedule : schedule;
  const isReadOnly      = !!viewingHistory;

  const stepWeek = (dir) => {
    const [y,m,d] = (weekStart||"2024-01-07").split("-").map(Number);
    const dt = new Date(y, m-1, d, 12); dt.setDate(dt.getDate() + dir * 7);
    setWeekStart(dt.toISOString().slice(0,10));
  };

  const getAsgn       = (d,s) => displaySchedule[cellKey(d,s)] || [];
  const getName       = (id) => employees.find(e=>e.id===id)?.name || "?";
  const getAssignable = (emp,d,s) => getAvailPos(d,s).filter(p=>canFillPos(emp,p,d));
  const unassigned    = (d,s) => { const ids=getAsgn(d,s).map(a=>a.employeeId); return employees.filter(e=>!ids.includes(e.id)); };

  const stableEmpOrder = useMemo(() => {
    const shiftRank = { first:0, second:1, third:2 };
    const primarySh = (emp) => {
      if (emp.requiredShift) return emp.requiredShift;
      if ((emp.preferredShifts||[]).length===1) return emp.preferredShifts[0];
      const counts = { first:0, second:0, third:0 };
      DAYS.forEach(day => SHIFTS.forEach(s => { if((schedule[cellKey(day,s.id)]||[]).some(a=>a.employeeId===emp.id)) counts[s.id]++; }));
      return Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]?.[0] || "first";
    };
    return [...employees].sort((a,b) => {
      const aS = (a.qualifications||[]).includes("Supervisor")?0:1;
      const bS = (b.qualifications||[]).includes("Supervisor")?0:1;
      if (aS!==bS) return aS-bS;
      return ((shiftRank[primarySh(a)]||0)-(shiftRank[primarySh(b)]||0)) || a.name.localeCompare(b.name);
    });
  }, [employees, schedule]);

  const sortedAsgn = (asgn) => {
    const om = new Map(stableEmpOrder.map((e,i)=>[e.id,i]));
    return [...asgn].sort((a,b)=>(om.get(a.employeeId)??999)-(om.get(b.employeeId)??999));
  };

  // ── History helpers ───────────────────────────────────────────────────────
  const autoSaveToHistory = useCallback((ws, sched) => {
    if (!Object.values(sched).some(a=>a.length>0)) return;
    setHistory(prev => {
      const existing = prev.findIndex(h=>h.weekStart===ws&&h.isAutoSave);
      const entry = { weekStart:ws, savedAt:new Date().toISOString(), label:null, schedule:JSON.parse(JSON.stringify(sched)), isAutoSave:true };
      const next = existing>=0 ? prev.map((h,i)=>i===existing?entry:h) : [...prev,entry];
      return next.sort((a,b)=>a.weekStart.localeCompare(b.weekStart));
    });
  }, [setHistory]);

  const manualSaveToHistory = useCallback((label, ws, sched) => {
    const trimmedLabel = label.trim(); if(!trimmedLabel) return;
    setHistory(prev => {
      const entry = { weekStart:ws, savedAt:new Date().toISOString(), label:trimmedLabel, schedule:JSON.parse(JSON.stringify(sched)), isAutoSave:false };
      const existing = prev.findIndex(h=>h.weekStart===ws&&!h.isAutoSave&&h.label===trimmedLabel);
      const next = existing>=0 ? prev.map((h,i)=>i===existing?entry:h) : [...prev,entry];
      return next.sort((a,b)=>a.weekStart.localeCompare(b.weekStart));
    });
  }, [setHistory]);

  // ── Validate schedule ─────────────────────────────────────────────────────
  const validateSchedule = useCallback((sched, exts, emps) => {
    const issues = [];
    const E = (msg) => issues.push({ level:"error", msg });
    const W = (msg) => issues.push({ level:"warn",  msg });
    const rmap = Object.fromEntries((emps||employees).map(e=>[e.id,e]));
    const allExts = exts || extShifts || [];

    const extBodyCount = (day, shiftId) => {
      let n=0;
      allExts.forEach(ext => {
        const pair = EXT_PAIRS.find(p=>p.id===ext.pairId); if(!pair) return;
        const idx = pair.covers.indexOf(shiftId);
        if (idx===0&&ext.empAId&&ext.day===day) n++;
        if (idx===1&&ext.empBId&&ext.day===day) n++;
      });
      return n;
    };

    DAYS.forEach(day => {
      SHIFTS.forEach(shift => {
        const key  = cellKey(day, shift.id);
        const asgn = sched[key] || [];
        const extBodies = extBodyCount(day, shift.id);
        const totalBodies = asgn.length + extBodies;
        const shiftLabel = `${day} ${shift.label}`;

        if (totalBodies < 3) {
          const names = asgn.map(a=>(rmap[a.employeeId]?.name||"?").split(" ").pop()).join(", ");
          E(`Rule 2 — ${shiftLabel}: only ${totalBodies} person${totalBodies===1?"":"s"} (min 3 required)${names?" ["+names+"]":""}`);
        }

        const extEmps = allExts.filter(ext=>ext.day===day)
          .flatMap(ext=>[ext.empAId,ext.empBId].filter(Boolean).map(id=>rmap[id]).filter(Boolean)
            .filter(e=>{ const pair=EXT_PAIRS.find(p=>p.id===ext.pairId); return pair&&pair.covers.indexOf(shift.id)>=0; }));
        const extHasScale   = extEmps.some(e=>(e.qualifications||[]).includes("Scale"));
        const extHasMedical = extEmps.some(e=>(e.qualifications||[]).includes("Medical"));
        const hasScale   = slotHasRole(asgn, Object.values(rmap), "Scale")   || extHasScale;
        const hasMedical = slotHasRole(asgn, Object.values(rmap), "Medical") || extHasMedical;
        if (!hasScale)   E(`Rule 3 — ${shiftLabel}: no Scale assigned`);
        if (!hasMedical) E(`Rule 3 — ${shiftLabel}: no Medical assigned`);

        const supNeed = SUP_SLOT_DAY(day, shift.id) ? 1 : 0;
        const supCount = asgn.filter(a=>a.position==="Supervisor").length;
        if (supNeed>0&&supCount===0) W(`No Supervisor assigned on ${day} 1st shift`);
      });
    });

    // Constraint violations
    DAYS.forEach(day => SHIFTS.forEach(shift => {
      (sched[cellKey(day,shift.id)]||[]).forEach(a => {
        const emp = rmap[a.employeeId]; if(!emp) return;
        if ((emp.unavailableDays||[]).includes(day)) E(`${emp.name} assigned on unavailable day ${day} (${shift.id})`);
        if ((emp.blockedShifts||[]).includes(shift.id)) E(`${emp.name} assigned to blocked shift ${shift.id} on ${day}`);
        if (emp.requiredShift && emp.requiredShift!==shift.id) E(`${emp.name} on ${shift.id} but required on ${emp.requiredShift} (${day})`);
      });
    }));

    // FT hours
    const hoursByEmp = {};
    DAYS.forEach(day=>SHIFTS.forEach(shift=>{
      (sched[cellKey(day,shift.id)]||[]).forEach(a=>{ hoursByEmp[a.employeeId]=(hoursByEmp[a.employeeId]||0)+SHIFT_HOURS; });
    }));
    (emps||employees).forEach(emp => {
      if (emp.employmentType!=="full-time") return;
      const h = hoursByEmp[emp.id]||0;
      if (h<40) E(`Rule 1 — ${emp.name} has only ${h}h scheduled (full-time minimum is 40h)`);
      if (h>48) W(`${emp.name} has ${h}h this week (over 48h)`);
    });

    return issues;
  }, [employees, extShifts]);

  // ── Assignment mutations ──────────────────────────────────────────────────
  const assignEmp = (d,s,eid,pos) => {
    if (isReadOnly) return;
    const key=cellKey(d,s); const cur=schedule[key]||[];
    if (cur.length>=getEffectiveSlotCount(d,s,extShifts)||cur.some(a=>a.employeeId===eid)) return;
    setSchedule(p=>({...p,[key]:[...cur,{employeeId:eid,position:pos}]}));
    setEditingCell(null);
  };

  const removeAsgn = (d,s,eid) => {
    if (isReadOnly) return;
    setSchedule(p=>({...p,[cellKey(d,s)]:(p[cellKey(d,s)]||[]).filter(a=>a.employeeId!==eid)}));
  };

  const getStatus = (d,s) => {
    const a=getAsgn(d,s);
    const cellExtList=(extShifts||[]).filter(e=>extCovers(e,d,s));
    const extHasScale=cellExtList.some(e=>(e.roles||[]).includes("Scale"));
    const extHasMed  =cellExtList.some(e=>(e.roles||[]).includes("Medical"));
    const hasScale   =slotHasRole(a,employees,"Scale")  ||extHasScale;
    const hasMed     =slotHasRole(a,employees,"Medical")||extHasMed;
    const isFull     =a.length>=getEffectiveSlotCount(d,s,extShifts);
    const missing=[...(!hasScale?["Scale"]:[]),...(!hasMed?["Medical"]:[])];
    return{hasScale,hasMedical:hasMed,isFull,missing,ok:missing.length===0,cellExtList};
  };

  // ── Swap / Sub ────────────────────────────────────────────────────────────
  const getSwapViolations = (srcEmp,srcDay,srcShiftId,srcPos,tgtEmp,tgtDay,tgtShiftId,tgtPos) => {
    const viols=[];
    if((srcEmp?.unavailableDays||[]).includes(tgtDay)) viols.push({hard:true,msg:`${srcEmp.name} is unavailable on ${tgtDay}`});
    if((tgtEmp?.unavailableDays||[]).includes(srcDay)) viols.push({hard:true,msg:`${tgtEmp.name} is unavailable on ${srcDay}`});
    if(srcEmp?.requiredShift&&srcEmp.requiredShift!==tgtShiftId) viols.push({hard:true,msg:`${srcEmp.name} is locked to ${srcEmp.requiredShift} shift`});
    if(tgtEmp?.requiredShift&&tgtEmp.requiredShift!==srcShiftId) viols.push({hard:true,msg:`${tgtEmp.name} is locked to ${tgtEmp.requiredShift} shift`});
    if(tgtPos!=="Guard"&&!(srcEmp?.qualifications||[]).includes(tgtPos)) viols.push({hard:true,msg:`${srcEmp.name} is not qualified for ${tgtPos}`});
    if(srcPos!=="Guard"&&!(tgtEmp?.qualifications||[]).includes(srcPos)) viols.push({hard:true,msg:`${tgtEmp.name} is not qualified for ${srcPos}`});
    getPreferenceViolations(srcEmp,tgtDay,tgtShiftId,schedule).forEach(v=>viols.push({hard:false,msg:`${srcEmp.name}: ${v.msg}`}));
    getPreferenceViolations(tgtEmp,srcDay,srcShiftId,schedule).forEach(v=>viols.push({hard:false,msg:`${tgtEmp.name}: ${v.msg}`}));
    const minRest=cfg?.minRestHours??12;
    const swapped={...schedule,[cellKey(srcDay,srcShiftId)]:(schedule[cellKey(srcDay,srcShiftId)]||[]).map(a=>a.employeeId===srcEmp.id?{...a,employeeId:tgtEmp.id,position:srcPos}:a),[cellKey(tgtDay,tgtShiftId)]:(schedule[cellKey(tgtDay,tgtShiftId)]||[]).map(a=>a.employeeId===tgtEmp.id?{...a,employeeId:srcEmp.id,position:tgtPos}:a)};
    const sRest=calcRestGap(srcEmp.id,swapped,tgtDay,tgtShiftId);
    const tRest=calcRestGap(tgtEmp.id,swapped,srcDay,srcShiftId);
    if(sRest<minRest&&sRest!==Infinity) viols.push({hard:false,msg:`${srcEmp.name} would have only ${Math.round(sRest*10)/10}h rest`});
    if(tRest<minRest&&tRest!==Infinity) viols.push({hard:false,msg:`${tgtEmp.name} would have only ${Math.round(tRest*10)/10}h rest`});
    return viols;
  };

  const executeSwap = (src,tgt) => {
    const sk=cellKey(src.day,src.shiftId), tk=cellKey(tgt.day,tgt.shiftId);
    setSchedule(prev=>({...prev,[sk]:(prev[sk]||[]).map(a=>a.employeeId===src.employeeId?{...a,employeeId:tgt.employeeId,position:src.position}:a),[tk]:(prev[tk]||[]).map(a=>a.employeeId===tgt.employeeId?{...a,employeeId:src.employeeId,position:tgt.position}:a)}));
    setSwapSource(null);
  };

  const executeSub = (subSrc,newEmpId,newPosition) => {
    const subEmp=employees.find(e=>e.id===subSrc.employeeId), newEmp=employees.find(e=>e.id===newEmpId);
    if(!subEmp||!newEmp) return;
    const viols=[];
    if((newEmp.unavailableDays||[]).includes(subSrc.day)) viols.push({hard:true,msg:`${newEmp.name} is unavailable on ${subSrc.day}`});
    if(newEmp.requiredShift&&newEmp.requiredShift!==subSrc.shiftId) viols.push({hard:true,msg:`${newEmp.name} is locked to ${newEmp.requiredShift} shift`});
    if(newPosition!=="Guard"&&!(newEmp.qualifications||[]).includes(newPosition)) viols.push({hard:true,msg:`${newEmp.name} is not qualified for ${newPosition}`});
    getPreferenceViolations(newEmp,subSrc.day,subSrc.shiftId,schedule).forEach(v=>viols.push({hard:false,msg:`${newEmp.name}: ${v.msg}`}));
    const rest=calcRestGap(newEmp.id,schedule,subSrc.day,subSrc.shiftId);
    if(rest<(cfg?.minRestHours??12)&&rest!==Infinity) viols.push({hard:false,msg:`${newEmp.name} would have only ${Math.round(rest*10)/10}h rest`});
    const hard=viols.filter(v=>v.hard), soft=viols.filter(v=>!v.hard);
    if(hard.length>0){alert("Sub blocked:\n\n"+hard.map(v=>"• "+v.msg).join("\n")+(soft.length?"\n\nAlso note:\n"+soft.map(v=>"• "+v.msg).join("\n"):"")); return;}
    if(soft.length>0&&!window.confirm("Sub warnings:\n\n"+soft.map(v=>"⚠ "+v.msg).join("\n")+"\n\nProceed?")) return;
    const key=cellKey(subSrc.day,subSrc.shiftId);
    setSchedule(prev=>({...prev,[key]:(prev[key]||[]).map(a=>a.employeeId===subSrc.employeeId?{...a,employeeId:newEmpId,position:newPosition}:a)}));
    setSubSource(null); setEditingCell(null);
  };

  const handleChipClick = (empId,day,shiftId,position,e) => {
    e.stopPropagation(); if(isReadOnly) return;
    if(swapSource) {
      if(swapSource.employeeId===empId&&swapSource.day===day&&swapSource.shiftId===shiftId){setSwapSource(null);return;}
      const srcEmp=employees.find(e=>e.id===swapSource.employeeId), tgtEmp=employees.find(e=>e.id===empId);
      const viols=getSwapViolations(srcEmp,swapSource.day,swapSource.shiftId,swapSource.position,tgtEmp,day,shiftId,position);
      const hard=viols.filter(v=>v.hard), soft=viols.filter(v=>!v.hard);
      if(hard.length>0){alert("Swap blocked:\n\n"+hard.map(v=>"• "+v.msg).join("\n")+(soft.length?"\n\nAlso note:\n"+soft.map(v=>"• "+v.msg).join("\n"):"")); return;}
      if(soft.length>0&&!window.confirm("Swap warnings:\n\n"+soft.map(v=>"⚠ "+v.msg).join("\n")+"\n\nProceed?")) return;
      executeSwap(swapSource,{employeeId:empId,day,shiftId,position}); return;
    }
    if(subSource){if(subSource.employeeId===empId&&subSource.day===day&&subSource.shiftId===shiftId){setSubSource(null);setEditingCell(null);}return;}
    setEditingCell(prev=>{const key=cellKey(day,shiftId); return prev===key+"__chipprompt__"+empId?null:key+"__chipprompt__"+empId;});
  };

  const isSwapHardBlocked=(empId,day,shiftId,position)=>{
    if(!swapSource) return false;
    const s=employees.find(e=>e.id===swapSource.employeeId), tgt=employees.find(e=>e.id===empId);
    if(!s||!tgt) return false;
    if((s.unavailableDays||[]).includes(day)) return true;
    if((tgt.unavailableDays||[]).includes(swapSource.day)) return true;
    if(s.requiredShift&&s.requiredShift!==shiftId) return true;
    if(tgt.requiredShift&&tgt.requiredShift!==swapSource.shiftId) return true;
    if(position!=="Guard"&&!(s.qualifications||[]).includes(position)) return true;
    if(swapSource.position!=="Guard"&&!(tgt.qualifications||[]).includes(swapSource.position)) return true;
    return false;
  };

  // ── Drag and drop ─────────────────────────────────────────────────────────
  const handleDrop = (d,s) => {
    if(!dragEmp) return;
    const cur=getAsgn(d,s);
    if(cur.length>=getEffectiveSlotCount(d,s,extShifts)||cur.some(a=>a.employeeId===dragEmp.id)) return;
    const ap=getAssignable(dragEmp,d,s); if(!ap.length) return;
    const st=getStatus(d,s);
    let pos;
    if(!st.hasScale&&ap.includes("Scale")&&canFillPos(dragEmp,"Scale",d)) pos="Scale";
    else if(!st.hasMedical&&ap.includes("Medical")&&canFillPos(dragEmp,"Medical",d)) pos="Medical";
    else if(ap.includes("Guard")) pos="Guard";
    else pos=ap[0];
    const warns=[];
    const isUnavail=(dragEmp.unavailableDays||[]).includes(d);
    const rest=calcRestGap(dragEmp.id,schedule,d,s);
    const consecH=calcConsecutiveHours(dragEmp.id,schedule,d,s,extShifts);
    const shortRest=rest<(cfg?.minRestHours??12)&&rest!==Infinity;
    const nights=s==="third"?calcConsecutiveNights(dragEmp.id,schedule,d,s):0;
    if(consecH>empMaxConsec(dragEmp)){setDragEmp(null);return;}
    if(isUnavail) warns.push(`${dragEmp.name} is marked unavailable on ${d}.`);
    if(shortRest) warns.push(`Only ${Math.round(rest*10)/10}h rest since last shift.`);
    if(nights>=(cfg?.maxConsecutiveNights??3)) warns.push(`${nights} consecutive night shifts.`);
    if(dragEmp.employmentType==="full-time"&&calcHours(dragEmp.id,schedule)>=40) warns.push(`${dragEmp.name} would go to overtime.`);
    if(warns.length&&!window.confirm(warns.join("\n\n")+"\n\nAssign anyway?")){setDragEmp(null);return;}
    assignEmp(d,s,dragEmp.id,pos); setDragEmp(null); setDragOver(null);
  };

  // ── Auto-fill ─────────────────────────────────────────────────────────────
  const runAutoFill = useCallback((empOverride) => {
    const allSource=empOverride||employees;
    const excludeSet=new Set(afExclude||[]);
    const source=allSource.filter(e=>!excludeSet.has(e.id));
    if(!source.length) return;

    const manualExtShifts=(extShifts||[]).filter(e=>e.approvedAt!=="auto-fill");
    const {schedule:ns,hourTracker,usedPatterns}=buildAutoFill(source,cfg,empTimeOffDays,empPatterns,manualExtShifts);
    if(usedPatterns&&Object.keys(usedPatterns).length) setEmpPatterns(prev=>({...prev,...usedPatterns}));

    // Build auto ext shifts for role gaps
    const autoExtShifts=[];
    const usedExtPairs=new Set();
    DAYS.forEach(day=>{
      EXT_PAIRS.forEach(pair=>{
        if(usedExtPairs.has(day+"__"+pair.id)) return;
        const neededRoles=[];
        pair.covers.forEach(shiftId=>{
          const asgn=ns[cellKey(day,shiftId)]||[];
          if(!asgn.some(a=>a.position==="Scale")) neededRoles.push("Scale");
          if(!asgn.some(a=>a.position==="Medical")) neededRoles.push("Medical");
        });
        const uniqueNeeded=[...new Set(neededRoles)]; if(!uniqueNeeded.length) return;
        const alreadyInBoth=(empId)=>pair.covers.every(sid=>(ns[cellKey(day,sid)]||[]).some(a=>a.employeeId===empId));
        const candidates=source.filter(emp=>!(emp.unavailableDays||[]).includes(day)&&!alreadyInBoth(emp.id)&&uniqueNeeded.every(r=>emp.qualifications.includes(r))&&(canWorkExtHalf(emp,pair.id,0)||canWorkExtHalf(emp,pair.id,1)));
        for(let i=0;i<candidates.length;i++){
          for(let j=i+1;j<candidates.length;j++){
            const a=candidates[i],b=candidates[j];
            const [empA,empB]=canWorkExtHalf(a,pair.id,0)&&canWorkExtHalf(b,pair.id,1)?[a,b]:canWorkExtHalf(b,pair.id,0)&&canWorkExtHalf(a,pair.id,1)?[b,a]:[null,null];
            if(!empA||!empB) continue;
            const aR=["Scale","Medical"].filter(r=>empA.qualifications.includes(r));
            const bR=["Scale","Medical"].filter(r=>empB.qualifications.includes(r));
            if(!uniqueNeeded.every(r=>aR.includes(r)&&bR.includes(r))) continue;
            autoExtShifts.push({pairId:pair.id,day,empAId:empA.id,empBId:empB.id,roles:[...new Set([...aR,...bR])],approvedAt:"auto-fill",auto:true});
            usedExtPairs.add(day+"__"+pair.id); break;
          }
          if(usedExtPairs.has(day+"__"+pair.id)) break;
        }
      });
    });

    const resolveOtPref=(e)=>{const raw=e.overtimePref;return(raw&&raw!=="neutral")?raw:(cfg?.defaultOvertimePref||"neutral");};
    const otItems=source.filter(e=>e.employmentType==="full-time"&&(hourTracker[e.id]||0)>40&&resolveOtPref(e)!=="preferred").map(e=>({emp:e,currentHours:calcHours(e.id,schedule,extShifts),newHours:hourTracker[e.id]}));

    if(otItems.length>0){
      setPendingSchedule(ns); setPendingExtList(autoExtShifts); setOvertimeItems(otItems);
    } else {
      setSchedule(ns);
      if(autoExtShifts.length) setExtShifts(autoExtShifts);
      setScheduleIssues(validateSchedule(ns,autoExtShifts,source));
    }
    setScheduleStale(false);
  }, [employees,setSchedule,setExtShifts,cfg,empTimeOffDays,empPatterns,extShifts,schedule]);

  useEffect(()=>{
    if(pendingAutoFill&&pendingAutoFill.length>0){ runAutoFill(pendingAutoFill); clearPendingAutoFill(); }
  },[pendingAutoFill]);

  const handleOvertimeApproval=(approved)=>{
    if(!pendingSchedule) return;
    const unapprovedIds=new Set(overtimeItems.filter(i=>!approved[i.emp.id]).map(i=>i.emp.id));
    let cleaned=null;
    if(unapprovedIds.size>0){
      const ht={};employees.forEach(e=>{ht[e.id]=0;}); cleaned={};
      Object.keys(pendingSchedule).forEach(key=>{
        cleaned[key]=pendingSchedule[key].filter(a=>{
          if(!unapprovedIds.has(a.employeeId)){ht[a.employeeId]=(ht[a.employeeId]||0)+SHIFT_HOURS;return true;}
          const emp=employees.find(e=>e.id===a.employeeId); if(!emp) return false;
          if((ht[a.employeeId]||0)+SHIFT_HOURS>40) return false;
          ht[a.employeeId]=(ht[a.employeeId]||0)+SHIFT_HOURS; return true;
        });
      });
      setSchedule(cleaned);
    } else setSchedule(pendingSchedule);
    setOvertimeItems(null); setPendingSchedule(null);
    if(pendingExtList.length){setExtShifts(pendingExtList);setPendingExtList([]);}
    setScheduleIssues(validateSchedule(cleaned||pendingSchedule,pendingExtList.length?pendingExtList:extShifts,employees));
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Banners */}
      <UnderHoursBanner employees={employees} schedule={displaySchedule} extShifts={extShifts||[]}/>
      <FatigueBanner employees={employees} schedule={displaySchedule}/>
      <ExtShiftBanner extShifts={extShifts||[]} employees={employees} onRemove={i=>setExtShifts(prev=>prev.filter((_,idx)=>idx!==i))}/>

      {scheduleStale && (
        <div style={{background:t.warningDim,border:"1px solid "+t.warning,borderRadius:6,padding:"8px 14px",marginBottom:10,fontSize:11,display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
          <span style={{color:t.warning,fontWeight:700}}>⚠ Schedule may be stale — employee preferences have changed since last auto-fill.</span>
          <button onClick={()=>runAutoFill()} style={{background:t.warning,color:"#000",border:"none",padding:"5px 12px",borderRadius:5,cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>Re-run Auto-Fill</button>
        </div>
      )}

      {/* History bar */}
      <HistoryBar history={history} viewingHistory={viewingHistory} setViewingHistory={setViewingHistory}
        setSchedule={setSchedule} setWeekStart={setWeekStart}
        liveSchedule={schedule} liveWeekStart={weekStart} t={t}/>

      {/* Week picker */}
      <WeekPickerBar weekStart={weekStart} setWeekStart={setWeekStart} stepWeek={stepWeek} t={t}/>

      {/* Schedule grid */}
      <div style={{overflowX:"auto"}}>
        <div style={{minWidth:700}}>
          {/* Day headers */}
          <div style={{display:"grid",gridTemplateColumns:"100px repeat(7,1fr)",gap:2,marginBottom:2}}>
            <div style={{padding:"6px 8px",fontSize:9,fontWeight:700,color:t.textDim,letterSpacing:".06em",display:"flex",alignItems:"flex-end"}}>SHIFT</div>
            {DAYS.map(d=>(
              <div key={d} style={{padding:"6px 8px",textAlign:"center",background:t.surfaceAlt,borderRadius:"4px 4px 0 0",border:"1px solid "+t.border}}>
                <div style={{fontSize:11,fontWeight:700,color:isWeekday(d)?t.text:t.textMuted,letterSpacing:".04em"}}>{d.substring(0,3).toUpperCase()}</div>
                {!isWeekday(d)&&<div style={{fontSize:8,color:t.textDim}}>WKD</div>}
              </div>
            ))}
          </div>

          {/* Shift rows */}
          {SHIFTS.map(shift=>(
            <div key={shift.id} style={{display:"grid",gridTemplateColumns:"100px repeat(7,1fr)",gap:2,marginBottom:2}}>
              <div style={{background:t.surfaceAlt,border:"1px solid "+t.border,padding:"8px",display:"flex",flexDirection:"column",justifyContent:"center",borderRadius:"4px 0 0 4px"}}>
                <div style={{fontSize:11,fontWeight:700,color:shiftColor(shift.id,t)}}>{shift.label}</div>
                <div style={{fontSize:9,color:t.textDim,marginTop:1}}>{shift.time}</div>
              </div>
              {DAYS.map(day=>{
                const key=cellKey(day,shift.id);
                const asgn=getAsgn(day,shift.id);
                const st=getStatus(day,shift.id);
                const cellExt=st.cellExtList||[];
                const cellFatigue=asgn.flatMap(a=>getFatigueIssues(a.employeeId,schedule,[],employees).filter(i=>i.day===day&&i.shiftId===shift.id));
                const isEditing=editingCell===key;
                const borderColor=!asgn.length&&!cellExt.length?t.border:!st.ok?t.danger+"80":st.isFull&&st.ok?t.scale+"50":t.warning+"60";
                const bgColor=!asgn.length&&!cellExt.length?t.bg:!st.ok?t.danger+"08":t.surface;

                return (
                  <div key={day} ref={el=>cellRefs.current[key]=el}
                    onClick={()=>!isReadOnly&&setEditingCell(isEditing?null:key)}
                    onDragOver={e=>{e.preventDefault();setDragOver(key);}}
                    onDragLeave={()=>setDragOver(null)}
                    onDrop={()=>{handleDrop(day,shift.id);setDragOver(null);}}
                    style={{background:dragOver===key?t.accent+"18":bgColor,border:"1px solid "+(dragOver===key?t.accent:borderColor),borderRadius:4,padding:"6px 8px",minHeight:80,display:"flex",flexDirection:"column",gap:4,cursor:isReadOnly?"default":"pointer",transition:"border-color .15s, background .15s"}}>

                    {/* Status badge */}
                    {(cellFatigue.length>0||!st.ok||cellExt.length>0)&&(
                      <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:2}}>
                        {!st.ok&&st.missing.map(r=>(
                          <span key={r} style={{fontSize:8,fontWeight:700,color:t.danger,background:t.danger+"18",border:"1px solid "+t.danger+"40",padding:"1px 5px",borderRadius:3}}>⚠ {r}</span>
                        ))}
                        {cellExt.map((ext,ei)=>{
                          const pair=EXT_PAIRS.find(p=>p.id===ext.pairId);
                          const empAName=employees.find(e=>e.id===ext.empAId)?.name?.split(" ")[0]||"?";
                          const empBName=ext.empBId?employees.find(e=>e.id===ext.empBId)?.name?.split(" ")[0]||"?":null;
                          return(
                            <span key={ei} style={{fontSize:8,fontWeight:700,padding:"1px 5px",borderRadius:3,background:"#7c3aed14",border:"1px solid #7c3aed40",color:"#7c3aed"}}>
                              ⏱{pair?.id==="day"?"DAY":"NGT"}: {empAName}{empBName&&"/"+empBName}
                            </span>
                          );
                        })}
                        {cellFatigue.length>0&&<span style={{fontSize:8,fontWeight:700,color:t.fatigue,background:t.fatigue+"18",border:"1px solid "+t.fatigue+"30",padding:"1px 5px",borderRadius:3}}>⚠ FATIGUE</span>}
                      </div>
                    )}

                    {/* Assignment chips */}
                    {sortedAsgn(asgn).map(a=>{
                      const emp=employees.find(e=>e.id===a.employeeId);
                      const unavail=(emp?.unavailableDays||[]).includes(day);
                      const hasFatigue=unavail||calcRestGap(a.employeeId,schedule,day,shift.id)<(cfg?.minRestHours??12);
                      const prefViols=emp?getPreferenceViolations(emp,day,shift.id,schedule):[];
                      const hasPrefWarn=prefViols.length>0;
                      const hasReqViol=prefViols.some(v=>v.type==="wrong_shift_required");
                      const isOnCallSlot=!!a.isOnCall;
                      const borderCol=hasFatigue?t.fatigue+"60":hasReqViol?t.danger+"60":hasPrefWarn?t.warning+"50":isOnCallSlot?t.warning+"60":positionColor(a.position,t)+"30";
                      const bgCol=hasFatigue?t.fatigue+"18":hasReqViol?t.danger+"0d":hasPrefWarn?t.warning+"0a":positionColor(a.position,t)+"15";
                      const isSwapSelected=swapSource?.employeeId===a.employeeId&&swapSource?.day===day&&swapSource?.shiftId===shift.id;
                      const isSwapBlocked=swapSource&&!isSwapSelected&&isSwapHardBlocked(a.employeeId,day,shift.id,a.position);
                      const isSwapTarget=swapSource&&!isSwapSelected&&!isSwapBlocked;

                      return (
                        <div key={a.employeeId}>
                          <div onClick={e=>handleChipClick(a.employeeId,day,shift.id,a.position,e)}
                            style={{display:"flex",alignItems:"center",gap:5,padding:"4px 6px",
                              background:isSwapSelected?"#f59e0b22":isSwapTarget?"#22c55e0a":bgCol,
                              border:isSwapSelected?"2px solid #f59e0b":isSwapBlocked?"1px solid "+t.border:isSwapTarget?"1.5px dashed #22c55e":"1px solid "+borderCol,
                              borderRadius:4,fontSize:11,opacity:isSwapBlocked?0.35:1,
                              cursor:isReadOnly?"default":isSwapBlocked?"not-allowed":"pointer"}}>
                            <span style={{width:6,height:6,borderRadius:"50%",background:positionColor(a.position,t),flexShrink:0}}/>
                            <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:600,fontSize:10,color:isSwapSelected?"#f59e0b":isSwapTarget?"#22c55e":undefined}}>{getName(a.employeeId)}</span>
                            {emp?.employmentType==="on-call"&&<span style={{fontSize:8,fontWeight:800,color:t.warning,background:t.warning+"18",border:"1px solid "+t.warning+"50",padding:"0 3px",borderRadius:2,flexShrink:0}}>OC</span>}
                            {hasFatigue&&<span style={{fontSize:8,color:t.fatigue,fontWeight:800,flexShrink:0}}>⚠</span>}
                            {!hasFatigue&&hasPrefWarn&&<span style={{fontSize:8,color:hasReqViol?t.danger:t.warning,fontWeight:800,flexShrink:0}}>⚠</span>}
                            {emp?.employmentType==="full-time"&&(()=>{const h=calcHours(a.employeeId,displaySchedule,extShifts);const col=h>=48?t.danger:h>=40?t.scale:h>0?t.warning:t.textDim;return(<span style={{fontSize:8,fontWeight:800,color:col,flexShrink:0,background:col+"18",border:"1px solid "+col+"40",padding:"0 3px",borderRadius:2,minWidth:22,textAlign:"center"}}>{h}h</span>);})()}
                            <span style={{fontSize:9,color:positionColor(a.position,t),fontWeight:700,flexShrink:0}}>{a.position.substring(0,3).toUpperCase()}</span>
                            {!isReadOnly&&<button onClick={e=>{e.stopPropagation();removeAsgn(day,shift.id,a.employeeId);}} style={{background:"transparent",border:"none",color:t.textDim,cursor:"pointer",fontSize:10,padding:"0 2px",lineHeight:1}}>✕</button>}
                          </div>
                          {!isReadOnly&&!swapSource&&!subSource&&editingCell===key+"__chipprompt__"+a.employeeId&&(
                            <div style={{display:"flex",gap:4,marginTop:2,marginLeft:2}}>
                              <button onClick={e=>{e.stopPropagation();setEditingCell(null);setSwapSource({employeeId:a.employeeId,day,shiftId:shift.id,position:a.position});}} style={{flex:1,fontSize:9,fontWeight:700,padding:"3px 0",borderRadius:3,cursor:"pointer",background:"#f59e0b22",color:"#f59e0b",border:"1px solid #f59e0b66"}}>🔄 Swap</button>
                              <button onClick={e=>{e.stopPropagation();setSubSource({employeeId:a.employeeId,day,shiftId:shift.id,position:a.position});setEditingCell({day,shiftId:shift.id});}} style={{flex:1,fontSize:9,fontWeight:700,padding:"3px 0",borderRadius:3,cursor:"pointer",background:t.scale+"22",color:t.scale,border:"1px solid "+t.scale+"66"}}>⇄ Sub</button>
                              <button onClick={e=>{e.stopPropagation();setEditingCell(null);}} style={{fontSize:9,fontWeight:700,padding:"3px 5px",borderRadius:3,cursor:"pointer",background:"transparent",color:t.textDim,border:"1px solid "+t.border}}>✕</button>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Employee picker */}
                    {!isReadOnly&&isEditing&&!swapSource&&!subSource&&(
                      <EmpPickerSearch day={day} shift={shift} subSource={subSource} employees={employees}
                        unassigned={unassigned} getAssignable={getAssignable} assignEmp={assignEmp}
                        schedule={schedule} extShifts={extShifts} timeOffReqs={timeOffReqs}
                        weekStart={weekStart} executeSub={executeSub} st={st}
                        setEditingCell={setEditingCell} setSubSource={setSubSource} t={t} cfg={cfg}/>
                    )}

                    {st.isFull&&st.ok&&cellFatigue.length===0&&(
                      <div style={{fontSize:9,color:t.scale,textAlign:"center",marginTop:"auto",fontWeight:700,letterSpacing:".05em"}}>● FULL</div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Swap / Sub indicators */}
      {swapSource&&<SwapIndicator swapSource={swapSource} employees={employees} onCancel={()=>setSwapSource(null)}/>}
      {subSource&&<SubIndicator subSource={subSource} employees={employees} onCancel={()=>{setSubSource(null);setEditingCell(null);}}/>}

      {/* Validation issues panel */}
      {scheduleIssues!==null&&(
        <div style={{marginTop:16,borderRadius:8,overflow:"hidden",border:"1px solid "+(scheduleIssues.length===0?t.scale:scheduleIssues.some(i=>i.level==="error")?t.danger:t.warning)+"60"}}>
          <div style={{padding:"8px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",background:scheduleIssues.length===0?t.scale+"18":scheduleIssues.some(i=>i.level==="error")?t.danger+"18":t.warning+"18"}}>
            <span style={{fontWeight:700,fontSize:12,color:scheduleIssues.length===0?t.scale:scheduleIssues.some(i=>i.level==="error")?t.danger:t.warning}}>
              {scheduleIssues.length===0?"✓ Schedule validated — no issues found":scheduleIssues.some(i=>i.level==="error")?`⚠ ${scheduleIssues.filter(i=>i.level==="error").length} issue(s) found`:`ℹ ${scheduleIssues.length} warning(s)`}
            </span>
            <button onClick={()=>setScheduleIssues(null)} style={{background:"none",border:"none",cursor:"pointer",fontSize:14,color:t.textDim,padding:"0 4px"}}>✕</button>
          </div>
          {scheduleIssues.length>0&&(
            <div style={{padding:"8px 14px",display:"flex",flexDirection:"column",gap:4,maxHeight:200,overflowY:"auto"}}>
              {scheduleIssues.map((issue,i)=>(
                <div key={i} style={{fontSize:11,display:"flex",alignItems:"flex-start",gap:6}}>
                  <span style={{flexShrink:0,fontWeight:700,color:issue.level==="error"?t.danger:t.warning}}>{issue.level==="error"?"✗":"ℹ"}</span>
                  <span style={{color:t.text}}>{issue.msg}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Daily totals bar */}
      {Object.values(schedule||{}).some(a=>a.length>0)&&(
        <div style={{display:"grid",gridTemplateColumns:"100px repeat(7,1fr)",gap:2,marginTop:4,marginBottom:4}}>
          <div style={{padding:"4px 8px",fontSize:9,fontWeight:700,color:t.textDim,letterSpacing:".06em",display:"flex",alignItems:"center"}}>DAILY</div>
          {DAYS.map(day=>{
            const totals=SHIFTS.map(shift=>{
              const a=getAsgn(day,shift.id); const need=getEffectiveSlotCount(day,shift.id,extShifts);
              return{ok:a.length>=need&&getStatus(day,shift.id).ok,gap:a.length<need,bodies:a.length,need};
            });
            const anyGap=totals.some(x=>x.gap),allOk=totals.every(x=>x.ok);
            const col=anyGap?t.danger:allOk?t.scale:t.warning;
            return(
              <div key={day} style={{padding:"3px 6px",borderRadius:3,textAlign:"center",background:col+"14",border:"1px solid "+col+"40"}}>
                <span style={{fontSize:9,fontWeight:800,color:col}}>{totals.reduce((s,x)=>s+x.bodies,0)}/{totals.reduce((s,x)=>s+x.need,0)}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Action bar */}
      <div style={{display:"flex",gap:12,marginTop:20,flexWrap:"wrap",alignItems:"center"}}>
        {!isReadOnly&&<>
          <button onClick={()=>runAutoFill()} style={{background:t.scale,color:"#fff",border:"none",padding:"10px 20px",borderRadius:6,cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"inherit"}}>⚡ AUTO-FILL</button>
          <button onClick={()=>{setSchedule({});setExtShifts([]);setEmpPatterns({});setScheduleIssues(null);setScheduleStale(false);}} style={{background:"transparent",color:t.danger,border:"1px solid "+t.danger,padding:"10px 20px",borderRadius:6,cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"inherit"}}>CLEAR</button>
          <button onClick={()=>setShowPopout(true)} style={{background:"transparent",color:t.textMuted,border:"1px solid "+t.border,padding:"10px 20px",borderRadius:6,cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"inherit"}}>⛶ Pop-out</button>
        </>}
        {!isReadOnly&&(showHistSave?(
          <div style={{display:"flex",gap:6,alignItems:"center",background:t.surfaceAlt,border:"1px solid "+t.warning,borderRadius:6,padding:"4px 10px"}}>
            <span style={{fontSize:11,color:t.warning,fontWeight:700}}>★</span>
            <input value={histSaveLabel} onChange={e=>setHistSaveLabel(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter"&&histSaveLabel.trim()){const{violations,blocked}=enforceBusinessRules(schedule,employees,extShifts||[]);if(blocked){setEnforcementBlock({violations});setShowHistSave(false);setHistSaveLabel("");return;}manualSaveToHistory(histSaveLabel,weekStart,schedule);setHistSaveLabel("");setShowHistSave(false);}if(e.key==="Escape"){setShowHistSave(false);setHistSaveLabel("");}}}
              placeholder="Name this snapshot…" autoFocus
              style={{background:"transparent",border:"none",color:t.text,fontSize:12,fontFamily:"inherit",outline:"none",width:180}}/>
            <button onClick={()=>{const{violations,blocked}=enforceBusinessRules(schedule,employees,extShifts||[]);if(blocked){setEnforcementBlock({violations});setShowHistSave(false);setHistSaveLabel("");return;}if(histSaveLabel.trim())manualSaveToHistory(histSaveLabel,weekStart,schedule);setHistSaveLabel("");setShowHistSave(false);}} style={{background:t.warning,color:"#000",border:"none",padding:"4px 10px",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>SAVE</button>
            <button onClick={()=>{setShowHistSave(false);setHistSaveLabel("");}} style={{background:"transparent",border:"none",color:t.textDim,cursor:"pointer",fontSize:13,padding:"2px 4px"}}>✕</button>
          </div>
        ):(
          <button onClick={()=>setShowHistSave(true)} style={{background:"transparent",color:t.warning,border:"1px solid "+t.warning+"55",padding:"10px 20px",borderRadius:6,cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"inherit"}}>★ Save Snapshot</button>
        ))}
        <button onClick={()=>{const{violations,blocked}=enforceBusinessRules(schedule,employees,extShifts||[]);if(blocked){setEnforcementBlock({violations});return;}setShowPublish(true);}} style={{background:"transparent",color:t.accent,border:"1px solid "+t.accent+"55",padding:"10px 20px",borderRadius:6,cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"inherit"}}>📋 Publish</button>
        {!isReadOnly&&<button onClick={onOpenTestModal} style={{background:"transparent",color:t.accent,border:"1px solid "+t.accent+"55",padding:"10px 20px",borderRadius:6,cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"inherit",marginLeft:"auto"}}>🧪 New Test Roster</button>}
        {isReadOnly&&<button onClick={()=>setViewingHistory(null)} style={{background:t.warning,color:"#000",border:"none",padding:"10px 20px",borderRadius:6,cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"inherit",marginLeft:"auto"}}>↩ Back to Live Schedule</button>}
      </div>

      {/* Modals */}
      {enforcementBlock&&<EnforcementBlockModal violations={enforcementBlock.violations} onClose={()=>setEnforcementBlock(null)}/>}
      {overtimeItems&&<OvertimeModal items={overtimeItems} onApprove={handleOvertimeApproval} onCancel={()=>{setOvertimeItems(null);setPendingSchedule(null);}}/>}
      {showPopout&&<SchedulePopout schedule={displaySchedule} extShifts={extShifts||[]} employees={employees} weekStart={weekStart} onClose={()=>setShowPopout(false)}/>}

      {/* Publish modal */}
      {showPublish&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",display:"flex",alignItems:"flex-start",justifyContent:"center",zIndex:1200,padding:20,overflowY:"auto"}} onClick={e=>{if(e.target===e.currentTarget)setShowPublish(false);}}>
          <div style={{background:"#fff",color:"#111",borderRadius:8,padding:28,width:"100%",maxWidth:860,boxShadow:"0 8px 40px rgba(0,0,0,.3)",marginTop:20}}>
            <div style={{display:"flex",alignItems:"center",marginBottom:16,gap:12}}>
              <div style={{flex:1}}>
                <div style={{fontSize:16,fontWeight:800,color:"#111"}}>WEEKLY SCHEDULE</div>
                <div style={{fontSize:11,color:"#555",marginTop:2}}>Week of {weekStart}</div>
              </div>
              <button onClick={()=>window.print()} style={{background:"#111",color:"#fff",border:"none",padding:"8px 18px",borderRadius:5,cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>🖨 Print</button>
              <button onClick={()=>setShowPublish(false)} style={{background:"transparent",border:"1px solid #ccc",color:"#555",padding:"7px 14px",borderRadius:5,cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>✕ Close</button>
            </div>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead>
                <tr style={{background:"#f3f4f6"}}>
                  <th style={{padding:"6px 10px",textAlign:"left",fontWeight:700,borderBottom:"2px solid #ddd",width:140}}>Employee</th>
                  <th style={{padding:"6px 10px",textAlign:"center",fontWeight:700,borderBottom:"2px solid #ddd",width:60}}>Shift</th>
                  {DAYS.map(d=><th key={d} style={{padding:"6px 6px",textAlign:"center",fontWeight:700,borderBottom:"2px solid #ddd"}}>{d.substring(0,3)}</th>)}
                  <th style={{padding:"6px 10px",textAlign:"center",fontWeight:700,borderBottom:"2px solid #ddd"}}>Hrs</th>
                </tr>
              </thead>
              <tbody>
                {SHIFTS.map((shift,si)=>{
                  const shiftEmps=employees.filter(e=>e.requiredShift===shift.id||(e.preferredShifts||[]).includes(shift.id)).sort((a,b)=>a.name.localeCompare(b.name));
                  const colors=[["#fef3c7","#92400e"],["#dbeafe","#1e40af"],["#ede9fe","#5b21b6"]];
                  return[
                    <tr key={"hdr"+shift.id}><td colSpan={10} style={{background:colors[si][0],padding:"4px 10px",fontWeight:800,fontSize:10,letterSpacing:".08em",color:colors[si][1],borderTop:"1px solid #ddd"}}>{shift.label.toUpperCase()} — {shift.time}</td></tr>,
                    ...shiftEmps.map(emp=>{
                      const hrs=calcHours(emp.id,displaySchedule,extShifts);
                      const hrsCol=hrs>=48?"#dc2626":hrs>=40?"#16a34a":hrs>0?"#d97706":"#9ca3af";
                      return(
                        <tr key={emp.id} style={{borderBottom:"1px solid #f3f4f6"}}>
                          <td style={{padding:"5px 10px",fontWeight:600}}>{emp.name}</td>
                          <td style={{padding:"5px 6px",textAlign:"center",fontSize:9,fontWeight:700,color:colors[si][1]}}>{{first:"1st",second:"2nd",third:"3rd"}[shift.id]}</td>
                          {DAYS.map(day=>{const da=(displaySchedule[cellKey(day,shift.id)]||[]).find(a=>a.employeeId===emp.id);return(<td key={day} style={{padding:"5px 4px",textAlign:"center",background:da?"#dcfce7":"transparent",color:da?"#166534":"#d1d5db",fontWeight:da?700:400,fontSize:da?10:9}}>{da?da.position.substring(0,3).toUpperCase():"·"}</td>);})}
                          <td style={{padding:"5px 10px",textAlign:"center",fontWeight:700,color:hrsCol,fontSize:11}}>{hrs>0?hrs+"h":"—"}</td>
                        </tr>
                      );
                    })
                  ];
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
