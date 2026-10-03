"use strict";
// Per-day, per-shift availability grid: standing employee pattern plus one-week
// overrides. "no" blocks every hour of that shift; "prefer"/"ok" never block.
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('./load-core');
const {cellKey,buildTimeOffAvailability:availability,employeePolicyIssues,availabilityConflicts,shiftInterval,
  shiftAvailabilityErrors,shiftAvailabilityState,weekAvailabilityFor,weekAvailabilityField,makeHistoryEntry,
  scheduleViewSnapshot,publicationSnapshot,publicationStamp,extendedWorkIntervals,buildAutoFill,DAYS,SHIFTS} = core;
const week = '2026-09-06';
const emp = (extra={}) => ({id:'e',name:'Employee',qualifications:['Guard','Medical'],employmentType:'part-time',...extra});
const schedule = (day='Monday',sid='first',id='e') => ({[cellKey(day,sid)]:[{employeeId:id,position:'Guard'}]});
const issues = (e, s, timeOff=availability([],week), extra={}) => employeePolicyIssues(e,s,{},{empTimeOffDays:timeOff,...extra});
const blocked = list => list.some(i=>i.type==='availability');
const dataError = list => list.some(i=>i.type==='availability_data');

test('no grid and no overrides leave every shift available',()=>{
  for (const day of DAYS) for (const s of SHIFTS) assert.equal(blocked(issues(emp(),schedule(day,s.id))),false);
  assert.equal(shiftAvailabilityState(emp(),'Monday','first',availability([],week)),'ok');
});
test('a standing "no" blocks only that day and shift',()=>{
  const e = emp({shiftAvailability:{Monday:{first:'no'}}});
  const conflict = issues(e,schedule('Monday','first')).find(i=>i.type==='availability');
  assert(conflict && /shift availability/.test(conflict.msg));
  assert.equal(blocked(issues(e,schedule('Monday','second'))),false);
  assert.equal(blocked(issues(e,schedule('Tuesday','first'))),false);
});
test('"prefer" and "ok" never block',()=>{
  const e = emp({shiftAvailability:{Monday:{first:'prefer',second:'ok'}}});
  assert.equal(blocked(issues(e,schedule('Monday','first'))),false);
  assert.equal(blocked(issues(e,schedule('Monday','second'))),false);
});
test('third shift "no" covers its hours past midnight but not the next first shift',()=>{
  const e = emp({shiftAvailability:{Monday:{third:'no'}}});
  assert(blocked(issues(e,schedule('Monday','third'))));
  assert.equal(availabilityConflicts(e,[{start:50,end:54}],null).length,1); // Tue 02:00-06:00
  assert.equal(blocked(issues(e,schedule('Tuesday','first'))),false);
});
test('Saturday third standing "no" reaches the next week and last week\'s spill-over',()=>{
  const e = emp({shiftAvailability:{Saturday:{third:'no'}}});
  assert(blocked(issues(e,schedule('Saturday','third'))));
  // Previous Saturday 22:00 to this Sunday 06:00 is hours -2..6.
  assert.equal(availabilityConflicts(e,[{start:0,end:4}],null).length,1);
  assert.equal(blocked(issues(e,schedule('Sunday','first'))),false);
});
test('strict by hours: a 12-hour day duty is blocked by a "no" on the shift it runs into',()=>{
  const e = emp({shiftAvailability:{Monday:{second:'no'}}});
  // Day 12-hour pair: the first half 06:00-18:00 runs four hours into second shift.
  const twelve = extendedWorkIntervals({day:'Monday',pairId:'day',empAId:'e',empBId:'x'}).filter(i=>i.employeeId==='e');
  assert(twelve.length);
  assert(availabilityConflicts(e,twelve,null).length > 0);
  assert.equal(availabilityConflicts(emp(),twelve,null).length,0);
  // An early arrival 10:00-14:00 before second shift overlaps a first-shift "no".
  const first = emp({shiftAvailability:{Monday:{first:'no'}}});
  assert.equal(availabilityConflicts(first,[{start:34,end:38}],null).length,1);
});
test('a week override replaces the standing cell for that week only',()=>{
  const e = emp({shiftAvailability:{Monday:{first:'no'}}});
  const open = availability([],week,{e:{Monday:{first:'ok'}}});
  assert.equal(blocked(issues(e,schedule('Monday','first'),open)),false);
  assert.equal(shiftAvailabilityState(e,'Monday','first',open),'ok');
  const closed = availability([],week,{e:{Wednesday:{second:'no'}}});
  assert(blocked(issues(emp(),schedule('Wednesday','second'),closed)));
  assert(blocked(issues(e,schedule('Monday','first'),closed)),'standing cell still applies where the week has no override');
  assert.equal(shiftAvailabilityState(emp(),'Wednesday','second',closed),'no');
});
test('week overrides do not leak into the adjacent weeks',()=>{
  const timeOff = availability([],week,{e:{Saturday:{third:'no'}}});
  assert(blocked(issues(emp(),schedule('Saturday','third'),timeOff)));
  assert.equal(availabilityConflicts(emp(),[{start:0,end:6}],timeOff).length,0,'this Sunday morning is not last Saturday night');
});
test('overrides for other employees do not affect this one',()=>{
  const timeOff = availability([],week,{other:{Monday:{first:'no'}}});
  assert.equal(blocked(issues(emp(),schedule(),timeOff)),false);
});
test('malformed standing grids fail closed with a data error',()=>{
  for (const bad of [[], 'no', {Funday:{first:'no'}}, {Monday:{fourth:'no'}}, {Monday:{first:'maybe'}}, {Monday:['first']}]) {
    assert(shiftAvailabilityErrors(bad).length, JSON.stringify(bad));
    const e = emp({shiftAvailability:bad}), list = issues(e,schedule('Tuesday','second'));
    assert(dataError(list)); assert(blocked(list));
  }
  for (const ok of [null, undefined, {}, {Monday:null}, {Monday:{first:null}}, {Monday:{first:'prefer',second:'ok',third:'no'}}])
    assert.equal(shiftAvailabilityErrors(ok).length,0,JSON.stringify(ok));
});
test('malformed week overrides fail closed for that employee and report the problem',()=>{
  const timeOff = availability([],week,{e:{Monday:{first:'sometimes'}}});
  assert(timeOff.issues.some(i=>i.type==='availability_data' && i.employeeId==='e'));
  assert(blocked(issues(emp(),schedule('Friday','second'),timeOff)));
  assert.equal(blocked(issues(emp({id:'x'}),schedule('Friday','second','x'),timeOff)),false);
  assert(availability([],week,'bad').issues.some(i=>i.type==='availability_data'));
});
test('weekAvailabilityFor picks the week and passes malformed stores through',()=>{
  const store = {[week]:{e:{Monday:{first:'no'}}}};
  assert.deepEqual(weekAvailabilityFor(store,week),store[week]);
  assert.equal(weekAvailabilityFor(store,'2026-09-13'),null);
  assert.equal(weekAvailabilityFor(null,week),null);
  assert.equal(weekAvailabilityFor('bad',week),'bad');
});
test('snapshots carry week overrides only when present, so existing stamps are unchanged',()=>{
  const input = {weekStart:week,schedule:{},extShifts:[],handoffs:[],trainingBlocks:[],timeOffReqs:[],employees:[emp()],cfg:{},history:[]};
  assert.deepEqual(weekAvailabilityField(null),{});
  assert.deepEqual(weekAvailabilityField({}),{});
  assert.equal(publicationStamp(publicationSnapshot(input)),publicationStamp(publicationSnapshot({...input,weekAvailability:{}})));
  const withOverride = {...input,weekAvailability:{e:{Monday:{first:'no'}}}};
  assert.notEqual(publicationStamp(publicationSnapshot(input)),publicationStamp(publicationSnapshot(withOverride)));
  assert.equal(Object.hasOwn(makeHistoryEntry(input),'weekAvailability'),false);
  const entry = makeHistoryEntry(withOverride);
  assert.deepEqual(entry.weekAvailability,withOverride.weekAvailability);
  assert.deepEqual(scheduleViewSnapshot({weekAvailability:{e:{}}},entry).weekAvailability,entry.weekAvailability);
  assert.equal(scheduleViewSnapshot({weekAvailability:{e:{Monday:{first:'no'}}}},makeHistoryEntry(input)).weekAvailability,null,
    'viewing an older week never borrows the live week\'s overrides');
});
test('autofill never assigns a "no" cell',()=>{
  const roster = [
    ...['a','b','c','d','f','g','h','i','j','k','l','m'].map((id,i)=>({id,name:'E'+id,employmentType:'full-time',
      qualifications:['Guard','Scale','Medical'],preferredShifts:[],blockedShifts:[],unavailableDays:[],maxShiftsPerWeek:null})),
  ];
  roster[0].shiftAvailability = {Monday:{first:'no',second:'no'},Tuesday:{third:'no'}};
  const timeOff = availability([],week,{b:{Wednesday:{first:'no',second:'no',third:'no'}}});
  const log = console.log, warn = console.warn; console.log = console.warn = () => {};
  let result; try { result = buildAutoFill(roster,{maxSearchNodes:2000,maxSearchMs:500},timeOff,{},[],false,{roster}); }
  finally { console.log = log; console.warn = warn; }
  const on = (id,day,sid) => (result.schedule[cellKey(day,sid)] || []).some(x=>x.employeeId===id);
  assert.equal(on('a','Monday','first'),false); assert.equal(on('a','Monday','second'),false);
  assert.equal(on('a','Tuesday','third'),false);
  for (const sid of ['first','second','third']) assert.equal(on('b','Wednesday',sid),false);
});
