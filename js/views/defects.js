/* Racebook – Mängel je Motorrad: erfassen, Status ändern, erledigen (auf Wunsch mit Reparatur im Logbuch).
   Zwei getrennte Entwürfe mit eigenem Lebenszyklus und eigener Generation:
     Bearbeiten/Erfassen (defectForm: S.defEdit, S.defKeep) und Erledigen (defDoneForm: S.defDone, S.defDoneDraft).
   Ein Abschluss schließt nur seinen eigenen Entwurf; jeder neu geöffnete Entwurf ist eine neue Generation.
   Bearbeiten ändert nur Titel, Beschreibung, Datum, Priorität und Fotos (Status bleibt, wie er gespeichert ist).
   Erledigen mit Reparatur ist EIN Vorgang: Mangel und Logbuch-Eintrag werden gemeinsam gespeichert.
   Die ID des Logbuch-Eintrags ergibt sich aus Mangel und Reparaturnummer, eine Wiederholung erzeugt
   deshalb nie einen zweiten Eintrag. */
import {esc, str, fmt, eur, todayISO, fmtDate, v2} from '../util.js';
import {S, U} from '../state.js';
import {DEFECT_PRIOS, DEFECT_STATES, LIM, MAX_COST, serviceDoc, curOf, canonDoc} from '../domain.js';
import * as store from '../store.js';
import {opFor, execOp, lowCheck, cleanupFiles, payloadFiles, parkOp, bumpGen} from '../ops.js';
import {$, $$, toast, arm, VErr, fieldNum, fieldDate, imgTag, hydrate} from '../ui.js';
import {makePhoto} from '../images.js';
import {R} from '../registry.js';
import {formBike, sUpdate, sDel, prioRank, prioText, setSection} from './bike.js';

const MAX_PHOTOS = 6;
const stateText = s => (DEFECT_STATES.find(x => x[0] === s) || [0, 'offen'])[1];
const without = d => { const o = Object.assign({}, d); delete o.id; delete o._pending; return o; };

export function renderDefects(){
  const b = S.bikes[S.bike]; if (!b) return;
  const all = S.defects.filter(d => d.bike === b.id);
  const open = all.filter(d => d.status !== 'done').sort((x, y) => prioRank(x) - prioRank(y) || (y.date || '').localeCompare(x.date || '') || (y.created || 0) - (x.created || 0));
  const done = all.filter(d => d.status === 'done').sort((x, y) => (y.doneDate || '').localeCompare(x.doneDate || '') || (y.created || 0) - (x.created || 0));
  $('#defOpenCount').textContent = open.length ? open.length + ' offen' : '';
  $('#defOpen').innerHTML = open.length ? open.map(defectHTML).join('') : '<p class="hint">Keine offenen Mängel. Fällt dir etwas auf, trag es oben ein, dann geht es nicht verloren.</p>';
  $('#defDoneCount').textContent = done.length ? done.length + ' erledigt' : '';
  $('#defDoneList').innerHTML = done.length ? done.map(defectHTML).join('') : '<p class="hint">Noch nichts erledigt.</p>';
  renderKeep();
  hydrate($('#v-defects'));
}
function defectHTML(d){
  const busy = S.defBusy.has(d.id), dis = busy ? ' disabled' : '';
  const photos = (d.photos || []).map((p, i) => '<button class="thumb-btn" type="button" data-photo="' + esc(p.id) + '" aria-label="Foto ' + (i + 1) + ' zu „' + esc(d.title) + '“ vergrößern">' + imgTag(p.thumbId || p.id, 'Foto ' + (i + 1) + ' zum Mangel ' + d.title, 'thumb', ' loading="lazy"') + '</button>').join('');
  const repair = d.repairLogId ? S.log.find(l => l.id === d.repairLogId) : null;
  const meta = [stateText(d.status), 'festgestellt ' + fmtDate(d.date), d.status === 'done' && d.doneDate ? 'erledigt ' + fmtDate(d.doneDate) : '', repair ? 'Reparatur im Logbuch' + (repair.cost != null ? ' (' + eur(repair.cost) + ')' : '') : ''].filter(Boolean).join(', ');
  let actions;
  if (d.status === 'done') actions = '<button class="mini" type="button" data-defstate="open" data-def="' + esc(d.id) + '"' + dis + '>Wieder öffnen</button>';
  else actions = (d.status === 'open'
      ? '<button class="mini" type="button" data-defstate="progress" data-def="' + esc(d.id) + '"' + dis + '>In Arbeit</button>'
      : '<button class="mini" type="button" data-defstate="open" data-def="' + esc(d.id) + '"' + dis + '>Zurück auf offen</button>')
    + (S.defDone === d.id ? '' : '<button class="mini primary" type="button" data-defdone="' + esc(d.id) + '"' + dis + '>Erledigt …</button>')
    + '<button class="mini" type="button" data-defedit="' + esc(d.id) + '"' + dis + '>Bearbeiten</button>';
  actions += '<button class="mini" type="button" data-defdel="' + esc(d.id) + '" data-arm="Mangel löschen?"' + dis + '>Löschen</button>';
  return '<article class="defect p-' + esc(d.priority) + ' st-' + esc(d.status) + '" data-defect-id="' + esc(d.id) + '">'
    + '<div class="def-head"><span class="prio ' + esc(d.priority) + '">' + esc(prioText(d.priority)) + '<span class="sr"> Priorität</span></span><h3 class="def-title">' + esc(d.title) + '</h3></div>'
    + '<p class="def-meta">' + esc(meta) + (d._pending ? ' <span class="hint">wird gespeichert …</span>' : '') + '</p>'
    + (d.description ? '<p class="def-desc">' + esc(d.description) + '</p>' : '')
    + (photos ? '<div class="def-photos">' + photos + '</div>' : '')
    + '<div class="row">' + actions + '</div>'
    + (S.defDone === d.id ? doneFormHTML(d) : '')
    + '</article>';
}
function doneFormHTML(d){
  const b = S.bikes[d.bike], u = U(b), dr = S.defDoneDraft || {}, so = S.ops.defDoneForm;
  const saving = !!(so && so.saving && so.item === d.id);
  const cur = curOf(b), past = dr.date && dr.date !== todayISO();
  return '<form class="done-form def-done" id="defDoneForm" data-defect="' + esc(d.id) + '" data-bike="' + esc(d.bike) + '" novalidate>'
    + '<div class="f"><label for="ddDate">Erledigt am</label><input type="date" id="ddDate" value="' + esc(dr.date || todayISO()) + '" max="' + todayISO() + '"></div>'
    + '<label class="check full"><input type="checkbox" id="ddLog"' + (dr.log ? ' checked' : '') + '><span>Reparatur auch ins Logbuch eintragen</span></label>'
    + '<div class="full grid" id="ddLogFields"' + (dr.log ? '' : ' hidden') + '>'
    + '<div class="f"><label for="ddAt">' + (past ? 'Stand damals' : 'Stand') + ' (' + u + ')</label><input id="ddAt" inputmode="decimal" autocomplete="off" value="' + esc(dr.atStr || '') + '" placeholder="' + (past ? 'unbekannt' : (cur == null ? 'unbekannt' : esc(v2(cur)) + ' (Verlauf)')) + '"></div>'
    + '<div class="f"><label for="ddCost">Kosten (€)</label><input id="ddCost" inputmode="decimal" autocomplete="off" value="' + esc(dr.costStr || '') + '"></div>'
    + '<div class="f full"><label for="ddNote">Was wurde gemacht?</label><input id="ddNote" maxlength="500" value="' + esc(dr.noteStr || '') + '" placeholder="z. B. Hebel getauscht"></div></div>'
    + '<div class="row full"><button class="btn primary" type="submit"' + (saving ? ' disabled' : '') + '>' + (saving ? 'Wird gespeichert …' : 'Als erledigt speichern') + '</button><button class="btn ghost" type="button" id="ddCancel"' + (saving ? ' disabled' : '') + '>Abbrechen</button></div></form>';
}
function renderKeep(){
  const el = $('#dPhotoKeep'); if (!el) return;
  const d = S.defEdit ? S.defects.find(x => x.id === S.defEdit) : null;
  if (!d || !(d.photos || []).length) { el.innerHTML = ''; el.hidden = true; return; }
  const kept = S.defKeep || new Set((d.photos || []).map(p => p.id));
  el.hidden = false;
  el.innerHTML = '<span class="lbl">Vorhandene Fotos</span><div class="def-photos">' + d.photos.map((p, i) => '<label class="keep">' + imgTag(p.thumbId || p.id, 'Foto ' + (i + 1), 'thumb') + '<span><input type="checkbox" data-keepphoto="' + esc(p.id) + '"' + (kept.has(p.id) ? ' checked' : '') + '> behalten</span></label>').join('') + '</div>';
  hydrate(el);
}

export function openDefectForm(){ const d = $('#defectDetails'); if (d) d.open = true; setTimeout(() => { const t = $('#dTitle'); if (t) t.focus(); }, 50); }
/* Nur den Bearbeiten-/Erfassen-Entwurf zurücksetzen; ein offener Erledigt-Entwurf bleibt */
export function resetDefectEdit(){
  S.defEdit = null; S.defKeep = null;
  const f = $('#defectForm'); if (f) { f.reset(); f.dataset.bike = S.bike; f.dataset.epoch = S.epoch || ''; }
  const dd = $('#dDate'); if (dd) { dd.value = todayISO(); dd.max = todayISO(); }
  const t = $('#defFormTitle'); if (t) t.textContent = 'Mangel erfassen';
  const c = $('#dCancel'); if (c) c.hidden = true;
  const det = $('#defectDetails'); if (det) det.open = false;
  renderKeep();
}
/* Nur den Erledigt-Entwurf zurücksetzen */
export function resetDefectDone(){ S.defDone = null; S.defDoneDraft = null; }
/* Beide (Motorradwechsel, Bestand ersetzt) */
export function resetDefectForms(){ resetDefectEdit(); resetDefectDone(); }
export function closeDefectDraft(k){
  if (k === 'defectForm') resetDefectEdit();
  else if (k === 'defDoneForm') resetDefectDone();
}
function editDefect(d){
  /* Neuer Bearbeiten-Entwurf = neue Generation: ein laufender Vorgang zu einem anderen Mangel endet für
     seinen eigenen Mangel und schließt diesen Entwurf nicht. Ein ungeklärter Vorgang zu einem anderen Mangel
     wird getrennt weiter abgeglichen, einer zum selben Mangel an den neuen Entwurf gebunden. */
  const so = S.ops.defectForm;
  if (so && !so.saving && so.item !== d.id) parkOp('defectForm');
  bumpGen('defectForm');
  if (S.ops.defectForm && !S.ops.defectForm.saving && S.ops.defectForm.item === d.id) S.ops.defectForm.gen = S.gen.defectForm;
  resetDefectEdit();
  S.defEdit = d.id; S.defKeep = new Set((d.photos || []).map(p => p.id));
  $('#dTitle').value = d.title; $('#dDesc').value = d.description || ''; $('#dDate').value = d.date; $('#dPrio').value = d.priority;
  $('#defFormTitle').textContent = 'Mangel bearbeiten'; $('#dCancel').hidden = false;
  $('#defectForm').dataset.bike = d.bike;
  $('#defectDetails').open = true;
  renderKeep();
  setSection('defects', 'defectDetails');
}

async function saveDefect(f, busy){
  const b = formBike(f); if (!b) return;
  const title = str($('#dTitle').value).slice(0, 120);
  if (!title) throw new VErr($('#dTitle'), 'Gib dem Mangel einen kurzen Titel.');
  const desc = str($('#dDesc').value).slice(0, 4000);
  const date = fieldDate('dDate', 'Festgestellt am', {req: true});
  const prio = DEFECT_PRIOS.some(p => p[0] === $('#dPrio').value) ? $('#dPrio').value : 'mid';
  const files = Array.from($('#dPhotos').files || []);
  const editing = S.defEdit ? S.defects.find(d => d.id === S.defEdit && d.bike === b.id) : null;
  if (S.defEdit && !editing) { toast('Den Mangel gibt es nicht mehr.'); R.closeDraft('defectForm'); return; }
  const keep = editing ? (editing.photos || []).filter(p => (S.defKeep || new Set()).has(p.id)) : [];
  if (keep.length + files.length > MAX_PHOTOS) throw new VErr($('#dPhotos'), 'Höchstens ' + MAX_PHOTOS + ' Fotos pro Mangel.');
  const sig = [editing ? editing.id : '', title, desc, date, prio, keep.map(p => p.id).join(','), files.map(x => x.name + ':' + x.size + ':' + x.lastModified).join(',')].join('|');
  const o = opFor('defectForm', b.id, 'defects', editing ? editing.id : null, sig); if (o.saving) return;
  if (!o.payload && editing) { o.op = editing.id; o.patch = true; }
  const g = S.gen.defectForm || 0;
  busy(true);
  const r = await execOp('defectForm', o, async () => {
    if (!o.payload) {
      const made = [];
      for (const file of files) {
        try { made.push(await makePhoto(file)); }
        catch (e) { o.quietFail = true; toast('Ein Foto konnte nicht gelesen werden. Es wurde nichts gespeichert.'); return 'fail'; }
      }
      o.files = [].concat(...made.map(m => m.files));
      const fields = {title, description: desc, date, priority: prio, photos: keep.concat(made.map(m => m.photo))};
      if (editing) {
        /* Nur die bearbeiteten Felder ändern (in gespeicherter Form); Status, Erledigt-Datum und Reparaturen
           bleiben so, wie sie gespeichert sind, auch wenn sie sich inzwischen geändert haben */
        const full = canonDoc('defects', Object.assign(without(editing), fields));
        o.payload = {title: full.title, description: full.description, date: full.date, priority: full.priority, photos: full.photos};
      } else o.payload = canonDoc('defects', Object.assign({status: 'open', doneDate: null, repairs: 0, repairLogId: '', created: o.created, bike: b.id}, fields));
      o.removed = editing ? payloadFiles(editing).filter(id => !payloadFiles(o.payload).includes(id)) : [];
      o.label = 'Mangel ' + title;
    }
    return editing ? store.sUpdateR('defects', o.op, o.payload, o.files, {epoch: o.epoch}) : store.sSetR('defects', o.op, o.payload, o.files, {epoch: o.epoch});
  });
  if (r === 'ok') {
    if (o.removed && o.removed.length) cleanupFiles(o.removed);
    if ((S.gen.defectForm || 0) === g) R.closeDraft('defectForm');
    toast(editing ? 'Mangel geändert.' : 'Mangel gespeichert.');
  }
}

async function saveDefectDone(f, busy){
  const b = formBike(f); if (!b) return;
  const d = S.defects.find(x => x.id === f.dataset.defect && x.bike === b.id);
  if (!d) { S.defDone = null; renderDefects(); toast('Den Mangel gibt es nicht mehr.'); return; }
  const lim = LIM[U(b)];
  const date = fieldDate('ddDate', 'Erledigt am', {req: true});
  const withLog = $('#ddLog').checked;
  const at = withLog ? fieldNum('ddAt', 'Stand', {min: 0, max: lim.cnt}) : null;
  const cost = withLog ? fieldNum('ddCost', 'Kosten', {min: 0, max: MAX_COST}) : null;
  const note = withLog ? str($('#ddNote').value).slice(0, 500) : '';
  const o = opFor('defDoneForm', b.id, withLog ? 'log' : 'defects', d.id, [date, withLog, at, cost, note].join('|')); if (o.saving) return;
  if (!o.payload && withLog && !lowCheck(o, b, date, at)) return;
  const g = S.gen.defDoneForm || 0;
  if (!o.payload) {
    const n = (d.repairs || 0) + 1;
    if (withLog) {
      /* Feste ID aus Mangel und Reparaturnummer: eine Wiederholung schreibt denselben Eintrag */
      o.op = 'rep-' + d.id + '-' + n;
      const log = serviceDoc(b, {date, at, tasks: [], extra: 'Reparatur: ' + d.title, cost, note, created: o.created});
      log.repairOf = d.id;
      o.payload = canonDoc('log', log);
      o.extra = [{coll: 'defects', id: d.id, patch: {status: 'done', doneDate: date, repairs: n, repairLogId: o.op}}];
    } else {
      o.op = d.id; o.patch = true;
      o.payload = {status: 'done', doneDate: date};
    }
    o.label = 'Mangel erledigt: ' + d.title;
  }
  busy(true);
  const r = await execOp('defDoneForm', o, () => o.extra
    ? store.commitR([{coll: 'log', id: o.op, data: o.payload}].concat(o.extra), null, 'defect-done', {epoch: o.epoch})
    : store.sUpdateR('defects', o.op, o.payload, null, {epoch: o.epoch}));
  if (r === 'ok') {
    if ((S.gen.defDoneForm || 0) === g) R.closeDraft('defDoneForm');
    toast(o.extra ? 'Erledigt. Die Reparatur steht im Logbuch.' : 'Als erledigt markiert.');
  }
  renderDefects();
}

export async function onClick(t){
  if (t.dataset.defedit) { const d = S.defects.find(x => x.id === t.dataset.defedit); if (d) editDefect(d); return true; }
  if (t.id === 'dCancel') { if (S.ops.defectForm && S.ops.defectForm.saving) return true; parkOp('defectForm'); R.closeDraft('defectForm'); return true; }
  if (t.dataset.defdone) {
    const so = S.ops.defDoneForm, id = t.dataset.defdone;
    /* Wie bei Wartungspunkten: neuer Entwurf = neue Generation; ein ungeklärter Vorgang zu einem
       anderen Mangel wird getrennt weiter abgeglichen, zum selben Mangel an den Entwurf gebunden */
    if (so && !so.saving && so.item !== id) parkOp('defDoneForm');
    bumpGen('defDoneForm');
    if (S.ops.defDoneForm && !S.ops.defDoneForm.saving && S.ops.defDoneForm.item === id) S.ops.defDoneForm.gen = S.gen.defDoneForm;
    S.defDone = id; S.defDoneDraft = {date: todayISO(), log: false, atStr: '', costStr: '', noteStr: ''};
    renderDefects();
    const el = $('#ddDate'); if (el) el.focus();
    return true;
  }
  if (t.id === 'ddCancel') { if (S.ops.defDoneForm && S.ops.defDoneForm.saving) return true; parkOp('defDoneForm'); R.closeDraft('defDoneForm'); renderDefects(); return true; }
  if (t.dataset.defstate) {
    const id = t.dataset.def, d = S.defects.find(x => x.id === id); if (!d || S.defBusy.has(id)) return true;
    const patch = t.dataset.defstate === 'open' ? (d.status === 'done' ? {status: 'open', doneDate: null} : {status: 'open'}) : {status: 'progress'};
    S.defBusy.add(id); renderDefects();
    let ok = false;
    try { ok = await sUpdate('defects', id, patch); } finally { S.defBusy.delete(id); }
    if (ok) toast(patch.status === 'progress' ? 'Mangel ist in Arbeit.' : 'Mangel ist wieder offen.');
    R.renderAll();
    return true;
  }
  if (t.dataset.defdel) {
    if (!arm(t)) return true;
    const id = t.dataset.defdel, d = S.defects.find(x => x.id === id); if (!d) return true;
    if (await sDel('defects', id)) { cleanupFiles(payloadFiles(d)); toast('Mangel gelöscht.'); if (S.defEdit === id) R.closeDraft('defectForm'); }
    return true;
  }
  return false;
}
export function onChange(t){
  if (t.dataset && t.dataset.keepphoto) { if (!S.defKeep) S.defKeep = new Set(); if (t.checked) S.defKeep.add(t.dataset.keepphoto); else S.defKeep.delete(t.dataset.keepphoto); return true; }
  if (t.id === 'ddLog') { if (S.defDoneDraft) S.defDoneDraft.log = t.checked; const w = $('#ddLogFields'); if (w) w.hidden = !t.checked; if (S.ops.defDoneForm) delete S.ops.defDoneForm.confirmLow; return true; }
  if (t.id === 'ddDate' && S.defDoneDraft) { S.defDoneDraft.date = t.value; renderDefects(); return true; }
  return false;
}
export function onInput(t){
  if (!S.defDoneDraft || !t.closest || !t.closest('#defDoneForm')) return false;
  if (t.id === 'ddAt') { S.defDoneDraft.atStr = t.value; if (S.ops.defDoneForm) delete S.ops.defDoneForm.confirmLow; }
  if (t.id === 'ddCost') S.defDoneDraft.costStr = t.value;
  if (t.id === 'ddNote') S.defDoneDraft.noteStr = t.value;
  return true;
}
export async function onSubmit(f, busy){
  if (f.id === 'defectForm') { await saveDefect(f, busy); return true; }
  if (f.id === 'defDoneForm') { await saveDefectDone(f, busy); return true; }
  return false;
}
