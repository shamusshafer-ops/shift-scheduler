'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('./load-core');
const emp = (id, extra = {}) => ({id, name:id, employmentType:'part-time',
  qualifications:['Guard','Scale','Medical'], overtimePref:'blocked', ...extra});
const row = (employeeId, position = 'Guard') => ({employeeId, position});
const roster = ['a','b','c','d'].map(id => emp(id));
const three = roster.slice(0,3).map(e => row(e.id));
const over = issues => issues.filter(i => i.type === 'overstaffed');
function solve(input) {
  const search = c.createCompleteScheduleSearch({weekStart:'2026-09-06', cfg:{}, ...input});
  const deadline = Date.now() + 15000;
  let result;
  do {
    result = search.advance({maxSteps:10000, timeSliceMs:40});
    assert(Date.now() < deadline, 'fixture must finish, rather than assume infeasibility');
  } while (result.status === 'searching');
  return result;
}

test('all 21 shifts allow exactly three regular staff; only weekday first allows a supervisor', () => {
  const staff = [...roster, emp('sup', {qualifications:['Supervisor']}), emp('sup2', {qualifications:['Supervisor']})];
  for (const day of c.DAYS) for (const shift of c.SHIFTS) {
    const key = c.cellKey(day,shift.id), needsSup = c.SUP_SLOT_DAY(day,shift.id);
    const correct = {[key]:[...three, ...(needsSup ? [row('sup','Supervisor')] : [])]};
    assert.equal(c.analyzeShiftCoverage(day,shift.id,correct,staff).ok,true,key);
    for (const extra of [row('d'),row('sup2','Supervisor')]) {
      const bad = {[key]:[...correct[key],extra]};
      assert.equal(c.analyzeShiftCoverage(day,shift.id,bad,staff).ok,false,key);
      assert.equal(over(c.validateAssignmentPolicy(bad,staff)).length,1,key);
      assert.equal(over(c.validateCoverage(bad,staff)).length,1,key);
    }
  }
});

test('a fourth regular cannot occupy the reserved supervisor position', () => {
  const schedule = {Monday__first:roster.map(e => row(e.id))};
  assert.equal(over(c.validateAssignmentPolicy(schedule,roster)).length,1);
});

test('manual assignment and automatic cleanup enforce the same maximum', () => {
  const schedule = {Sunday__second:three};
  assert.equal(over(c.assignmentIssues(roster[3],'Sunday','second','Guard',schedule)).length,1);
  const bad = {Sunday__second:[...three,row('d')]};
  assert.equal(over(c.scheduleChangeIssues(schedule,bad,roster)).length,1);
  assert.deepEqual(c.scheduleChangeIssues(bad,schedule,roster),[]);
  const filtered = c.filterPolicyAssignments(bad,roster,{});
  assert.equal(filtered.schedule.Sunday__second.length,3);
  assert.equal(filtered.rejected.length,1);
});

test('cleanup includes preserved employees even when only the generated subset is validated', () => {
  const preservedSchedule = {Sunday__second:three.slice(0,2)};
  const filtered = c.filterPolicyAssignments({Sunday__second:three.slice(2).concat(row('d'))},roster.slice(2),{}, {preservedSchedule});
  assert.equal(filtered.schedule.Sunday__second.length,1);
  assert.equal(filtered.rejected.length,1);
  assert.deepEqual(preservedSchedule.Sunday__second,three.slice(0,2));
});

test('adding elsewhere and reducing an existing excess do not prevent repairs', () => {
  const bad = {Sunday__second:[...three,row('d')]};
  assert.deepEqual(c.assignmentIssues(emp('new'),'Monday','second','Guard',bad),[]);
  const five = {Sunday__second:[...bad.Sunday__second,row('new')]};
  assert.deepEqual(c.scheduleChangeIssues(five,bad,[...roster,emp('new')]),[]);
});

test('extended duties and handoffs may not overstaff even part of a shift', () => {
  const exts = [{day:'Sunday',pairId:'day',empAId:'d',empBId:null}];
  const schedule = {Sunday__second:three};
  assert.equal(over(c.validateAssignmentPolicy(schedule,roster,{}, {extShifts:exts})).length,1);
  const withSource = {...schedule,Sunday__first:[row('d')]};
  const handoffs = [{day:'Sunday',employeeId:'d',position:'Guard',sourceShiftId:'first',targetShiftId:'second',type:'late-stay',hours:4}];
  const issues = over(c.validateAssignmentPolicy(withSource,roster,{}, {handoffs}));
  assert.equal(issues.length,1);
  assert.match(issues[0].msg,/14:00–18:00/);
  assert.equal(over(c.scheduleChangeIssues(withSource,withSource,roster,{}, {},{handoffs})).length,1);
});

test('complementary half shifts and mirrored extended records do not double-count people', () => {
  const staff = [...roster,emp('late')];
  const schedule = {Sunday__second:three.slice(0,2)};
  const exts = [{day:'Sunday',pairId:'day',empAId:'d',empBId:'late'}];
  assert.equal(over(c.validateAssignmentPolicy(schedule,staff,{}, {extShifts:exts})).length,0);
  assert.equal(c.analyzeShiftCoverage('Sunday','second',schedule,staff,exts).ok,true);
  schedule.Sunday__second.push(row('d'),row('late'));
  assert.equal(over(c.validateAssignmentPolicy(schedule,staff,{}, {extShifts:exts})).length,0);
  assert.equal(c.analyzeShiftCoverage('Sunday','second',schedule,staff,exts).ok,true);
});

test('fast autofill and the slot picker reserve space for partial extended coverage', () => {
  const employees = roster.slice(0,3).map(e=>({...e,requiredShift:'second',availableDaysOfWeek:['Sunday']}));
  const extended = emp('extended',{requiredShift:'first',ext12hPref:'day'});
  const exts = [{day:'Sunday',pairId:'day',empAId:'extended'}];
  assert.equal(c.getEffectiveSlotCount('Sunday','second',exts,[...employees,extended]),2);
  const result = c.buildAutoFill(employees,{maxSearchNodes:100,maxSearchMs:100},new Set(),{},exts,false,{roster:[...employees,extended]});
  assert.equal(result.schedule.Sunday__second.length,2);
  assert.equal(c.validateStaffing(result.schedule,exts).length,0);
});

test('complete search cannot add a fourth person to meet full-time hours', () => {
  const employees = roster.map(e => ({...e,requiredShift:'second',availableDaysOfWeek:['Sunday']}));
  employees[3].employmentType = 'full-time';
  const fixed = three.map(r => ({...r,locked:true}));
  const timeOffReqs = [
    {id:'pto1',empId:'d',type:'single_day',startDate:'2026-09-07',endDate:'2026-09-07',status:'approved',paid:true,ptoHoursByDate:{'2026-09-07':24}},
    {id:'pto2',empId:'d',type:'single_day',startDate:'2026-09-08',endDate:'2026-09-08',status:'approved',paid:true,ptoHoursByDate:{'2026-09-08':8}}
  ];
  const result = solve({employees,targetSlots:['Sunday__second'],schedule:{Sunday__second:fixed},timeOffReqs});
  assert.equal(result.status,'infeasible');
  assert.equal(result.solution,null);
  // When the third assignment is unlocked, replace it to satisfy both rules.
  fixed[2].locked = false;
  const repaired = solve({employees,targetSlots:['Sunday__second'],schedule:{Sunday__second:fixed},timeOffReqs});
  assert.equal(repaired.status,'feasible');
  assert.equal(repaired.solution.ns.Sunday__second.length,3);
  assert(repaired.solution.ns.Sunday__second.some(r => r.employeeId === 'd'));
});

test('complete search cannot fix a missing qualification by adding a fourth person', () => {
  const employees = roster.map((e,i) => ({...e,qualifications:i===3?['Medical']:['Guard','Scale'],requiredShift:'second',availableDaysOfWeek:['Sunday']}));
  assert.equal(solve({employees,targetSlots:['Sunday__second'],schedule:{Sunday__second:three.map(r => ({...r,locked:true}))}}).status,'infeasible');
});

test('overstaffed locked input is invalid and its locks are preserved', () => {
  const schedule = {Sunday__second:roster.map(e => ({...row(e.id),locked:true}))};
  const result = solve({employees:roster,targetSlots:['Sunday__second'],schedule});
  assert.equal(result.status,'invalid');
  assert(result.reasons.some(msg => /staff/i.test(msg)));
  assert.equal(schedule.Sunday__second.length,4);
});
