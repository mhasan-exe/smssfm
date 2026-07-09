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
let fixturesCache = [];      // all fixture docs {id, class, weekday, slot, group, originalTeacher, subTeacher, startDate, days, endDate}
let settingsCache = { resetDay: 'Monday', resetTime: '00:00' };

// ---------------------------------------------------------------
// Firebase init
// ---------------------------------------------------------------
function initFirebase(){
  if (typeof firebaseConfig === 'undefined' || !firebaseConfig.apiKey) {
    console.warn('firebase-config.js is not filled in yet — running in local-only preview mode.');
    return false;
  }
  firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
  return true;
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
  return ((SCHOOL_DATA.CLASS_SCHEDULE[cls] || {})[weekday]) || [];
}
function teacherSlot(teacher, weekday, slot){
  const sched = SCHOOL_DATA.TEACHER_SCHEDULE[teacher];
  if (!sched) return null;
  return sched[weekday][slot-1]; // null | {type:'rem'} | {type:'class',...}
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
function freeTeachersFor(cls, weekday, slot, dateStr, originalTeacher){
  const weekStart = computeWeekStart(settingsCache.resetDay, dateStr);
  const list = [];
  for (const teacher of Object.keys(SCHOOL_DATA.TEACHER_SCHEDULE)) {
    if (teacher === originalTeacher) continue;
    const cell = teacherSlot(teacher, weekday, slot);
    if (cell) continue; // busy with their own class or REM
    if (teacherHasFixtureAt(teacher, weekday, slot, dateStr)) continue; // already covering elsewhere
    const defaultUnits = SCHOOL_DATA.TEACHER_META[teacher].defaultUnits;
    const fxUnits = fixtureUnitsThisWeekFor(teacher, weekStart);
    list.push({ teacher, total: defaultUnits + fxUnits });
  }
  list.sort((a,b) => a.total - b.total || a.teacher.localeCompare(b.teacher));
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

// ===================================================================
// UI: Set Fixture tab
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
    subSel.innerHTML = free.map(f => `<option value="${f.teacher}">${f.teacher} — ${f.total} units this week</option>`).join('');
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

  const fixture = {
    class: cls, weekday, slot, group: group || null,
    originalTeacher: entry.teacher, subTeacher,
    startDate: dateStr, days, endDate,
    createdAt: Date.now()
  };

  if (!db) {
    fixturesCache.push({ id: 'local-'+Date.now(), ...fixture });
    msg.textContent = 'Saved locally (Firebase not configured yet — fill in firebase-config.js to persist for real).';
    msg.className = 'fx-msg ok';
    renderFixtureList(); renderTimetable(); populateFxSlots();
    return;
  }

  try {
    const ref = await db.collection('fixtures').add(fixture);
    fixturesCache.push({ id: ref.id, ...fixture });
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
  container.innerHTML = upcoming.map(f => `
    <div class="fixture-row">
      <span class="fx-class">${f.class}</span>
      <span>P${f.slot} · ${f.weekday}${f.group ? ' · '+f.group+' group' : ''}</span>
      <span>${f.originalTeacher}</span><span class="fx-arrow">→</span><span><b>${f.subTeacher}</b></span>
      <span class="fx-range">${f.startDate} → ${f.endDate}</span>
      <button data-id="${f.id}">REMOVE</button>
    </div>
  `).join('');
  container.querySelectorAll('button[data-id]').forEach(b => {
    b.addEventListener('click', () => removeFixture(b.dataset.id));
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
    const fx = fixtureUnitsThisWeekFor(t, weekStart);
    return { teacher: t, def, fx, total: def + fx };
  }).sort((a,b) => b.total - a.total);

  document.getElementById('unitsBody').innerHTML = rows.map((r,i) => `
    <tr><td>${i+1}</td><td>${r.teacher}</td><td>${r.def}</td><td>${r.fx}</td><td class="total">${r.total}</td></tr>
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
// Boot
// ===================================================================
async function loadFixturesFromFirestore(){
  if (!db) return;
  const snap = await db.collection('fixtures').get();
  fixturesCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function loadSettingsFromFirestore(){
  if (!db) return;
  const doc = await db.collection('config').doc('settings').get();
  if (doc.exists) settingsCache = { ...settingsCache, ...doc.data() };
}

async function boot(){
  document.getElementById('todayChip').textContent = todayStr();
  document.getElementById('viewDate').value = todayStr();
  document.getElementById('fxDate').value = todayStr();

  initFirebase();
  await loadSettingsFromFirestore();
  await loadFixturesFromFirestore();

  populateClassSelects();
  renderTimetable();
  populateFxSlots();

  document.getElementById('classSelect').addEventListener('change', renderTimetable);
  document.getElementById('viewDate').addEventListener('change', renderTimetable);
  document.getElementById('fxClass').addEventListener('change', populateFxSlots);
  document.getElementById('fxDate').addEventListener('change', populateFxSlots);
  document.getElementById('fxSlot').addEventListener('change', updateFxOriginalAndSubs);
  document.getElementById('fxAssignBtn').addEventListener('click', assignFixture);
  document.getElementById('saveResetBtn').addEventListener('click', saveResetSettings);
}

boot();
