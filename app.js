// ====================================================================
// AKESP Timetable & Fixture Board — app.js
// Hardcoded timetable lives in data.js (SCHOOL_DATA).
// Firestore only stores: fixtures (substitute assignments) and one
// config/settings doc (weekly reset day/time). Weekly units are always
// computed live from SCHOOL_DATA + fixtures — never stored as a mutable
// counter, so they can never drift out of sync with reality.
// ====================================================================

const WEEKDAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const SCHOOL_DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday'];

let db = null;
let fixturesCache = [];      // all fixture docs {id, class, weekday, slot, group, originalTeacher, subTeacher, startDate, days, endDate, switchId?}
let settingsCache = { resetDay: 'Monday', resetTime: '00:00' };
let remCache = {};           // key `${class}|${weekday}|${slot}` -> {active, teacher}

// ---------------------------------------------------------------
// Firebase init
// ---------------------------------------------------------------
function initFirebase(){
  if (typeof firebaseConfig === 'undefined' || !firebaseConfig.apiKey) {
    console.warn('firebase-config.js is not filled in yet — running in local-only preview mode.');
    return false;
  }
  if (typeof firebase === 'undefined') {
    console.warn('Firebase SDK failed to load (network/CDN issue) — running in local-only preview mode.');
    return false;
  }
  try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    return true;
  } catch (err) {
    console.warn('Firebase init failed — running in local-only preview mode.', err);
    db = null;
    return false;
  }
}

// ---------------------------------------------------------------
// Date helpers (all dates handled as local YYYY-MM-DD strings —
// never rely on toISOString(), it shifts by timezone)
// ---------------------------------------------------------------
function fmtDate(d){
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function todayStr(){ return fmtDate(new Date()); }
function dateObj(s){ return new Date(s + 'T00:00:00'); }
function weekdayNameOf(dateStr){ return WEEKDAY_NAMES[dateObj(dateStr).getDay()]; }
function addDays(dateStr, n){ const d = dateObj(dateStr); d.setDate(d.getDate()+n); return fmtDate(d); }

function computeWeekStart(resetDayName, refDateStr){
  const targetIdx = WEEKDAY_NAMES.indexOf(resetDayName);
  const d = dateObj(refDateStr);
  const diff = (d.getDay() - targetIdx + 7) % 7;
  d.setDate(d.getDate() - diff);
  return fmtDate(d);
}

// ---------------------------------------------------------------
// Timetable structure helpers
// ---------------------------------------------------------------
function bandOf(cls){
  if (cls.startsWith('6')) return 'G6';
  if (cls.startsWith('7')) return 'G7';
  return 'G8-10';
}
function dayTypeOf(weekday){ return SCHOOL_DATA.DAY_TYPE[weekday]; }
function templateKeyOf(cls, weekday){
  const band = bandOf(cls), dt = dayTypeOf(weekday);
  if (dt === 'Fri') return band === 'G8-10' ? 'G8-10_Fri' : 'G67_Fri';
  return `${band}_MonThu`;
}
function templateOf(cls, weekday){
  return SCHOOL_DATA.PERIOD_TEMPLATES[templateKeyOf(cls, weekday)];
}
function classEntriesFor(cls, weekday){
  const base = ((SCHOOL_DATA.CLASS_SCHEDULE[cls] || {})[weekday]) || [];
  const rem = (SCHOOL_DATA.PENDING_SLOTS || [])
    .filter(p => p.class === cls && p.weekday === weekday)
    .map(p => activeRemEntry(p))
    .filter(Boolean);
  return base.concat(rem);
}
function teacherSlot(teacher, weekday, slot){
  const sched = SCHOOL_DATA.TEACHER_SCHEDULE[teacher];
  const base = sched ? sched[weekday][slot-1] : null; // null | {type:'rem'} | {type:'class',...}
  if (base) return base;
  // also busy if actively covering a remedial slot at this weekday/slot
  const remHit = (SCHOOL_DATA.PENDING_SLOTS || []).find(p => {
    if (p.weekday !== weekday || p.slot !== slot) return false;
    const r = remCache[remKey(p)];
    return r && r.active && r.teacher === teacher;
  });
  return remHit ? { type:'class', class: remHit.class, group:null, note:'Remedial' } : null;
}

// ---------------------------------------------------------------
// Remedial (REM) slot helpers — pending periods with no teacher
// hired yet. Off by default; admin flips on + assigns once filled.
// ---------------------------------------------------------------
function remKey(p){ return `${p.class}|${p.weekday}|${p.slot}`; }
function activeRemEntry(p){
  const r = remCache[remKey(p)];
  if (!r || !r.active || !r.teacher) return null;
  return { slot: p.slot, teacher: r.teacher, group: null, note: 'Remedial' };
}
function remUnitsFor(teacher){
  return (SCHOOL_DATA.PENDING_SLOTS || []).filter(p => {
    const r = remCache[remKey(p)];
    return r && r.active && r.teacher === teacher;
  }).length;
}
function totalDefaultUnits(teacher){
  return SCHOOL_DATA.TEACHER_META[teacher].defaultUnits + remUnitsFor(teacher);
}

// ---------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------
function findActiveFixture(cls, weekday, slot, group, dateStr){
  return fixturesCache.find(f =>
    f.class === cls && f.weekday === weekday && f.slot === slot &&
    (f.group || null) === (group || null) &&
    dateStr >= f.startDate && dateStr <= f.endDate
  );
}
// Is this teacher already committed as a SUBSTITUTE somewhere else at this weekday+slot,
// for any date overlapping dateStr's week? We only need to block the exact date.
function teacherHasFixtureAt(teacher, weekday, slot, dateStr){
  return fixturesCache.some(f =>
    f.subTeacher === teacher && f.weekday === weekday && f.slot === slot &&
    dateStr >= f.startDate && dateStr <= f.endDate
  );
}

function fixtureOccursInWeek(fixture, weekStart){
  const dayIdx = WEEKDAY_NAMES.indexOf(fixture.weekday);
  const weekStartIdx = WEEKDAY_NAMES.indexOf(weekdayNameOf(weekStart));
  const offset = (dayIdx - weekStartIdx + 7) % 7;
  const occurrence = addDays(weekStart, offset);
  return occurrence >= fixture.startDate && occurrence <= fixture.endDate;
}

function fixtureUnitsThisWeekFor(teacher, weekStart){
  return fixturesCache.filter(f => f.subTeacher === teacher && fixtureOccursInWeek(f, weekStart)).length;
}

// ---------------------------------------------------------------
// Free teacher list for a given class/weekday/slot/date
// ---------------------------------------------------------------
function teachersOfClass(cls){
  const set = new Set();
  for (const wd of SCHOOL_DAYS) {
    classEntriesFor(cls, wd).forEach(e => set.add(e.teacher));
  }
  return set;
}

function freeTeachersFor(cls, weekday, slot, dateStr, originalTeacher){
  const weekStart = computeWeekStart(settingsCache.resetDay, dateStr);
  const alreadyTeachesClass = teachersOfClass(cls);
  const list = [];
  for (const teacher of Object.keys(SCHOOL_DATA.TEACHER_SCHEDULE)) {
    if (teacher === originalTeacher) continue;
    const cell = teacherSlot(teacher, weekday, slot);
    if (cell) continue; // busy with their own class, REM duty, or a covering assignment
    if (teacherHasFixtureAt(teacher, weekday, slot, dateStr)) continue; // already covering elsewhere
    const total = totalDefaultUnits(teacher) + fixtureUnitsThisWeekFor(teacher, weekStart);
    list.push({ teacher, total, teachesClass: alreadyTeachesClass.has(teacher) });
  }
  // teachers already familiar with this class come first; within each group, lightest load first
  list.sort((a,b) => (b.teachesClass - a.teachesClass) || (a.total - b.total) || a.teacher.localeCompare(b.teacher));
  return list;
}

// ===================================================================
// UI: Tabs
// ===================================================================
document.getElementById('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('main .panel').forEach(p => p.classList.add('hidden'));
  document.getElementById(`tab-${btn.dataset.tab}`).classList.remove('hidden');
  if (btn.dataset.tab === 'units') renderUnitsTable();
  if (btn.dataset.tab === 'fixture') renderFixtureList();
  if (btn.dataset.tab === 'remedial') renderRemedialBoard();
});

// ===================================================================
// UI: Timetables tab
// ===================================================================
function populateClassSelects(){
  const opts = SCHOOL_DATA.CLASSES.map(c => `<option value="${c}">${c}</option>`).join('');
  document.getElementById('classSelect').innerHTML = opts;
  document.getElementById('fxClass').innerHTML = opts;
}

function renderTimetable(){
  const cls = document.getElementById('classSelect').value;
  const viewDateStr = document.getElementById('viewDate').value || todayStr();
  const container = document.getElementById('timetableGrid');

  let html = '<table class="tt"><thead><tr><th>Day</th>';
  for (let s=1; s<=8; s++) html += `<th>P${s}</th>`;
  html += '</tr></thead><tbody>';

  for (const wd of SCHOOL_DAYS) {
    const tmpl = templateOf(cls, wd);
    const entries = classEntriesFor(cls, wd);
    const bySlot = {};
    entries.forEach(e => { (bySlot[e.slot] = bySlot[e.slot] || []).push(e); });

    html += `<tr><td class="daycell">${wd}</td>`;
    for (let s=1; s<=8; s++) {
      const tinfo = tmpl[s-1];
      const list = bySlot[s];
      if (list) {
        // Real data always wins — even if the assumed grade-band template
        // says this slot is a break/n-a, a scheduled class here means the
        // source timetable has this teacher's row on a slightly different
        // clock alignment than this class's usual template. Show it with
        // a flag rather than silently dropping it. (See README — this
        // affects exactly one period school-wide as of the source file.)
        const uncertain = !tinfo || tinfo.type !== 'period';
        let cell = `<span class="period-time">${uncertain ? (tinfo && tinfo.time ? tinfo.time+' ⚠' : 'time uncertain ⚠') : tinfo.time}</span>`;
        list.forEach(e => {
          const fx = findActiveFixture(cls, wd, s, e.group, viewDateStr);
          if (fx) {
            cell += `<span class="period-teacher">${fx.subTeacher}</span><span class="sub-badge">SUB for ${e.teacher}</span>`;
          } else {
            cell += `<span class="period-teacher">${e.teacher}${e.group ? ' ('+e.group+')' : ''}</span>`;
          }
          if (e.note) cell += `<span class="note-tag">${e.note}</span>`;
        });
        html += `<td${uncertain ? ' title="Slot timing uncertain — check README"' : ''}>${cell}</td>`;
        continue;
      }
      if (!tinfo || tinfo.type === 'na') { html += '<td class="empty">—</td>'; continue; }
      if (tinfo.type === 'break') { html += `<td class="break">BREAK<br>${tinfo.time}</td>`; continue; }
      html += `<td class="empty"><span class="period-time">${tinfo.time}</span>free</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  container.innerHTML = html;
}

async function saveFixtureDoc(fixture){
  if (!db) {
    const doc = { id: 'local-'+Date.now()+'-'+Math.random().toString(36).slice(2,7), ...fixture };
    fixturesCache.push(doc);
    return doc;
  }
  const ref = await db.collection('fixtures').add(fixture);
  const doc = { id: ref.id, ...fixture };
  fixturesCache.push(doc);
  return doc;
}

// ---------------------------------------------------------------
// Absence mode: mark a teacher absent, auto-surface every period
// of theirs (any class) that falls in the window and needs a sub.
// ---------------------------------------------------------------
function computeAbsencePeriods(teacher, startDate, days){
  const results = [];
  for (let i=0; i<days; i++){
    const date = addDays(startDate, i);
    const weekday = weekdayNameOf(date);
    if (!SCHOOL_DAYS.includes(weekday)) continue;
    const sched = SCHOOL_DATA.TEACHER_SCHEDULE[teacher][weekday];
    for (let s=1; s<=8; s++){
      const cell = sched[s-1];
      if (cell && cell.type === 'class') {
        results.push({ date, weekday, slot: s, class: cell.class, group: cell.group, note: cell.note });
      }
    }
  }
  return results;
}

function populateAbsTeacherSelect(){
  const names = Object.keys(SCHOOL_DATA.TEACHER_SCHEDULE).sort();
  document.getElementById('absTeacher').innerHTML = names.map(t => `<option value="${t}">${t}</option>`).join('');
}

function renderAbsenceBoard(){
  const teacher = document.getElementById('absTeacher').value;
  const startDate = document.getElementById('absDate').value || todayStr();
  const days = Math.max(1, parseInt(document.getElementById('absDays').value, 10) || 1);
  const endDate = addDays(startDate, days - 1);

  document.getElementById('absDueBox').innerHTML =
    `<b>${teacher}</b> out ${startDate} → ${endDate} (back on ${addDays(endDate, 1)}).`;

  const periods = computeAbsencePeriods(teacher, startDate, days);
  const board = document.getElementById('absenceBoard');
  if (periods.length === 0) {
    board.innerHTML = '<div class="empty-note">No scheduled periods for this teacher in that window.</div>';
    return;
  }

  const byDate = {};
  periods.forEach(p => { (byDate[p.date] = byDate[p.date] || []).push(p); });

  let coveredCount = 0;
  let html = '';
  Object.keys(byDate).sort().forEach(date => {
    const weekday = weekdayNameOf(date);
    html += `<div class="absence-day-group"><div class="absence-day-label">${weekday} · ${date}</div>`;
    byDate[date].sort((a,b) => a.slot - b.slot).forEach(p => {
      const tmpl = templateOf(p.class, weekday);
      const tinfo = tmpl[p.slot - 1];
      const time = (tinfo && tinfo.time) ? tinfo.time : 'time uncertain ⚠';
      const existingFx = findActiveFixture(p.class, weekday, p.slot, p.group, date);
      html += `<div class="absence-row" data-date="${date}" data-weekday="${weekday}" data-class="${p.class}" data-slot="${p.slot}" data-group="${p.group||''}" data-original="${teacher}">`;
      html += `<span class="ar-class">${p.class}</span><span class="ar-time">P${p.slot} · ${time}</span>`;
      if (existingFx) {
        coveredCount++;
        html += `<span class="covered-tag">COVERED by ${existingFx.subTeacher}</span>`;
        html += `<button class="assign-btn remove-cov" data-id="${existingFx.id}">UNDO</button>`;
      } else {
        const free = freeTeachersFor(p.class, weekday, p.slot, date, teacher);
        if (free.length === 0) {
          html += `<span class="note-tag">No free teacher found</span>`;
        } else {
          html += `<select class="abs-sub-select">${free.map(f => `<option value="${f.teacher}">${f.teachesClass ? '★ ' : ''}${f.teacher} — ${f.total}u</option>`).join('')}</select>`;
          html += `<button class="assign-btn do-assign">ASSIGN</button>`;
        }
      }
      html += `</div>`;
    });
    html += `</div>`;
  });

  board.innerHTML = `<div class="absence-summary">${coveredCount} / ${periods.length} periods covered</div>` + html;

  board.querySelectorAll('button.do-assign').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.absence-row');
      const select = row.querySelector('.abs-sub-select');
      const subTeacher = select.value;
      const date = row.dataset.date, weekday = row.dataset.weekday, cls = row.dataset.class;
      const slot = parseInt(row.dataset.slot, 10), group = row.dataset.group || null;
      await saveFixtureDoc({
        class: cls, weekday, slot, group,
        originalTeacher: row.dataset.original, subTeacher,
        startDate: date, days: 1, endDate: date,
        createdAt: Date.now()
      });
      renderAbsenceBoard();
      renderFixtureList();
      renderTimetable();
    });
  });
  board.querySelectorAll('button.remove-cov').forEach(btn => {
    btn.addEventListener('click', async () => {
      await removeFixture(btn.dataset.id);
      renderAbsenceBoard();
    });
  });
}

function setupModeToggle(){
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.mode;
      document.getElementById('mode-absent').classList.toggle('hidden', mode !== 'absent');
      document.getElementById('absenceBoard').classList.toggle('hidden', mode !== 'absent');
      document.getElementById('mode-single').classList.toggle('hidden', mode !== 'single');
      document.getElementById('mode-switch').classList.toggle('hidden', mode !== 'switch');
    });
  });
}

// ===================================================================
// UI: Set Fixture tab — single period mode
// ===================================================================
function populateFxSlots(){
  const cls = document.getElementById('fxClass').value;
  const dateStr = document.getElementById('fxDate').value || todayStr();
  const weekday = weekdayNameOf(dateStr);
  const slotSel = document.getElementById('fxSlot');

  if (!SCHOOL_DAYS.includes(weekday)) {
    slotSel.innerHTML = '<option value="">No school that day</option>';
    updateFxOriginalAndSubs();
    return;
  }
  const entries = classEntriesFor(cls, weekday).slice().sort((a,b)=>a.slot-b.slot);
  const tmpl = templateOf(cls, weekday);
  if (entries.length === 0) {
    slotSel.innerHTML = '<option value="">No periods found for this class/day</option>';
  } else {
    slotSel.innerHTML = entries.map(e => {
      const t = tmpl[e.slot-1];
      const groupLabel = e.group ? ` — ${e.group} group` : '';
      return `<option value="${e.slot}|${e.group||''}">P${e.slot} (${t.time}) — ${e.teacher}${groupLabel}</option>`;
    }).join('');
  }
  updateFxOriginalAndSubs();
}

function updateFxOriginalAndSubs(){
  const cls = document.getElementById('fxClass').value;
  const dateStr = document.getElementById('fxDate').value || todayStr();
  const weekday = weekdayNameOf(dateStr);
  const slotVal = document.getElementById('fxSlot').value;
  const originalBox = document.getElementById('fxOriginal');
  const subSel = document.getElementById('fxSub');

  if (!slotVal) {
    originalBox.textContent = 'No period selected.';
    subSel.innerHTML = '';
    return;
  }
  const [slotStr, group] = slotVal.split('|');
  const slot = parseInt(slotStr, 10);
  const entries = classEntriesFor(cls, weekday);
  const entry = entries.find(e => e.slot === slot && (e.group||'') === group);
  if (!entry) { originalBox.textContent = 'Could not find that period.'; subSel.innerHTML=''; return; }

  const existingFx = findActiveFixture(cls, weekday, slot, group || null, dateStr);
  originalBox.innerHTML = existingFx
    ? `Regular teacher: <b>${entry.teacher}</b> — currently covered by <b>${existingFx.subTeacher}</b> until ${existingFx.endDate}.`
    : `Regular teacher: <b>${entry.teacher}</b> — no fixture set for this date.`;

  const free = freeTeachersFor(cls, weekday, slot, dateStr, entry.teacher);
  if (free.length === 0) {
    subSel.innerHTML = '<option value="">No free teachers found at this time</option>';
  } else {
    subSel.innerHTML = free.map(f => `<option value="${f.teacher}">${f.teachesClass ? '★ ' : ''}${f.teacher} — ${f.total} units this week</option>`).join('');
  }
}

async function assignFixture(){
  const cls = document.getElementById('fxClass').value;
  const dateStr = document.getElementById('fxDate').value || todayStr();
  const weekday = weekdayNameOf(dateStr);
  const slotVal = document.getElementById('fxSlot').value;
  const days = Math.max(1, parseInt(document.getElementById('fxDays').value, 10) || 1);
  const subTeacher = document.getElementById('fxSub').value;
  const msg = document.getElementById('fxMsg');

  if (!slotVal || !subTeacher) { msg.textContent = 'Pick a period and a covering teacher.'; msg.className='fx-msg err'; return; }
  const [slotStr, group] = slotVal.split('|');
  const slot = parseInt(slotStr, 10);
  const entries = classEntriesFor(cls, weekday);
  const entry = entries.find(e => e.slot === slot && (e.group||'') === group);
  const endDate = addDays(dateStr, days - 1);

  try {
    await saveFixtureDoc({
      class: cls, weekday, slot, group: group || null,
      originalTeacher: entry.teacher, subTeacher,
      startDate: dateStr, days, endDate,
      createdAt: Date.now()
    });
    msg.textContent = `Assigned ${subTeacher} to cover ${cls} P${slot} on ${weekday}s, ${dateStr} → ${endDate}.`;
    msg.className = 'fx-msg ok';
    renderFixtureList(); renderTimetable(); populateFxSlots();
  } catch (err) {
    console.error(err);
    msg.textContent = 'Could not save fixture — check your Firebase config / rules.';
    msg.className = 'fx-msg err';
  }
}

async function removeFixture(id){
  fixturesCache = fixturesCache.filter(f => f.id !== id);
  renderFixtureList(); renderTimetable(); populateFxSlots();
  if (db && !id.startsWith('local-')) {
    try { await db.collection('fixtures').doc(id).delete(); }
    catch (err) { console.error(err); }
  }
}

function renderFixtureList(){
  const container = document.getElementById('fixtureList');
  const today = todayStr();
  const upcoming = fixturesCache.filter(f => f.endDate >= today).sort((a,b)=>a.startDate.localeCompare(b.startDate));
  if (upcoming.length === 0) {
    container.innerHTML = '<div class="empty-note">No active or upcoming fixtures.</div>';
    return;
  }

  const singles = upcoming.filter(f => !f.switchId);
  const switchGroups = {};
  upcoming.filter(f => f.switchId).forEach(f => (switchGroups[f.switchId] = switchGroups[f.switchId] || []).push(f));

  let html = singles.map(f => `
    <div class="fixture-row">
      <span class="fx-class">${f.class}</span>
      <span>P${f.slot} · ${f.weekday}${f.group ? ' · '+f.group+' group' : ''}</span>
      <span>${f.originalTeacher}</span><span class="fx-arrow">→</span><span><b>${f.subTeacher}</b></span>
      <span class="fx-range">${f.startDate} → ${f.endDate}</span>
      <button data-id="${f.id}">REMOVE</button>
    </div>
  `).join('');

  html += Object.entries(switchGroups).map(([switchId, pair]) => `
    <div class="fixture-row">
      <span class="fx-class">SWITCH</span>
      <span>${pair.map(f => `${f.class} P${f.slot} (${f.weekday}): ${f.originalTeacher} → ${f.subTeacher}`).join(' &nbsp;|&nbsp; ')}</span>
      <span class="fx-range">${pair[0].startDate} → ${pair[0].endDate}</span>
      <button data-switch-id="${switchId}">UNDO SWITCH</button>
    </div>
  `).join('');

  container.innerHTML = html;
  container.querySelectorAll('button[data-id]').forEach(b => {
    b.addEventListener('click', () => removeFixture(b.dataset.id));
  });
  container.querySelectorAll('button[data-switch-id]').forEach(b => {
    b.addEventListener('click', () => removeSwitch(b.dataset.switchId));
  });
}

// ===================================================================
// UI: Weekly Units tab
// ===================================================================
function renderUnitsTable(){
  document.getElementById('resetDay').value = settingsCache.resetDay;
  document.getElementById('resetTime').value = settingsCache.resetTime;
  const weekStart = computeWeekStart(settingsCache.resetDay, todayStr());
  const weekEnd = addDays(weekStart, 6);
  document.getElementById('weekWindow').textContent = `Current week: ${weekStart} → ${weekEnd}`;

  const rows = Object.keys(SCHOOL_DATA.TEACHER_META).map(t => {
    const def = SCHOOL_DATA.TEACHER_META[t].defaultUnits;
    const rem = remUnitsFor(t);
    const fx = fixtureUnitsThisWeekFor(t, weekStart);
    return { teacher: t, def, rem, fx, total: def + rem + fx };
  }).sort((a,b) => b.total - a.total);

  document.getElementById('unitsBody').innerHTML = rows.map((r,i) => `
    <tr><td>${i+1}</td><td>${r.teacher}</td><td>${r.def}${r.rem ? ' + '+r.rem+' rem' : ''}</td><td>${r.fx}</td><td class="total">${r.total}</td></tr>
  `).join('');
}

async function saveResetSettings(){
  settingsCache.resetDay = document.getElementById('resetDay').value;
  settingsCache.resetTime = document.getElementById('resetTime').value;
  if (db) {
    try { await db.collection('config').doc('settings').set(settingsCache); }
    catch (err) { console.error(err); }
  }
  renderUnitsTable();
}

// ===================================================================
// UI: Remedial tab
// ===================================================================
async function saveRemStatus(cls, weekday, slot, active, teacher){
  const key = remKey({class:cls, weekday, slot});
  remCache[key] = { active, teacher: teacher || null };
  if (db) {
    try {
      await db.collection('remStatus').doc(key.replace(/\|/g,'_')).set({
        class: cls, weekday, slot, active, teacher: teacher || null
      });
    } catch (err) { console.error(err); }
  }
}

function renderRemedialBoard(){
  const board = document.getElementById('remedialBoard');
  const pending = SCHOOL_DATA.PENDING_SLOTS || [];
  if (pending.length === 0) {
    board.innerHTML = '<div class="empty-note">No remedial (REM) slots found in the source timetable.</div>';
    return;
  }
  const byClass = {};
  pending.forEach(p => { (byClass[p.class] = byClass[p.class] || []).push(p); });

  let html = '';
  Object.keys(byClass).sort().forEach(cls => {
    html += `<div class="rem-class-group"><div class="rem-class-label">${cls}</div>`;
    byClass[cls].sort((a,b) => WEEKDAY_NAMES.indexOf(a.weekday) - WEEKDAY_NAMES.indexOf(b.weekday) || a.slot - b.slot)
      .forEach(p => {
        const tmpl = templateOf(p.class, p.weekday);
        const tinfo = tmpl[p.slot - 1];
        const time = (tinfo && tinfo.time) ? tinfo.time : 'time uncertain ⚠';
        const key = remKey(p);
        const r = remCache[key] || { active: false, teacher: '' };
        html += `<div class="rem-row" data-key="${key}" data-class="${p.class}" data-weekday="${p.weekday}" data-slot="${p.slot}">
          <span class="rr-time">${p.weekday} P${p.slot} · ${time}</span>
          <input type="checkbox" class="rem-toggle" ${r.active ? 'checked' : ''}>
          <input type="text" placeholder="Teacher once hired" value="${r.teacher || ''}">
          <span class="rem-status ${r.active ? 'on' : ''}">${r.active && r.teacher ? 'ACTIVE — counts toward ' + r.teacher + "'s units" : 'off — not counted, not blocking anyone'}</span>
          <button class="rem-save">SAVE</button>
        </div>`;
      });
    html += `</div>`;
  });
  board.innerHTML = html;

  board.querySelectorAll('.rem-row').forEach(row => {
    row.querySelector('.rem-save').addEventListener('click', async () => {
      const cls = row.dataset.class, weekday = row.dataset.weekday, slot = parseInt(row.dataset.slot, 10);
      const active = row.querySelector('.rem-toggle').checked;
      const teacher = row.querySelector('input[type=text]').value.trim();
      await saveRemStatus(cls, weekday, slot, active, teacher);
      renderRemedialBoard();
      renderTimetable();
      populateFxSlots();
    });
  });
}

// ===================================================================
// UI: Temp Switch mode — swap two teachers' periods for N days
// ===================================================================
function populateSwitchTeacherSelects(){
  const names = Object.keys(SCHOOL_DATA.TEACHER_SCHEDULE).sort();
  const opts = names.map(t => `<option value="${t}">${t}</option>`).join('');
  document.getElementById('swTeacherA').innerHTML = opts;
  document.getElementById('swTeacherB').innerHTML = opts;
}

function populateSwitchSlotSelect(teacherSelectId, slotSelectId){
  const teacher = document.getElementById(teacherSelectId).value;
  const dateStr = document.getElementById('swDate').value || todayStr();
  const weekday = weekdayNameOf(dateStr);
  const sel = document.getElementById(slotSelectId);
  if (!SCHOOL_DAYS.includes(weekday)) {
    sel.innerHTML = '<option value="">No school that day</option>';
    return;
  }
  const sched = SCHOOL_DATA.TEACHER_SCHEDULE[teacher];
  const options = [];
  for (let s=1; s<=8; s++){
    const cell = sched[weekday][s-1];
    if (cell && cell.type === 'class') {
      const tmpl = templateOf(cell.class, weekday);
      const t = tmpl[s-1];
      options.push(`<option value="${s}|${cell.group||''}">${cell.class} P${s} (${t && t.time ? t.time : '?'})</option>`);
    }
  }
  sel.innerHTML = options.length ? options.join('') : '<option value="">No periods that day</option>';
}

async function assignSwitch(){
  const dateStr = document.getElementById('swDate').value || todayStr();
  const weekday = weekdayNameOf(dateStr);
  const days = Math.max(1, parseInt(document.getElementById('swDays').value, 10) || 1);
  const endDate = addDays(dateStr, days - 1);
  const teacherA = document.getElementById('swTeacherA').value;
  const teacherB = document.getElementById('swTeacherB').value;
  const [slotAStr, groupA] = (document.getElementById('swSlotA').value || '').split('|');
  const [slotBStr, groupB] = (document.getElementById('swSlotB').value || '').split('|');
  const msg = document.getElementById('swMsg');

  if (!slotAStr || !slotBStr) { msg.textContent = 'Pick a period for both teachers.'; msg.className = 'fx-msg err'; return; }
  if (teacherA === teacherB) { msg.textContent = 'Pick two different teachers.'; msg.className = 'fx-msg err'; return; }

  const slotA = parseInt(slotAStr, 10), slotB = parseInt(slotBStr, 10);
  const cellA = SCHOOL_DATA.TEACHER_SCHEDULE[teacherA][weekday][slotA-1];
  const cellB = SCHOOL_DATA.TEACHER_SCHEDULE[teacherB][weekday][slotB-1];
  const switchId = 'sw-' + Date.now();

  try {
    await saveFixtureDoc({
      class: cellA.class, weekday, slot: slotA, group: groupA || null,
      originalTeacher: teacherA, subTeacher: teacherB,
      startDate: dateStr, days, endDate, switchId, createdAt: Date.now()
    });
    await saveFixtureDoc({
      class: cellB.class, weekday, slot: slotB, group: groupB || null,
      originalTeacher: teacherB, subTeacher: teacherA,
      startDate: dateStr, days, endDate, switchId, createdAt: Date.now()
    });
    msg.textContent = `Switched: ${teacherB} now covers ${cellA.class} P${slotA}, ${teacherA} now covers ${cellB.class} P${slotB}, ${dateStr} → ${endDate}.`;
    msg.className = 'fx-msg ok';
    renderFixtureList(); renderTimetable();
  } catch (err) {
    console.error(err);
    msg.textContent = 'Could not save the switch — check your Firebase config / rules.';
    msg.className = 'fx-msg err';
  }
}

async function removeSwitch(switchId){
  const toRemove = fixturesCache.filter(f => f.switchId === switchId);
  fixturesCache = fixturesCache.filter(f => f.switchId !== switchId);
  renderFixtureList(); renderTimetable(); populateFxSlots();
  if (db) {
    for (const f of toRemove) {
      if (!f.id.startsWith('local-')) {
        try { await db.collection('fixtures').doc(f.id).delete(); } catch (err) { console.error(err); }
      }
    }
  }
}

// ===================================================================
// Boot
// ===================================================================
async function loadFixturesFromFirestore(){
  if (!db) return;
  try {
    const snap = await db.collection('fixtures').get();
    fixturesCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn('Could not load fixtures from Firestore — continuing with an empty local list.', err);
  }
}
async function loadSettingsFromFirestore(){
  if (!db) return;
  try {
    const doc = await db.collection('config').doc('settings').get();
    if (doc.exists) settingsCache = { ...settingsCache, ...doc.data() };
  } catch (err) {
    console.warn('Could not load settings from Firestore — using defaults.', err);
  }
}
async function loadRemFromFirestore(){
  if (!db) return;
  try {
    const snap = await db.collection('remStatus').get();
    remCache = {};
    snap.docs.forEach(d => {
      const data = d.data();
      remCache[remKey({class:data.class, weekday:data.weekday, slot:data.slot})] = { active: data.active, teacher: data.teacher };
    });
  } catch (err) {
    console.warn('Could not load remedial-slot status from Firestore — starting with all off.', err);
  }
}

async function boot(){
  document.getElementById('todayChip').textContent = todayStr();
  document.getElementById('viewDate').value = todayStr();
  document.getElementById('fxDate').value = todayStr();
  document.getElementById('absDate').value = todayStr();
  document.getElementById('swDate').value = todayStr();

  try {
    initFirebase();
    await loadSettingsFromFirestore();
    await loadFixturesFromFirestore();
    await loadRemFromFirestore();
  } catch (err) {
    console.warn('Firebase setup failed entirely — continuing in local-only mode.', err);
  }

  populateClassSelects();
  populateAbsTeacherSelect();
  populateSwitchTeacherSelects();
  setupModeToggle();
  renderTimetable();
  populateFxSlots();
  renderAbsenceBoard();
  populateSwitchSlotSelect('swTeacherA', 'swSlotA');
  populateSwitchSlotSelect('swTeacherB', 'swSlotB');

  document.getElementById('classSelect').addEventListener('change', renderTimetable);
  document.getElementById('viewDate').addEventListener('change', renderTimetable);
  document.getElementById('fxClass').addEventListener('change', populateFxSlots);
  document.getElementById('fxDate').addEventListener('change', populateFxSlots);
  document.getElementById('fxSlot').addEventListener('change', updateFxOriginalAndSubs);
  document.getElementById('fxAssignBtn').addEventListener('click', assignFixture);
  document.getElementById('saveResetBtn').addEventListener('click', saveResetSettings);

  document.getElementById('absGenerateBtn').addEventListener('click', renderAbsenceBoard);
  document.getElementById('absTeacher').addEventListener('change', renderAbsenceBoard);
  document.getElementById('absDate').addEventListener('change', renderAbsenceBoard);
  document.getElementById('absDays').addEventListener('change', renderAbsenceBoard);

  document.getElementById('swDate').addEventListener('change', () => {
    populateSwitchSlotSelect('swTeacherA', 'swSlotA');
    populateSwitchSlotSelect('swTeacherB', 'swSlotB');
  });
  document.getElementById('swTeacherA').addEventListener('change', () => populateSwitchSlotSelect('swTeacherA', 'swSlotA'));
  document.getElementById('swTeacherB').addEventListener('change', () => populateSwitchSlotSelect('swTeacherB', 'swSlotB'));
  document.getElementById('swAssignBtn').addEventListener('click', assignSwitch);
}

boot();
