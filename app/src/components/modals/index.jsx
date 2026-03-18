import { useState } from "react";
import { useTheme } from "../../context/ThemeContext.jsx";

// ── EnforcementBlockModal ─────────────────────────────────────────────────────
// Hard gate modal. Cannot be dismissed by clicking outside.
// Groups violations by rule, forces user to go fix issues.
export function EnforcementBlockModal({ violations, onClose }) {
  const { theme: t } = useTheme();

  const byRule = [1, 2, 3].map(r => ({
    rule: r,
    items: violations.filter(v => v.rule === r),
    label: r === 1 ? "Rule 1 — Full-Time Hours (40h minimum)"
         : r === 2 ? "Rule 2 — Minimum 3 People Per Shift"
         : "Rule 3 — Required Roles (Medic + Scale + Other)",
    icon: r === 1 ? "⏱" : r === 2 ? "👥" : "🏥",
  })).filter(g => g.items.length > 0);

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:20}}>
      <div style={{background:t.surface,border:"2px solid "+t.danger,borderRadius:10,padding:28,maxWidth:580,width:"100%",boxShadow:"0 24px 64px rgba(0,0,0,0.7)"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
          <span style={{fontSize:26}}>🚫</span>
          <div>
            <div style={{fontSize:15,fontWeight:800,color:t.danger,letterSpacing:".02em"}}>SCHEDULE BLOCKED — RULE VIOLATIONS</div>
            <div style={{fontSize:11,color:t.textMuted,marginTop:2}}>The following issues must be resolved before this schedule can be saved or published.</div>
          </div>
        </div>
        <div style={{height:1,background:t.danger+"40",margin:"14px 0"}}/>
        <div style={{display:"flex",flexDirection:"column",gap:14,maxHeight:360,overflowY:"auto"}}>
          {byRule.map(({ rule, items, label, icon }) => (
            <div key={rule}>
              <div style={{fontSize:11,fontWeight:800,color:t.danger,letterSpacing:".06em",marginBottom:6,display:"flex",alignItems:"center",gap:6}}>
                <span>{icon}</span>
                <span>{label.toUpperCase()}</span>
                <span style={{background:t.danger,color:"#fff",fontSize:9,fontWeight:800,padding:"1px 6px",borderRadius:10,marginLeft:4}}>{items.length}</span>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:4}}>
                {items.map((v, i) => (
                  <div key={i} style={{display:"flex",alignItems:"flex-start",gap:8,padding:"7px 10px",background:t.danger+"0d",borderRadius:5,border:"1px solid "+t.danger+"30",fontSize:11,color:t.text}}>
                    <span style={{color:t.danger,fontWeight:800,flexShrink:0}}>✗</span>
                    <span>{v.msg.replace(/^Rule \d+ — /, "")}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div style={{height:1,background:t.border,margin:"18px 0"}}/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{fontSize:10,color:t.textDim,maxWidth:340}}>These rules are non-negotiable. Resolve all violations before saving or publishing.</div>
          <button onClick={onClose}
            style={{background:t.danger,color:"#fff",border:"none",padding:"10px 22px",borderRadius:6,cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"inherit",flexShrink:0}}>
            ← Go Fix Issues
          </button>
        </div>
      </div>
    </div>
  );
}

// ── OvertimeModal ─────────────────────────────────────────────────────────────
export function OvertimeModal({ items, onApprove, onCancel }) {
  const { theme: t } = useTheme();
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
          {items.map(({ emp, currentHours, newHours }) => (
            <div key={emp.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",background:t.surfaceAlt,border:"1px solid "+(approved[emp.id] ? t.warning : t.border),borderRadius:6}}>
              <input type="checkbox" id={"ot_"+emp.id} checked={!!approved[emp.id]} onChange={() => toggle(emp.id)}
                style={{width:16,height:16,cursor:"pointer",accentColor:t.warning}} />
              <label htmlFor={"ot_"+emp.id} style={{flex:1,cursor:"pointer"}}>
                <div style={{fontWeight:700,fontSize:13,color:t.text}}>{emp.name}</div>
                <div style={{fontSize:11,color:t.textMuted,marginTop:2}}>
                  Current: <span style={{color:t.text,fontWeight:600}}>{currentHours}h</span>
                  {" → "}
                  <span style={{color:t.warning,fontWeight:700}}>{newHours}h</span>
                </div>
              </label>
            </div>
          ))}
        </div>
        <div style={{display:"flex",justifyContent:"flex-end",gap:10}}>
          <button onClick={onCancel}
            style={{background:"transparent",color:t.textMuted,border:"1px solid "+t.border,padding:"9px 20px",borderRadius:6,cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit"}}>
            Cancel
          </button>
          <button onClick={() => onApprove(approved)} disabled={!allApproved}
            style={{background:allApproved ? t.warning : t.border,color:allApproved ? "#000" : t.textDim,border:"none",padding:"9px 22px",borderRadius:6,cursor:allApproved ? "pointer" : "default",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>
            ✓ Approve Selected
          </button>
        </div>
      </div>
    </div>
  );
}
