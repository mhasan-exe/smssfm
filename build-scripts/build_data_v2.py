import openpyxl, json, re, collections, sys

XLSX_PATH = sys.argv[1] if len(sys.argv) > 1 else 'Working_Timetables_2026_-_27_-_Copy.xlsx'
wb = openpyxl.load_workbook(XLSX_PATH, data_only=True)

# ---------- 1. load parsed teacher schedule (from Teachers Timetable master sheet) ----------
raw = json.load(open('teachers_raw_v2.json'))
teachers_raw = raw['teachers']

ALL_DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday']

def normalize_token(tok):
    t = tok.strip()
    note = None
    group = None
    m = re.search(r'\(([^)]+)\)', t)
    if m:
        note = m.group(1).strip()
        t = re.sub(r'\([^)]+\)', '', t).strip()
    m2 = re.search(r'\s+lib\s*$', t, flags=re.IGNORECASE)
    if m2:
        note = 'Library'
        t = t[:m2.start()].strip()
    m3 = re.match(r'^(\d{1,2}E[A-E])\s*(U|I)$', t)
    if m3:
        t = m3.group(1)
        group = m3.group(2)
    t = re.sub(r'\s+', '', t)
    return t, group, note

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
    {'slot':8,'type':'na','time':None},   # confirmed spreadsheet artifact — duplicate column, not a real period
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

def band_of(cls):
    if cls.startswith('6'): return 'G6'
    if cls.startswith('7'): return 'G7'
    return 'G8-10'

DAY_TYPE = {'Monday':'MonThu','Tuesday':'MonThu','Wednesday':'MonThu','Thursday':'MonThu','Friday':'Fri'}

def template_key(band, daytype):
    if daytype == 'Fri':
        return 'G8-10_Fri' if band == 'G8-10' else 'G67_Fri'
    return f'{band}_MonThu'

# ---------- 2. build TEACHER_SCHEDULE, dropping the confirmed grade-6 duplicate-column artifact ----------
TEACHER_SCHEDULE = {}
raw_unit_count = {}
dropped_dupes = []

for name, days in teachers_raw.items():
    sched = {}
    unit_count = 0
    for day in ALL_DAYS:
        slots = days.get(day, ['']*8)
        row = []
        for idx, s in enumerate(slots):
            slot_num = idx + 1
            if not s:
                row.append(None)
                continue
            if s.strip() == 'REM':
                row.append({'type':'rem'})
                continue
            cls, group, note = normalize_token(s)
            # Grade-6 Mon-Thu slot 8 is a confirmed spreadsheet artifact (duplicate of slot 7,
            # same time value in the source header). Never count it as a real period.
            if band_of(cls) == 'G6' and DAY_TYPE[day] == 'MonThu' and slot_num == 8:
                dropped_dupes.append((name, day, s))
                row.append(None)
                continue
            row.append({'type':'class','class':cls,'group':group,'note':note})
            unit_count += 1
        sched[day] = row
    TEACHER_SCHEDULE[name] = sched
    raw_unit_count[name] = unit_count

print("Dropped grade-6 duplicate-column entries:", len(dropped_dupes))
for d in dropped_dupes: print('  ', d)

# ---------- 3. cross-check against Allotment sheet's official WORK LOAD ----------
ws = wb['Allotment']
merged = list(ws.merged_cells.ranges)
def get_val(r,c):
    for mr in merged:
        if mr.min_row <= r <= mr.max_row and mr.min_col <= c <= mr.max_col:
            return ws.cell(row=mr.min_row, column=mr.min_col).value
    return ws.cell(row=r, column=c).value

allotment_workload = {}
for r in range(1, ws.max_row+1):
    name = get_val(r,2)
    wl = get_val(r,4)
    if name and wl and str(wl).strip().isdigit():
        nm = str(name).strip()
        if nm not in allotment_workload:
            allotment_workload[nm] = int(wl)

def norm_name(n):
    n = re.sub(r'\(.*?\)', '', n)
    n = re.sub(r'[-/].*', '', n)
    n = n.strip().lower()
    n = re.sub(r'\s+', ' ', n)
    return n

matches = {}
for tname in TEACHER_SCHEDULE:
    short = norm_name(tname)
    best = None
    for aname in allotment_workload:
        a_short = norm_name(aname)
        if a_short == short or a_short in short or short in a_short:
            best = aname
            break
    if best:
        matches[tname] = allotment_workload[best]

print("\nWorkload cross-check (computed vs Allotment 'WORK LOAD'):")
mismatches = 0
for tname in sorted(TEACHER_SCHEDULE):
    computed = raw_unit_count[tname]
    official = matches.get(tname)
    flag = '' if official is None or official == computed else '  <-- MISMATCH'
    if flag: mismatches += 1
    print(f"  {tname:35s} computed={computed:3d}  official={official}{flag}")
print("Total mismatches:", mismatches, "/ matched:", len(matches), "/ total teachers:", len(TEACHER_SCHEDULE))

with open('teacher_workload_matches.json','w') as f:
    json.dump({'computed':raw_unit_count, 'official':matches}, f, indent=1)

# ---------- 4. build CLASS_SCHEDULE (inverted from TEACHER_SCHEDULE) ----------
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
                    'slot': slot, 'teacher': name,
                    'group': cell.get('group'), 'note': cell.get('note'),
                })
for cls in CLASS_SCHEDULE:
    for day in CLASS_SCHEDULE[cls]:
        CLASS_SCHEDULE[cls][day].sort(key=lambda e: e['slot'])

CLASSES = sorted(CLASS_SCHEDULE.keys(), key=lambda c: (int(re.match(r'\d+', c).group()), c))
print("\nClasses found:", CLASSES)
print("Count:", len(CLASSES))

TEACHER_META = {name: {'defaultUnits': raw_unit_count[name], 'officialWorkload': matches.get(name)} for name in TEACHER_SCHEDULE}

# ---------- 5. parse Class 6/7/8/9&10 sheets for subject labels + REM (pending-hire) slots ----------
CLASS_SHEET_MAP = {'Class 6':'G6', 'Class 7':'G7', 'Class 8':'G8-10', '9 & 10':'G8-10'}

def parse_class_sheet(sheetname):
    ws = wb[sheetname]
    merged = list(ws.merged_cells.ranges)
    def gv(r,c):
        for mr in merged:
            if mr.min_row <= r <= mr.max_row and mr.min_col <= c <= mr.max_col:
                return ws.cell(row=mr.min_row, column=mr.min_col).value
        return ws.cell(row=r, column=c).value
    # find class-name header anchors: single-row merges with a class-code-like value, OR
    # repeated class code across a row (row of "6EA|6EA|6EA...") as seen in Class 6/7/8 sheets.
    results = {}  # class -> day -> [{slot, subject}]
    max_r, max_c = ws.max_row, ws.max_column
    # find rows where a class code repeats 5+ times (the class-name banner row)
    class_row_starts = []
    for r in range(1, max_r+1):
        c = 1
        while c <= max_c:
            v = gv(r,c)
            if v and re.match(r'^\d{1,2}E[A-E]$', str(v).strip()):
                cls = str(v).strip()
                start_c = c
                run = 0
                while c <= max_c and gv(r,c) == v:
                    run += 1; c += 1
                if run >= 4:
                    class_row_starts.append((r, start_c, cls))
                continue
            c += 1
    class_row_starts.sort()
    clusters = {}
    for (r, startcol, cls) in class_row_starts:
        clusters.setdefault(startcol, []).append((r, cls))

    DAYSET = {'Monday','Tuesday','Wed','Thursday','Friday'}
    DAYNORM = {'Monday':'Monday','Tuesday':'Tuesday','Wed':'Wednesday','Thursday':'Thursday','Friday':'Friday'}
    for startcol, items in clusters.items():
        items.sort()
        for i, (r, cls) in enumerate(items):
            end_r = items[i+1][0] if i+1 < len(items) else max_r+1
            for rr in range(r, end_r):
                dcol = None
                for cand in (startcol-1, startcol, startcol-2):
                    if cand < 1: continue
                    v = gv(rr, cand)
                    if v and str(v).strip() in DAYSET:
                        dcol = cand
                        break
                if dcol is None:
                    continue
                day = DAYNORM[str(gv(rr, dcol)).strip()]
                slots = []
                for cc in range(dcol+1, dcol+9):
                    v = gv(rr, cc)
                    slots.append(str(v).strip() if v else '')
                results.setdefault(cls, {})
                if day in results[cls]:
                    existing = results[cls][day]
                    results[cls][day] = [e if e else s for e,s in zip(existing, slots)]
                else:
                    results[cls][day] = slots
    return results

PENDING_SLOTS = []  # list of {class, weekday, slot, subject}
subject_data_all = {}
for sheetname in CLASS_SHEET_MAP:
    parsed = parse_class_sheet(sheetname)
    subject_data_all.update(parsed)

for cls, days in subject_data_all.items():
    for day, slots in days.items():
        for idx, subj in enumerate(slots):
            slot = idx + 1
            if subj and subj.strip().upper() == 'REM':
                PENDING_SLOTS.append({'class': cls, 'weekday': day, 'slot': slot})

print("\nClasses found in class-sheets:", sorted(subject_data_all.keys()))
print("Total REM/pending slots found:", len(PENDING_SLOTS))
for p in PENDING_SLOTS[:10]:
    print("  ", p)

# ---------- 6. assemble final output ----------
output = {
    'PERIOD_TEMPLATES': PERIOD_TEMPLATES,
    'TEACHER_SCHEDULE': TEACHER_SCHEDULE,
    'TEACHER_META': TEACHER_META,
    'CLASS_SCHEDULE': CLASS_SCHEDULE,
    'CLASSES': CLASSES,
    'DAY_TYPE': DAY_TYPE,
    'PENDING_SLOTS': PENDING_SLOTS,
}
with open('school_data_v2.json', 'w') as f:
    json.dump(output, f, indent=1)
print("\nWrote school_data_v2.json")
