'use strict';
// Call-Off Replacement Finder: eligibility must match the commit-time rule
// check, roles come from real coverage, OT preferences rank correctly, and the
// saved position reflects what the replacement actually covers.
const test=require('node:test'),assert=require('node:assert/strict'),core=require('./load-core');
const {buildCallOffList,callOffNeeds,scheduleChangeIssues,cellKey}=core;
const cfg={minRestHours:8,maxConsecutiveShifts:7,maxConsecutiveNights:7};
const options={extShifts:[],handoffs:[],ptoHoursByEmployee:{},empPatterns:{}};
const emp=(id,qualifications,extra={})=>({id,name:id,qualifications,employmentType:'full-time',overtimePref:'neutral',...extra});
const a=(employeeId,position)=>({employeeId,position});
// Five second-shift duties Tue–Sat = 40h already.
const fortyHours=id=>Object.fromEntries(['Tuesday','Wednesday','Thursday','Friday','Saturday'].map(d=>[cellKey(d,'second'),[a(id,'Guard')]]));
const merge=(...ss)=>{const out={};for(const s of ss)for(const[k,v]of Object.entries(s))out[k]=[...(out[k]||[]),...v];return out;};
const row=(list,id)=>list.find(c=>c.emp.id===id);
const baseShift={Monday__second:[a('dual','Guard'),a('scale','Scale'),a('guard','Guard')]};

test('the needed role comes from coverage, not the stored label: a Medic saved as "Guard" needs a Medic replacement',()=>{
 const roster=[emp('dual',['Guard','Medical']),emp('scale',['Scale']),emp('guard',['Guard']),emp('g2',['Guard']),emp('med',['Medical'])];
 const needs=callOffNeeds('Monday','second','dual',roster,baseShift,options);
 assert.deepEqual(needs.requiredRoles,['Medical']);
 const list=buildCallOffList('Monday','second','dual',roster,baseShift,cfg,options);
 assert.equal(row(list,'g2').eligible,false,'a guard-only replacement would leave the shift without a Medic');
 assert.match(row(list,'g2').reasons.join(' '),/Medical/);
 assert.equal(row(list,'med').eligible,true);
 assert.equal(row(list,'med').position,'Medical','saved as Medical, not Guard');
});

test('a guard call-off can be replaced by a specialist, who is saved in a position they hold',()=>{
 const roster=[emp('dual',['Guard','Medical']),emp('scale',['Scale']),emp('guard',['Guard']),emp('scale2',['Scale'])];
 const list=buildCallOffList('Monday','second','guard',roster,baseShift,cfg,options);
 assert.equal(row(list,'scale2').eligible,true);
 assert.equal(row(list,'scale2').position,'Scale','a Scale-only employee is never saved as Guard');
});

test('"Prefers OT" staff rank ahead of neutral staff going into overtime',()=>{
 const roster=[emp('dual',['Guard','Medical']),emp('scale',['Scale']),emp('guard',['Guard']),
  emp('neutral',['Guard','Medical']),emp('keen',['Guard','Medical'],{overtimePref:'preferred'})];
 const schedule=merge(baseShift,fortyHours('neutral'),fortyHours('keen'));
 const list=buildCallOffList('Monday','second','dual',roster,schedule,cfg,options).filter(c=>c.eligible);
 assert.deepEqual(list.map(c=>c.emp.id),['keen','neutral']);
 assert(row(list,'keen').tier<row(list,'neutral').tier);
});

test('No-OT staff who would pass 40h are not eligible',()=>{
 const roster=[emp('dual',['Guard','Medical']),emp('scale',['Scale']),emp('guard',['Guard']),emp('noot',['Guard','Medical'],{overtimePref:'blocked'})];
 const list=buildCallOffList('Monday','second','dual',roster,merge(baseShift,fortyHours('noot')),cfg,options);
 assert.equal(row(list,'noot').eligible,false);
 assert.match(row(list,'noot').reasons.join(' '),/No OT/);
});

test('every eligible candidate passes the same rule check the Assign button commits with',()=>{
 const roster=[emp('dual',['Guard','Medical']),emp('scale',['Scale']),emp('guard',['Guard']),emp('med',['Medical']),
  emp('noot',['Guard','Medical'],{overtimePref:'blocked'}),emp('pt',['Guard','Medical'],{employmentType:'on-call',maxShiftsPerWeek:1}),
  emp('blocked',['Guard','Medical'],{blockedShifts:['second']}),emp('trainee',['Guard','Medical'],{inTraining:true})];
 const schedule=merge(baseShift,fortyHours('noot'),{Sunday__first:[a('pt','Guard')]});
 const list=buildCallOffList('Monday','second','dual',roster,schedule,cfg,options);
 for (const c of list) {
  const without=schedule.Monday__second.filter(x=>x.employeeId!=='dual');
  const after={...schedule,Monday__second:[...without,{employeeId:c.emp.id,position:c.position || 'Guard'}]};
  const blocked=scheduleChangeIssues(schedule,after,roster,cfg,options).length>0;
  if (c.eligible) assert.equal(blocked,false,c.emp.id+' is listed but the commit would reject it');
 }
 for (const id of ['noot','pt','blocked','trainee']) assert.equal(row(list,id).eligible,false,id);
 assert.equal(row(list,'med').eligible,true);
});

test('a supervisor call-off is only backfilled by supervisors, into the supervisor seat',()=>{
 const roster=[emp('sup',['Supervisor','Guard']),emp('med',['Medical']),emp('scale',['Scale']),emp('guard',['Guard']),
  emp('sup2',['Supervisor','Guard']),emp('dual',['Guard','Medical'])];
 const schedule={Monday__first:[a('sup','Supervisor'),a('med','Medical'),a('scale','Scale'),a('guard','Guard')]};
 const list=buildCallOffList('Monday','first','sup',roster,schedule,cfg,options);
 assert.equal(row(list,'sup2').eligible,true);assert.equal(row(list,'sup2').position,'Supervisor');
 assert.equal(row(list,'dual').eligible,false);
});

test('a gap that already existed does not disqualify a replacement who cannot fill it',()=>{
 const roster=[emp('scale',['Scale']),emp('guard',['Guard']),emp('g2',['Guard']),emp('med',['Medical'])];
 const schedule={Monday__second:[a('scale','Scale'),a('guard','Guard')]}; // open seat, no Medic already
 const list=buildCallOffList('Monday','second',null,roster,schedule,cfg,options);
 assert.deepEqual(list.neededRoles,['Medical']);assert.deepEqual(list.requiredRoles,[]);
 assert.equal(row(list,'g2').eligible,true);
 assert.equal(row(list,'med').position,'Medical','a Medic filling the open seat is saved as Medical');
});
