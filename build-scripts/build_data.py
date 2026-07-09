import json, re

data = json.load(open('teachers_raw.json'))
teachers_raw = data['teachers']
meta = data['meta']

DAY_TYPE = {
    'Monday':'MonThu','Tuesday':'MonThu','Wednesday':'MonThu','Thursday':'MonThu','Friday':'Fri'
}
ALL_DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday']

def band_of(cls):
    if cls.startswith('6'): return 'G6'
    if cls.startswith('7'): return 'G7'
    return 'G8-10'

def template_key(band, daytype):
    if daytype == 'Fri':
        return 'G8-10_Fri' if band == 'G8-10' else 'G67_Fri'
    else:
        return f'{band}_MonThu'

# period templates: slot index 1..8 (some Friday only use 1..7)
PERIOD_TEMPLATES = {
 'G8-10_MonThu': [
    {'n':1,'type':'period','time':'1:15-2:00'},
    {'n':2,'type':'period','time':'2:00-2:40'},
    {'n':3,'type':'period','time':'2:40-3:20'},
    {'n':4,'type':'period','time':'3:20-4:00'},
    {'n':5,'type':'period','time':'4:00-4:40'},
    {'n':6,'type':'break','time':'4:40-5:00'},
    {'n':7,'type':'period','time':'5:00-5:30'},
    {'n':8,'type':'period','time':'5:30-6:00'},
 ],
 'G7_MonThu': [
    {'n':1,'type':'period','time':'1:15-2:00'},
    {'n':2,'type':'period','time':'2:00-2:40'},
    {'n':3,'type':'period','time':'2:40-3:20'},
    {'n':4,'type':'period','time':'3:20-4:00'},
    {'n':5,'type':'break','time':'4:00-4:15'},
    {'n':6,'type':'period','time':'4:15-5:00'},
    {'n':7,'type':'period','time':'5:00-5:30'},
    {'n':8,'type':'period','time':'5:30-6:00'},
 ],
 'G6_MonThu': [
    {'n':1,'type':'period','time':'1:15-2:00'},
    {'n':2,'type':'period','time':'2:00-2:40'},
    {'n':3,'type':'period','time':'2:40-3:20'},
    {'n':4,'type':'period','time':'3:20-4:00'},
    {'n':5,'type':'break','time':'4:00-4:15'},
    {'n':6,'type':'period','time':'4:20-5:05'},
    {'n':7,'type':'period','time':'5:05-5:55'},
    {'n':8,'type':'na','time':None},
 ],
 'G8-10_Fri': [
    {'n':1,'type':'period','time':'2:15-3:05'},
    {'n':2,'type':'period','time':'3:05-3:40'},
    {'n':3,'type':'period','time':'3:40-4:10'},
    {'n':4,'type':'period','time':'4:10-4:40'},
    {'n':5,'type':'break','time':'4:40-4:55'},
    {'n':6,'type':'period','time':'5:00-5:30'},
    {'n':7,'type':'period','time':'5:30-6:00'},
    {'n':8,'type':'na','time':None},
 ],
 'G67_Fri': [
    {'n':1,'type':'period','time':'2:15-3:05'},
    {'n':2,'type':'period','time':'3:05-3:40'},
    {'n':3,'type':'period','time':'3:40-4:10'},
    {'n':4,'type':'break','time':'4:10-4:25'},
    {'n':5,'type':'period','time':'4:25-5:00'},
    {'n':6,'type':'period','time':'5:00-5:30'},
    {'n':7,'type':'period','time':'5:30-6:00'},
    {'n':8,'type':'na','time':None},
 ],
}
# raw column slot -> template period entry mapping differs: for G8-10_MonThu, break is raw col6 (slot6)
# but for G7/G6 MonThu break is raw col6 too (slot 5 in our template numbering above is wrong) -- fix below.

# Rebuild carefully aligned to RAW COLUMN INDEX (1-8) = slot, so template n == raw slot number always.
PERIOD_TEMPLATES = {
 'G8-10_MonThu': [
    {'slot':1,'type':'period','time':'1:15-2:00'},
    {'slot':2,'type':'period','time':'2:00-2:40'},
    {'slot':3,'type':'period','time':'2:40-3:20'},
    {'slot':4,'type':'period','time':'3:20-4:00'},
    {'slot':5,'type':'period','time':'4:00-4:40'},
    {'slot':6,'type':'break','time':'4:40-5:00'},
    {'slot':7,'type':'period','time':'5:00-5:30'},
    {'slot':8,'type':'period','time':'5:30-6:00'},
 ],
 'G7_MonThu': [
    {'slot':1,'type':'period','time':'1:15-2:00'},
    {'slot':2,'type':'period','time':'2:00-2:40'},
    {'slot':3,'type':'period','time':'2:40-3:20'},
    {'slot':4,'type':'period','time':'3:20-4:00'},
    {'slot':5,'type':'break','time':'4:00-4:15'},
    {'slot':6,'type':'period','time':'4:15-5:00'},
    {'slot':7,'type':'period','time':'5:00-5:30'},
    {'slot':8,'type':'period','time':'5:30-6:00'},
 ],
 'G6_MonThu': [
    {'slot':1,'type':'period','time':'1:15-2:00'},
    {'slot':2,'type':'period','time':'2:00-2:40'},
    {'slot':3,'type':'period','time':'2:40-3:20'},
    {'slot':4,'type':'period','time':'3:20-4:00'},
    {'slot':5,'type':'break','time':'4:00-4:15'},
    {'slot':6,'type':'period','time':'4:20-5:05'},
    {'slot':7,'type':'period','time':'5:05-5:55'},
    {'slot':8,'type':'period','time':'5:05-5:55'},
 ],
 'G8-10_Fri': [
    {'slot':1,'type':'period','time':'2:15-3:05'},
    {'slot':2,'type':'period','time':'3:05-3:40'},
    {'slot':3,'type':'period','time':'3:40-4:10'},
    {'slot':4,'type':'period','time':'4:10-4:40'},
    {'slot':5,'type':'break','time':'4:40-4:55'},
    {'slot':6,'type':'period','time':'5:00-5:30'},
    {'slot':7,'type':'period','time':'5:30-6:00'},
    {'slot':8,'type':'na','time':None},
 ],
 'G67_Fri': [
    {'slot':1,'type':'period','time':'2:15-3:05'},
    {'slot':2,'type':'period','time':'3:05-3:40'},
    {'slot':3,'type':'period','time':'3:40-4:10'},
    {'slot':4,'type':'break','time':'4:10-4:25'},
    {'slot':5,'type':'period','time':'4:25-5:00'},
    {'slot':6,'type':'period','time':'5:00-5:30'},
    {'slot':7,'type':'period','time':'5:30-6:00'},
    {'slot':8,'type':'na','time':None},
 ],
}

def normalize_token(tok):
    """Return (base_class, group, note) from a raw cell token."""
    t = tok.strip()
    note = None
    group = None
    # parenthetical note e.g. (AH), (Sal), (L)
    m = re.search(r'\(([^)]+)\)', t)
    if m:
        note = m.group(1).strip()
        t = re.sub(r'\([^)]+\)', '', t).strip()
    # lib suffix
    m2 = re.search(r'\s+lib\s*$', t, flags=re.IGNORECASE)
    if m2:
        note = 'Library'
        t = t[:m2.start()].strip()
    # group suffix U / I (with or without space), only for patterns ending in U or I directly after class code
    m3 = re.match(r'^(\d{1,2}E[A-E])\s*(U|I)$', t)
    if m3:
        t = m3.group(1)
        group = m3.group(2)
    t = re.sub(r'\s+', '', t)
    return t, group, note

# Build teacher schedule structure + default units
TEACHER_SCHEDULE = {}
TEACHER_META = {}
for name, days in teachers_raw.items():
    sched = {}
    unit_count = 0
    for day in ALL_DAYS:
        slots = days.get(day, ['']*8)
        row = []
        for s in slots:
            if not s:
                row.append(None)
            elif s.strip() == 'REM':
                row.append({'type':'rem'})
                # REM does not count toward teaching load
            else:
                cls, group, note = normalize_token(s)
                row.append({'type':'class','class':cls,'group':group,'note':note})
                unit_count += 1
        sched[day] = row
    TEACHER_SCHEDULE[name] = sched
    TEACHER_META[name] = {'sheet': meta[name], 'defaultUnits': unit_count}

# Build class schedule (inverted)
CLASS_SCHEDULE = {}
for name, sched in TEACHER_SCHEDULE.items():
    for day, row in sched.items():
        for idx, cell in enumerate(row):
            slot = idx + 1
            if cell and cell['type'] == 'class':
                cls = cell['class']
                CLASS_SCHEDULE.setdefault(cls, {})
                CLASS_SCHEDULE[cls].setdefault(day, [])
                CLASS_SCHEDULE[cls][day].append({
                    'slot': slot,
                    'teacher': name,
                    'group': cell.get('group'),
                    'note': cell.get('note'),
                })

for cls in CLASS_SCHEDULE:
    for day in CLASS_SCHEDULE[cls]:
        CLASS_SCHEDULE[cls][day].sort(key=lambda e: e['slot'])

CLASSES = sorted(CLASS_SCHEDULE.keys(), key=lambda c: (int(re.match(r'\d+', c).group()), c))

output = {
    'PERIOD_TEMPLATES': PERIOD_TEMPLATES,
    'TEACHER_SCHEDULE': TEACHER_SCHEDULE,
    'TEACHER_META': TEACHER_META,
    'CLASS_SCHEDULE': CLASS_SCHEDULE,
    'CLASSES': CLASSES,
    'DAY_TYPE': DAY_TYPE,
}

with open('school_data.json','w') as f:
    json.dump(output, f, indent=1)

print("Classes:", CLASSES)
print("Num teachers:", len(TEACHER_SCHEDULE))
print("\nSample default units:")
for t in sorted(TEACHER_META, key=lambda x: -TEACHER_META[x]['defaultUnits'])[:5]:
    print(t, TEACHER_META[t])
for t in sorted(TEACHER_META, key=lambda x: TEACHER_META[x]['defaultUnits'])[:5]:
    print(t, TEACHER_META[t])
