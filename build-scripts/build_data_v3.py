import openpyxl, json, re, sys

XLSX_PATH = sys.argv[1] if len(sys.argv) > 1 else '/mnt/user-data/uploads/Working_Timetables_2026_-_27_-_Copy.xlsx'
wb = openpyxl.load_workbook(XLSX_PATH, data_only=True)

raw = json.load(open('teachers_raw_v3.json'))
teachers_raw = raw['teachers']
teacher_meta_sheet = raw['meta']

ALL_DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday']

# Zeeshan's row lists which staff member actually covered library duty for a class,
# identified by initials, per the school's own convention (confirmed against the
# Allotment sheet's separate "LIB <class>" unit entries for these same people).
ZEESHAN_INITIAL_MAP = {
    'Z':  'Lib - Zeeshan',        # self
    'AH': 'Arfa - Eng',           # Arfa Hakeem
    'Sal':'Saleem - NT',
    'SAL':'Saleem - NT',
    'SHM':'Shahmim- (SST)',
    'SHN':'Shanaz (SST/PST)',
    # 'N' is not identified anywhere else in the workbook — left unresolved, flagged below.
}
UNRESOLVED_INITIALS = set()

def band_of(cls):
    if cls.startswith('6'): return 'G6'
    if cls.startswith('7'): return 'G7'
    return 'G8-10'

DAY_TYPE = {'Monday':'MonThu','Tuesday':'MonThu','Wednesday':'MonThu','Thursday':'MonThu','Friday':'Fri'}

def normalize_token(tok):
    t = tok.strip()
    note = None
    paren = None
    m = re.search(r'\(([^)]+)\)', t)
    if m:
        paren = m.group(1).strip()
        t = re.sub(r'\([^)]+\)', '', t).strip()
    m2 = re.search(r'\s+lib\s*$', t, flags=re.IGNORECASE)
    if m2:
        note = 'Library'
        t = t[:m2.start()].strip()
    group = None
    m3 = re.match(r'^(\d{1,2}E[A-E])\s*(U|I)$', t)
    if m3:
        t = m3.group(1)
        group = m3.group(2)
    t = re.sub(r'\s+', '', t)
    return t, group, note, paren

PERIOD_TEMPLATES = {
 'G8-10_MonThu': [
    {'slot':1,'type':'period','time':'1:15-2:00'}, {'slot':2,'type':'period','time':'2:00-2:40'},
    {'slot':3,'type':'period','time':'2:40-3:20'}, {'slot':4,'type':'period','time':'3:20-4:00'},
    {'slot':5,'type':'period','time':'4:00-4:40'}, {'slot':6,'type':'break','time':'4:40-5:00'},
    {'slot':7,'type':'period','time':'5:00-5:30'}, {'slot':8,'type':'period','time':'5:30-6:00'},
 ],
 'G7_MonThu': [
    {'slot':1,'type':'period','time':'1:15-2:00'}, {'slot':2,'type':'period','time':'2:00-2:40'},
    {'slot':3,'type':'period','time':'2:40-3:20'}, {'slot':4,'type':'period','time':'3:20-4:00'},
    {'slot':5,'type':'break','time':'4:00-4:15'}, {'slot':6,'type':'period','time':'4:15-5:00'},
    {'slot':7,'type':'period','time':'5:00-5:30'}, {'slot':8,'type':'period','time':'5:30-6:00'},
 ],
 'G6_MonThu': [
    {'slot':1,'type':'period','time':'1:15-2:00'}, {'slot':2,'type':'period','time':'2:00-2:40'},
    {'slot':3,'type':'period','time':'2:40-3:20'}, {'slot':4,'type':'period','time':'3:20-4:00'},
    {'slot':5,'type':'break','time':'4:00-4:15'}, {'slot':6,'type':'period','time':'4:20-5:05'},
    {'slot':7,'type':'period','time':'5:05-5:55'}, {'slot':8,'type':'na','time':None},
 ],
 'G8-10_Fri': [
    {'slot':1,'type':'period','time':'2:15-3:05'}, {'slot':2,'type':'period','time':'3:05-3:40'},
    {'slot':3,'type':'period','time':'3:40-4:10'}, {'slot':4,'type':'period','time':'4:10-4:40'},
    {'slot':5,'type':'break','time':'4:40-4:55'}, {'slot':6,'type':'period','time':'5:00-5:30'},
    {'slot':7,'type':'period','time':'5:30-6:00'}, {'slot':8,'type':'na','time':None},
 ],
 'G67_Fri': [
    {'slot':1,'type':'period','time':'2:15-3:05'}, {'slot':2,'type':'period','time':'3:05-3:40'},
    {'slot':3,'type':'period','time':'3:40-4:10'}, {'slot':4,'type':'break','time':'4:10-4:25'},
    {'slot':5,'type':'period','time':'4:25-5:00'}, {'slot':6,'type':'period','time':'5:00-5:30'},
    {'slot':7,'type':'period','time':'5:30-6:00'}, {'slot':8,'type':'na','time':None},
 ],
}

# ---------- build raw per-teacher grids first (before reassignment) ----------
grids = {}  # name -> day -> [8 raw string tokens]
for name, days in teachers_raw.items():
    grids[name] = {day: days.get(day, ['']*8) for day in ALL_DAYS}

# ---------- pass 1: parse normally, collecting Zeeshan reassignments ----------
TEACHER_SCHEDULE = {name: {day: [None]*8 for day in ALL_DAYS} for name in grids}
reassignments = []  # (from_teacher, day, slot, to_teacher, cls, note)

# Cross-validated against the Class 8 subject sheet: that sheet independently
# confirms 8EE's Sindhi period is slot 5 on Thursday (labeled "SINDH" there,
# with slot 6 blank) while this teacher sheet has Shazia at slot 6 instead —
# and slot 6 there is genuinely her grade-8 break, an actual scheduling
# impossibility. Slot 5 is free in her own row. Corrected here rather than
# just flagged, since two independent sheets now agree on where it belongs.
SHAZIA_8EE_FIX = ('Shazia (Sindhi / Isl)', 'Thursday', 6, 5)  # (teacher, day, from_idx1, to_idx1)

for name, days in grids.items():
    for day in ALL_DAYS:
        slots = list(days[day])
        ft, fday, ffrom, fto = SHAZIA_8EE_FIX
        if name == ft and day == fday and slots[ffrom-1].strip().split('(')[0] == '8EE' and not slots[fto-1]:
            slots[fto-1] = slots[ffrom-1]
            slots[ffrom-1] = ''
        for idx, s in enumerate(slots):
            slot_num = idx + 1
            if not s:
                continue
            if s.strip() == 'REM':
                TEACHER_SCHEDULE[name][day][idx] = {'type':'rem'}
                continue
            cls, group, note, paren = normalize_token(s)
            if band_of(cls) == 'G6' and DAY_TYPE[day] == 'MonThu' and slot_num == 8:
                continue  # confirmed spreadsheet duplicate-column artifact
            if paren == 'L':
                note = 'Library'
                TEACHER_SCHEDULE[name][day][idx] = {'type':'class','class':cls,'group':group,'note':note}
            elif paren and name == 'Lib - Zeeshan':
                target = ZEESHAN_INITIAL_MAP.get(paren)
                if target:
                    reassignments.append((name, day, idx, target, cls, f'Library (covered by {target.split(" - ")[0].split("(")[0].strip()})'))
                    # leave this teacher's own slot empty; the target gets it in pass 2
                else:
                    UNRESOLVED_INITIALS.add(paren)
                    TEACHER_SCHEDULE[name][day][idx] = {'type':'class','class':cls,'group':group,'note':f'Library (unidentified escort "{paren}" — please confirm)'}
            elif paren:
                # unrelated parenthetical elsewhere (rare) — keep as a plain note, no reassignment
                TEACHER_SCHEDULE[name][day][idx] = {'type':'class','class':cls,'group':group,'note':paren}
            else:
                TEACHER_SCHEDULE[name][day][idx] = {'type':'class','class':cls,'group':group,'note':note}

# ---------- pass 2: apply reassignments to the target teacher's own grid ----------
for (from_t, day, idx, target, cls, note) in reassignments:
    if TEACHER_SCHEDULE[target][day][idx] is not None:
        print(f"WARNING: reassignment target {target} {day} slot{idx+1} already occupied — skipping reassignment of {cls} from {from_t}")
        continue
    TEACHER_SCHEDULE[target][day][idx] = {'type':'class','class':cls,'group':None,'note':note}

print(f"\nReassigned {len(reassignments)} library-duty periods from Lib-Zeeshan's coordination row to the actual covering teacher.")
for r in reassignments:
    print("  ", r)
print("\nUnresolved initials (left attributed to Zeeshan, flagged):", UNRESOLVED_INITIALS)

TEACHER_META = {}
for name in TEACHER_SCHEDULE:
    units = sum(1 for day in ALL_DAYS for c in TEACHER_SCHEDULE[name][day] if c and c['type']=='class')
    TEACHER_META[name] = {'defaultUnits': units, 'sheet': teacher_meta_sheet.get(name, 'unknown')}

# ---------- build CLASS_SCHEDULE ----------
CLASS_SCHEDULE = {}
for name, sched in TEACHER_SCHEDULE.items():
    for day in ALL_DAYS:
        for idx, cell in enumerate(sched[day]):
            if cell and cell['type'] == 'class':
                cls = cell['class']
                CLASS_SCHEDULE.setdefault(cls, {}).setdefault(day, []).append({
                    'slot': idx+1, 'teacher': name, 'group': cell.get('group'), 'note': cell.get('note'),
                })
for cls in CLASS_SCHEDULE:
    for day in CLASS_SCHEDULE[cls]:
        CLASS_SCHEDULE[cls][day].sort(key=lambda e: e['slot'])

CLASSES = sorted(CLASS_SCHEDULE.keys(), key=lambda c: (int(re.match(r'\d+', c).group()), c))
print("\nClasses:", CLASSES, "count:", len(CLASSES))
print("Teachers:", len(TEACHER_SCHEDULE))

with open('school_data_v3_pre.json','w') as f:
    json.dump({
        'PERIOD_TEMPLATES': PERIOD_TEMPLATES, 'TEACHER_SCHEDULE': TEACHER_SCHEDULE,
        'TEACHER_META': TEACHER_META, 'CLASS_SCHEDULE': CLASS_SCHEDULE,
        'CLASSES': CLASSES, 'DAY_TYPE': DAY_TYPE,
    }, f, indent=1)
print("Wrote school_data_v3_pre.json (before REM + Allotment cross-check)")

# ---------- REM/pending slots from Class 6/7/8/9&10 sheets (unchanged approach) ----------
def parse_class_sheet(sheetname):
    ws = wb[sheetname]
    merged = list(ws.merged_cells.ranges)
    def gv(r,c):
        for mr in merged:
            if mr.min_row <= r <= mr.max_row and mr.min_col <= c <= mr.max_col:
                return ws.cell(row=mr.min_row, column=mr.min_col).value
        return ws.cell(row=r, column=c).value
    results = {}
    max_r, max_c = ws.max_row, ws.max_column
    class_row_starts = []
    for r in range(1, max_r+1):
        c = 1
        while c <= max_c:
            v = gv(r,c)
            if v and re.match(r'^\d{1,2}E[A-E]$', str(v).strip()):
                cls = str(v).strip(); start_c = c; run = 0
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
                        dcol = cand; break
                if dcol is None: continue
                day = DAYNORM[str(gv(rr, dcol)).strip()]
                slots = [str(gv(rr,cc)).strip() if gv(rr,cc) else '' for cc in range(dcol+1, dcol+9)]
                results.setdefault(cls, {})
                if day in results[cls]:
                    existing = results[cls][day]
                    results[cls][day] = [e if e else s for e,s in zip(existing, slots)]
                else:
                    results[cls][day] = slots
    return results

PENDING_SLOTS = []
subject_data_all = {}
for sheetname in ['Class 6','Class 7','Class 8','9 & 10']:
    subject_data_all.update(parse_class_sheet(sheetname))
for cls, days in subject_data_all.items():
    for day, slots in days.items():
        for idx, subj in enumerate(slots):
            if subj and subj.strip().upper() == 'REM':
                PENDING_SLOTS.append({'class': cls, 'weekday': day, 'slot': idx+1})
print("\nPENDING (REM) slots found:", len(PENDING_SLOTS))

# ---------- Allotment cross-check ----------
ws = wb['Allotment']
merged = list(ws.merged_cells.ranges)
def gv2(r,c):
    for mr in merged:
        if mr.min_row <= r <= mr.max_row and mr.min_col <= c <= mr.max_col:
            return ws.cell(row=mr.min_row, column=mr.min_col).value
    return ws.cell(row=r, column=c).value
allotment_workload = {}
for r in range(1, ws.max_row+1):
    name = gv2(r,2); wl = gv2(r,4)
    if name and wl and str(wl).strip().isdigit():
        nm = str(name).strip()
        if nm not in allotment_workload:
            allotment_workload[nm] = int(wl)

def norm_name(n):
    n = re.sub(r'\(.*?\)', '', n); n = re.sub(r'[-/].*', '', n)
    return re.sub(r'\s+', ' ', n).strip().lower()

matches = {}
for tname in TEACHER_SCHEDULE:
    short = norm_name(tname)
    for aname in allotment_workload:
        a_short = norm_name(aname)
        if a_short == short or a_short in short or short in a_short:
            matches[tname] = allotment_workload[aname]; break

print("\nWorkload cross-check:")
mism = 0
for tname in sorted(TEACHER_SCHEDULE):
    c = TEACHER_META[tname]['defaultUnits']; o = matches.get(tname)
    flag = '' if o is None or o==c else '  <-- MISMATCH'
    if flag: mism += 1
    print(f"  {tname:32s} computed={c:3d} official={o}{flag}")
print(f"Mismatches: {mism} / matched: {len(matches)} / total: {len(TEACHER_SCHEDULE)}")
for t in TEACHER_META:
    TEACHER_META[t]['officialWorkload'] = matches.get(t)

output = {
    'PERIOD_TEMPLATES': PERIOD_TEMPLATES, 'TEACHER_SCHEDULE': TEACHER_SCHEDULE,
    'TEACHER_META': TEACHER_META, 'CLASS_SCHEDULE': CLASS_SCHEDULE,
    'CLASSES': CLASSES, 'DAY_TYPE': DAY_TYPE, 'PENDING_SLOTS': PENDING_SLOTS,
}
with open('school_data_v3.json','w') as f:
    json.dump(output, f, indent=1)
print("\nWrote school_data_v3.json")
