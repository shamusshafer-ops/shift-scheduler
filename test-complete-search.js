'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),c=require('./load-core');
const html=fs.readFileSync(__dirname+'/ShiftScheduler_latest loop.html','utf8');
const e=(id,extra={})=>({id,name:id,employmentType:'part-time',qualifications:['Guard','Scale','Medical'],overtimePref:'blocked',...extra});
const a=(id,position='Guard',locked=true)=>({employeeId:id,position,locked});
const input=(employees,extra={})=>({weekStart:'2026-09-06',employees,targetSlots:['Sunday__second'],cfg:{minRestHours:12,maxConsecutiveShifts:5,maxConsecutiveNights:4},...extra});
function finish(search,maxMs=15000) {
 const start=Date.now();let result;
 do {result=search.advance({maxSteps:10000,timeSliceMs:40});if(Date.now()-start>maxMs)assert.fail('Test fixture exceeded its execution budget; no infeasibility conclusion was drawn.');}while(result.status==='searching');
 return result;
}
const solve=i=>finish(c.createCompleteScheduleSearch(i));
const policy=(r,i)=>c.validateAssignmentPolicy(r.solution.ns,i.employees,i.cfg,{extShifts:r.solution.autoExtShifts,handoffs:r.solution.handoffs,
 empTimeOffDays:c.buildTimeOffAvailability(i.timeOffReqs || [],i.weekStart),ptoHoursByEmployee:c.buildPtoCredits(i.employees,i.timeOffReqs || [],i.weekStart).hoursByEmployee,
 empPatterns:c.boundaryPatterns(i.history || [],i.weekStart,i.empPatterns || {})});
const oneDay=ids=>ids.map(id=>e(id,{availableDaysOfWeek:['Sunday'],requiredShift:'second'}));
function fullWeek() {
 const text=fs.readFileSync(__dirname+'/test-publication.js','utf8'),start=text.indexOf('const week='),end=text.indexOf('function overtimeFixture');
 const fixture=new Function(...Object.keys(c),text.slice(start,end)+'return fixture;')(...Object.values(c));
 const v=fixture();return {...v,history:[v.previousWeek]};
}
test('a complete qualified 68-duty week is found and independently passes publication checks',()=>{
 const i=fullWeek(),r=solve(i);assert.equal(r.status,'feasible');assert.equal(r.phase,'regular-hours');assert.equal(Object.values(r.solution.ns).flat().length,68);
 const snap=c.publicationSnapshot({...i,schedule:r.solution.ns,extShifts:r.solution.autoExtShifts,handoffs:r.solution.handoffs});assert(c.validatePublication(snap).ok);assert.deepEqual(policy(r,i),[]);
});
test('one-step slices retain the frontier instead of imposing a total search cutoff',()=>{
 const search=c.createCompleteScheduleSearch(input(oneDay(['a','b','c'])));let result=search.advance({maxSteps:1});assert.equal(result.status,'searching');
 let calls=1;while(result.status==='searching'){result=search.advance({maxSteps:1});calls++;assert(calls<10000);}
 assert.equal(result.status,'feasible');assert(calls>10);assert.equal(result.steps,calls);
});
test('cancelling is terminal and never reported as infeasible',()=>{
 const s=c.createCompleteScheduleSearch(input(oneDay(['a','b'])));s.advance({maxSteps:1});const r=s.cancel();assert.equal(r.status,'cancelled');assert.equal(s.advance().status,'cancelled');assert.equal(r.solution,null);
});
test('search owns its inputs and returned snapshots cannot mutate its state',()=>{
 const i=input(oneDay(['a','b','c'])),s=c.createCompleteScheduleSearch(i);i.employees=[];const r=finish(s);assert.equal(r.status,'feasible');r.solution.ns.Sunday__second=[];assert.equal(s.snapshot().solution.ns.Sunday__second.length,3);
});
test('missing staff, missing qualifications and a missing fourth supervisor are proven within the menu',()=>{
 assert.equal(solve(input(oneDay(['a','b']))).status,'infeasible');
 assert.equal(solve(input(oneDay(['a','b','c']).map(v=>({...v,qualifications:['Guard']})))).status,'infeasible');
 const i=input(['a','b','c','d'].map(id=>e(id,{requiredShift:'first',availableDaysOfWeek:['Monday']})),{targetSlots:['Monday__first']});assert.equal(solve(i).status,'infeasible');
});
test('dual qualifications satisfy both critical roles while three distinct people remain required',()=>{
 const i=input(oneDay(['dual','g1','g2']).map((v,n)=>n?{...v,qualifications:['Guard']}:v)),r=solve(i);assert.equal(r.status,'feasible');assert(c.analyzeShiftCoverage('Sunday','second',r.solution.ns,i.employees).ok);
});
test('No OT prevents making up an employee shortage with extra credited hours',()=>{
 const i=fullWeek();i.employees=i.employees.filter(v=>!v.id.startsWith('third-1'));const r=solve(i);assert.equal(r.status,'infeasible');assert.equal(r.solution,null);
});
test('an overtime-only full week is found only in the review phase and still requires approval',()=>{
 const i=fullWeek();i.employees=i.employees.filter(v=>!v.id.startsWith('third-1'));
 for(const v of i.employees.filter(v=>v.id.startsWith('third-0'))){v.availableDaysOfWeek=c.DAYS;v.maxShiftsPerWeek=7;v.overtimePref='preferred';}
 i.cfg.maxConsecutiveNights=7;i.cfg.maxConsecutiveShifts=7;
 const r=solve(i);assert.equal(r.status,'feasible');assert.equal(r.phase,'overtime-review');assert(c.overtimeReviewItems(i.employees,{},r.solution,i.cfg).length>0);assert(c.overtimeReviewItems(i.employees,{},r.solution,i.cfg).every(v=>v.newHours>40 && !v.blocked));
 assert.deepEqual(policy(r,i),[]);const s=c.publicationSnapshot({...i,schedule:r.solution.ns,extShifts:r.solution.autoExtShifts,handoffs:r.solution.handoffs});assert(c.validatePublication(s).issues.some(v=>v.type==='publication_overtime'));
});
test('PTO is credited toward every full-time minimum and the absolute No OT ceiling',()=>{
 const roster=oneDay(['ft','b','c']);roster[0].employmentType='full-time';
 const i=input(roster,{timeOffReqs:[{id:'leave',empId:'ft',type:'single_day',startDate:'2026-09-07',endDate:'2026-09-07',status:'approved',paid:true,ptoHoursByDate:{'2026-09-07':24}},
 {id:'leave2',empId:'ft',type:'single_day',startDate:'2026-09-08',endDate:'2026-09-08',status:'approved',paid:true,ptoHoursByDate:{'2026-09-08':8}}]});
 const r=solve(i);assert.equal(r.status,'feasible');const h=c.weeklyEmployeeHours(roster[0],r.solution.ns,r.solution.autoExtShifts,r.solution.handoffs,{ft:32});assert.equal(h.creditedHours,40);
});
test('excluded full-time employees remain accountable and fixed duties survive',()=>{
 const roster=oneDay(['ft','b','c','d']);roster[0].employmentType='full-time';
 const i=input(roster,{excludedIds:['ft']});assert.equal(solve(i).status,'infeasible');
 const fixed=input(oneDay(['a','b','c']),{excludedIds:['a'],schedule:{Sunday__second:[a('a','Medical',false)]}}),r=solve(fixed);assert.equal(r.status,'feasible');assert(r.solution.ns.Sunday__second.some(v=>v.employeeId==='a'&&v.position==='Medical'));
});
test('unlocked assignments may move through chains longer than the old two-move repair',()=>{
 const days=c.DAYS.slice(0,5),roster=[],schedule={};
 for(let n=0;n<5;n++) {
  roster.push(e('flex'+n,{maxShiftsPerWeek:1,requiredShift:'second',availableDaysOfWeek:n===4?[days[n]]:[days[n],days[n+1]]}));
  for(let k=0;k<2;k++){const id=days[n]+k;roster.push(e(id,{maxShiftsPerWeek:1,requiredShift:'second',availableDaysOfWeek:[days[n]]}));(schedule[days[n]+'__second'] ||= []).push(a(id));}
  if(n>0)schedule[days[n]+'__second'].push(a('flex'+(n-1),'Guard',false));
 }
 const i=input(roster,{schedule,targetSlots:days.map(d=>d+'__second')}),r=solve(i);assert.equal(r.status,'feasible');
 for(let n=0;n<5;n++)assert(r.solution.ns[days[n]+'__second'].some(v=>v.employeeId==='flex'+n));assert.deepEqual(policy(r,i),[]);
});
test('eligible 12-hour halves can provide continuous coverage that regular duties cannot',()=>{
 const roster=[...oneDay(['scale','guard']),e('early',{qualifications:['Medical'],requiredShift:'first',ext12hPref:'day'}),e('late',{qualifications:['Medical'],requiredShift:'third',ext12hPref:'night'})];
 const timeOffReqs=[{id:'early-end',empId:'early',type:'partial',status:'approved',startDate:'2026-09-06',endDate:'2026-09-06',startTime:'18:00',endTime:'22:00',paid:false},
 {id:'late-start',empId:'late',type:'partial',status:'approved',startDate:'2026-09-06',endDate:'2026-09-06',startTime:'14:00',endTime:'18:00',paid:false}];
 roster[0].qualifications=['Scale'];roster[1].qualifications=['Guard'];
 const i=input(roster,{timeOffReqs}),r=solve(i);assert.equal(r.status,'feasible');assert(r.solution.autoExtShifts.length>=2);assert(c.analyzeShiftCoverage('Sunday','second',r.solution.ns,roster,r.solution.autoExtShifts,r.solution.handoffs).ok);assert.deepEqual(policy(r,i),[]);
});
test('adjoining handoffs are searched together with their source duties',()=>{
 const roster=[...oneDay(['scale','guard']),e('early',{qualifications:['Medical'],willing16h:true,requiredShift:'first',canWorkOtherShifts:true}),e('late',{qualifications:['Medical'],willing16h:true,requiredShift:'third',canWorkOtherShifts:true})];
 roster[0].qualifications=['Scale'];roster[1].qualifications=['Guard'];
 const timeOffReqs=[{id:'early-end',empId:'early',type:'partial',status:'approved',startDate:'2026-09-06',endDate:'2026-09-06',startTime:'18:00',endTime:'22:00',paid:false},
 {id:'late-start',empId:'late',type:'partial',status:'approved',startDate:'2026-09-06',endDate:'2026-09-06',startTime:'14:00',endTime:'18:00',paid:false}];
 const i=input(roster,{timeOffReqs}),r=solve(i);assert.equal(r.status,'feasible');assert(r.solution.handoffs.length>=2);assert.deepEqual(policy(r,i),[]);
});
test('locked custom handoffs and their legal source remain intact',()=>{
 const roster=oneDay(['a','b']);roster.push(e('source',{willing16h:true}),e('late',{willing16h:true}));
 const h={day:'Sunday',employeeId:'source',sourceShiftId:'first',targetShiftId:'second',type:'late-stay',position:'Medical',hours:2,locked:true};
 // The other six hours need a complementary duty, not a third full-shift
 // employee overlapping the locked two-hour handoff.
 const other={day:'Sunday',employeeId:'late',sourceShiftId:'third',targetShiftId:'second',type:'early-arrival',position:'Medical',hours:6,locked:true};
 const i=input(roster,{schedule:{Sunday__first:[a('source','Medical',false)],Sunday__third:[a('late','Medical',false)]},handoffs:[h,other]}),r=solve(i);assert.equal(r.status,'feasible');assert(r.solution.handoffs.some(v=>JSON.stringify(v)===JSON.stringify(JSON.parse(c.canonicalJSON(h)))));
 assert.equal(c.lockedDutyIssues(i.schedule,r.solution.ns,{handoffs:i.handoffs},{handoffs:r.solution.handoffs,extShifts:r.solution.autoExtShifts}).length,0);assert.deepEqual(policy(r,i),[]);
});
test('invalid approved PTO or availability is an input error, never an infeasibility proof',()=>{
 const i=input(oneDay(['a','b','c']),{timeOffReqs:[{id:'bad',empId:'a',status:'approved',type:'partial',startDate:'bad'}]});assert.equal(solve(i).status,'invalid');
 assert.equal(solve(input(oneDay(['a','b','c']),{cfg:{maxConsecutiveShifts:14}})).status,'invalid');
});
test('previous-week work is included in hard rest checks',()=>{
 const roster=oneDay(['a','b','c']),i=input(roster,{targetSlots:['Sunday__first'],employees:roster.map(v=>({...v,requiredShift:'first'})),history:[{weekStart:'2026-08-30',schedule:{Saturday__third:[a('a','Guard',false)]}}]});
 assert.equal(solve(i).status,'infeasible');
});
// Independent tiny oracle: exhaust every three-person staffing combination in
// three slots. This checks pruning/search completeness against all regular-only
// solutions, rather than reproducing the solver's branching implementation.
test('complete-search feasibility agrees with an exhaustive oracle on 24 constrained rosters',()=>{
 const days=['Sunday','Monday','Tuesday'],comb=[];for(let a=0;a<5;a++)for(let b=a+1;b<5;b++)for(let d=b+1;d<5;d++)comb.push([a,b,d]);
 let seed=19573;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
 for(let trial=0;trial<24;trial++) {
  const roster=Array.from({length:5},(_,n)=>e('e'+n,{requiredShift:'second',maxShiftsPerWeek:rand()<.5?1:3,availableDaysOfWeek:days.filter(()=>rand()<.8),qualifications:n<2?['Guard','Scale','Medical']:['Guard']}));
  // Empty availableDaysOfWeek means unrestricted in the application.
  let expected=false;
  outer:for(const x of comb)for(const y of comb)for(const z of comb){const s=Object.fromEntries([x,y,z].map((ids,j)=>[days[j]+'__second',ids.map(n=>a('e'+n,'Guard',false))]));
   if(days.every(day=>c.analyzeShiftCoverage(day,'second',s,roster).ok)&&!c.validateAssignmentPolicy(s,roster,input(roster).cfg).length){expected=true;break outer;}}
  const r=solve(input(roster,{targetSlots:days.map(d=>d+'__second')}));assert.equal(r.status==='feasible',expected,'oracle mismatch trial '+trial);assert(['feasible','infeasible'].includes(r.status));
 }
});
function uiHarness(result={status:'searching',phase:'regular-hours',nodes:1,candidates:1,reasons:[],solution:null},overrides={}) {
 const queue=[],events=[],ref={current:null},stamp={current:'base'},cancel={current:false};let advances=0;
 const fake={snapshot:()=>result,advance:()=>{advances++;return result;},cancel:()=>({...result,status:'cancelled'})};
 const scope={...c,isReadOnly:false,generationInputsReady:true,pendingProposal:null,employees:oneDay(['a','b','c']),weekStart:'2026-09-06',cfg:{},schedule:{},extShifts:[],handoffs:[],trainingBlocks:[],timeOffReqs:[],history:[],empPatterns:{},afExclude:[],fairnessHistory:{},ptoHoursByEmployee:{},
  completeSearchRef:ref,overtimeInputRef:stamp,autoFillCancelRef:cancel,autoFillRunning:false,
  createCompleteScheduleSearch:()=>fake,setAutoFillRunning:v=>events.push(['running',v]),setAutoFillProgress:v=>events.push(['progress',v]),
  showAlert:v=>events.push(['alert',v]),validateSchedule:()=>[],proposalIsCurrent:p=>p.baseStamp===stamp.current,discardStaleProposal:()=>events.push(['stale']),
  setPendingProposal:p=>events.push(['pending',p]),commitScheduleProposal:p=>events.push(['commit',p]),setTimeout:f=>queue.push(f),...overrides};
 const start=html.indexOf('  const startCompleteSearch ='),end=html.indexOf('  const runAutoFill =',start);
 const ui=new Function(...Object.keys(scope),html.slice(start,end)+'return {startCompleteSearch,resumeCompleteSearch,cancelCompleteSearch};')(...Object.values(scope));
 return {ui,events,queue,ref,stamp,cancel,get advances(){return advances;}};
}
test('production pause and resume keep the same frontier, and cancel reports unknown feasibility',()=>{
 const h=uiHarness();h.ui.startCompleteSearch();const job=h.ref.current;h.cancel.current=true;h.queue.shift()();assert.equal(h.advances,0);assert.equal(job.paused,true);
 h.ui.resumeCompleteSearch();h.queue.shift()();assert.equal(h.ref.current,job);assert.equal(h.advances,1);
 h.ui.cancelCompleteSearch();assert.equal(h.ref.current,null);assert.equal(h.events.at(-1)[1].status,'cancelled');
 while(h.queue.length)h.queue.shift()();assert.equal(h.advances,1);
});
test('production search discards changed-input and unmounted results before applying a candidate',()=>{
 const h=uiHarness();h.ui.startCompleteSearch();h.stamp.current='edited';h.queue.shift()();assert.equal(h.advances,0);assert.equal(h.events.at(-1)[1].status,'stale');assert(!h.events.some(e=>['commit','pending'].includes(e[0])));
 const removed=uiHarness();removed.ui.startCompleteSearch();removed.ref.current=null;removed.queue.shift()();assert.equal(removed.advances,0);
});
test('production complete candidates use ordinary proposal commit and overtime staging',()=>{
 const solution={ns:{Sunday__second:oneDay(['a','b','c']).map(v=>a(v.id,'Guard',false))},autoExtShifts:[],handoffs:[],usedPatterns:{}};
 const h=uiHarness({status:'feasible',phase:'regular-hours',solution});h.ui.startCompleteSearch();h.queue.shift()();assert.equal(h.events.filter(e=>e[0]==='commit').length,1);
 solution.ns=Object.fromEntries(c.DAYS.slice(0,6).map(day=>[day+'__second',[a('a','Guard',false)]]));
 const overtime=uiHarness({status:'feasible',phase:'overtime-review',solution});overtime.ui.startCompleteSearch();overtime.queue.shift()();assert(!overtime.events.some(e=>e[0]==='commit'));assert.equal(overtime.events.find(e=>e[0]==='pending')[1].reviewItems[0].newHours,48);
});
test('production infeasibility leaves the current draft untouched',()=>{
 const h=uiHarness({status:'infeasible',phase:'regular-hours',solution:null,reasons:['exhausted']});h.ui.startCompleteSearch();h.queue.shift()();assert(!h.events.some(e=>['commit','pending'].includes(e[0])));assert.equal(h.events.at(-1)[1].status,'infeasible');
});
test('a heuristic plateau hands off to complete search without committing the incomplete candidate',()=>{
 const start=html.indexOf('      if (attemptNum >= MAX_ATTEMPTS || plateauCount >= PLATEAU_LIMIT) {'),end=html.indexOf('      setTimeout(tick, 0);',start);const calls=[];const best={ns:{},errors:2};
 new Function('attemptNum','MAX_ATTEMPTS','plateauCount','PLATEAU_LIMIT','proposalIsCurrent','runBaseStamp','startCompleteSearch','accountingRoster','discardStaleProposal','setAutoFillRunning','best',html.slice(start,end))(10,10,3,3,()=>true,'base',(...args)=>calls.push(args),[],()=>assert.fail('stale'),()=>{},best);
 assert.equal(calls.length,1);
 assert.equal(calls[0][1],best,'the best heuristic draft is handed over as the fallback, not committed here');
});
const fallbackDraft=()=>({ns:{Sunday__second:oneDay(['a','b','c']).map(v=>a(v.id,'Guard',false))},autoExtShifts:[],handoffs:[],usedPatterns:{},errors:1});
test('an infeasible complete search applies the heuristic fallback draft instead of leaving the grid empty',()=>{
 const fb=fallbackDraft(),h=uiHarness({status:'infeasible',phase:'regular-hours',solution:null,reasons:['exhausted']});
 h.ui.startCompleteSearch(undefined,fb);h.queue.shift()();
 const commit=h.events.find(e=>e[0]==='commit');
 assert(commit,'fallback committed');assert.deepEqual(commit[1].ns,fb.ns);
 const last=h.events.filter(e=>e[0]==='progress').at(-1)[1];
 assert.equal(last.status,'infeasible');assert.equal(last.fallbackApplied,true);assert.equal(last.fallbackErrors,1);
});
test('a fallback draft that needs overtime goes through the approval step, not straight to the grid',()=>{
 const fb=fallbackDraft();fb.ns=Object.fromEntries(c.DAYS.slice(0,6).map(day=>[day+'__second',[a('a','Guard',false)]]));
 const h=uiHarness({status:'infeasible',phase:'overtime-review',solution:null,reasons:['exhausted']});
 h.ui.startCompleteSearch(undefined,fb);h.queue.shift()();
 assert(!h.events.some(e=>e[0]==='commit'));assert.equal(h.events.find(e=>e[0]==='pending')[1].reviewItems[0].newHours,48);
});
test('a validator-rejected complete candidate falls back to the heuristic draft',()=>{
 const solution={ns:{Sunday__second:[]},autoExtShifts:[],handoffs:[],usedPatterns:{}},fb=fallbackDraft();
 const h=uiHarness({status:'feasible',phase:'regular-hours',solution},{validateSchedule:(ns)=>ns===solution.ns?[{level:'error',msg:'bad'}]:[]});
 h.ui.startCompleteSearch(undefined,fb);h.queue.shift()();
 const commits=h.events.filter(e=>e[0]==='commit');
 assert.equal(commits.length,1);assert.deepEqual(commits[0][1].ns,fb.ns);
 assert.equal(h.events.filter(e=>e[0]==='progress').at(-1)[1].status,'invalid');
});
test('stale or cancelled searches never apply the fallback draft',()=>{
 const stale=uiHarness();stale.ui.startCompleteSearch(undefined,fallbackDraft());stale.stamp.current='edited';stale.queue.shift()();
 assert(!stale.events.some(e=>['commit','pending'].includes(e[0])));
 const cancelled=uiHarness();cancelled.ui.startCompleteSearch(undefined,fallbackDraft());cancelled.ui.cancelCompleteSearch();
 while(cancelled.queue.length)cancelled.queue.shift()();
 assert(!cancelled.events.some(e=>['commit','pending'].includes(e[0])));
});
test('fixed excluded overtime is still a reviewable combination when no editable employee wants OT',()=>{
 const roster=oneDay(['a','b','fixed']);roster[2]={...roster[2],requiredShift:null,availableDaysOfWeek:c.DAYS,overtimePref:'preferred'};
 const schedule=Object.fromEntries(c.DAYS.slice(0,6).map(day=>[day+'__second',[a('fixed','Guard',false)]]));
 const i=input(roster,{cfg:{minRestHours:12,maxConsecutiveShifts:7,maxConsecutiveNights:7},schedule,excludedIds:['fixed']}),r=solve(i);
 assert.equal(r.status,'feasible');assert.equal(r.phase,'overtime-review');assert.equal(c.weeklyEmployeeHours(roster[2],r.solution.ns).creditedHours,48);
});
test('capacity bounds account for rest windows and weekly duty caps without excluding doubles',()=>{
 const spans=[{start:54,end:102}],emp=e('two-days',{willing16h:true});assert.equal(c.completeSearchWorkUpperBound(spans,emp,{minRestHours:8}),32);
 assert.equal(c.completeSearchWorkUpperBound([{start:6,end:174}],e('one-duty',{maxShiftsPerWeek:1}),{minRestHours:8}),8);
 assert.equal(c.completeSearchWorkUpperBound([{start:6,end:22}],emp,{minRestHours:12}),16);
 assert.equal(c.completeSearchWorkUpperBound([{start:6,end:14},{start:30,end:38}],e('regular'),{minRestHours:12}),16);
});
test('short rest that can be bridged is not pruned before its extension is considered',()=>{
 const emp=e('bridge',{willing16h:true,swingEligible:['swing-10a-10p']}),state={ns:{Sunday__second:[a('bridge','Guard',false)]},autoExtShifts:[],handoffs:[]};
 const options={empPatterns:{bridge:{prevWorkIntervals:[{start:6,end:10}]}}};
 assert(c.employeePolicyIssues(emp,state.ns,{minRestHours:12},options).some(i=>i.type==='short_rest'));
 assert.equal(c.completeSearchHardIssues(emp,state,{minRestHours:12},options).length,0);
 const h={day:'Sunday',employeeId:'bridge',sourceShiftId:'second',targetShiftId:'first',type:'early-arrival',position:'Guard',hours:4};
 assert.equal(c.employeePolicyIssues(emp,state.ns,{minRestHours:12},{...options,handoffs:[h]}).length,0);
});
test('same-day split blocks can be bridged only within the continuous-hours cap',()=>{
 const emp=e('bridge',{willing16h:true}),state={ns:{Sunday__second:[a('bridge','Guard',false)]},autoExtShifts:[],handoffs:[]};
 const options={empPatterns:{bridge:{prevWorkIntervals:[{start:6,end:10}]}}};
 assert(c.employeePolicyIssues(emp,state.ns,{minRestHours:0},options).some(i=>i.type==='split_double'));
 assert.deepEqual(c.completeSearchHardIssues(emp,state,{minRestHours:0},options),[]);
 const split={ns:{Sunday__first:[a('bridge')],Sunday__third:[a('bridge')]},autoExtShifts:[],handoffs:[]};
 assert(c.completeSearchHardIssues(emp,split,{minRestHours:8},{}).some(i=>i.type==='split_double'));
});
test('search distributes forty hours across five days instead of first and third on one day',()=>{
 const targetSlots=['Sunday__first','Sunday__third','Monday__second','Tuesday__second','Thursday__second','Friday__second'];
 const roster=[e('ft',{employmentType:'full-time',willing16h:true}),e('relief')],schedule={};
 for(const key of targetSlots) {
  schedule[key]=[];
  for(let n=0;n<2;n++) { const id=key+n;roster.push(e(id));schedule[key].push(a(id)); }
 }
 // The imported draft totals forty hours with three days off. Unlocked work
 // must be rebuilt while the two locked colleagues in every slot stay put.
 for(const key of targetSlots.slice(0,5))schedule[key].push(a('ft','Guard',false));
 const i=input(roster,{targetSlots,schedule,cfg:{minRestHours:8,maxConsecutiveShifts:5,maxConsecutiveNights:4}}),r=solve(i);
 assert.equal(r.status,'feasible');assert.deepEqual(policy(r,i),[]);
 assert.equal(c.normalizedWorkedHours('ft',r.solution.ns),40);
 const days=Object.entries(r.solution.ns).filter(([,rows])=>rows.some(v=>v.employeeId==='ft')).map(([key])=>key.split('__')[0]);
 assert.equal(new Set(days).size,5);
 for(const key of targetSlots)assert(c.analyzeShiftCoverage(...key.split('__'),r.solution.ns,roster).ok);
});
test('locked extended halves and regular mirrors preserve the exact locked record',()=>{
 const roster=oneDay(['a','b']);roster.push(e('extended',{requiredShift:'first',ext12hPref:'day'}),e('late',{requiredShift:'third',ext12hPref:'night'}));
 const ext={day:'Sunday',pairId:'day',empAId:'extended',empBId:null,roles:['Scale','Medical'],locked:true};
 const i=input(roster,{extShifts:[ext],schedule:{Sunday__first:[a('extended','Medical')]}}),r=solve(i);
 assert.equal(r.status,'feasible');assert.deepEqual(r.solution.autoExtShifts.find(v=>v.locked),ext);
 assert.equal(c.lockedDutyIssues(i.schedule,r.solution.ns,{extShifts:i.extShifts},{extShifts:r.solution.autoExtShifts,handoffs:r.solution.handoffs}).length,0);
});
test('the anonymized 15-person operational roster gets complete coverage and all FT hours',()=>{
 const i=JSON.parse(fs.readFileSync(__dirname+'/fixtures/complete-search-roster.json','utf8')),r=solve(i);assert.equal(r.status,'feasible');assert.equal(r.phase,'overtime-review');
 assert.equal(c.validateCoverage(r.solution.ns,i.employees,r.solution.autoExtShifts,r.solution.handoffs).length,0);assert.deepEqual(policy(r,i),[]);
 const accounting=c.buildWeeklyAccounting(i.employees,r.solution.ns,r.solution.autoExtShifts,r.solution.handoffs,[],i.weekStart);assert.equal(accounting.rows.length,15);assert.equal(accounting.issues.filter(v=>v.level==='error').length,0);
 assert(c.overtimeReviewItems(i.employees,{},r.solution,i.cfg).length>0);
});
test('unlocking a duty can change a proven locked-week conflict into a feasible schedule',()=>{
 const roster=[e('scale',{qualifications:['Scale']}),e('guard',{qualifications:['Guard']}),e('med',{qualifications:['Medical'],requiredShift:'second',maxShiftsPerWeek:1,availableDaysOfWeek:['Sunday','Monday']})];
 const i=input(roster,{schedule:{Sunday__second:[a('scale','Scale'),a('guard')],Monday__second:[a('med','Medical')]}});assert.equal(solve(i).status,'infeasible');
 i.schedule.Monday__second[0].locked=false;const r=solve(i);assert.equal(r.status,'feasible');assert(r.solution.ns.Sunday__second.some(v=>v.employeeId==='med'));
});
test('preferences guide equivalent choices without preventing a necessary unpreferred assignment',()=>{
 const roster=[e('scale',{qualifications:['Scale']}),e('medical',{qualifications:['Medical']}),e('preferred',{qualifications:['Guard'],preferredShifts:['second']}),e('other',{qualifications:['Guard'],preferredShifts:['first']})];
 const i=input(roster,{schedule:{Sunday__second:[a('scale','Scale'),a('medical','Medical')]}});assert(solve(i).solution.ns.Sunday__second.some(v=>v.employeeId==='preferred'));
 roster[2].unavailableDays=['Sunday'];const r=solve(i);assert.equal(r.status,'feasible');assert(r.solution.ns.Sunday__second.some(v=>v.employeeId==='other'));
});
test('the relaxed review phase never overrides a No OT employee',()=>{
 const days=c.DAYS.slice(0,6),roster=[e('scale',{qualifications:['Scale'],overtimePref:'neutral'}),e('guard',{qualifications:['Guard'],overtimePref:'neutral'}),e('med',{qualifications:['Medical'],requiredShift:'second'})];
 const schedule=Object.fromEntries(days.map(day=>[day+'__second',[a('scale','Scale'),a('guard')]]));
 const i=input(roster,{schedule,targetSlots:days.map(d=>d+'__second'),cfg:{minRestHours:12,maxConsecutiveShifts:7,maxConsecutiveNights:7}}),r=solve(i);assert.equal(r.status,'infeasible');assert.equal(r.phase,'overtime-review');
});
