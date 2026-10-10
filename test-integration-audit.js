'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),c=require('./load-core');
const html=fs.readFileSync(__dirname+'/ShiftScheduler_latest loop.html','utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const clone=x=>JSON.parse(JSON.stringify(x));
const employee=(id='g',extra={})=>({id,name:id,employmentType:'part-time',qualifications:['Guard'],ext12hPref:'both',...extra});
const assignment=(id='g',position='Guard')=>({employeeId:id,position});
const handoff=(extra={})=>({day:'Saturday',employeeId:'g',sourceShiftId:'third',targetShiftId:'first',type:'late-stay',position:'Guard',hours:4,...extra});
const live=()=>({...c.emptyWeekDraft('2026-09-06'),schedule:{Friday__third:[assignment()]},extShifts:[{day:'Monday',pairId:'day',empAId:'a',empBId:'b'}],handoffs:[handoff()],trainingBlocks:[{id:'t',day:'Monday'}],employees:[employee()],timeOffReqs:[{id:'pto'}]});
const extract=(start,end)=>{const a=html.indexOf(start),b=html.indexOf(end,a);assert(a>=0&&b>a);return html.slice(a,b);};
const evaluate=(body,scope={})=>new Function(...Object.keys({...c,...scope}),body)(...Object.values({...c,...scope}));
function persistence({asyncStorage=true,raw=null,read=async()=>({value:raw}),write=async()=>true}={}) {
 const states=[],effects=[],refs=[];let cursor=0;
 const scope={_hasWinStorage:asyncStorage,useRef:v=>{const ref={current:v};refs.push(ref);return ref;},useState:init=>{
  const i=cursor++;states[i]=typeof init==='function'?init():init;
  return [states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v;}];
 },useEffect:f=>effects.push(f),useCallback:f=>f,localStorage:{getItem:()=>raw,setItem:write},window:{storage:{get:read,set:write}}};
 const hook=evaluate(extract('function usePersistentState(','// ── Hours calculator')+'return usePersistentState;',scope);
 const result=hook('key',[]),cleanups=effects.map(f=>f());return {states,result,cleanups,refs};
}

test('a weekday supervisor handoff supplies regular coverage only as the 14:00-18:00 late stay',()=>{
 const e=employee('s',{qualifications:['Supervisor','Medical'],canWorkOtherShifts:true});
 // Last resort: after supervising 06:00-14:00 he may stay until 18:00 as regular staff.
 const late=c.employeePolicyIssues(e,{Friday__first:[assignment('s','Supervisor')]},{},{handoffs:[handoff({employeeId:'s',day:'Friday',sourceShiftId:'first',targetShiftId:'second',position:'Medical'})]});
 assert(!late.some(i=>i.type==='supervisor_slot'));
 // Any other weekday handoff (here arriving early for first shift) still conflicts with supervising.
 const early=c.employeePolicyIssues(e,{Thursday__third:[assignment('s','Medical')]},{},{handoffs:[handoff({employeeId:'s',day:'Friday',sourceShiftId:'third',targetShiftId:'first',type:'late-stay',position:'Medical'})]});
 assert(early.some(i=>i.type==='supervisor_slot'));
});
test('a handoff onto a sixth day counts against working-day and weekend caps',()=>{
 const schedule=Object.fromEntries(c.DAYS.slice(1,6).map(d=>[d+'__third',[assignment()]]));
 const issues=c.employeePolicyIssues(employee('g',{maxWeekendDays:0}),schedule,{maxConsecutiveShifts:5,maxConsecutiveNights:7},{handoffs:[handoff()]});
 assert(issues.some(i=>i.type==='weekend_days'));
 // The consecutive-day limit is a preference: a warning, not a hard rule.
 assert(!issues.some(i=>i.type==='consecutive_days'));
 const stretch=c.stretchIssues(employee('g'),schedule,{maxConsecutiveShifts:5,maxConsecutiveNights:7},{handoffs:[handoff()]});
 assert(stretch.some(i=>i.type==='consecutive_days' && i.level==='warn'));
 assert.equal(c.buildPrevWeekData(schedule,[],[handoff()]).trailingDays.g,6);
});
test('ordinary overnight shifts retain their starting-day accounting',()=>{
 const schedule=Object.fromEntries(c.DAYS.slice(1,6).map(d=>[d+'__third',[assignment()]]));
 const issues=c.employeePolicyIssues(employee('g',{maxWeekendDays:0}),schedule,{maxConsecutiveShifts:5,maxConsecutiveNights:7});
 assert(!issues.some(i=>['consecutive_days','weekend_days'].includes(i.type)));
 assert.equal(c.buildPrevWeekData(schedule).trailingDays.g,0);
});
test('latest saved history wins even when its existing entry is replaced in place',()=>{
 const week='2026-08-30',latest={weekStart:week,savedAt:'2026-09-05T12:00:00Z',schedule:{Saturday__third:[assignment()]}};
 const history=[latest,{weekStart:week,savedAt:'2026-09-01T12:00:00Z',schedule:{}}];
 assert.equal(c.selectWeekHistory(history,week),latest);
 assert.deepEqual(c.publicationSnapshot({weekStart:'2026-09-06',history}).previousWeek.schedule,latest.schedule);
 assert.equal(c.boundaryPatterns(history,'2026-09-06',{}).g.trailingDays,1);
});
test('explicit manual history preference and latest-draft navigation are distinct',()=>{
 const history=[{weekStart:'2026-09-06',isAutoSave:false,savedAt:'2026-09-07T12:00:00Z'}, {weekStart:'2026-09-06',isAutoSave:true,savedAt:'2026-09-08T12:00:00Z'}];
 assert.equal(c.selectWeekHistory(history,'2026-09-06'),history[0]);
 assert.equal(c.selectWeekHistory(history,'2026-09-06',false),history[1]);
});
test('malformed previous-week slots and orphan handoffs are reported',()=>{
 assert(c.historyDataIssues({schedule:{bogus:[assignment()]}}).length);
 assert(c.historyDataIssues({schedule:{},handoffs:[handoff()]}).length);
 assert.deepEqual(c.historyDataIssues({schedule:{Friday__third:[assignment()]}}),[]);
});
test('history views own their dates, duties, leave and roster without altering live data',()=>{
 const current=live(),before=clone(current),old={...live(),weekStart:'2026-08-30',employees:[employee('old')],extShifts:[],handoffs:[],trainingBlocks:[],timeOffReqs:[]};
 const view=c.scheduleViewSnapshot(current,old);
 for(const k of ['weekStart','schedule','employees','extShifts','handoffs','trainingBlocks','timeOffReqs'])assert.deepEqual(view[k],old[k]);
 assert.deepEqual(current,before);assert.equal(c.scheduleViewSnapshot(current,null),current);
});
test('legacy history uses no unrelated current extended duties, handoffs, training or PTO',()=>{
 const view=c.scheduleViewSnapshot(live(),{weekStart:'2026-08-30',schedule:{}});
 for(const k of ['extShifts','handoffs','trainingBlocks','timeOffReqs'])assert.deepEqual(view[k],[]);
 assert.equal(view.employees[0].id,'g');
});
test('history saves an independent complete record with each roster employee',()=>{
 const input=live(),record=c.makeHistoryEntry(input,'Reviewed');input.schedule.Friday__third=[];input.employees[0].name='changed';
 assert.equal(record.schedule.Friday__third.length,1);assert.equal(record.employees[0].name,'g');
 assert.equal(record.handoffs.length,1);assert.equal(record.trainingBlocks.length,1);assert.equal(record.timeOffReqs.length,1);assert.equal(record.isAutoSave,false);
});
test('new-week navigation archives the full current week and opens an empty draft',()=>{
 const input=live(),next=c.scheduleWeekTransition(input,[],'2026-09-13');
 assert.deepEqual({...next,history:undefined},{...c.emptyWeekDraft('2026-09-13'),history:undefined});
 const saved=next.history[0];for(const k of ['schedule','extShifts','handoffs','trainingBlocks','employees','timeOffReqs'])assert.deepEqual(saved[k],input[k]);
});
test('returning to a week restores all of its duties and does not alias history',()=>{
 const initial=live(),away=c.scheduleWeekTransition(initial,[],'2026-09-13');
 const back=c.scheduleWeekTransition({...away,employees:initial.employees},away.history,initial.weekStart);
 for(const k of ['schedule','extShifts','handoffs','trainingBlocks'])assert.deepEqual(back[k],initial[k]);
 back.schedule.Friday__third=[];assert.equal(back.history.find(h=>h.weekStart===initial.weekStart).schedule.Friday__third.length,1);
});
test('invalid week navigation and corrupt target records cannot replace a draft',()=>{
 assert.throws(()=>c.scheduleWeekTransition(live(),[],'2026-09-14'),/Sunday/);
 assert.throws(()=>c.scheduleWeekTransition(live(),[{weekStart:'2026-09-13',schedule:[]}],'2026-09-13'),/invalid/);
});
test('autosave replaces only that week’s automatic entry and preserves named reviews',()=>{
 const input=live(),named=c.makeHistoryEntry(input,'Review'),auto=c.makeHistoryEntry(input);
 const next=c.upsertHistoryEntry([named,auto],{...auto,schedule:{}});
 assert.equal(next.length,2);assert.equal(next[0],named);assert.deepEqual(next[1].schedule,{});
});
function migrationStore(values={},writeOverride) {
 const data=clone(values),writes=[];
 return {data,writes,io:{read:async key=>data[key],write:async(key,value)=>{writes.push(key);if(writeOverride)return writeOverride(key,value);data[key]=clone(value);return true;}}};
}
test('legacy weekly keys migrate together with a verified readback and remain recoverable',async()=>{
 const input=live(),m=migrationStore({shift_week_start:input.weekStart,shift_schedule:input.schedule,shift_ext_shifts:input.extShifts,shift_handoffs:input.handoffs,shift_training_blocks:input.trainingBlocks});
 await c.migrateActiveWeek(m.io);assert.deepEqual(m.writes,['shift_active_week']);
 for(const k of ['weekStart','schedule','extShifts','handoffs','trainingBlocks'])assert.deepEqual(m.data.shift_active_week[k],input[k]);
 assert.deepEqual(m.data.shift_schedule,input.schedule);
});
test('existing active drafts take precedence over stale legacy keys',async()=>{
 const active=c.emptyWeekDraft('2026-09-13'),m=migrationStore({shift_active_week:active,shift_schedule:live().schedule});
 await c.migrateActiveWeek(m.io);assert.deepEqual(m.writes,[]);assert.deepEqual(m.data.shift_active_week,active);
});
test('migration rejects failed writes, readback mismatches and malformed weekly data',async()=>{
 for(const ack of [false,true]){const m=migrationStore({shift_week_start:'2026-09-06'},()=>ack);await assert.rejects(c.migrateActiveWeek(m.io),/verify/);}
 const m=migrationStore({shift_active_week:{...live(),handoffs:{}}});await assert.rejects(c.migrateActiveWeek(m.io),/invalid/);assert.equal(m.writes.length,0);
});
test('weekly structure validation allows incomplete drafts but rejects corrupt containers',()=>{
 assert.equal(c.validateWeekDraft(live()).weekStart,'2026-09-06');
 for(const bad of [null,{...live(),schedule:[]},{...live(),extShifts:[null]},{...live(),weekStart:'2026-09-07'}])assert.throws(()=>c.validateWeekDraft(bad));
});
test('missing storage keys are distinct from denied or unavailable storage',async()=>{
 assert(c.isMissingStorageError(new Error('Key not found: key')));
 assert(c.isMissingStorageError({code:'NOT_FOUND'}));assert(!c.isMissingStorageError(new Error('Permission denied')));
 // Claude app preview storage prefixes the reason; a fresh device must load as empty, not fail.
 assert(c.isMissingStorageError(new Error('Storage get failed: Key not found')));assert(c.isMissingStorageError('Key not found'));
 assert(!c.isMissingStorageError(new Error('Storage get failed: quota exceeded')));assert(!c.isMissingStorageError(new Error('Monkey not foundational')));
 const fresh=persistence({read:async()=>{throw {code:'NOT_FOUND'};}}),denied=persistence({read:async()=>{throw new Error('Permission denied');}});
 await tick();assert.equal(fresh.states[1],true);assert.equal(denied.states[1],false);assert.match(denied.states[2],/denied/);
});
test('rapid persistent updates are serialized and remain unready until the newest save completes',async()=>{
 const writes=[],release=[];const h=persistence({write:(key,text)=>{writes.push(JSON.parse(text));return new Promise(r=>release.push(r));}});await tick();
 const first=h.result[1](['one']),second=h.result[1](v=>[...v,'two']);await tick();
 assert.deepEqual(writes,[['one']]);assert.equal(h.states[1],false);
 release[0](true);await first;await tick();assert.equal(h.states[1],false);assert.deepEqual(writes,[['one'],['one','two']]);
 release[1](true);await second;await tick();assert.equal(h.states[1],true);assert.deepEqual(h.states[0],['one','two']);
});
test('save failures keep the edited draft visible but block readiness and can be retried',async()=>{
 let fail=true;const h=persistence({write:async()=>{if(fail)throw new Error('Quota exceeded');return true;}});await tick();
 await assert.rejects(h.result[1](['unsaved']),/Quota/);await tick();assert.deepEqual(h.states[0],['unsaved']);assert.equal(h.states[1],false);
 fail=false;await h.result[1](v=>v);await tick();assert.equal(h.states[1],true);assert.equal(h.states[2],null);
});
test('unacknowledged async writes and local quota errors never report success',async()=>{
 const h=persistence({write:async()=>false});await tick();await assert.rejects(h.result[1](['new']),/confirm/);assert.equal(h.states[1],false);
 const local=persistence({asyncStorage:false,write:()=>{throw new Error('quota');}});await assert.rejects(local.result[1](['new']),/quota/);assert.equal(local.states[1],false);
});
test('explicit edits survive delayed hydration and unmounted hooks ignore delayed reads',async()=>{
 let release;const h=persistence({read:()=>new Promise(r=>{release=r;})});await h.result[1](['restored']);release({value:'["old"]'});await tick();assert.deepEqual(h.states[0],['restored']);
 let done;const abandoned=persistence({read:()=>new Promise(r=>{done=r;})});abandoned.cleanups.forEach(f=>f?.());done({value:'["old"]'});await tick();assert.equal(abandoned.states[1],false);
});
test('schema migrations do not stamp success after a failed employee write',async()=>{
 const writes=[],body=extract('async function runSchemaMigrations()','const DAYS =');
 const run=evaluate(body+'return runSchemaMigrations;', {_hasWinStorage:true,SCHEMA_KEY:'version',SCHEMA_VERSION:1,EMP_MIGRATIONS:{1:emps=>emps},console:{log:()=>{}},window:{storage:{get:async key=>({value:JSON.stringify(key==='version'?0:[employee()])}),set:async key=>{writes.push(key);return false;}}}});
 await assert.rejects(run(),/confirmed/);assert.deepEqual(writes,['shift_employees']);
});
test('proposal cleanup invalidates asynchronous results when the grid is unmounted',()=>{
 let cleanup;const overtimeInputRef={current:'reviewed'},autoFillCancelRef={current:false};
 evaluate(extract('  useEffect(()=>()=>{overtimeInputRef.current=null;','  const proposalIsCurrent'),{useEffect:f=>{cleanup=f();},overtimeInputRef,autoFillCancelRef});
 cleanup();assert.equal(overtimeInputRef.current,null);assert.equal(autoFillCancelRef.current,true);
});
test('production template loading clears unrelated extended duties and stages overtime for review',()=>{
 const template={schedule:{Monday__first:[assignment()]}},commits=[],pending=[];
 const scope={isReadOnly:false,pendingProposal:null,savedWeeks:[template],employees:[employee()],schedule:live().schedule,extShifts:live().extShifts,handoffs:live().handoffs,cfg:{},ptoHoursByEmployee:{},overtimeInputRef:{current:'current'},setPendingProposal:p=>pending.push(p),setShowCopyModal:()=>{},commitScheduleProposal:p=>{commits.push(p);return true;}};
 const load=evaluate(extract('  const handleLoadWeek =','  const handleDeleteWeek')+'return handleLoadWeek;',scope);load(0);
 assert.equal(commits.length,1);assert.deepEqual(commits[0].autoExtShifts,[]);assert.deepEqual(commits[0].handoffs,[]);assert.deepEqual(commits[0].trainingBlocks,[]);
 template.schedule=Object.fromEntries(c.DAYS.slice(0,6).map(d=>[d+'__first',[assignment()]]));load(0);assert.equal(commits.length,1);assert.equal(pending.length,1);assert.equal(pending[0].reviewItems[0].emp.id,'g');
});
test('production commit persists regular, extended, handoff and training data in one weekly update',()=>{
 const writes=[],scope={isReadOnly:false,proposalIsCurrent:()=>true,discardStaleProposal:()=>assert.fail('stale'),employees:[employee()],cfg:{},policyOptions:{},showAlert:()=>assert.fail('rejected'),pushUndo:()=>{},setWeekDraft:v=>writes.push(v),setEmpPatterns:()=>{},setAssignLog:()=>{},validateSchedule:()=>[],setScheduleIssues:()=>{},setScheduleStale:()=>{},setPendingProposal:()=>{}};
 const commit=evaluate(extract('  const commitScheduleProposal =','  const commitAssignmentChange')+'return commitScheduleProposal;',scope);
 const p={ns:{Monday__first:[assignment()]},autoExtShifts:[],handoffs:[],trainingBlocks:[{id:'new'}]};assert(commit(p));
 assert.deepEqual(writes,[{schedule:p.ns,extShifts:[],handoffs:[],trainingBlocks:p.trainingBlocks}]);
});
test('production proposal commit rejects surplus staff before writing the weekly draft',()=>{
 const staff=['a','b','c','d'].map(id=>employee(id)),alerts=[],writes=[];
 const scope={isReadOnly:false,proposalIsCurrent:()=>true,discardStaleProposal:()=>assert.fail('stale'),employees:staff,cfg:{},policyOptions:{},
  showAlert:a=>alerts.push(a),pushUndo:()=>assert.fail('must not change undo history'),setWeekDraft:v=>writes.push(v)};
 const commit=evaluate(extract('  const commitScheduleProposal =','  const commitAssignmentChange')+'return commitScheduleProposal;',scope);
 assert.equal(commit({ns:{Sunday__second:staff.map(e=>assignment(e.id))},autoExtShifts:[],handoffs:[]}),false);
 assert.equal(writes.length,0);assert(alerts[0].items.some(i=>i.msg.includes('Overstaffed')));
});
test('roster removal clears all employee duties while preserving their extended-shift partner',()=>{
 let week={...live(),schedule:{Monday__first:[assignment()]},extShifts:[{empAId:'g',empBId:'partner'},{empAId:'g'}]},roster=[employee(),employee('partner')];
 const remove=evaluate(extract('  const removeEmployee =','  const saveEdit =')+'return removeEmployee;',{
  schedule:week.schedule,extShifts:week.extShifts,handoffs:week.handoffs,setErrors:()=>assert.fail('unexpected lock'),setEmployees:fn=>{roster=fn(roster);},setWeekDraft:fn=>{week={...week,...fn(week)};}});
 remove('g');assert.equal(roster.length,1);assert.deepEqual(week.schedule.Monday__first,[]);assert.deepEqual(week.handoffs,[]);assert.equal(week.extShifts.length,1);assert.equal(week.extShifts[0].empAId,null);assert.equal(week.extShifts[0].empBId,'partner');
});
test('production session counter increments only once across persistence readiness changes',()=>{
 const buildIncrementedRef={current:false};let count=0;
 const body=extract('  const buildIncrementedRef=','  useEffect(() => {\n    if (!customSeed');
 for(const buildLoaded of [false,true,false,true])evaluate(body,{useRef:()=>buildIncrementedRef,useEffect:f=>f(),buildLoaded,setBuildCount:fn=>{count=fn(count);}});
 assert.equal(count,1);
});
function navigator({saveHistory=async()=>{},saveWeek=async()=>{},ready=true}={}) {
 const input=live(),events=[],weekInputRef={current:input};
 const navigate=evaluate(extract('  const setWeekStart=useCallback(async nextWeek=>{','  const generationInputsReady=')+'return setWeekStart;',{
  useCallback:f=>f,weekStart:input.weekStart,draftInputsReady:ready,history:[],weekSwitchRef:{current:false},weekInputRef,
  setWeekSwitchBusy:v=>events.push(['busy',v]),setWeekSwitchError:v=>events.push(['error',v]),
  setHistory:async v=>{events.push(['history',v]);await saveHistory(v);},setWeekDraft:async v=>{events.push(['week',v]);await saveWeek(v);},setWeekStartApp:v=>events.push(['date',v])});
 return {navigate,events,weekInputRef};
}
test('production navigation saves history before replacing a complete weekly bundle',async()=>{
 let release;const n=navigator({saveHistory:()=>new Promise(r=>{release=r;})}),job=n.navigate('2026-09-13');
 assert(n.events.some(e=>e[0]==='history'));assert(!n.events.some(e=>e[0]==='week'));release();await job;
 const saved=n.events.find(e=>e[0]==='week')[1];assert.deepEqual(saved.schedule,{});assert.deepEqual(saved.handoffs,[]);assert.equal(saved.weekStart,'2026-09-13');
 assert.deepEqual(n.events.at(-1),['busy',false]);
});
test('production navigation preserves the active week on archive failure or a concurrent edit',async()=>{
 const failed=navigator({saveHistory:async()=>{throw new Error('failed archive');}});await failed.navigate('2026-09-13');assert(!failed.events.some(e=>e[0]==='week'));
 let release;const edited=navigator({saveHistory:()=>new Promise(r=>{release=r;})}),job=edited.navigate('2026-09-13');
 edited.weekInputRef.current={...edited.weekInputRef.current,schedule:{}};release();await job;
 assert(!edited.events.some(e=>e[0]==='week'));assert(edited.events.some(e=>e[0]==='error'&&/changed/.test(e[1])));
});
function restoreHarness(snapshot,write=async()=>true) {
 const writes=[],messages=[];let done;
 class FileReader {readAsText(){done=this.onload({target:{result:JSON.stringify(snapshot)}});}}
 const noop=()=>{};
 const setterNames=['setWeekDraft','setEmployees','setSettings','setTimeOffReqs','setWeekAvailability','setSavedWeeks','setHistory','setEmpPatterns','setSavedRosters','setAfExclude','setSwingDesig'];
 const scope={FileReader,setBusy:noop,SCHEMA_VERSION:0,EMP_MIGRATIONS:{},ACTIVE_WEEK_KEY:'shift_active_week',publicationStore:{restore:async()=>{}},
  lsSet:async(key,text)=>{writes.push(key);return write(key,text);},flash:(message,ok)=>messages.push({message,ok}),...Object.fromEntries(setterNames.map(name=>[name,noop]))};
 const handle=evaluate(extract('  const handleFile = (e) => {','  const btnStyle =')+'return handleFile;',scope);
 handle({target:{files:[{}],value:'file'}});return {writes,messages,done};
}
test('backup preflight rejects invalid publication history before changing roster or weekly data',async()=>{
 const h=restoreHarness({shift_employees:[employee()],shift_active_week:live(),shift_publication_records:{schemaVersion:1,approvals:[],publications:[{id:'bad',snapshot:{}}]}});
 await h.done;assert.equal(h.writes.length,0);assert.match(h.messages[0].message,/invalid publication/);
});
test('backup restore reports an unconfirmed write and never announces success',async()=>{
 const h=restoreHarness({shift_employees:[employee()],shift_active_week:live()},async()=>false);await h.done;
 assert.deepEqual(h.writes,['shift_active_week']);assert(h.messages.every(v=>v.ok===false));assert.match(h.messages[0].message,/Could not restore/);
});
test('startup waits for schema and weekly migration before making the app ready',async()=>{
 let schemaDone,weekDone;const states=[],effects=[];
 const body=extract('function SchedulerBootstrap() {','  if(!ready)return').replace('function SchedulerBootstrap() {','')+'return {ready,error};';
 evaluate(body,{useState:v=>[v,n=>states.push(n)],useEffect:f=>effects.push(f),runSchemaMigrations:()=>new Promise(r=>{schemaDone=r;}),migrateActiveWeek:()=>new Promise(r=>{weekDone=r;})});
 effects[0]();assert.deepEqual(states,[]);schemaDone();await tick();assert.deepEqual(states,[]);weekDone();await tick();assert.deepEqual(states,[true]);
});
test('pending generated-roster autofill waits for saved inputs instead of consuming the request early',()=>{
 const body=extract('  useEffect(()=>{\n    if(pendingAutoFill','  const runTargetedRepair');let runs=0,clears=0;
 const scope={useEffect:f=>f(),pendingAutoFill:[employee()],isReadOnly:false,autoFillRunning:false,pendingProposal:null,runAutoFill:()=>runs++,clearPendingAutoFill:()=>clears++};
 evaluate(body,{...scope,generationInputsReady:false});assert.equal(runs,0);assert.equal(clears,0);
 evaluate(body,{...scope,generationInputsReady:true});assert.equal(runs,1);assert.equal(clears,1);
});
test('delayed manual confirmations cannot change a different week or changed inputs',()=>{
 for(const current of [null,'new-inputs']) {
  let alerts=0;
  const check=evaluate(extract('  const manualInputIsCurrent=','  useEffect(()=>()=>{overtimeInputRef.current=null;')+'return manualInputIsCurrent;', {liveInputStamp:'old-inputs',overtimeInputRef:{current},showAlert:()=>alerts++});
  assert.equal(check(),false);assert.equal(alerts,1);
  const commit=evaluate(extract('  const commitAssignmentChange =','  const commitExtendedChange =')+'return commitAssignmentChange;', {isReadOnly:false,manualInputIsCurrent:check});
  assert.equal(commit(()=>assert.fail('stale updater ran')),false);
 }
});
test('backup restore rejects malformed week shift availability before writing anything',async()=>{
 const h=restoreHarness({shift_employees:[employee()],shift_active_week:live(),shift_week_availability:{'2026-09-06':{a:{Monday:{first:'maybe'}}}}});
 await h.done;assert.equal(h.writes.length,0);assert.match(h.messages[0].message,/shift_week_availability/);
});
test('backup restore writes week shift availability when present',async()=>{
 const h=restoreHarness({shift_employees:[employee()],shift_active_week:live(),shift_week_availability:{'2026-09-06':{a:{Monday:{first:'no'}}}}});
 await h.done;assert(h.writes.includes('shift_week_availability'));assert(h.messages.every(v=>v.ok!==false));
});
