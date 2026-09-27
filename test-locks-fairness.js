'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),c=require('./load-core');
const {DAYS,cellKey,hasDutyLocks,lockedDutyIssues,preferenceBurden,buildPreferenceHistory,preferenceFairnessCost,improveSchedulePreferences,
 buildAutoFill,repairScheduleCompletion,scheduleChangeIssues,scheduleQuality,publicationSnapshot,createPublicationRecord,validatePublication,weeklyEmployeeHours}=c;
const cfg={minRestHours:12,maxConsecutiveNights:4,maxConsecutiveShifts:5};
const clone=v=>JSON.parse(JSON.stringify(v));
function fixture(weekStart='2026-09-06') {
 const employees=[],schedule={};
 for(const sid of ['first','second','third'])for(let group=0;group<2;group++)for(let n=0;n<3;n++) {
  const id=`${sid}-${group}-${n}`,days=group?DAYS.slice(3):DAYS.slice(0,3);
  employees.push({id,name:id,qualifications:['Guard','Scale','Medical'],employmentType:'part-time',overtimePref:'blocked',requiredShift:sid,availableDaysOfWeek:days,maxShiftsPerWeek:4});
  for(const day of days)(schedule[cellKey(day,sid)] ||= []).push({employeeId:id,position:['Guard','Scale','Medical'][n]});
 }
 employees.push({id:'sup',name:'Supervisor',qualifications:['Supervisor'],employmentType:'full-time',requiredShift:'first',overtimePref:'blocked'});
 for(const day of DAYS.slice(1,6))schedule[cellKey(day,'first')].push({employeeId:'sup',position:'Supervisor'});
 const previous=new Date(Date.parse(weekStart+'T12:00:00Z')-7*86400000).toISOString().slice(0,10);
 return publicationSnapshot({weekStart,employees,schedule,cfg,history:[{weekStart:previous,schedule:{},extShifts:[],handoffs:[]}]});
}
const proposal=s=>({ns:s.schedule,autoExtShifts:s.extShifts,handoffs:s.handoffs,usedPatterns:{},assignLog:{}});
const validate=(s,x,e,h)=>[...c.validateCoverage(s,e,x,h),...c.validateAssignmentPolicy(s,e,cfg,{extShifts:x,handoffs:h})];
const context=s=>({source:s.employees,accountingRoster:s.employees,cfg,validateSchedule:validate});
const publish=s=>createPublicationRecord(s,[],'Manager',{priorWeekConfirmed:true});
test('regular locks protect employee, position, day and lock state in manual changes',()=>{
 const s=fixture();s.schedule.Sunday__first[0].locked=true;
 assert(hasDutyLocks(s.schedule));
 for(const edit of [n=>n.Sunday__first.shift(),n=>{n.Sunday__first[0].position='Scale';},n=>{n.Sunday__first[0].employeeId='first-1-0';},n=>{n.Sunday__first[0].locked=false;}]) {
  const next=clone(s.schedule);edit(next);assert(scheduleChangeIssues(s.schedule,next,s.employees,cfg).some(i=>i.type==='assignment_lock'));
 }
 const next=clone(s.schedule);next.Tuesday__third.pop();assert.equal(lockedDutyIssues(s.schedule,next).length,0);
});
test('extended pair and handoff locks preserve complete records and handoff sources',()=>{
 const ext={day:'Sunday',pairId:'day',empAId:'a',empBId:'b',locked:true};
 assert(lockedDutyIssues({}, {},{extShifts:[ext]},{extShifts:[{...ext,empBId:'c'}]}).length);
 const h={day:'Sunday',employeeId:'a',sourceShiftId:'first',targetShiftId:'second',type:'late-stay',position:'Guard',hours:4,locked:true};
 const before={Sunday__first:[{employeeId:'a',position:'Guard'}]};
 assert.equal(lockedDutyIssues(before,before,{handoffs:[h]}).length,0);
 assert(lockedDutyIssues(before,{}, {handoffs:[h]}).some(i=>/source/.test(i.msg)));
 assert(lockedDutyIssues(before,before,{handoffs:[h]},{handoffs:[{...h,hours:2}]}).length);
});
test('a lock never waives qualification, leave, hour or coverage requirements',()=>{
 const s=fixture();s.schedule.Sunday__first[0].locked=true;
 assert(validatePublication(s).ok);
 s.employees[0].qualifications=[];assert.equal(validatePublication(s).ok,false);
});
test('locked generation fills a vacancy, preserves excluded staff and owns the input',()=>{
 const s=fixture();s.schedule.Sunday__first[0].locked=true;s.schedule.Monday__first.pop();
 const before=JSON.stringify(s),source=s.employees.filter(e=>e.id!=='first-0-0');
 const result=buildAutoFill(source,cfg,new Set(),{},[],false,{seedSchedule:s.schedule,seedHandoffs:[],roster:s.employees});
 assert.equal(JSON.stringify(s),before);assert.equal(result.errors,0,JSON.stringify(result.issues));
 assert.equal(result.schedule.Sunday__first[0].locked,true);assert(result.schedule.Monday__first.some(a=>a.employeeId==='sup'));
 assert.equal(lockedDutyIssues(s.schedule,result.schedule).length,0);
});
test('locked invalid work remains visible and is never silently deleted by generation',()=>{
 const s=fixture();s.schedule.Sunday__first[0].locked=true;s.employees[0].qualifications=[];
 const result=buildAutoFill(s.employees,cfg,new Set(),{},[],false,{seedSchedule:s.schedule,roster:s.employees});
 assert(result.schedule.Sunday__first.some(a=>a.employeeId===s.employees[0].id&&a.locked));assert(result.errors>0);
});
test('linked repair cannot move a locked employee to fill another vacancy',()=>{
 const s=fixture();s.schedule.Sunday__first[0].locked=true;s.schedule.Monday__first=s.schedule.Monday__first.filter(a=>a.employeeId!==s.employees[0].id);
 s.employees[0].maxShiftsPerWeek=2;
 const result=repairScheduleCompletion(proposal(s),{...context(s),source:[s.employees[0]],targetSlots:['Monday__first']});
 assert.equal(result.repairInfo.transactions,0);assert.equal(lockedDutyIssues(s.schedule,result.ns).length,0);
});
test('denied overtime cannot silently remove locked work',()=>{
 const s=fixture();s.schedule.Tuesday__first[0].locked=true;
 assert.throws(()=>c.trimOvertimeProposal(proposal(s),[s.employees[0]],{[s.employees[0].id]:4}),/locked duty/);
});
test('a handoff lock blocks changing the source even when its record remains',()=>{
 const s=fixture(),h={day:'Sunday',employeeId:s.employees[0].id,sourceShiftId:'first',targetShiftId:'second',type:'late-stay',position:'Guard',hours:4,locked:true};
 s.employees[0].canWorkOtherShifts=true;s.employees[0].ext12hPref='both';
 const next=clone(s.schedule);next.Sunday__first=next.Sunday__first.slice(1);
 assert(scheduleChangeIssues(s.schedule,next,s.employees,cfg,{handoffs:[h]}).some(i=>i.type==='assignment_lock'));
});
test('preference burden splits extended work at shift boundaries and counts no invented preferences',()=>{
 const e={id:'a',preferredShifts:['first']},ext={day:'Sunday',pairId:'day',empAId:'a'};
 assert.deepEqual(preferenceBurden(e,{},[ext]),{workedHours:12,penaltyHours:4});
 assert.deepEqual(preferenceBurden({id:'a'}, {},[ext]),{workedHours:12,penaltyHours:0});
 const ns={Saturday__third:[{employeeId:'a',position:'Guard'}]};
 assert.equal(preferenceBurden({id:'a',preferredDaysOff:['Saturday']},ns).penaltyHours,8);
});
test('history uses one latest valid publication per prior calendar week, excluding drafts and future weeks',()=>{
 const older=fixture('2026-08-30');older.employees[0].preferredDaysOff=['Sunday'];
 const a=publish(older);a.publishedAt='2026-08-29T12:00:00Z';
 const newer=clone(older);newer.employees[0].preferredDaysOff=[];
 const b=publish(newer);b.publishedAt='2026-08-29T13:00:00Z';
 const invalid=clone(a);invalid.snapshot.employees[0].name='tampered';
 const hist=buildPreferenceHistory([a,b,invalid,publish(fixture()),publish(fixture('2026-07-05')),{...a,status:'draft'}],'2026-09-06');
 assert.deepEqual(hist.weeks,['2026-08-30']);assert.equal(hist.byEmployee[older.employees[0].id].weeks,1);assert.equal(hist.byEmployee[older.employees[0].id].penaltyHours,0);
});
test('history uses preferences saved in that week and does not count absent employees as missed preferences',()=>{
 const s=fixture('2026-08-30');s.employees[0].preferredDaysOff=['Sunday'];const r=publish(s);
 s.employees[0].preferredDaysOff=[];
 const hist=buildPreferenceHistory([r],'2026-09-06');assert.equal(hist.byEmployee[s.employees[0].id].penaltyHours,8);
 assert.equal(hist.byEmployee.newEmployee,undefined);
});
function fairnessFixture() {
 const s=fixture(),ids=['first-0-0','first-1-0'];
 for(const e of s.employees.filter(e=>ids.includes(e.id))) {e.preferredDaysOff=['Sunday'];e.availableDaysOfWeek=null;}
 const prior=fixture('2026-08-30');prior.employees[0].preferredDaysOff=['Sunday'];
 const history=buildPreferenceHistory([publish(prior)],s.weekStart);
 return {s,ctx:{...context(s),source:s.employees.filter(e=>ids.includes(e.id)),fairnessHistory:history}};
}
test('history steers an equal-coverage swap away from repeatedly disappointing the same employee',()=>{
 const {s,ctx}=fairnessFixture(),before=JSON.stringify(s);
 const neutral=improveSchedulePreferences(proposal(s),{...ctx,fairnessHistory:{}});assert.equal(neutral.preferenceInfo.transactions,0);
 const result=improveSchedulePreferences(proposal(s),ctx);
 assert(result.preferenceInfo.transactions>0);assert.equal(JSON.stringify(s),before);
 assert(!result.ns.Sunday__first.some(a=>a.employeeId==='first-0-0'));assert(result.ns.Sunday__first.some(a=>a.employeeId==='first-1-0'));
 assert(result.preferenceInfo.after<result.preferenceInfo.before);assert.equal(validate(result.ns,[],s.employees,[]).length,0);
 for(const e of s.employees)assert.deepEqual(weeklyEmployeeHours(e,result.ns),weeklyEmployeeHours(e,s.schedule));
});
test('preference improvement respects locks, exclusions and unavailable days',()=>{
 for(const kind of ['lock','exclude','unavailable']) {
  const {s,ctx}=fairnessFixture();
  if(kind==='lock') s.schedule.Sunday__first[0].locked=true;
  if(kind==='exclude') ctx.source=ctx.source.filter(e=>e.id!=='first-1-0');
  if(kind==='unavailable') s.employees.find(e=>e.id==='first-1-0').unavailableDays=['Sunday'];
  const result=improveSchedulePreferences(proposal(s),ctx);assert.equal(result.preferenceInfo.transactions,0,kind);
 }
});
test('preference search limits are reported without changing the draft',()=>{
 const {s,ctx}=fairnessFixture(),result=improveSchedulePreferences(proposal(s),{...ctx,preferenceMaxNodes:0});
 assert(result.preferenceInfo.limited);assert.equal(result.preferenceInfo.transactions,0);assert.deepEqual(result.ns,s.schedule);
});
test('hard rules, coverage and full-time hours outrank any historical preference cost',()=>{
 assert(c.compareScheduleQuality([0,0,0,0,0,0,0,10000,0],[0,8,0,0,0,0,0,0,0])<0);
 assert(c.compareScheduleQuality([0,0,0,0,0,0,0,10000,0],[0,0,0,8,0,0,0,0,0])<0);
 const {s,ctx}=fairnessFixture();ctx.source[1].qualifications=['Scale'];
 const result=improveSchedulePreferences(proposal(s),ctx);assert.equal(result.preferenceInfo.transactions,0);
});
const html=fs.readFileSync(__dirname+'/ShiftScheduler_latest loop.html','utf8');
test('production proposal commit rejects locked-duty removal before writes',()=>{
 const s=fixture();s.schedule.Sunday__first[0].locked=true;const changed=clone(s.schedule);changed.Sunday__first.shift();
 const events=[],scope={...c,isReadOnly:false,proposalIsCurrent:()=>true,discardStaleProposal:()=>events.push('stale'),employees:s.employees,cfg,
  policyOptions:{lockedSchedule:s.schedule,extShifts:[],handoffs:[]},showAlert:()=>events.push('blocked'),validateSchedule:()=>[]};
 for(const name of ['pushUndo','setSchedule','setExtShifts','setHandoffs','setEmpPatterns','setAssignLog','setScheduleIssues','setScheduleStale','setPendingProposal']) scope[name]=()=>events.push(name);
 const start=html.indexOf('  const commitScheduleProposal = proposal => {'),end=html.indexOf('  const commitAssignmentChange',start);
 const run=new Function(...Object.keys(scope),html.slice(start,end)+'return commitScheduleProposal;')(...Object.values(scope));
 assert.equal(run({...proposal(s),ns:changed}),false);assert.deepEqual(events,['blocked']);
});
test('production lock toggle is undoable and cannot run during a pending proposal',()=>{
 const s=fixture();let ns=s.schedule,undos=0;
 const scope={isReadOnly:false,autoFillRunning:false,pendingProposal:null,publicationStore:{busy:false},pushUndo:()=>undos++,setSchedule:f=>{ns=f(ns);},setExtShifts:()=>{},setHandoffs:()=>{}};
 const start=html.indexOf('  const toggleDutyLock = row => {'),end=html.indexOf('  const runPreferenceImprovement',start);
 const run=new Function(...Object.keys(scope),html.slice(start,end)+'return toggleDutyLock;')(...Object.values(scope));
 run({type:'regular',key:'Sunday__first',index:0});assert(ns.Sunday__first[0].locked);assert.equal(undos,1);
 run({type:'regular',key:'Sunday__first',index:0});assert.equal(ns.Sunday__first[0].locked,false);assert.equal(undos,2);
 scope.pendingProposal={};const blocked=new Function(...Object.keys(scope),html.slice(start,end)+'return toggleDutyLock;')(...Object.values(scope));
 blocked({type:'regular',key:'Sunday__first',index:0});assert.equal(undos,2);
});


test('overtime denial removes unlocked duties first when locked duties fit the approved ceiling',()=>{
 const s=fixture();s.schedule.Tuesday__first[0].locked=true;
 const result=c.trimOvertimeProposal(proposal(s),[s.employees[0]],{[s.employees[0].id]:16});
 assert(result.ns.Tuesday__first.some(a=>a.employeeId===s.employees[0].id&&a.locked));
 assert.equal(weeklyEmployeeHours(s.employees[0],result.ns).workedHours,16);
});
test('autofill can build a complete feasible week around a single locked duty',()=>{
 const s=fixture(),seed={Sunday__first:[{...s.schedule.Sunday__first[0],locked:true}]};
 let current=seed,result;
 for(let attempt=0;attempt<4;attempt++) {
  result=buildAutoFill(s.employees,cfg,new Set(),{},[],false,{seedSchedule:current,roster:s.employees});
  current=result.schedule;if(!result.errors)break;
 }
 assert.equal(result.errors,0,JSON.stringify(result.issues));assert.equal(Object.values(result.schedule).flat().length,68);
 assert.equal(lockedDutyIssues(seed,result.schedule).length,0);
});

test('locks survive publication serialization and remain part of the reviewed snapshot',()=>{
 const s=fixture();s.schedule.Sunday__first[0].locked=true;
 const record=clone(publish(s));assert(record.snapshot.schedule.Sunday__first[0].locked);assert(c.publicationRecordValid(record));
 record.snapshot.schedule.Sunday__first[0].locked=false;assert.equal(c.publicationRecordValid(record),false);
});
test('production autofill uses the protected draft instead of rebuilding over a lock',()=>{
 const s=fixture();s.schedule.Sunday__first[0].locked=true;s.schedule.Monday__first.pop();
 const scope={...c,source:s.employees,cfg,empTimeOffDays:new Set(),enrichedPatterns:{},extShifts:[],handoffs:[],schedule:s.schedule,
  accountingRoster:s.employees,ptoHoursByEmployee:{},fairnessHistory:{},preservedSchedule:{},preservedHandoffs:[],excludeSet:new Set(),swingDesig:{},validateSchedule:validate};
 const start=html.indexOf('    const attempt = (jitter) => {'),end=html.indexOf('    // ── Commit best result',start);
 const run=new Function(...Object.keys(scope),html.slice(start,end)+'return attempt;')(...Object.values(scope));
 const result=run(false);assert.equal(result.errors,0);assert.equal(result.searchInfo.termination,'locked_draft_repair');
 assert.equal(lockedDutyIssues(s.schedule,result.ns).length,0);assert(result.ns.Monday__first.some(a=>a.employeeId==='sup'));
});
test('production preference control applies a complete proposal and respects pending approval',()=>{
 const {s,ctx}=fairnessFixture(),commits=[];
 const scope={...c,isReadOnly:false,autoFillRunning:false,pendingProposal:null,schedule:s.schedule,extShifts:[],handoffs:[],employees:s.employees,
  empPatterns:{},assignLog:{},overtimeInputRef:{current:'current'},ptoHoursByEmployee:{},afExclude:s.employees.filter(e=>!ctx.source.includes(e)).map(e=>e.id),
  cfg,empTimeOffDays:new Set(),history:[],weekStart:s.weekStart,fairnessHistory:ctx.fairnessHistory,showAlert:()=>assert.fail('expected a swap'),
  setPendingProposal:()=>assert.fail('no overtime'),commitScheduleProposal:p=>commits.push(p)};
 const start=html.indexOf('  const runPreferenceImprovement = () => {'),end=html.indexOf('  const handleOvertimeApproval',start);
 const run=new Function(...Object.keys(scope),html.slice(start,end)+'return runPreferenceImprovement;')(...Object.values(scope));
 run();assert.equal(commits.length,1);assert.equal(commits[0].baseStamp,'current');assert(commits[0].preferenceInfo.transactions>0);
 scope.pendingProposal={};new Function(...Object.keys(scope),html.slice(start,end)+'return runPreferenceImprovement;')(...Object.values(scope))();assert.equal(commits.length,1);
});
