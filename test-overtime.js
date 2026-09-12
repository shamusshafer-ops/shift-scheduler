"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const core = require("./load-core");
const { overtimeReviewItems, makeOvertimeProposal, trimOvertimeProposal, overtimeCreditLimits, resolveOvertimeProposal,
  canWorkOtherShifts, weeklyEmployeeHours, validateCoverage, validateAssignmentPolicy, cellKey } = core;
const emp = (id = "e", extra = {}) => ({id,name:id,qualifications:["Guard","Medical"],employmentType:"full-time",...extra});
const a = (employeeId = "e", position = "Medical") => ({employeeId,position});
const sixDays = ["Sunday","Monday","Tuesday","Thursday","Friday","Saturday"];
const shifts = (days = sixDays, id = "e") => Object.fromEntries(days.map(d => [cellKey(d,"first"),[a(id)]]));
const proposal = (ns, extra = {}) => ({ns,autoExtShifts:[],handoffs:[],usedPatterns:{},assignLog:{},...extra});
const html = fs.readFileSync(__dirname + "/ShiftScheduler_latest loop.html","utf8");

test("cross-shift permission supports old saves, explicit new false overrides legacy true", () => {
  assert.equal(canWorkOtherShifts(emp("e",{crossShiftOT:true})),true);
  assert.equal(canWorkOtherShifts(emp("e",{crossShiftOT:true,canWorkOtherShifts:false})),false);
  assert.equal(canWorkOtherShifts(emp("e",{canWorkOtherShifts:true})),true);
  assert.equal(canWorkOtherShifts(null),false);
  assert.equal(core.assignmentIssues(emp("e",{requiredShift:"first",canWorkOtherShifts:true}),"Sunday","second","Medical",{}).length,0);
});

test("empty schedules and overtime preference never bypass manager review", () => {
  const employees = [emp("e",{overtimePref:"preferred"})];
  const items = overtimeReviewItems(employees,{},proposal(shifts()));
  assert.equal(items.length,1);
  assert.equal(items[0].currentHours,0);
  assert.equal(items[0].newHours,48);
});

test("part-time and on-call overtime is reviewed and PTO is included", () => {
  for (const employmentType of ["part-time","on-call"]) {
    const items = overtimeReviewItems([emp("e",{employmentType})],{},proposal(shifts(sixDays.slice(0,5))),{},{e:8});
    assert.equal(items.length,1);
    assert.equal(items[0].workedHours,40);
    assert.equal(items[0].ptoHours,8);
    assert.equal(items[0].newHours,48);
  }
});

test("No OT cannot be overridden by an approve-all decision", () => {
  const roster = [emp("e",{overtimePref:"blocked"})];
  const input = proposal(shifts()), items = overtimeReviewItems(roster,{},input);
  assert.equal(items[0].blocked,true);
  const limits = overtimeCreditLimits(roster,items,{e:true});
  assert.equal(limits.e,40);
  assert.equal(weeklyEmployeeHours(roster[0],trimOvertimeProposal(input,roster,limits).ns).workedHours,40);
});

test("a proposal owns its complete snapshot, without changing live records", () => {
  const input = proposal(shifts(),{handoffs:[{employeeId:"e",hours:4}],usedPatterns:{e:{trailingDays:3}}});
  const p = makeOvertimeProposal(input,"base");
  p.ns.Sunday__first[0].position="Guard";
  p.handoffs[0].hours=8; p.usedPatterns.e.trailingDays=7;
  assert.equal(input.ns.Sunday__first[0].position,"Medical");
  assert.equal(input.handoffs[0].hours,4);
  assert.equal(input.usedPatterns.e.trailingDays,3);
});

test("denial removes only the over-budget regular duty, preserving the input", () => {
  const input = proposal(shifts()), before=JSON.stringify(input);
  const result = trimOvertimeProposal(input,[emp()],{e:40});
  assert.equal(JSON.stringify(input),before);
  assert.equal(result.ns.Saturday__first.length,0);
  assert.equal(weeklyEmployeeHours(emp(),result.ns).workedHours,40);
  assert.equal(result.removedOvertime.length,1);
});

test("denying an extended half removes its mirrors but preserves its partner", () => {
  const ext = {day:"Thursday",pairId:"day",empAId:"e",empBId:"partner"};
  const ns = {...shifts(["Sunday"]),Thursday__first:[a()],Thursday__second:[a()]};
  const input = proposal(ns,{autoExtShifts:[ext]});
  const roster = [emp("e",{ext12hPref:"day"}),emp("partner",{ext12hPref:"night"})];
  const result = trimOvertimeProposal(input,roster,{e:40,partner:40},{e:32});
  assert.equal(result.autoExtShifts[0].empAId,null);
  assert.equal(result.autoExtShifts[0].empBId,"partner");
  assert.equal(result.ns.Thursday__first.length,0);
  assert.equal(result.ns.Thursday__second.length,0);
  assert.equal(weeklyEmployeeHours(roster[0],result.ns,result.autoExtShifts,[],{e:32}).creditedHours,40);
  assert.equal(weeklyEmployeeHours(roster[1],result.ns,result.autoExtShifts).workedHours,12);
});

test("denial removes late stays and early arrivals beyond the credited limit", () => {
  for (const [type,sourceShiftId,targetShiftId] of [["late-stay","first","second"],["early-arrival","third","second"]]) {
    const input = proposal({[cellKey("Friday",sourceShiftId)]:[a()]},{handoffs:[{day:"Friday",employeeId:"e",position:"Medical",type,sourceShiftId,targetShiftId,hours:4}]});
    const result = trimOvertimeProposal(input,[emp()],{e:40},{e:32});
    assert.equal(result.handoffs.length,0);
    assert.equal(weeklyEmployeeHours(emp(),result.ns,[],[],{e:32}).creditedHours,40);
  }
});

test("approved overtime is bounded by the exact total reviewed", () => {
  const roster=[emp()],input=proposal(shifts());
  const limits=overtimeCreditLimits(roster,overtimeReviewItems(roster,{},input),{e:true});
  assert.equal(limits.e,48);
  assert.equal(weeklyEmployeeHours(roster[0],trimOvertimeProposal(input,roster,limits).ns).workedHours,48);
  assert(core.assignmentIssues(roster[0],"Wednesday","first","Medical",input.ns,{maxConsecutiveShifts:7},{creditHourLimits:limits}).some(i=>i.type==="overtime_approval_limit"));
});

function repairFixture(replacement = true, replacementAt40 = false) {
  const roster=[emp(),emp("scale",{qualifications:["Guard","Scale"],employmentType:"part-time"}),emp("guard",{qualifications:["Guard"],employmentType:"part-time"})];
  const ns=shifts();
  ns.Saturday__first.push(a("scale","Scale"),a("guard","Guard"));
  if(replacement) {
    roster.push(emp("replacement",{overtimePref:"preferred"}));
    if(replacementAt40) for(const day of sixDays.slice(0,5)) ns[cellKey(day,"first")].push(a("replacement"));
  }
  const input=proposal(ns), cfg={maxConsecutiveShifts:5,minRestHours:12,maxConsecutiveNights:3};
  const validateSchedule=(s,x,e,h)=>[...validateCoverage(s,roster,x,h),...validateAssignmentPolicy(s,roster,cfg,{extShifts:x,handoffs:h})];
  const context={source:roster,cfg,empTimeOffDays:new Set(),ptoHoursByEmployee:{},enrichedPatterns:{},validateSchedule};
  return {roster,input,context};
}

test("denied overtime is replaced by a qualified employee without changing unrelated shifts", () => {
  const {roster,input,context}=repairFixture();
  const result=resolveOvertimeProposal(input,roster,overtimeReviewItems(roster,{},input),{},context);
  assert.equal(core.analyzeShiftCoverage("Saturday","first",result.ns,roster,[],result.handoffs).ok,true);
  assert(result.ns.Saturday__first.some(a=>a.employeeId==="replacement"));
  assert.deepEqual(result.ns.Monday__first,input.ns.Monday__first);
  assert.equal(weeklyEmployeeHours(roster[0],result.ns,[],result.handoffs).creditedHours,40);
  assert.equal(validateAssignmentPolicy(result.ns,roster,context.cfg,{handoffs:result.handoffs,creditHourLimits:result.creditHourLimits}).length,0);
});

test("infeasible denial remains a visible qualified-coverage gap", () => {
  const {roster,input,context}=repairFixture(false);
  const result=resolveOvertimeProposal(input,roster,overtimeReviewItems(roster,{},input),{},context);
  assert(result.issues.some(i=>i.type==="coverage"&&i.day==="Saturday"&&i.shiftId==="first"));
  assert(result.issues.some(i=>i.type==="role"&&i.role==="Medical"&&i.day==="Saturday"));
  assert(!result.ns.Saturday__first.some(a=>a.employeeId==="e"));
});

test("repair cannot transfer unapproved overtime to a willing employee already at forty", () => {
  const {roster,input,context}=repairFixture(true,true);
  const result=resolveOvertimeProposal(input,roster,overtimeReviewItems(roster,{},input),{},context);
  assert(!result.ns.Saturday__first.some(a=>a.employeeId==="replacement"));
  assert.equal(weeklyEmployeeHours(roster[3],result.ns,[],result.handoffs).creditedHours,40);
  assert(result.issues.some(i=>i.type==="coverage"&&i.day==="Saturday"));
});

test("all relevant input changes invalidate an old proposal fingerprint", () => {
  const input={weekStart:"2026-09-06",schedule:{},extShifts:[],handoffs:[],employees:[emp()],cfg:{minRestHours:12},empPatterns:{},timeOffReqs:[],history:[],afExclude:[],swingDesig:{}};
  const stamp=core.overtimeInputStamp(input);
  for(const key of Object.keys(input)) assert.notEqual(core.overtimeInputStamp({...input,[key]:null}),stamp,key);
});

test("production staging on an empty schedule changes only pending state", () => {
  const start=html.indexOf("    const commit = result => {"),end=html.indexOf("    // ── C2:",start);
  let pending=null,commits=0;
  const roster=[emp("e",{overtimePref:"preferred"})];
  const stage=new Function(...Object.keys(core),"accountingRoster","schedule","extShifts","handoffs","cfg","ptoHoursByEmployee","runBaseStamp","proposalIsCurrent","discardStaleProposal","setPendingProposal","commitScheduleProposal",
    html.slice(start,end)+"return commit;")(...Object.values(core),roster,{},[],[],{},{},"base",()=>true,()=>assert.fail("not stale"),p=>{pending=p;},()=>{commits++;});
  const input=proposal(shifts(),{usedPatterns:{e:{trailingDays:3}},handoffs:[]});
  stage(input);
  assert.equal(commits,0);
  assert.equal(pending.reviewItems.length,1);
  assert.deepEqual(pending.usedPatterns,input.usedPatterns);
  assert.notEqual(pending.ns,input.ns);
});

function productionCommit(isCurrent, roster, cfg = {}) {
  const start=html.indexOf("  const commitScheduleProposal = proposal => {"),end=html.indexOf("  const commitAssignmentChange",start);
  const writes=[];
  const setters=["pushUndo","setWeekDraft","setEmpPatterns","setAssignLog","setScheduleIssues","setScheduleStale","setPendingProposal"];
  const commit=new Function(...Object.keys(core),"isReadOnly","proposalIsCurrent","discardStaleProposal","employees","cfg","policyOptions","showAlert","validateSchedule",...setters,
    html.slice(start,end)+"return commitScheduleProposal;")(...Object.values(core),false,()=>isCurrent,()=>writes.push("discard"),roster,cfg,{},()=>writes.push("alert"),()=>[],...setters.map(name=>()=>writes.push(name)));
  return {commit,writes};
}

test("production commit rejects stale input before touching schedule or undo", () => {
  const {commit,writes}=productionCommit(false,[emp()]);
  assert.equal(commit(proposal(shifts())),false);
  assert.deepEqual(writes,["discard"]);
});

test("production commit cannot bypass manager approval for a preferred-OT employee", () => {
  const {commit,writes}=productionCommit(true,[emp("e",{overtimePref:"preferred"})]);
  assert.equal(commit(proposal(shifts())),false);
  assert.deepEqual(writes,["alert"]);
});

test("production commit applies every proposal component in one undo step after approval", () => {
  const {commit,writes}=productionCommit(true,[emp()]);
  const input=proposal(shifts(),{creditHourLimits:{e:48},usedPatterns:{e:{trailingDays:0}}});
  assert.equal(commit(input),true);
  assert.deepEqual(writes,["pushUndo","setWeekDraft","setEmpPatterns","setAssignLog","setScheduleIssues","setScheduleStale","setPendingProposal"]);
});

test("production cancel clears only the proposal, and undo captures handoffs and patterns", () => {
  const marker="onCancel={() => setPendingProposal(null)}";
  assert(html.includes(marker));
  let pending={ns:shifts()},live=shifts(),before=JSON.stringify(live);
  new Function("setPendingProposal","return () => setPendingProposal(null)")(p=>{pending=p;})();
  assert.equal(pending,null);assert.equal(JSON.stringify(live),before);
  const start=html.indexOf("  const snapNow = () => ("),end=html.indexOf("  const pushUndo",start);
  const snapshot=new Function("schedule","extShifts","handoffs","empPatterns","assignLog","trainingBlocks",html.slice(start,end)+"return snapNow();")(live,[],[{employeeId:"e"}],{e:{trailingDays:3}},{a:1},[{id:"training"}]);
  assert.deepEqual(snapshot.handoffs,[{employeeId:"e"}]);
  assert.deepEqual(snapshot.trainingBlocks,[{id:"training"}]);
  assert.deepEqual(snapshot.empPatterns,{e:{trailingDays:3}});
});
