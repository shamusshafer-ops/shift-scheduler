"""tools/feasibility_cpsat.py — solve an exported week (tools/export-duty-model.js)
exactly with OR-Tools CP-SAT. Offline analysis only; the app does not use it.

Hard: each hour has exactly 3 regular staff and (weekday first shift) exactly
one Supervisor; Scale and Medical every hour except listed structural gaps;
pairwise rule conflicts; No OT employees at most 40h worked; full-timers at
least 40h credited (worked + PTO); weekly duty caps.
Objective (lexicographic, solved in stages, the app's order): uncovered role
hours (--min-gap), supervisor 12-hour days, seven-day weeks, total overtime,
then the most overtime on one person.

  python3 tools/feasibility_cpsat.py model.json [--seconds 120] [--min-gap]
--min-gap: Scale/Medical coverage becomes soft and the solver minimizes
uncovered role hours instead (the least possible within the model).
"""
import json, sys
from ortools.sat.python import cp_model

args = sys.argv[1:]
m = json.load(open(args[0]))
seconds = float(args[args.index('--seconds') + 1]) if '--seconds' in args else 120.0
min_gap = '--min-gap' in args
E = {e['id']: e for e in m['employees']}
C = m['candidates']
model = cp_model.CpModel()
x = [model.NewBoolVar(f"x{c['i']}") for c in C]
for i, j in m['conflicts']:
    model.AddBoolOr([x[i].Not(), x[j].Not()])
for i, j, k in m.get('triples', []):
    model.AddBoolOr([x[i].Not(), x[j].Not(), x[k].Not()])
sup = set(m['supHours'])
waived = {}
for g in m.get('structural', []):
    for h in range(g['start'], g['end']):
        waived.setdefault(h, set()).add(g['role'])
gap_vars, gap_info = [], []
for h in m['hours']:  # this week's slot hours: Sunday 06:00 to next Sunday 06:00
    reg, supv, scale, med = [], [], [], []
    for c in C:
        for s in c['spans']:
            if s['start'] <= h < s['end']:
                if s.get('position') == 'Supervisor':
                    supv.append(x[c['i']])
                else:
                    reg.append(x[c['i']])
                    q = E[c['emp']]['quals']
                    if 'Scale' in q: scale.append(x[c['i']])
                    if 'Medical' in q: med.append(x[c['i']])
    model.Add(sum(reg) == m['regularPerHour'])
    model.Add(sum(supv) == (1 if h in sup else 0))
    for role, lst in (('Scale', scale), ('Medical', med)):
        if role in waived.get(h, set()):
            continue
        if min_gap:
            g = model.NewBoolVar(f"gap_{role}_{h}")
            gap_info.append((g, role, h))
            model.Add(sum(lst) >= 1).OnlyEnforceIf(g.Not())
            gap_vars.append(g)
        else:
            model.Add(sum(lst) >= 1)
hours, over = {}, {}
for e in m['employees']:
    mine = [c for c in C if c['emp'] == e['id']]
    hrs = sum(c['hours'] * x[c['i']] for c in mine)
    hours[e['id']] = hrs
    if e['ot'] == 'blocked':
        model.Add(hrs <= 40)
    if e['type'] == 'full-time':
        model.Add(hrs + min(e['pto'], 40) >= 40)
    if e['maxShifts'] is not None:
        model.Add(sum(x[c['i']] for c in mine) <= e['maxShifts'])
    o = model.NewIntVar(0, 200, f"ot_{e['id']}")
    model.Add(o >= hrs - 40)
    over[e['id']] = o
# Seven-day weeks: an employee with a duty starting on every day.
seven = []
for e in m['employees']:
    mine = [c for c in C if c['emp'] == e['id']]
    dayv = []
    for d in range(7):
        on = [x[c['i']] for c in mine if d in c.get('days', [c['day']])]
        v = model.NewBoolVar(f"d_{e['id']}_{d}")
        if on:
            model.AddMaxEquality(v, on)
        else:
            model.Add(v == 0)
        dayv.append(v)
    s7 = model.NewBoolVar(f"seven_{e['id']}")
    model.AddMinEquality(s7, dayv)
    seven.append(s7)
sup_ext = sum(x[c['i']] for c in C if c.get('supExt'))
total_ot = sum(over.values())
max_ot = model.NewIntVar(0, 200, 'max_ot')
for o in over.values():
    model.Add(max_ot >= o)
solver = cp_model.CpSolver()
solver.parameters.max_time_in_seconds = seconds
solver.parameters.num_workers = 2
stages = []
def stage(obj, name):
    model.Minimize(obj)
    st = solver.Solve(model)
    val = solver.Value(obj) if st in (cp_model.OPTIMAL, cp_model.FEASIBLE) else None
    stages.append({'objective': name, 'status': solver.StatusName(st), 'value': val, 'bound': solver.BestObjectiveBound() if val is not None else None})
    if st == cp_model.OPTIMAL:
        model.Add(obj == val)  # fix this level before the next (lexicographic)
    elif st == cp_model.FEASIBLE:
        model.Add(obj <= val)
    return st
status = None
if min_gap:
    status = stage(sum(gap_vars), 'uncovered role hours')
if status in (None, cp_model.OPTIMAL, cp_model.FEASIBLE):
    status = stage(sup_ext, 'supervisor 12-hour days')
if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
    status = stage(sum(seven), 'seven-day weeks')
if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
    status = stage(total_ot, 'total overtime')
if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
    status = stage(max_ot, 'max individual overtime')
name = solver.StatusName(status)
out = {'status': name, 'stages': stages, 'structuralHours': sum(g['end'] - g['start'] for g in m.get('structural', []))}
if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
    out['chosen'] = [c['i'] for c in C if solver.Value(x[c['i']])]
    out['duties'] = [C[i]['label'] for i in out['chosen']]
    out['hours'] = {E[k]['name']: solver.Value(v) for k, v in hours.items()}
    out['uncovered'] = [{'role': r, 'hour': h} for g, r, h in gap_info if solver.Value(g)]
print(json.dumps(out, indent=1))
