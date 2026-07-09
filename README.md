# AKESP — Timetable & Fixture Board

Plain HTML/CSS/JS static site. No build step, no framework. Firebase (Firestore)
is used only to store fixture (substitute) assignments and one settings doc —
everything else is baked into `data.js` from your real timetable spreadsheet.

## Files

- `index.html` — the whole app shell (3 tabs: Timetables / Set Fixture / Weekly Units)
- `style.css` — neobrutalist styling, deep coal + electric lime
- `app.js` — all logic (rendering, fixture assignment, units calculation)
- `data.js` — **auto-generated** from `Teachers_timetable.xlsx`. Don't hand-edit; regenerate if the timetable changes.
- `firebase-config.js` — **you need to fill this in** with your project's web SDK config (Firebase Console → Project settings → Your apps)
- `firestore.rules` — open read/write on `fixtures` and `config/settings` only (per your choice — no login). Deploy with `firebase deploy --only firestore:rules`, or paste into the Firestore Rules tab in console.

## Deploying

1. Fill in `firebase-config.js` with your `akespsfm` project's web config (or a new project, your call).
2. In Firebase Console, enable Firestore (Native mode).
3. Paste `firestore.rules` into the Rules tab and publish.
4. Push this folder to a GitHub repo, enable GitHub Pages on it (Settings → Pages → deploy from branch), done. No backend to host.

Until step 1 is done, the site still works in your browser for building/demoing —
fixture assignments just live in memory and vanish on refresh instead of saving.

## How it works

- **Timetables tab**: pick a class, see its whole week. Pick a date to preview
  what that week actually looks like on that day (shows substitutes if a
  fixture is active).
- **Set Fixture tab**: two entry points into the same underlying system:
  - **Mark teacher absent** (default view): pick the teacher, first absent
    date, and how many days they're out. AKESP pulls every period that
    teacher normally teaches within that window — any class, any grade — and
    lists them one by one with a "who's free right now, lightest load first"
    dropdown next to each. Assign as you go; a progress line shows
    "x / y periods covered."
  - **Cover one period**: the direct single-period flow — pick date, class,
    and period yourself if you already know exactly what needs covering.
  Both write to the same fixture records, so a period assigned one way shows
  up correctly no matter which view you check it from. Each substitution
  auto-expires on its own after the date it covers — nothing to manually revert.
- **Weekly Units tab**: every teacher's default load (from their real
  timetable) + fixture periods picked up so far this week. You can change
  which day/time the week "resets" on — this shifts what counts as
  "this week" for everyone, and doesn't require deleting or resetting any data.

## Assumptions I made — please sanity-check these against how the school actually runs

1. **Default weekly units** = the number of periods a teacher is scheduled to
   teach in a normal week, counted straight from `Teachers_timetable.xlsx`.
   This is *not* stored anywhere — it's recalculated from the data every time,
   so it can never go stale the way it did in the old app.

2. **"REM" periods** (8 of them in the sheet) are treated as the teacher being
   busy/unavailable, but **not** counted toward their weekly unit total, since
   they're not an actual class. If REM should count as a unit, it's a
   one-line change in `build_data.py`.

3. **One-off tags** like `(AH)`, `(Sal)`, `(L)`, `(Z)`, `(N)`, `(SHM)`, `(SHN)`
   next to a handful of grade 6/7 periods — I don't have a name key for these
   initials, so they're kept as a small note on that period only and don't
   affect free-teacher matching. If these represent a second teacher who's
   also genuinely busy then, let me know who they map to and I'll fold them in.

4. **Cross-grade period matching**: Grade 6, Grade 7, and Grade 8–10 have
   slightly different break placements (up to ~25 minutes apart around the
   same "period number"). Free-teacher lookups match by period-slot position,
   which is exact everywhere except right around each band's break — that's
   the one part of this I'd actually like you to double check against the
   real bell timing before relying on it for back-to-back grade-6/grade-9
   coverage decisions.

   One specific cell in the source spreadsheet falls squarely in that
   ambiguous zone: **Shazia (Sindhi/Isl) — 8EE — Thursday, period slot 6**.
   Her row mixes grade 6/7 and grade 8 classes across the same columns, and
   this particular class lands on a column her other grade-8 classes treat
   as break. The app still shows it (nothing is ever silently dropped — it's
   flagged with a ⚠ and a tooltip) but the displayed time for that one cell
   may be off by up to ~25 minutes. Everything else — all 809 other
   scheduled periods across the whole week — resolved cleanly with no
   ambiguity.

5. **Grade 9 Urdu/Islamiat split groups** (e.g. "9EA" splits into a U group
   and an I group taught simultaneously by two different teachers) are
   handled as two separate bookings at the same period — both show up, both
   block their respective teacher, no conflict.

6. **Fixture write access is open** (no login) — anyone with the site link
   can set or remove fixtures, per your choice. If that turns out to be a
   problem in practice, adding a shared password gate or Firebase login later
   is a small, isolated change.

## Regenerating `data.js` from a new spreadsheet

`build-scripts/parse_timetable.py` reads `Teachers_timetable.xlsx` into a raw
JSON dump; `build-scripts/build_data.py` turns that into the normalized
structure `data.js` is generated from. Both need `openpyxl` (`pip install
openpyxl`). Point them at a new spreadsheet and re-run both, in order, any
time the timetable changes — no need to come back to me unless the sheet
layout itself changes shape.
