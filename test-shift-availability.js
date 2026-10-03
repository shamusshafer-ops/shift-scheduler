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

// Phase 2: candidate filters inside autofill screen "no" cells themselves, so
// the final policy filter never has to discard their picks (which left gaps).
test('autofill plans around "no" cells instead of having assignments rejected',()=>{
  const fx = require('./fixtures/autofill-real-roster-drafts.json');
  const grid = {'psi-2':{Monday:{first:'no'},Tuesday:{first:'no'}}};
  const emps = JSON.parse(JSON.stringify(fx.roster)).map(e=>grid[e.id]?{...e,shiftAvailability:grid[e.id]}:e);
  const timeOff = availability([],week);
  const log = console.log, warn = console.warn; console.log = console.warn = () => {};
  let result; try { result = buildAutoFill(emps,{...fx.cfg,maxSearchNodes:3000},timeOff,fx.enrichedPatterns,[],false,{roster:emps}); }
  finally { console.log = log; console.warn = warn; }
  assert.deepEqual((result.policyRejected || []).map(r=>r.employeeId+' '+r.day+' '+r.shiftId),[]);
  for (const day of ['Monday','Tuesday']) assert(!(result.schedule[cellKey(day,'first')] || []).some(a=>a.employeeId==='psi-2'));
});
test('the overtime lower bound counts "no" cells as unavailable',()=>{
  const roster = [emp({id:'a',employmentType:'full-time',requiredShift:'first'})];
  const all = Object.fromEntries(DAYS.map(d=>[d,{first:'no'}]));
  const open = core.overtimeLowerBound(roster,{empTimeOffDays:availability([],week)});
  const closedStanding = core.overtimeLowerBound([{...roster[0],shiftAvailability:all}],{empTimeOffDays:availability([],week)});
  const closedWeek = core.overtimeLowerBound(roster,{empTimeOffDays:availability([],week,{a:all})});
  assert(closedStanding > open); assert.equal(closedWeek,closedStanding);
});

// Phase 3: "prefer" cells drive shift preference day by day.
const {dayPreferredShifts,weekPreferredShifts,preferenceBurden} = core;
test('day preference: grid "prefer" cells win for their day, other days use the weekly list',()=>{
  const weekly = emp({preferredShifts:['third']});
  assert.equal(dayPreferredShifts(weekly,'Monday',null),weekly.preferredShifts,'no grid returns the weekly list itself');
  const e = emp({preferredShifts:['third'],shiftAvailability:{Monday:{first:'prefer',second:'prefer'},Tuesday:{third:'no'}}});
  assert.deepEqual(dayPreferredShifts(e,'Monday',null),['first','second']);
  assert.deepEqual(dayPreferredShifts(e,'Tuesday',null),['third'],'a day with only "no" cells keeps the weekly list');
  assert.deepEqual(dayPreferredShifts(e,'Friday',null),['third']);
  assert.deepEqual(dayPreferredShifts(emp(),'Friday',availability([],week,{e:{Friday:{second:'prefer'}}})),['second']);
  assert.deepEqual(dayPreferredShifts(e,'Monday',availability([],week,{e:{Monday:{first:'ok',second:'ok'}}})),[],
    'a day set to "ok" on purpose prefers nothing, rather than falling back to the weekly list');
  assert.deepEqual(dayPreferredShifts(emp({preferredShifts:['third'],shiftAvailability:{Monday:{third:'ok'}}}),'Monday',null),[]);
});
test('week preference: each day votes, the most-preferred shift wins',()=>{
  const weekly = emp({preferredShifts:['third','first']});
  assert.equal(weekPreferredShifts(weekly,null),weekly.preferredShifts,'no grid returns the weekly list itself');
  const allSecond = Object.fromEntries(DAYS.map(d=>[d,{second:'prefer'}]));
  assert.deepEqual(weekPreferredShifts(emp({preferredShifts:['third'],shiftAvailability:allSecond}),null),['second']);
  const saturdayOnly = emp({preferredShifts:['first'],shiftAvailability:{Saturday:{second:'prefer'}}});
  assert.deepEqual(weekPreferredShifts(saturdayOnly,null),['first'],'six weekly-preference days outvote one grid day');
  assert.deepEqual(weekPreferredShifts(emp({shiftAvailability:{Monday:{first:'no'}}}),null),[]);
});
test('preference burden counts off-preference hours day by day',()=>{
  const e = emp({preferredShifts:['third'],shiftAvailability:{Monday:{first:'prefer'}}});
  assert.equal(preferenceBurden(e,schedule('Monday','first')).penaltyHours,0);
  assert.equal(preferenceBurden(e,schedule('Tuesday','first')).penaltyHours,8);
  assert.equal(preferenceBurden(emp({preferredShifts:['third']}),schedule('Monday','first')).penaltyHours,8);
  assert.equal(preferenceBurden(emp(),schedule('Wednesday','first'),[],[],availability([],week,{e:{Wednesday:{second:'prefer'}}})).penaltyHours,8);
});
test('preference warnings name the day\'s preferred shift',()=>{
  const e = emp({preferredShifts:['third'],shiftAvailability:{Monday:{first:'prefer'}}});
  assert.equal(core.getPreferenceViolations(e,'Monday','first',{}).some(v=>v.type==='wrong_shift'),false);
  const v = core.getPreferenceViolations(e,'Monday','second',{}).find(v=>v.type==='wrong_shift');
  assert(v && /prefers 1st|prefers first|prefers 06/i.test(v.msg),v && v.msg);
});
test('autofill follows a grid preference that differs from the weekly one',()=>{
  const fx = require('./fixtures/autofill-real-roster-drafts.json');
  const allSecond = Object.fromEntries(DAYS.map(d=>[d,{second:'prefer'}]));
  const emps = JSON.parse(JSON.stringify(fx.roster)).map(e=>e.id==='psi-9'?{...e,shiftAvailability:allSecond}:e);
  assert.deepEqual(emps.find(e=>e.id==='psi-9').preferredShifts,['third']);
  const log = console.log, warn = console.warn; console.log = console.warn = () => {};
  let result; try { result = buildAutoFill(emps,{...fx.cfg,maxSearchNodes:3000},availability([],week),fx.enrichedPatterns,[],false,{roster:emps}); }
  finally { console.log = log; console.warn = warn; }
  const shifts = Object.entries(result.schedule).filter(([,a])=>a.some(x=>x.employeeId==='psi-9')).map(([k])=>k.split('__')[1]);
  assert(shifts.length > 0);
  assert(shifts.every(s=>s==='second'),shifts.join(','));
});

// Phase 4: editing helpers behind the grid screens.
const {withoutWeekAvailability,ruleBlockedShiftReason,shiftAvailabilityCounts} = core;
test('summary counts only prefer and no cells',()=>{
  assert.deepEqual(shiftAvailabilityCounts({Monday:{first:'prefer',second:'no',third:'ok'},Friday:{third:'no'}}),{prefer:1,no:2});
  assert.deepEqual(shiftAvailabilityCounts({Monday:{first:'bogus'}}),{prefer:0,no:0});
});
test('cells already ruled out by other settings are locked with a reason',()=>{
  assert.equal(ruleBlockedShiftReason(emp(),'Monday','first'),null);
  assert.match(ruleBlockedShiftReason(emp({unavailableDays:['Monday']}),'Monday','first'),/Unavailable/);
  assert.match(ruleBlockedShiftReason(emp({availableDaysOfWeek:['Tuesday']}),'Monday','first'),/available days/);
  assert.match(ruleBlockedShiftReason(emp({blockedShifts:['third']}),'Monday','third'),/blocked/);
  assert.equal(ruleBlockedShiftReason(emp({requiredShift:'second'}),'Monday','first'),null,'required shift no longer locks: Prefer may grant it');
  assert.match(core.requiredShiftExceptionHint(emp({requiredShift:'second'}),'Monday','first'),/Outside required 2nd/);
  assert.equal(core.requiredShiftExceptionHint(emp({requiredShift:'second'}),'Monday','second'),null);
  assert.equal(core.requiredShiftExceptionHint(emp({requiredShift:'second',canWorkOtherShifts:true}),'Monday','first'),null);
  assert.equal(ruleBlockedShiftReason(emp({requiredShift:'second',canWorkOtherShifts:true}),'Monday','first'),null);
  assert.equal(ruleBlockedShiftReason(emp({requiredShift:'second',crossShiftOT:true}),'Monday','first'),null);
  assert.match(ruleBlockedShiftReason(emp({qualifications:['Supervisor','Guard']}),'Saturday','first'),/Supervisor/);
  assert.equal(ruleBlockedShiftReason(emp({qualifications:['Supervisor','Guard']}),'Monday','first'),null);
});

// Phase 5: storage, backups and housekeeping.
const {weekAvailabilityStoreErrors,pruneWeekAvailability} = core;
test('a stored week-override map is validated as a whole',()=>{
  assert.deepEqual(weekAvailabilityStoreErrors(undefined),[]);
  assert.deepEqual(weekAvailabilityStoreErrors({[week]:{e:{Monday:{first:'no'}}}}),[]);
  for (const bad of [[],'x',{[week]:[]},{[week]:{e:{Monday:{first:'maybe'}}}}]) assert(weekAvailabilityStoreErrors(bad).length,JSON.stringify(bad));
});
test('pruning drops only weeks older than the window and keeps the same object when nothing is old',()=>{
  const store = {'2026-01-04':{e:{}},'2026-03-15':{e:{}},[week]:{e:{}},'2026-12-27':{e:{}},odd:{e:{}}};
  const pruned = pruneWeekAvailability(store,week);
  assert.deepEqual(Object.keys(pruned).sort(),['2026-03-15','2026-09-06','2026-12-27','odd'].sort());
  assert.equal(pruneWeekAvailability(pruned,week),pruned);
  assert.equal(pruneWeekAvailability(store,'not-a-date'),store);
  assert.equal(pruneWeekAvailability('corrupt',week),'corrupt');
});
test('full backups include week overrides and restore validates them',()=>{
  const html = require('fs').readFileSync(__dirname+'/ShiftScheduler_latest loop.html','utf8');
  const keys = html.slice(html.indexOf('const ALL_BACKUP_KEYS'),html.indexOf('];',html.indexOf('const ALL_BACKUP_KEYS')));
  assert(keys.includes('"shift_week_availability"'));
  assert(/key:"shift_week_availability", val: snapshot\.shift_week_availability/.test(html));
  assert(html.includes('weekAvailabilityStoreErrors(snapshot.shift_week_availability)'));
});

// Follow-up: "prefer" on another shift lets full-timers work it that day.
const {canWorkShiftOnDay,onPlanShift} = core;
test('a prefer cell is a one-day exception to a required shift; other cells stay bound',()=>{
  const e = emp({employmentType:'full-time',requiredShift:'first',shiftAvailability:{Tuesday:{second:'prefer'}}});
  assert.equal(canWorkShiftOnDay(e,'Tuesday','second',null),true);
  assert.equal(canWorkShiftOnDay(e,'Wednesday','second',null),false);
  assert.equal(canWorkShiftOnDay(e,'Tuesday','first',null),true);
  const kinds = (day,sid,timeOff) => employeePolicyIssues(e,schedule(day,sid),{}, {empTimeOffDays:timeOff || availability([],week)}).map(i=>i.type);
  assert(!kinds('Tuesday','second').includes('required_shift'));
  assert(kinds('Wednesday','second').includes('required_shift'));
  assert(!kinds('Wednesday','second',availability([],week,{e:{Wednesday:{second:'prefer'}}})).includes('required_shift'),'a week override can grant too');
  assert(kinds('Tuesday','second',availability([],week,{e:{Tuesday:{second:'ok'}}})).includes('required_shift'),'and a week override can take it back');
});
test('a prefer cell counts as part of the weekly plan that day',()=>{
  const e = emp({shiftAvailability:{Monday:{first:'prefer'}}}), plan = {shiftId:'third'};
  assert.equal(onPlanShift(plan,e,'Monday','first',null),true);
  assert.equal(onPlanShift(plan,e,'Monday','third',null),true);
  assert.equal(onPlanShift(plan,e,'Tuesday','first',null),false);
});
test('autofill moves a required-shift full-timer to a preferred other shift without breaking rules',()=>{
  const fx = require('./fixtures/autofill-real-roster-drafts.json');
  const grid = {Tuesday:{second:'prefer'},Wednesday:{second:'prefer'}};
  const emps = JSON.parse(JSON.stringify(fx.roster)).map(e=>e.id==='psi-4'?{...e,shiftAvailability:grid}:e);
  assert.equal(emps.find(e=>e.id==='psi-4').requiredShift,'first');
  const timeOff = availability([],week);
  const log = console.log, warn = console.warn; console.log = console.warn = () => {};
  let result; try { result = buildAutoFill(emps,{...fx.cfg,maxSearchNodes:3000},timeOff,fx.enrichedPatterns,[],false,{roster:emps}); }
  finally { console.log = log; console.warn = warn; }
  const onSecond = ['Tuesday','Wednesday'].filter(d=>(result.schedule[cellKey(d,'second')]||[]).some(a=>a.employeeId==='psi-4'));
  assert(onSecond.length > 0,'works at least one preferred 2nd shift');
  const other = Object.entries(result.schedule).filter(([k,a])=>a.some(x=>x.employeeId==='psi-4') && !k.endsWith('__first')).map(([k])=>k);
  assert(other.every(k=>['Tuesday__second','Wednesday__second'].includes(k)),other.join(','));
  assert.equal(core.validateAssignmentPolicy(result.schedule,emps,fx.cfg,{empTimeOffDays:timeOff,empPatterns:fx.enrichedPatterns}).filter(i=>i.type==='required_shift').length,0);
});

// One editor grid: compose the effective grid from the stored fields and split
// edits back into those same fields.
const {composeAvailabilityGrid,decomposeAvailabilityGrid,effectiveShiftState,withWeekAvailabilityDay} = core;
test('splitting any grid back into fields reproduces it exactly',()=>{
  let seed=11;const r=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const states=['ok','prefer','no'];
  for (let t=0;t<1500;t++) {
    const g=Object.fromEntries(DAYS.map(d=>[d,Object.fromEntries(SHIFTS.map(x=>[x.id,states[Math.floor(r()*(r()<.5?2:3))]]))]));
    if (r()<.3) { const d=DAYS[Math.floor(r()*7)]; SHIFTS.forEach(x=>g[d][x.id]='no'); }
    if (r()<.3) { const x=SHIFTS[Math.floor(r()*3)].id; DAYS.forEach(d=>g[d][x]=r()<.5?'no':'prefer'); }
    const orig={requiredShift:r()<.3?SHIFTS[Math.floor(r()*3)].id:null,availableDaysOfWeek:r()<.3?DAYS.filter(()=>r()<.6):null,
      unavailableDays:r()<.3?DAYS.filter(()=>r()<.3):[]};
    const f=decomposeAvailabilityGrid(g,orig);
    assert.deepEqual(shiftAvailabilityErrors(f.shiftAvailability),[]);
    assert.deepEqual(composeAvailabilityGrid({...f,requiredShift:orig.requiredShift}),g,'trial '+t);
  }
});
test('opening and re-saving every real employee changes no stored field',()=>{
  const fx=require('./fixtures/autofill-real-roster-drafts.json');
  const backup=require('./roster-backup-current.json').data.shift_employees;
  const norm=v=>JSON.stringify(v==null||(Array.isArray(v)&&!v.length)?null:v);
  for (const e of [...fx.roster,...backup]) {
    const f=decomposeAvailabilityGrid(composeAvailabilityGrid(e),e);
    for (const k of ['unavailableDays','availableDaysOfWeek','blockedShifts','preferredShifts','shiftAvailability'])
      assert.equal(norm(f[k]),norm(e[k]),e.name+' '+k);
  }
});
test('whole days and rows map to the classic fields; exceptions stay per-day',()=>{
  const g=composeAvailabilityGrid(emp());
  SHIFTS.forEach(x=>g.Monday[x.id]='no');
  DAYS.forEach(d=>{ if (d!=='Monday') { g[d].third='no'; g[d].first='prefer'; } });
  g.Saturday.first='ok'; g.Saturday.second='prefer';
  const f=decomposeAvailabilityGrid(g,{});
  assert.deepEqual(f.unavailableDays,['Monday']);
  assert.deepEqual(f.blockedShifts,['third']);
  assert.deepEqual(f.preferredShifts,['first']);
  assert.deepEqual(f.shiftAvailability,{Saturday:{second:'prefer'}});
  assert.equal(f.availableDaysOfWeek,null);
  const ray={unavailableDays:['Sunday','Monday'],availableDaysOfWeek:['Tuesday','Wednesday','Thursday','Friday','Saturday']};
  const kept=decomposeAvailabilityGrid(composeAvailabilityGrid({...ray,availableDaysOfWeek:['Tuesday','Wednesday']}),{...ray,availableDaysOfWeek:['Tuesday','Wednesday']});
  assert.deepEqual(kept.availableDaysOfWeek,['Tuesday','Wednesday'],'days keep the field they came from');
  assert.deepEqual(kept.unavailableDays,['Sunday','Monday']);
  const req=decomposeAvailabilityGrid(Object.fromEntries(DAYS.map(d=>[d,{first:'no',second:'ok',third:'ok'}])),{requiredShift:'first'});
  assert(!req.blockedShifts.includes('first'),'a required shift is never stored as blocked');
});
test('a day with no preference beside a weekly preference is stored as explicit ok',()=>{
  const g=composeAvailabilityGrid(emp({preferredShifts:['third']}));
  g.Tuesday.third='ok';
  const f=decomposeAvailabilityGrid(g,{preferredShifts:['third']});
  assert.deepEqual(f.preferredShifts,['third']);
  assert.deepEqual(f.shiftAvailability,{Tuesday:{third:'ok'}});
  assert.equal(effectiveShiftState({...emp(),...f},'Tuesday','third',null),'ok');
  assert.equal(effectiveShiftState({...emp(),...f},'Wednesday','third',null),'prefer');
});
test('week changes are saved a whole day at a time and vanish when they match the standing pattern',()=>{
  const e=emp({preferredShifts:['third'],blockedShifts:['first']});
  let store=withWeekAvailabilityDay({},week,e,'Monday',{first:'no',second:'prefer',third:'prefer'},['first']);
  assert.deepEqual(store,{[week]:{e:{Monday:{second:'prefer',third:'prefer'}}}});
  const t=availability([],week,store[week]);
  assert.equal(effectiveShiftState(e,'Monday','second',t),'prefer');
  assert.equal(effectiveShiftState(e,'Monday','third',t),'prefer','the weekly preference stays visible after the change');
  assert.equal(effectiveShiftState(e,'Monday','first',t),'no','locked cells keep their rule');
  store=withWeekAvailabilityDay(store,week,e,'Monday',{first:'no',second:'ok',third:'prefer'},['first']);
  assert.deepEqual(store,{},'back to the standing pattern: nothing stored');
  store=withWeekAvailabilityDay({other:1},week,e,'Tuesday',{second:'ok',third:'ok'},['first']);
  assert.equal(effectiveShiftState(e,'Tuesday','third',availability([],week,store[week])),'ok','a week can drop the weekly preference for a day');
  assert.deepEqual(withoutWeekAvailability(store,week,'e'),{other:1});
});
