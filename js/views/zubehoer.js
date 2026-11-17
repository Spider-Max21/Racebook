/* Racebook – Verbaute Teile: Zubehör (ab 1.8.0, Issue #15).
   Eigener Bereich unter „Verbaute Teile“ für verbautes Zubehör wie Motorschutz oder Handguards: Bezeichnung, optional Hersteller,
   Modell und eine kurze Notiz. Ansehen, eintragen, bearbeiten, entfernen. Bewusst ohne Strecke, Untergrund, Montage- oder
   Zählerstände, ohne Nutzung, Verschleiß und Vergleich (das bleibt bei Reifen, Kette und weiteren Teilen in der Teilehistorie).
   Kein Lager, keine Kosten, keine Wartung, kein Logbuch-Eintrag. Gespeichert wird am Motorrad (Feld acc, js/domain.js) in einem
   Vorgang mit der Bestandskennung und einer Prüfung gegen den gespeicherten Stand: Hat ein anderes Fenster das Zubehör inzwischen
   geändert, wird nichts überschrieben – beim Bearbeiten bleibt die Eingabe im Formular (Hinweis, erneut speichern), ein neuer
   Eintrag kommt zum aktuellen Stand dazu. */
import {S} from '../state.js';
import {$, $$, toast, errText, arm, VErr} from '../ui.js';
import {esc, str, uid, canon, clone} from '../util.js';
import {canonDoc, MAX_ACC, ACC_MAX} from '../domain.js';
import * as M from '../mounts.js';
import * as store from '../store.js';
import {opFor, parkOp, execOp, flow} from '../ops.js';
import * as drafts from '../drafts.js';
import {R} from '../registry.js';

const nu = v => v === undefined ? null : v;
const norm = s => str(s).toLowerCase().replace(/\s+/g, ' ');
const listOf = raw => raw && Array.isArray(raw.acc) ? raw.acc : [];
const entryOf = (raw, id) => listOf(raw).find(a => a.id === id) || null;
/* Bezeichnung mit Hersteller und Modell (Hersteller nicht doppelt, wenn das Modell damit beginnt) */
export const accLabel = a => M.partLabel(a);

/* ---------- Anzeige ---------- */
export function refresh(b){
  b = b || S.bikes[S.bike]; if (!b) return;
  const f = S.accForm;
  if (f && (f.bike !== b.id || !$('#accForm'))) { if (f.bike !== b.id) close(); else renderForm(); }
  const list = $('#accList'); if (list) keepFocus(list, () => { list.innerHTML = listHTML(b); });
}
/* Die Liste wird bei jeder Änderung neu gezeichnet (auch aus anderen Fenstern): ein Knopf darin behält dabei den Fokus */
function keepFocus(list, fn){
  const a = document.activeElement, inside = a && list.contains(a);
  const key = inside ? (a.dataset.acc ? '[data-acc="' + CSS.escape(a.dataset.acc) + '"]' : a.dataset.accdel ? '[data-accdel="' + CSS.escape(a.dataset.accdel) + '"]' : '') : '';
  fn();
  if (!inside) return;
  const el = key ? list.querySelector(key) : null;
  if (el) el.focus(); else { const add = $('#accAdd'); if (add) add.focus(); }
}
function listHTML(b){
  const xs = listOf(b);
  if (!xs.length) return '<p class="hint">Noch kein Zubehör eingetragen.</p>';
  const editing = S.accForm && S.accForm.mode === 'edit' ? S.accForm.id : '';
  return '<ul class="acc-list">' + xs.map(a => {
    const lbl = accLabel(a);
    return '<li class="acc-row" data-arow="' + esc(a.id) + '"><div class="hist-h"><b>' + esc(a.name) + '</b>' + (editing === a.id ? '<span class="tag">wird bearbeitet</span>' : '') + '</div>'
      + (lbl ? '<div>' + esc(lbl) + '</div>' : '') + (a.note ? '<div class="hint">' + esc(a.note) + '</div>' : '')
      + '<div class="row"><button class="mini" type="button" data-acc="' + esc('edit|' + a.id) + '" aria-label="' + esc('Bearbeiten: ' + a.name) + '">Bearbeiten</button>'
      + '<button class="mini" type="button" data-accdel="' + esc(a.id) + '" data-arm="Wirklich entfernen?" aria-label="' + esc('Entfernen: ' + a.name) + '">Entfernen</button></div></li>';
  }).join('') + '</ul>';
}

/* ---------- Formular ---------- */
export const isOpen = () => !!S.accForm;
export function close(){
  if (!S.accForm) return;
  S.accForm = null; drafts.forget('acc');
  const box = $('#accBox'); if (box) box.innerHTML = '';
}
/* Öffnen erst im Rückruf von drafts.begin: Eintrag und Grundlage aus dem Speicher (nicht aus einem vorher gemerkten Objekt) */
function open(mode, id){
  const b = S.bikes[S.bike]; if (!b) return;
  const raw = store.peek('bikes', b.id); if (!raw) return;
  let base = '';
  if (mode === 'edit') {
    const a = entryOf(raw, id); if (!a) { toast('Diesen Eintrag gibt es inzwischen nicht mehr.'); return; }
    base = canon(a);
  } else id = 'a' + uid();
  S.accForm = {bike: b.id, epoch: S.epoch || '', mode, id, base, msg: '', dupOk: '', lastOp: null};
  renderForm(Object.assign(clone(raw), {id: b.id}));
  R.setSection('components', 'accBox');
  refreshList();
  drafts.mark('acc');
  const f = $('#accName'); if (f) f.focus();
}
function refreshList(){ const b = S.bikes[S.bike], list = $('#accList'); if (b && list) keepFocus(list, () => { list.innerHTML = listHTML(b); }); }
const fld = (id, label, input, full) => '<div class="f' + (full ? ' full' : '') + '"><label for="' + id + '">' + esc(label) + '</label>' + input + '</div>';
const inp = (id, val, extra) => '<input id="' + id + '" value="' + esc(val == null ? '' : val) + '"' + (extra || '') + '>';
function renderForm(rb){
  const h = S.accForm, box = $('#accBox'); if (!h || !box) return;
  const raw = rb || store.peek('bikes', h.bike);
  const a = h.mode === 'edit' ? entryOf(raw, h.id) : null;
  box.innerHTML = '<form id="accForm" class="stack acc-form" data-bike="' + esc(h.bike) + '" novalidate><h3>' + (h.mode === 'edit' ? 'Zubehör bearbeiten' : 'Zubehör eintragen') + '</h3>'
    + (h.msg ? '<p class="warnbox" role="alert">' + esc(h.msg) + '</p>' : '')
    + '<div class="grid">'
    + fld('accName', 'Bezeichnung', inp('accName', a ? a.name : '', ' maxlength="' + ACC_MAX.name + '" placeholder="z. B. Motorschutz, Handguards" autocomplete="off"'), true)
    + fld('accMaker', 'Hersteller (optional)', inp('accMaker', a ? a.maker : '', ' maxlength="' + ACC_MAX.maker + '" autocomplete="off"'))
    + fld('accModel', 'Modell (optional)', inp('accModel', a ? a.model : '', ' maxlength="' + ACC_MAX.model + '" autocomplete="off"'))
    + fld('accNote', 'Notiz (optional)', '<textarea id="accNote" maxlength="' + ACC_MAX.note + '" rows="2" placeholder="z. B. Befestigung, Besonderheiten">' + esc(a ? a.note || '' : '') + '</textarea>', true)
    + '</div><p class="hint">Nur zur Übersicht, was verbaut ist: ohne Strecke, Untergrund und Laufleistung. Lager, Kosten und Wartung bleiben unverändert.</p>'
    + '<div class="row"><button class="btn primary" type="submit">Speichern</button><button class="btn ghost" type="button" id="accCancel">Abbrechen</button></div></form>';
}
/* Formularwerte erhalten, wenn das Formular neu gezeichnet werden muss (Hinweis nach einer Änderung in einem anderen Fenster) */
function keepValues(fn){
  const vals = {}; $$('#accForm input, #accForm textarea').forEach(el => { vals[el.id] = el.value; });
  fn();
  Object.entries(vals).forEach(([id, v]) => { const el = document.getElementById(id); if (el) el.value = v; });
}
function readForm(){
  const val = id => { const el = $('#' + id); return el ? str(el.value) : ''; };
  const v = {name: val('accName').slice(0, ACC_MAX.name), maker: val('accMaker').slice(0, ACC_MAX.maker), model: val('accModel').slice(0, ACC_MAX.model), note: val('accNote').slice(0, ACC_MAX.note)};
  if (!v.name) throw new VErr($('#accName'), 'Gib eine Bezeichnung an, z. B. „Motorschutz“.');
  return v;
}
/* Eintrag in der gespeicherten Form (leere Angaben fehlen) */
function entry(id, v){ const o = {id, name: v.name}; ['maker', 'model', 'note'].forEach(k => { if (v[k]) o[k] = v[k]; }); return o; }
const sameAcc = (a, v) => norm(a.name) === norm(v.name) && norm(a.maker) === norm(v.maker) && norm(a.model) === norm(v.model);

/* ---------- Speichern ---------- */
export async function submit(busy){
  const h = S.accForm; if (!h) return true;
  if (!S.bikes[h.bike] || h.epoch !== (S.epoch || '')) { close(); toast('Das Formular gehörte zu einem anderen Datenstand und wurde geschlossen. Es wurde nichts gespeichert.'); return true; }
  const v = readForm();
  busy(true);
  for (let i = 0; i < 3; i++) {
    const r = await saveOnce(h, v);
    if (r !== 'retry') return true;
    await store.reloadAll().catch(() => {});
    if (S.accForm !== h) return true;
  }
  toast('Die Daten ändern sich gerade laufend. Es wurde nichts gespeichert; versuch es gleich noch einmal.');
  return true;
}
function warn(h, msg, note){
  h.msg = msg;
  keepValues(() => renderForm());
  toast(note || msg);
}
/* Ist der Vorgang schon gespeichert? (nach unklarem Ergebnis) */
const applied = p => { const raw = store.peek('bikes', p.bike); return !!raw && canon(entryOf(raw, p.id)) === canon(p.v); };
async function saveOnce(h, v){
  const raw = store.peek('bikes', h.bike);
  if (!raw) { close(); toast('Das Motorrad gibt es nicht mehr. Es wurde nichts gespeichert.'); return 'done'; }
  /* Ein unklarer Versuch dieses Formulars ist inzwischen als gespeichert erkannt: abschließen, nichts neu aufbauen */
  const last = h.lastOp;
  if (last && applied(last.payload)) {
    if (S.ops.accForm === last) delete S.ops.accForm;
    done(h, last.sig === canon([h.mode, h.id, v]) ? '' : 'Der vorherige Versuch ist gespeichert. Spätere Änderungen im Formular bitte neu eintragen.');
    return 'done';
  }
  const list = listOf(raw);
  if (h.mode === 'edit') {
    const cur = entryOf(raw, h.id);
    if (!cur) { close(); refreshList(); toast('Diesen Eintrag gibt es inzwischen nicht mehr. Es wurde nichts gespeichert.'); return 'done'; }
    /* Grundlage des Entwurfs: der Eintrag beim Öffnen. Geändert → nichts speichern, Eingaben behalten */
    if (canon(cur) !== h.base) {
      h.base = canon(cur); parkOp('accForm');
      warn(h, 'Dieses Zubehör wurde inzwischen geändert (zum Beispiel in einem anderen Fenster). Es wurde nichts gespeichert. Deine Eingaben stehen noch im Formular; prüf sie und tipp erneut auf „Speichern“.', 'Inzwischen geändert. Es wurde nichts gespeichert.');
      return 'done';
    }
  }
  /* Keine bekannten Angaben doppelt anlegen */
  if (list.some(a => a.id !== h.id && sameAcc(a, v))) throw new VErr($('#accName'), 'Dieses Zubehör ist an diesem Motorrad schon eingetragen.');
  if (h.mode === 'add') {
    const x = M.mountedOf(Object.assign(clone(raw), {id: h.bike})).find(r => r.slot === 'x' && norm(r.name) === norm(v.name));
    if (x && h.dupOk !== norm(v.name)) {
      h.dupOk = norm(v.name);
      warn(h, '„' + x.name + '“ ist unter „Teilehistorie“ schon als weiteres Teil montiert (mit Montage und Nutzung); dort bleibt es unverändert. Tipp erneut auf „Speichern“, wenn du es zusätzlich als Zubehör eintragen willst.', 'Schon unter „Teilehistorie“ eingetragen. Es wurde nichts gespeichert.');
      return 'done';
    }
    if (list.length >= MAX_ACC) throw new VErr($('#accName'), 'Höchstens ' + MAX_ACC + ' Zubehör-Einträge je Motorrad. Entfern zuerst einen anderen.');
  }
  const e = entry(h.id, v);
  const next = h.mode === 'edit' ? list.map(a => a.id === h.id ? e : a) : list.concat([e]);
  const o = opFor('accForm', h.bike, 'bikes', null, canon([h.mode, h.id, v])); if (o.saving) return 'done';
  o.noTrack = true; o.quietFail = true;
  if (!o.payload) { o.payload = {bike: h.bike, id: h.id, v: e, items: [{coll: 'bikes', id: h.bike, patch: {acc: canonDoc('bikes', {brand: 'Motorrad', acc: next}).acc}, guard: {acc: clone(nu(raw.acc))}}]}; o.label = 'Zubehör'; }
  /* Nach unklarem Ergebnis erst nachsehen, ob es schon gespeichert ist (die Prüfung würde sonst am eigenen Eintrag scheitern) */
  if (o.state === 'unclear' && applied(o.payload)) { delete S.ops.accForm; done(h); return 'done'; }
  const r = await execOp('accForm', o, () => store.commitR(o.payload.items, null, 'zubehoer', {epoch: o.epoch}));
  if (r === 'ok') { done(h); return 'done'; }
  if (r === 'unclear') { h.lastOp = o; return 'done'; }
  /* Beim Schreiben geändert (anderes Fenster): neu lesen und auf dem aktuellen Stand neu prüfen – nie überschreiben */
  if (r === 'fail' && S.lastErr && S.lastErr.code === 'changed') return 'retry';
  if (r === 'fail') toast(errText(S.lastErr) + ' Es wurde nichts gespeichert.');
  return 'done';
}
function done(h, msg){
  const id = h.id, mode = h.mode;
  close();
  toast(msg || 'Gespeichert.');
  R.renderAll();
  const el = mode === 'edit' ? document.querySelector('[data-acc="' + CSS.escape('edit|' + id) + '"]') : $('#accAdd');
  if (el) el.focus();
}

/* ---------- Entfernen ---------- */
async function del(id){
  const b = S.bikes[S.bike]; if (!b) return;
  const bid = b.id, ep = S.epoch || '';
  let raw = store.peek('bikes', bid);
  const seen = canon(entryOf(raw, id));
  if (!entryOf(raw, id)) { toast('Diesen Eintrag gibt es inzwischen nicht mehr.'); R.renderAll(); return; }
  for (let i = 0; i < 3; i++) {
    raw = store.peek('bikes', bid);
    const cur = entryOf(raw, id);
    if (!raw || !cur) { toast('Diesen Eintrag gibt es inzwischen nicht mehr.'); R.renderAll(); return; }
    /* Nur entfernen, was angezeigt war: inzwischen geändert → nichts entfernen */
    if (canon(cur) !== seen) { toast('Dieses Zubehör wurde inzwischen geändert. Es wurde nichts entfernt; sieh es dir noch einmal an.'); R.renderAll(); return; }
    const list = listOf(raw);
    const r = await flow(() => store.commitR([{coll: 'bikes', id: bid, patch: {acc: list.filter(a => a.id !== id)}, guard: {acc: clone(list)}}], null, 'zubehoer-entfernen', {epoch: ep}));
    if (r === 'ok') {
      if (S.accForm && S.accForm.bike === bid && S.accForm.id === id) close();
      toast('Entfernt.'); R.renderAll();
      const a = $('#accAdd'); if (a) a.focus();
      return;
    }
    if (r === 'fail' && S.lastErr && S.lastErr.code === 'changed') { await store.reloadAll().catch(() => {}); continue; }
    toast(r === 'fail' ? errText(S.lastErr) + ' Es wurde nichts entfernt.' : 'Unklar, ob entfernt wurde. Sieh in der Liste nach.');
    R.renderAll();
    return;
  }
  toast('Die Daten ändern sich gerade laufend. Es wurde nichts entfernt; versuch es gleich noch einmal.');
}

/* ---------- Ereignisse ---------- */
export async function onClick(t){
  if (t.dataset.acc) {
    const [mode, id] = t.dataset.acc.split('|');
    if (S.accForm && S.accForm.mode === mode && S.accForm.id === id && $('#accForm')) { R.setSection('components', 'accBox'); return true; }
    drafts.begin(() => open(mode, id));
    return true;
  }
  if (t.id === 'accAdd') { drafts.begin(() => open('add', '')); return true; }
  if (t.id === 'accCancel') { parkOp('accForm'); const back = S.accForm && S.accForm.mode === 'edit' ? S.accForm.id : ''; close(); refreshList();
    const el = back ? document.querySelector('[data-acc="' + CSS.escape('edit|' + back) + '"]') : $('#accAdd'); if (el) el.focus(); return true; }
  if (t.dataset.accdel) { if (!arm(t)) return true; await del(t.dataset.accdel); return true; }   /* zweistufig: erst scharf stellen */
  return false;
}
export function register(reveal){
  drafts.register({key: 'acc', label: 'Zubehör', root: () => $('#accForm'), extra: () => S.accForm ? [S.accForm.mode, S.accForm.id] : null,
    isOpen: () => !!S.accForm, save: async () => { const f = $('#accForm'); if (!f) return true; await R.submitForm(f); return !S.accForm; },
    discard: () => { parkOp('accForm'); close(); }, reveal});
}
