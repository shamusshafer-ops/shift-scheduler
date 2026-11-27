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
 const i=input(roster,{timeOffReqs}),r=solve(i);assert.equal(r.status,'feasible');// A 12h half or the same hours as a late stay / early arrival (equally legal).
 assert(r.solution.autoExtShifts.length+r.solution.handoffs.length>=2);assert(c.analyzeShiftCoverage('Sunday','second',r.solution.ns,roster,r.solution.autoExtShifts,r.solution.handoffs).ok);assert.deepEqual(policy(r,i),[]);
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
// The page's optimizer wiring (startCompleteSearch ... cancelCompleteSearch),
// with createOptimizerRunner replaced by a fake whose updates the test emits.
function uiHarness(overrides={}) {
 const queue=[],events=[],ref={current:null},stamp={current:'base'},cancel={current:false},found={current:null},calls=[];let onUpdate=null,data=null;
 const fakeRunner=(d,opts)=>{data=d;onUpdate=opts.onUpdate;const r={usesWorker:false};
  for(const m of ['start','pause','resume','useBest','cancel','terminate'])r[m]=()=>calls.push(m);return r;};
 const scope={...c,isReadOnly:false,generationInputsReady:true,pendingProposal:null,employees:oneDay(['a','b','c']),weekStart:'2026-09-06',cfg:{},schedule:{},extShifts:[],handoffs:[],trainingBlocks:[],timeOffReqs:[],
  weekAvailability:null,history:[],empPatterns:{},afExclude:[],fairnessHistory:{},optimizerMode:'balanced',ptoHoursByEmployee:{},makeOptimizerWorker:()=>null,
  completeSearchRef:ref,overtimeInputRef:stamp,autoFillCancelRef:cancel,autoFillRunning:false,
  createOptimizerRunner:fakeRunner,setAutoFillRunning:v=>events.push(['running',v]),setAutoFillProgress:v=>events.push(['progress',v]),
  showAlert:v=>events.push(['alert',v]),validateSchedule:()=>[],proposalIsCurrent:p=>p.baseStamp===stamp.current,discardStaleProposal:()=>events.push(['stale']),
  setPendingProposal:p=>events.push(['pending',p]),commitScheduleProposal:p=>events.push(['commit',p]),setTimeout:f=>queue.push(f),
  liveRulesStamp:'rules',setFoundWeeks:v=>{found.current=typeof v==='function'?v(found.current):v;},setPreviewWeek:()=>{},...overrides};
 const start=html.indexOf('  const startCompleteSearch ='),end=html.indexOf('  const runAutoFill =',start);
 const ui=new Function(...Object.keys(scope),html.slice(start,end)+'return {startCompleteSearch,resumeCompleteSearch,cancelCompleteSearch,applyFoundWeek};')(...Object.values(scope));
 const last=()=>{const v=events.filter(e=>e[0]==='progress').at(-1)?.[1];return typeof v==='function'?v({}):v;};
 return {ui,events,queue,ref,stamp,cancel,found,calls,emit:(snap,kind)=>onUpdate(snap,kind),get data(){return data;},last};
}
// A pool entry as the optimizer reports it.
const entry=(id,week,{origin='rebuild:day',complete=true,errors=0,quality=Array(14).fill(0)}={})=>({id,origin,label:origin,week,complete,errors,warnings:0,quality,foundAtMs:1,details:{maxOvertime:0}});
const snap=(best,candidates=[best],extra={})=>({status:'running',best,candidates,proof:{kind:'best-found',text:'x'},...extra});
// relaysDone: the one relay-repair pass on the best week has already run.
function handOff(best,complete,attemptNum=10,relaysDone=true) {
 const start=html.indexOf('      if (complete || attemptNum >= MAX_ATTEMPTS || plateauCount >= PLATEAU_LIMIT) {'),end=html.indexOf('\n      setTimeout(tick, 0);\n',start);const calls=[];
 const state={post:null,ticks:0};
 new Function('complete','q','QUALITY','attemptNum','MAX_ATTEMPTS','plateauCount','PLATEAU_LIMIT','proposalIsCurrent','runBaseStamp','startCompleteSearch','accountingRoster','discardStaleProposal','setAutoFillRunning','best','relaysDone','state','setAutoFillProgress','setTimeout','tick',
  'let post=null;try{'+html.slice(start,end)+'\n}finally{state.post=post;}')(complete,best.quality,c.QUALITY,attemptNum,10,attemptNum>=10?3:0,3,()=>true,'base',(...args)=>calls.push(args),[],()=>assert.fail('stale'),()=>{},best,relaysDone,state,()=>{},()=>{state.ticks++;},()=>{});
 calls.state=state;
 return calls;
}
test('an unfinished best week gets one relay-repair pass before the complete search',()=>{
 const best={ns:{},errors:2,quality:[0,8,8,0,0,0,0,0,0]},calls=handOff(best,false,10,false);
 assert.equal(calls.length,0,'the complete search waits for the relay pass');
 assert.equal(calls.state.post.stage,'relays');assert.equal(calls.state.post.final,true);assert.equal(calls.state.post.result,best);
 assert.equal(calls.state.ticks,1);
});
test('a heuristic plateau hands off to complete search without committing the incomplete candidate',()=>{
 const best={ns:{},errors:2,quality:[0,8,8,0,0,0,0,0,0]},calls=handOff(best,false);
 assert.equal(calls.length,1);
 assert.equal(calls[0][1],best,'the best heuristic draft is handed over as the fallback, not committed here');
 assert.equal(calls[0][2],undefined,'an incomplete draft does not bound the overtime search');
});
test('a complete autofill week hands off to the search, bounded by its own days off and overtime',()=>{
 const best={ns:{},errors:0,quality:[0,0,0,0,0,2,104,24,0]},calls=handOff(best,true,1);
 assert.equal(calls.length,1);assert.equal(calls[0][1],best);assert.deepEqual(calls[0][2],{supervisorExtensions:0,withoutDayOff:2,overtime:104});
});
const fallbackDraft=()=>({ns:{Sunday__second:oneDay(['a','b','c']).map(v=>a(v.id,'Guard',false))},autoExtShifts:[],handoffs:[],usedPatterns:{},errors:1});
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
// ── Overtime optimization (branch and bound) ────────────────────────────────
function overtimeWeek() {
 const i=fullWeek();i.employees=i.employees.filter(v=>!v.id.startsWith('third-1'));
 for(const v of i.employees.filter(v=>v.id.startsWith('third-0'))){v.availableDaysOfWeek=c.DAYS;v.maxShiftsPerWeek=7;v.overtimePref='preferred';}
 i.cfg.maxConsecutiveNights=7;i.cfg.maxConsecutiveShifts=7;return i;
}
const totalOvertime=(i,s)=>i.employees.reduce((n,v)=>n+Math.max(0,c.weeklyEmployeeHours(v,s.ns,s.autoExtShifts,s.handoffs).creditedHours-40),0);
test('optimizing finds less overtime than the first complete week, proves it, and its week passes policy',()=>{
 const i=overtimeWeek(),plain=solve(i),best=finish(c.createCompleteScheduleSearch({...i,optimizeOvertime:true}),60000);
 assert.equal(best.status,'feasible');assert(best.optimization.proven);
 // The first complete week on this fixture carries 32h; the minimum is 8h.
 assert(totalOvertime(i,best.solution)<totalOvertime(i,plain.solution));
 assert.equal(best.optimization.bestOvertime,totalOvertime(i,best.solution));
 assert.deepEqual(policy(best,i),[]);
 const again=finish(c.createCompleteScheduleSearch({...i,optimizeOvertime:true,overtimeBudget:best.optimization.bestOvertime,withoutDayOffBudget:best.optimization.bestWithoutDayOff}),60000);
 assert.equal(again.status,'no-better','a proven minimum cannot be beaten');assert.equal(again.solution,null);
});
test('the overtime floor counts every coverage hour and each person\'s room under 40',()=>{
 const guards=Array.from({length:12},(_,n)=>e('g'+n,{employmentType:'full-time',qualifications:['Guard']}));
 assert.equal(c.overtimeLowerBound(guards),544-12*40);
 const pt=e('pt',{requiredShift:'second',maxShiftsPerWeek:2,qualifications:['Guard']});
 assert.equal(c.overtimeLowerBound([...guards.slice(0,11),pt]),544-11*40-16,'a second-shift-only part-timer without swings adds 16h');
 assert.equal(c.overtimeLowerBound(guards,{ptoHoursByEmployee:{g0:16}}),544-12*40,'PTO never counts toward overtime, so it uses up no room under 40');
});
const incumbent=()=>({ns:{Sunday__second:oneDay(['a','b','c']).map(v=>a(v.id,'Guard',false))},autoExtShifts:[],handoffs:[],usedPatterns:{}});
test('a day off for everyone outranks overtime savings in the search',()=>{
 const i=overtimeWeek(),plain=solve(i),w=r=>c.employeesWithoutDayOff(i.employees,r.solution.ns,r.solution.autoExtShifts,r.solution.handoffs).length;
 assert.equal(w(plain),1,'the first complete week has someone working all seven days');
 // Seed with a (hypothetical) week that has no overtime but one person without a
 // day off: a week where everyone gets a day off must still count as better.
 const r=finish(c.createCompleteScheduleSearch({...i,optimizeOvertime:true,overtimeBudget:0,withoutDayOffBudget:1}),60000);
 assert.equal(r.status,'feasible');assert.equal(w(r),0);assert.equal(r.optimization.bestWithoutDayOff,0);
 assert(r.optimization.bestOvertime>0,'the day-off week is accepted despite more overtime than the seed');
});
test('the ranking and the issue list count seven-day weeks by the day each duty starts',()=>{
 const roster=[e('x')],ns=Object.fromEntries(c.DAYS.map(day=>[day+'__third',[a('x','Guard',false)]]));
 assert.deepEqual(c.employeesWithoutDayOff(roster,ns).map(v=>v.id),['x']);
 assert.equal(c.scheduleQuality({ns},roster)[c.QUALITY.noDayOff],1);
 delete ns.Wednesday__third;assert.equal(c.employeesWithoutDayOff(roster,ns).length,0,'Tuesday night ends Wednesday morning, but Wednesday is still a day off');
 assert(html.includes('has no day off this week'),'the issue list warns about it');
});
test('the supervisor stays late only when second shift cannot be completed without him',()=>{
 const p=(id,extra)=>e(id,{qualifications:['Guard'],availableDaysOfWeek:['Monday'],...extra});
 const roster=[p('sup',{qualifications:['Supervisor','Medical','Guard'],requiredShift:'first',canWorkOtherShifts:true,ext12hPref:'day'}),
  p('f1',{qualifications:['Scale','Medical'],requiredShift:'first'}),p('f2',{requiredShift:'first'}),p('f3',{requiredShift:'first'}),
  p('g1',{qualifications:['Scale','Guard'],requiredShift:'second'}),p('g2',{requiredShift:'second'}),
  // The only other Medic is needed on third shift and works one duty a week, so he
  // can cover second shift from 18:00 (early arrival) but not from 14:00.
  p('night',{qualifications:['Medical','Guard'],requiredShift:'third',canWorkOtherShifts:true,ext12hPref:'night',maxShiftsPerWeek:1}),
  p('n2',{qualifications:['Scale','Guard'],requiredShift:'third'}),p('n3',{requiredShift:'third'})];
 const i=input(roster,{targetSlots:['Monday__first','Monday__second','Monday__third'],cfg:{minRestHours:8,maxConsecutiveShifts:5,maxConsecutiveNights:4}});
 const r=finish(c.createCompleteScheduleSearch({...i,optimizeOvertime:true}),60000);
 assert.equal(r.status,'feasible');assert.equal(r.optimization.bestSupervisorExtensions,1,'no other Medic can cover 14:00-18:00');
 assert(r.solution.handoffs.some(h=>h.employeeId==='sup' && c.isSupervisorExtension(h)));assert.deepEqual(policy(r,i),[]);
 const withMedic=[...roster,p('m2',{qualifications:['Medical','Guard'],requiredShift:'second'})];
 const r2=finish(c.createCompleteScheduleSearch({...i,employees:withMedic,optimizeOvertime:true}),60000);
 assert.equal(r2.status,'feasible');assert.equal(r2.optimization.bestSupervisorExtensions,0,'a second-shift Medic is used instead');
});
test('production optimizer: pause, resume and cancel go to the runner; a cancelled run reports unknown feasibility',()=>{
 const h=uiHarness();h.ui.startCompleteSearch();assert.deepEqual(h.calls,['start']);const job=h.ref.current;
 assert.equal(JSON.stringify(h.data),JSON.stringify(JSON.parse(JSON.stringify(h.data))),'the worker receives plain data only');
 h.cancel.current=true;h.emit(snap(null,[]),'progress');assert.deepEqual(h.calls,['start','pause']);assert.equal(job.paused,true);
 h.ui.resumeCompleteSearch();assert.equal(h.calls.at(-1),'resume');assert.equal(h.ref.current,job);
 h.ui.cancelCompleteSearch();assert.equal(h.calls.at(-1),'cancel');assert.equal(h.ref.current,null);
 assert.equal(h.last().status,'cancelled');assert.match(h.last().reasons[0],/not known/);
 h.emit(snap(entry('w1',incumbent())),'done');assert(!h.events.some(e=>['commit','pending'].includes(e[0])),'late results after cancel are ignored');
});
test('production optimizer discards results after inputs change or after being replaced',()=>{
 const h=uiHarness();h.ui.startCompleteSearch(undefined,fallbackDraft());h.stamp.current='edited';h.emit(snap(entry('w1',incumbent())),'done');
 assert.equal(h.calls.at(-1),'cancel');assert.equal(h.last().status,'stale');assert(!h.events.some(e=>['commit','pending'].includes(e[0])));
 const replaced=uiHarness();replaced.ui.startCompleteSearch();replaced.ref.current=null;replaced.emit(snap(entry('w1',incumbent())),'done');
 assert.equal(replaced.calls.at(-1),'terminate');assert(!replaced.events.some(e=>['commit','pending'].includes(e[0])));
});
test('production optimizer: the best week commits normally, and overtime goes to approval',()=>{
 const h=uiHarness();h.ui.startCompleteSearch();h.emit(snap(entry('w1',incumbent())),'done');
 assert.equal(h.events.filter(e=>e[0]==='commit').length,1);assert.equal(h.last().applied,'optimizer');assert.equal(h.ref.current,null);
 const week={ns:Object.fromEntries(c.DAYS.slice(0,6).map(day=>[day+'__second',[a('a','Guard',false)]])),autoExtShifts:[],handoffs:[],usedPatterns:{}};
 const ot=uiHarness({employees:[e('a',{overtimePref:'preferred',availableDaysOfWeek:c.DAYS}),...['b','c'].map(id=>e(id))]});ot.ui.startCompleteSearch();ot.emit(snap(entry('w1',week)),'done');
 assert(!ot.events.some(e=>e[0]==='commit'));assert.equal(ot.events.find(e=>e[0]==='pending')[1].reviewItems[0].newHours,48);
});
test('production optimizer: with no complete week, the best draft is applied and the panel says it is incomplete',()=>{
 const fb=fallbackDraft(),h=uiHarness();h.ui.startCompleteSearch(undefined,fb);
 h.emit(snap(entry('a1',fb,{origin:'autofill',complete:false,errors:1}),undefined,{proof:{kind:'unknown',text:'unknown'}}),'done');
 const commit=h.events.find(e=>e[0]==='commit');assert(commit,'the draft is committed');assert.deepEqual(commit[1].ns,fb.ns);
 assert.equal(h.last().applied,'autofill');assert.equal(h.last().fallbackErrors,0,'counted by this page\'s validator');
 const none=uiHarness();none.ui.startCompleteSearch();none.emit(snap(null,[],{proof:{kind:'infeasible',text:'no'}}),'done');
 assert(!none.events.some(e=>['commit','pending'].includes(e[0])),'nothing to apply leaves the draft untouched');assert.equal(none.last().status,'invalid');
});
test('a draft that needs overtime goes through approval, not straight to the grid',()=>{
 const fb=fallbackDraft();fb.ns=Object.fromEntries(c.DAYS.slice(0,6).map(day=>[day+'__second',[a('a','Guard',false)]]));
 const h=uiHarness();h.ui.startCompleteSearch(undefined,fb);h.emit(snap(entry('a1',fb,{origin:'autofill',complete:false,errors:1})),'done');
 assert(!h.events.some(e=>e[0]==='commit'));assert.equal(h.events.find(e=>e[0]==='pending')[1].reviewItems[0].newHours,48);
});
test('a week the page\'s own validator rejects is never applied; the next valid candidate is',()=>{
 const bad=incumbent(),good=incumbent();good.ns.Sunday__second=good.ns.Sunday__second.slice().reverse();
 const h=uiHarness({validateSchedule:ns=>ns===bad.ns?[{level:'error',msg:'bad'}]:[]});h.ui.startCompleteSearch(undefined,fallbackDraft());
 h.emit(snap(entry('w1',bad),[entry('w1',bad),entry('w2',good)]),'done');
 const commits=h.events.filter(e=>e[0]==='commit');assert.equal(commits.length,1);assert.deepEqual(commits[0][1].ns,good.ns);
 assert.equal(h.found.current.appliedId,'w2');assert.match(h.last().reasons[0],/validator rejected the best week/);
 const only=uiHarness({validateSchedule:()=>[{level:'error',msg:'bad'}]}),fb=fallbackDraft();only.ui.startCompleteSearch(undefined,fb);
 only.emit(snap(entry('w1',bad)),'done');assert.deepEqual(only.events.find(e=>e[0]==='commit')[1].ns,fb.ns,'then autofill\'s draft');
});
test('"Use best now" asks the runner to stop and applies the week it reports',()=>{
 const found=incumbent(),h=uiHarness();h.ui.startCompleteSearch(undefined,fallbackDraft());h.ref.current.useBest();
 assert.equal(h.calls.at(-1),'useBest');h.emit(snap(entry('w1',found),undefined,{status:'done',stopReason:'user'}),'done');
 assert.deepEqual(h.events.find(e=>e[0]==='commit')[1].ns,found.ns);assert.equal(h.ref.current,null);
});
test('an idle finish applies the best week and says why it stopped',()=>{
 const found=incumbent(),h=uiHarness();h.ui.startCompleteSearch(undefined,fallbackDraft());
 h.emit(snap(entry('w1',found)),'progress');assert(!h.events.some(e=>e[0]==='commit'));
 h.emit(snap(entry('w1',found),undefined,{status:'done',stopReason:'idle'}),'done');
 assert.deepEqual(h.events.find(e=>e[0]==='commit')[1].ns,found.ns);assert.equal(h.last().stopReason,'idle');
});
test('the page applies the optimizer\'s best by the canonical objective, whatever order weeks arrived in',()=>{
 // A later, raw search week (more overtime) must not replace an earlier polished week.
 const polished=incumbent(),raw=incumbent();raw.ns.Sunday__second=raw.ns.Sunday__second.slice().reverse();
 const q=ot=>{const v=Array(14).fill(0);v[c.QUALITY.overtime]=ot;return v;};
 const best=entry('w1',polished,{quality:q(8)}),later=entry('w2',raw,{origin:'search',quality:q(16)});
 const h=uiHarness();h.ui.startCompleteSearch();h.emit(snap(best,[best,later]),'progress');
 assert.deepEqual(h.found.current.weeks.map(w=>w.id),['w1','w2']);
 h.emit(snap(best,[best,later],{status:'done',stopReason:'idle'}),'done');
 assert.deepEqual(h.events.find(e=>e[0]==='commit')[1].ns,polished.ns);assert.equal(h.found.current.appliedId,'w1');
});
test('choosing a listed week stops the optimizer and proposes exactly that week; stale lists cannot be used',()=>{
 const w1=incumbent(),w2=incumbent();w2.ns.Sunday__second=w2.ns.Sunday__second.slice().reverse();
 const h=uiHarness();h.ui.startCompleteSearch(undefined,fallbackDraft());h.emit(snap(entry('w1',w1),[entry('w1',w1),entry('w2',w2)]),'progress');
 const list=h.found.current,pick=list.weeks.find(w=>w.id==='w2');
 const again=uiHarness({foundWeeks:list,completeSearchRef:h.ref});again.ui.applyFoundWeek(pick);
 assert.equal(h.ref.current,null,'the running optimizer was stopped');assert.equal(h.calls.at(-1),'cancel');
 assert.deepEqual(again.events.find(e=>e[0]==='commit')[1].ns,w2.ns);
 const panel=again.events.filter(e=>e[0]==='progress').map(e=>e[1]({status:'searching'})).at(-1);
 assert.equal(panel.applied,'picked');
 const stale=uiHarness({foundWeeks:list,liveRulesStamp:'rules changed'});stale.ui.applyFoundWeek(pick);
 assert(!stale.events.some(e=>['commit','pending'].includes(e[0])),'weeks built for other rules cannot be applied');
});

