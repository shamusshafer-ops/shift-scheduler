"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const core = require("./load-core");
const { buildPtoCredits, buildWeeklyAccounting, weeklyEmployeeHours, ptoRequestErrors, DAYS, cellKey } = core;
const week = "2026-09-06";
const dates = core.weekDatesISO(week);
const employee = (extra = {}) => ({ id: "e", name: "Employee", qualifications: ["Guard"], employmentType: "full-time", ...extra });
const assignment = (employeeId = "e", position = "Guard") => ({ employeeId, position });
const schedule = (days, id = "e", sid = "first") => Object.fromEntries(days.map(d => [cellKey(d,sid), [assignment(id)]]));
const request = (extra = {}) => ({ id: "r", empId: "e", type: "vacation", status: "approved", startDate: dates[1], endDate: dates[1], ptoHoursByDate: { [dates[1]]: 8 }, ...extra });
const account = (sched, requests, roster = [employee()], excluded = []) => buildWeeklyAccounting(roster, sched, [], [], requests, week, excluded);

test("32 worked + 8 approved PTO meets the forty-hour obligation", () => {
  const result = account(schedule(["Tuesday","Wednesday","Thursday","Friday"]), [request()]);
  assert.deepEqual([result.rows[0].workedHours,result.rows[0].ptoHours,result.rows[0].creditedHours,result.rows[0].shortfallHours], [32,8,40,0]);
  assert.equal(result.allFullTimeAccounted, true);
  assert.equal(result.issues.length, 0);
});

test("full-week PTO uses five explicit paid dates and two zero-credit rest days", () => {
  const req = request({startDate: dates[0], endDate: dates[6], ptoHoursByDate: Object.fromEntries(dates.map((d,i) => [d, i === 0 || i === 6 ? 0 : 8]))});
  const result = account({}, [req]);
  assert.equal(result.rows[0].ptoHours, 40);
  assert.equal(result.rows[0].status, "PTO");
  assert.equal(result.allFullTimeAccounted, true);
  assert(core.validateCoverage({}, [employee()]).length > 0, "paid leave supplies no coverage");
});

test("pending, denied and unpaid requests provide zero credit", () => {
  const reqs = [request({status:"pending"}),request({status:"denied"}),request({type:"single_day",ptoHoursByDate:{}})];
  assert.equal(buildPtoCredits([employee()],reqs,week).hoursByEmployee.e,0);
});

test("legacy approved vacation without paid hours requires review, never invented credit", () => {
  const result = account({}, [request({ptoHoursByDate:undefined})]);
  assert.equal(result.rows[0].ptoHours,0);
  assert.equal(result.rows[0].ptoNeedsReview,true);
  assert(result.issues.some(i => i.type === "pto_hours_missing"));
  assert(result.issues.some(i => i.type === "weekly_obligation" && i.level === "error"));
});

test("PTO is clipped to the selected week even when a request crosses a month", () => {
  const req = request({startDate:"2026-08-30",endDate:"2026-09-08",ptoHoursByDate:Object.fromEntries(core.dateRangeISO("2026-08-30","2026-09-08").map(d => [d,8]))});
  assert.equal(buildPtoCredits([employee()],[req],week).hoursByEmployee.e,24);
  assert.equal(buildPtoCredits([employee()],[req],"2026-09-13").hoursByEmployee.e,0);
});

test("duplicate approvals never multiply credit and conflicting hours require review", () => {
  assert.equal(buildPtoCredits([employee()],[request(),request({id:"duplicate"})],week).hoursByEmployee.e,8);
  const result = buildPtoCredits([employee()],[request(),request({id:"conflict",ptoHoursByDate:{[dates[1]]:4}})],week);
  assert.equal(result.hoursByEmployee.e,0);
  assert(result.issues.some(i => i.type === "pto_conflict"));
});

test("fractional PTO is preserved and malformed hours cannot satisfy obligations", () => {
  assert.equal(buildPtoCredits([employee()],[request({ptoHoursByDate:{[dates[1]]:3.5}})],week).hoursByEmployee.e,3.5);
  for (const value of [-1,25,NaN,Infinity,"8","",null]) {
    assert(ptoRequestErrors(request({ptoHoursByDate:{[dates[1]]:value}})).length > 0);
    assert.equal(buildPtoCredits([employee()],[request({ptoHoursByDate:{[dates[1]]:value}})],week).hoursByEmployee.e,0);
  }
  assert.equal(core.validISODate("2026-02-30"),false);
});

test("out-of-range credit and unknown employees are explicit errors", () => {
  const result = buildPtoCredits([employee()],[request({ptoHoursByDate:{[dates[1]]:8,[dates[2]]:8}}),request({empId:"missing"})],week);
  assert.equal(result.hoursByEmployee.e,8);
  assert(result.issues.some(i => i.type === "pto_outside_request"));
  assert(result.issues.some(i => i.type === "pto_unknown_employee"));
});

test("No OT includes PTO credits for regular, extended and handoff work", () => {
  const e = employee({overtimePref:"blocked",ext12hPref:"day"});
  const opts = {ptoHoursByEmployee:{e:8}};
  const s = schedule(["Tuesday","Wednesday","Thursday","Friday"]);
  assert.equal(core.employeePolicyIssues(e,s,{},opts).length,0);
  assert(core.assignmentIssues(e,"Saturday","first","Guard",s,{},opts).some(i => i.type === "no_overtime"));
  assert(core.employeePolicyIssues(e,{}, {}, {ptoHoursByEmployee:{e:32},extShifts:[{day:"Tuesday",pairId:"day",empAId:"e"}]}).some(i => i.type === "no_overtime"));
  const handoff = {day:"Friday",employeeId:"e",sourceShiftId:"first",targetShiftId:"second",position:"Guard",type:"late-stay",hours:4};
  assert(core.employeePolicyIssues(e,s,{}, {...opts,handoffs:[handoff]}).some(i => i.type === "no_overtime"));
});

test("worked totals deduplicate mirror records and ignore orphan handoffs", () => {
  const e = employee();
  const ext = [{day:"Sunday",pairId:"day",empAId:"e"}];
  const h = [{day:"Friday",employeeId:"e",sourceShiftId:"first",targetShiftId:"second",position:"Guard",type:"late-stay",hours:4}];
  assert.equal(weeklyEmployeeHours(e,schedule(["Sunday"]),ext,h,{e:8}).creditedHours,20);
});

test("every roster employee appears, including excluded, trainee and on-call staff", () => {
  const roster = [employee(),employee({id:"pt",employmentType:"part-time"}),employee({id:"oc",employmentType:"on-call"}),employee({id:"trn",inTraining:true})];
  const result = account({},[],roster,["e"]);
  assert.deepEqual(result.rows.map(r => r.employeeId),["e","pt","oc","trn"]);
  assert.equal(result.rows[0].excluded,true);
  assert.equal(result.issues.filter(i => i.type === "weekly_obligation").length,2);
  assert.equal(result.rows.find(r => r.employeeId === "oc").targetHours,null);
  assert.equal(result.issues.filter(i => i.type === "employee_unscheduled").length,2);
});

test("a restrictive shift cap does not silently reduce the FT forty-hour obligation", () => {
  const result = account(schedule(["Tuesday","Wednesday","Thursday","Friday"]),[],[employee({maxShiftsPerWeek:4})]);
  assert.equal(result.rows[0].shortfallHours,8);
  assert(result.issues.some(i => i.type === "weekly_obligation" && i.level === "error"));
});

const html = fs.readFileSync(__dirname + "/ShiftScheduler_latest loop.html","utf8");
function productionValidator(roster, requests, excluded = []) {
  const start = html.indexOf("const validateSchedule = useCallback(") + "const validateSchedule = useCallback(".length;
  const end = html.indexOf("\n  }, [",start) + "\n  }".length;
  return new Function(...Object.keys(core),"employees","extShifts","cfg","empTimeOffDays","empPatterns","history","weekStart","timeOffReqs","afExclude","ptoHoursByEmployee",
    "return " + html.slice(start,end))(...Object.values(core),roster,[],{},new Set(),{},[],week,requests,excluded,buildPtoCredits(roster,requests,week).hoursByEmployee);
}

test("production validation cannot hide an excluded FT employee in a filtered roster", () => {
  const roster = [employee()];
  const issues = productionValidator(roster,[],["e"])({},[],[],[]);
  assert(issues.some(i => i.type === "weekly_obligation" && i.employeeId === "e" && i.level === "error"));
});

test("production validation accepts approved PTO credit and catches later denial", () => {
  const roster = [employee()],s = schedule(["Tuesday","Wednesday","Thursday","Friday"]);
  assert(!productionValidator(roster,[request()])(s,[],roster,[]).some(i => i.type === "weekly_obligation"));
  assert(productionValidator(roster,[request({status:"denied"})])(s,[],roster,[]).some(i => i.type === "weekly_obligation"));
});

test("production approval control refuses paid leave with unspecified hours", () => {
  const start = html.indexOf("  const setStatus = (id, status) => {",html.indexOf("function TimeOffManager()"));
  const end = html.indexOf("\n  const remove =",start);
  let requests = [request({status:"pending",ptoHoursByDate:undefined})], errors = [];
  const setStatus = new Function(...Object.keys(core),"timeOffRequests","setTimeOffRequests","editPto","setErrors",
    html.slice(start,end)+"return setStatus;")(...Object.values(core),requests,fn => {requests=fn(requests);},()=>{},e => {errors=e;});
  setStatus("r","approved");
  assert.equal(requests[0].status,"pending");
  assert(errors.length > 0);
});

function feasibleRoster() {
  const roster=[];
  for(const sid of ["first","second","third"]) for(let group=0;group<2;group++) for(let n=0;n<3;n++)
    roster.push(employee({id:`${sid}-${group}-${n}`,name:`${sid}-${group}-${n}`,qualifications:["Guard","Scale","Medical"],employmentType:"part-time",
      overtimePref:"blocked",requiredShift:sid,availableDaysOfWeek:group?DAYS.slice(3):DAYS.slice(0,3),maxShiftsPerWeek:4}));
  roster.push(employee({id:"sup",name:"Supervisor",qualifications:["Supervisor"],requiredShift:"first",overtimePref:"blocked"}));
  return roster;
}
function runAttempt(roster, excluded, preservedSchedule, credits) {
  const source = roster.filter(e => !excluded.includes(e.id));
  const cfg = {maxConsecutiveNights:4,minRestHours:12,maxConsecutiveShifts:5};
  const validate = (s,exts,emps,h=[]) => [...core.validateCoverage(s,roster,exts,h),...core.validateAssignmentPolicy(s,roster,cfg,{extShifts:exts,handoffs:h,ptoHoursByEmployee:credits})];
  const start = html.indexOf("    const attempt = (jitter, withProactive = true) => {"), end=html.indexOf("    // ── Commit best result",start);
  const attempt = new Function(...Object.keys(core),"source","cfg","empTimeOffDays","enrichedPatterns","extShifts","swingDesig","validateSchedule","accountingRoster","ptoHoursByEmployee","preservedSchedule","preservedHandoffs","excludeSet",
    "const schedule=preservedSchedule,handoffs=preservedHandoffs,fairnessHistory={};"+html.slice(start,end)+"return attempt;")(...Object.values(core),source,cfg,new Set(),{},[],{},validate,roster,credits,preservedSchedule,[],new Set(excluded));
  return attempt(false);
}

test("production generation counts PTO toward target and preserves excluded employee and supervisor assignments", () => {
  const roster = feasibleRoster();
  roster[0].employmentType="full-time";
  const held=schedule(DAYS.slice(0,3),roster[0].id);
  for(const d of DAYS.slice(1,6)) held[cellKey(d,"first")]=[...(held[cellKey(d,"first")]||[]),assignment("sup","Supervisor")];
  const before=JSON.stringify(held),credits={[roster[0].id]:16};
  const result=runAttempt(roster,[roster[0].id,"sup"],held,credits);
  assert.equal(JSON.stringify(held),before,"preserved inputs remain unchanged");
  assert.equal(result.errors,0,JSON.stringify(result.issues));
  assert.equal(Object.values(result.ns).flat().length,68);
  assert.deepEqual(weeklyEmployeeHours(roster[0],result.ns,result.autoExtShifts,result.handoffs,credits).shortfallHours,0);
  for(const [key,assignments] of Object.entries(held)) for(const a of assignments)
    assert(result.ns[key].some(b => b.employeeId===a.employeeId && b.position===a.position));
});

test("production autofill does not make up forty work hours for a PTO-credited employee", () => {
  const roster=feasibleRoster();
  roster[0].employmentType="full-time";
  const credits={[roster[0].id]:16}, result=runAttempt(roster,[],{},credits);
  const hours=weeklyEmployeeHours(roster[0],result.ns,result.autoExtShifts,result.handoffs,credits);
  assert.equal(result.errors,0,JSON.stringify(result.issues));
  assert.equal(hours.workedHours,24);
  assert.equal(hours.creditedHours,40);
});
