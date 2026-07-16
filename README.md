# AKESP — Timetable & Fixture Board

Plain HTML/CSS/JS static site. No build step, no framework. Firebase (Firestore)
stores only: fixture/switch records, one settings doc, and remedial-slot
toggles. Everything else is baked into `data.js` from the real timetable
spreadsheet.

## Files

- `index.html` — the whole app shell (4 tabs: Timetables / Set Fixture / Weekly Units / Remedial)
- `style.css` — neobrutalist styling, deep coal + electric lime
- `app.js` — all logic (rendering, fixtures, switches, remedial slots, units)
- `data.js` — **auto-generated** from `Working_Timetables_2026_-_27_-_Copy.xlsx`. Don't hand-edit; regenerate if the timetable changes.
- `firebase-config.js` — **fill this in** with your project's web SDK config (Firebase Console → Project settings → Your apps)
- `firestore.rules` — open read/write on `fixtures`, `config/settings`, and `remStatus` only (per your choice — no login).

## Deploying

1. Fill in `firebase-config.js`.
2. Enable Firestore (Native mode) in Firebase Console.
3. Paste `firestore.rules` into the Rules tab and publish.
4. Push this folder to GitHub, enable Pages. Done — no backend to host.

Until step 1, the site still works for building/demoing — everything just
lives in memory and resets on refresh instead of persisting.

## Data source — rebuilt from the new workbook

This version is rebuilt entirely from `Working_Timetables_2026_-_27_-_Copy.xlsx`,
specifically:
- **`Teachers Timetable`** (the consolidated, patched sheet) — the master
  source for who teaches what, when. This superseded the old 4 separate
  subject sheets from the first version.
- **`Class 6` / `Class 7` / `Class 8` / `9 & 10`** — subject-only, class-centric
  sheets, used to find every **REM** (remedial, not-yet-hired) slot.
- **`Allotment`** — official per-teacher workload figures, used as a
  cross-check (see below).

Your fixes came through cleanly:
- **8EE / Thursday** — now lands on P4, no longer landing on Shazia's break column.
- **Irsa / "combined with Nizar"** — that was an artifact of the old parser
  merging two different source sheets; rebuilding from the single patched
  master sheet, there's no such combination anywhere in the data.
- **Grade 6 "duplicate last unit"** — confirmed: the source sheet's own
  header row literally labels two different columns "6" with the identical
  time range, and the class-only `Class 6` sheet confirms grade 6 has exactly
  6 real periods a day, not 7. That phantom 7th slot is now dropped
  everywhere (never counted as a unit, never shown as a period).

**One remaining ambiguous cell**, flagged with ⚠ in the UI rather than
guessed at: **Arfa (Eng) — 8EE — Friday, slot 5**. Her Friday row mixes
grade 6 and grade 8 classes across the same columns, same shape as the old
Shazia issue — 1 cell out of 749 scheduled periods.

**Workload cross-check**: comparing computed units (actual periods in the
patched `Teachers Timetable`) against `Allotment`'s official "WORK LOAD"
column, 15 of 43 teachers match exactly; 18 differ (up to 6 units), and the
rest have no clean name match between sheets. The app uses the **computed**
figure (what's actually on the patched schedule) since that's what genuinely
needs covering — but the gap is worth a look in case some periods haven't
been entered yet for teachers below their target load.

## REM (remedial) slots — Remedial tab

20 periods across grade 7 (Maths/Sci/Eng) are marked REM in the source —
remedial classes with no teacher hired yet, starting in about a month. Each
one is **off by default**: not counted toward anyone's load, doesn't block
any substitute search. Once a hire starts, go to the Remedial tab, flip that
slot on, type their name, save — from then on it behaves exactly like a real
period (counts toward their units, blocks them from being pulled as a
substitute then, shows up on the class's timetable). Flip it back off any
time — nothing is destructive, no data is lost by toggling.

## Set Fixture — three ways in, one system underneath

- **Mark teacher absent**: teacher + start date + days out → lists every
  period they're actually scheduled for in that window, any class, any
  grade, with a free-teacher dropdown next to each.
- **Cover one period**: direct — pick date, class, period yourself.
- **Temp switch**: pick one period from each of two teachers on the same
  date — they trade for the duration you set (or undo any time), useful for
  logistics swaps that aren't about anyone being absent.

All three write the same underlying fixture records, so the Timetables and
Weekly Units tabs don't care which mode created a substitution.

**Free-teacher sorting**: teachers who already teach that exact class
(marked ★) are listed before anyone else, then sorted lightest-load-first
within each group — someone who already knows the class and its students
beats a random light-load teacher who's never met them.

## Weekly Units tab

Default load + active remedial units + fixture periods picked up this week,
recalculated live every time — never a stored counter that can drift.
Change which day/time the week "resets" on any time; nothing needs
resetting or deleting when you do.

## Library periods

The source sheet marks a class taken to the library with a trailing `lib` on
that cell, directly under whichever teacher's row it appears in — so it's
now handled as a plain note ("Library") on that teacher's own period, no
separate name-decoding needed. (The earlier version had one-letter tags like
`(AH)`/`(SHM)` scattered across the old per-subject sheets that needed a
decoder ring; the new consolidated master sheet doesn't use that convention,
so it's moot now.)

## Regenerating `data.js` from a new spreadsheet

`build-scripts/parse_timetable_v2.py` reads the `Teachers Timetable` sheet
into a raw JSON dump; `build-scripts/build_data_v2.py` turns that — plus the
`Class 6/7/8/9&10` sheets for REM slots and `Allotment` for the workload
cross-check — into the structure `data.js` is generated from. Both need
`openpyxl` (`pip install openpyxl`). Re-run both, in order, any time the
timetable changes.
