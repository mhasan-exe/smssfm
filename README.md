# AKESP — Timetable & Fixture Board

Plain HTML/CSS/JS static site. No build step, no framework. Firebase (Firestore)
stores only: fixture/switch records, one settings doc, and remedial-slot
toggles. Everything else is baked into `data.js` from the real per-subject
teacher sheets.

## Files

- `index.html` — the whole app shell (4 tabs: Timetables / Set Fixture / Weekly Units / Remedial)
- `style.css` — neobrutalist styling, deep coal + electric lime
- `app.js` — all logic (rendering, fixtures, switches, remedial slots, units)
- `data.js` — **auto-generated** from `Working_Timetables_2026_-_27_-_Copy.xlsx`. Don't hand-edit; regenerate if the timetable changes.
- `firebase-config.js` — **fill this in** with your project's web SDK config
- `firestore.rules` — open read/write on `fixtures`, `config/settings`, `remStatus` (no login, per your choice)

## Deploying

1. Fill in `firebase-config.js`.
2. Enable Firestore (Native mode) in Firebase Console.
3. Paste `firestore.rules` into the Rules tab and publish.
4. Push this folder to GitHub, enable Pages. No backend to host.

## How I verified this against the Class sheets

You asked directly whether I was sure this was right — I hadn't actually
cross-checked the teacher sheets against the subject-level Class sheets yet
at that point, so I ran it properly instead of just asserting confidence.

**Method**: for every class, every day, every period, compare the subject
the Class 6/7/8/9&10 sheet says should be happening against the subject
implied by whichever teacher the per-subject sheets have scheduled there
(inferred from their name/label — "Ayesha (Bio)" → science, etc).

**Result**: 766 periods checked. Once label differences are normalized
(MATH/MATHS, URDU/URD, PHY·BIO·CHEM all → science, PST/SST, CS/ICT) —
**747 clean matches**. Two genuinely worth a look:
- `7EC` Friday period 3 — Class sheet says SST, but `Zareen - Maths` (a
  maths teacher) is scheduled there.
- `7ED` Thursday period 4 — Class sheet says ENG, but `Fida (Maths)` is
  scheduled there.

  Both are single, isolated cells (not a repeating pattern), so they read as
  either a one-off data entry slip in one of the two sheets, or a teacher
  covering outside their usual subject that period. Worth confirming which.

(The Sarah/Urdu-Islamiat "mismatches" you might notice in the raw check
output aren't real — she teaches both subjects and the Class sheet just
labels some of her periods "ISL" specifically; not an error.)

**7 genuine gaps** — the Class sheet expects a period, but no teacher is
listed at that exact class/day/slot in the per-subject sheets at all:
`10EC` Mon P8 (PHY), `7EB` Wed P8 (SST), `7EC` Fri P5 (MATHS) and P6 (SCI),
`7EE` Thu P4 (MATHS) and Fri P1 (MATHS). These are the honest remainder —
either the teacher sheets are missing an entry, or those specific periods
genuinely have no one assigned yet.

**The 8EE/Shazia cell — actually fixed now, not just flagged.** This cross-
check is what caught it precisely: the Class 8 sheet independently confirms
8EE's Sindhi period is period 5 on Thursday (labeled "SINDH", with period 6
blank) — while the teacher sheet had Shazia at period 6 instead, which lands
squarely on grade-8's real break. Two independent sheets now agree on where
it actually belongs, and period 5 was genuinely free in her own row, so this
is corrected in the data rather than left as a guess: **zero ambiguous
cells remain**, down from the 1 flagged before.

Script: `build-scripts/verify_against_class_sheets.py` — re-run it any time
after rebuilding `data.js` to re-check.

## Data source — the real per-subject sheets, not the consolidated one

This build uses the **4 per-subject teacher sheets** as the primary source —
`Eng & SST teachers`, `urdu & isl teachers`, `sciences teachers`,
`mathematics teachers` — since those are the ones you actually maintain and
patch. (The earlier build used the separate `Teachers Timetable` sheet,
which turned out to be an incomplete consolidation missing 5 teachers
entirely — that's fixed by going straight to the source sheets instead.)
`Class 6/7/8/9&10` are still used just to find REM slots, and `Allotment`
for the workload cross-check.

**All 44 teachers present, all 5 days each** — including Shazia, who was
missing her whole Monday in the other sheet.

### Library duty — now decoded properly

Your explanation was the key: a bare `(L)` on a class means that teacher
personally escorted their own class to the library (self-explanatory, kept
as-is). But `Lib - Zeeshan`'s row is different — it's a **coordination
list** naming, by initials, who actually covered library duty for grade 6/7
classes. Decoded against the Allotment sheet's own separate "LIB `<class>`"
entries:

| Initial | Teacher |
|---|---|
| AH | Arfa Hakeem (`Arfa - Eng`) |
| Sal / SAL | Saleem (`Saleem - NT`) |
| SHM | Shamim (`Shahmim- (SST)`) |
| SHN | Shanaz (`Shanaz (SST/PST)`) |
| Z | Zeeshan himself |

Each of those periods is now correctly attributed to the actual covering
teacher (counts toward *their* units, blocks *them* as a substitute then) —
not left sitting under Zeeshan's row. Checked all 8 reassignments against
each teacher's own sheet: 7 were already independently confirmed by that
teacher's own `(L)` tag on the same class/slot (redundant but consistent),
and 1 filled a genuine gap cleanly. No real conflicts.

**One tag left unresolved**: `7EA(N)` on Zeeshan's Thursday row — "N" doesn't
match anyone else in the workbook. Left attributed to Zeeshan with a note
flagging it as unidentified rather than guessing. If you know who "N" is,
it's a one-line fix.

### The Grade 6 duplicate-column artifact — still confirmed, still dropped

Same finding as before: the source header labels two different columns "6"
with the identical time range, and `Class 6` independently confirms only 6
real periods a day. That phantom slot is dropped everywhere.

### The 8EE / Shazia cell

Resolved — see "How I verified this against the Class sheets" above for the
evidence. Moved from Thursday slot 6 to slot 5, matching what the Class 8
sheet independently confirms.

**784 scheduled periods total, 0 flagged as ambiguous.**

### Workload cross-check against Allotment's "WORK LOAD" column

17 of 34 name-matched teachers line up exactly; 17 differ (some by a lot —
e.g. `Nizar` computed 18 vs Allotment's 3, `Sana Q (Bio)` computed 16 vs 22).
The app uses the **computed** figure (actual periods on the real sheet)
since that's what genuinely needs covering day to day — but a few of these
gaps are large enough that they're worth a look; full list is in the build
output if you want to dig into a specific one.

## REM (remedial) slots — Remedial tab

20 periods across grade 7 (Maths/Sci/Eng) are marked REM — remedial classes
with no teacher hired yet, starting in about a month. Off by default: not
counted, doesn't block anyone. Flip one on, name the hire, save — it
instantly behaves like a real period. Flip back off any time.

## Set Fixture — three ways in, one system underneath

- **Mark teacher absent**: teacher + start date + days out → lists every
  period they're actually scheduled for in that window, with a
  free-teacher dropdown next to each.
- **Cover one period**: direct — pick date, class, period yourself.
- **Temp switch**: pick one period from each of two teachers on the same
  date — they trade for N days, or undo any time.

**Free-teacher sorting**: teachers who already teach that exact class
(marked ★) are listed before anyone else, lightest-load-first within each
group.

## Weekly Units tab

Default load + active remedial units + fixture periods this week,
recalculated live every time — never a stored counter that can drift.
Reset day/time is changeable any time, nothing needs resetting when you do.

## Regenerating `data.js` from a new spreadsheet

Three steps, all need `openpyxl` (`pip install openpyxl`):

```
python3 build-scripts/parse_timetable_v3.py <file.xlsx>
python3 build-scripts/build_data_v3.py <file.xlsx>
python3 build-scripts/verify_against_class_sheets.py <file.xlsx>
```

The third step is the cross-check against the Class sheets — not required
for the site to work, but worth running any time the source data changes,
since it's what caught the 8EE/Shazia mix-up. `build_data_v3.py` has the
Zeeshan-initials map, the grade-6 dedup, and the Shazia/8EE slot correction
hard-coded against this specific workbook's known quirks — re-check those
if the sheet layout changes meaningfully later.
