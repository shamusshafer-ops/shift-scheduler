import { useState, useMemo, useCallback } from "react";
import { useTheme } from "../../context/ThemeContext.jsx";
import { useSettings } from "../../context/SettingsContext.jsx";
import {
  DAYS, SHIFTS, EXT_PAIRS, FT_MIN_HOURS, SHIFT_HOURS, EXT_SHIFT_HOURS,
  MAX_CONSECUTIVE_HOURS, MIN_REST_HOURS, MAX_CONSECUTIVE_NIGHTS,
  cellKey, getSlotCount, getAvailPos,
} from "../../constants/index.js";
import { positionColor } from "../../constants/themes.js";
import {
  calcHours, calcRestGap, calcConsecutiveHours, calcConsecutiveNights,
  getFatigueIssues, slotIndex, empMaxConsec, isRestViolation,
} from "../../utils/hours.js";
import { slotHasRole, extCovers } from "../../utils/validation.js";
import { getEffectiveSlotCount, canWorkExtHalf } from "../../utils/extShifts.js";

const OT_RELIEF_THRESHOLD = 48;

// ── Utility functions ─────────────────────────────────────────────────────────
function weekRangeLabel(weekStart) {
  const [wy,wm,wd] = weekStart.split("-").map(Number);
  const sun = new Date(wy,wm-1,wd,12);
  const sat = new Date(wy,wm-1,wd+6,12);
  const fmt = d => (d.getMonth()+1)+"/"+d.getDate();
  return fmt(sun)+" – "+fmt(sat);
}

function computeWeekStats(schedule, employees, extShiftsArg=[]) {
  const totalSlots = DAYS.reduce((n,d)=>SHIFTS.reduce((m,s)=>m+(d==="Saturday"||d==="Sunday"?3:s.id==="first"?4:3),n),0);
  let totalOk=0,totalEmpty=0,totalMissingRole=0,totalOTHours=0,underHoursFT=0;
  const empHours={};
  employees.forEach(e=>{empHours[e.id]=0;});
  DAYS.forEach(day=>SHIFTS.forEach(shift=>{
    const asgn=schedule[cellKey(day,shift.id)]||[];
    asgn.forEach(a=>{if(empHours[a.employeeId]!==undefined) empHours[a.employeeId]+=SHIFT_HOURS;});
    const cellExt=(extShiftsArg||[]).filter(e=>extCovers(e,day,shift.id));
    const extScale=cellExt.some(e=>(e.roles||[]).includes("Scale"));
    const extMedical=cellExt.some(e=>(e.roles||[]).includes("Medical"));
    const hasScale=slotHasRole(asgn,employees,"Scale")||extScale;
    const hasMed=slotHasRole(asgn,employees,"Medical")||extMedical;
    const max=getSlotCount(day,shift.id);
    const extFilled=cellExt.length*2;
    const effFilled=Math.min(asgn.length+extFilled,max);
    if(!asgn.length&&!extFilled) totalEmpty++;
    else if(!hasScale||!hasMed) totalMissingRole++;
    else if(effFilled===max) totalOk++;
  }));
  employees.forEach(e=>{
    const h=empHours[e.id]||0;
    if(e.employmentType==="full-time"&&h>40) totalOTHours+=h-40;
    if(e.employmentType==="full-time"&&h<40) underHoursFT++;
  });
  const totalViolations=0; // simplified — full violations need schedule context
  const coveragePct=totalSlots>0?Math.round((totalOk/totalSlots)*100):0;
  return{coveragePct,totalEmpty,totalMissingRole,totalOTHours,underHoursFT,totalViolations,totalOk,totalSlots};
}

// ── findOTReliefSuggestions ───────────────────────────────────────────────────
function findOTReliefSuggestions(employees, schedule, extShifts, cfg) {
  const suggestions=[];
  const hoursMap={};
  employees.forEach(e=>{hoursMap[e.id]=calcHours(e.id,schedule,extShifts);});
  const overloaded=employees.filter(e=>e.employmentType==="full-time"&&hoursMap[e.id]>OT_RELIEF_THRESHOLD);

  for(const overEmp of overloaded){
    for(const day of DAYS){
      for(const shift of SHIFTS){
        const key=cellKey(day,shift.id);
        const asgn=schedule[key]||[];
        const myAsgn=asgn.find(a=>a.employeeId===overEmp.id); if(!myAsgn) continue;
        const coveringPair=EXT_PAIRS.find(p=>p.covers.includes(shift.id)); if(!coveringPair) continue;
        if((extShifts||[]).some(e=>e.day===day&&e.pairId===coveringPair.id)) continue;
        const candidates=employees.filter(c=>{
          if(c.id===overEmp.id) return false;
          if((c.unavailableDays||[]).includes(day)) return false;
          if((c.blockedShifts||[]).includes(shift.id)) return false;
          if(c.requiredShift&&c.requiredShift!==shift.id) return false;
          if(!canWorkExtHalf(c,coveringPair.id,0)||!canWorkExtHalf(c,coveringPair.id,1)) return false;
          if(!getAvailPos(day,shift.id).some(p=>c.qualifications.includes(p))) return false;
          if(hoursMap[c.id]+EXT_SHIFT_HOURS>56) return false;
          if(calcConsecutiveHours(c.id,schedule,day,shift.id)>empMaxConsec(c)) return false;
          return true;
        });
        for(let i=0;i<candidates.length;i++){
          for(let j=i+1;j<candidates.length;j++){
            const cA=candidates[i],cB=candidates[j];
            const needsScale=(myAsgn.position==="Scale");
            const needsMedical=(myAsgn.position==="Medical");
            if(needsScale&&!cA.qualifications.includes("Scale")&&!cB.qualifications.includes("Scale")) continue;
            if(needsMedical&&!cA.qualifications.includes("Medical")&&!cB.qualifications.includes("Medical")) continue;
            const aHoursAfter=hoursMap[cA.id]+EXT_SHIFT_HOURS;
            const bHoursAfter=hoursMap[cB.id]+EXT_SHIFT_HOURS;
            const overHoursAfter=hoursMap[overEmp.id]-SHIFT_HOURS;
            const otBefore=Math.max(0,hoursMap[overEmp.id]-FT_MIN_HOURS)+Math.max(0,hoursMap[cA.id]-FT_MIN_HOURS)+Math.max(0,hoursMap[cB.id]-FT_MIN_HOURS);
            const otAfter=Math.max(0,overHoursAfter-FT_MIN_HOURS)+Math.max(0,aHoursAfter-FT_MIN_HOURS)+Math.max(0,bHoursAfter-FT_MIN_HOURS);
            const otReduction=otBefore-otAfter; if(otReduction<=0) continue;
            suggestions.push({overEmp,day,shift,pairId:coveringPair.id,pair:coveringPair,empA:cA,empB:cB,overHoursBefore:hoursMap[overEmp.id],overHoursAfter,aHoursBefore:hoursMap[cA.id],aHoursAfter,bHoursBefore:hoursMap[cB.id],bHoursAfter,otReduction,myAsgn});
            if(suggestions.length>=20) break;
          }
          if(suggestions.length>=20) break;
        }
      }
    }
  }
  suggestions.sort((a,b)=>b.otReduction-a.otReduction);
  return suggestions;
}

// ── OTReliefPanel ─────────────────────────────────────────────────────────────
function OTReliefPanel({ otReliefSuggestions, employees, schedule, extShifts, setSchedule, setExtShifts, cfg, t }) {
  const [expanded, setExpanded] = useState(false);
  if(!otReliefSuggestions||!otReliefSuggestions.length) return null;
  return(
    <div style={{background:t.surface,border:"1px solid "+t.warning+"60",borderRadius:8,padding:16,marginBottom:20}}>
      <div onClick={()=>setExpanded(e=>!e)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}}>
        <div style={{fontSize:11,fontWeight:700,color:t.warning,letterSpacing:".06em"}}>
          OT RELIEF SUGGESTIONS
          <span style={{marginLeft:8,background:t.warning,color:"#000",fontSize:9,fontWeight:800,padding:"1px 7px",borderRadius:10}}>{otReliefSuggestions.length}</span>
        </div>
        <span style={{color:t.textDim,fontSize:12}}>{expanded?"▲":"▼"}</span>
      </div>
      {expanded&&(
        <div style={{marginTop:12,display:"flex",flexDirection:"column",gap:8}}>
          {otReliefSuggestions.slice(0,5).map((s,i)=>(
            <div key={i} style={{padding:"10px 12px",background:t.warning+"0a",border:"1px solid "+t.warning+"30",borderRadius:6}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                <div style={{fontSize:11,fontWeight:700,color:t.text}}>
                  Replace <span style={{color:t.warning}}>{s.overEmp.name}</span> on {s.day} {s.shift.label} with 12hr pair
                </div>
                <span style={{fontSize:10,fontWeight:700,color:t.scale}}>-{s.otReduction}h OT</span>
              </div>
              <div style={{fontSize:10,color:t.textDim,marginBottom:8}}>
                {s.empA.name} + {s.empB.name} · {s.overEmp.name}: {s.overHoursBefore}h → {s.overHoursAfter}h
              </div>
              <button onClick={()=>{
                setSchedule(prev=>{const next=JSON.parse(JSON.stringify(prev));const key=cellKey(s.day,s.shift.id);next[key]=(next[key]||[]).filter(a=>a.employeeId!==s.overEmp.id);return next;});
                setExtShifts(prev=>[...(prev||[]),{pairId:s.pairId,day:s.day,empAId:s.empA.id,empBId:s.empB.id,roles:[s.empA,s.empB].flatMap(e=>["Scale","Medical"].filter(r=>e.qualifications.includes(r))),approvedAt:new Date().toLocaleDateString(),otRelief:true,relievedEmpId:s.overEmp.id}]);
              }} style={{background:t.warning,color:"#000",border:"none",padding:"5px 12px",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>
                ⚡ Apply
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── CoverageDashboard ─────────────────────────────────────────────────────────
export function CoverageDashboard({ employees, schedule, setSchedule, extShifts, setExtShifts, history, navigateToWeek, setActiveTab }) {
  const { theme: t } = useTheme();
  const { settings: cfg } = useSettings();
  const [quickFilling, setQuickFilling] = useState(null);

  const analysis = useMemo(() => {
    const gaps=[]; const empStats={};
    employees.forEach(e=>{empStats[e.id]={emp:e,hours:0,shifts:0,nights:0,fatigueIssues:getFatigueIssues(e.id,schedule,cfg,employees).length};});
    let totalEmpty=0,totalMissingRole=0,totalPartial=0,totalOk=0;
    DAYS.forEach(day=>SHIFTS.forEach(shift=>{
      const asgn=schedule[cellKey(day,shift.id)]||[];
      const max=getSlotCount(day,shift.id);
      asgn.forEach(a=>{if(empStats[a.employeeId]){empStats[a.employeeId].hours+=SHIFT_HOURS;empStats[a.employeeId].shifts++;if(shift.id==="third") empStats[a.employeeId].nights++;}});
      const cellExt=(extShifts||[]).filter(e=>extCovers(e,day,shift.id));
      const extScale=cellExt.some(e=>(e.roles||[]).includes("Scale"));
      const extMedical=cellExt.some(e=>(e.roles||[]).includes("Medical"));
      const extFilled=cellExt.length*2;
      const effFilled=Math.min(asgn.length+extFilled,max);
      const effHasScale=slotHasRole(asgn,employees,"Scale")||extScale;
      const effHasMed=slotHasRole(asgn,employees,"Medical")||extMedical;
      const effOpen=max-effFilled;
      if(!effFilled){totalEmpty++;gaps.push({day,shiftId:shift.id,type:"empty",severity:3,label:"Completely unstaffed",openSlots:max,hasScale:effHasScale,hasMed:effHasMed,missingRoles:["Scale","Medical"]});}
      else{
        const missing=[...(!effHasScale?["Scale"]:[]),...(!effHasMed?["Medical"]:[])];
        if(missing.length){totalMissingRole++;gaps.push({day,shiftId:shift.id,type:"missing_role",severity:2,label:`Missing: ${missing.join(" & ")}`,openSlots:effOpen,hasScale:effHasScale,hasMed:effHasMed,missingRoles:missing});}
        else if(effFilled<max){totalPartial++;gaps.push({day,shiftId:shift.id,type:"partial",severity:1,label:`${effOpen} open slot${effOpen>1?"s":""}`,openSlots:effOpen,missingRoles:[]});}
        else totalOk++;
      }
    }));
    gaps.sort((a,b)=>b.severity-a.severity||slotIndex(a.day,a.shiftId)-slotIndex(b.day,b.shiftId));
    const ftUnderHours=employees.filter(e=>e.employmentType==="full-time"&&(empStats[e.id]?.hours||0)<FT_MIN_HOURS);
    const overtimeEmps=employees.filter(e=>(empStats[e.id]?.hours||0)>FT_MIN_HOURS).map(e=>({emp:e,hours:empStats[e.id].hours,ot:empStats[e.id].hours-FT_MIN_HOURS})).sort((a,b)=>b.ot-a.ot);
    const totalOTHours=overtimeEmps.reduce((s,x)=>s+x.ot,0);
    const totalSlots=DAYS.reduce((s,d)=>s+SHIFTS.reduce((ss,sh)=>ss+getSlotCount(d,sh.id),0),0);
    const shiftsPerFT=FT_MIN_HOURS/SHIFT_HOURS;
    const idealFTTotal=Math.ceil(totalSlots/shiftsPerFT);
    const scaleSlots=DAYS.length*SHIFTS.length;
    const idealMinScale=Math.ceil(scaleSlots/shiftsPerFT);
    const idealMinMedical=Math.ceil(scaleSlots/shiftsPerFT);
    const currFT=employees.filter(e=>e.employmentType==="full-time");
    const currScale=currFT.filter(e=>e.qualifications.includes("Scale")).length;
    const currMedical=currFT.filter(e=>e.qualifications.includes("Medical")).length;
    const currGuardOnly=currFT.filter(e=>!e.qualifications.includes("Scale")&&!e.qualifications.includes("Medical")).length;
    const idealGuardOnly=Math.max(0,idealFTTotal-Math.max(idealMinScale,idealMinMedical));
    const idealModel={totalSlots,shiftsPerFT,idealFTTotal,roles:[{role:"Scale",ideal:idealMinScale,current:currScale,note:""},{role:"Medical",ideal:idealMinMedical,current:currMedical,note:""},{role:"Guard-only",ideal:idealGuardOnly,current:currGuardOnly,note:""}],currFTTotal:currFT.length,ftGap:idealFTTotal-currFT.length};
    return{gaps,empStats,totalEmpty,totalMissingRole,totalPartial,totalOk,ftUnderHours,totalShifts:DAYS.length*SHIFTS.length,overtimeEmps,totalOTHours,idealModel};
  },[employees,schedule,extShifts,cfg]);

  const otReliefSuggestions=useMemo(()=>findOTReliefSuggestions(employees,schedule,extShifts,cfg),[employees,schedule,extShifts,cfg]);

  const historyStats=useMemo(()=>{
    if(!history||!history.length) return [];
    const byWeek={};
    [...history].sort((a,b)=>a.savedAt.localeCompare(b.savedAt)).forEach(h=>{if(!byWeek[h.weekStart]||!h.isAutoSave) byWeek[h.weekStart]=h;});
    return Object.values(byWeek).sort((a,b)=>a.weekStart.localeCompare(b.weekStart)).map(h=>({weekStart:h.weekStart,label:weekRangeLabel(h.weekStart),isNamed:!h.isAutoSave,snapshotLabel:h.label,...computeWeekStats(h.schedule,employees,h.extShifts||[])}));
  },[history,employees]);

  const quickFill=useCallback((day,shiftId,neededRole)=>{
    setQuickFilling({day,shiftId});
    const key=cellKey(day,shiftId);
    const cur=schedule[key]||[];
    const max=getEffectiveSlotCount(day,shiftId,extShifts);
    if(cur.length>=max){setQuickFilling(null);return;}
    const usedIds=new Set(cur.map(a=>a.employeeId));
    const avail=getAvailPos(day,shiftId);
    const candidates=employees.filter(e=>{
      if(usedIds.has(e.id)) return false;
      if((e.unavailableDays||[]).includes(day)) return false;
      if(isRestViolation(e,calcRestGap(e.id,schedule,day,shiftId),cfg?.minRestHours??MIN_REST_HOURS)) return false;
      if(calcConsecutiveHours(e.id,schedule,day,shiftId)>empMaxConsec(e)) return false;
      if(shiftId==="third"&&calcConsecutiveNights(e.id,schedule,day,shiftId)>=(cfg?.maxConsecutiveNights??MAX_CONSECUTIVE_NIGHTS)) return false;
      return avail.some(p=>e.qualifications.includes(p));
    }).map(e=>{
      const qualPos=avail.filter(p=>e.qualifications.includes(p));
      const fillsNeeded=neededRole&&qualPos.includes(neededRole);
      const hours=calcHours(e.id,schedule,extShifts);
      const underHours=e.employmentType==="full-time"&&hours<FT_MIN_HOURS;
      return{emp:e,pos:fillsNeeded?neededRole:(qualPos.includes("Guard")?"Guard":qualPos[0]),score:(fillsNeeded?100:0)+(underHours?10:0)-(hours/8)};
    }).sort((a,b)=>b.score-a.score);
    if(candidates.length){const{emp,pos}=candidates[0];setSchedule(p=>({...p,[key]:[...(p[key]||[]),{employeeId:emp.id,position:pos}]}));}
    setTimeout(()=>setQuickFilling(null),600);
  },[employees,schedule,setSchedule,extShifts,cfg]);

  const sevColor=(s)=>s===3?t.danger:s===2?t.warning:t.accent;
  const sevLabel=(s)=>s===3?"EMPTY":s===2?"ROLE GAP":"PARTIAL";
  const scoreColor=(pct)=>pct>=1?t.scale:pct>=.75?t.accent:pct>=.5?t.warning:t.danger;
  const pC=(p)=>positionColor(p,t);
  const coveragePct=analysis.totalShifts>0?analysis.totalOk/analysis.totalShifts:0;
  const totalFatigue=employees.filter(e=>(analysis.empStats[e.id]?.fatigueIssues||0)>0).length;

  const cards=[
    {label:"COVERAGE SCORE",icon:"◉",value:`${Math.round(coveragePct*100)}%`,sub:`${analysis.totalOk} / ${analysis.totalShifts} shifts fully staffed`,color:scoreColor(coveragePct)},
    {label:"OPEN ISSUES",icon:"⚠",value:analysis.gaps.length,sub:`${analysis.totalEmpty} empty · ${analysis.totalMissingRole} role gap · ${analysis.totalPartial} partial`,color:analysis.gaps.length===0?t.scale:analysis.totalEmpty>0?t.danger:t.warning},
    {label:"FATIGUE RISK",icon:"◑",value:totalFatigue,sub:totalFatigue===0?"No fatigue warnings this week":`${totalFatigue} staff with scheduling concerns`,color:totalFatigue===0?t.scale:t.fatigue},
    {label:"HOURS COMPLIANCE",icon:"◷",value:analysis.ftUnderHours.length===0?"✓":`${analysis.ftUnderHours.length} FT`,sub:analysis.ftUnderHours.length===0?"All FT staff at 40h target":`Under 40h: ${analysis.ftUnderHours.map(e=>e.name.split(" ")[0]).join(", ")}`,color:analysis.ftUnderHours.length===0?t.scale:t.danger},
    {label:"OVERTIME THIS WEEK",icon:"⏱",value:analysis.totalOTHours===0?"–":`+${analysis.totalOTHours}h`,sub:analysis.overtimeEmps.length===0?"No overtime scheduled":`${analysis.overtimeEmps.length} staff`,color:analysis.totalOTHours===0?t.scale:analysis.totalOTHours>16?t.danger:t.warning},
  ];

  return (
    <div>
      {/* Summary cards */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:12,marginBottom:24}}>
        {cards.map(card=>(
          <div key={card.label} style={{background:t.surface,border:"1px solid "+card.color+"40",borderRadius:8,padding:"16px 20px",position:"relative",overflow:"hidden"}}>
            <div style={{position:"absolute",top:10,right:14,fontSize:32,opacity:.07,color:card.color,fontWeight:900,userSelect:"none"}}>{card.icon}</div>
            <div style={{fontSize:9,color:t.textDim,fontWeight:700,letterSpacing:".1em",marginBottom:6}}>{card.label}</div>
            <div style={{fontSize:30,fontWeight:800,color:card.color,lineHeight:1,marginBottom:4}}>{card.value}</div>
            <div style={{fontSize:10,color:t.textMuted,lineHeight:1.4}}>{card.sub}</div>
          </div>
        ))}
      </div>

      {/* OT Relief */}
      <OTReliefPanel otReliefSuggestions={otReliefSuggestions} employees={employees} schedule={schedule} extShifts={extShifts||[]} setSchedule={setSchedule} setExtShifts={setExtShifts} cfg={cfg} t={t}/>

      {/* Main content grid */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 320px",gap:20,alignItems:"start"}}>
        <div>
          {/* Overtime tally */}
          {analysis.overtimeEmps.length>0&&(
            <div style={{background:t.surface,border:"1px solid "+t.warning+"60",borderRadius:8,padding:18,marginBottom:12}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
                <div style={{fontSize:11,fontWeight:700,color:t.warning,letterSpacing:".06em"}}>
                  OVERTIME TALLY
                  <span style={{marginLeft:8,background:t.warning,color:"#000",fontSize:9,fontWeight:800,padding:"1px 7px",borderRadius:10}}>+{analysis.totalOTHours}h total</span>
                </div>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {analysis.overtimeEmps.map(({emp,hours,ot})=>(
                  <div key={emp.id} style={{display:"grid",gridTemplateColumns:"140px 48px 1fr 52px",gap:10,alignItems:"center",padding:"8px 12px",background:t.warning+"0a",border:"1px solid "+t.warning+"30",borderRadius:6}}>
                    <span style={{fontWeight:700,fontSize:12,color:t.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{emp.name}</span>
                    <span style={{fontSize:10,color:t.textMuted,textAlign:"right"}}>{hours}h / 40h</span>
                    <div style={{background:t.border,borderRadius:3,height:8,overflow:"hidden"}}>
                      <div style={{width:(Math.min(1,ot/16)*100)+"%",height:"100%",background:ot>8?t.danger:t.warning,borderRadius:3}}/>
                    </div>
                    <span style={{fontSize:11,fontWeight:800,color:ot>8?t.danger:t.warning,textAlign:"right"}}>+{ot}h OT</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Ideal staffing model */}
          <div style={{background:t.surface,border:"1px solid "+t.border,borderRadius:8,padding:18,marginBottom:12}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
              <div style={{fontSize:11,fontWeight:700,color:t.textMuted,letterSpacing:".06em"}}>
                IDEAL STAFFING MODEL
                <span style={{marginLeft:8,fontSize:10,fontWeight:400,color:t.textDim,textTransform:"none",letterSpacing:0}}>— full-time only, zero overtime</span>
              </div>
              <span style={{fontSize:10,color:t.textDim}}>{analysis.idealModel.totalSlots} slots/wk · {analysis.idealModel.shiftsPerFT} shifts/FT</span>
            </div>
            <div style={{marginBottom:16,padding:"10px 14px",background:analysis.idealModel.ftGap>0?t.danger+"0d":analysis.idealModel.ftGap<0?t.warning+"0d":t.scale+"0d",border:"1px solid "+(analysis.idealModel.ftGap>0?t.danger+"40":analysis.idealModel.ftGap<0?t.warning+"40":t.scale+"40"),borderRadius:6}}>
              <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:6}}>
                <span style={{fontSize:22,fontWeight:800,color:analysis.idealModel.ftGap>0?t.danger:analysis.idealModel.ftGap<0?t.warning:t.scale}}>{analysis.idealModel.currFTTotal}</span>
                <span style={{fontSize:13,color:t.textMuted}}>/ {analysis.idealModel.idealFTTotal} FT employees needed</span>
                {analysis.idealModel.ftGap>0&&<span style={{marginLeft:"auto",fontSize:11,fontWeight:700,color:t.danger}}>▲ {analysis.idealModel.ftGap} short</span>}
                {analysis.idealModel.ftGap<0&&<span style={{marginLeft:"auto",fontSize:11,fontWeight:700,color:t.warning}}>▼ {Math.abs(analysis.idealModel.ftGap)} over (OT likely)</span>}
                {analysis.idealModel.ftGap===0&&<span style={{marginLeft:"auto",fontSize:11,fontWeight:700,color:t.scale}}>✓ Exact</span>}
              </div>
              <div style={{background:t.border,borderRadius:4,height:10,overflow:"hidden"}}>
                <div style={{width:Math.min(100,(analysis.idealModel.currFTTotal/analysis.idealModel.idealFTTotal)*100)+"%",height:"100%",borderRadius:4,background:analysis.idealModel.ftGap>0?t.danger:analysis.idealModel.ftGap<0?t.warning:t.scale}}/>
              </div>
            </div>
            <div style={{fontSize:10,color:t.textDim,fontWeight:700,letterSpacing:".05em",marginBottom:8}}>QUALIFICATION BREAKDOWN</div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {analysis.idealModel.roles.map(({role,ideal,current})=>{
                const gap=ideal-current;const ok=gap<=0;
                const barPct=ideal>0?Math.min(1,current/ideal):1;
                const col=ok?t.scale:current===0?t.danger:t.warning;
                return(
                  <div key={role} style={{display:"grid",gridTemplateColumns:"110px 36px 36px 1fr 80px",gap:8,alignItems:"center",padding:"8px 10px",background:ok?t.scale+"08":t.surfaceAlt,border:"1px solid "+(ok?t.scale+"30":gap>2?t.danger+"40":t.warning+"40"),borderRadius:5}}>
                    <span style={{display:"flex",alignItems:"center",gap:5,fontSize:11,fontWeight:700,color:t.text}}>
                      <span style={{width:8,height:8,borderRadius:"50%",flexShrink:0,background:pC(role==="Guard-only"?"Guard":role)}}/>
                      {role}
                    </span>
                    <span style={{fontSize:12,fontWeight:800,color:col,textAlign:"center"}}>{current}</span>
                    <span style={{fontSize:11,color:t.textDim,textAlign:"center"}}>/ {ideal}</span>
                    <div style={{background:t.border,borderRadius:3,height:7,overflow:"hidden"}}>
                      <div style={{width:(barPct*100)+"%",height:"100%",borderRadius:3,background:col}}/>
                    </div>
                    <span style={{fontSize:10,fontWeight:700,textAlign:"right",color:ok?t.scale:gap>2?t.danger:t.warning}}>
                      {ok?(gap===0?"✓ exact":`✓ +${Math.abs(gap)} extra`):`▲ need ${gap} more`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Coverage issues */}
          <div style={{background:t.surface,border:"1px solid "+t.border,borderRadius:8,padding:18}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
              <div style={{fontSize:11,fontWeight:700,color:t.textMuted,letterSpacing:".06em"}}>
                COVERAGE ISSUES
                <span style={{marginLeft:8,background:analysis.gaps.length===0?t.scale:t.danger,color:"#fff",fontSize:9,fontWeight:800,padding:"1px 7px",borderRadius:10}}>{analysis.gaps.length}</span>
              </div>
            </div>
            {analysis.gaps.length===0?(
              <div style={{textAlign:"center",padding:"28px 0",color:t.textDim}}>
                <div style={{fontSize:28,marginBottom:8,color:t.scale}}>✓</div>
                <div style={{fontSize:13,color:t.scale,fontWeight:700}}>Perfect coverage this week</div>
                <div style={{fontSize:11,marginTop:4}}>Every shift is fully staffed with required roles.</div>
              </div>
            ):(
              <div style={{display:"flex",flexDirection:"column",gap:4}}>
                {analysis.gaps.map((gap,i)=>{
                  const sc=sevColor(gap.severity);
                  const shiftObj=SHIFTS.find(s=>s.id===gap.shiftId);
                  const isFilling=quickFilling?.day===gap.day&&quickFilling?.shiftId===gap.shiftId;
                  const qfRole=gap.missingRoles[0]||null;
                  const canQF=gap.openSlots>0&&employees.some(e=>{
                    if((e.unavailableDays||[]).includes(gap.day)) return false;
                    if(isRestViolation(e,calcRestGap(e.id,schedule,gap.day,gap.shiftId),cfg?.minRestHours??MIN_REST_HOURS)) return false;
                    if(calcConsecutiveHours(e.id,schedule,gap.day,gap.shiftId)>empMaxConsec(e)) return false;
                    if((schedule[cellKey(gap.day,gap.shiftId)]||[]).some(a=>a.employeeId===e.id)) return false;
                    return getAvailPos(gap.day,gap.shiftId).some(p=>e.qualifications.includes(p));
                  });
                  return(
                    <div key={i} style={{display:"grid",gridTemplateColumns:"68px 56px 1fr 1fr auto",gap:8,alignItems:"center",padding:"9px 10px",borderRadius:6,background:isFilling?t.scale+"18":sc+"08",border:"1px solid "+(isFilling?t.scale+"50":sc+"30"),transition:"all .2s"}}>
                      <span style={{fontSize:8,fontWeight:800,padding:"2px 5px",borderRadius:3,textAlign:"center",background:sc+"22",border:"1px solid "+sc+"45",color:sc,letterSpacing:".04em"}}>{sevLabel(gap.severity)}</span>
                      <span style={{fontSize:11,fontWeight:700,color:t.text}}>{gap.day.substring(0,3)}</span>
                      <div>
                        <div style={{fontSize:11,fontWeight:700,color:t.text}}>{shiftObj?.label}</div>
                        <div style={{fontSize:9,color:t.textDim}}>{shiftObj?.time}</div>
                      </div>
                      <div>
                        <div style={{fontSize:11,color:sc,fontWeight:600}}>{gap.label}</div>
                        <div style={{fontSize:9,color:t.textDim,marginTop:2,display:"flex",gap:4}}>
                          {gap.missingRoles.map(r=><span key={r} style={{color:pC(r),fontWeight:700}}>{r}</span>)}
                          {gap.openSlots>0&&<span>{gap.openSlots} slot{gap.openSlots!==1?"s":""} open</span>}
                        </div>
                      </div>
                      <div style={{display:"flex",gap:5,justifyContent:"flex-end"}}>
                        {canQF&&<button onClick={()=>quickFill(gap.day,gap.shiftId,qfRole)} disabled={!!isFilling} style={{fontSize:10,fontWeight:700,padding:"5px 10px",borderRadius:4,background:isFilling?t.scale:sc,color:"#fff",border:"none",cursor:isFilling?"default":"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>{isFilling?"✓ Filled":"⚡ Quick-fill"}</button>}
                        <button onClick={()=>setActiveTab("schedule",{day:gap.day,shiftId:gap.shiftId})} style={{fontSize:10,fontWeight:600,padding:"5px 10px",borderRadius:4,background:"transparent",color:t.textMuted,border:"1px solid "+t.border,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>Go →</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Employee utilization sidebar */}
        <div style={{background:t.surface,border:"1px solid "+t.border,borderRadius:8,padding:18}}>
          <div style={{fontSize:11,fontWeight:700,color:t.textMuted,letterSpacing:".06em",marginBottom:14}}>EMPLOYEE UTILIZATION</div>
          {employees.length===0?(
            <div style={{textAlign:"center",padding:"24px 0",color:t.textDim,fontSize:12}}>No employees added yet.</div>
          ):(
            <div style={{display:"flex",flexDirection:"column",gap:7}}>
              {[...employees].sort((a,b)=>{
                const aH=analysis.empStats[a.id]?.hours||0,bH=analysis.empStats[b.id]?.hours||0;
                const aU=a.employmentType==="full-time"&&aH<40,bU=b.employmentType==="full-time"&&bH<40;
                if(aU&&!bU) return -1; if(!aU&&bU) return 1; return bH-aH;
              }).map(emp=>{
                const stats=analysis.empStats[emp.id]||{hours:0,shifts:0,nights:0,fatigueIssues:0};
                const isFT=emp.employmentType==="full-time";
                const isOver=isFT&&stats.hours>40,isUnder=isFT&&stats.hours<40;
                const barColor=isOver?t.warning:isUnder?t.danger:t.scale;
                return(
                  <div key={emp.id} style={{padding:"10px 12px",background:t.surfaceAlt,borderRadius:6,border:"1px solid "+(stats.fatigueIssues>0?t.fatigue+"50":isUnder?t.danger+"40":t.border)}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:isFT?6:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,minWidth:0,flex:1}}>
                        <span style={{fontSize:12,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{emp.name}</span>
                        <span style={{fontSize:8,fontWeight:700,padding:"1px 5px",borderRadius:3,flexShrink:0,background:(isFT?t.accent:emp.employmentType==="on-call"?t.warning:t.scale)+"20",color:isFT?t.accent:emp.employmentType==="on-call"?t.warning:t.scale}}>{isFT?"FT":emp.employmentType==="on-call"?"OC":"PT"}</span>
                      </div>
                      <div style={{display:"flex",gap:5,alignItems:"center",flexShrink:0}}>
                        {stats.fatigueIssues>0&&<span style={{fontSize:9,color:t.fatigue,fontWeight:800}}>⚠{stats.fatigueIssues}</span>}
                        <span style={{fontSize:13,fontWeight:800,color:isOver?t.warning:isUnder?t.danger:stats.hours===40?t.scale:t.text}}>{stats.hours}h</span>
                        {isFT&&<span style={{fontSize:9,color:t.textDim}}>/ 40h</span>}
                      </div>
                    </div>
                    {isFT&&<div style={{height:4,background:t.border,borderRadius:2,overflow:"hidden",marginBottom:5}}><div style={{height:"100%",borderRadius:2,background:barColor,width:`${Math.min((stats.hours/40)*100,100)}%`}}/></div>}
                    <div style={{display:"flex",gap:10,fontSize:9,color:t.textDim,flexWrap:"wrap",alignItems:"center"}}>
                      <span>{stats.shifts} shift{stats.shifts!==1?"s":""}</span>
                      {stats.nights>0&&<span style={{color:"#a78bfa"}}>{stats.nights}☾</span>}
                      <span style={{marginLeft:"auto",display:"flex",gap:3}}>{emp.qualifications.map(q=><span key={q} style={{width:6,height:6,borderRadius:"50%",background:pC(q),display:"inline-block"}} title={q}/>)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {employees.length>0&&(
            <div style={{marginTop:12,padding:"10px 12px",background:t.border+"22",borderRadius:6}}>
              {[["Total hours scheduled",Object.values(analysis.empStats).reduce((s,e)=>s+e.hours,0)+"h"],["FT at / above 40h",`${employees.filter(e=>e.employmentType==="full-time"&&(analysis.empStats[e.id]?.hours||0)>=40).length} / ${employees.filter(e=>e.employmentType==="full-time").length}`]].map(([label,val])=>(
                <div key={label} style={{display:"flex",justifyContent:"space-between",marginBottom:3,fontSize:10,color:t.textDim}}>
                  <span>{label}</span><span style={{color:t.text,fontWeight:700}}>{val}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
