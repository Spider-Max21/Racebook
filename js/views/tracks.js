/* Racebook – Seite „Strecken“: Besuche, Lieblingsstrecken und Bestzeiten (ab 1.13.0, Roadmap 8). Berechnung in ../tracks.js.
   - Übersicht aller Strecken aus den vorhandenen Fahrten (und Setups/Bestzeiten), Filter „Lieblingsstrecken“ und Sortierung je
     Gerät (localStorage, keine Eingabe, data-nodirty). Antippen öffnet die Strecke (#/strecken/<Name>).
   - Lieblingsstrecke: nur ausdrücklich über den Stern. Gespeichert in den Verwaltungsdaten (meta 'tracks') mit Prüfung gegen den
     gespeicherten Stand; eine Änderung aus einem anderen Fenster wird nicht überschrieben (nur diese eine Strecke wird gesetzt).
   - Bestzeit: von Hand mit Strecke, Variante, Motorrad, Datum und Zeit; gespeichert am Motorrad (bike.laps) wie Zubehör und
     Teilehistorie, mit Bestandskennung und Prüfung gegen den gespeicherten Stand. Bearbeiten und Löschen nur, was angezeigt war.
     Bestzeit je Variante nach T.lapBest: unabhängig von der Reihenfolge im Speicher; bei unterschiedlich genauen, nicht sicher
     vergleichbaren Zeiten „mögliche Bestzeit“ mit Hinweis „nicht eindeutig“, keine bevorzugt.
   Keine Rundenmessung, kein GPS, keine Fitnessdaten, kein Import. */
import {S, bikeList, lsJSON, lsSet} from '../state.js';
import {$, $$, toast, errText, arm, VErr, icon} from '../ui.js';
import {esc, str, uid, canon, clone, fmt, fmtDate, todayISO, isISO} from '../util.js';
import {canonDoc} from '../domain.js';
import * as T from '../tracks.js';
import * as DB from '../db.js';
import * as store from '../store.js';
import {opFor, parkOp, execOp, flow} from '../ops.js';
import * as drafts from '../drafts.js';
import {R} from '../registry.js';

const nu = v => v === undefined ? null : v;
const titleOf = b => b ? (b.nickname || ((b.brand || '') + ' ' + (b.model || '')).trim() || 'Motorrad') : 'Motorrad';
const lapsOf = raw => raw && Array.isArray(raw.laps) ? raw.laps : [];
const lapOf = (raw, id) => lapsOf(raw).find(l => l.id === id) || null;
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const unitAmount = (v, u) => fmt(v, 2) + ' ' + u;

/* ---------- Lieblingsstrecken laden (beim Start und nach Änderungen, auch aus anderen Fenstern) ---------- */
export async function refreshFav(){ if (DB.isOpen()) S.tracks = (await DB.getMeta('tracks')) || null; }
const data = () => ({bikes: S.bikes, rides: S.rides, setups: S.setups, fav: S.tracks || null});

/* ---------- Anzeige ---------- */
function choice(){
  const c = Object.assign({filter: 'all', sort: 'last'}, lsJSON('strecken', {}) || {});
  if (!['all', 'fav'].includes(c.filter)) c.filter = 'all';
  if (!['last', 'name', 'visits'].includes(c.sort)) c.sort = 'last';
  return c;
}
const setHTML = (el, html) => { if (el && el.innerHTML !== html) el.innerHTML = html; };
/* Die Liste wird bei jeder Änderung neu gezeichnet (auch aus anderen Fenstern): ein Knopf darin behält dabei den Fokus */
function keepFocus(box, fn){
  const a = document.activeElement, inside = a && box.contains(a);
  const keys = ['trackfav', 'track', 'lapedit', 'lapdel'];
  const k = inside ? keys.find(x => a.dataset[x] != null) : null;
  const sel = k ? '[data-' + k + '="' + CSS.escape(a.dataset[k]) + '"]' : '';
  fn();
  if (!inside) return;
  const el = sel ? box.querySelector(sel) : null;
  if (el) el.focus(); else { const h = $('#tracksTitle'); if (h) h.focus(); }
}
export function renderTracks(){
  const out = $('#trackOut'); if (!out) return;
  const key = R.route.track || '';
  const list = T.trackList(data());
  $('#trackCtl').hidden = !!key;
  const f = S.lapForm;
  if (f && !$('#lapForm')) renderForm();
  const lapAdd = $('#lapAdd'); if (lapAdd) lapAdd.hidden = !bikeList().length;
  if (key) { keepFocus(out, () => setHTML(out, detailHTML(list.find(t => t.key === key), key))); return; }
  const c = choice();
  const set = (id, v) => { const el = $('#' + id); if (el && document.activeElement !== el && el.value !== v) el.value = v; };
  set('trFilter', c.filter); set('trSort', c.sort);
  keepFocus(out, () => setHTML(out, listHTML(list, c)));
}
function favBtn(t){
  return '<button class="mini fav-btn" type="button" data-trackfav="' + esc(t.key) + '" aria-pressed="' + (t.fav ? 'true' : 'false') + '" aria-label="' + esc((t.fav ? 'Lieblingsstrecke: ' : 'Als Lieblingsstrecke markieren: ') + t.name) + '">'
    + '<span aria-hidden="true">' + (t.fav ? '★' : '☆') + '</span><span>' + (t.fav ? 'Lieblingsstrecke' : 'Markieren') + '</span></button>';
}
/* Kurzfassung: Besuche, Trainingstage, Fahrten, Turns */
function countsText(t){
  const parts = [plural(t.visits.length, 'Besuch', 'Besuche'), plural(t.days, 'Trainingstag', 'Trainingstage'), plural(t.rides, 'Fahrt', 'Fahrten')];
  if (t.rides) parts.push(turnsText(t.turns));
  return parts.join(' · ');
}
function turnsText(x){
  if (!x.n) return 'Turns nicht angegeben';
  return plural(x.known, 'Turn', 'Turns') + (x.without ? ' (' + plural(x.without, 'Fahrt', 'Fahrten') + ' ohne Angabe)' : '');
}
/* Fahrzeit bzw. Strecke je Motorrad in seiner Einheit – Stunden und Kilometer nie zusammengezählt */
function amountText(t){
  const ids = Object.keys(t.byBike).sort((a, b) => titleOf(S.bikes[a]).localeCompare(titleOf(S.bikes[b]), 'de'));
  return ids.map(id => { const x = t.byBike[id]; return titleOf(S.bikes[id]) + ': ' + (x.n > x.without ? unitAmount(x.amount, x.unit) : 'ohne Angabe') + (x.without && x.n > x.without ? ' (' + plural(x.without, 'Fahrt', 'Fahrten') + ' ohne Angabe)' : ''); }).join(' · ');
}
/* Bestzeit je Variante; ist sie nicht eindeutig (unterschiedlich genaue Zeiten, siehe T.lapBest), stehen alle möglichen da */
function bestLine(t){
  const one = l => T.fmtLap(l.ms, l.dig) + ' (' + titleOf(S.bikes[l.bike]) + ', ' + fmtDate(l.date) + ')';
  const g = t.laps.groups.map(x => x.layout + ': ' + x.best.map(one).join(' oder ') + (x.best.length > 1 ? ', nicht eindeutig' : ''));
  if (t.laps.open.length) g.push(plural(t.laps.open.length, 'Zeit', 'Zeiten') + ' ohne Variante');
  return g.join(' · ');
}
function listHTML(list, c){
  if (!list.length) return '<div class="card"><p class="hint">Noch keine Strecken. Sobald du bei einer Fahrt die Strecke einträgst, erscheint sie hier.</p></div>';
  let xs = c.filter === 'fav' ? list.filter(t => t.fav) : list.slice();
  const byName = (a, b) => a.name.localeCompare(b.name, 'de');
  if (c.sort === 'name') xs.sort(byName);
  else if (c.sort === 'visits') xs.sort((a, b) => b.visits.length - a.visits.length || b.days - a.days || byName(a, b));
  else xs.sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : 0) || byName(a, b));
  if (!xs.length) return '<div class="card"><p class="hint" id="trackNone">Noch keine Lieblingsstrecke markiert. Markiere eine Strecke mit dem Stern; wie oft du dort warst, spielt dabei keine Rolle.</p></div>';
  return '<p class="hint" id="trackCount">' + plural(xs.length, 'Strecke', 'Strecken') + '</p><ul class="track-list" id="trackList2">' + xs.map(t => {
    const best = bestLine(t), amt = amountText(t);
    return '<li class="card track-card" data-trackrow="' + esc(t.key) + '"><div class="track-h"><button class="track-name" type="button" data-track="' + esc(t.key) + '">' + esc(t.name) + '</button>' + favBtn(t) + '</div>'
      + '<div class="track-counts">' + esc(countsText(t)) + '</div>'
      + (t.last ? '<div class="hint">zuletzt ' + esc(fmtDate(t.last)) + '</div>' : '<div class="hint">noch keine Fahrt eingetragen</div>')
      + (amt ? '<div class="hint">' + esc(amt) + '</div>' : '')
      + (best ? '<div class="track-best">' + icon('flag') + '<span>' + esc(best) + '</span></div>' : '')
      + '</li>';
  }).join('') + '</ul>';
}
function detailHTML(t, key){
  if (!t) return '<div class="card"><p class="hint" id="trackGone">Diese Strecke gibt es nicht mehr (zum Beispiel weil ihre Fahrten gelöscht wurden).</p><div class="row"><button class="btn" type="button" id="trackBack">Alle Strecken</button></div></div>';
  const amt = amountText(t);
  let h = '<div class="card stack" id="trackHead"><div class="track-h"><h2 id="trackTitle" tabindex="-1">' + esc(t.name) + '</h2>' + favBtn(t) + '</div>'
    + '<p class="track-counts" id="trackCounts">' + esc(countsText(t)) + '</p>'
    + (amt ? '<p class="hint" id="trackAmount">' + esc(amt) + '</p>' : '')
    + (t.setups ? '<p class="hint">' + esc(plural(t.setups, 'Setup', 'Setups')) + ' für diese Strecke unter „Setup“ beim jeweiligen Motorrad.</p>' : '')
    + '<div class="row"><button class="btn ghost" type="button" id="trackBack">Alle Strecken</button></div></div>';
  /* Bestzeiten je Variante */
  h += '<section class="card stack" id="trackLaps"><h3>Bestzeiten</h3>';
  if (!t.lapCount) h += '<p class="hint">Noch keine Bestzeit eingetragen.</p>';
  t.laps.groups.forEach(g => {
    const unclear = g.best.length > 1;
    h += '<div class="lap-group" data-layout="' + esc(g.key) + '"><h4>' + esc(g.layout) + '</h4>'
      + (unclear ? '<p class="hint lap-unclear">Die Bestzeit ist nicht eindeutig: Diese Zeiten sind unterschiedlich genau angegeben (zum Beispiel „52“ und „52,1“) und lassen sich nicht sicher vergleichen.</p>' : '')
      + '<ol class="lap-list">' + g.list.map(l => lapRow(l, g.best.includes(l) ? (unclear ? 'maybe' : 'best') : '')).join('') + '</ol></div>';
  });
  if (t.laps.open.length) h += '<div class="lap-group" data-layout=""><h4>Variante nicht angegeben</h4><p class="hint">Diese Zeiten werden nicht verglichen: Ohne Variante ist nicht sicher, dass es dieselbe Strecke war.</p><ul class="lap-list">' + t.laps.open.map(l => lapRow(l, false)).join('') + '</ul></div>';
  if (t.laps.groups.length > 1) h += '<p class="hint">Zeiten verschiedener Varianten werden nicht miteinander verglichen.</p>';
  h += '</section>';
  /* Besuche: zusammenhängende Trainingstage */
  h += '<section class="card stack" id="trackVisits"><h3>Besuche</h3>';
  if (!t.visits.length) h += '<p class="hint">Noch keine Fahrt auf dieser Strecke.</p>';
  else h += '<ul class="visit-list">' + t.visits.map(v => visitRow(t, v)).join('') + '</ul>';
  h += '</section>';
  return h;
}
/* best: 'best' = Bestzeit, 'maybe' = mögliche Bestzeit (nicht eindeutig), sonst '' */
function lapRow(l, best){
  const editing = S.lapForm && S.lapForm.mode === 'edit' && S.lapForm.id === l.id;
  return '<li class="lap-row' + (best ? ' best' : '') + '" data-lap="' + esc(l.id) + '"><div class="lap-h"><b class="lap-time">' + esc(T.fmtLap(l.ms, l.dig)) + '</b>' + (best === 'best' ? '<span class="tag">Bestzeit</span>' : best === 'maybe' ? '<span class="tag">mögliche Bestzeit</span>' : '') + (editing ? '<span class="tag">wird bearbeitet</span>' : '') + '</div>'
    + '<div class="hint">' + esc(titleOf(S.bikes[l.bike]) + ' · ' + fmtDate(l.date)) + '</div>' + (l.note ? '<div class="hint">' + esc(l.note) + '</div>' : '')
    + '<div class="row"><button class="mini" type="button" data-lapedit="' + esc(l.bike + '|' + l.id) + '" aria-label="' + esc('Bearbeiten: ' + T.fmtLap(l.ms, l.dig) + ', ' + fmtDate(l.date)) + '">Bearbeiten</button>'
    + '<button class="mini" type="button" data-lapdel="' + esc(l.bike + '|' + l.id) + '" data-arm="Wirklich löschen?" aria-label="' + esc('Löschen: ' + T.fmtLap(l.ms, l.dig) + ', ' + fmtDate(l.date)) + '">Löschen</button></div></li>';
}
function visitRow(t, v){
  const rs = S.rides.filter(r => S.bikes[r.bike] && T.trackKey(r.track) === t.key && r.date >= v.from && r.date <= v.to);
  const bikes = Array.from(new Set(rs.map(r => r.bike))).map(id => titleOf(S.bikes[id])).sort((a, b) => a.localeCompare(b, 'de'));
  const turnsKnown = rs.filter(r => r.turns).reduce((a, r) => a + r.turns, 0), without = rs.filter(r => !r.turns).length;
  const lay = Array.from(new Set(rs.map(r => T.nameOf(r.layout)).filter(Boolean)));
  const when = v.from === v.to ? fmtDate(v.from) : fmtDate(v.from) + ' – ' + fmtDate(v.to);
  const bits = [plural(v.days.length, 'Trainingstag', 'Trainingstage'), plural(rs.length, 'Fahrt', 'Fahrten'), turnsKnown ? plural(turnsKnown, 'Turn', 'Turns') + (without ? ' (' + plural(without, 'Fahrt', 'Fahrten') + ' ohne Angabe)' : '') : 'Turns nicht angegeben'];
  return '<li class="visit-row"><b>' + esc(when) + '</b><div class="hint">' + esc(bits.join(' · ')) + '</div><div class="hint">' + esc(bikes.join(', ') + (lay.length ? ' · Variante: ' + lay.join(', ') : '')) + '</div></li>';
}

/* ---------- Lieblingsstrecke markieren ---------- */
async function setFav(key, on){
  const t = T.trackList(data()).find(x => x.key === key); if (!t) return;
  const ep = S.epoch || '';
  for (let i = 0; i < 3; i++) {
    let cur;
    try { cur = (await DB.getMeta('tracks')) || null; } catch (e) { toast(errText(e) + ' Es wurde nichts geändert.'); return; }
    /* Testfall „anderes Fenster speichert dazwischen“: nach dem Lesen kurz warten (nur mit window.__T.favHoldMs) */
    const tt = typeof window !== 'undefined' && window.__T; if (tt && tt.favHoldMs) await new Promise(res => setTimeout(res, tt.favHoldMs));
    /* Höchstens MAX_FAV: auf dem gerade gelesenen Stand geprüft, also auch nach einer Änderung in einem anderen Fenster; nichts wird abgeschnitten */
    if (on && T.favFull(cur, t.name)) { S.tracks = cur; R.renderAll(); toast('Höchstens ' + T.MAX_FAV + ' Lieblingsstrecken. Nimm zuerst bei einer anderen Strecke den Stern weg. Es wurde nichts geändert.'); return; }
    const next = T.toggleFav(cur, t.name, on);
    if (canon(next) === canon(cur)) { S.tracks = cur; R.renderAll(); return; }
    const op = next ? {store: 'meta', type: 'put', value: next} : {store: 'meta', type: 'del', id: 'tracks'};
    try {
      await flow(() => DB.commit([op], {epoch: ep, bump: true, expectMeta: {k: 'tracks', value: cur}}));
      S.tracks = next; R.renderAll();
      toast(on ? '„' + t.name + '“ ist jetzt eine Lieblingsstrecke.' : '„' + t.name + '“ ist keine Lieblingsstrecke mehr.');
      return;
    } catch (e) {
      /* Inzwischen in einem anderen Fenster geändert: neu lesen und nur diese Strecke setzen */
      if (e && e.code === 'changed') continue;
      toast(errText(e) + ' Es wurde nichts geändert.'); await refreshFav().catch(() => {}); R.renderAll(); return;
    }
  }
  toast('Die Lieblingsstrecken ändern sich gerade laufend. Es wurde nichts geändert; versuch es gleich noch einmal.');
}

/* ---------- Bestzeit-Formular ---------- */
export const isOpen = () => !!S.lapForm;
export function close(){
  if (!S.lapForm) return;
  S.lapForm = null; drafts.forget('lap');
  const box = $('#lapBox'); if (box) box.innerHTML = '';
}
/* Öffnen erst im Rückruf von drafts.begin: Eintrag und Grundlage aus dem Speicher (nicht aus einem vorher gemerkten Objekt) */
function open(mode, bike, id){
  if (!bikeList().length) { toast('Leg zuerst ein Motorrad an.'); return; }
  let base = '', l = null;
  if (mode === 'edit') {
    const raw = store.peek('bikes', bike);
    l = raw ? lapOf(raw, id) : null;
    if (!l) { toast('Diese Bestzeit gibt es inzwischen nicht mehr.'); R.renderAll(); return; }
    base = canon(l);
  } else { id = 'z' + uid(); }
  const cur = R.route.track ? T.trackList(data()).find(t => t.key === R.route.track) : null;
  const pick = S.bikes[S.picked] ? S.picked : S.bikes[S.bike] ? S.bike : (bikeList()[0] || {}).id;
  S.lapForm = {mode, id, bike0: mode === 'edit' ? bike : '', epoch: S.epoch || '', base, msg: '', lastOp: null,
    init: l ? {track: l.track, layout: l.layout || '', bike, date: l.date, time: T.fmtLap(l.ms, l.dig), note: l.note || ''} : {track: cur ? cur.name : '', layout: '', bike: pick, date: todayISO(), time: '', note: ''}};
  renderForm();
  R.renderAll();
  drafts.mark('lap');
  const box = $('#lapBox'); if (box) box.scrollIntoView({block: 'nearest'});
  /* Fokus der Reihe nach: ohne Strecke dort, mit vorbelegter Strecke auf der Variante */
  const f = $(mode === 'edit' || !S.lapForm.init.track ? '#lapTrack' : '#lapLayout'); if (f) f.focus();
}
const fld = (id, label, input, full) => '<div class="f' + (full ? ' full' : '') + '"><label for="' + id + '">' + esc(label) + '</label>' + input + '</div>';
const inp = (id, val, extra) => '<input id="' + id + '" value="' + esc(val == null ? '' : val) + '"' + (extra || '') + '>';
function renderForm(){
  const h = S.lapForm, box = $('#lapBox'); if (!h || !box) return;
  const v = h.init;
  const names = T.trackList(data()).map(t => t.name).sort((a, b) => a.localeCompare(b, 'de'));
  box.innerHTML = '<form id="lapForm" class="card stack lap-form" novalidate><h3>' + (h.mode === 'edit' ? 'Bestzeit bearbeiten' : 'Bestzeit eintragen') + '</h3>'
    + (h.msg ? '<p class="warnbox" role="alert">' + esc(h.msg) + '</p>' : '')
    + '<div class="grid">'
    + fld('lapTrack', 'Strecke', inp('lapTrack', v.track, ' list="lapTracks" maxlength="' + T.TRACK_MAX + '" autocomplete="off" placeholder="z. B. MX-Park Gotha"') + '<datalist id="lapTracks">' + names.map(n => '<option value="' + esc(n) + '"></option>').join('') + '</datalist>', true)
    + fld('lapLayout', 'Variante (optional)', inp('lapLayout', v.layout, ' list="lapLayouts" maxlength="' + T.LAYOUT_MAX + '" autocomplete="off" placeholder="z. B. GP-Strecke, kurze Runde"') + '<datalist id="lapLayouts"></datalist>')
    + fld('lapBike', 'Motorrad', '<select id="lapBike">' + bikeList().map(b => '<option value="' + esc(b.id) + '"' + (b.id === v.bike ? ' selected' : '') + '>' + esc(titleOf(b)) + '</option>').join('') + '</select>')
    + fld('lapDate', 'Datum', '<input type="date" id="lapDate" value="' + esc(v.date || '') + '">')
    + fld('lapTime', 'Zeit', inp('lapTime', v.time, ' inputmode="decimal" autocomplete="off" placeholder="z. B. 1:52,34"'))
    + fld('lapNote', 'Notiz (optional)', '<textarea id="lapNote" maxlength="' + T.LAP_NOTE_MAX + '" rows="2" placeholder="z. B. trockene Strecke, neue Reifen">' + esc(v.note || '') + '</textarea>', true)
    + '</div><p class="hint">Von Hand eingetragen, ohne Rundenmessung. Verglichen werden nur Zeiten derselben Variante; ohne Variante wird eine Zeit nicht verglichen.</p>'
    + '<div class="row"><button class="btn primary" type="submit">Speichern</button><button class="btn ghost" type="button" id="lapCancel">Abbrechen</button></div></form>';
  updateLayouts();
}
function updateLayouts(){
  const el = $('#lapLayouts'), t = $('#lapTrack'); if (!el || !t) return;
  setHTML(el, T.layoutsOf(data(), t.value).map(x => '<option value="' + esc(x) + '"></option>').join(''));
}
/* Formularwerte erhalten, wenn das Formular neu gezeichnet werden muss (Hinweis nach einer Änderung in einem anderen Fenster) */
function keepValues(fn){
  const vals = {}; $$('#lapForm input, #lapForm textarea, #lapForm select').forEach(el => { vals[el.id] = el.value; });
  fn();
  Object.entries(vals).forEach(([id, v]) => { const el = document.getElementById(id); if (el) el.value = v; });
}
function readForm(){
  const val = id => { const el = $('#' + id); return el ? str(el.value) : ''; };
  const track = T.nameOf(val('lapTrack')).slice(0, T.TRACK_MAX), layout = T.nameOf(val('lapLayout')).slice(0, T.LAYOUT_MAX);
  if (!track) throw new VErr($('#lapTrack'), 'Gib die Strecke an.');
  const bike = val('lapBike');
  if (!S.bikes[bike]) throw new VErr($('#lapBike'), 'Wähle ein Motorrad.');
  const date = val('lapDate');
  if (!isISO(date)) throw new VErr($('#lapDate'), 'Datum: Bitte ein gültiges Datum wählen.');
  if (date > todayISO()) throw new VErr($('#lapDate'), 'Datum: Eine Bestzeit kann nicht in der Zukunft liegen.');
  const tm = T.parseLap(val('lapTime'));
  if (!tm) throw new VErr($('#lapTime'), val('lapTime') ? 'Zeit: Bitte als Minuten:Sekunden eingeben, z. B. 1:52,34 (oder Sekunden, z. B. 52,8).' : 'Zeit: Bitte ausfüllen.');
  return {track, layout, bike, date, ms: tm.ms, dig: tm.dig, note: val('lapNote').slice(0, T.LAP_NOTE_MAX)};
}
/* Eintrag in der gespeicherten Form (leere Angaben fehlen) */
function entry(h, v, prev){
  const o = {id: h.id, track: v.track, date: v.date, ms: v.ms, dig: v.dig};
  if (v.layout) o.layout = v.layout;
  if (v.note) o.note = v.note;
  o.created = prev ? prev.created || 0 : Date.now();
  if (prev) o.edited = Date.now();
  return o;
}
const sameLap = (a, v) => T.trackKey(a.track) === T.trackKey(v.track) && T.trackKey(a.layout) === T.trackKey(v.layout) && a.date === v.date && a.ms === v.ms;

export async function submit(busy){
  const h = S.lapForm; if (!h) return true;
  if (h.epoch !== (S.epoch || '')) { close(); toast('Das Formular gehörte zu einem anderen Datenstand und wurde geschlossen. Es wurde nichts gespeichert.'); return true; }
  const v = readForm();
  busy(true);
  for (let i = 0; i < 3; i++) {
    const r = await saveOnce(h, v);
    if (r !== 'retry') return true;
    await store.reloadAll().catch(() => {});
    if (S.lapForm !== h) return true;
  }
  toast('Die Daten ändern sich gerade laufend. Es wurde nichts gespeichert; versuch es gleich noch einmal.');
  return true;
}
function warn(h, msg, note){ h.msg = msg; keepValues(() => renderForm()); toast(note || msg); }
/* Ist der Vorgang schon gespeichert? (nach unklarem Ergebnis) */
const applied = p => { const raw = store.peek('bikes', p.bike); if (!raw) return false; const l = lapOf(raw, p.id); return !!l && canon(Object.assign({}, l, {created: 0, edited: 0})) === canon(Object.assign({}, p.v, {created: 0, edited: 0})); };
async function saveOnce(h, v){
  const raw = store.peek('bikes', v.bike);
  if (!raw) { toast('Das Motorrad gibt es nicht mehr. Es wurde nichts gespeichert.'); return 'done'; }
  const last = h.lastOp;
  if (last && applied(last.payload)) {
    if (S.ops.lapForm === last) delete S.ops.lapForm;
    done(h, last.sig === canon([h.mode, h.id, v]) ? '' : 'Der vorherige Versuch ist gespeichert. Spätere Änderungen im Formular bitte neu eintragen.');
    return 'done';
  }
  let prev = null, raw0 = null;
  if (h.mode === 'edit') {
    raw0 = store.peek('bikes', h.bike0);
    prev = raw0 ? lapOf(raw0, h.id) : null;
    if (!prev) { close(); R.renderAll(); toast('Diese Bestzeit gibt es inzwischen nicht mehr. Es wurde nichts gespeichert.'); return 'done'; }
    /* Grundlage des Entwurfs: der Eintrag beim Öffnen. Geändert → nichts speichern, Eingaben behalten */
    if (canon(prev) !== h.base) {
      h.base = canon(prev); parkOp('lapForm');
      warn(h, 'Diese Bestzeit wurde inzwischen geändert (zum Beispiel in einem anderen Fenster). Es wurde nichts gespeichert. Deine Eingaben stehen noch im Formular; prüf sie und tipp erneut auf „Speichern“.', 'Inzwischen geändert. Es wurde nichts gespeichert.');
      return 'done';
    }
  }
  const list = lapsOf(raw);
  if (list.some(a => a.id !== h.id && sameLap(a, v))) throw new VErr($('#lapTime'), 'Diese Zeit ist für dieses Motorrad, diese Strecke und diesen Tag schon eingetragen.');
  const moving = h.mode === 'edit' && h.bike0 !== v.bike;
  if ((h.mode === 'add' || moving) && list.length >= T.MAX_LAPS) throw new VErr($('#lapBike'), 'Höchstens ' + T.MAX_LAPS + ' Bestzeiten je Motorrad. Lösch zuerst eine andere.');
  const e = entry(h, v, prev);
  const clean = arr => canonDoc('bikes', {brand: 'Motorrad', laps: arr}).laps;
  let items;
  if (moving) items = [{coll: 'bikes', id: h.bike0, patch: {laps: clean(lapsOf(raw0).filter(l => l.id !== h.id))}, guard: {laps: clone(nu(raw0.laps))}},
    {coll: 'bikes', id: v.bike, patch: {laps: clean(list.concat([e]))}, guard: {laps: clone(nu(raw.laps))}}];
  else items = [{coll: 'bikes', id: v.bike, patch: {laps: clean(h.mode === 'edit' ? list.map(l => l.id === h.id ? e : l) : list.concat([e]))}, guard: {laps: clone(nu(raw.laps))}}];
  const o = opFor('lapForm', v.bike, 'bikes', null, canon([h.mode, h.id, v])); if (o.saving) return 'done';
  o.noTrack = true; o.quietFail = true;
  if (!o.payload) { o.payload = {bike: v.bike, id: h.id, v: e, items}; o.label = 'Bestzeit'; }
  if (o.state === 'unclear' && applied(o.payload)) { delete S.ops.lapForm; done(h); return 'done'; }
  const r = await execOp('lapForm', o, () => store.commitR(o.payload.items, null, 'bestzeit', {epoch: o.epoch}));
  if (r === 'ok') { done(h); return 'done'; }
  if (r === 'unclear') { h.lastOp = o; return 'done'; }
  /* Beim Schreiben geändert (anderes Fenster): neu lesen und auf dem aktuellen Stand neu prüfen – nie überschreiben */
  if (r === 'fail' && S.lastErr && S.lastErr.code === 'changed') { parkOp('lapForm'); return 'retry'; }
  if (r === 'fail') toast(errText(S.lastErr) + ' Es wurde nichts gespeichert.');
  return 'done';
}
function done(h, msg){
  const id = h.id;
  close();
  toast(msg || 'Bestzeit gespeichert.');
  R.renderAll();
  const el = document.querySelector('[data-lap="' + CSS.escape(id) + '"] [data-lapedit]') || $('#lapAdd');
  if (el) el.focus();
}

/* ---------- Löschen: nur, was angezeigt war ---------- */
async function del(bid, id){
  let raw = store.peek('bikes', bid);
  const seen = canon(lapOf(raw, id));
  if (!lapOf(raw, id)) { toast('Diese Bestzeit gibt es inzwischen nicht mehr.'); R.renderAll(); return; }
  const ep = S.epoch || '';
  for (let i = 0; i < 3; i++) {
    raw = store.peek('bikes', bid);
    const cur = lapOf(raw, id);
    if (!raw || !cur) { toast('Diese Bestzeit gibt es inzwischen nicht mehr.'); R.renderAll(); return; }
    if (canon(cur) !== seen) { toast('Diese Bestzeit wurde inzwischen geändert. Es wurde nichts gelöscht; sieh sie dir noch einmal an.'); R.renderAll(); return; }
    const list = lapsOf(raw);
    const r = await flow(() => store.commitR([{coll: 'bikes', id: bid, patch: {laps: list.filter(l => l.id !== id)}, guard: {laps: clone(list)}}], null, 'bestzeit-loeschen', {epoch: ep}));
    if (r === 'ok') {
      if (S.lapForm && S.lapForm.mode === 'edit' && S.lapForm.id === id) close();
      toast('Bestzeit gelöscht.'); R.renderAll();
      const a = $('#lapAdd'); if (a) a.focus();
      return;
    }
    if (r === 'fail' && S.lastErr && S.lastErr.code === 'changed') { await store.reloadAll().catch(() => {}); continue; }
    toast(r === 'fail' ? errText(S.lastErr) + ' Es wurde nichts gelöscht.' : 'Unklar, ob gelöscht wurde. Sieh in der Liste nach.');
    R.renderAll();
    return;
  }
  toast('Die Daten ändern sich gerade laufend. Es wurde nichts gelöscht; versuch es gleich noch einmal.');
}

/* ---------- Ereignisse ---------- */
export async function onClick(t){
  if (R.route.page !== 'tracks') return false;
  if (t.dataset.trackfav != null) { await setFav(t.dataset.trackfav, t.getAttribute('aria-pressed') !== 'true'); return true; }
  if (t.dataset.track != null) { R.go({page: 'tracks', track: t.dataset.track}); return true; }
  if (t.id === 'trackBack') { R.go({page: 'tracks'}); return true; }
  if (t.id === 'lapAdd') { drafts.begin(() => open('add', '', '')); return true; }
  if (t.dataset.lapedit) {
    const [bid, id] = t.dataset.lapedit.split('|');
    if (S.lapForm && S.lapForm.mode === 'edit' && S.lapForm.id === id && $('#lapForm')) { const f = $('#lapTrack'); if (f) f.focus(); return true; }
    drafts.begin(() => open('edit', bid, id));
    return true;
  }
  if (t.id === 'lapCancel') {
    parkOp('lapForm'); const back = S.lapForm && S.lapForm.mode === 'edit' ? S.lapForm.id : '';
    close(); R.renderAll();
    const el = back ? document.querySelector('[data-lap="' + CSS.escape(back) + '"] [data-lapedit]') : $('#lapAdd'); if (el) el.focus();
    return true;
  }
  if (t.dataset.lapdel) { if (!arm(t)) return true; const [bid, id] = t.dataset.lapdel.split('|'); await del(bid, id); return true; }   /* zweistufig */
  return false;
}
export function onInput(t){
  if (t.id === 'lapTrack') { updateLayouts(); return true; }
  return false;
}
export function onChange(t){
  if (t.id === 'trFilter' || t.id === 'trSort') {
    const c = choice(); c[t.id === 'trFilter' ? 'filter' : 'sort'] = t.value;
    lsSet('strecken', JSON.stringify(c)); renderTracks(); return true;
  }
  return false;
}
export function register(){
  drafts.register({key: 'lap', label: 'Bestzeit', root: () => $('#lapForm'), extra: () => S.lapForm ? [S.lapForm.mode, S.lapForm.id] : null,
    isOpen: () => !!S.lapForm, save: async () => { const f = $('#lapForm'); if (!f) return true; await R.submitForm(f); return !S.lapForm; },
    discard: () => { parkOp('lapForm'); close(); },
    reveal: () => { if (R.route.page !== 'tracks') R.navigate({page: 'tracks'}); const f = $('#lapTrack'); if (f) f.focus(); }});
}
