"""
Some teachers can go missing when a school consolidates multiple old
per-subject sheets into one master 'Teachers Timetable' sheet. This script
finds anyone present in the old subject sheets but absent from the master,
and folds them back in — but only where it's safe (no schedule conflicts).

Run this AFTER parse_timetable_v2.py and BEFORE build_data_v2.py:
    python3 parse_timetable_v2.py <file.xlsx>
    python3 recover_missing_teachers.py <file.xlsx>
    python3 build_data_v2.py <file.xlsx>

Known, hand-verified fixes as of the 2026-27 workbook (re-check these if you
run this against a different/future spreadsheet):
  - Kiran-Urdu: fully missing, zero conflicts -> added back whole.
  - "Maths NT" -> renamed to Nizar (exact 18/18 slot match).
  - "SST - NT" -> renamed to Saleem - NT (18/18 match + 10 more of his old
    periods nobody else claims), except his old Thursday-slot-4 library
    duty for 6EE, which conflicts with Lib-Zeeshan's existing booking there.
  - NOT merged (left for a human to confirm): Aliya-Chemistry (her old load
    is now split across 3 different current teachers — looks reassigned,
    not missing) and the 5-slot mismatch between "Shamim - (SST)" and the
    old "Shahmim- (SST)".
"""
import openpyxl, json, sys

XLSX_PATH = sys.argv[1] if len(sys.argv) > 1 else 'Working_Timetables_2026_-_27_-_Copy.xlsx'
ALL_DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday']
DAY_NORM = {'Monday':'Monday','Tuesday':'Tuesday','Wed':'Wednesday','Thursday':'Thursday','Friday':'Friday'}
MISSING = {'Aliya-Chemistry','Kiran-Urdu','Nizar','Saleem - NT','Shahmim- (SST)'}

def get_val(ws, merged, r, c):
    for mr in merged:
        if mr.min_row <= r <= mr.max_row and mr.min_col <= c <= mr.max_col:
            return ws.cell(row=mr.min_row, column=mr.min_col).value
    return ws.cell(row=r, column=c).value

def extract_from_old_sheets(wb):
    recovered = {}
    for sheetname in ['Eng & SST teachers', 'urdu & isl teachers', 'sciences teachers', 'mathematics teachers']:
        if sheetname not in wb.sheetnames: continue
        ws = wb[sheetname]
        merged = list(ws.merged_cells.ranges)
        anchors = []
        for mr in merged:
            if mr.min_row == mr.max_row and (mr.max_col - mr.min_col) >= 4:
                v = ws.cell(row=mr.min_row, column=mr.min_col).value
                if v and str(v).strip() in MISSING:
                    anchors.append((mr.min_row, mr.min_col, mr.max_col, str(v).strip()))
        anchors.sort()
        clusters = {}
        for a in anchors:
            clusters.setdefault(a[1], []).append(a)
        for col, items in clusters.items():
            items.sort()
            for i, (row, mincol, maxcol, name) in enumerate(items):
                end_row = items[i+1][0] if i+1 < len(items) else ws.max_row+1
                recovered.setdefault(name, {})
                for r in range(row, end_row):
                    dayval = get_val(ws, merged, r, mincol-1)
                    if dayval and str(dayval).strip() in ALL_DAYS or (dayval and str(dayval).strip() in DAY_NORM):
                        day = DAY_NORM[str(dayval).strip()]
                        slots = []
                        for c in range(mincol, mincol+8):
                            v = get_val(ws, merged, r, c)
                            slots.append(str(v).strip() if v else '')
                        if day in recovered[name]:
                            existing = recovered[name][day]
                            recovered[name][day] = [e if e else s for e,s in zip(existing, slots)]
                        else:
                            recovered[name][day] = slots
    return recovered

def main():
    wb = openpyxl.load_workbook(XLSX_PATH, data_only=True)
    master = json.load(open('teachers_raw_v2.json'))
    teachers = master['teachers']
    recovered = extract_from_old_sheets(wb)

    # Kiran-Urdu: add cleanly if present and not already in master
    if 'Kiran-Urdu' in recovered and 'Kiran-Urdu' not in teachers:
        teachers['Kiran-Urdu'] = recovered['Kiran-Urdu']
        master['meta']['Kiran-Urdu'] = 'recovered from urdu & isl teachers sheet'

    # Maths NT -> Nizar
    if 'Maths NT' in teachers and 'Nizar' not in teachers:
        teachers['Nizar'] = teachers.pop('Maths NT')
        master['meta']['Nizar'] = master['meta'].pop('Maths NT', '') + ' (renamed from placeholder "Maths NT")'

    # SST - NT -> Saleem - NT, merging in unclaimed old slots, skipping the one known conflict
    if 'SST - NT' in teachers and 'Saleem - NT' not in teachers:
        saleem = teachers.pop('SST - NT')
        extra = recovered.get('Saleem - NT', {})
        skip = {('Thursday', 4)}  # conflicts with Lib - Zeeshan's existing 6EE booking
        for day in ALL_DAYS:
            cur = saleem.get(day, ['']*8)
            old = extra.get(day, ['']*8)
            merged_row = []
            for idx in range(8):
                slot_num = idx + 1
                if cur[idx]:
                    merged_row.append(cur[idx])
                elif (day, slot_num) in skip:
                    merged_row.append('')
                elif old[idx]:
                    merged_row.append(old[idx])
                else:
                    merged_row.append('')
            saleem[day] = merged_row
        teachers['Saleem - NT'] = saleem
        master['meta']['Saleem - NT'] = 'placeholder "SST - NT" renamed + gaps restored, minus 1 flagged conflict'

    # Aliya-Chemistry and the Shamim/Shahmim mismatch are intentionally NOT auto-merged —
    # see the module docstring and README for why.

    json.dump(master, open('teachers_raw_v2.json', 'w'), indent=1)
    print(f"Recovery complete. Teacher count now: {len(teachers)}")

if __name__ == '__main__':
    main()
