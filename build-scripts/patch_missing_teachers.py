import json

master = json.load(open('teachers_raw_v2.json'))
teachers = master['teachers']
recovered = json.load(open('recovered_teachers.json'))

ALL_DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday']

# 1. Kiran-Urdu: genuinely missing, zero conflicts found -> add cleanly
teachers['Kiran-Urdu'] = recovered['Kiran-Urdu']
master['meta']['Kiran-Urdu'] = 'Teachers Timetable (recovered from urdu & isl teachers sheet)'

# 2. "Maths NT" is a perfect 18/18 match for Nizar -> rename in place
teachers['Nizar'] = teachers.pop('Maths NT')
master['meta']['Nizar'] = master['meta'].pop('Maths NT', 'Teachers Timetable') + ' (renamed from placeholder "Maths NT")'

# 3. "SST - NT" matches Saleem-NT for all 18 of its own slots, plus Saleem's old
#    data has 10 more slots nobody else claims in the master sheet -> restore those,
#    EXCEPT Thursday slot4 "6EE(L)" which conflicts with Lib-Zeeshan's existing
#    6EE booking at that exact slot (flagged for the user, not merged).
saleem = teachers.pop('SST - NT')
extra_from_old = recovered['Saleem - NT']
skip = {('Thursday', 4)}  # (day, slot_number) — conflicts with Lib - Zeeshan
for day in ALL_DAYS:
    cur = saleem.get(day, ['']*8)
    old = extra_from_old.get(day, ['']*8)
    merged_row = []
    for idx in range(8):
        slot_num = idx+1
        if cur[idx]:
            merged_row.append(cur[idx])
        elif (day, slot_num) in skip:
            merged_row.append('')  # leave blank, flagged separately
        elif old[idx]:
            merged_row.append(old[idx])
        else:
            merged_row.append('')
    saleem[day] = merged_row
teachers['Saleem - NT'] = saleem
master['meta']['Saleem - NT'] = 'Teachers Timetable (placeholder "SST - NT" renamed + gaps restored from old sheet, minus 1 flagged conflict)'

with open('teachers_raw_v2_patched.json', 'w') as f:
    json.dump(master, f, indent=1)

print("Kiran-Urdu added:", 'Kiran-Urdu' in teachers)
print("Nizar (ex Maths NT) slots:", sum(1 for d in teachers['Nizar'].values() for s in d if s))
print("Saleem - NT (ex SST-NT, patched) slots:", sum(1 for d in teachers['Saleem - NT'].values() for s in d if s))
print("Remaining teacher count:", len(teachers))
print("\nNOT merged (flagged for your review, see README):")
print(" - Aliya-Chemistry: her old slots are now inconsistently covered by 3 different")
print("   current teachers (Chemistry NT / Shahreyar - ICT / Nabila - Sci) -> left out,")
print("   looks like she's no longer teaching and her load was redistributed.")
print(" - Shahmim- (SST) vs 'Shamim - (SST)': 17/18 slots match; 5 don't cleanly line up")
print("   -> left master's 'Shamim - (SST)' as-is, didn't force a guess.")
print(" - Saleem's old Thursday-slot4 '6EE(L)' dropped: clashes with Lib-Zeeshan's")
print("   existing 6EE booking at that exact slot.")
