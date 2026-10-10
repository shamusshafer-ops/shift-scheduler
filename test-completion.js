'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),core=require('./load-core');
const {DAYS,cellKey,remainingSlotCapacity,scheduleQuality,compareScheduleQuality,repairScheduleCompletion,buildCompletionDiagnostics,validateCoverage,validateAssignmentPolicy,weeklyEmployeeHours}=core;
const emp=(id,extra={})=>({id,name:id,qualifications:['Guard','Medical'],employmentType:'part-time',...extra});
const a=(id,position='Medical')=>({employeeId:id,position});
const prop=ns=>({ns,autoExtShifts:[],handoffs:[],issues:[],hourTracker:{},usedPatterns:{},assignLog:{}});
const cfg={minRestHours:12,maxConsecutiveNights:4,maxConsecutiveShifts:5,repairSearchMs:1500};
function chainFixture() {
 const A=emp('A',{maxShiftsPerWeek:1,availableDaysOfWeek:['Sunday','Monday']}),B=emp('B',{maxShiftsPerWeek:1,availableDaysOfWeek:['Monday','Tuesday']}),C=emp('C',{availableDaysOfWeek:['Tuesday']});
 const roster=[A,B,C],ns={};
 for(const day of ['Sunday','Monday','Tuesday']) {
  const scale=emp(day+'-scale',{qualifications:['Scale']}),guard=emp(day+'-guard',{qualifications:['Guard']});
  roster.push(scale,guard);ns[cellKey(day,'second')]=[a(scale.id,'Scale'),a(guard.id,'Guard')];
 }
 ns.Monday__second.push(a('A'));ns.Tuesday__second.push(a('B'));
 const input=prop(ns);
 const context={source:[A,B,C],accountingRoster:roster,cfg,empTimeOffDays:new Set(),targetSlots:['Sunday__second'],
  validateSchedule:(s,x,e,h=[])=>[...validateCoverage(s,roster,x,h),...validateAssignmentPolicy(s,roster,cfg,{extShifts:x,handoffs:h})]};
 return {input,context,roster};
}
test('capacity upper bound includes doubles and does not invent a six-day limit',()=>{
 const slots=[{day:'Monday',shiftId:'first'},{day:'Monday',shiftId:'second'}];
 assert.equal(remainingSlotCapacity(emp('a',{willing16h:true}),slots),2);
 assert.equal(remainingSlotCapacity(emp('a'),slots),1);
 assert.equal(remainingSlotCapacity(emp('a',{willing16h:true,maxShiftsPerWeek:5}),slots,4),1);
 assert.equal(remainingSlotCapacity(emp('a'),DAYS.map(day=>({day,shiftId:'first'}))),7);
});
test('quality compares uncovered hours instead of the number of error messages',()=>{
 const roster=[emp('med'),emp('scale',{qualifications:['Scale']}),emp('guard',{qualifications:['Guard']})];
 const base=prop({Sunday__first:[a('med'),a('scale','Scale')],Sunday__second:[a('guard','Guard')]});
 const partial={...base,handoffs:[{day:'Sunday',employeeId:'guard',type:'early-arrival',sourceShiftId:'second',targetShiftId:'first',position:'Guard',hours:4}]};
 const full={...base,ns:{...base.ns,Sunday__first:[...base.ns.Sunday__first,a('guard','Guard')]}};
 roster[2].willing16h=true;roster[2].swingEligible=['swing-10a-10p'];
 assert(compareScheduleQuality(scheduleQuality(partial,roster),scheduleQuality(base,roster))<0);
 assert(compareScheduleQuality(scheduleQuality(full,roster),scheduleQuality(partial,roster))<0);
});
test('hard violations cannot be bought with coverage or preference improvements',()=>{
 assert(compareScheduleQuality([1,0,0,0,0,0,0],[0,40,24,8,0,999,0])>0);
 const Q=core.QUALITY,v=o=>{const q=Array(9).fill(0);for(const [k,x] of Object.entries(o))q[Q[k]]=x;return q;};
 assert(compareScheduleQuality(v({shortfall:8}),v({overtime:8,preferences:100,changes:5}))>0);
 // Everyone getting a day off outranks any overtime saving; coverage outranks both.
 assert(compareScheduleQuality(v({noDayOff:1}),v({overtime:80}))>0);
 assert(compareScheduleQuality(v({coverage:8,body:8}),v({noDayOff:3,overtime:80}))>0);
 // The supervisor's weekday 12-hour day is a last resort: only coverage outranks avoiding it.
 assert(compareScheduleQuality(v({supervisorExtensions:1}),v({noDayOff:3,overtime:80}))>0);
 assert(compareScheduleQuality(v({coverage:4}),v({supervisorExtensions:1}))>0);
});
test('dual qualifications and the separate supervisor are retained in completeness metrics',()=>{
 const roster=[emp('dual',{qualifications:['Guard','Medical','Scale']}),emp('g1',{qualifications:['Guard']}),emp('g2',{qualifications:['Guard']}),emp('sup',{qualifications:['Supervisor']})];
 const base=prop({Monday__first:[a('dual','Medical'),a('g1','Guard'),a('g2','Guard')]});
 const full={...base,ns:{Monday__first:[...base.ns.Monday__first,a('sup','Supervisor')]}};
 assert(compareScheduleQuality(scheduleQuality(full,roster),scheduleQuality(base,roster))<0);
 const report=buildCompletionDiagnostics(base.ns,roster,{},{}).gaps.find(g=>g.day==='Monday'&&g.shiftId==='first');
 assert.deepEqual(report.missingRoles,['Supervisor']);assert.deepEqual(report.candidates.map(c=>c.employeeId),['sup']);
 const repaired=repairScheduleCompletion(base,{source:roster,accountingRoster:roster,cfg,targetSlots:['Monday__first'],validateSchedule:(s,x,e,h)=>[...validateCoverage(s,roster,x,h),...validateAssignmentPolicy(s,roster,cfg,{extShifts:x,handoffs:h})]});
 assert(core.analyzeShiftCoverage('Monday','first',repaired.ns,roster).ok);
 assert(repaired.ns.Monday__first.some(a=>a.employeeId==='sup'&&a.position==='Supervisor'));
});
test('two linked moves fill a gap that direct insert and overstaffed-slot repair cannot fill',()=>{
 const {input,context,roster}=chainFixture(),before=JSON.stringify(input);
 input.issues=context.validateSchedule(input.ns,[],roster).filter(i=>i.day==='Sunday'&&i.shiftId==='second');
 const ordinary=core.repairScheduleGaps(JSON.parse(JSON.stringify(input)),context);
 assert(!core.analyzeShiftCoverage('Sunday','second',ordinary.ns,roster).ok);
 const snapshot=JSON.stringify(input),result=repairScheduleCompletion(input,context);
 assert.equal(JSON.stringify(input),snapshot);
 assert(result.ns.Sunday__second.some(a=>a.employeeId==='A'));
 assert(result.ns.Monday__second.some(a=>a.employeeId==='B'));
 assert(result.ns.Tuesday__second.some(a=>a.employeeId==='C'));
 assert.equal(result.repairInfo.transactions,1);
 assert.deepEqual(new Set(result.repairInfo.changedSlots),new Set(['Sunday__second','Monday__second','Tuesday__second']));
 assert.equal(validateAssignmentPolicy(result.ns,roster,cfg).length,0);
 for(const day of DAYS)for(const shiftId of ['first','second','third']) {
  const old=core.analyzeShiftCoverage(day,shiftId,input.ns,roster),now=core.analyzeShiftCoverage(day,shiftId,result.ns,roster);
  assert(now.bodyGapHours<=old.bodyGapHours);assert(now.roleGapHours<=old.roleGapHours);
 }
 assert(result.assignLog.Sunday__second__A);
});
test('excluded employees and their assignments cannot be moved by completion repair',()=>{
 const {input,context}=chainFixture();context.source=context.source.filter(e=>e.id!=='A');
 const result=repairScheduleCompletion(input,context);
 assert.equal(result.repairInfo.transactions,0);assert.deepEqual(result.ns,input.ns);
});
test('a failed branch rolls back every move when its final backfill is unavailable',()=>{
 const {input,context,roster}=chainFixture();roster.find(e=>e.id==='C').unavailableDays=['Tuesday'];
 const result=repairScheduleCompletion(input,context);
 assert.deepEqual(result.ns,input.ns);assert.deepEqual(result.handoffs,input.handoffs);assert.equal(result.repairInfo.transactions,0);
});
test('a repair cannot silently add unapproved overtime to its final replacement',()=>{
 const {input,context}=chainFixture();context.creditHourLimits={A:8,B:8,C:0};
 const result=repairScheduleCompletion(input,context);
 assert.deepEqual(result.ns,input.ns);assert.equal(result.repairInfo.transactions,0);
});
test('extended halves and their display mirrors remain intact during targeted repair',()=>{
 const {input,context,roster}=chainFixture();
 const e=emp('ext',{ext12hPref:'day'});roster.push(e);context.source.push(e);
 input.autoExtShifts=[{day:'Thursday',pairId:'day',empAId:'ext'}];input.ns.Thursday__first=[a('ext')];
 const result=repairScheduleCompletion(input,context);
 assert.deepEqual(result.autoExtShifts,input.autoExtShifts);assert.deepEqual(result.ns.Thursday__first,input.ns.Thursday__first);
});
function fullFixture() {
 const roster=[],ns={};
 for(const shiftId of ['first','second','third'])for(let group=0;group<2;group++)for(let n=0;n<3;n++){
  const id=`${shiftId}-${group}-${n}`,days=group?DAYS.slice(3):DAYS.slice(0,3);
  const e=emp(id,{qualifications:['Guard','Medical','Scale'],requiredShift:shiftId,overtimePref:'blocked',availableDaysOfWeek:days,maxShiftsPerWeek:4});
  roster.push(e);for(const day of days)(ns[cellKey(day,shiftId)] ||= []).push(a(id,['Guard','Medical','Scale'][n]));
 }
 const sup=emp('sup',{qualifications:['Supervisor'],employmentType:'full-time',requiredShift:'first',overtimePref:'blocked'});roster.push(sup);
 for(const day of DAYS.slice(1,6))ns[cellKey(day,'first')].push(a('sup','Supervisor'));
 roster[0].employmentType='full-time';roster[0].availableDaysOfWeek=DAYS.slice(0,4);
 const credits={[roster[0].id]:8};
 const context={source:roster,accountingRoster:roster,cfg,ptoHoursByEmployee:credits,empTimeOffDays:new Set(),
 validateSchedule:(s,x,e,h=[])=>[...validateCoverage(s,roster,x,h),...validateAssignmentPolicy(s,roster,cfg,{extShifts:x,handoffs:h,ptoHoursByEmployee:credits})]};
 return {roster,input:prop(ns),context,credits};
}
test('a full-time shortfall is repaired by replacing part-time work without overstaffing',()=>{
 const {input,context,roster,credits}=fullFixture();
 assert.equal(validateCoverage(input.ns,roster).length,0);
 const result=repairScheduleCompletion(input,context);
 assert.equal(result.errors,0,JSON.stringify(result.issues));assert.equal(Object.values(result.ns).flat().length,68);
 assert.equal(weeklyEmployeeHours(roster[0],result.ns,[],[],credits).creditedHours,40);
 assert.deepEqual(result.repairInfo.changedSlots,['Wednesday__first']);
 assert(!result.ns.Wednesday__first.some(a=>a.employeeId==='sup'&&a.position!=='Supervisor'));
});
test('PTO and exact approval ceilings remain hard during weekly-hour repair',()=>{
 const {input,context,roster}=fullFixture();context.creditHourLimits={[roster[0].id]:32};
 const result=repairScheduleCompletion(input,context);
 assert.deepEqual(result.ns,input.ns);assert.equal(result.repairInfo.transactions,0);
});
test('repair reports budget exhaustion without claiming infeasibility or mutating input',()=>{
 const {input,context}=chainFixture();context.cfg={...cfg,repairMaxNodes:0};
 const result=repairScheduleCompletion(input,context);
 assert.equal(result.repairInfo.limited,true);assert.deepEqual(result.ns,input.ns);
});
test('shortage diagnostics distinguish present constraints from proof of impossibility',()=>{
 const {input,context,roster}=chainFixture();
 const report=buildCompletionDiagnostics(input.ns,roster,cfg,{excludedIds:['C',...roster.filter(e=>!['A','B','C'].includes(e.id)).map(e=>e.id)]});
 const gap=report.gaps.find(g=>g.day==='Sunday'&&g.shiftId==='second');
 assert(gap.candidates.find(c=>c.employeeId==='A').reasons.includes('weekly duty cap'));
 assert(gap.candidates.find(c=>c.employeeId==='C').reasons.includes('excluded from autofill'));
 assert(gap.message.includes('not proof'));
});
test('diagnostics list every full-time shortfall and keep part-time minimums unset',()=>{
 const roster=[emp('full',{employmentType:'full-time'}),emp('part'),emp('call',{employmentType:'on-call'})];
 const report=buildCompletionDiagnostics({},roster,{}, {ptoHoursByEmployee:{full:8},excludedIds:['full']});
 assert.equal(report.shortfalls.length,1);assert.equal(report.shortfalls[0].shortfallHours,32);
});
test('production generator exposes a search limit and retains a valid partial candidate',()=>{
 const roster=[emp('e',{qualifications:['Guard','Scale','Medical']})];
 const result=core.buildAutoFill(roster,{...cfg,maxSearchNodes:0},new Set(),{},[],false);
 assert.equal(result.searchInfo.termination,'limit_reached');
 assert.equal(validateAssignmentPolicy(result.schedule,roster,cfg).length,0);
});
const html=fs.readFileSync(__dirname+'/ShiftScheduler_latest loop.html','utf8');
test('production autofill comparison uses completeness quality and resets plateau on real progress',()=>{
 const start=html.indexOf('      result.quality=scheduleQuality('),end=html.indexOf('      setAutoFillProgress',start);
 const {input,context,roster}=chainFixture(),better=repairScheduleCompletion(input,context);
 const oldQuality=scheduleQuality(input,roster,cfg,{},input.ns);
 const run=new Function(...Object.keys(core),'result','accountingRoster','cfg','empTimeOffDays','ptoHoursByEmployee','enrichedPatterns','schedule','best','prevBestQuality','plateauCount','wasFinal','relaysDone','const fairnessHistory={};'+html.slice(start,end)+'return {best,plateauCount};')(...Object.values(core),better,roster,cfg,new Set(),{},{},input.ns,{...input,quality:oldQuality},oldQuality,2,false,false);
 assert.equal(run.best,better);
 assert.equal(run.plateauCount,0);
});

test('production repair control stages one complete proposal and respects pending approval',()=>{
 const {input,context,roster,credits}=fullFixture(),before=JSON.stringify(input.ns);
 const start=html.indexOf('  const runTargetedRepair = () => {'),end=html.indexOf('  const handleOvertimeApproval',start);
 const run=pending=>{
  const committed=[];
  const fn=new Function(...Object.keys(core),'isReadOnly','autoFillRunning','pendingProposal','overtimeInputRef','employees','afExclude','schedule','extShifts','handoffs','ptoHoursByEmployee','empPatterns','assignLog','cfg','empTimeOffDays','history','weekStart','validateSchedule','showAlert','proposalIsCurrent','discardStaleProposal','setPendingProposal','commitScheduleProposal',html.slice(start,end)+'return runTargetedRepair;')(...Object.values(core),false,false,pending,{current:'base'},roster,[],input.ns,[],[],credits,{}, {},cfg,new Set(),[],'2026-09-06',context.validateSchedule,()=>assert.fail('repair should succeed'),()=>true,()=>assert.fail('not stale'),()=>assert.fail('no overtime'),p=>committed.push(p));
  fn();return committed;
 };
 const committed=run(null);assert.equal(committed.length,1);assert.equal(committed[0].baseStamp,'base');
 assert.equal(JSON.stringify(input.ns),before);assert.equal(committed[0].errors,0);
 assert.equal(run({reviewItems:[]}).length,0);
});

test('production search rollback retains a working day when undoing half of a double',()=>{
 const start=html.indexOf('    class SearchState {'),end=html.indexOf('    // ── Pick best position',start);
 const slots=[{day:'Monday',shiftId:'first'},{day:'Monday',shiftId:'second'}];
 const State=new Function(...Object.keys(core),'hourTracker','sourceEmps','btSlots','btStaticEligible',html.slice(start,end)+'return SearchState;')(...Object.values(core),{},[emp('e',{willing16h:true})],slots,()=>['e']);
 const state=new State();state.assign('e','Medical',0);const mark=state.trail.length;
 state.assign('e','Medical',1);assert.equal(state.hourTracker.e,16);
 state.undoTo(mark);assert.equal(state.hourTracker.e,8);assert.equal(state.shiftsWorked.e,1);assert(state.dayWorked.e.has('Monday'));
 state.undoTo(0);assert.equal(state.hourTracker.e,0);assert.equal(state.dayWorked.e.size,0);
});

test('weekly-hour repair does not overstaff a slot already covered by an extended half',()=>{
 const {input,context,roster,credits}=fullFixture();
 roster.push(emp('extended',{qualifications:['Guard','Medical','Scale'],ext12hPref:'day',requiredShift:'first',maxShiftsPerWeek:1}));
 input.ns.Wednesday__first=input.ns.Wednesday__first.filter(a=>a.employeeId!=='first-1-0');
 // Give the extended worker's 14:00-18:00 spillover a genuine vacancy and
 // cover the remaining half with a different worker at 18:00.
 roster.push(emp('late',{qualifications:['Guard','Medical','Scale'],ext12hPref:'night',requiredShift:'third',maxShiftsPerWeek:1}));
 input.ns.Wednesday__second.pop();
 input.ns.Wednesday__third.pop();
 input.autoExtShifts=[{day:'Wednesday',pairId:'day',empAId:'extended',empBId:'late'}];
 assert.equal(validateCoverage(input.ns,roster,input.autoExtShifts).length,0);
 const result=repairScheduleCompletion(input,context);
 assert.equal(weeklyEmployeeHours(roster[0],result.ns,result.autoExtShifts,[],credits).creditedHours,40);
 const coverage=core.analyzeShiftCoverage('Wednesday','first',result.ns,roster,result.autoExtShifts);
 assert.equal(Math.max(...coverage.segments.map(s=>s.regular)),3);assert(coverage.ok);
});
