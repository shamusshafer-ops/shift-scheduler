'use strict';
// Regression tests for autofill leaving the schedule empty on the production roster.
// Fixture: anonymized 15-person roster plus two intermediate drafts captured from
// the browser autofill pipeline (see fixtures/autofill-real-roster-drafts.json).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),core=require('./load-core');
const {QUALITY,repairScheduleCompletion,repairScheduleGaps,scheduleQuality,compareScheduleQuality,validateCoverage,validateAssignmentPolicy,weeklyEmployeeHours,cellKey}=core;
const fx=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/autofill-real-roster-drafts.json'),'utf8'));
const roster=fx.roster,cfg=fx.cfg;
const clone=v=>JSON.parse(JSON.stringify(v));
const options=d=>({extShifts:d.autoExtShifts,handoffs:d.handoffs,ptoHoursByEmployee:{},empPatterns:fx.enrichedPatterns});
const context=()=>({source:roster,accountingRoster:roster,cfg,ptoHoursByEmployee:{},enrichedPatterns:fx.enrichedPatterns,
 validateSchedule:(s,x,e,h=[])=>[...validateCoverage(s,roster,x,h).filter(i=>i.type!=='overstaffed'),...validateAssignmentPolicy(s,roster,cfg,{extShifts:x,handoffs:h,ptoHoursByEmployee:{},empPatterns:fx.enrichedPatterns})]});
const draft=d=>({...clone(d),usedPatterns:{},assignLog:{},issues:[],hourTracker:{}});
const shortfall=d=>roster.reduce((n,e)=>n+(weeklyEmployeeHours(e,d.ns,d.autoExtShifts,d.handoffs,{}).shortfallHours || 0),0);

test('fixture: the captured draft is fully covered but leaves a full-timer short while others work overtime',()=>{
 const d=draft(fx.completionDraft),q=scheduleQuality(d,roster,cfg,options(d));
 assert.equal(q[1],0,'no coverage gap hours');
 assert(q[3]>0,'someone is short of 40h');
 assert(q[QUALITY.overtime]>0,'others are over 40h');
 assert(validateAssignmentPolicy(d.ns,roster,cfg,options(d)).some(i=>i.type==='overstaffed'),'Friday first is overstaffed by a handoff');
});

test('completion repair closes the weekly-hours shortfall within its default budget despite an overstaffed slot',()=>{
 const d=draft(fx.completionDraft),before=scheduleQuality(d,roster,cfg,options(d));
 const out=repairScheduleCompletion(d,context());
 const after=scheduleQuality(out,roster,cfg,options(out));
 assert(out.repairInfo.transactions>0,'repair made at least one change (was 0: budget spent on an unfixable overstaffed slot)');
 assert.equal(shortfall(out),0,'every full-timer reaches 40h');
 assert(after[0]<=before[0],'no new hard-rule violations');
 assert.equal(after[1],0,'coverage is still complete');
 assert(after[QUALITY.overtime]<before[QUALITY.overtime],'overtime goes down because the short employee takes over overtime hours');
});

test('completion repair tries one-step swaps on every target before multi-step chains',()=>{
 // Same draft without the overstaffing handoff: the only targets are weekly-hours
 // targets. A depth-first search on the first slot used to exhaust the budget.
 const d=draft(fx.completionDraft);d.handoffs=[];
 const out=repairScheduleCompletion(d,{...context(),repairMaxNodes:400});
 assert.equal(shortfall(out),0);
 assert(out.repairInfo.nodes<400,'a direct swap is found long before the node budget');
});

test('gap repair never adds a handoff into a shift that is already fully staffed',()=>{
 const d=draft(fx.gapRepairInput),ctx=context();
 d.issues=ctx.validateSchedule(d.ns,d.autoExtShifts,roster,d.handoffs);
 assert(d.issues.some(i=>i.type==='role'),'input has a missing role for the gap repair to fix');
 assert(!validateAssignmentPolicy(d.ns,roster,cfg,options(d)).some(i=>i.type==='overstaffed'),'input is not overstaffed');
 const out=repairScheduleGaps(d,ctx);
 const res={...d,...out,autoExtShifts:out.autoExtShifts || d.autoExtShifts,handoffs:out.handoffs || d.handoffs};
 const over=validateAssignmentPolicy(res.ns,roster,cfg,options(res)).filter(i=>i.type==='overstaffed');
 assert.deepEqual(over.map(i=>i.msg),[],'no overstaffing introduced');
});

test('text fields report every keystroke: onChange is mapped to onInput like preact/compat',()=>{
 const html=fs.readFileSync(path.join(__dirname,'ShiftScheduler_latest loop.html'),'utf8');
 const start=html.indexOf('const _TEXT_INPUT_TYPES'),end=html.indexOf('window.React = {',start);
 assert(start>0 && end>start,'shim present before window.React');
 const calls=[],preact={h:(t,p,...c)=>{calls.push([t,p,c]);return null;}};
 const createElement=new Function('preact',html.slice(start,end)+'return _createElement;')(preact);
 const f=()=>{};
 createElement('input',{value:'',onChange:f});
 createElement('input',{type:'search',onChange:f});
 createElement('textarea',{onChange:f},'x');
 createElement('input',{type:'checkbox',onChange:f});
 createElement('input',{type:'number',onChange:f});
 createElement('select',{onChange:f});
 createElement('input',{onChange:f,onInput:()=>{}});
 createElement('div',null,'child');
 const [text,search,area,box,num,sel,both,div]=calls;
 assert.equal(text[1].onInput,f);assert.equal(text[1].onChange,undefined);
 assert.equal(search[1].onInput,f);
 assert.equal(area[1].onInput,f);assert.deepEqual(area[2],['x']);
 assert.equal(box[1].onChange,f);assert.equal(box[1].onInput,undefined);
 assert.equal(num[1].onChange,f,'number fields keep change-on-commit');
 assert.equal(sel[1].onChange,f);
 assert.equal(both[1].onChange,f,'explicit onInput is left alone');
 assert.equal(div[1],null);assert.deepEqual(div[2],['child']);
});
