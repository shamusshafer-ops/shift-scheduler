"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const core = require('./load-core');
const {DAYS,cellKey,buildTimeOffAvailability:availability,timeOffCoversSlot:covers,timeOffRequestErrors,employeePolicyIssues,assignmentIssues,validateAssignmentPolicy,validateCoverage,availabilityConflicts,shiftInterval} = core;
const week='2026-09-06';
const emp=(extra={})=>({id:'e',name:'Employee',qualifications:['Guard','Medical'],employmentType:'part-time',...extra});
const req=(extra={})=>({id:'r',empId:'e',type:'partial',timeMode:'range',startDate:'2026-09-07',endDate:'2026-09-07',startTime:'09:00',endTime:'12:00',status:'approved',...extra});
const schedule=(day='Monday',sid='first',id='e')=>({[cellKey(day,sid)]:[{employeeId:id,position:'Guard'}]});
const issues=(s,requests=[req()],extra={},e=emp())=>employeePolicyIssues(e,s,{}, {empTimeOffDays:availability(requests,week),...extra});
const blocked=list=>list.some(i=>i.type==='availability');
const html=fs.readFileSync(__dirname+'/ShiftScheduler_latest loop.html','utf8');

test('partial leave blocks overlapping work and preserves other shifts that day',()=>{
 const leave=availability([req()],week);
 assert.equal(leave.has('e__Monday'),false);
 assert(blocked(issues(schedule())));
 assert.equal(issues(schedule('Monday','second')).length,0);
 assert.equal(issues(schedule('Monday','third')).length,0);
 assert.equal(covers(req(),'Monday','first',week),true);
 assert.equal(covers(req(),'Monday','second',week),false);
});
test('leave endpoints are exclusive and minute precision is retained',()=>{
 assert.equal(blocked(issues(schedule(),[req({endTime:'06:00',startTime:'05:00'})])),false);
 assert.equal(blocked(issues(schedule(),[req({endTime:'15:00',startTime:'14:00'})])),false);
 assert(blocked(issues(schedule(),[req({startTime:'13:59',endTime:'14:00'})])));
 const conflict=issues(schedule(),[req({startTime:'13:59',endTime:'14:00'})]).find(i=>i.type==='availability');
 assert(Math.abs(conflict.amount-1/60)<1e-9);
});
test('legacy partial requests retain their whole shift without excluding the day',()=>{
 const r={id:'legacy',empId:'e',type:'partial',shiftId:'second',startDate:'2026-09-07',endDate:'2026-09-07',status:'approved'};
 assert.equal(issues(schedule(),[r]).length,0);
 assert(blocked(issues(schedule('Monday','second'),[r])));
 assert.equal(issues(schedule('Monday','third'),[r]).length,0);
});
test('legacy third-shift leave continues into the next calendar day',()=>{
 const r={id:'legacy',empId:'e',type:'partial',shiftId:'third',startDate:'2026-09-07',endDate:'2026-09-07',status:'approved'};
 const data=availability([r],week);
 assert.equal(availabilityConflicts(emp(),[{start:50,end:54}],data).length,1);
 assert.equal(availabilityConflicts(emp(),[{start:54,end:62}],data).length,0);
});
test('overnight exact leave overlaps both sides of midnight but not the following first shift',()=>{
 const r=req({startTime:'23:30',endDate:'2026-09-08',endTime:'05:30'});
 assert.equal(timeOffRequestErrors(r).length,0);
 assert(blocked(issues(schedule('Monday','third'),[r])));
 assert.equal(issues(schedule('Tuesday','first'),[r]).length,0);
 const afterMidnight=issues(schedule('Monday','third'),[req({startDate:'2026-09-08',endDate:'2026-09-08',startTime:'01:00',endTime:'03:00'})]).find(i=>i.type==='availability');
 assert.equal(afterMidnight.day,'Monday');assert.equal(afterMidnight.shiftId,'third');
 assert.equal(core.timeOffIntervals(r,week)[0].end-core.timeOffIntervals(r,week)[0].start,6);
});
test('calendar-day leave catches the previous night and stops at midnight',()=>{
 const r=req({type:'single_day'});
 assert(blocked(issues(schedule('Sunday','third'),[r])));
 assert(blocked(issues(schedule('Monday','third'),[r])));
 assert.equal(issues(schedule('Tuesday','first'),[r]).length,0);
});
test('next-week leave catches Saturday carry-out and does not wrap into this Sunday',()=>{
 const r=req({startDate:'2026-09-13',endDate:'2026-09-13',startTime:'01:00',endTime:'04:00'});
 assert(blocked(issues(schedule('Saturday','third'),[r])));
 assert.equal(issues(schedule('Sunday','third'),[r]).length,0);
 const prior=req({startDate:'2026-09-05',endDate:'2026-09-06',startTime:'23:00',endTime:'08:00'});
 assert(blocked(issues(schedule('Sunday','first'),[prior])));
});
test('civil date offsets preserve local clock hours across DST and year boundaries',()=>{
 assert.equal(core.timeOffIntervals(req({startDate:'2026-11-01',endDate:'2026-11-02',startTime:'22:00',endTime:'06:00'}),'2026-11-01')[0].end,30);
 assert.deepEqual(core.timeOffIntervals(req({startDate:'2026-12-31',endDate:'2027-01-01',startTime:'23:00',endTime:'02:00'}),'2026-12-27'),[{start:119,end:122}]);
});
test('pending and denied requests do not block and duplicate approvals add no extra blocked time',()=>{
 for(const status of ['pending','denied']) assert.equal(issues(schedule(),[req({status})]).length,0);
 const spans=availability([req(),req({id:'copy'})],week).intervalsByEmployee.e;
 assert(spans.every(s=>s.start===33&&s.end===36));
});
test('malformed approved times fail closed and produce visible data errors',()=>{
 for(const extra of [{startTime:''},{endTime:'25:00'},{startTime:'12:00',endTime:'09:00'},{startTime:'09:00',endTime:'09:00'},{startDate:'2026-02-30'},{timeMode:'range',startTime:undefined,endTime:undefined}]){
  const r=req(extra),data=availability([r],week);
  assert(timeOffRequestErrors(r).length);
  assert(data.issues.some(i=>i.type==='availability_data'));
  assert(blocked(issues(schedule(),[r])));
  assert(validateAssignmentPolicy({},[emp()],{}, {empTimeOffDays:data}).some(i=>i.type==='availability_data'));
 }
});
test('recurring windows permit the rest of the day and preserve legacy whole-day restrictions',()=>{
 const e=emp({unavailableWindows:[{day:'Monday',startTime:'09:00',endTime:'12:00'}]});
 assert(blocked(issues(schedule(),[],{},e)));
 assert.equal(issues(schedule('Monday','second'),[],{},e).length,0);
 assert(blocked(issues(schedule('Monday','second'),[],{}, {...e,unavailableDays:['Monday']})));
});
test('recurring overnight windows cover adjacent weeks without confusing Sunday and Saturday',()=>{
 const e=emp({unavailableWindows:[{day:'Saturday',startTime:'23:00',endTime:'08:00',endNextDay:true}]});
 assert(blocked(issues(schedule('Saturday','third'),[],{},e)));
 assert(blocked(issues(schedule('Sunday','first'),[],{},e)));
 assert.equal(issues(schedule('Monday','first'),[],{},e).length,0);
});
test('invalid recurring windows cannot silently free an employee for assignment',()=>{
 for(const windows of [null,{},[{day:'Monday',startTime:'15:00',endTime:'12:00'}],[{day:'Monday',startTime:'09:00',endTime:'12:00',endNextDay:true}]]){
  const e=emp({unavailableWindows:windows});
  assert(core.unavailableWindowErrors(windows).length);
  assert(blocked(issues(schedule(),[],{},e)));
 }
});
test('extended work checks the actual half instead of the whole paired shift',()=>{
 const e=emp({ext12hPref:'day'}),ext={day:'Monday',pairId:'day',empAId:'e'};
 assert(blocked(issues({},[req({startTime:'17:00',endTime:'18:00'})],{extShifts:[ext]},e)));
 assert.equal(issues({},[req({startTime:'18:00',endTime:'19:00'})],{extShifts:[ext]},e).length,0);
});
test('handoffs use their actual hours and approved leave does not block the adjoining source shift',()=>{
 const h={day:'Monday',employeeId:'e',sourceShiftId:'first',targetShiftId:'second',position:'Guard',type:'late-stay',hours:4};
 const r=req({startTime:'16:00',endTime:'17:00'});
 assert.equal(issues(schedule(),[r]).length,0);
 assert(blocked(issues(schedule(),[r],{handoffs:[h]},emp({willing16h:true}))));
 assert.equal(issues(schedule(),[req({startTime:'18:00',endTime:'19:00'})],{handoffs:[h]},emp({willing16h:true})).length,0);
});
test('PTO credit remains explicit and independent of unavailable duration',()=>{
 const r=req({paid:true,ptoHoursByDate:{'2026-09-07':2}});
 assert.equal(core.buildPtoCredits([emp()],[r],week).hoursByEmployee.e,2);
 assert.equal(core.timeOffIntervals(r,week)[0].end-core.timeOffIntervals(r,week)[0].start,3);
 assert(blocked(issues(schedule(),[r])));
});
test('manual whole-schedule policy prevents moving work into partial leave',()=>{
 const before=schedule('Monday','second'),after=schedule();
 assert(core.scheduleChangeIssues(before,after,[emp()],{}, {empTimeOffDays:availability([req()],week)}).some(i=>i.type==='availability'));
});
function repair(requests) {
 const roster=[emp(),emp({id:'scale',qualifications:['Scale']}),emp({id:'guard',qualifications:['Guard']})];
 const ns={Monday__second:[{employeeId:'scale',position:'Scale'},{employeeId:'guard',position:'Guard'}]};
 const timeOff=availability(requests,week),cfg={minRestHours:12};
 const validate=(s,x,e,h=[])=>[...validateCoverage(s,roster,x,h),...validateAssignmentPolicy(s,roster,cfg,{extShifts:x,handoffs:h,empTimeOffDays:timeOff})];
 const result={ns,autoExtShifts:[],handoffs:[],hourTracker:{e:0,scale:8,guard:8},issues:validate(ns,[],roster).filter(i=>i.day==='Monday'&&i.shiftId==='second')};
 return core.repairScheduleGaps(result,{source:roster,cfg,empTimeOffDays:timeOff,validateSchedule:validate});
}
test('production gap repair uses availability after leave and refuses overlapping replacements',()=>{
 assert(repair([req()]).ns.Monday__second.some(a=>a.employeeId==='e'));
 assert(!repair([req({startTime:'15:00',endTime:'17:00'})]).ns.Monday__second.some(a=>a.employeeId==='e'));
});
function approval(r) {
 const start=html.indexOf('  const setStatus = (id, status) => {',html.indexOf('function TimeOffManager()')),end=html.indexOf('\n  const remove =',start);
 let requests=[r],errors=[];
 const run=new Function(...Object.keys(core),'timeOffRequests','setTimeOffRequests','editPto','setErrors',html.slice(start,end)+'return setStatus;')(...Object.values(core),requests,f=>{requests=f(requests);},()=>{},e=>{errors=e;});
 run(r.id,'approved');return {requests,errors};
}
test('production approval rejects invalid times even on unpaid leave and accepts explicit overnight dates',()=>{
 assert.equal(approval(req({status:'pending',startTime:''})).requests[0].status,'pending');
 assert(approval(req({status:'pending',startTime:''})).errors.length);
 assert.equal(approval(req({status:'pending',startTime:'23:00',endTime:'02:00',endDate:'2026-09-08'})).requests[0].status,'approved');
});
test('production timing edits preserve a newer denial status and save PTO alongside dates',()=>{
 const start=html.indexOf('  const saveTime = () => {'),end=html.indexOf('  const [editingPto',start);
 let requests=[req({status:'denied'})];
 const draft=req({paid:true,startTime:'10:00',ptoHoursByDate:{'2026-09-07':2}});
 const run=new Function(...Object.keys(core),'timeDraft','editingTime','setErrors','setTimeOffRequests','setEditingTime','setTimeDraft',html.slice(start,end)+'return saveTime;')(...Object.values(core),draft,'r',e=>assert.equal(e.length,0),f=>{requests=f(requests);},()=>{},()=>{});
 run();assert.equal(requests[0].status,'denied');assert.equal(requests[0].startTime,'10:00');assert.deepEqual(requests[0].ptoHoursByDate,{'2026-09-07':2});
});
function runProduction(requests, replacement=false) {
 const roster=[];
 for(const sid of ['first','second','third']) for(let group=0;group<2;group++) for(let n=0;n<3;n++)
  roster.push(emp({id:`${sid}-${group}-${n}`,name:`${sid}-${group}-${n}`,qualifications:['Guard','Scale','Medical'],requiredShift:sid,overtimePref:'blocked',availableDaysOfWeek:group?DAYS.slice(3):DAYS.slice(0,3),maxShiftsPerWeek:4}));
 roster.push(emp({id:'sup',name:'Supervisor',qualifications:['Supervisor'],employmentType:'full-time',requiredShift:'first',overtimePref:'blocked'}));
 if(replacement) roster.push(emp({id:'backup',name:'Backup',qualifications:['Guard','Scale','Medical'],requiredShift:'first',availableDaysOfWeek:['Monday'],maxShiftsPerWeek:1}));
 const timeOff=availability(requests,week),cfg={maxConsecutiveNights:4,minRestHours:12,maxConsecutiveShifts:5};
 const validate=(s,x,e,h=[])=>[...validateCoverage(s,roster,x,h),...validateAssignmentPolicy(s,roster,cfg,{extShifts:x,handoffs:h,empTimeOffDays:timeOff})];
 const start=html.indexOf('    const attempt = (jitter, withProactive = true) => {'),end=html.indexOf('    // ── Commit best result',start);
 const run=new Function(...Object.keys(core),'source','cfg','empTimeOffDays','enrichedPatterns','extShifts','swingDesig','validateSchedule','accountingRoster','ptoHoursByEmployee','preservedSchedule','preservedHandoffs','excludeSet',"const schedule=preservedSchedule,handoffs=preservedHandoffs,fairnessHistory={};"+html.slice(start,end)+'return attempt;')(...Object.values(core),roster,cfg,timeOff,{},[],{},validate,roster,{},{},[],new Set());
 return run(false);
}
test('production generation fills all positions while using other shifts on a partial-leave day',()=>{
 const result=runProduction([req({empId:'second-0-0'})]);
 assert.equal(result.errors,0,JSON.stringify(result.issues));assert.equal(Object.values(result.ns).flat().length,68);
 assert(result.ns.Monday__second.some(a=>a.employeeId==='second-0-0'));
});
test('production generation replaces an overlapping assignment and keeps other days intact',()=>{
 const result=runProduction([req({empId:'first-0-0'})],true);
 assert.equal(result.errors,0,JSON.stringify(result.issues));assert.equal(Object.values(result.ns).flat().length,68);
 assert(!result.ns.Monday__first.some(a=>a.employeeId==='first-0-0'));
 assert(result.ns.Monday__first.some(a=>a.employeeId==='backup'));
 assert(result.ns.Tuesday__first.some(a=>a.employeeId==='first-0-0'));
});

test('calendar uses actual overnight dates and excludes the instant leave ends at midnight',()=>{
 assert.deepEqual(core.timeOffCalendarDates(req({startTime:'23:00',endDate:'2026-09-08',endTime:'02:00'})),['2026-09-07','2026-09-08']);
 assert.deepEqual(core.timeOffCalendarDates(req({startTime:'23:00',endDate:'2026-09-08',endTime:'00:00'})),['2026-09-07']);
 assert.deepEqual(core.timeOffCalendarDates({type:'partial',shiftId:'third',startDate:'2026-09-07'}),['2026-09-07','2026-09-08']);
});
test('production submit preserves explicit overnight dates, times and per-date PTO',()=>{
 const start=html.indexOf('  const formPto = () =>',html.indexOf('function TimeOffManager()')),end=html.indexOf('  const setStatus =',start);
 const form=req({status:'pending',paid:true,startTime:'23:00',endTime:'02:00',endDate:'2026-09-08',note:'Appointment',ptoHoursByDate:{'2026-09-07':1,'2026-09-08':2}});
 let requests=[];
 const run=new Function(...Object.keys(core),'form','setForm','setErrors','setTimeOffRequests','EMPTY_FORM','uid',html.slice(start,end)+'return submit;')(...Object.values(core),form,()=>{},e=>assert.equal(e.length,0),f=>{requests=f(requests);},{},()=> 'new');
 run();assert.equal(requests.length,1);assert.equal(requests[0].endDate,'2026-09-08');assert.equal(requests[0].endTime,'02:00');
 assert.equal(requests[0].timeMode,'range');assert.equal(requests[0].shiftId,null);assert.deepEqual(requests[0].ptoHoursByDate,form.ptoHoursByDate);
});
test('production validator refreshes overlap errors after approved leave changes',()=>{
 const roster=[emp()];
 const start=html.indexOf('const validateSchedule = useCallback(')+'const validateSchedule = useCallback('.length,end=html.indexOf('\n  }, [',start)+'\n  }'.length;
 const validate=requests=>new Function(...Object.keys(core),'employees','extShifts','cfg','empTimeOffDays','empPatterns','history','weekStart','timeOffReqs','afExclude','ptoHoursByEmployee','return '+html.slice(start,end))(...Object.values(core),roster,[],{},availability(requests,week),{},[],week,requests,[],{});
 assert(blocked(validate([req()])(schedule(),[],roster,[])));
 assert.equal(blocked(validate([req({status:'denied'})])(schedule(),[],roster,[])),false);
 assert.equal(blocked(validate([req({startTime:'14:00',endTime:'15:00'})])(schedule(),[],roster,[])),false);
});
