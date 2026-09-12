'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),c=require('./load-core');
const {DAYS,cellKey,publicationSnapshot,publicationStamp,validatePublication,createPublicationRecord,publicationRecordValid,publicationRows,publicationPrintHtml,createOvertimeDecisions,createPublicationRepository}=c;
const week='2026-09-06';
const emp=(id,extra={})=>({id,name:id,qualifications:['Guard','Scale','Medical'],employmentType:'part-time',overtimePref:'blocked',...extra});
function fixture() {
 const employees=[],schedule={};
 for(const sid of ['first','second','third'])for(let group=0;group<2;group++)for(let n=0;n<3;n++){
  const id=`${sid}-${group}-${n}`,days=group?DAYS.slice(3):DAYS.slice(0,3);
  employees.push(emp(id,{requiredShift:sid,availableDaysOfWeek:days,maxShiftsPerWeek:4}));
  for(const day of days)(schedule[cellKey(day,sid)] ||= []).push({employeeId:id,position:['Guard','Scale','Medical'][n]});
 }
 employees.push(emp('sup',{name:'Supervisor',qualifications:['Supervisor'],employmentType:'full-time',requiredShift:'first'}));
 for(const day of DAYS.slice(1,6))schedule[cellKey(day,'first')].push({employeeId:'sup',position:'Supervisor'});
 employees.push(emp('on-call',{employmentType:'on-call',preferredShifts:[]}));
 return publicationSnapshot({weekStart:week,employees,schedule,extShifts:[],handoffs:[],timeOffReqs:[],cfg:{minRestHours:12,maxConsecutiveShifts:5,maxConsecutiveNights:4},
  history:[{weekStart:'2026-08-30',schedule:{},extShifts:[],handoffs:[],isAutoSave:false}]});
}
function overtimeFixture() {
 const s=fixture();
 s.employees.find(e=>e.id==='first-0-0').overtimePref='preferred';
 s.timeOffReqs=[{id:'pto',empId:'first-0-0',type:'single_day',startDate:'2026-09-10',endDate:'2026-09-10',status:'approved',paid:true,ptoHoursByDate:{'2026-09-10':24}}];
 return s;
}
const publish=(s,approvals=[])=>createPublicationRecord(s,approvals,'Manager',{priorWeekConfirmed:true});
const types=(s,a=[],o={})=>validatePublication(s,a,o).issues.filter(i=>i.level==='error').map(i=>i.type);
function memory(initial=null) {
 let value=initial,writes=0;
 const repo=createPublicationRepository({read:async()=>value==null?null:JSON.parse(JSON.stringify(value)),write:async next=>{writes++;value=JSON.parse(JSON.stringify(next));return true;}});
 return {repo,get value(){return value;},get writes(){return writes;}};
}
test('a complete qualified week publishes with every employee and an owned snapshot',()=>{
 const s=fixture(),record=publish(s);
 assert(publicationRecordValid(record));assert.equal(record.status,'published');assert.equal(record.snapshot.employees.length,20);
 s.schedule.Sunday__first=[];s.employees[0].name='Changed';
 assert.equal(record.snapshot.schedule.Sunday__first.length,3);assert.notEqual(record.snapshot.employees[0].name,'Changed');
 assert.equal(publicationRows(record.snapshot).length,20);
});
test('empty weeks and short intervals cannot pass publication',()=>{
 const empty=fixture();empty.schedule={};assert(types(empty).includes('coverage'));
 const s=fixture();s.schedule.Sunday__first.pop();
 assert.throws(()=>publish(s),/Publication blocked/);
 assert(types(s).includes('coverage'));
});
test('a missing dedicated supervisor cannot be substituted with a fourth regular employee',()=>{
 const s=fixture();s.schedule.Monday__first=s.schedule.Monday__first.filter(a=>a.employeeId!=='sup');
 s.schedule.Monday__first.push({employeeId:'on-call',position:'Guard'});
 assert(types(s).includes('role'));assert(types(s).includes('weekly_obligation'));
});
test('qualification changes, trainees and unknown assignments block publication',()=>{
 for(const edit of [s=>{s.employees[0].qualifications=[];},s=>{s.employees[0].inTraining=true;},s=>{s.schedule.Sunday__first[0].employeeId='missing';}]){
  const s=fixture();edit(s);assert.equal(validatePublication(s).ok,false);
 }
});
test('full-time shortages block even when coverage is complete; PTO counts toward forty',()=>{
 const s=fixture();s.employees[0].employmentType='full-time';assert(types(s).includes('weekly_obligation'));
 s.timeOffReqs=[{id:'p',empId:s.employees[0].id,type:'vacation',startDate:'2026-09-09',endDate:'2026-09-10',status:'approved',ptoHoursByDate:{'2026-09-09':8,'2026-09-10':8}}];
 assert(validatePublication(s).ok);
 s.timeOffReqs[0].ptoHoursByDate={};assert.equal(validatePublication(s).ok,false);
});
test('legacy and malformed paid leave cannot be hidden by a cached all-clear',()=>{
 const s=fixture();s.timeOffReqs=[{id:'p',empId:'on-call',type:'vacation',startDate:week,endDate:week,status:'approved'}];
 s.issues=[];s.errors=0;assert.equal(validatePublication(s).ok,false);
});
test('overlapping approved partial leave is rechecked at publication time',()=>{
 const s=fixture();s.timeOffReqs=[{id:'p',empId:s.employees[0].id,type:'partial',timeMode:'range',startDate:week,endDate:week,startTime:'09:00',endTime:'10:00',status:'approved'}];
 assert(types(s).includes('availability'));
});
test('valid previous-week records and manager confirmation are required',()=>{
 const s=fixture();s.previousWeek=null;assert(types(s).includes('publication_history'));
 assert.throws(()=>createPublicationRecord(fixture(),[],'Manager'),/previous-week/);
 assert.throws(()=>createPublicationRecord(fixture(),[],' ',{priorWeekConfirmed:true}),/manager/);
});
test('previous-week overnight work is included in publication fatigue checks',()=>{
 const s=fixture();s.previousWeek.schedule={Saturday__third:[{employeeId:s.employees[0].id,position:'Guard'}]};
 assert(types(s).includes('continuous_hours'));
});
test('pending proposals and running searches block publication',()=>{
 assert(types(fixture(),[],{pendingProposal:true}).includes('publication_pending'));
 assert(types(fixture(),[],{searchRunning:true}).includes('publication_search'));
});
test('overtime preference is not a durable approval, but a named exact-schedule approval is',()=>{
 const s=overtimeFixture();assert(types(s).includes('publication_overtime'));
 const records=createOvertimeDecisions(s,{'first-0-0':true},'Shamus');
 assert.equal(records[0].creditLimit,48);assert.equal(records[0].workedHours,24);assert.equal(records[0].ptoHours,24);
 assert(validatePublication(s,records).ok);assert(publicationRecordValid(publish(s,records)));
});
test('No OT cannot be waived through approval records',()=>{
 const s=overtimeFixture();s.employees[0].overtimePref='blocked';
 assert.throws(()=>createOvertimeDecisions(s,{'first-0-0':true},'Manager'),/No OT/);
 assert(types(s).includes('no_overtime'));
});
test('schedule, roster, leave, rules and prior-history changes invalidate old approvals',()=>{
 const base=overtimeFixture(),records=createOvertimeDecisions(base,{'first-0-0':true},'Manager');
 for(const edit of [s=>{s.schedule.Sunday__first[0].position='Scale';},s=>{s.employees[1].name+=' edited';},s=>{s.timeOffReqs[0].ptoHoursByDate['2026-09-10']=23;},s=>{s.cfg.minRestHours=13;},s=>{s.previousWeek.handoffs.push({employeeId:'unknown'});},s=>{s.weekStart='2026-09-13';}]){
  const s=JSON.parse(JSON.stringify(base));edit(s);
  assert.equal(c.currentOvertimeDecision(s,records,'first-0-0'),null);
  assert.equal(validatePublication(s,records).ok,false);
 }
});
test('the latest denial overrides an older approval and blocks reprinting through the live ledger',()=>{
 const s=overtimeFixture(),approved=createOvertimeDecisions(s,{'first-0-0':true},'Manager'),record=publish(s,approved);
 const ledger=[...approved,...createOvertimeDecisions(s,{'first-0-0':false},'Manager')];
 assert(types(s,ledger).includes('publication_overtime'));assert.equal(publicationRecordValid(record,ledger),false);
 assert.throws(()=>publicationPrintHtml(record,ledger),/validated publication/);
});
test('canonical object-key ordering does not invalidate an otherwise identical review',()=>{
 const a=fixture(),b=JSON.parse(JSON.stringify(a));b.cfg={maxConsecutiveNights:4,maxConsecutiveShifts:5,minRestHours:12};
 assert.equal(publicationStamp(a),publicationStamp(b));
});
test('publish performs fresh validation against the latest stored approvals',async()=>{
 const s=overtimeFixture(),m=memory();
 await assert.rejects(m.repo.publish(s,'Manager',{priorWeekConfirmed:true}),/requires a saved approval/);assert.equal(m.writes,0);
 await m.repo.recordApprovals(createOvertimeDecisions(s,{'first-0-0':true},'Manager'));
 const saved=await m.repo.publish(s,'Manager',{priorWeekConfirmed:true});assert.equal(saved.publications.length,1);
 assert(publicationRecordValid(saved.publications[0]));
});
test('stale publication and approval attempts do not write storage',async()=>{
 const m=memory();await assert.rejects(m.repo.publish(fixture(),'Manager',{priorWeekConfirmed:true},()=>false),/changed/);
 await assert.rejects(m.repo.recordApprovals([],()=>false),/changed/);assert.equal(m.writes,0);
});
test('write failures and readback mismatches cannot report a saved publication',async()=>{
 for(const write of [async()=>false,async()=>{throw new Error('quota');},async()=>true]){
  const repo=createPublicationRepository({read:async()=>null,write});
  await assert.rejects(repo.publish(fixture(),'Manager',{priorWeekConfirmed:true}));
 }
});
test('storage read errors fail closed without attempting a write',async()=>{
 let writes=0;const repo=createPublicationRepository({read:async()=>{throw new Error('unavailable');},write:async()=>{writes++;return true;}});
 await assert.rejects(repo.publish(fixture(),'Manager',{priorWeekConfirmed:true}),/unavailable/);assert.equal(writes,0);
});
test('approval and publication records survive reload and concurrent actions are serialized',async()=>{
 const s=overtimeFixture(),m=memory();
 const first=m.repo.recordApprovals(createOvertimeDecisions(s,{'first-0-0':true},'Manager'));
 const second=m.repo.publish(s,'Manager',{priorWeekConfirmed:true});await Promise.all([first,second]);
 const reloaded=memory(m.value);const saved=await reloaded.repo.load();
 assert.equal(saved.approvals.length,1);assert.equal(saved.publications.length,1);assert(publicationRecordValid(saved.publications[0]));
});
test('repository owns the reviewed input while storage is pending',async()=>{
 let release;const gate=new Promise(r=>{release=r;});let value=null;
 const repo=createPublicationRepository({read:async()=>{await gate;return value;},write:async v=>{value=JSON.parse(JSON.stringify(v));return true;}});
 const s=fixture(),pending=repo.publish(s,'Manager',{priorWeekConfirmed:true});s.schedule.Sunday__first=[];release();
 const saved=await pending;assert.equal(saved.publications[0].snapshot.schedule.Sunday__first.length,3);
});
test('explicit backup restore can recover a damaged publication store',async()=>{
 const m=memory({broken:true});await assert.rejects(m.repo.load(),/invalid/);
 const backup={schemaVersion:1,approvals:[],publications:[publish(fixture())]};
 const restored=await m.repo.restore(backup);assert.equal(restored.publications.length,1);
 await assert.rejects(m.repo.restore({schemaVersion:1,approvals:[],publications:[{status:'published'}]}),/invalid/);
 assert.equal(m.value.publications.length,1);
});
test('published print rows include unpreferred and unscheduled people exactly once and escape names',()=>{
 const s=fixture();s.employees[0].preferredShifts=['third'];s.employees[0].name='<script>alert(1)</script>';
 const record=publish(s),rows=publicationRows(record.snapshot),html=publicationPrintHtml(record);
 assert.equal(new Set(rows.map(r=>r.employeeId)).size,s.employees.length);
 assert(rows[0].days[0].duties.some(d=>d.text.includes('06:00')));
 assert(rows.find(r=>r.employeeId==='on-call').workedHours===0);assert(html.includes('Not scheduled'));
 assert(!html.includes('<script>'));assert(html.includes('&lt;script&gt;'));
});
test('print rows preserve handoffs and Saturday extended halves starting the following Sunday',()=>{
 const s=fixture();s.extShifts=[{day:'Saturday',pairId:'split',empBId:'on-call'}];
 s.handoffs=[{day:'Sunday',employeeId:'first-0-0',type:'late-stay',sourceShiftId:'first',targetShiftId:'second',position:'Guard',hours:4}];
 const rows=publicationRows(s),carry=rows.find(r=>r.employeeId==='on-call');
 assert.equal(carry.workedHours,12);assert.equal(carry.days[6].duties.length,1);assert(carry.days[6].duties[0].text.includes('(+1d)'));
 assert(rows[0].days[0].duties.some(d=>d.text.includes('Handoff')));
});

test('malformed ledger entries fail closed before any storage write',async()=>{
 for(const corrupt of [{schemaVersion:1,approvals:[null],publications:[]},{schemaVersion:1,approvals:[],publications:[null]}]) {
  const m=memory(corrupt);await assert.rejects(m.repo.load(),/invalid/);
  await assert.rejects(m.repo.publish(fixture(),'Manager',{priorWeekConfirmed:true}),/invalid/);assert.equal(m.writes,0);
 }
});
const html=fs.readFileSync(__dirname+'/ShiftScheduler_latest loop.html','utf8');
function productionApproval(save) {
 const s=overtimeFixture(),proposal={ns:s.schedule,autoExtShifts:[],handoffs:[],reviewItems:[]},events=[];
 let current=true;
 const scope={...c,pendingProposal:proposal,employees:s.employees,afExclude:[],cfg:s.cfg,empTimeOffDays:new Set(),ptoHoursByEmployee:{},
  history:[s.previousWeek],weekStart:s.weekStart,empPatterns:{},policyOptions:{},timeOffReqs:s.timeOffReqs,trainingBlocks:[],
  publicationStore:{busy:false,recordApprovals:save},proposalIsCurrent:()=>current,discardStaleProposal:()=>events.push('stale'),
  resolveOvertimeProposal:()=>proposal,validateAssignmentPolicy:()=>[],validateSchedule:()=>[],
  commitScheduleProposal:()=>events.push(current?'commit':'stale'),showAlert:a=>events.push(a.title)};
 const start=html.indexOf('  const handleOvertimeApproval = async'),end=html.indexOf('  const suggestExtShifts',start);
 const run=new Function(...Object.keys(scope),html.slice(start,end)+'return handleOvertimeApproval;')(...Object.values(scope));
 return {run,events,change:()=>{current=false;}};
}
test('production overtime approval saves the reviewed record before applying the draft',async()=>{
 let release,records;
 const h=productionApproval(async r=>{records=r;await new Promise(resolve=>{release=resolve;});});
 const pending=h.run({'first-0-0':true},'Manager');
 assert.deepEqual(h.events,[]);assert.equal(records.length,1);assert.equal(records[0].creditLimit,48);
 assert.equal(records[0].stamp,publicationStamp(overtimeFixture()));release();await pending;assert.deepEqual(h.events,['commit']);
});
test('production overtime approval preserves the draft after failed storage or a changed input',async()=>{
 const failed=productionApproval(async()=>{throw new Error('quota');});await failed.run({'first-0-0':true},'Manager');
 assert.deepEqual(failed.events,['Approval not confirmed']);
 let release;const stale=productionApproval(async()=>{await new Promise(resolve=>{release=resolve;});});
 const pending=stale.run({'first-0-0':true},'Manager');stale.change();release();await pending;assert.deepEqual(stale.events,['stale']);
});
test('production publication reports a changed live draft accurately after saving a reviewed snapshot',async()=>{
 const component=html.slice(html.indexOf('function PublicationManager('));
 const start=component.indexOf('  const publish=async()=>'),end=component.indexOf('  const canSave=',start);
 const reviewed=fixture(),inputRef={current:{snapshot:reviewed,pendingProposal:false,searchRunning:false}};
 let release,current=true,message='';const m=memory();
 const scope={reviewed,inputRef,actor:'Manager',priorConfirmed:true,current:()=>current,setMessage:m=>{message=m;},
  publicationStore:{publish:async(...args)=>{const saved=await m.repo.publish(...args);await new Promise(resolve=>{release=resolve;});return saved;}}};
 const run=new Function(...Object.keys(scope),component.slice(start,end)+'return publish;')(...Object.values(scope));
 const pending=run();
 while(!release) await new Promise(resolve=>setImmediate(resolve));
 current=false;release();await pending;
 assert.match(message,/live draft changed/);assert(publicationRecordValid(m.value.publications[0]));
});

function persistentHarness({asyncStorage=false,raw=null,read}) {
 const states=[],effects=[];let i=0;
 const scope={...c,_hasWinStorage:asyncStorage,useRef:v=>({current:v}),useState:init=>{
  const index=i++;states[index]=typeof init==='function'?init():init;
  return [states[index],next=>{states[index]=typeof next==='function'?next(states[index]):next;}];
 },useEffect:effect=>effects.push(effect),useCallback:fn=>fn,localStorage:{getItem:()=>raw,setItem:()=>{}},window:{storage:{get:read,set:()=>true}}};
 const start=html.indexOf('function usePersistentState('),end=html.indexOf('// ── Hours calculator',start);
 const hook=new Function(...Object.keys(scope),html.slice(start,end)+'return usePersistentState;')(...Object.values(scope));
 const result=hook('key',[]);effects.forEach(f=>f());return {states,result};
}
test('persistent schedule inputs remain unready until asynchronous hydration succeeds',async()=>{
 let release;const h=persistentHarness({asyncStorage:true,read:()=>new Promise(r=>{release=r;})});
 assert.equal(h.states[1],false);release({value:'["saved"]'});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.states[1],true);assert.deepEqual(h.states[0],['saved']);
});
test('failed or corrupt schedule reads never mark publication inputs ready',async()=>{
 assert.equal(persistentHarness({raw:'{bad json'}).states[1],false);
 const h=persistentHarness({asyncStorage:true,read:async()=>{throw new Error('unavailable');}});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(h.states[1],false);
});
test('late hydration cannot overwrite explicitly restored schedule data',async()=>{
 let release;const h=persistentHarness({asyncStorage:true,read:()=>new Promise(r=>{release=r;})});
 h.result[1](['restored']);release({value:'["old"]'});await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(h.states[0],['restored']);assert.equal(h.states[1],true);
});
