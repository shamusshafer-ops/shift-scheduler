"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {buildScheduleExportModel: build, scheduleExportDutyLabel: label, scheduleExportXml: xml,
  scheduleExportHtml: preview, SCHEDULE_EXPORT_COLORS: C, scheduleViewSnapshot, DAYS} = require('./load-core');
const emp = (id, extra = {}) => ({id,name:`Sample ${id}`,qualifications:['Guard'],employmentType:'part-time',...extra});
const asgn = (employeeId,position='Guard') => ({employeeId,position});
const input = extra => ({weekStart:'2026-09-13',employees:[emp('a'),emp('b')],schedule:{},...extra});
const model = extra => build(input(extra),'2026-09-15');
const person = (m,id='a') => m.employeeRows.find(r=>r.emp.id===id);
const text = (m,day,id='a') => person(m,id).cells[DAYS.indexOf(day)].value;

test('standard codes describe actual hours, including doubles and unusual early arrivals', () => {
  for (const [start,end,code] of [[6,14,'1'],[14,22,'2'],[22,30,'3'],[6,18,'12A'],[18,30,'12P'],
    [6,22,'1+2'],[14,30,'2+3'],[2,14,'2A–2P'],[10,22,'10A–10P'],[22,34,'10P–10A (+1d)'],[5.5,14,'5:30A–2P']]) {
    assert.equal(label({start,end}),code);
  }
});

test('both halves of day and night pairs use individual 12A / 12P labels', () => {
  for (const [pairId,a,b] of [['day','12A','12P'],['night','12P','12A']]) {
    const m=model({extShifts:[{day:'Sunday',pairId,empAId:'a',empBId:'b'}]});
    assert.equal(text(m,'Sunday','a'),a); assert.equal(text(m,'Sunday','b'),b);
    assert.equal(person(m).workedHours,12);
  }
});

test('four-hour late stay and early arrival become 12A and 12P; totals include both', () => {
  const m=model({schedule:{Monday__first:[asgn('a','Scale')],Monday__third:[asgn('b')]},handoffs:[
    {day:'Monday',sourceShiftId:'first',targetShiftId:'second',employeeId:'a',type:'late-stay',hours:4},
    {day:'Monday',sourceShiftId:'third',targetShiftId:'second',employeeId:'b',type:'early-arrival',hours:4},
  ]});
  assert.equal(text(m,'Monday'),'12A-Scale'); assert.equal(text(m,'Monday','b'),'12P');
  assert.equal(person(m).workedHours,12); assert.equal(person(m,'b').workedHours,12);
  assert.equal(m.sheets[1].rows[3].cells[1].value,24);
});

test('short handoffs preserve their true times and orphan handoffs contribute no hours', () => {
  const m=model({schedule:{Monday__first:[asgn('a')]},handoffs:[
    {day:'Monday',sourceShiftId:'first',targetShiftId:'second',employeeId:'a',type:'late-stay',hours:2},
    {day:'Tuesday',sourceShiftId:'first',targetShiftId:'second',employeeId:'a',type:'late-stay',hours:4},
  ]});
  assert.equal(text(m,'Monday'),'6A–4P'); assert.equal(text(m,'Tuesday'),'x');
  assert.equal(person(m).workedHours,10);
});

test('split pair second half displays on its actual start day and week-edge work remains visible', () => {
  const m=model({extShifts:[{day:'Monday',pairId:'split',empAId:'a',empBId:'b'}]});
  assert.equal(text(m,'Monday','b'),'x'); assert.equal(text(m,'Tuesday','b'),'2A–2P');
  const edge=model({extShifts:[{day:'Saturday',pairId:'split',empAId:'a',empBId:'b'}]});
  assert.equal(text(edge,'Saturday','b'),'Next Sun: 2A–2P'); assert.equal(person(edge,'b').workedHours,12);
});

test('handoff over midnight belongs to the following day source duty', () => {
  const m=model({schedule:{Monday__first:[asgn('a')]},handoffs:[
    {day:'Sunday',sourceShiftId:'first',targetShiftId:'third',employeeId:'a',type:'early-arrival',hours:4},
  ]});
  assert.equal(text(m,'Sunday'),'x'); assert.equal(text(m,'Monday'),'2A–2P');
  assert.equal(person(m).workedHours,12);
});

test('mirrored extended assignments and duplicate handoffs do not double-count work', () => {
  const handoff={day:'Monday',sourceShiftId:'first',targetShiftId:'second',employeeId:'b',type:'late-stay',hours:4};
  const m=model({schedule:{Sunday__first:[asgn('a')],Sunday__second:[asgn('a')],Monday__first:[asgn('b')]},
    extShifts:[{day:'Sunday',pairId:'day',empAId:'a'}],handoffs:[handoff,handoff]});
  assert.equal(text(m,'Sunday'),'12A'); assert.equal(person(m).workedHours,12);
  assert.equal(text(m,'Monday','b'),'12A'); assert.equal(person(m,'b').workedHours,12);
});

test('medical name shading follows qualifications, while regular shift cells stay neutral', () => {
  const m=model({employees:[emp('a',{qualifications:['Medical'],requiredShift:'third'}),emp('b',{requiredShift:'first'})],
    schedule:{Sunday__third:[asgn('a','Medical')],Sunday__first:[asgn('b')]}});
  assert.equal(person(m).nameFill,C.medical); assert.equal(person(m,'b').nameFill,C.body);
  assert.equal(person(m).cells[0].fill,C.body);
});

test('an extended duty retains an explicitly mirrored Scale assignment', () => {
  const m=model({schedule:{Sunday__first:[asgn('a','Scale')]},extShifts:[{day:'Sunday',pairId:'day',empAId:'a'}]});
  assert.equal(text(m,'Sunday'),'12A-Scale'); assert.equal(person(m).workedHours,12);
});

test('approved leave is green; leave conflicts never hide work and receive attention color', () => {
  const timeOffReqs=[{empId:'a',type:'single_day',status:'approved',startDate:'2026-09-14'}];
  const off=model({timeOffReqs});
  assert.equal(text(off,'Monday'),'Off'); assert.equal(person(off).cells[1].fill,C.leave);
  const conflict=model({timeOffReqs,schedule:{Monday__first:[asgn('a')]}});
  assert.equal(text(conflict,'Monday'),'1\nOff'); assert.equal(person(conflict).cells[1].fill,C.attention);
});

test('partial leave and training retain exact times without marking the whole day off', () => {
  const m=model({schedule:{Monday__second:[asgn('a')]},timeOffReqs:[
    {empId:'a',type:'partial',timeMode:'range',status:'approved',startDate:'2026-09-14',startTime:'06:30',endTime:'10:00'}],
    trainingBlocks:[{empId:'b',day:'Monday',startHour:8.5,durationHours:2}]});
  assert.equal(text(m,'Monday'),'2\nOff 6:30A–10A');
  assert.equal(text(m,'Monday','b'),'TRN 8:30A–10:30A');
  assert.equal(person(m).workedHours,8); assert.equal(person(m,'b').workedHours,0);
});

test('worked hours, PTO credits, overtime total and full-time status remain distinct', () => {
  const schedule=Object.fromEntries(DAYS.slice(0,6).map(d=>[`${d}__first`,[asgn('a'),...(d!=='Sunday'&&d!=='Friday'?[asgn('b')]:[])]]));
  const m=model({employees:[emp('a'),emp('b',{employmentType:'full-time'})],schedule,
    timeOffReqs:[{empId:'b',type:'vacation',status:'approved',startDate:'2026-09-13',ptoHoursByDate:{'2026-09-13':8}}]});
  assert.equal(person(m).workedHours,48); assert.equal(m.totalOvertime,8);
  assert.equal(person(m).cells[4].fill,C.body); assert.equal(person(m).cells[5].fill,C.overtime);
  assert.equal(person(m,'b').workedHours,32); assert.equal(person(m,'b').creditedHours,40);
  assert.equal(person(m,'b').status,'Scheduled');
});

test('historical snapshot uses its saved roster, week, handoffs and leave rather than live state', () => {
  const saved=input({employees:[emp('old')],schedule:{Monday__first:[asgn('old')]},handoffs:[
    {day:'Monday',sourceShiftId:'first',targetShiftId:'second',employeeId:'old',type:'late-stay',hours:4}]});
  const m=build(scheduleViewSnapshot(input({weekStart:'2026-09-20'}),saved),'2026-09-15');
  assert.equal(m.weekStart,'2026-09-13'); assert.equal(m.employeeRows.length,1);
  assert.equal(text(m,'Monday','old'),'12A'); assert.equal(person(m,'old').workedHours,12);
});

test('preview and Excel share labels, safe text, styles, and landscape printing', () => {
  const m=model({employees:[emp('a',{name:'=1+1 <script>&"'})],extShifts:[{day:'Sunday',pairId:'day',empAId:'a'}]});
  const html=preview(m), workbook=xml(m);
  for (const output of [html,workbook]) {
    assert(output.includes('12A')); assert(output.includes('Medical')); assert(output.includes('Requested Off'));
    assert(output.includes('DRAFT')); assert(!output.includes('<script>'));
    assert(output.includes('&lt;script&gt;&amp;&quot;'));
  }
  assert(workbook.includes('<Data ss:Type="Number">12</Data>'));
  assert(workbook.includes('<Data ss:Type="String">=1+1'));
  assert(workbook.includes('x:Orientation="Landscape"'));
  assert(workbook.includes('<FitWidth>1</FitWidth>')); assert(workbook.includes('<FitHeight>0</FitHeight>'));
  assert(workbook.includes('2026')); assert(!workbook.includes('2024'));
});

test('save callback receives the preview model and filenames use its week', async () => {
  const source=fs.readFileSync(__dirname+'/ShiftScheduler_latest loop.html','utf8');
  const start=source.indexOf('async function exportToExcel('),end=source.indexOf('// ── Weekending Payroll Export',start);
  let contents, options;
  const window={showSaveFilePicker:async opts=>{options=opts;return {createWritable:async()=>({write:async blob=>{contents=await blob.text();},close:async()=>{}})};}};
  const save=new Function('scheduleExportXml','window','Blob',source.slice(start,end)+';return exportToExcel;')(xml,window,Blob);
  const m=model({schedule:{Monday__first:[asgn('a')]}});
  assert.equal(await save(m),true); assert.equal(options.suggestedName,'ShiftSchedule_2026-09-13.xls');
  assert.equal(contents,xml(m));
  window.showSaveFilePicker=async()=>{throw Object.assign(new Error('cancel'),{name:'AbortError'});};
  assert.equal(await save(m),false);
  window.showSaveFilePicker=async()=>{throw new Error('disk full');};
  await assert.rejects(save(m),/disk full/);
});

test('invalid week is rejected rather than quietly exporting an invented date', () => {
  assert.throws(()=>model({weekStart:''}),/valid schedule week/);
});
