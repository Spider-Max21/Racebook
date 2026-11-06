/* Racebook – Motorrad-Ansicht: Status, Logbuch, Fahrten, Fahrwerk, Garage, Handbuch, Schnell-Eintrag.
   Aus Version 8 übernommen (geprüfte Abläufe für Vorgänge, Formulargenerationen und Korrekturen);
   neu sind Motorradfoto, Spitzname, lokale Fotos und PDFs sowie atomare Mehrfachänderungen. */
import {esc, str, fmt, eur, uid, v2, validId, safeUrl, turns, isISO, todayISO, fmtDate, canon, pad, subOf, clone} from '../util.js';
import {S, lsSet, lsJSON, bikeList, curBike, U, bikeName} from '../state.js';
import {CHECK, GROUNDS, WEATHER, FLUIDS, MONTHS, LIM, MAX_COST, BRANDS, BRAND_LIST, KW, INAMES, TEMPLATES, MODELS, MODEL_TPL, SF,
  brandOf, colorOf, plateOf, shortName, curOf, totOf, offOf, posAt, itemState, pillText, sortedItems, svcAtOf, valueAt, hasSetOn,
  serviceDoc, rideDoc, noteDoc, snapOf, sigOf, localParse, quickKindText, openDefects, DEFECT_PRIOS, canonDoc, mountTot, ambList, meterSegments, derive, dateOfMs, serviceAt} from '../domain.js';

import * as store from '../store.js';
import {opFor, parkOp, execOp, bumpGen, lowCheck, addUnres, BIKE_FORMS, cleanupFiles, payloadFiles, flow, reconcile} from '../ops.js';
import {$, $$, toast, errText, arm, VErr, fieldNum, fieldDate, imgTag, hydrate, fileUrl, icon, fmtSize} from '../ui.js';
import {makePhoto, makeBikePhoto, makePdf} from '../images.js';
import {openCropper} from '../cropper.js';
import {R} from '../registry.js';
import {jumpOk, typoPlan, checkPlan, openFix, renderMeter, meterPlaceholder, saveMeter, meterName, askSegments, SEG_SAVE_CHANGED} from './counter.js';
import {CATS, WORK, WORK_BY, catName, searchWork, ivProposal, workEntry, workLabel, customId, isCustom} from '../work.js';
import {checkListOf, deriveBike, cmpEv, CHECK_MAX} from '../domain.js';
import * as drafts from '../drafts.js';

/* ---------- Speichern mit Meldung ---------- */
const UNCLEAR_MSG = 'Unklar, ob gespeichert wurde. Versuch es gleich nochmal, dabei entsteht nichts doppelt.';
export async function sSet(coll, id, data, quiet){ const r = await store.sSetR(coll, id, data); if (r !== 'ok' && !quiet) toast(r === 'unclear' ? UNCLEAR_MSG : errText(S.lastErr)); return r === 'ok'; }
export async function sUpdate(coll, id, patch, files){ const r = await store.sUpdateR(coll, id, patch, files); if (r !== 'ok') toast(r === 'unclear' ? UNCLEAR_MSG : errText(S.lastErr)); return r === 'ok'; }
export async function sDel(coll, id, quiet){ const r = await store.sDelR(coll, id); if (r !== 'ok' && !quiet) toast(r === 'unclear' ? UNCLEAR_MSG : errText(S.lastErr)); return r === 'ok'; }
const bikeUpdate = (id, patch, files) => sUpdate('bikes', id, patch, files);
export const plateStyle = b => { const p = plateOf(b); return '--pb:' + p[0] + ';--pf:' + p[1] + ';--pd:' + p[2]; };
export const titleOf = b => b ? (b.nickname || bikeName(b) || 'Motorrad') : '';

/* ---------- Schnell-Eintrag (nur lokale Erkennung, keine KI) ---------- */
export function onQuick(e){
  e.preventDefault();
  const text = $('#quickText').value.trim();
  if (!text || !curBike()) return;
  const res = localParse(text);
  res.entries.forEach(x => { x.op = uid(); x.created = 0; });
  /* Eine ersetzte Vorschau gibt ungeklärte Versuche an die getrennte Nachverfolgung ab */
  if (S.pending) { if (S.pending.saving) return; parkPendingEntries(S.pending.entries, S.pending.epoch); }
  /* Die Vorschau gehört zum jetzt geladenen Bestand */
  S.pending = {entries: res.entries, warn: res.warn, via: 'local', text, epoch: S.epoch || ''};
  drafts.touch('quick');
  renderQuick();
}
/* Gestartete, ungeklärte Schnell-Einträge weiter abgleichen; nie gesendete oder sicher nicht gespeicherte entfallen */
/* Bereich eines Schnell-Eintrags */
const pendColl = x => x.coll || (x.kind === 'ride' ? 'rides' : x.kind === 'defect' ? 'defects' : x.kind === 'part' ? 'parts' : 'log');
export function parkPendingEntries(list, epoch){
  (list || []).forEach(x => { if (x.state === 'unclear' && x.payload) addUnres(pendColl(x), x.op, x.payload, quickKindText(x.kind === 'part' ? x.mode : x.kind) + (x.kind === 'part' ? ' ' + x.name : ''), !!x.patch, epoch, !!x.adj); });
}
/* Was ein Schnell-Eintrag speichert. Einmal beim ersten Speichern festgelegt (eingefroren).
   Vorhandenes Teil: Änderung um die gekaufte Anzahl (adj), keine feste Zielzahl. Der Speicher wendet sie auf den
   dann gespeicherten Bestand an, genau einmal je Vorgangskennung (x.op): Wiederholen zählt nicht doppelt,
   ein gleichzeitiger Einkauf in einem anderen Fenster geht nicht verloren. */
function pendingWrite(b, x){
  if (x.kind === 'ride') return {coll: 'rides', data: rideDoc(b, x)};
  if (x.kind === 'service') return {coll: 'log', data: serviceDoc(b, x)};
  if (x.kind === 'note') return {coll: 'log', data: noteDoc(b, x)};
  if (x.kind === 'reading') {
    /* Niedriger als der berechnete Stand an dieser Stelle: die Vorschau hat es als Korrektur angezeigt */
    const pos = valueAt(b.id, x.date, x.created);
    return {coll: 'log', data: canonDoc('log', {bike: b.id, kind: 'reading', date: x.date, at: x.at, atAuto: false, correction: pos != null && x.at < pos, tasks: [], taskNames: [], extra: '', cost: null, note: '', created: x.created})};
  }
  if (x.kind === 'defect') return {coll: 'defects', data: canonDoc('defects', {bike: b.id, title: x.title, description: x.description || '', date: x.date, priority: x.priority || 'mid', status: 'open', doneDate: null, repairs: 0, repairLogId: '', photos: [], created: x.created})};
  if (x.kind === 'part') {
    if (x.partId) return {coll: 'parts', adj: true, data: {id: x.partId, add: x.mode === 'bought' ? x.count : 0, low: x.mode !== 'bought'}};
    return {coll: 'parts', data: canonDoc('parts', {name: x.name, bike: b.id, qty: x.mode === 'bought' ? x.count : 0, min: 1, created: x.created})};
  }
  return null;
}
/* Vorschau mit dem aktuellen Bestand (er kann sich in einem anderen Fenster geändert haben) */
function partLive(x){
  const ex = x.partId ? S.parts.find(q => q.id === x.partId) : null;
  if (!ex) return x;
  const q = Math.round(ex.qty || 0);
  return Object.assign({}, x, x.mode === 'bought' ? {before: q, after: Math.min(99999, q + x.count)} : {before: q, after: q, min: Math.max(Math.round(ex.min || 0), q)});
}
function partText(x){
  x = partLive(x);
  if (x.mode === 'bought') return x.partId ? 'Vorrat ' + fmt(x.before, 0) + ' → ' + fmt(x.after, 0) : 'neu im Vorrat: ' + fmt(x.after, 0) + ' (nachkaufen ab 1)';
  return x.partId ? 'als knapp markieren (' + fmt(x.before, 0) + ' im Vorrat, nachkaufen ab jetzt ' + fmt(x.min, 0) + ')' : 'neu auf der Einkaufsliste (0 im Vorrat, gilt als knapp)';
}
export function renderQuick(){
  const out = $('#quickOut'), p = S.pending;
  if (!out) return;
  if (!p || (!p.entries.length && !p.warn)) { out.innerHTML = ''; return; }
  if (!p.entries.length) { out.innerHTML = '<div class="preview"><div class="kind">So habe ich es verstanden</div><p class="warnbox">' + esc(p.warn) + '</p><p class="pend-src">Dein Text: „' + esc(p.text) + '“</p><div class="row"><button class="btn ghost" type="button" id="qDrop">Schließen</button></div></div>'; return; }
  const multi = p.entries.length > 1;
  let typo = -1;
  const blocks = p.entries.map((x, i) => {
    const b = S.bikes[x.bike]; if (!b) return '';
    const u = U(b), items = b.items || [];
    const rows = [['Motorrad', bikeName(b)], ['Art', (multi ? (i + 1) + '. ' : '') + quickKindText(x.kind === 'part' ? x.mode : x.kind)]];
    if (x.kind !== 'part') rows.push(['Datum', fmtDate(x.date)]);
    if (x.kind === 'defect') {
      rows.push(['Titel', x.title || 'fehlt']);
      if (x.description) rows.push(['Beschreibung', x.description]);
      rows.push(['Priorität', prioText(x.priority)], ['Status', 'offen, erscheint unter „Mängel“']);
    } else if (x.kind === 'reading') {
      const pos = valueAt(b.id, x.date, Date.now());
      rows.push(['Stand', x.at == null ? 'fehlt' : fmt(x.at, 2) + ' ' + u + (pos != null && x.at < pos ? ' (niedriger als berechnet: ' + fmt(pos, 2) + ' ' + u + ', gilt als Korrektur)' : '')]);
      /* Einzelner, niedrigerer Stand von heute: statt der Korrektur den vorigen Tippfehler berichtigen */
      if (!multi && !p.tried && x.at != null && x.date === todayISO() && typoPlan(b, x.at)) typo = i;
    } else if (x.kind === 'part') {
      rows.push(['Teil', x.name], ['Änderung', partText(x)]);
    } else if (x.kind === 'ride') {
      rows.push(['Fahrzeit', x.amount == null ? 'fehlt' : fmt(x.amount, 2) + ' ' + u]);
      if (x.track) rows.push(['Strecke', x.track]);
      if (hasSetOn(b.id, x.date)) rows.push(['Hinweis', 'Für diesen Tag gibt es schon einen abgelesenen Stand. Die Fahrt wird dazugezählt. Steckt sie schon darin, tipp auf „Bearbeiten“.']);
    } else if (x.kind === 'service') {
      /* Stand an dieser Stelle: Verlauf bis jetzt plus Fahrten, die in der Vorschau davor stehen */
      let pos = x.date === todayISO() ? valueAt(b.id, x.date, Date.now()) : null;
      if (pos != null) p.entries.slice(0, i).forEach(y => { if (y.kind === 'ride' && y.bike === b.id && y.amount != null && y.date <= x.date) pos = Math.round((pos + y.amount) * 100) / 100; });
      let st;
      if (x.at != null) st = fmt(x.at, 2) + ' ' + u + (pos != null && x.at < pos ? ' (niedriger als berechnet: ' + fmt(pos, 2) + ' ' + u + ', gilt als Korrektur)' : '');
      else if (x.date === todayISO()) st = 'aus dem Verlauf' + (pos != null ? ', jetzt ' + fmt(pos, 2) + ' ' + u : '');
      else st = 'unbekannt (rückdatiert)';
      rows.push(['Stand', st]);
      /* Ab 1.2.0 bearbeitbar: erkannte Tätigkeiten, offene Fragen und betroffene Intervalle getrennt */
      const dis = p.saving ? ' disabled' : '';
      const works = (x.work || []).map((w, j) => '<span class="chip static">' + esc(workLabel(w)) + ' <button class="x" type="button" data-qwrm="' + i + ':' + j + '" aria-label="' + esc(w.name) + ' entfernen"' + dis + '>×</button></span>').join('');
      if (x.work) rows.push(['Tätigkeiten', works ? '<span class="chips">' + works + '</span>' : '<span class="hint">keine erkannt</span>', true]);
      (x.open || []).forEach((q, k) => rows.push(['Unklar: ' + q.label, '<span class="fix-choice" role="radiogroup" aria-label="Was wurde bei ' + esc(q.label) + ' gemacht?">' + q.options.map(o => '<label><input type="radio" name="qopen-' + i + '-' + k + '" data-qopen="' + i + ':' + k + '" value="' + esc(o) + '"' + (q.pick === o ? ' checked' : '') + dis + '> ' + esc((WORK_BY[o] || {}).name || o) + '</label>').join('')
        + '<label><input type="radio" name="qopen-' + i + '-' + k + '" data-qopen="' + i + ':' + k + '" value="-"' + (q.pick === '-' ? ' checked' : '') + dis + '> nichts davon</label></span>', true]));
      const prop = {}; ivProposal(b, (x.work || []).concat(openPicks(x)), (x.open || []).filter(q => !q.pick)).forEach(pp => { prop[pp.item] = pp; });
      rows.push(['Wartungsintervall', items.length ? '<span class="iv-list">' + items.map(it => '<label class="check"><input type="checkbox" data-qiv="' + i + ':' + esc(it.id) + '"' + (x.tasks.includes(it.id) ? ' checked' : '') + dis + '><span>' + esc(it.name) + (prop[it.id] ? ' <span class="hint">(' + esc(prop[it.id].pre ? 'vorgeschlagen ' + prop[it.id].why : prop[it.id].why) + ')</span>' : '') + '</span></label>').join('') + '</span>' : '–', true]);
      if (x.extra) rows.push(['Weiteres', x.extra]);
      if (x.orig) rows.push(['Originaleingabe', '<details class="orig"><summary>anzeigen</summary><p>' + esc(x.orig) + '</p></details>', true]);
    } else if (x.at != null) rows.push(['Stand', fmt(x.at, 2) + ' ' + u]);
    if (x.cost != null && x.kind !== 'defect' && x.kind !== 'part' && x.kind !== 'reading') rows.push(['Kosten', eur(x.cost)]);
    if (x.note && x.note !== p.text && x.kind !== 'defect') rows.push(['Notiz', x.note]);
    return '<div class="pend"><dl class="kv">' + rows.map(r => '<dt>' + r[0] + '</dt><dd>' + (r[2] ? r[1] : esc(r[1])) + '</dd>').join('') + '</dl>'
      + '<div class="row"><button class="mini" type="button" data-qedit="' + i + '"' + (p.saving ? ' disabled' : '') + '>Bearbeiten</button>' + (multi ? '<button class="mini" type="button" data-qdrop="' + i + '"' + (p.saving ? ' disabled' : '') + '>Entfernen</button>' : '')
      + (typo === i ? '<button class="mini" type="button" data-qtypo="' + i + '"' + (p.saving ? ' disabled' : '') + '>Tippfehler berichtigen …</button>' : '') + '</div></div>';
  }).join('');
  out.innerHTML = '<div class="preview"><div class="kind">So habe ich es verstanden</div>'
    + (p.warn ? '<p class="warnbox">' + esc(p.warn) + '</p>' : '')
    + '<p class="pend-src">Dein Text: „' + esc(p.text) + '“</p>' + blocks
    + (p.entries.length === 2 ? '<div class="row"><p class="hint" style="flex:1 1 200px">Gespeichert wird in dieser Reihenfolge. Sie bestimmt den Stand bei der Wartung.</p><button class="mini" type="button" id="qSwap"' + (p.saving ? ' disabled' : '') + '>Reihenfolge tauschen</button></div>' : '')
    + '<div class="row"><button class="btn primary" type="button" id="qCommit"' + (p.saving ? ' disabled' : '') + '>' + (multi ? 'Alle eintragen' : 'Eintragen') + '</button><button class="btn ghost" type="button" id="qDrop"' + (p.saving ? ' disabled' : '') + '>Verwerfen</button></div></div>';
}
async function commitPending(){
  const p = S.pending; if (!p || p.saving) return;
  if (p.entries.some(e => e.kind === 'ride' && e.amount == null)) { p.warn = 'Bei der Fahrt fehlt eine gültige Fahrzeit. Tipp auf „Bearbeiten“.'; renderQuick(); return; }
  if (p.entries.some(e => e.kind === 'defect' && !e.title)) { p.warn = 'Dem Mangel fehlt ein Titel. Tipp auf „Bearbeiten“.'; renderQuick(); return; }
  if (p.entries.some(e => e.kind === 'reading' && e.at == null)) { p.warn = 'Beim Stand fehlt eine gültige Zahl. Tipp auf „Bearbeiten“.'; renderQuick(); return; }
  /* Unklare Angaben („Gabel gemacht“) erst ausdrücklich auswählen lassen; nichts wird als Vollwartung angenommen */
  const unres = p.entries.filter(e => e.kind === 'service' && !e.payload).flatMap(e => (e.open || []).filter(q => !q.pick));
  if (unres.length) { p.warn = 'Bitte bei ' + unres.map(q => '„' + q.label + '“').join(', ') + ' auswählen, was gemacht wurde (oder „nichts davon“).'; renderQuick(); return; }
  p.entries.forEach(e => { if (e.kind === 'service' && !e.payload && (e.open || []).length) { e.work = (e.work || []).concat(openPicks(e)); e.open = []; } });
  /* Auffällig hoher Stand? Verglichen mit dem Stand an dieser Stelle, inklusive der Einträge davor in dieser Vorschau */
  const last = {};
  for (const x of p.entries) {
    const b = S.bikes[x.bike]; if (!b) continue;
    let prev = last[x.bike] && last[x.bike].date <= x.date ? last[x.bike].v : valueAt(b.id, x.date, Date.now());
    if (x.kind === 'ride') { if (prev != null && x.amount != null && (!last[x.bike] || last[x.bike].date <= x.date)) last[x.bike] = {date: x.date, v: Math.round((prev + x.amount) * 100) / 100}; continue; }
    if (x.at == null || x.payload || !['reading', 'service', 'note'].includes(x.kind)) continue;
    if (!(await jumpOk(x, b, x.date, x.at, null, prev))) { p.warn = 'Nichts gespeichert. Zum Ändern des Stands tipp beim Eintrag auf „Bearbeiten“.'; renderQuick(); return; }
    if (x.kind !== 'note') last[x.bike] = {date: x.date, v: x.at};
  }
  /* Erfassungszeit in der angezeigten Reihenfolge festlegen, einmal und vor dem ersten Speichern */
  const base = Date.now();
  p.entries.forEach((x, i) => { if (!x.created) x.created = base + i; });
  p.saving = true; p.tried = true; renderQuick();
  let ok = 0; const other = [];
  /* Vorschauzahlen für die Meldung danach festhalten */
  p.entries.forEach(x => { if (x.kind === 'part' && x.partId && !x.payload) { const l = partLive(x); x.before = l.before; x.after = l.after; } });
  try {
    /* Ein Ablauf für alle Einträge: das Einspielen einer Sicherung wartet, bis er fertig ist */
    await flow(async () => {
      for (const x of p.entries.slice()) {
        const b = S.bikes[x.bike]; if (!b) continue;
        /* Nutzdaten einmal einfrieren; eine Wiederholung sendet dieselben Daten unter derselben ID */
        if (!x.payload) { const w = pendingWrite(b, x); x.coll = w.coll; x.payload = w.data; x.patch = !!w.patch; x.adj = !!w.adj; if (w.id) x.op = w.id; }
        /* Gehört zum Bestand der Vorschau; wurde er inzwischen ersetzt, weist der Speicher den Eintrag ab */
        const r = x.adj ? await store.sAdjustR(x.payload.id, x.op, x.payload, {epoch: p.epoch})
          : x.patch ? await store.sUpdateR(x.coll, x.op, x.payload, null, {epoch: p.epoch}) : await store.sSetR(x.coll, x.op, x.payload, null, {epoch: p.epoch});
        x.state = r;
        if (r === 'ok') {
          ok++; p.entries = p.entries.filter(e => e !== x);
          /* Anderer Bestand als in der Vorschau: inzwischen auch anderswo geändert. Das Ergebnis nennen. */
          if (x.adj) { const now = store.peek('parts', x.payload.id); if (now && x.mode === 'bought' && now.qty !== x.after) other.push('„' + x.name + '“: jetzt ' + fmt(now.qty, 0) + ' im Vorrat'); }
        } else break;
      }
    });
  } finally { p.saving = false; }
  if (S.pending !== p) {
    /* Die Vorschau wurde inzwischen geschlossen, weil der Bestand ersetzt wurde */
    if (p.entries.length) toast(errText(S.lastErr) + ' ' + (ok ? ok + ' Eintrag gespeichert, der Rest nicht.' : 'Der Schnell-Eintrag wurde nicht gespeichert.'));
    return;
  }
  if (!p.entries.length) { S.pending = null; $('#quickText').value = ''; toast((ok > 1 ? ok + ' Einträge gespeichert.' : 'Eingetragen.') + (other.length ? ' ' + other.join(', ') + ', weil der Bestand inzwischen auch in einem anderen Fenster geändert wurde.' : '')); }
  else {
    const unclear = p.entries.some(e => e.state === 'unclear');
    p.warn = (ok ? ok + ' gespeichert. ' : '') + (unclear ? 'Bei einem Eintrag ist unklar, ob er gespeichert wurde. ' + (S.lastErr && S.lastErr.code === 'timeout' ? 'Der Speicher hat nicht geantwortet. Ist Racebook noch in einem anderen Tab oder Fenster offen, zum Beispiel in Chrome? Schließ es dort. ' : '') : 'Der Rest wurde nicht gespeichert. ') + 'Tipp nochmal auf „Eintragen“, es entsteht dabei kein doppelter Eintrag.';
    toast(unclear ? 'Unklar, ob gespeichert wurde.' : errText(S.lastErr));
  }
  renderQuick();
}
function editPending(i){
  const p = S.pending; if (!p || p.saving) return;
  const x = p.entries[i]; if (!x) return;
  if (x.bike !== S.bike) R.setBike(x.bike);
  /* Ein ungeklärter früherer Versuch wird getrennt weiter abgeglichen; die Bearbeitung wird ein neuer Vorgang */
  parkPendingEntries([x], p.epoch);

  if (x.kind === 'defect') {
    if (S.defEdit) R.closeDraft('defectForm');
    $('#dTitle').value = x.title || ''; $('#dDesc').value = x.description || ''; $('#dDate').value = x.date; $('#dPrio').value = x.priority || 'mid';
    $('#defectDetails').open = true; setSection('defects', 'defectDetails');
  } else if (x.kind === 'reading') {
    const f = $('#hoursForm'); f.hidden = false; f.dataset.bike = x.bike; f.dataset.epoch = S.epoch || ''; hoursReset();
    $('#hoursInput').value = x.at != null ? v2(x.at) : '';
    setSection('status'); $('#hoursInput').focus();
  } else if (x.kind === 'part') {
    /* Vorhandenes Teil: das Formular ändert genau diesen Posten (keinen neuen anlegen). Die Anzahl zeigt den
       Bestand nach dem Einkauf; gespeichert wird die Änderung gegenüber dem Bestand beim Öffnen. */
    const ex = x.partId ? S.parts.find(q => q.id === x.partId) : null;
    closeDraft('partForm');
    if (ex) {
      const l = partLive(x), q = Math.round(ex.qty || 0);
      partEditMode(ex, q);
      $('#pName').value = ex.name; $('#pQty').value = String(x.mode === 'bought' ? l.after : q); $('#pMin').value = String(x.mode === 'bought' ? Math.round(ex.min || 0) : l.min);
      const pb = $('#pBike'); if (pb && Array.from(pb.options).some(o => o.value === ex.bike)) pb.value = ex.bike;
    } else {
      $('#pName').value = x.name || ''; $('#pQty').value = String(x.mode === 'bought' ? x.count : 0); $('#pMin').value = '1';
      const pb = $('#pBike'); if (pb && Array.from(pb.options).some(o => o.value === x.bike)) pb.value = x.bike;
    }
    const det = $('#partForm').closest('details'); if (det) det.open = true; setSection('inventory', 'g-parts');
  } else if (x.kind === 'ride') {
    $('#rDate').value = x.date; $('#rAmount').value = v2(x.amount);
    $('#rTrack').value = x.track || ''; $('#rNote').value = x.note || '';
    updateRideIn();
    $('#rideDetails').open = true; setSection('rides', 'rideDetails');
  } else {
    if (S.logEdit) closeDraft('logForm');
    $('#lKind').value = x.kind === 'note' ? 'note' : 'service';
    $('#lDate').value = x.date; $('#lAt').value = v2(x.at);
    /* Tätigkeiten, Intervalle (so wie in der Vorschau gewählt) und Originaleingabe übernehmen */
    S.logWork = (x.work || []).map(w => Object.assign({}, w)).concat(openPicks(x));
    S.logTasks = new Set(x.tasks); S.logIvMan = {}; (S.bikes[x.bike] && S.bikes[x.bike].items || []).forEach(it => { S.logIvMan[it.id] = S.logTasks.has(it.id); }); S.logIvAuto = new Set();
    S.logOrig = x.orig || '';
    S.logOpen = (x.open || []).filter(q => !q.pick).map(q => q.label);
    renderLogTasks(); renderLogWork();
    $('#lExtra').value = x.extra || ''; $('#lCost').value = v2(x.cost);
    $('#lNote').value = x.note || '';
    updateLogAtHint();
    $('#logDetails').open = true; setSection('log', 'logDetails');
  }
  p.entries.splice(i, 1);
  if (!p.entries.length) { S.pending = null; $('#quickText').value = ''; }
  /* Der übernommene Inhalt ist eine ungespeicherte Eingabe im Zielformular */
  const dk = {defect: 'defect', reading: 'hours', part: 'part', ride: 'ride'}[x.kind] || 'log';
  drafts.touch(dk);
  /* Restliche Vorschau und übernommenes Formular bilden einen Vorgang (ab 1.2.1) */
  if (S.pending) drafts.link('quick', dk);
  renderQuick();
}
export function reconcilePending(){
  const p = S.pending;
  if (p && !p.saving) {
    const before = p.entries.length;
    p.entries = p.entries.filter(x => { if (x.adj) return !(x.payload && store.isApplied(x.op)); const c = pendColl(x); return !(x.payload && S.loaded[c] && S[c].some(d => d.id === x.op && !d._pending && (!x.patch || subOf(x.payload, d)))); });
    if (p.entries.length !== before) { if (!p.entries.length) { S.pending = null; const q = $('#quickText'); if (q) q.value = ''; } toast('Der Eintrag ist gespeichert.'); }
  }
}

/* ---------- Formulare schließen ---------- */
export function closeDraft(k){
  if (k === 'doneForm') { S.doneOpen = null; S.doneDraft = null; }
  else if (k === 'logForm') { $('#logForm').reset(); $('#lDate').value = todayISO(); $('#lKind').value = 'service'; resetLogState(); $('#logDetails').open = false; logMode(); renderLogWork(); renderLogTasks(); }
  else if (k === 'rideForm') { $('#rideForm').reset(); $('#rDate').value = todayISO(); $('#rideDetails').open = false; }
  else if (k === 'hoursForm') { const hf = $('#hoursForm'); hf.hidden = true; hoursReset(); }
  else if (k === 'meterForm') { const mf = $('#meterForm'); if (mf) { mf.reset(); $('#mDate').value = todayISO(); meterPlaceholder(curBike()); } }
  else if (k === 'setupForm') { resetSetupForm(); $('#setupDetails').open = false; }
  else if (k === 'partForm') { $('#pName').value = ''; $('#pQty').value = '1'; $('#pMin').value = '1'; partEditMode(null); }
  else if (k === 'addBikeForm') { S.adding = false; dropAddPhoto(); const el = $('#addBike'); if (el) el.innerHTML = ''; }
  else if (k === 'defectForm' || k === 'defDoneForm') { R.closeDefectDraft(k); }
  bumpGen(k);
  if (DRAFT_OF[k]) drafts.mark(DRAFT_OF[k]);
}
/* Formular → Entwurf (drafts.js) */
const DRAFT_OF = {hoursForm: 'hours', doneForm: 'done', logForm: 'log', rideForm: 'ride', setupForm: 'setup', partForm: 'part', meterForm: 'meter', addBikeForm: 'add', defectForm: 'defect', defDoneForm: 'defDone'};
function resetLogState(){
  S.logTasks = new Set(); S.logWork = []; S.logIvMan = {}; S.logIvAuto = new Set(); S.logOrig = ''; S.logOpen = []; S.logEdit = null; S.logEditPrev = null;
}

/* Stand-Formular: Hinweis auf eine Korrektur und „Tippfehler berichtigen“ zurücksetzen */
function hoursReset(){ const hf = $('#hoursForm'); delete hf.dataset.confirm; $('#hoursHint').hidden = true; $('#hoursTypo').hidden = true; $('#hoursSave').textContent = 'Speichern'; }

/* Teileformular: neues Teil anlegen (Standard) oder einen vorhandenen Posten ändern (aus „Bearbeiten“ im Schnell-Eintrag) */
function partEditMode(ex, base){
  const f = $('#partForm'); if (!f) return;
  if (ex) { f.dataset.part = ex.id; f.dataset.base = String(base); } else { delete f.dataset.part; delete f.dataset.base; }
  /* Grundlage des Entwurfs (ab 1.3.1): gespeicherte Angaben beim Öffnen; beim Speichern zählen nur Abweichungen davon.
     Ab 1.3.2 aus genau dem Datensatz, aus dem auch das Formular befüllt wird (ex), nie aus einem anderen Stand. */
  S.partBase = ex ? {id: ex.id, name: ex.name, bike: ex.bike, min: ex.min} : null;
  const pc = $('#partConflict'); if (pc) { pc.hidden = true; pc.textContent = ''; }
  $('#partFormTitle').textContent = ex ? 'Teil ändern' : 'Teil hinzufügen';
  $('#pSave').textContent = ex ? 'Speichern' : 'Hinzufügen';
  $('#pCancel').hidden = !ex;
  const h = $('#partEditHint'); h.hidden = !ex;
  h.textContent = ex ? 'Du änderst den vorhandenen Posten „' + ex.name + '“ (beim Öffnen ' + fmt(base, 0) + ' im Vorrat). Anzahl = Bestand nach dem Speichern. Kauft jemand in einem anderen Fenster gleichzeitig dazu, wird beides gezählt.' : '';
}

/* Lagerartikel inzwischen in einem anderen Fenster geändert (ab 1.3.1): nichts gespeichert. Eigene Eingaben bleiben,
   unveränderte Felder zeigen den aktuellen Stand, die Anzahl behält die eigene Änderung. Die neue Grundlage ist der
   aktuelle Stand; erneutes Speichern übernimmt die eigenen Angaben bewusst. */
async function partConflict(pid, pay, base, qty, pb0){
  await store.reloadAll().catch(() => {});
  const f = $('#partForm'), now = store.peek('parts', pid);
  if (!now || f.dataset.part !== pid) { if (!now) { closeDraft('partForm'); toast('Dieses Teil gibt es inzwischen nicht mehr. Es wurde nichts gespeichert.'); } return; }
  const set = pay.set || {}, nm = id => id === 'both' ? 'alle Motorräder' : S.bikes[id] ? titleOf(S.bikes[id]) : 'nicht zugeordnet';
  const show = {name: v => '„' + v + '“', bike: nm, min: v => fmt(v, 0)}, label = {name: 'Name', bike: 'Für', min: 'Nachkaufen ab'};
  const both = [];
  ['name', 'bike', 'min'].forEach(k => {
    if (k in set) { if (canon(now[k]) !== canon(pb0[k]) && canon(now[k]) !== canon(set[k])) both.push(label[k] + ': dort ' + show[k](now[k]) + ', bei dir ' + show[k](set[k])); }
    else if (k === 'name') $('#pName').value = now.name;
    else if (k === 'bike') { const pb = $('#pBike'); if (Array.from(pb.options).some(x => x.value === now.bike)) pb.value = now.bike; }
    else $('#pMin').value = String(now.min);
  });
  const delta = qty - base;
  S.partBase = {id: pid, name: now.name, bike: now.bike, min: now.min};
  f.dataset.base = String(now.qty); $('#pQty').value = String(Math.max(0, Math.min(99999, now.qty + delta)));
  const pc = $('#partConflict');
  pc.textContent = 'Dieser Artikel wurde inzwischen in einem anderen Fenster geändert. Es wurde nichts gespeichert. ' + (both.length ? both.join('; ') + '. ' : '')
    + 'Dort sind jetzt ' + fmt(now.qty, 0) + ' im Vorrat' + (delta ? '; deine Änderung (' + (delta > 0 ? '+' : '') + delta + ') steht noch im Formular' : '') + '. Tipp erneut auf „Speichern“, um deine Angaben zu übernehmen.';
  pc.hidden = false; drafts.touch('part');
  toast(EDIT_MSG);
}

/* ---------- Anzeige ---------- */
function renderBanner(){
  const el = $('#banner'), b = curBike(), rows = [];
  if (!el) return;
  if (b) {
    const due = [], soon = [], chk = [];
    (b.items || []).forEach(it => { const st = itemState(b, it); if (st.s === 'bad') due.push(it.name); else if (st.s === 'warn') soon.push(it.name + ' (' + pillText(b, st) + ')'); else if (st.s === 'chk' && !st.amb) chk.push(it.name); });
    /* Angaben vom Tag eines Zählerwechsels, bei denen nicht feststeht, welcher Zähler gemeint war (Daten aus 1.1.0 und älter) */
    const amb = ambList(b);
    if (amb.length) rows.push('<div class="banner-row chk"><b>' + esc(meterName(b)) + ' ersetzt: Angaben zuordnen</b><span>' + esc(amb.map(a => a.label).join(', ')) + '</span><button class="mini" type="button" data-segfix="' + esc(b.id) + '">Zuordnen</button></div>');
    /* Widerspruch im Verlauf: lässt er sich als Tippfehler berichtigen, gibt es „Prüfen“ (Vorschau), sonst zum Punkt */
    if (chk.length) rows.push(checkPlan(b)
      ? '<div class="banner-row chk"><b>Wartungsstand prüfen</b><span>' + esc(chk.join(', ')) + '</span><button class="mini" type="button" data-chk="' + esc(b.id) + '">Prüfen</button></div>'
      : '<button class="banner-row warn" type="button" data-goto="status" data-anchor="c-items"><b>Wartungsstand prüfen</b><span>' + esc(chk.join(', ')) + ': Stand der letzten Wartung liegt über dem heutigen</span></button>');
    if (due.length) rows.push('<button class="banner-row" type="button" data-goto="status" data-anchor="c-items"><b>Überfällig</b><span>' + esc(due.join(', ')) + '</span></button>');
    if (soon.length) rows.push('<button class="banner-row warn" type="button" data-goto="status" data-anchor="c-items"><b>Bald fällig</b><span>' + esc(soon.join(', ')) + '</span></button>');
  }
  const low = S.parts.filter(p => p.qty <= p.min && (!b || p.bike === 'both' || p.bike === b.id));
  if (low.length) rows.push('<button class="banner-row warn" type="button" data-goto="inventory" data-anchor="g-parts"><b>Nachkaufen</b><span>' + esc(low.map(p => p.name + ' (' + fmt(p.qty, 0) + ')').join(', ')) + '</span></button>');
  el.innerHTML = rows.join('');
  el.hidden = !rows.length;
}

export function modelOptions(brand){
  const g = MODELS[brand]; if (!g) return '';
  return ['mx4', 'en4', 't2', 'street'].filter(k => g[k]).reduce((a, k) => a.concat(g[k].split('|')), []).map(m => '<option value="' + esc(m) + '"></option>').join('');
}
function addBikeHTML(){
  /* Marken alphabetisch, keine vorausgewählt */
  const opts = '<option value="" selected disabled>Marke wählen</option>' + BRAND_LIST.map(b => '<option value="' + esc(b.n) + '">' + esc(b.n) + '</option>').join('');
  const tpl = Object.keys(TEMPLATES).map(k => '<option value="' + k + '">' + esc(TEMPLATES[k].label) + '</option>').join('');
  return '<div class="card"><div class="card-h"><h2>Motorrad hinzufügen</h2>' + (bikeList().length ? '<button class="link" type="button" id="addCancel">Abbrechen</button>' : '') + '</div>'
    + '<form id="addBikeForm" class="grid" novalidate>'
    + '<div class="f"><label for="abBrand">Marke</label><select id="abBrand">' + opts + '</select></div>'
    + '<div class="f"><label for="abColor">Farbe</label><input type="color" id="abColor" value="#4F6D7A"></div>'
    + '<div class="f full" id="abBrandOtherWrap" hidden><label for="abBrandOther">Markenname</label><input id="abBrandOther" autocomplete="off" placeholder="z. B. Rieju"></div>'
    + '<div class="f"><label for="abModel">Modell</label><input id="abModel" list="abModels" autocomplete="off" placeholder="tippen oder wählen"><datalist id="abModels"></datalist></div>'
    + '<div class="f"><label for="abYear">Baujahr</label><input id="abYear" inputmode="numeric" autocomplete="off"></div>'
    + '<div class="f full"><label for="abNick">Spitzname (optional)</label><input id="abNick" maxlength="40" autocomplete="off" placeholder="z. B. Die Orange"></div>'
    + '<div class="f full"><label for="abTpl">Wartungspunkte vorbelegen</label><select id="abTpl">' + tpl + '</select></div>'
    + '<div class="f full"><label for="abUnit">Zählt nach</label><select id="abUnit"><option value="h">Betriebsstunden</option><option value="km">Kilometern</option></select></div>'
    + '<div class="f full"><span class="lbl" id="abPhotoLbl">Foto (optional)</span><div class="photo-pick" id="abPhotoBox">' + addPhotoInner() + '</div></div>'
    + '<p class="hint full">Die Vorlagen sind Richtwerte, keine Herstellerangaben. Du kannst alles später unter Wartung → Intervalle verwalten anpassen.</p>'
    + '<div class="f full"><button class="btn primary" type="submit">Motorrad anlegen</button></div></form></div>';
}
function addPhotoInner(){
  const a = S.addPhoto;
  return (a ? '<img class="pick-prev" src="' + a.url + '" alt="Gewählter Ausschnitt">' : '<div class="pick-ph">' + icon('camera') + '</div>')
    + '<div class="row"><label class="btn" for="abPhoto">' + (a ? 'Anderes Foto' : 'Foto wählen') + '</label><input type="file" id="abPhoto" accept="image/*" class="sr-file">'
    + (a ? '<button class="btn ghost" type="button" id="abPhotoDrop">Entfernen</button>' : '') + '</div>';
}
function dropAddPhoto(){ if (S.addPhoto) { URL.revokeObjectURL(S.addPhoto.url); S.addPhoto = null; } }
export function renderAddBike(){
  const el = $('#addBike'); if (!el) return;
  const show = S.mode === 'ready' && R.route.page === 'add';
  if (!show) { if (el.innerHTML) el.innerHTML = ''; return; }
  if (!el.innerHTML) { el.innerHTML = addBikeHTML(); drafts.mark('add'); }
}

export function renderStatus(){
  const b = curBike(); if (!b) return;
  const u = U(b), cur = curOf(b);
  $('#statusPhoto').innerHTML = b.photo ? imgTag(b.photo.id, 'Foto von ' + titleOf(b), 'hero-photo') : '';
  const off = offOf(b), tot = totOf(b);
  /* Nach einem Zählerwechsel: Schild = Anzeige des eingebauten Zählers, darunter die Gesamtlaufleistung */
  $('#plateLabel').textContent = off ? 'Zähleranzeige' : (u === 'km' ? 'Kilometerstand' : 'Betriebsstunden');
  $('#plateNum').textContent = cur == null ? '–' : fmt(cur);
  const pt = $('#plateTotal'); pt.hidden = !off; pt.textContent = off && tot != null ? 'Gesamtlaufleistung ' + fmt(tot) + ' ' + u : '';
  $('#plateUnit').textContent = u;
  $('#plateBtn').setAttribute('style', plateStyle(b));
  $('#plateBtn').setAttribute('aria-label', (cur == null ? 'Stand unbekannt' : (off ? 'Zähleranzeige ' : 'Stand ') + fmt(cur) + ' ' + (u === 'km' ? 'Kilometer' : 'Stunden')) + (off && tot != null ? ', Gesamtlaufleistung ' + fmt(tot) : '') + ', ändern');
  const next = sortedItems(b).filter(x => x.st.s !== 'unk')[0];
  const last = S.log.filter(l => l.bike === b.id && l.kind === 'service')[0];
  const lines = [];
  if (cur == null) lines.push('<p>Tipp aufs Schild und trag deinen aktuellen Stand ein.</p>');
  if (next) lines.push('<p class="hint">Als Nächstes</p><p><b>' + esc(next.it.name) + '</b>: ' + esc(pillText(b, next.st)) + '</p>');
  else if (cur != null) lines.push('<p class="hint">Tipp unten bei einem Wartungspunkt auf „Erledigt“ und trag ein, wann du ihn zuletzt gemacht hast.</p>');
  if (last) lines.push('<p class="hint">Letzte Wartung ' + fmtDate(last.date) + ': ' + esc((Array.isArray(last.work) && last.work.length ? last.work.map(w => w.name).concat(last.extra ? [last.extra] : []) : [].concat(last.taskNames || [], last.extra ? [last.extra] : [])).join(', ') || 'Eintrag') + '</p>');
  $('#heroMeta').innerHTML = lines.join('');

  $('#itemList').innerHTML = (b.items || []).length ? sortedItems(b).map(({it, st}) => {
    const parts = [];
    if (it.every) parts.push('alle ' + fmt(it.every) + ' ' + u);
    if (it.months) parts.push('alle ' + it.months + ' Mon.');
    let sub = parts.join(' / ') || 'kein Intervall';
    const m = st.m;
    /* Nach einem Zählerwechsel als Gesamtlaufleistung, damit es zur Restlaufzeit passt */
    if (m && (m.at != null || m.date)) sub += ' · zuletzt ' + (m.at != null ? 'bei ' + fmt(m.at, 2) + ' ' + u + (off ? ' gesamt' : '') + ' ' : '') + (m.date ? '(' + fmtDate(m.date) + ')' : '') + (m.at == null && it.every ? ', Stand unbekannt' : '');
    else sub += ' · noch kein Eintrag';
    const open = S.doneOpen === it.id, d = S.doneDraft || {};
    const so = S.ops.doneForm, saving = !!(so && so.saving && so.item === it.id && so.bike === b.id);
    const past = d.date && d.date !== todayISO();
    return '<div class="item s-' + st.s + '"><div class="item-main"><div class="item-name">' + esc(it.name) + '</div><div class="item-sub">' + esc(sub) + '</div><div class="bar"><i style="width:' + Math.round(st.used * 100) + '%"></i></div></div>'
      + '<div class="item-side"><span class="pill ' + st.s + '">' + icon(st.s) + esc(pillText(b, st)) + '</span>' + (open ? '' : '<button class="mini" type="button" data-done="' + esc(it.id) + '">Erledigt</button>') + '</div>'
      + (open ? '<form class="done-form" id="doneForm" data-item="' + esc(it.id) + '" data-bike="' + esc(b.id) + '" novalidate>'
        + '<div class="f"><label for="dfDate">Erledigt am</label><input type="date" id="dfDate" value="' + esc(d.date || todayISO()) + '" max="' + todayISO() + '"></div>'
        + '<div class="f"><label for="dfAt">' + (past ? 'Stand damals' : 'abgelesen') + ' (' + u + ')</label><input id="dfAt" inputmode="decimal" autocomplete="off" value="' + esc(d.atStr || '') + '" placeholder="' + (past ? 'unbekannt' : (cur == null ? 'unbekannt' : esc(v2(cur)) + ' (Verlauf)')) + '"></div>'
        + '<div class="f"><label for="dfCost">Kosten (€)</label><input id="dfCost" inputmode="decimal" autocomplete="off" value="' + esc(d.costStr || '') + '"></div>'
        + '<p class="hint" style="grid-column:1/-1">' + (past ? 'Weißt du den Stand von damals nicht, zählt für diesen Punkt nur die Frist in Monaten.' : 'Leer lassen, wenn du nicht abgelesen hast. Der Stand ergibt sich dann aus dem Verlauf.') + '</p>'
        + '<div class="row"><button class="btn primary" type="submit"' + (saving ? ' disabled' : '') + '>' + (saving ? 'Wird gespeichert …' : 'Eintragen') + '</button><button class="btn ghost" type="button" id="dfCancel"' + (saving ? ' disabled' : '') + '>Abbrechen</button></div></form>' : '')
      + '</div>';
  }).join('') : '<p class="hint">Noch keine Wartungspunkte. Leg sie unter Wartung → Intervalle verwalten an.</p>';

  const defs = openDefects(b.id).slice().sort((x, y) => prioRank(x) - prioRank(y) || (y.date || '').localeCompare(x.date || ''));
  $('#statusDefects').innerHTML = defs.length
    ? '<ul class="mini-list">' + defs.slice(0, 4).map(d => '<li><span class="prio ' + d.priority + '">' + esc(prioText(d.priority)) + '</span><span>' + esc(d.title) + (d.status === 'progress' ? ' <span class="hint">(in Arbeit)</span>' : '') + '</span></li>').join('') + '</ul>'
      + (defs.length > 4 ? '<p class="hint">und ' + (defs.length - 4) + ' weitere</p>' : '')
    : '<p class="hint">Keine offenen Mängel.</p>';
  $('#statusDefCount').textContent = defs.length ? defs.length + ' offen' : '';
  $('#mountSum').innerHTML = mountHTML(b);
  renderChecklist(b);
  hydrate($('#v-status'));
}
export const prioRank = d => ({high: 0, mid: 1, low: 2})[d.priority] ?? 1;
export const prioText = p => (DEFECT_PRIOS.find(x => x[0] === p) || [0, 'mittel'])[1];

/* Gelaufen seit der Montage: Gesamtlaufleistung jetzt minus Gesamtlaufleistung bei der Montage (eingetragen wird die
   Anzeige des Zählers, der damals eingebaut war; welcher das war, bestimmt die Stelle der Angabe im Verlauf, mountTot) */
function runtime(b, x){
  const tot = totOf(b); if (!x || x.at == null || tot == null) return '';
  const m = mountTot(b, x);
  if (m.amb) return 'Zähler unklar, bitte zuordnen';
  if (m.tot > tot + 0.005) return 'Montagestand prüfen';
  return fmt(Math.max(0, Math.round((tot - m.tot) * 100) / 100)) + ' ' + U(b) + ' gelaufen';
}
function mountHTML(b){
  const t = b.tires || {}, c = b.chain || {}, tf = t.front || {}, tr = t.rear || {};
  const ratio = (c.front && c.rear) ? ' · ' + fmt(c.rear / c.front, 2) : '';
  const cell = (lbl, val, run) => '<div class="mount-cell"><span class="lbl">' + lbl + '</span><b>' + (val ? esc(val) : '<span class="hint">nicht eingetragen</span>') + '</b>' + (run ? '<span class="run">' + esc(run) + '</span>' : '') + '</div>';
  return '<div class="mount">'
    + cell('Reifen vorn', tf.model, runtime(b, tf))
    + cell('Reifen hinten', tr.model, runtime(b, tr))
    + cell('Übersetzung', (c.front && c.rear) ? c.front + ' / ' + c.rear + ratio : '', '')
    + cell('Kette', [c.brand, c.links ? c.links + ' Glieder' : ''].filter(Boolean).join(', '), runtime(b, c))
    + '</div>';
}

/* ---------- Checkliste „Vor der Fahrt“ (ab 1.2.0 je Motorrad anpassbar) ----------
   Die Liste gehört zum Motorrad und zur Sicherung (bikes.checklist; ohne eigene Liste gilt die Standardliste CHECK).
   Die Haken gelten wie bisher für einen Fahrtag und nur auf diesem Gerät (localStorage check-<Motorrad>): Am nächsten Tag
   beginnt die Liste leer. Abhaken erzeugt keinen Logbuch-Eintrag und setzt keine Wartung zurück.
   Haken aus 1.1.x (gespeichert als Positionen 0–8) werden über die IDs c0–c8 übernommen, sie gehen nicht verloren. */
function checkState(b){
  const s = lsJSON('check-' + b.id, null);
  if (s && Array.isArray(s.done) && !Array.isArray(s.ids)) {
    s.ids = s.done.filter(i => Number.isInteger(i) && CHECK[i] && i < 9).map(i => CHECK[i].id);
    if (s.date === todayISO()) lsSet('check-' + b.id, JSON.stringify({date: s.date, ids: s.ids}));
  }
  if (s && s.date === todayISO() && Array.isArray(s.ids)) return {date: s.date, ids: s.ids.filter(x => typeof x === 'string')};
  return {date: todayISO(), ids: [], prev: s && Array.isArray(s.ids) && s.ids.length && typeof s.date === 'string' ? {date: s.date, n: s.ids.length} : null};
}
function renderChecklist(b){
  const s = checkState(b), list = checkListOf(b), done = s.ids.filter(id => list.some(c => c.id === id));
  $('#checkList').innerHTML = list.length ? list.map(c => { const on = done.includes(c.id); return '<label class="check' + (on ? ' done' : '') + '"><input type="checkbox" data-check="' + esc(c.id) + '"' + (on ? ' checked' : '') + '><span>' + esc(c.name) + '</span></label>'; }).join('')
    : '<p class="hint">Die Liste ist leer. Über „Liste anpassen“ kannst du Punkte hinzufügen.</p>';
  $('#checkCount').textContent = done.length + ' von ' + list.length;
  $('#checkDay').textContent = 'Fahrtag ' + fmtDate(s.date) + '. Die Haken gelten für heute und nur auf diesem Gerät; am nächsten Tag beginnt die Liste leer. Abhaken trägt nichts ins Logbuch ein und setzt keine Wartung zurück.'
    + (s.prev ? ' Am ' + fmtDate(s.prev.date) + ' waren ' + s.prev.n + ' Punkte abgehakt.' : '');
  renderCheckEditor();
}
function openCheckEdit(){
  const b = curBike(); if (!b) return;
  const raw = store.peek('bikes', b.id), cur = checkListOf(b);
  const items = cur.map(c => ({id: c.id, name: c.name, on: true, own: !CHECK.some(d => d.id === c.id)}));
  CHECK.forEach(d => { if (!items.some(x => x.id === d.id)) items.push({id: d.id, name: d.name, on: false}); });
  S.checkDraft = {bike: b.id, epoch: S.epoch || '', base: raw ? clone(nu(raw.checklist)) : null, items, msg: ''};
  renderCheckEditor(); drafts.mark('check');
  const f = $('#checkForm input'); if (f) f.focus();
}
function closeCheckEdit(){ S.checkDraft = null; drafts.forget('check'); renderCheckEditor(); }
function renderCheckEditor(){
  const el = $('#checkEditor'), d = S.checkDraft, b = curBike();
  if (d && (!b || d.bike !== b.id)) { S.checkDraft = null; drafts.forget('check'); }
  const dd = S.checkDraft;
  $('#checkActions').hidden = !!dd;
  if (!dd) { if (el.innerHTML) el.innerHTML = ''; return; }
  if (el.querySelector('#checkForm') && el.dataset.v === canon(dd.items) + dd.msg) return;
  const keepNew = $('#checkNew') ? $('#checkNew').value : '';
  el.dataset.v = canon(dd.items) + dd.msg;
  el.innerHTML = '<form id="checkForm" class="stack check-form" novalidate>' + (dd.msg ? '<p class="warnbox" role="alert">' + esc(dd.msg) + '</p>' : '')
    + '<p class="hint">Häkchen = Punkt steht in der Liste. Reihenfolge mit ▲ und ▼. Eigene Punkte kannst du hinzufügen und entfernen.</p><ul class="check-edit">'
    + dd.items.map((c, i) => '<li><label class="check"><input type="checkbox" data-chkon="' + i + '"' + (c.on ? ' checked' : '') + '><span>' + esc(c.name) + '</span></label><span class="row">'
      + '<button class="mini" type="button" data-chkmv="' + i + ':-1" aria-label="' + esc(c.name) + ' nach oben"' + (i ? '' : ' disabled') + '>▲</button>'
      + '<button class="mini" type="button" data-chkmv="' + i + ':1" aria-label="' + esc(c.name) + ' nach unten"' + (i < dd.items.length - 1 ? '' : ' disabled') + '>▼</button>'
      + (c.own ? '<button class="mini" type="button" data-chkrm="' + i + '" aria-label="' + esc(c.name) + ' entfernen">×</button>' : '') + '</span></li>').join('') + '</ul>'
    + '<div class="row"><label for="checkNew" class="sr">Eigener Punkt</label><input id="checkNew" maxlength="80" placeholder="Eigener Punkt, z. B. Startnummer" autocomplete="off"><button class="mini" type="button" id="checkAdd">Hinzufügen</button></div>'
    + '<div class="row"><button class="btn primary" type="button" id="checkSave">Liste speichern</button><button class="btn ghost" type="button" id="checkCancel">Abbrechen</button><button class="btn ghost" type="button" id="checkDefault">Standardliste</button></div></form>';
  if (keepNew) $('#checkNew').value = keepNew;
}
/* Mehr als CHECK_MAX Punkte: im Entwurf bleiben, mit Meldung */
function checkFull(pend){
  const d = S.checkDraft; if (!d) return;
  d.msg = 'Die Checkliste kann höchstens ' + CHECK_MAX + ' Punkte haben. ' + (pend ? '„' + pend + '“ wurde nicht hinzugefügt und nichts gespeichert. ' : 'Es wurde nichts gespeichert. ') + 'Nimm erst einen anderen Punkt heraus (Häkchen weg oder ×).';
  renderCheckEditor(); if (pend && $('#checkNew')) $('#checkNew').value = pend;
  toast('Höchstens ' + CHECK_MAX + ' Punkte. Es wurde nichts gespeichert.');
}
/* Nur das Feld checklist schreiben und nur, wenn es noch dem Stand beim Öffnen entspricht */
async function saveCheckEdit(){
  const d = S.checkDraft, b = d && S.bikes[d.bike]; if (!b) { closeCheckEdit(); return true; }
  /* Ein eingegebener, noch nicht hinzugefügter eigener Punkt wird mitgespeichert (ab 1.2.1), nicht still verworfen */
  const ni = $('#checkNew'), pend = ni ? str(ni.value).slice(0, 80) : '';
  let adopted = '';
  if (pend) {
    const same = d.items.find(c => str(c.name).toLowerCase() === pend.toLowerCase());
    /* Höchstzahl: der Punkt bleibt im Feld, nichts wird gespeichert (ab 1.2.2) */
    if (!(same && same.on) && d.items.filter(c => c.on).length >= CHECK_MAX) { checkFull(pend); return false; }
    if (same) same.on = true; else d.items.push({id: 'u' + uid(), name: pend, on: true, own: true});
    ni.value = ''; adopted = pend; renderCheckEditor();
  }
  if (d.items.filter(c => c.on).length > CHECK_MAX) { checkFull(''); return false; }
  const list = d.items.filter(c => c.on).map(c => ({id: c.id, name: c.name}));
  const val = canon(list) === canon(CHECK) ? null : list;
  const r = await flow(() => store.commitR([{coll: 'bikes', id: b.id, patch: {checklist: val}, guard: {checklist: d.base}}], null, 'checkliste', {epoch: d.epoch}));
  if (S.checkDraft !== d) return r === 'ok';
  if (r === 'ok') { closeCheckEdit(); renderChecklist(S.bikes[b.id] || b); toast(adopted ? 'Checkliste gespeichert, mit „' + adopted + '“.' : 'Checkliste gespeichert.'); return true; }
  if (r === 'fail' && S.lastErr && S.lastErr.code === 'changed') {
    await store.reloadAll().catch(() => {});
    const raw = store.peek('bikes', b.id); if (!raw) { closeCheckEdit(); toast('Das Motorrad gibt es nicht mehr.'); return false; }
    d.base = clone(nu(raw.checklist));
    d.msg = EDIT_MSG + ' Dort gilt jetzt: ' + (checkListOf(S.bikes[b.id] || raw).map(c => c.name).join(', ') || 'keine Punkte') + '. Deine Auswahl steht noch hier; tipp erneut auf „Liste speichern“, um sie zu übernehmen.';
    renderCheckEditor(); toast(EDIT_MSG); return false;
  }
  toast(r === 'fail' ? errText(S.lastErr) + ' Es wurde nichts gespeichert.' : UNCLEAR_MSG); return false;
}

/* ---------- Logbuch-Formular: Tätigkeiten und betroffene Intervalle (ab 1.2.0) ----------
   S.logWork = gewählte Tätigkeiten, S.logTasks = gewählte Intervalle. Vorschläge (ivProposal) wählen ein Intervall nur vor,
   wenn die Tätigkeiten es vollständig abdecken; was der Nutzer selbst an- oder abwählt (S.logIvMan), bleibt so. */
export function renderLogTasks(){
  const b = curBike(); if (!b) return;
  const prop = ivProposal(b, S.logWork || [], []), why = {};
  prop.forEach(p => { why[p.item] = p; });
  $('#lTasks').innerHTML = (b.items || []).map(it => '<button type="button" class="chip' + (why[it.id] ? ' proposed' : '') + '" data-task="' + esc(it.id) + '" aria-pressed="' + S.logTasks.has(it.id) + '"' + (why[it.id] ? ' title="' + esc(why[it.id].why) + '"' : '') + '>' + esc(it.name) + '</button>').join('') || '<span class="hint">Keine Wartungspunkte angelegt.</span>';
  const hints = prop.map(p => { const it = (b.items || []).find(x => x.id === p.item); return it ? '„' + it.name + '“: ' + (p.pre ? 'vorgeschlagen ' + p.why : p.why) : ''; }).filter(Boolean);
  $('#lIvHint').textContent = hints.length ? hints.join(' · ') : 'Nur ankreuzen, was durch diese Arbeit tatsächlich erledigt ist. Abhaken setzt die Fälligkeit dieses Punkts zurück.';
}
/* Intervallvorschlag nach einer Änderung der Tätigkeiten anwenden, ohne bewusste Auswahl zu überschreiben */
function applyIvProposal(b){
  const pre = new Set(ivProposal(b, S.logWork || [], []).filter(p => p.pre).map(p => p.item));
  S.logIvAuto = S.logIvAuto || new Set(); S.logIvMan = S.logIvMan || {};
  Array.from(S.logIvAuto).forEach(id => { if (!pre.has(id) && !(id in S.logIvMan)) { S.logTasks.delete(id); S.logIvAuto.delete(id); } });
  pre.forEach(id => { if (!(id in S.logIvMan) && !S.logTasks.has(id)) { S.logTasks.add(id); S.logIvAuto.add(id); } });
}
const favsOf = b => (b && Array.isArray(b.favs)) ? b.favs : [];
function renderLogWork(){
  const b = curBike(); if (!b) return;
  const list = S.logWork || [], favs = favsOf(b), note = $('#lKind').value === 'note';
  $('#lWorkSet').hidden = note;
  $('#lTasks').closest('.f').hidden = note;
  const open = (S.logOpen || []).length ? '<div class="warnbox"><p>Noch offen: ' + esc(S.logOpen.map(x => '„' + x + '“').join(', ')) + '. Wähl unten aus, was tatsächlich gemacht wurde.</p><button class="mini" type="button" data-wopenok="1">Ist ausgewählt</button></div>' : '';
  $('#lWork').innerHTML = open + (list.length ? list.map((w, i) => '<div class="work-row"><span class="work-name"><b>' + esc(w.name) + '</b><span class="hint"> ' + esc(catName(w.cat)) + '</span></span>'
    + '<input data-wdetail="' + i + '" value="' + esc(w.detail || '') + '" placeholder="Angaben (optional)" aria-label="Angaben zu ' + esc(w.name) + '" maxlength="300">'
    + '<button class="mini star" type="button" data-wfav="' + esc(w.id) + '" data-wname="' + esc(w.name) + '" aria-pressed="' + favs.includes(w.id) + '" aria-label="' + esc(w.name) + ' als Favorit für dieses Motorrad">' + (favs.includes(w.id) ? '★' : '☆') + '</button>'
    + '<button class="mini" type="button" data-wrm="' + i + '" aria-label="' + esc(w.name) + ' entfernen">×</button></div>').join('') : '<p class="hint">Noch keine Tätigkeit gewählt. Tipp unten auf eine Arbeit oder such im ganzen Katalog.</p>');
  const chosen = new Set(list.map(w => w.id));
  const favW = favs.map(id => WORK_BY[id] || (isCustom(id) ? {id, name: customName(b, id)} : null)).filter(w => w && !chosen.has(w.id));
  const common = WORK.filter(w => w.common && !chosen.has(w.id) && !favs.includes(w.id));
  $('#lWorkPick').innerHTML = favW.map(w => '<button type="button" class="chip fav" data-wadd="' + esc(w.id) + '" data-wname="' + esc(w.name) + '">★ ' + esc(w.name) + '</button>').join('')
    + CATS.map(([c]) => common.filter(w => w.cat === c).map(w => '<button type="button" class="chip" data-wadd="' + esc(w.id) + '">' + esc(w.name) + '</button>').join('')).join('');
  renderWorkResults();
}
/* Name einer eigenen Tätigkeit (Favorit) aus früheren Einträgen */
function customName(b, id){
  const l = S.log.find(x => x.bike === b.id && (x.work || []).some(w => w.id === id));
  return l ? l.work.find(w => w.id === id).name : id.slice(2).replace(/-/g, ' ');
}
function renderWorkResults(){
  const el = $('#lWorkRes'), q = str($('#lWorkSearch').value);
  if (!q) { el.innerHTML = ''; return; }
  const chosen = new Set((S.logWork || []).map(w => w.id));
  const res = searchWork(q).filter(w => !chosen.has(w.id));
  el.innerHTML = res.map(w => '<button type="button" class="chip" data-wadd="' + esc(w.id) + '">' + esc(w.name) + ' <span class="hint">' + esc(catName(w.cat)) + '</span></button>').join('')
    + '<button type="button" class="chip free" data-wfree="1">„' + esc(q.slice(0, 120)) + '“ als eigene Tätigkeit</button>';
}
function addLogWork(id, name){
  const b = curBike(); if (!b) return;
  const w = WORK_BY[id] ? workEntry(id) : workEntry(customId(name), name, '', 'wartung');
  if (!w.name || (S.logWork || []).some(x => x.id === w.id)) return;
  S.logWork = (S.logWork || []).concat([w]);
  applyIvProposal(b); renderLogWork(); renderLogTasks();
}
/* Favorit je Motorrad: sofort gespeichert, nur das Feld favs und nur, wenn es noch so ist wie angezeigt */
async function toggleFav(id){
  const b = curBike(); if (!b) return;
  const raw = store.peek('bikes', b.id); if (!raw) return;
  const cur = Array.isArray(raw.favs) ? raw.favs : null, list = cur || [];
  const next = list.includes(id) ? list.filter(x => x !== id) : list.concat([id]).slice(-40);
  const r = await flow(() => store.commitR([{coll: 'bikes', id: b.id, patch: {favs: next}, guard: {favs: cur}}], null, 'favoriten', {epoch: S.epoch || ''}));
  if (r === 'ok') toast(next.includes(id) ? 'Als Favorit gemerkt.' : 'Favorit entfernt.');
  else if (r === 'fail' && S.lastErr && S.lastErr.code === 'changed') toast('Die Favoriten wurden inzwischen in einem anderen Fenster geändert. Bitte noch einmal tippen.');
  else toast(r === 'fail' ? errText(S.lastErr) : UNCLEAR_MSG);
  renderLogWork();
}
/* ---------- Logbuch-Eintrag bearbeiten (ab 1.2.0) ----------
   Geeignet: Wartungen und Notizen. Ablesungen, Zählerwechsel sowie Reifen-/Kettenwechsel behalten ihre abgesicherten
   Abläufe (Tippfehler berichtigen, Technik). Identität (ID), Erfassungszeit und Anhänge bleiben, solange sie nicht bewusst
   geändert werden. Vor dem Speichern: Vorschau aller geänderten Angaben und der Folgen für die Fälligkeiten. Gespeichert
   wird alles in einem Vorgang, nur die geänderten Felder und nur, wenn der Stand des Motorrads (Motorrad, Logbuch, Fahrten)
   noch derselbe ist wie beim Öffnen. Sonst: zusammenführen, Konflikte nennen, erneut prüfen lassen. */
const LOG_EDIT_FIELDS = ['date', 'at', 'atAuto', 'cost', 'extra', 'note', 'tasks', 'taskNames', 'work', 'photoId', 'thumbId', 'created'];
const LOG_FIELD_NAMES = {date: 'Datum', at: 'Stand', cost: 'Kosten', extra: 'Weitere Arbeiten', note: 'Notiz', tasks: 'Wartungsintervalle', work: 'Tätigkeiten', photoId: 'Foto'};
function openLogEdit(id){
  const b = curBike(); if (!b) return;
  const l = S.log.find(x => x.id === id && x.bike === b.id), raw = store.peek('log', id);
  if (!l || !raw || (l.kind !== 'service' && l.kind !== 'note')) { toast('Diesen Eintrag gibt es nicht mehr oder er lässt sich hier nicht bearbeiten.'); return; }
  parkOp('logForm'); closeDraft('logForm');
  S.logEdit = {id, kind: l.kind, epoch: S.epoch || '', fp: store.bikeFpOf(b.id), base: clone(raw)};
  fillLogForm(b, l);
  const f = $('#logForm'); f.dataset.bike = b.id; f.dataset.epoch = S.epoch || '';
  logMode();
  drafts.mark('log');
  $('#logDetails').open = true; setSection('log', 'logDetails');
}
function fillLogForm(b, d){
  $('#lKind').value = d.kind === 'note' ? 'note' : 'service';
  $('#lDate').value = d.date || todayISO();
  $('#lAt').value = d.at != null && d.atAuto !== true ? v2(d.at) : '';
  S.logWork = (d.work || []).map(w => Object.assign({}, w));
  S.logTasks = new Set(d.tasks || []); S.logIvMan = {}; (b.items || []).forEach(it => { S.logIvMan[it.id] = S.logTasks.has(it.id); }); S.logIvAuto = new Set();
  $('#lExtra').value = d.extra || ''; $('#lCost').value = v2(d.cost); $('#lNote').value = d.note || '';
  S.logOrig = d.orig || ''; S.logOpen = [];
  renderLogWork(); renderLogTasks(); updateLogAtHint();
}
function logMode(){
  const e = S.logEdit;
  $('#logFormTitle').textContent = e ? 'Eintrag bearbeiten' : 'Neuer Eintrag';
  $('#lSave').textContent = e ? (S.logEditPrev ? 'Änderungen speichern' : 'Änderungen prüfen') : 'Eintragen';
  $('#lCancel').hidden = !e;
  $('#lKind').disabled = !!e;
  const raw = e ? e.base : null;
  $('#lPhotoDropWrap').hidden = !(raw && raw.photoId);
  $('#lPhotoLbl').textContent = raw && raw.photoId ? 'Foto ersetzen' : 'Foto';
  $('#lOrigWrap').hidden = !S.logOrig; $('#lOrig').textContent = S.logOrig || '';
  if (!e) { $('#lConflict').hidden = true; $('#lConflict').textContent = ''; }
  if (!S.logEditPrev) { $('#lPreview').hidden = true; $('#lPreview').innerHTML = ''; }
}
function logConflict(msg){ const c = $('#lConflict'); c.textContent = msg; c.hidden = !msg; if (msg) c.scrollIntoView({block: 'center'}); }
/* Werte aus dem Formular (wirft VErr bei ungültigen Eingaben) */
function logFormValues(b){
  const e = S.logEdit, kind = e ? e.kind : ($('#lKind').value === 'note' ? 'note' : 'service'), lim = LIM[U(b)];
  const v = {kind, date: fieldDate('lDate', 'Datum', {req: true}), at: fieldNum('lAt', 'Stand', {min: 0, max: lim.cnt}), cost: fieldNum('lCost', 'Kosten', {min: 0, max: MAX_COST}),
    extra: str($('#lExtra').value).slice(0, 500), note: str($('#lNote').value).slice(0, 4000),
    tasks: kind === 'service' ? Array.from(S.logTasks).filter(id => (b.items || []).some(i => i.id === id)) : [],
    work: kind === 'service' ? (S.logWork || []).map(w => workEntry(w.id, w.name, w.detail, w.cat)) : [],
    file: ($('#lPhoto').files && $('#lPhoto').files[0]) || null, drop: !!$('#lPhotoDrop').checked};
  return v;
}
/* Gespeicherter Eintrag (roh) mit den Eingaben: nur die bearbeitbaren Felder ändern sich */
function editedDoc(b, base, v){
  const n = clone(base);
  n.date = v.date;
  const typed = base.at != null && base.atAuto !== true;
  if (v.at != null) { n.at = v.at; n.atAuto = false; }
  else if (typed) { const sa = base.kind === 'service' ? serviceAt(b, v.date, null) : {at: null, atAuto: false}; n.at = sa.at; n.atAuto = sa.atAuto; }
  n.cost = v.cost; n.extra = v.extra; n.note = v.note;
  if (base.kind === 'service') {
    n.tasks = v.tasks; n.taskNames = v.tasks.map(id => (b.items || []).find(i => i.id === id).name);
    if (v.work.length || base.work != null) n.work = v.work;
  }
  if (v.drop && !v.file) { n.photoId = ''; n.thumbId = ''; }
  return n;
}
function logShow(k, v, b){
  if (k === 'work') return (v || []).map(workLabel).join(', ') || 'keine';
  if (k === 'tasks') return (v || []).map(id => ((b.items || []).find(i => i.id === id) || {}).name || id).join(', ') || 'keine';
  if (k === 'date') return v ? fmtDate(v) : '–';
  if (k === 'at') return v == null ? 'aus dem Verlauf bzw. unbekannt' : fmt(v, 2) + ' ' + U(b);
  if (k === 'cost') return v == null ? 'keine' : eur(v);
  if (k === 'photoId') return v ? 'vorhanden' : 'keins';
  return v ? '„' + v + '“' : 'leer';
}
/* Vorschau: geänderte Angaben und Folgen für die Fälligkeiten (Verlauf mit dem geänderten Eintrag neu berechnet) */
function editPreview(b, e, next, v){
  const rows = [];
  ['date', 'at', 'work', 'tasks', 'extra', 'cost', 'note'].forEach(k => { if (canon(nz(next[k])) !== canon(nz(e.base[k]))) rows.push('<dt>' + LOG_FIELD_NAMES[k] + '</dt><dd>' + esc(logShow(k, e.base[k], b)) + ' → <b>' + esc(logShow(k, next[k], b)) + '</b></dd>'); });
  if (v.file) rows.push('<dt>Foto</dt><dd>' + (e.base.photoId ? 'wird ersetzt' : 'wird hinzugefügt') + '</dd>');
  else if (canon(nz(next.photoId)) !== canon(nz(e.base.photoId))) rows.push('<dt>Foto</dt><dd>wird entfernt</dd>');
  const clean = Object.assign(canonDoc('log', next), {id: e.id, bike: b.id});
  const logs = S.log.filter(l => l.id !== e.id).concat([clean]);
  derive();
  const d0 = S.der[b.id], d1 = deriveBike(b, logs, S.rides);
  const eff = [];
  if (d0 && d0.cur !== d1.cur) eff.push('<li><b>Stand jetzt</b>: ' + esc(d0.cur == null ? '–' : fmt(d0.cur, 2) + ' ' + U(b)) + ' → ' + esc(d1.cur == null ? '–' : fmt(d1.cur, 2) + ' ' + U(b)) + '</li>');
  (b.items || []).forEach(it => {
    const a = itemState(b, it, d0), z = itemState(b, it, d1), ta = pillText(b, a), tz = pillText(b, z);
    const ma = a.m ? canon([a.m.at, a.m.date]) : '', mz = z.m ? canon([z.m.at, z.m.date]) : '';
    if (ta !== tz || ma !== mz) eff.push('<li><b>' + esc(it.name) + '</b>: ' + esc(ta) + ' → <span class="t-' + z.s + '">' + esc(tz) + '</span>' + (z.m && (z.m.at != null || z.m.date) ? ' <span class="hint">(zuletzt ' + esc((z.m.at != null ? fmt(z.m.disp != null ? z.m.disp : z.m.at, 2) + ' ' + U(b) + ' ' : '') + (z.m.date ? fmtDate(z.m.date) : '')) + ')</span>' : '') + '</li>');
  });
  return {changed: rows.length > 0, html: '<div class="preview"><div class="kind">Das ändert sich</div>' + (rows.length ? '<dl class="kv">' + rows.join('') + '</dl>' : '<p class="hint">Keine Änderung.</p>')
    + '<h3>Folgen für die Wartung</h3><ul class="fix-effects">' + (eff.join('') || '<li class="hint">Keine Änderung bei Stand und Fälligkeiten.</li>') + '</ul>'
    + '<p class="hint">Tipp auf „Änderungen speichern“, um alles gemeinsam zu speichern. Änderst du noch etwas, wird die Vorschau neu berechnet.</p></div>'};
}
async function saveLogEdit(b, busy){
  const e = S.logEdit;
  if (e.gone) { toast('Den Eintrag gibt es nicht mehr. Tipp auf „Abbrechen“.'); return; }
  const v = logFormValues(b);
  if (v.kind === 'service' && !v.tasks.length && !v.work.length && !v.extra && !v.note && v.cost == null && !v.file && !(e.base.photoId && !v.drop)) { toast('Wähl eine Arbeit aus oder schreib etwas dazu.'); return; }
  if (e.unclear) {
    /* Erst nachsehen, ob der vorige, unklare Versuch angekommen ist */
    const n = await store.askStore('log', e.id);
    if (n.state !== 'known') { toast('Weiterhin unklar, ob gespeichert wurde. Versuch es gleich nochmal.'); return; }
    if (n.exists && n.data && n.data.edited === e.unclear) { finishLogEdit(e, true); return; }
    e.unclear = null;
  }
  /* Grundlage des ganzen Entwurfs noch gültig? */
  if (store.bikeFpOf(b.id) !== e.fp) { rebaseLogEdit(b, v); return; }
  const next = editedDoc(b, e.base, v);
  /* Datum auf den Tag eines Zählerwechsels verschoben: welcher Zähler war gemeint? (wie bei neuen Angaben) */
  if (next.date !== e.base.date) {
    const dOther = deriveBike(b, S.log.filter(l => l.id !== e.id), S.rides);
    if (meterSegments(b, next.date, dOther).length && (next.at != null || next.atAuto)) {
      if (!S.logEditPrev || S.logEditPrev.seg == null) {
        const res = await askSegments(b, [{key: 'e', label: 'Eintrag vom ' + fmtDate(next.date) + (next.at != null && !next.atAuto ? ' bei ' + fmt(next.at, 2) + ' ' + U(b) : ''), date: next.date}]);
        if (!res || res.stale) return;
        if (res.fp !== e.fp) { rebaseLogEdit(b, v); return; }
        e.seg = res.pick.e;
      }
      next.created = e.seg != null ? e.seg : next.created;
    }
  }
  /* Auffälliger Sprung beim Stand? Verglichen mit dem Verlauf ohne diesen Eintrag */
  if (next.at != null && !next.atAuto && canon(next.at) !== canon(e.base.at)) {
    const dOther = deriveBike(b, S.log.filter(l => l.id !== e.id), S.rides);
    if (!(await jumpOk(e, b, next.date, next.at, 'lAt', posAt(b.id, next.date, next.created, dOther).disp))) return;
  }
  const sig = canon([next, v.file ? v.file.name + ':' + v.file.size + ':' + v.file.lastModified : '']);
  if (!S.logEditPrev || S.logEditPrev.sig !== sig) {
    const p = editPreview(b, e, next, v);
    if (!p.changed) { toast('Keine Änderung. Es gibt nichts zu speichern.'); return; }
    S.logEditPrev = {sig, seg: e.seg};
    $('#lPreview').innerHTML = p.html; $('#lPreview').hidden = false;
    logMode();
    $('#lPreview').scrollIntoView({block: 'center'});
    return;
  }
  /* Speichern: alle geänderten Felder in einem Vorgang, mit Prüfung im Speicher */
  busy(true);
  let made = null;
  if (v.file) {
    try { made = await makePhoto(v.file); }
    catch (x) { toast('Das Foto konnte nicht gelesen werden. Es wurde nichts geändert.'); return; }
    next.photoId = made.photo.id; next.thumbId = made.photo.thumbId || '';
  }
  const patch = {}, guard = {};
  LOG_EDIT_FIELDS.forEach(k => { if (canon(nz(next[k])) !== canon(nz(e.base[k]))) { patch[k] = clone(nu(next[k])); guard[k] = clone(nu(e.base[k])); } });
  patch.edited = Date.now();
  const r = await flow(() => store.commitR([{coll: 'log', id: e.id, patch, guard}], made ? made.files : null, 'logbuch-bearbeiten', {epoch: e.epoch, expect: {bike: b.id, fp: e.fp}}));
  if (S.logEdit !== e) return;
  if (r === 'ok') { const old = payloadFiles(e.base).filter(id => id !== next.photoId && id !== next.thumbId); finishLogEdit(e, false, old); return; }
  if (r === 'fail') {
    if (made) cleanupFiles(made.files.map(f => f.id));
    if (S.lastErr && (S.lastErr.code === 'changed' || S.lastErr.code === 'not_found')) { await store.reloadAll().catch(() => {}); if (S.logEdit === e) rebaseLogEdit(S.bikes[b.id] || b, v); return; }
    toast(errText(S.lastErr) + ' Es wurde nichts geändert.');
    return;
  }
  e.unclear = patch.edited;
  toast('Unklar, ob die Änderung gespeichert wurde. Tipp noch einmal auf „Änderungen speichern“: Racebook sieht zuerst nach, es wird nichts doppelt geändert.');
}
function finishLogEdit(e, already, oldFiles){
  if (oldFiles && oldFiles.length) cleanupFiles(oldFiles);
  closeDraft('logForm'); renderLogTasks(); updateLogAtHint();
  toast(already ? 'Die Änderung war schon gespeichert.' : 'Änderungen gespeichert.');
  R.renderAll();
}
/* Grundlage geändert (anderes Fenster): eigene Änderungen auf den aktuellen Stand übertragen und erneut prüfen lassen */
function rebaseLogEdit(b, v){
  const e = S.logEdit; if (!e) return;
  S.logEditPrev = null; e.seg = null;
  const cur = store.peek('log', e.id);
  if (!cur || cur.bike !== b.id) {
    e.gone = true; logMode();
    logConflict('Dieser Eintrag wurde inzwischen in einem anderen Fenster gelöscht. Es wurde nichts gespeichert. Deine Eingaben stehen noch im Formular, falls du sie neu eintragen möchtest. Tipp auf „Abbrechen“, um das Formular zu schließen.');
    return;
  }
  const mine = editedDoc(b, e.base, v), merged = clone(cur), conflicts = [];
  LOG_EDIT_FIELDS.forEach(k => {
    const m = nz(mine[k]), b0 = nz(e.base[k]), c = nz(cur[k]);
    if (canon(m) === canon(b0)) return;
    merged[k] = clone(mine[k]);
    if (canon(c) !== canon(b0) && canon(c) !== canon(m) && LOG_FIELD_NAMES[k]) conflicts.push(LOG_FIELD_NAMES[k] + ': dort ' + logShow(k, cur[k], b) + ', bei dir ' + logShow(k, mine[k], b));
  });
  e.base = clone(cur); e.fp = store.bikeFpOf(b.id);
  const keepFile = $('#lPhoto').files && $('#lPhoto').files[0], drop = $('#lPhotoDrop').checked;
  fillLogForm(b, Object.assign(canonDoc('log', merged), {id: e.id, bike: b.id}));
  $('#lPhotoDrop').checked = drop && !!cur.photoId;
  logMode();
  logConflict(EDIT_MSG + (conflicts.length ? ' Unterschiedlich geändert: ' + conflicts.join('; ') + '. Im Formular steht deine Eingabe.' : ' Deine Änderungen sind in den aktuellen Stand übernommen.') + ' Tipp erneut auf „Änderungen prüfen“.' + (keepFile ? ' Das gewählte Foto ist weiter ausgewählt.' : ''));
  toast(EDIT_MSG);
}

function dropEditPrev(){ if (S.logEditPrev) { S.logEditPrev = null; logMode(); } }
/* Schnell-Eintrag: Intervallvorschlag aus Tätigkeiten und beantworteten Fragen neu berechnen, bewusste Auswahl behalten */
function quickIv(x){
  const b = S.bikes[x.bike]; if (!b) return;
  const works = (x.work || []).concat(openPicks(x)), open = (x.open || []).filter(q => !q.pick);
  const pre = ivProposal(b, works, open).filter(p => p.pre).map(p => p.item), man = x.ivMan || {};
  const keep = (x.tasks || []).filter(id => man[id] === true);
  x.tasks = Array.from(new Set(pre.filter(id => man[id] !== false).concat(keep)));
}
/* Ausgewählte Antworten offener Fragen aus der Schnell-Eintrag-Vorschau */
const openPicks = x => (x.open || []).filter(q => q.pick && q.pick !== '-').map(q => workEntry(q.pick));
export function updateLogAtHint(){
  const b = curBike(); if (!b) return;
  const d = $('#lDate').value, cur = curOf(b), past = d && d !== todayISO();
  $('#lAtLabel').textContent = (past ? 'Stand damals' : 'Stand') + ' (' + U(b) + ')';
  $('#lAt').placeholder = past ? 'unbekannt' : (cur != null ? fmt(cur) + ' (aktuell)' : '');
  const hint = $('#lAtHint');
  hint.hidden = !past;
  hint.textContent = past ? 'Rückdatiert: Ohne Stand von damals zählt für die erledigten Punkte nur die Frist in Monaten.' : '';
}
function photoBtn(id, thumbId, alt){
  return '<button class="thumb-btn" type="button" data-photo="' + esc(id) + '" aria-label="' + esc(alt) + ' vergrößern">' + imgTag(thumbId || id, alt, 'thumb', ' loading="lazy"') + '</button>';
}
function renderLog(){
  const b = curBike(); if (!b) return;
  const u = U(b);
  updateLogAtHint();
  renderLogTasks(); renderLogWork();
  const entries = S.log.filter(l => l.bike === b.id);
  const work = entries.filter(l => l.kind !== 'reading' && l.kind !== 'meter');
  const year = todayISO().slice(0, 4);
  const sum = work.reduce((a, l) => a + (l.cost || 0), 0);
  const sumY = work.filter(l => (l.date || '').startsWith(year)).reduce((a, l) => a + (l.cost || 0), 0);
  $('#logStats').innerHTML = '<div class="stat"><b>' + work.length + '</b><span>Einträge</span></div><div class="stat"><b>' + eur(sumY).replace(/,00\s/, ' ') + '</b><span>Kosten ' + year + '</span></div><div class="stat"><b>' + eur(sum).replace(/,00\s/, ' ') + '</b><span>Kosten gesamt</span></div>';
  $('#logCount').textContent = entries.length ? entries.length + ' Einträge' : '';
  const kinds = {service: 'Wartung', tire: 'Reifen', chain: 'Kette', note: 'Notiz', reading: 'Stand', meter: 'Zähler ersetzt'};
  const armText = {service: 'Löschen? Fälligkeit wird neu berechnet', reading: 'Löschen? Stand wird neu berechnet', meter: 'Löschen? Stand wird neu berechnet'};
  const der = S.der[b.id] || {probe: {}, poff: {}};
  /* Gesamtlaufleistung dazuschreiben, wenn sie von der damaligen Anzeige abweicht (nach einem Zählerwechsel) */
  const totNote = id => der.poff[id] && der.probe[id] != null ? 'gesamt ' + fmt(der.probe[id], 2) + ' ' + u : '';
  const fixNote = l => !l.fix ? '' : l.fix.how === 'tippfehler' ? 'berichtigt, vorher ' + fmt(l.fix.from, 2) + ' ' + u : 'bei einer Berichtigung festgehalten';
  $('#logList').innerHTML = entries.length ? entries.map(l => {
    if (l.kind === 'reading' || l.kind === 'meter') {
      const meter = l.kind === 'meter';
      const label = meter ? meterName(b) + ' ersetzt' : (l.fix && l.fix.how === 'tippfehler' ? 'Stand berichtigt (Tippfehler)' : (l.correction ? 'Stand korrigiert' : 'Stand abgelesen'));
      const note = meter ? 'Alter Zähler zuletzt ' + (l.at == null ? 'unbekannt' : fmt(l.at, 2) + ' ' + u) + ', neuer Zähler ab ' + fmt(l.meterNew, 2) + ' ' + u + '. Gesamtlaufleistung und Wartungen bleiben erhalten.'
        : [fixNote(l), totNote(l.id)].filter(Boolean).join(' · ');
      return '<div class="entry reading"><div><div class="entry-date">' + fmtDate(l.date) + '</div><div class="entry-at">' + fmt(meter ? l.meterNew : l.at, 2) + '<small> ' + u + '</small></div></div>'
        + '<div class="entry-body"><span class="kind reading">' + label + '</span>' + (note ? '<div class="entry-note">' + esc(note) + '</div>' : '')
        + '<div class="entry-foot"><span></span><button class="mini" type="button" data-del="log/' + esc(l.id) + '" data-arm="' + armText.reading + '">Löschen</button></div></div></div>';
    }
    /* Ab 1.2.0: Titel aus den erledigten Tätigkeiten; die betroffenen Intervalle stehen getrennt darunter.
       Ältere Einträge ohne Tätigkeiten erscheinen unverändert wie bisher (keine nachträgliche Umdeutung). */
    const hasWork = Array.isArray(l.work) && l.work.length;
    const title = hasWork ? l.work.map(workLabel).concat(l.extra ? [l.extra] : [], l.title ? [l.title] : []).join(' · ') : [].concat(l.taskNames || [], l.extra ? [l.extra] : [], l.title ? [l.title] : []).join(' · ');
    const ivLine = hasWork ? ((l.taskNames || []).length ? 'Wartungsintervall: ' + l.taskNames.join(', ') : 'Kein Wartungsintervall zurückgesetzt') : '';
    const editable = (l.kind === 'service' || l.kind === 'note') && !l._pending;
    const sa = svcAtOf(l);
    const atNote = l.kind !== 'service' ? '' : [sa.src === 'auto' ? 'aus Verlauf' : (sa.src === 'unk' ? 'Stand unbekannt' : ''), fixNote(l), totNote(l.id)].filter(Boolean).join(', ');
    const kind = l.repairOf ? 'Reparatur' : (kinds[l.kind] || 'Eintrag');
    return '<div class="entry"><div><div class="entry-date">' + fmtDate(l.date) + '</div><div class="entry-at">' + (sa.v == null ? '' : fmt(sa.v, 2) + '<small> ' + u + '</small>') + '</div>' + (atNote ? '<div class="hint" style="font-size:12px">' + atNote + '</div>' : '') + '</div>'
      + '<div class="entry-body"><span class="kind">' + kind + (l._pending ? ' <span class="hint">wird gespeichert …</span>' : '') + '</span>'
      + (title ? '<div class="entry-title">' + esc(title) + '</div>' : '')
      + (ivLine ? '<div class="hint entry-iv">' + esc(ivLine) + '</div>' : '')
      + (l.note ? '<div class="entry-note">' + esc(l.note) + '</div>' : '')
      + (l.orig && l.orig !== l.note && l.orig !== title ? '<details class="orig"><summary>Originaleingabe</summary><p>' + esc(l.orig) + '</p></details>' : '')
      + (l.photoId ? photoBtn(l.photoId, l.thumbId, 'Foto zum Eintrag vom ' + fmtDate(l.date)) : '')
      + (l.edited ? '<div class="hint" style="font-size:12px">bearbeitet am ' + esc(fmtDate(dateOfMs(l.edited))) + '</div>' : '')
      + '<div class="entry-foot"><span class="cost">' + (l.cost != null ? eur(l.cost) : '') + '</span><span class="row">' + (editable ? '<button class="mini" type="button" data-logedit="' + esc(l.id) + '">Bearbeiten</button>' : '') + '<button class="mini" type="button" data-del="log/' + esc(l.id) + '" data-arm="' + (armText[l.kind] || 'Löschen?') + '">Löschen</button></span></div></div></div>';
  }).join('') : '<p class="hint">Noch nichts eingetragen. Nutz den Schnell-Eintrag unter Status oder „Neuer Eintrag“ oben.</p>';
  hydrate($('#logList'));
}

function chartSVG(b){
  const now = new Date();
  const keys = [];
  for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 15); keys.push({k: d.getFullYear() + '-' + pad(d.getMonth() + 1), m: d.getMonth()}); }
  const sums = keys.map(x => S.rides.filter(r => r.bike === b.id && (r.date || '').startsWith(x.k)).reduce((a, r) => a + (r.amount || 0), 0));
  const max = Math.max(...sums);
  if (!max) return '<p class="hint">Sobald du Fahrten einträgst, siehst du hier, wie viel du pro Monat fährst.</p>';
  const raw = max / 3, mag = Math.pow(10, Math.floor(Math.log10(raw))), nrm = raw / mag;
  const step = (nrm <= 1 ? 1 : nrm <= 2 ? 2 : nrm <= 2.5 ? 2.5 : nrm <= 5 ? 5 : 10) * mag;
  const top = Math.ceil(max / step) * step;
  const W = 360, Hh = 160, Lp = 30, Rr = 6, Tt = 16, Bm = 20, cw = (W - Lp - Rr) / 12, bw = cw * 0.62;
  const y = v => Tt + (Hh - Tt - Bm) * (1 - v / top);
  let g = '';
  for (let v = 0; v <= top + 1e-9; v += step) g += '<line class="c-grid" x1="' + Lp + '" x2="' + (W - Rr) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/><text class="c-txt" x="' + (Lp - 5) + '" y="' + (y(v) + 3).toFixed(1) + '" text-anchor="end">' + fmt(v) + '</text>';
  let bars = '';
  sums.forEach((v, i) => {
    const x = Lp + i * cw + (cw - bw) / 2;
    if (v > 0) { bars += '<rect class="c-bar' + (i < 11 ? ' past' : '') + '" x="' + x.toFixed(1) + '" y="' + y(v).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (y(0) - y(v)).toFixed(1) + '" rx="2"/>'; bars += '<text class="c-val" x="' + (x + bw / 2).toFixed(1) + '" y="' + (y(v) - 4).toFixed(1) + '" text-anchor="middle">' + fmt(v) + '</text>'; }
    bars += '<text class="c-txt" x="' + (x + bw / 2).toFixed(1) + '" y="' + (Hh - 6) + '" text-anchor="middle">' + MONTHS[keys[i].m] + '</text>';
  });
  return '<svg viewBox="0 0 ' + W + ' ' + Hh + '" role="img" aria-label="Fahrzeit der letzten 12 Monate in ' + U(b) + '">' + g + bars + '</svg>';
}
function setupLabel(s){ return s ? (s.track || 'Ohne Strecke') + (s.updated ? ' (' + fmtDate(s.updated) + ')' : '') : ''; }
function snapText(sn){
  if (!sn) return '';
  const p = [];
  const g = [sn.forkC != null ? 'D ' + fmt(sn.forkC, 2) : '', sn.forkR != null ? 'Z ' + fmt(sn.forkR, 2) : '', sn.forkAir != null ? fmt(sn.forkAir, 2) + ' bar' : '', sn.forkPre != null ? 'Vorsp. ' + turns(sn.forkPre) : ''].filter(Boolean);
  if (g.length) p.push('Gabel ' + g.join(', '));
  const f = [sn.shockHSC != null ? 'HSC ' + turns(sn.shockHSC) : '', sn.shockLSC != null ? 'LSC ' + fmt(sn.shockLSC, 2) : '', sn.shockR != null ? 'Z ' + fmt(sn.shockR, 2) : ''].filter(Boolean);
  if (f.length) p.push('Federbein ' + f.join(', '));
  if (sn.sag != null) p.push('Sag ' + fmt(sn.sag) + ' mm');
  if (sn.pf != null || sn.pr != null) p.push(fmt(sn.pf, 2) + ' / ' + fmt(sn.pr, 2) + ' bar');
  return p.join(' · ');
}
/* Fahrt vom selben Tag wie ein abgelesener Stand: fragen, ob sie schon darin steckt */
export function updateRideIn(){
  const b = curBike(), wrap = $('#rInWrap'); if (!b || !wrap) return;
  const d = $('#rDate').value, show = isISO(d) && hasSetOn(b.id, d);
  wrap.hidden = !show;
  if (!show) $('#rIn').checked = false;
}
function renderRides(){
  const b = curBike(); if (!b) return;
  const u = U(b);
  $('#rAmountLabel').textContent = u === 'km' ? 'Strecke (km)' : 'Fahrzeit (h)';
  updateRideIn();
  $('#rideChart').innerHTML = chartSVG(b);
  const rides = S.rides.filter(r => r.bike === b.id);
  const year = todayISO().slice(0, 4);
  const yr = rides.filter(r => (r.date || '').startsWith(year)).reduce((a, r) => a + (r.amount || 0), 0);
  $('#rideTotal').textContent = year + ': ' + fmt(yr) + ' ' + u;
  $('#rideCount').textContent = rides.length ? rides.length + ' Fahrten' : '';
  const setups = S.setups.filter(s => s.bike === b.id);
  const sel = $('#rSetup'), prev = sel.value;
  sel.innerHTML = '<option value="">kein Setup gewählt</option>' + setups.map(s => '<option value="' + esc(s.id) + '">' + esc(setupLabel(s)) + '</option>').join('');
  if (setups.some(s => s.id === prev)) sel.value = prev;
  const tracks = Array.from(new Set(S.rides.map(r => r.track).concat(S.setups.map(s => s.track)).filter(Boolean))).sort();
  $('#trackList').innerHTML = tracks.map(t => '<option value="' + esc(t) + '"></option>').join('');
  const dots = n => n ? '<span class="dots" role="img" aria-label="Gefühl ' + n + ' von 5">' + [1, 2, 3, 4, 5].map(i => '<i class="' + (i <= n ? 'on' : '') + '"></i>').join('') + '</span>' : '';
  $('#rideList').innerHTML = rides.length ? rides.map(r => {
    const s = S.setups.find(x => x.id === r.setupId);
    const chips = [r.ground, r.weather].filter(Boolean).map(c => '<span class="chip static">' + esc(c) + '</span>').join('');
    let setupLine = '';
    if (r.setupSnap) setupLine = '<div class="hint">Setup: ' + esc(r.setupSnap.track || (s ? s.track : '') || 'ohne Namen') + '</div>' + (snapText(r.setupSnap) ? '<div class="snap">' + esc(snapText(r.setupSnap)) + '</div>' : '');
    else if (r.setupId) setupLine = '<div class="hint">Setup: ' + esc(s ? s.track : 'gelöscht') + ' (damalige Werte nicht gespeichert)</div>';
    return '<div class="entry"><div><div class="entry-date">' + fmtDate(r.date) + '</div><div class="entry-at">' + (r.amount == null ? '' : fmt(r.amount, 2) + '<small> ' + u + '</small>') + '</div></div>'
      + '<div class="entry-body"><div class="entry-title">' + esc(r.track || 'Fahrt') + ' ' + dots(r.feel) + '</div>'
      + (chips ? '<div class="chips">' + chips + '</div>' : '') + setupLine
      + (r.note ? '<div class="entry-note">' + esc(r.note) + '</div>' : '')
      + '<div class="entry-foot"><span></span><button class="mini" type="button" data-del="rides/' + esc(r.id) + '" data-arm="Löschen? Stand wird neu berechnet">Löschen</button></div></div></div>';
  }).join('') : '<p class="hint">Noch keine Fahrten. Jede Fahrt zählt ihre Zeit automatisch zu deinem Stand dazu.</p>';
}

function renderSetups(){
  const b = curBike(); if (!b) return;
  const list = S.setups.filter(s => s.bike === b.id).sort((a, c) => (a.track || '').localeCompare(c.track || '', 'de') || (c.updated || '').localeCompare(a.updated || ''));
  const cell = (v, l, t) => '<div class="cell' + (v == null ? ' empty' : '') + '">' + (v == null ? '' : '<b>' + (t ? turns(v) : fmt(v, 2)) + '</b><span>' + l + '</span>') + '</div>';
  $('#setupList').innerHTML = list.length ? list.map(s => {
    const rides = S.rides.filter(r => r.setupId === s.id), sig = sigOf(s);
    const same = rides.filter(r => r.setupSnap && sigOf(r.setupSnap) === sig);
    const older = rides.filter(r => r.setupSnap && sigOf(r.setupSnap) !== sig).length;
    const unknown = rides.filter(r => !r.setupSnap).length;
    const feels = same.map(r => r.feel).filter(x => x);
    const avg = feels.length ? fmt(feels.reduce((a, x) => a + x, 0) / feels.length) : null;
    const info = [s.updated ? fmtDate(s.updated) : '', same.length ? same.length + ' Fahrten' + (avg ? ', Ø ' + avg + '/5' : '') : '', older ? older + ' mit älteren Werten' : '', unknown ? unknown + ' ohne gespeicherte Werte' : ''].filter(Boolean).join(' · ');
    const extra = [s.sag != null ? 'Sag ' + fmt(s.sag) + ' mm' : '', (s.pf != null || s.pr != null) ? 'Luft ' + fmt(s.pf, 2) + ' / ' + fmt(s.pr, 2) + ' bar' : ''].filter(Boolean).join(' · ');
    return '<div class="card setup-group"><div class="setup-head"><span class="setup-track">' + esc(s.track || 'Ohne Strecke') + '</span><span class="tag">' + esc(info) + '</span></div>'
      + '<div class="clicks"><span class="grp">Gabel</span>' + cell(s.forkC, 'Druck') + cell(s.forkR, 'Zug') + cell(s.forkAir, 'Luft bar') + cell(s.forkPre, 'Vorsp.', true) + '</div>'
      + '<div class="clicks"><span class="grp">Federbein</span>' + cell(s.shockHSC, 'HSC Umdr.', true) + cell(s.shockLSC, 'LSC') + cell(s.shockR, 'Zug') + '<div class="cell empty"></div></div>'
      + (extra ? '<p class="hint">' + esc(extra) + '</p>' : '')
      + (s.note ? '<div class="entry-note">' + esc(s.note) + '</div>' : '')
      + '<div class="row"><button class="mini" type="button" data-editsetup="' + esc(s.id) + '">Bearbeiten</button><button class="mini" type="button" data-copysetup="' + esc(s.id) + '">Als Vorlage</button><button class="mini" type="button" data-del="setups/' + esc(s.id) + '" data-arm="Löschen?">Löschen</button></div></div>';
  }).join('') : '<div class="card"><p class="hint">Noch kein Setup gespeichert. Leg oben für jede Strecke deine Klicks, den Sag und den Reifendruck ab.</p></div>';
}

function bikePhotoHTML(b){
  const busy = S.photoBusy === b.id;
  return '<div class="bike-photo">' + (b.photo ? imgTag(b.photo.id, 'Foto von ' + titleOf(b), 'bp-img') : '<div class="bp-ph" style="' + plateStyle(b) + '">' + icon('bike') + '<span>' + esc((brandOf(b) && brandOf(b).short) || b.brand) + '</span></div>') + '</div>'
    + '<div class="row"><label class="btn" for="bikePhotoFile"' + (busy ? ' aria-disabled="true"' : '') + '>' + icon('camera') + (b.photo ? 'Foto ersetzen' : 'Foto wählen') + '</label><input type="file" id="bikePhotoFile" accept="image/*" class="sr-file"' + (busy ? ' disabled' : '') + '>'
    + (b.photo ? '<button class="btn ghost" type="button" id="bikePhotoRemove" data-arm="Foto wirklich entfernen?"' + (busy ? ' disabled' : '') + '>Foto entfernen</button>' : '') + '</div>'
    + (busy ? '<p class="hint thinking">Foto wird gespeichert …</p>' : '');
}
export function renderInventory(){
  const filter = $('#inventoryBike'), prior = filter.value || 'all';
  const opts = '<option value="all">Alle Bestände</option><option value="both">Für alle Motorräder</option>' + bikeList().map(x => '<option value="' + esc(x.id) + '">' + esc(titleOf(x)) + '</option>').join('');
  if (filter.innerHTML !== opts) { filter.innerHTML = opts; filter.value = Array.from(filter.options).some(o => o.value === prior) ? prior : 'all'; }
  const which = filter.value, term = $('#inventorySearch').value.trim().toLocaleLowerCase('de'), lowOnly = $('#inventoryLow').checked;
  const parts = S.parts.filter(p => (which === 'all' || p.bike === 'both' || p.bike === which) && (!term || (p.name || '').toLocaleLowerCase('de').includes(term)) && (!lowOnly || p.qty <= p.min)).sort((a, c) => (a.name || '').localeCompare(c.name || '', 'de'));
  $('#partsCount').textContent = parts.length ? parts.length + (parts.length === 1 ? ' Teil' : ' Teile') : '';
  $('#partsBody').innerHTML = parts.length ? parts.map(p => {
    const low = p.qty <= p.min;
    const forB = p.bike === 'both' ? 'alle Motorräder' : S.bikes[p.bike] ? titleOf(S.bikes[p.bike]) : 'nicht zugeordnet';
    return '<div class="part' + (low ? ' low' : '') + '"><div><div class="part-name">' + esc(p.name) + '</div><div class="item-sub">für ' + esc(forB) + ' · nachkaufen ab ' + fmt(p.min, 0) + (low ? ' · <span class="txt-bad">knapp</span>' : '') + '</div></div>'
      + '<div class="qty"><button class="mini" type="button" data-partedit="' + esc(p.id) + '" aria-label="' + esc(p.name) + ' bearbeiten">Bearbeiten</button><button class="mini" type="button" data-qty="' + esc(p.id) + '" data-d="-1" aria-label="' + esc(p.name) + ': eins weniger"' + (S.qtyBusy.has(p.id) ? ' disabled' : '') + '>−</button><b aria-label="Anzahl">' + fmt(p.qty, 0) + '</b><button class="mini" type="button" data-qty="' + esc(p.id) + '" data-d="1" aria-label="' + esc(p.name) + ': eins mehr"' + (S.qtyBusy.has(p.id) ? ' disabled' : '') + '>+</button><button class="mini" type="button" data-del="parts/' + esc(p.id) + '" data-arm="Weg?" aria-label="' + esc(p.name) + ' entfernen">×</button></div></div>';
  }).join('') : '<p class="hint">Keine passenden Teile. Ändere die Filter oder füge einen Artikel hinzu.</p>';
  const pb = $('#pBike'), pv = pb.value;
  let po = '<option value="both">alle Motorräder</option>' + bikeList().map(x => '<option value="' + esc(x.id) + '">' + esc(bikeName(x)) + '</option>').join('');
  if (pv && pv !== 'both' && !S.bikes[pv]) po += '<option value="' + esc(pv) + '">Entferntes Motorrad – Zuordnung ändern</option>';
  if (pb.innerHTML !== po) pb.innerHTML = po;
  pb.value = pv && Array.from(pb.options).some(o => o.value === pv) ? pv : 'both';
}

function renderGarage(){
  const b = curBike(); if (!b) return;
  const u = U(b);
  if (!S.editing.bike) {
    const c = colorOf(b);
    $('#bikeBody').innerHTML = bikePhotoHTML(b) + '<dl class="kv" style="margin-top:12px"><dt>Spitzname</dt><dd>' + esc(b.nickname || '–') + '</dd><dt>Marke</dt><dd>' + esc(b.brand || '–') + '</dd><dt>Modell</dt><dd>' + esc(b.model || '–') + '</dd><dt>Baujahr</dt><dd>' + esc(b.year || '–') + '</dd><dt>Farbe</dt><dd><span class="swatch" style="background:' + c + '"></span>' + esc(c.toUpperCase()) + '</dd><dt>Zählt nach</dt><dd>' + (u === 'km' ? 'Kilometern' : 'Betriebsstunden') + '</dd></dl>';
    hydrate($('#bikeBody'));
  }
  if (!S.editing.tc) $('#tcBody').innerHTML = mountHTML(b);
  if (!S.editing.oil) {
    const fl = b.fluids || {};
    $('#oilBody').innerHTML = '<dl class="kv">' + FLUIDS.map(([k, l]) => { const f = fl[k] || {}; const val = [f.brand, f.spec, f.qty].filter(Boolean).join(' · '); return '<dt>' + l + '</dt><dd>' + (val ? esc(val) : '<span class="hint">–</span>') + '</dd>'; }).join('') + '</dl>';
  }
  if (!S.editing.int) {
    $('#intBody').innerHTML = '<p class="hint" style="margin-bottom:8px">Zählt nach ' + (u === 'km' ? 'Kilometern' : 'Betriebsstunden') + '. Die Vorgaben sind Richtwerte. Die Herstellervorgaben findest du im Handbuch.</p><dl class="kv">'
      + ((b.items || []).map(it => '<dt>' + esc(it.name) + '</dt><dd>' + ([it.every ? fmt(it.every) + ' ' + u : '', it.months ? it.months + ' Mon.' : ''].filter(Boolean).join(' / ') || '–') + '</dd>').join('') || '<dt>–</dt><dd>Noch keine Wartungspunkte</dd>') + '</dl>';
  }
  $$('[data-edit]').forEach(x => { x.textContent = 'Bearbeiten'; x.disabled = !!S.editing[x.dataset.edit]; });
  renderMeter(b);
}

function renderManual(force){
  const b = curBike(); if (!b) return;
  const m = b.manual || null;
  const has = m && ((m.kind === 'pdf' && m.fileId) || (m.kind === 'link' && safeUrl(m.url)));
  const body = $('#manBody'), lf = $('#manLinkForm');
  const keep = !force && lf && lf.dataset.bike === b.id ? $('#manUrl').value : '';
  /* Angefangene Eingabe, und ein anderes Fenster hat die Anleitung inzwischen geändert (ab 1.2.2): Formular und
     Eingabe bleiben, Racebook sagt, was dort gespeichert wurde. Das nächste „Link speichern“ ist die bewusste Entscheidung. */
  const raw = store.peek('bikes', b.id), now = clone(nu(raw ? raw.manual : null));
  if (keep && str(keep) && S.manBase && S.manBase.bike === b.id && canon(S.manBase.manual) !== canon(now)) {
    S.editing.manual = true;
    S.manMsg = 'In einem anderen Fenster wurde inzwischen ' + (now ? 'eine Anleitung gespeichert: „' + (now.name || now.url || 'Anleitung') + '“' : 'die Anleitung entfernt') + '. Dein Link steht noch hier: „Link speichern“ ersetzt sie, „Abbrechen“ behält sie.';
    S.manBase = {bike: b.id, manual: now};
  }
  /* Unverändert: nicht neu zeichnen, damit eine angefangene Link-Eingabe bleibt (ab 1.2.1) */
  const sig = canon([b.id, bikeName(b), !!has, !!S.editing.manual, m, S.manMsg || '']);
  if (!force && body.dataset.sig === sig && body.innerHTML) return;
  body.dataset.sig = sig;
  if (!keep || !S.manBase || S.manBase.bike !== b.id) S.manBase = {bike: b.id, manual: now};
  if (has && !S.editing.manual) {
    const open = m.kind === 'pdf'
      ? '<a class="btn primary" data-filehref="' + esc(m.fileId) + '" href="#" target="_blank" rel="noopener">Anleitung öffnen</a><a class="btn" data-filehref="' + esc(m.fileId) + '" href="#" download="' + esc(m.name || 'anleitung.pdf') + '">Herunterladen</a>'
      : '<a class="btn primary" href="' + esc(safeUrl(m.url)) + '" target="_blank" rel="noopener">Anleitung öffnen</a>';
    $('#manBody').innerHTML = '<div class="manual"><span class="doc-icon">' + (m.kind === 'pdf' ? 'PDF' : 'LINK') + '</span><div class="stack" style="gap:4px;min-width:0;flex:1"><b style="overflow-wrap:anywhere">' + esc(m.name || bikeName(b)) + '</b><span class="hint">' + (m.kind === 'pdf' ? 'Auf diesem Gerät gespeichert, ' + fmtSize(m.size) + ', auch offline' : 'Link zur Anleitung, braucht Internet') + '</span></div></div>'
      + '<div class="row" style="margin-top:12px">' + open + '<button class="mini" type="button" id="manReplace">Ersetzen</button><button class="mini" type="button" id="manRemove" data-arm="Entfernen?">Entfernen</button></div>';
    hydrateLinks($('#manBody'));
    return;
  }
  $('#manBody').innerHTML = '<p class="hint" style="margin-bottom:10px">Leg hier die Bedienungsanleitung für ' + esc(bikeName(b)) + ' ab. Eine PDF wird auf diesem Gerät gespeichert und ist auch ohne Netz da.</p>'
    + '<div class="f" style="margin-bottom:12px"><label for="manFile">PDF wählen (bis 40 MB)</label><input type="file" id="manFile" accept="application/pdf,.pdf"></div>'
    + '<form id="manLinkForm" class="stack" data-bike="' + esc(b.id) + '" novalidate>' + (S.manMsg ? '<p class="warnbox" role="alert">' + esc(S.manMsg) + '</p>' : '') + '<div class="f"><label for="manUrl">Oder Link einfügen</label><input id="manUrl" type="url" inputmode="url" autocomplete="off" placeholder="https://…"></div><div class="row"><button class="btn primary" type="submit">Link speichern</button>' + (S.editing.manual ? '<button class="btn ghost" type="button" id="manCancel">Abbrechen</button>' : '') + '</div></form>';
  if (keep) $('#manUrl').value = keep;
}
function hydrateLinks(root){
  $$('a[data-filehref]', root).forEach(a => { const id = a.dataset.filehref; fileUrl(id).then(u => { if (a.dataset.filehref !== id) return; if (u) a.href = u; else { a.removeAttribute('href'); a.setAttribute('aria-disabled', 'true'); a.textContent = 'Datei fehlt'; } }, () => {}); });
}

function oemRows(b){ return (b.oem && Array.isArray(b.oem.rows)) ? b.oem.rows : []; }
function renderOem(){
  const b = curBike(); if (!b) return;
  if (S.editing.oem) return;
  const o = b.oem || {}, rows = oemRows(b), src = safeUrl(o.sourceUrl);
  $('#oemBody').innerHTML = rows.length
    ? '<div class="oem">' + rows.map(r => '<div class="oem-row"><div class="oem-when">' + esc(r.when) + '</div><div>' + esc(r.what) + '</div></div>').join('') + '</div>'
      + (o.note ? '<p class="hint" style="margin-top:10px;white-space:pre-wrap">' + esc(o.note) + '</p>' : '')
      + (src ? '<p class="hint" style="margin-top:8px">Quelle: <a href="' + esc(src) + '" target="_blank" rel="noopener">' + esc(o.sourceTitle || 'Herstellerseite') + '</a></p>' : (o.sourceTitle ? '<p class="hint" style="margin-top:8px">Quelle: ' + esc(o.sourceTitle) + '</p>' : ''))
    : '<p class="hint">Noch keine Herstellervorgaben eingetragen. Tipp auf „Bearbeiten“ und übernimm sie aus dem Wartungsplan deiner Bedienungsanleitung.</p>';
}
function oemEditHTML(){
  const d = S.oemDraft;
  return '<form id="oemForm" class="stack" data-bike="' + esc(d.bike) + '" novalidate>' + (d.msg ? '<p class="warnbox" role="alert">' + esc(d.msg) + '</p>' : '') + '<div id="oemRows" class="stack" style="gap:6px">'
    + d.rows.map((r, i) => '<div class="oem-edit"><input data-oem="when" data-i="' + i + '" value="' + esc(r.when) + '" placeholder="alle 15 h" aria-label="Wann, Zeile ' + (i + 1) + '"><input data-oem="what" data-i="' + i + '" value="' + esc(r.what) + '" placeholder="Was wird gemacht" aria-label="Was, Zeile ' + (i + 1) + '"><button class="mini" type="button" data-oemrm="' + i + '" aria-label="Zeile ' + (i + 1) + ' entfernen">×</button></div>').join('')
    + '</div><div class="row"><button class="btn" type="button" id="oemAdd">Zeile hinzufügen</button></div>'
    + '<div class="f"><label for="oemNote">Hinweis</label><textarea id="oemNote" rows="2">' + esc(d.note) + '</textarea></div>'
    + '<div class="grid"><div class="f"><label for="oemSrcT">Quelle</label><input id="oemSrcT" value="' + esc(d.sourceTitle) + '" placeholder="z. B. Bedienungsanleitung S. 120"></div><div class="f"><label for="oemSrcU">Link zur Quelle</label><input id="oemSrcU" type="url" value="' + esc(d.sourceUrl) + '" placeholder="https://…"></div></div>'
    + '<div class="row"><button class="btn primary" type="submit">Speichern</button><button class="btn ghost" type="button" data-cancel="oem">Abbrechen</button></div></form>';
}

export function renderBike(){
  const b = curBike();
  if (!b) return;
  renderBanner(); renderStatus(); renderLog(); renderRides(); renderSetups(); renderGarage(); renderManual(); renderOem();
  renderQuick();
}

/* ---------- Garage: Bearbeiten-Formulare ---------- */
/* Bearbeiten unter Technik. src: anzuzeigende Werte (Standard: das Motorrad; nach einer Änderung in einem anderen Fenster
   der zusammengeführte Stand). Grundlage des Entwurfs (S.editBase) = gespeicherter Stand dieser Felder beim Öffnen. */
const EDIT_FIELDS = {bike: ['brand', 'short', 'model', 'year', 'color', 'nickname'], tc: ['tires', 'chain'], oil: ['fluids'], int: ['items', 'unit'], oem: ['oem']};
/* nz: zum Vergleichen (leer = nichts); nu: gespeicherter Wert unverändert (nur „fehlt“ = null), für die Prüfung im Speicher */
const nz = v => v === undefined || v === '' ? null : v;
const nu = v => v === undefined ? null : v;
const pickRaw = (raw, fields) => { const o = {}; fields.forEach(f => { o[f] = clone(nu(raw ? raw[f] : null)); }); return o; };
function editBaseOf(key, b){
  const raw = store.peek('bikes', b.id);
  return {bike: b.id, epoch: S.epoch || '', fp: store.bikeFpOf(b.id), raw: pickRaw(raw, EDIT_FIELDS[key] || [])};
}
function openEdit(key, src, msg){
  const b = curBike(); if (!b) return;
  S.editing[key] = true;
  if (EDIT_FIELDS[key] && !src) S.editBase[key] = editBaseOf(key, b);
  const v = Object.assign({}, b, src || {});
  const u = key === 'int' ? (v.unit === 'km' ? 'km' : 'h') : U(b), cur = curOf(b);
  const warn = msg ? '<p class="warnbox full" role="alert">' + esc(msg) + '</p>' : '';
  if (key === 'bike') { const b = v;
    const known = !!brandOf(b);
    const opts = BRAND_LIST.map(x => '<option value="' + esc(x.n) + '"' + ((brandOf(b) === x || (!known && x.n === 'Andere')) ? ' selected' : '') + '>' + esc(x.n) + '</option>').join('');
    $('#bikeBody').innerHTML = '<form id="bikeForm" class="grid" data-bike="' + esc(b.id) + '" novalidate>'
      + '<div class="f full"><label for="ebNick">Spitzname</label><input id="ebNick" maxlength="40" value="' + esc(b.nickname || '') + '" placeholder="optional"></div>'
      + '<div class="f"><label for="ebBrand">Marke</label><select id="ebBrand">' + opts + '</select></div>'
      + '<div class="f"><label for="ebColor">Farbe</label><input type="color" id="ebColor" value="' + colorOf(b) + '"></div>'
      + '<div class="f full" id="ebOtherWrap"' + (known && brandOf(b).n !== 'Andere' ? ' hidden' : '') + '><label for="ebOther">Markenname</label><input id="ebOther" value="' + esc(known ? (brandOf(b).n === 'Andere' ? '' : b.brand) : b.brand) + '"></div>'
      + '<div class="f"><label for="ebModel">Modell</label><input id="ebModel" list="ebModels" autocomplete="off" value="' + esc(b.model || '') + '"><datalist id="ebModels">' + modelOptions(known ? brandOf(b).n : '') + '</datalist></div>'
      + '<div class="f"><label for="ebYear">Baujahr</label><input id="ebYear" inputmode="numeric" value="' + esc(b.year || '') + '"></div>'
      + '<div class="f full row"><button class="btn primary" type="submit">Speichern</button><button class="btn ghost" type="button" data-cancel="bike">Abbrechen</button></div>'
      + '<div class="f full danger-zone"><button class="mini" type="button" id="bikeRemove" data-arm="Wirklich alles löschen?">Motorrad entfernen</button><p class="hint" style="margin-top:6px">Löscht das Motorrad mit allen Einträgen, Fahrten, Setups, Mängeln und Fotos. Mach vorher eine Sicherung, wenn du unsicher bist.</p></div></form>';
    if (warn) $('#bikeForm').insertAdjacentHTML('afterbegin', warn);
  }
  if (key === 'tc') {
    const t = v.tires || {}, c = v.chain || {}, tf = t.front || {}, tr = t.rear || {};
    const ph = cur == null ? '' : ' placeholder="' + esc(v2(cur)) + '"';
    $('#tcBody').innerHTML = '<form id="tcForm" class="stack" data-bike="' + esc(b.id) + '" novalidate>'
      + '<fieldset><legend>Reifen vorn</legend><div class="grid"><div class="f full"><label for="tfM">Modell</label><input id="tfM" value="' + esc(tf.model || '') + '" placeholder="z. B. Michelin Starcross 6"></div><div class="f"><label for="tfA">Montiert bei (' + u + ')</label><input id="tfA" inputmode="decimal" value="' + esc(v2(tf.at)) + '"' + ph + '></div><div class="f"><label for="tfD">am</label><input type="date" id="tfD" value="' + esc(tf.date || '') + '" max="' + todayISO() + '"></div></div></fieldset>'
      + '<fieldset><legend>Reifen hinten</legend><div class="grid"><div class="f full"><label for="trM">Modell</label><input id="trM" value="' + esc(tr.model || '') + '"></div><div class="f"><label for="trA">Montiert bei (' + u + ')</label><input id="trA" inputmode="decimal" value="' + esc(v2(tr.at)) + '"' + ph + '></div><div class="f"><label for="trD">am</label><input type="date" id="trD" value="' + esc(tr.date || '') + '" max="' + todayISO() + '"></div></div></fieldset>'
      + '<fieldset><legend>Kette &amp; Übersetzung</legend><div class="grid"><div class="f"><label for="cF">Ritzel (Zähne)</label><input id="cF" inputmode="numeric" value="' + esc(c.front || '') + '"></div><div class="f"><label for="cR">Kettenrad (Zähne)</label><input id="cR" inputmode="numeric" value="' + esc(c.rear || '') + '"></div><div class="f"><label for="cB">Kette</label><input id="cB" value="' + esc(c.brand || '') + '" placeholder="z. B. DID 520 ERV3"></div><div class="f"><label for="cL">Glieder</label><input id="cL" inputmode="numeric" value="' + esc(c.links || '') + '"></div><div class="f"><label for="cA">Montiert bei (' + u + ')</label><input id="cA" inputmode="decimal" value="' + esc(v2(c.at)) + '"' + ph + '></div><div class="f"><label for="cD">am</label><input type="date" id="cD" value="' + esc(c.date || '') + '" max="' + todayISO() + '"></div></div></fieldset>'
      + '<p class="hint">Wenn du ein neues Modell oder einen neuen Montage-Stand einträgst, landet der Wechsel automatisch im Logbuch.</p>'
      + '<div class="row"><button class="btn primary" type="submit">Speichern</button><button class="btn ghost" type="button" data-cancel="tc">Abbrechen</button></div></form>';
    if (warn) $('#tcForm').insertAdjacentHTML('afterbegin', warn);
  }
  if (key === 'oil') {
    const fl = v.fluids || {};
    $('#oilBody').innerHTML = '<form id="oilForm" class="stack" data-bike="' + esc(b.id) + '" novalidate>' + FLUIDS.map(([k, l]) => { const f = fl[k] || {}; return '<fieldset><legend>' + l + '</legend><div class="grid3"><div class="f"><label for="o_' + k + '_b">Marke</label><input id="o_' + k + '_b" value="' + esc(f.brand || '') + '" maxlength="120"></div><div class="f"><label for="o_' + k + '_s">Sorte</label><input id="o_' + k + '_s" value="' + esc(f.spec || '') + '" maxlength="120"' + (k === 'motor' ? ' placeholder="z. B. 10W-50"' : '') + '></div><div class="f"><label for="o_' + k + '_q">Menge</label><input id="o_' + k + '_q" value="' + esc(f.qty || '') + '" maxlength="60"' + (k === 'motor' ? ' placeholder="z. B. 1,1 l"' : '') + '></div></div></fieldset>'; }).join('')
      + '<div class="row"><button class="btn primary" type="submit">Speichern</button><button class="btn ghost" type="button" data-cancel="oil">Abbrechen</button></div></form>';
    if (warn) $('#oilForm').insertAdjacentHTML('afterbegin', warn);
  }
  if (key === 'int') {
    const row = it => '<tr data-id="' + esc(it.id || '') + '"><td><input data-k="name" value="' + esc(it.name || '') + '" aria-label="Name" maxlength="120"></td><td class="n"><input data-k="every" inputmode="decimal" value="' + esc(v2(it.every)) + '" aria-label="Intervall ' + u + '"></td><td class="n"><input data-k="months" inputmode="numeric" value="' + esc(it.months || '') + '" aria-label="Intervall Monate"></td><td class="n"><input data-k="lastAt" inputmode="decimal" value="' + esc(v2(it.lastAt)) + '" aria-label="Startwert bei"></td><td><input data-k="lastDate" type="date" value="' + esc(it.lastDate || '') + '" max="' + todayISO() + '" aria-label="Startwert am"></td><td><button class="mini" type="button" data-rmrow aria-label="Punkt entfernen">×</button></td></tr>';
    $('#intBody').innerHTML = '<form id="intForm" class="stack" data-bike="' + esc(b.id) + '" novalidate><div class="f"><label for="iUnit">Zählt nach</label><select id="iUnit"><option value="h">Betriebsstunden</option><option value="km">Kilometern</option></select></div>'
      + '<div class="tbl-wrap"><table class="int"><thead><tr><th>Wartungspunkt</th><th>alle ' + u + '</th><th>alle Mon.</th><th>Startwert bei</th><th>Startwert am</th><th><span class="sr">Entfernen</span></th></tr></thead><tbody id="intRows">' + (v.items || []).map(row).join('') + '</tbody></table></div>'
      + '<div class="row"><button class="btn" type="button" id="intAdd">Punkt hinzufügen</button></div>'
      + '<p class="hint">Den Startwert brauchst du nur, wenn die letzte Arbeit nicht im Logbuch steht. Ein neuerer Logbuch-Eintrag gilt automatisch. Einfacher geht es unter Status über „Erledigt“.' + (offOf(b) ? ' Nach einem Zählerwechsel gilt der Startwert als Anzeige des Zählers, der am Startdatum eingebaut war (ohne Datum: des ersten Zählers). Liegt das Startdatum auf dem Tag eines Zählerwechsels, fragt Racebook beim Speichern, welcher Zähler gemeint ist.' : '') + '</p>'
      + '<div class="row"><button class="btn primary" type="submit">Speichern</button><button class="btn ghost" type="button" data-cancel="int">Abbrechen</button></div></form>';
    if (warn) $('#intForm').insertAdjacentHTML('afterbegin', warn);
    $('#iUnit').value = u;
    $('#intAdd').onclick = () => { drafts.touch('edit-int'); $('#intRows').insertAdjacentHTML('beforeend', row({})); };
  }
  if (key === 'oem') {
    const o = v.oem || {};
    S.oemDraft = {bike: b.id, rows: oemRows(v).map(r => ({when: r.when || '', what: r.what || ''})), note: o.note || '', sourceTitle: o.sourceTitle || '', sourceUrl: o.sourceUrl || '', msg: msg || ''};
    if (!S.oemDraft.rows.length) S.oemDraft.rows.push({when: '', what: ''});
    $('#oemBody').innerHTML = oemEditHTML();
  }
  renderGarage();
  $$('[data-edit="oem"]').forEach(x => { x.disabled = !!S.editing.oem; });
  if (!src) drafts.mark('edit-' + key);
}
function closeEdit(key){ S.editing[key] = false; delete S.editBase[key]; drafts.forget('edit-' + key); if (key === 'oem') S.oemDraft = null; R.renderAll(); }

/* ---------- Schutz des ganzen Entwurfs (P2-C) ----------
   Gespeichert wird nur, wenn die bearbeiteten Felder im Speicher noch genau dem Stand beim Öffnen entsprechen (guard,
   geprüft im Schreibvorgang). Mit Zählerauswahl muss zusätzlich der ganze Stand des Motorrads noch derselbe sein wie beim
   Öffnen (expect fp aus S.editBase, nie ein später neu erzeugter Fingerabdruck). Hat sich etwas geändert, wird nichts
   gespeichert: Racebook führt die eigenen Änderungen mit dem aktuellen Stand zusammen, zeigt das Ergebnis im Formular und
   nennt echte Konflikte. Erst ein erneutes „Speichern“ übernimmt es. */
const EDIT_MSG = 'Diese Daten wurden inzwischen in einem anderen Fenster geändert. Es wurde nichts gespeichert. Bitte prüfe den aktuellen Stand.';
const FIELD_NAMES = {brand: 'Marke', short: 'Kurzname', model: 'Modell', year: 'Baujahr', color: 'Farbe', nickname: 'Spitzname', unit: 'Einheit', every: 'Intervall', months: 'Monate', lastAt: 'Startwert', lastDate: 'Startdatum', name: 'Name', at: 'Stand', date: 'Datum', front: 'Ritzel', rear: 'Kettenrad', links: 'Glieder', spec: 'Sorte', qty: 'Menge', rows: 'Herstellervorgaben', note: 'Hinweis', sourceTitle: 'Quelle', sourceUrl: 'Link zur Quelle'};
const showVal = v => v == null || v === '' ? 'leer' : typeof v === 'number' ? fmt(v, 2) : typeof v === 'string' ? '„' + v + '“' : 'geändert';
/* Drei-Wege-Zusammenführung einzelner Felder: eigene Änderung (mine ≠ base) gewinnt, die des anderen Fensters bleibt
   sonst erhalten; wurde dasselbe Feld unterschiedlich geändert, ist es ein Konflikt (im Formular steht die eigene Eingabe) */
function merge3(base, mine, cur, keys, where, conflicts){
  const out = Object.assign({}, cur || {});
  keys.forEach(k => {
    const b0 = nz(base && base[k]), m = nz(mine && mine[k]), c = nz(cur && cur[k]);
    if (canon(m) === canon(b0)) return;
    out[k] = clone(m);
    if (canon(c) !== canon(b0) && canon(c) !== canon(m)) conflicts.push(where + (FIELD_NAMES[k] || k) + ': dort ' + showVal(c) + ', bei dir ' + showVal(m));
  });
  return out;
}
function mergeEdit(key, base, mine, cur, b){
  const conflicts = [], out = {};
  if (key === 'bike') Object.assign(out, merge3(base, mine, cur, EDIT_FIELDS.bike, '', conflicts));
  if (key === 'oil') { out.fluids = {}; FLUIDS.forEach(([k, l]) => { out.fluids[k] = merge3((base.fluids || {})[k], (mine.fluids || {})[k], (cur.fluids || {})[k], ['brand', 'spec', 'qty'], l + ', ', conflicts); }); }
  if (key === 'oem') out.oem = merge3(base.oem, mine.oem, cur.oem, ['rows', 'note', 'sourceTitle', 'sourceUrl'], '', conflicts);
  if (key === 'tc') {
    const t0 = base.tires || {}, tm = mine.tires || {}, tc = cur.tires || {};
    out.tires = {front: merge3(t0.front, tm.front, tc.front, ['model', 'at', 'date'], 'Reifen vorn, ', conflicts), rear: merge3(t0.rear, tm.rear, tc.rear, ['model', 'at', 'date'], 'Reifen hinten, ', conflicts)};
    out.chain = merge3(base.chain, mine.chain, cur.chain, ['front', 'rear', 'brand', 'links', 'at', 'date'], 'Kette, ', conflicts);
  }
  if (key === 'int') {
    const bi = base.items || [], mi = mine.items || [], ci = cur.items || [];
    const byId = (l, id) => l.find(x => x.id === id);
    const KEYS = ['name', 'every', 'months', 'lastAt', 'lastDate'];
    const items = [];
    ci.forEach(c => {
      const b0 = byId(bi, c.id), m = byId(mi, c.id);
      if (!b0) { items.push(c); return; }
      if (!m) {
        /* Bei dir entfernt: nur, wenn das andere Fenster den Punkt nicht geändert hat */
        if (KEYS.some(k => canon(nz(c[k])) !== canon(nz(b0[k])))) { items.push(c); conflicts.push('„' + c.name + '“: bei dir entfernt, dort geändert (bleibt erhalten)'); }
        return;
      }
      items.push(merge3(b0, m, c, KEYS, '„' + (m.name || c.name) + '“, ', conflicts));
    });
    bi.forEach(b0 => { if (!byId(ci, b0.id) && byId(mi, b0.id) && KEYS.some(k => canon(nz(byId(mi, b0.id)[k])) !== canon(nz(b0[k])))) conflicts.push('„' + b0.name + '“: dort entfernt, bei dir geändert (entfernt)'); });
    mi.forEach(m => { if (!byId(bi, m.id) && !byId(ci, m.id)) items.push(m); });
    out.items = items;
    out.unit = merge3(base, mine, cur, ['unit'], '', conflicts).unit;
  }
  return {value: out, conflicts};
}
/* Grundlage geändert: nichts speichern, zusammenführen, anzeigen. mine = Felder, wie sie dieses Formular schreiben würde */
function rebaseEdit(key, b, mine){
  const eb = S.editBase[key]; if (!eb) return;
  const raw = store.peek('bikes', b.id);
  if (!raw) { toast('Das Motorrad gibt es nicht mehr. Es wurde nichts gespeichert.'); return; }
  const cur = pickRaw(raw, EDIT_FIELDS[key]);
  const m = mergeEdit(key, eb.raw, mine, cur, b);
  const own = EDIT_FIELDS[key].some(f => f in m.value && canon(m.value[f]) !== canon(cur[f]));
  S.editBase[key] = {bike: b.id, epoch: S.epoch || '', fp: store.bikeFpOf(b.id), raw: cur};
  const msg = EDIT_MSG + (m.conflicts.length ? ' Unterschiedlich geändert: ' + m.conflicts.join('; ') + '. Im Formular steht deine Eingabe; prüf sie und tipp erneut auf „Speichern“.' : own ? ' Deine Änderungen sind in den aktuellen Stand übernommen; tipp erneut auf „Speichern“.' : '');
  S.editing[key] = false;
  openEdit(key, m.value, msg);
  if (!own) drafts.mark('edit-' + key);
  toast(EDIT_MSG);
}
/* Vor dem Speichern: Grundlage der bearbeiteten Felder noch gültig? */
function editStale(key, b){
  const eb = S.editBase[key];
  if (!eb || eb.bike !== b.id) return true;
  const raw = store.peek('bikes', b.id);
  return !raw || EDIT_FIELDS[key].some(f => canon(nu(raw[f])) !== canon(nu(eb.raw[f])));
}
const editGuard = key => { const eb = S.editBase[key]; return eb ? clone(eb.raw) : null; };
/* Speichern unter Technik: nur die eigenen Felder, nur auf der Grundlage des Entwurfs */
async function commitEdit(key, b, patch, extraItems, fp){
  const items = [{coll: 'bikes', id: b.id, patch, guard: editGuard(key)}].concat(extraItems || []);
  const r = await flow(() => store.commitR(items, null, 'technik-' + key, {epoch: (S.editBase[key] || {}).epoch || S.epoch || '', expect: fp ? {bike: b.id, fp} : null}));
  if (r === 'ok') return true;
  if (r === 'fail' && S.lastErr && S.lastErr.code === 'changed') { await store.reloadAll().catch(() => {}); const nb = S.bikes[b.id]; if (nb && S.editing[key]) rebaseEdit(key, nb, patch); return false; }
  toast(r === 'fail' ? errText(S.lastErr) + ' Es wurde nichts gespeichert.' : 'Unklar, ob gespeichert wurde. Tipp noch einmal auf „Speichern“.');
  return false;
}
function syncOemDraft(){
  if (!S.oemDraft) return;
  $$('[data-oem]').forEach(inp => { const r = S.oemDraft.rows[+inp.dataset.i]; if (r) r[inp.dataset.oem] = inp.value; });
  const n = $('#oemNote'); if (n) S.oemDraft.note = n.value;
  const t = $('#oemSrcT'); if (t) S.oemDraft.sourceTitle = t.value;
  const u = $('#oemSrcU'); if (u) S.oemDraft.sourceUrl = u.value;
}

/* Angaben vom Tag eines Zählerwechsels ohne gespeicherte Stelle (aus 1.1.0 und älter): fragen, welcher Zähler gemeint war,
   und die Stelle nachtragen. Die Auswahl beruht auf einem festgehaltenen Datenstand des Motorrads (fp). Geschrieben wird in
   einem Vorgang, den der Speicher nur ausführt, wenn der Stand noch derselbe ist (wie bei „Tippfehler berichtigen“);
   sonst wird nichts gespeichert und neu gefragt. Eine frühere Wahl wird dabei nie übernommen. */
let segBusy = false;
const segRowsOf = bid => { const b = S.bikes[bid]; if (!b) return []; derive(); return ambList(b).map(a => Object.assign({}, a, {key: a.kind + ':' + a.id, label: a.label + ': ' + fmt(a.at, 2) + ' ' + U(b)})); };
async function segFix(b){
  if (segBusy) return;
  if (!segRowsOf(b.id).length) { toast('Hier ist nichts mehr zuzuordnen.'); return; }
  segBusy = true;
  try {
    let msg = '';
    for (;;) {
      const res = await askSegments(b, () => segRowsOf(b.id), msg);
      if (!res) return;
      if (res.stale) { toast('Der Zählerverlauf hat sich inzwischen geändert. Steht oben noch „Angaben zuordnen“, bitte dort neu zuordnen.'); return; }
      const cur = S.bikes[b.id]; if (!cur) return;
      const keys = new Set(Object.keys(res.pick)), pick = res.pick;
      const patch = {};
      if ([...keys].some(k => k.startsWith('item:'))) patch.items = (cur.items || []).map(it => keys.has('item:' + it.id) ? Object.assign({}, it, {lastC: pick['item:' + it.id]}) : it);
      if (keys.has('tire:front') || keys.has('tire:rear')) {
        const t = cur.tires || {};
        patch.tires = {front: keys.has('tire:front') ? Object.assign({}, t.front, {c: pick['tire:front']}) : t.front, rear: keys.has('tire:rear') ? Object.assign({}, t.rear, {c: pick['tire:rear']}) : t.rear};
      }
      if (keys.has('chain:chain')) patch.chain = Object.assign({}, cur.chain, {c: pick['chain:chain']});
      const r = await flow(() => store.commitR([{coll: 'bikes', id: b.id, patch}], null, 'zuordnen', {epoch: S.epoch || '', expect: {bike: b.id, fp: res.fp}}));
      if (r === 'ok') { toast('Zugeordnet.'); return; }
      if (r === 'fail' && S.lastErr && S.lastErr.code === 'changed') { await store.reloadAll().catch(() => {}); msg = SEG_SAVE_CHANGED; continue; }
      toast(r === 'fail' ? errText(S.lastErr) + ' Es wurde nichts gespeichert.' : 'Unklar, ob gespeichert wurde. Sieh oben nach, ob „Angaben zuordnen“ noch da ist.');
      return;
    }
  } finally { segBusy = false; }
}

/* Reifen/Kette: Motorrad und Logbuch-Zeilen in EINEM Vorgang. Eine Wiederholung nutzt dieselben IDs. */
async function saveTC(b){
  const t = b.tires || {}, c = b.chain || {}, tf = t.front || {}, tr = t.rear || {}, lim = LIM[U(b)].cnt;
  const nf = {model: str($('#tfM').value).slice(0, 120), at: fieldNum('tfA', 'Reifen vorn, Stand', {min: 0, max: lim}), date: fieldDate('tfD', 'Reifen vorn, Datum') || ''};
  const nr = {model: str($('#trM').value).slice(0, 120), at: fieldNum('trA', 'Reifen hinten, Stand', {min: 0, max: lim}), date: fieldDate('trD', 'Reifen hinten, Datum') || ''};
  const nc = {front: fieldNum('cF', 'Ritzel', {int: true, min: 5, max: 99}), rear: fieldNum('cR', 'Kettenrad', {int: true, min: 5, max: 99}), brand: str($('#cB').value).slice(0, 120), links: fieldNum('cL', 'Kettenglieder', {int: true, min: 40, max: 250}), at: fieldNum('cA', 'Kette, Stand', {min: 0, max: lim}), date: fieldDate('cD', 'Kette, Datum') || ''};
  /* Grundlage des Entwurfs noch gültig? Sonst nichts speichern, sondern zusammenführen und prüfen lassen (P2-C) */
  const mineTC = clone({tires: {front: nf, rear: nr}, chain: nc});
  if (editStale('tc', b)) { parkOp('tcForm'); rebaseEdit('tc', b, mineTC); return false; }
  const sm = (a, x) => (a == null ? null : a) === (x == null ? null : x);
  const today = todayISO(), cur = curOf(b);
  const fChanged = nf.model && (nf.model !== tf.model || !sm(nf.at, tf.at));
  const rChanged = nr.model && (nr.model !== tr.model || !sm(nr.at, tr.at));
  const cChanged = (nc.brand || nc.front || nc.rear) && (nc.brand !== (c.brand || '') || !sm(nc.at, c.at) || !sm(nc.front, c.front) || !sm(nc.rear, c.rear));
  const auto = new Set();
  [[fChanged, nf], [rChanged, nr], [cChanged, nc]].forEach(([ch, o]) => { if (ch) { if (!o.date) o.date = today; if (o.at == null && o.date === today) { o.at = cur; auto.add(o); } } });
  const o = opFor('tcForm', b.id, 'bikes', null, canon([nf, nr, nc])); if (o.saving) return false;
  o.noTrack = true;
  /* Welcher Zähler war gemeint? Neu eingetragene Montagen behalten ihre Stelle im Verlauf (Erfassungszeit c), damit ein
     späterer Zählerwechsel am selben Tag sie nicht dem neuen Zähler zuschlägt. Liegt das Datum auf einem Tag mit
     Zählerwechsel, wird gefragt (außer der Stand wurde eben aus der aktuellen Anzeige übernommen). Unverändert = wie bisher. */
  if (!o.payload) {
    derive();
    const ask = [];
    /* Dieselbe Montage = gleiches Reifenmodell bzw. gleiche Kette und gleiches Datum. Nur dann behält sie ihre Stelle, auch
       wenn der Stand berichtigt wird. Ein neues Modell ist eine neue Montage, selbst bei zufällig gleichem Stand und Datum:
       Nach einem Zählerwechsel beweisen gleiche Zahlen nicht denselben Vorgang. */
    const ident = {front: x => x.model || '', rear: x => x.model || '', chain: x => x.brand || ''};
    o.segFp = null;
    for (const [ch, x, prev, key, lbl] of [[fChanged, nf, tf, 'front', 'Reifen vorn'], [rChanged, nr, tr, 'rear', 'Reifen hinten'], [cChanged, nc, c, 'chain', 'Kette']]) {
      if (x.at == null || !x.date) continue;
      if (auto.has(x)) { x.c = o.created; continue; }
      const sameMount = ident[key](x) === ident[key](prev) && (x.date || '') === (prev.date || '');
      if (sameMount && prev.c != null) { x.c = prev.c; continue; }
      if (sameMount && sm(x.at, prev.at)) continue;
      if (!meterSegments(b, x.date).length) { x.c = o.created; continue; }
      ask.push({key, label: lbl + ' montiert bei ' + fmt(x.at, 2) + ' ' + U(b), date: x.date, x});
    }
    if (ask.length) {
      const res = await askSegments(b, ask);
      if (!res) return false;
      if (res.stale) { toast('Der Zählerverlauf hat sich inzwischen geändert. Bitte noch einmal speichern.'); return false; }
      /* Die Auswahl gilt nur, wenn sie auf demselben Stand beruht wie der ganze Entwurf. Ein neuer Fingerabdruck gibt den
         älteren Entwurf nicht frei: dann zusammenführen und neu prüfen lassen. */
      if (res.fp !== (S.editBase.tc || {}).fp) { parkOp('tcForm'); rebaseEdit('tc', S.bikes[b.id] || b, mineTC); return false; }
      ask.forEach(a => { a.x.c = res.pick[a.key]; });
      o.segFp = res.fp;
    }
  }
  /* Auffällig hoher Montage-Stand? Nur geänderte Werte, verglichen mit dem Stand am Montagedatum */
  if (!o.payload) for (const [ch, x, prevAt, el] of [[fChanged, nf, tf.at, 'tfA'], [rChanged, nr, tr.at, 'trA'], [cChanged, nc, c.at, 'cA']]) {
    if (!ch || x.at == null || sm(x.at, prevAt)) continue;
    if (!(await jumpOk(o, b, x.date || today, x.at, el, posAt(b.id, x.date || today, x.c != null ? x.c : Infinity).disp))) return false;
  }
  if (!o.payload) {
    const now = o.created, base = {bike: b.id, tasks: [], taskNames: [], extra: '', cost: null, note: '', atAuto: false};
    const items = [{coll: 'bikes', id: b.id, patch: {tires: {front: nf, rear: nr}, chain: nc}, guard: editGuard('tc')}];
    if (fChanged) items.push({coll: 'log', id: 'tc' + uid(), data: canonDoc('log', Object.assign({}, base, {kind: 'tire', date: nf.date, at: nf.at, title: 'Reifen vorn: ' + nf.model, created: now}))});
    if (rChanged) items.push({coll: 'log', id: 'tc' + uid(), data: canonDoc('log', Object.assign({}, base, {kind: 'tire', date: nr.date, at: nr.at, title: 'Reifen hinten: ' + nr.model, created: now + 1}))});
    if (cChanged) items.push({coll: 'log', id: 'tc' + uid(), data: canonDoc('log', Object.assign({}, base, {kind: 'chain', date: nc.date, at: nc.at, title: 'Kette/Übersetzung: ' + [nc.front && nc.rear ? nc.front + '/' + nc.rear : '', nc.brand, nc.links ? nc.links + ' Glieder' : ''].filter(Boolean).join(', '), created: now + 2}))});
    o.payload = {items}; o.label = 'Reifen & Kette';
  }
  /* Mit Zählerauswahl: der Speicher prüft, dass der Stand des Motorrads noch der ist, auf dem die Auswahl beruht.
     Nach unklarem Ergebnis erst nachsehen, ob es schon gespeichert ist (die Prüfung würde sonst am eigenen Eintrag scheitern). */
  if (o.state === 'unclear' && o.payload.items.every(it => it.patch ? subOf(it.patch, store.peek('bikes', it.id) || {}) : S.log.some(l => l.id === it.id))) {
    delete S.ops.tcForm; toast('Gespeichert.'); return true;
  }
  o.quietFail = true;
  const r = await execOp('tcForm', o, () => store.commitR(o.payload.items, null, 'tc', {epoch: o.epoch, expect: o.segFp ? {bike: b.id, fp: o.segFp} : null}));
  if (r === 'ok') { toast(o.payload.items.length > 1 ? 'Gespeichert, Wechsel im Logbuch eingetragen.' : 'Gespeichert.'); return true; }
  if (r === 'fail' && S.lastErr && S.lastErr.code === 'changed') { await store.reloadAll().catch(() => {}); const nb = S.bikes[b.id]; if (nb && S.editing.tc) rebaseEdit('tc', nb, mineTC); return false; }
  if (r === 'fail') toast(errText(S.lastErr) + ' Es wurde nichts gespeichert.');
  return false;
}
async function saveOil(b){
  const fluids = {};
  FLUIDS.forEach(([k]) => { fluids[k] = {brand: str($('#o_' + k + '_b').value).slice(0, 120), spec: str($('#o_' + k + '_s').value).slice(0, 120), qty: str($('#o_' + k + '_q').value).slice(0, 60)}; });
  if (editStale('oil', b)) { rebaseEdit('oil', b, {fluids}); return false; }
  if (await commitEdit('oil', b, {fluids})) { toast('Gespeichert.'); return true; }
  return false;
}
async function saveInt(b){
  const old = b.items || [];
  const unit = $('#iUnit').value === 'km' ? 'km' : 'h', lim = LIM[unit].cnt;
  const seen = new Set();
  const items = $$('#intRows tr').map(tr => {
    const el = k => $('[data-k="' + k + '"]', tr);
    const name = str(el('name').value).slice(0, 120); if (!name) return null;
    const lbl = name;
    let id = tr.dataset.id;
    if (!validId(id) || seen.has(id)) id = 'p' + uid();
    seen.add(id);
    const prev = old.find(x => x.id === id) || {};
    return {id, name,
      every: fieldNum(el('every'), lbl + ', Intervall', {gt: 0, max: lim}),
      months: fieldNum(el('months'), lbl + ', Monate', {int: true, min: 1, max: 240}),
      lastAt: fieldNum(el('lastAt'), lbl + ', Startwert', {min: 0, max: lim}),
      lastDate: fieldDate(el('lastDate'), lbl + ', Startdatum'),
      kw: prev.kw || [name.toLowerCase()]};
  }).filter(Boolean);
  const mineInt = clone({items, unit});
  if (editStale('int', b)) { rebaseEdit('int', b, mineInt); return false; }
  /* Stelle des Startwerts im Verlauf (lastC): unverändert = wie bisher; neu oder geändert = jetzt erfasst, damit ein
     späterer Zählerwechsel am selben Tag ihn nicht dem neuen Zähler zuschlägt. Am Tag eines Zählerwechsels wird gefragt. */
  derive();
  const now = Date.now(), ask = [];
  let segFp = null;
  for (const it of items) {
    const prev = old.find(x => x.id === it.id);
    if (it.lastAt == null || !it.lastDate) continue;
    /* Derselbe Wartungspunkt am selben Startdatum: Berichtigung des Werts, die Stelle bleibt (falls schon bekannt) */
    if (prev && (prev.lastDate || null) === it.lastDate && prev.lastC != null) { it.lastC = prev.lastC; continue; }
    if (prev && prev.lastAt === it.lastAt && (prev.lastDate || null) === it.lastDate) continue;
    if (!meterSegments(b, it.lastDate).length) { it.lastC = now; continue; }
    ask.push({key: it.id, label: 'Startwert ' + it.name + ': ' + fmt(it.lastAt, 2) + ' ' + U(b), date: it.lastDate, it});
  }
  if (ask.length) {
    const res = await askSegments(b, ask);
    if (!res) return false;
    if (res.stale) { toast('Der Zählerverlauf hat sich inzwischen geändert. Bitte noch einmal speichern.'); return false; }
    /* Nur mit derselben Grundlage wie der ganze Entwurf (P2-C), sonst zusammenführen und neu prüfen lassen */
    if (res.fp !== (S.editBase.int || {}).fp) { rebaseEdit('int', S.bikes[b.id] || b, mineInt); return false; }
    ask.forEach(a => { a.it.lastC = res.pick[a.key]; });
    segFp = res.fp;
  }
  /* Geänderter Startwert deutlich über dem Stand am Startdatum (ohne Datum: heute)? Verglichen mit dem Zähler, der gemeint ist */
  for (const it of items) {
    const prev = old.find(x => x.id === it.id);
    if (it.lastAt == null || (prev && prev.lastAt === it.lastAt)) continue;
    const el = $$('#intRows tr').find(tr => tr.dataset.id === it.id);
    const cmp = it.lastDate ? posAt(b.id, it.lastDate, it.lastC != null ? it.lastC : Infinity).disp : curOf(b);
    if (!(await jumpOk(null, b, it.lastDate || todayISO(), it.lastAt, el ? $('[data-k="lastAt"]', el) : null, cmp))) return false;
  }
  /* Geschrieben werden nur Intervalle und Einheit, und nur, wenn sie im Speicher noch dem Stand beim Öffnen entsprechen (guard).
     Mit Zählerauswahl zusätzlich nur, wenn der ganze Stand des Motorrads noch der beim Öffnen ist (expect). */
  if (await commitEdit('int', b, {items, unit}, null, segFp)) { toast('Gespeichert.'); return true; }
  return false;
}
async function saveOem(b){
  syncOemDraft();
  const d = S.oemDraft;
  const oem = {rows: d.rows.map(r => ({when: str(r.when).slice(0, 60), what: str(r.what).slice(0, 300)})).filter(r => r.when || r.what), note: str(d.note).slice(0, 2000), sourceTitle: str(d.sourceTitle).slice(0, 200), sourceUrl: safeUrl(d.sourceUrl)};
  if (editStale('oem', b)) { rebaseEdit('oem', b, {oem}); return false; }
  if (await commitEdit('oem', b, {oem})) { toast('Gespeichert.'); return true; }
  return false;
}
async function saveBikeEdit(b){
  const sel = $('#ebBrand').value;
  const brand = (sel === 'Andere' ? (str($('#ebOther').value) || 'Andere') : sel).slice(0, 60);
  const year = fieldNum('ebYear', 'Baujahr', {int: true, min: 1900, max: new Date().getFullYear() + 1});
  const br = BRANDS.find(x => x.n === brand);
  const patch = {brand, short: br && br.short ? br.short : null, model: str($('#ebModel').value).slice(0, 80), year, color: $('#ebColor').value, nickname: str($('#ebNick').value).slice(0, 40)};
  if (editStale('bike', b)) { rebaseEdit('bike', b, patch); return false; }
  if (await commitEdit('bike', b, patch)) { toast('Gespeichert.'); return true; }
  return false;
}
/* Motorrad mit allen zugehörigen Einträgen in EINEM Vorgang entfernen. Welche Einträge dazugehören,
   ermittelt der Speicher selbst in der Transaktion (auch solche, die dieses Fenster noch nicht kennt).
   Dateien erst danach und nur, wenn nichts sie mehr verwendet. */
async function removeBike(b){
  const id = b.id, out = {};
  const r = await store.commitR([{coll: 'bikes', id, delBike: true}], null, 'remove-bike', {out});
  if (r !== 'ok') { toast(r === 'unclear' ? UNCLEAR_MSG : errText(S.lastErr) + ' Das Motorrad ist unverändert.'); return; }
  const files = payloadFiles(b);
  (out.removed || []).forEach(x => files.push(...payloadFiles(x.doc)));
  cleanupFiles(files);
  S.editing = {};
  const rest = bikeList().filter(x => x.id !== id);
  S.bike = rest.length ? rest[0].id : ''; lsSet('bike', S.bike);
  toast('Motorrad entfernt.');
  R.navigate({page: 'home'}, {replace: true});
}
async function addBike(){
  const sel = $('#abBrand').value;
  if (!sel) throw new VErr($('#abBrand'), 'Wähl eine Marke. Steht sie nicht in der Liste, nimm „Andere“.');
  const brand = (sel === 'Andere' ? (str($('#abBrandOther').value) || 'Andere') : sel).slice(0, 60);
  const year = fieldNum('abYear', 'Baujahr', {int: true, min: 1900, max: new Date().getFullYear() + 1});
  const tk = $('#abTpl').value, tpl = TEMPLATES[tk] || TEMPLATES.none;
  const unit = $('#abUnit').value === 'km' ? 'km' : 'h';
  const br = BRANDS.find(x => x.n === brand);
  const slug = brand.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'bike';
  const model = str($('#abModel').value).slice(0, 80), color = $('#abColor').value, nickname = str($('#abNick').value).slice(0, 40);
  const ph = S.addPhoto;
  const o = opFor('addBikeForm', '', 'bikes', null, [brand, model, year, tk, unit, color, nickname, ph ? ph.photo.id : ''].join('|')); if (o.saving) return;
  if (!o.payload) {
    o.op = slug + '-' + o.op.slice(-6);
    const items = tpl.items.map(([k, every, months]) => ({id: k, name: INAMES[k], every: every || null, months: months || null, lastAt: null, lastDate: null, kw: KW[k]}));
    const order = bikeList().reduce((m, x) => Math.max(m, x.order == null ? 0 : x.order), -1) + 1;
    o.payload = canonDoc('bikes', {brand, short: br && br.short ? br.short : null, nickname, photo: ph ? ph.photo : null, model, year, unit, current: null, currentT: null, color, order, items, fluids: {}, tires: {}, chain: {}, oem: {rows: []}, manual: null});
    o.files = ph ? ph.files : null;
    o.label = 'Motorrad ' + brand + ' ' + model;
  }
  const id = o.op;
  const r = await execOp('addBikeForm', o, () => store.sSetR('bikes', id, o.payload, o.files, {epoch: o.epoch}));
  if (r === 'ok') { S.bike = id; lsSet('bike', id); closeDraft('addBikeForm'); resetBikeForms(); toast('Motorrad angelegt.'); R.navigate({page: 'bike', bike: id, section: 'status'}, {replace: true}); }
}

/* ---------- Bereich & Motorrad wechseln ---------- */
export function setSection(v, anchor){
  v = v === 'garage' ? ({'g-parts':'inventory','g-tc':'components','g-oil':'specs','g-int':'maintenance'}[anchor] || 'vehicle') : v;
  if (v === 'inventory') { R.navigate({page: 'inventory'}); if (anchor) requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({block:'start'})); return; }
  S.section = v; lsSet('section', v);
  $$('#v-bike .sub').forEach(s => { s.hidden = s.id !== 'v-' + v; });
  $$('.tab').forEach(t => t.setAttribute('aria-current', t.dataset.v === v ? 'page' : 'false'));
  if (S.bike && R.route.page === 'bike') R.navigate({page: 'bike', bike: S.bike, section: v}, {replace: true, silent: true});
  R.renderAll();
  if (anchor) { const el = document.getElementById(anchor); if (el) requestAnimationFrame(() => el.scrollIntoView({block: 'start', behavior: 'smooth'})); }
  else window.scrollTo(0, 0);
}
/* Alle Formulare, die zu einem Motorrad gehören, schließen und an das neue Motorrad binden */
export function resetBikeForms(){
  const id = S.bike;
  const hf = $('#hoursForm'); hf.hidden = true; hoursReset();
  S.doneOpen = null; S.doneDraft = null;
  /* Offene Vorgänge gehören zum bisherigen Motorrad: ungeklärte werden getrennt weiter abgeglichen,
     laufende Speicherungen beenden sich selbst. Neue Generation: späte Abschlüsse lassen die neuen Entwürfe in Ruhe. */
  BIKE_FORMS.forEach(k => { parkOp(k); bumpGen(k); });
  /* Formulare gehören zu Motorrad UND Bestand (Kennung): nach dem Einspielen derselben Garage sind sie neu */
  ['logForm', 'rideForm', 'setupForm', 'defectForm', 'meterForm'].forEach(fid => { const f = $('#' + fid); if (!f) return; f.reset(); f.dataset.bike = id; f.dataset.epoch = S.epoch || ''; $$('[aria-invalid]', f).forEach(x => x.removeAttribute('aria-invalid')); });
  $('#rInWrap').hidden = true;
  hf.dataset.bike = id; hf.dataset.epoch = S.epoch || '';
  $('#logDetails').open = false; $('#rideDetails').open = false; $('#setupDetails').open = false;
  $('#lDate').value = todayISO(); $('#rDate').value = todayISO(); $('#mDate').value = todayISO();
  resetLogState(); logMode(); S.editing = {}; S.editBase = {}; S.manMsg = null; S.manBase = null; S.oemDraft = null; S.editSetup = null; S.checkDraft = null;
  $('#setupFormTitle').textContent = 'Setup speichern'; $('#sSave').textContent = 'Setup speichern'; $('#sCancel').hidden = true;
  R.resetDefectForms();
  ['hours', 'log', 'ride', 'setup', 'part', 'meter', 'defect'].forEach(k => drafts.mark(k));
  drafts.forget('manual');
  ['done', 'defDone', 'check', 'edit-bike', 'edit-tc', 'edit-oil', 'edit-int', 'edit-oem'].forEach(k => drafts.forget(k));
}
export function setBike(id){
  if (!S.bikes[id]) return false;
  /* Auch wenn S.bike schon stimmt (z. B. nach dem Einspielen), aber die Formulare noch an einem
     anderen Motorrad hängen: neu binden */
  const changed = id !== S.bike || $('#logForm').dataset.bike !== id;
  S.bike = id; lsSet('bike', id); S.adding = false;
  if (changed) resetBikeForms();
  return true;
}
/* Gehört das Formular noch zum gewählten Motorrad und zum geladenen Bestand? */
export function formBike(f){
  if (f.dataset.epoch != null && f.dataset.epoch !== (S.epoch || '')) { toast('Das Formular gehörte zum vorherigen Datenbestand und wurde geschlossen. Es wurde nichts gespeichert.'); resetBikeForms(); R.renderAll(); return null; }
  const b = S.bikes[f.dataset.bike];
  if (!b || b.id !== S.bike) { toast('Das Formular gehörte zu einem anderen Motorrad und wurde geschlossen.'); resetBikeForms(); R.renderAll(); return null; }
  return b;
}

/* ---------- Fahrwerk-Formular ---------- */
function fillSetupForm(s, asCopy){
  $('#sTrack').value = asCopy ? '' : (s.track || '');
  SF.forEach(([el, k]) => { $('#' + el).value = v2(s[k]); });
  $('#sNote').value = s.note || '';
  S.editSetup = asCopy ? null : s.id;
  const f = $('#setupForm'); f.dataset.bike = S.bike; f.dataset.epoch = S.epoch || ''; parkOp('setupForm'); bumpGen('setupForm');
  $('#setupFormTitle').textContent = asCopy ? 'Neues Setup (Vorlage)' : 'Setup bearbeiten';
  $('#sSave').textContent = asCopy ? 'Setup speichern' : 'Änderungen speichern';
  $('#sCancel').hidden = false;
  $('#setupDetails').open = true;
  drafts.mark('setup');
  setSection('setup', 'setupDetails');
  if (asCopy) $('#sTrack').focus();
}
function resetSetupForm(){
  const f = $('#setupForm'); f.reset(); f.dataset.bike = S.bike; f.dataset.epoch = S.epoch || ''; S.editSetup = null;
  parkOp('setupForm');
  $('#setupFormTitle').textContent = 'Setup speichern'; $('#sSave').textContent = 'Setup speichern'; $('#sCancel').hidden = true;
  drafts.mark('setup');
}

/* ---------- Anleitung speichern (ab 1.2.2: nur auf der Grundlage beim Öffnen) ----------
   Schreibt das Feld manual nur, wenn es im Speicher noch dem Stand entspricht, den dieses Formular zuletzt gezeigt hat
   (guard). Sonst bleibt alles, wie es ist: Eingabe und Meldung im Formular, der Stand aus dem anderen Fenster bleibt. */
async function saveManual(bid, manual, files, typed){ return saveManualRun(bid, manual, files, typed, S.epoch || ''); }
async function saveManualRun(bid, manual, files, typed, epoch, given){
  const base = given !== undefined ? given : S.manBase && S.manBase.bike === bid ? clone(S.manBase.manual) : clone(nu((store.peek('bikes', bid) || {}).manual));
  const res = await flow(() => store.commitR([{coll: 'bikes', id: bid, patch: {manual}, guard: {manual: base}}], files, 'manual', {epoch}));
  if (res === 'ok') {
    const old = base && base.kind === 'pdf' ? base.fileId : '';
    if (old && old !== manual.fileId) cleanupFiles([old]);
    S.editing.manual = false; S.manMsg = null; toast(manual.kind === 'pdf' ? 'Anleitung gespeichert.' : 'Link gespeichert.');
    if (S.bike === bid) { renderManual(true); drafts.mark('manual'); }
    return 'ok';
  }
  if (res === 'fail' && S.lastErr && S.lastErr.code === 'changed') {
    await store.reloadAll().catch(() => {});
    const raw = store.peek('bikes', bid), now = clone(nu(raw ? raw.manual : null));
    S.manBase = {bike: bid, manual: now}; S.editing.manual = true;
    S.manMsg = EDIT_MSG + ' Dort gilt jetzt: ' + (now ? '„' + (now.name || now.url || 'Anleitung') + '“' : 'keine Anleitung') + '. ' + (manual.kind === 'pdf' ? 'Wähl die PDF erneut, um sie zu ersetzen.' : 'Dein Link steht noch hier; tipp erneut auf „Link speichern“, um ihn zu übernehmen.');
    if (S.bike === bid) { renderManual(true); if (typed && $('#manUrl')) { $('#manUrl').value = typed; drafts.touch('manual'); } }
    toast(EDIT_MSG); return 'changed';
  }
  toast(res === 'fail' ? errText(S.lastErr) + ' Die Anleitung wurde nicht gespeichert.' : 'Unklar, ob die Anleitung gespeichert wurde. Lade die Seite später neu und prüf es.');
  return res;
}

/* ---------- Dateien ---------- */
async function uploadManual(file){
  const b = curBike(); if (!b || !file) return;
  const bid = b.id, epoch = S.epoch || '';
  /* Erwarteter Stand von manual schon bei der Dateiauswahl (ab 1.2.3): Was ein anderes Fenster während der Verarbeitung
     speichert, darf diese PDF nicht überschreiben. Die Prüfung im Speicher verwendet genau diesen Stand. */
  const base = S.manBase && S.manBase.bike === bid ? clone(S.manBase.manual) : clone(nu((store.peek('bikes', bid) || {}).manual));
  await flow(() => uploadManualRun(file, bid, epoch, base));
}
async function uploadManualRun(file, bid, epoch, base){
  let rec;
  try { rec = await makePdf(file); }
  catch (e) { toast(e && e.code === 'too_big' ? 'Die PDF ist größer als 40 MB. Füg stattdessen einen Link ein.' : (e && e.code === 'not_pdf' ? 'Das ist keine PDF-Datei.' : 'Die Datei konnte nicht gelesen werden.')); return; }
  if (!S.bikes[bid]) return;
  const r = await saveManualRun(bid, {kind: 'pdf', fileId: rec.id, name: rec.name, size: rec.size}, [rec], $('#manUrl') ? $('#manUrl').value : '', epoch, base);
  /* Die neue Datei nur behalten, wenn sie sicher gespeichert ist; bei unklarem Ausgang bleibt sie (Abgleich beim Neuladen) */
  if (r === 'fail' || r === 'changed') cleanupFiles([rec.id]);
}
/* Motorradfoto: wählen → Ausschnitt → verkleinern → mit dem Motorrad in einem Vorgang speichern */
async function pickBikePhoto(file, forAdd){
  /* Bestand beim Auswählen merken: wird er währenddessen ersetzt, landet das Foto nicht im neuen */
  const bid = forAdd ? null : S.bike, epoch = S.epoch || '';
  const res = await openCropper(file, {title: 'Ausschnitt für das Motorradfoto'});
  if (!res) return;
  await flow(() => storeBikePhoto(file, forAdd, bid, epoch, res));
}
async function storeBikePhoto(file, forAdd, bid, epoch, res){
  let made;
  try { made = await makeBikePhoto(res.dec, res.crop, file.name); }
  catch (e) { toast(errText(e) + ' Das Foto wurde nicht übernommen.'); return; }
  finally { res.dec.close(); }
  if (forAdd) {
    dropAddPhoto();
    S.addPhoto = {photo: made.photo, files: made.files, url: URL.createObjectURL(made.files[0].blob)};
    const box = $('#abPhotoBox'); if (box) box.innerHTML = addPhotoInner();
    return;
  }
  const b = S.bikes[bid]; if (!b) { toast('Das Motorrad gibt es nicht mehr. Das Foto wurde nicht gespeichert.'); return; }
  const old = payloadFiles({photo: b.photo});
  S.photoBusy = bid; S.keepFiles = made.files.map(f => f.id); renderGarage();
  const r = await store.sUpdateR('bikes', bid, {photo: made.photo}, made.files, {epoch});
  S.photoBusy = null; S.keepFiles = [];
  if (r === 'ok') { cleanupFiles(old); toast(old.length ? 'Foto ersetzt.' : 'Foto gespeichert.'); }
  else if (r === 'fail') toast(errText(S.lastErr) + ' Das Foto wurde nicht gespeichert.');
  else toast(UNCLEAR_MSG);
  R.renderAll();
}

/* ---------- Ereignisse ---------- */
export async function onClick(t){
  /* Anderen Artikel bearbeiten = neuer Vorgang: geänderte Eingaben erst klären (ab 1.3.1). Derselbe, schon offene Artikel:
     den Entwurf behalten und nur hinspringen. */
  if (t.dataset.partedit && $('#partForm').dataset.part === t.dataset.partedit && $('#partForm').closest('details').open) { $('#pName').focus(); $('#partForm').scrollIntoView({block: 'nearest'}); return true; }
  /* Ab 1.3.2: Den Zielartikel erst nach der Rückfrage über seine Kennung aus dem Speicher holen. Während die Rückfrage
     wartet, kann ein anderes Fenster ihn ändern oder entfernen; Formular, Mengenbasis und Grundlage stammen aus demselben
     Datensatz. Sofort und ohne Warten befüllen (sonst überschriebe das Befüllen eine schon begonnene Eingabe); hat dieses
     Fenster eine fremde Änderung noch nicht erfahren, lehnt die Prüfung im Speicher eine widersprechende Änderung ab. */
  if (t.dataset.partedit) {
    const id = t.dataset.partedit; if (!S.parts.some(x => x.id === id)) return true;
    drafts.begin(() => {
      const raw = store.peek('parts', id);
      if (!raw) { toast('Diesen Artikel gibt es inzwischen nicht mehr.'); return; }
      const p = Object.assign(clone(raw), {id});
      partEditMode(p, p.qty); $('#pName').value = p.name; $('#pQty').value = p.qty; $('#pMin').value = p.min; $('#pBike').value = p.bike;
      $('#partForm').closest('details').open = true; drafts.mark('part'); $('#pName').focus();
    });
    return true;
  }
  if (t.id === 'addCancel') { closeDraft('addBikeForm'); R.navigate({page: 'home'}, {replace: true}); return true; }
  if (t.id === 'abPhotoDrop') { dropAddPhoto(); $('#abPhotoBox').innerHTML = addPhotoInner(); return true; }
  if (t.id === 'pCancel') { if (!(S.ops.partForm && S.ops.partForm.saving)) { parkOp('partForm'); closeDraft('partForm'); } return true; }
  /* Bereich, Formular oder Motorrad wechseln: bei ungespeicherten Eingaben erst nachfragen (drafts.guard) */
  if (t.dataset.v) { if (t.dataset.v !== S.section) R.guard(() => setSection(t.dataset.v)); return true; }
  if (t.dataset.goto) {
    const goSec = () => { if (t.dataset.goto === 'defects' && t.dataset.open) R.openDefectForm(); setSection(t.dataset.goto, t.dataset.anchor); };
    if (t.dataset.open) drafts.begin(goSec, ['defect']); else if (t.dataset.goto !== S.section) R.guard(goSec); else goSec();
    return true;
  }
  if (t.dataset.jump) { const el = document.getElementById(t.dataset.jump); if (el) el.scrollIntoView({block: 'start', behavior: 'smooth'}); return true; }
  if (t.dataset.edit) { const k = t.dataset.edit; if (!S.editing[k]) drafts.begin(() => openEdit(k), ['edit-' + k]); return true; }
  if (t.dataset.cancel) { closeEdit(t.dataset.cancel); return true; }
  /* Logbuch-Formular: Tätigkeiten, Favoriten, Intervalle, Bearbeiten */
  if (t.dataset.wadd) { drafts.touch('log'); addLogWork(t.dataset.wadd, t.dataset.wname || ''); dropEditPrev(); return true; }
  if (t.dataset.wfree) { const q = str($('#lWorkSearch').value).slice(0, 120); if (q) { drafts.touch('log'); addLogWork('', q); $('#lWorkSearch').value = ''; renderWorkResults(); dropEditPrev(); } return true; }
  if (t.dataset.wrm != null) { const b = curBike(); drafts.touch('log'); S.logWork.splice(+t.dataset.wrm, 1); if (b) applyIvProposal(b); renderLogWork(); renderLogTasks(); dropEditPrev(); return true; }
  if (t.dataset.wfav) { toggleFav(t.dataset.wfav); return true; }
  if (t.dataset.wopenok) { S.logOpen = []; renderLogWork(); return true; }
  if (t.dataset.logedit) { const id = t.dataset.logedit; drafts.begin(() => openLogEdit(id)); return true; }
  if (t.id === 'lCancel') { if (!(S.ops.logForm && S.ops.logForm.saving)) { parkOp('logForm'); closeDraft('logForm'); } return true; }
  if (t.id === 'checkEdit') { drafts.begin(() => openCheckEdit(), ['check']); return true; }
  if (t.id === 'checkSave') { await saveCheckEdit(); return true; }
  if (t.id === 'checkCancel') { closeCheckEdit(); return true; }
  if (t.id === 'checkDefault') { if (S.checkDraft) { drafts.touch('check'); S.checkDraft.items = CHECK.map(c => ({id: c.id, name: c.name, on: true})); renderCheckEditor(); } return true; }
  if (t.id === 'checkAdd') { const i = $('#checkNew'), n = str(i.value).slice(0, 80); if (n && S.checkDraft && S.checkDraft.items.filter(c => c.on).length >= CHECK_MAX) { drafts.touch('check'); checkFull(n); return true; } if (n && S.checkDraft) { drafts.touch('check'); S.checkDraft.items.push({id: 'u' + uid(), name: n, on: true, own: true}); i.value = ''; renderCheckEditor(); $('#checkNew').focus(); } return true; }
  if (t.dataset.chkmv) { const [i, d] = t.dataset.chkmv.split(':').map(Number), l = S.checkDraft && S.checkDraft.items; if (l && l[i + d]) { drafts.touch('check'); const x = l[i]; l[i] = l[i + d]; l[i + d] = x; renderCheckEditor(); const btn = $('[data-chkmv="' + (i + d) + ':' + d + '"]') || $('[data-chkmv="' + (i + d) + ':' + (-d) + '"]'); if (btn) btn.focus(); } return true; }
  if (t.dataset.chkrm != null) { if (S.checkDraft) { drafts.touch('check'); S.checkDraft.items.splice(+t.dataset.chkrm, 1); renderCheckEditor(); } return true; }
  if (t.hasAttribute('data-rmrow')) { drafts.touch('edit-int'); t.closest('tr').remove(); return true; }
  if (t.id === 'oemAdd') { drafts.touch('edit-oem'); syncOemDraft(); S.oemDraft.rows.push({when: '', what: ''}); $('#oemBody').innerHTML = oemEditHTML(); return true; }
  if (t.dataset.oemrm != null) { drafts.touch('edit-oem'); syncOemDraft(); S.oemDraft.rows.splice(+t.dataset.oemrm, 1); $('#oemBody').innerHTML = oemEditHTML(); return true; }
  if (t.dataset.task) { const id = t.dataset.task; drafts.touch('log'); S.logTasks.has(id) ? S.logTasks.delete(id) : S.logTasks.add(id); S.logIvMan[id] = S.logTasks.has(id); S.logIvAuto.delete(id); t.setAttribute('aria-pressed', S.logTasks.has(id)); dropEditPrev(); return true; }
  if (t.id === 'plateBtn') {
    const b = curBike(); if (!b) return true;
    const f = $('#hoursForm');
    if (!f.hidden && f.dataset.bike === b.id) { $('#hoursInput').focus(); return true; }
    drafts.begin(() => {
      f.hidden = false; f.dataset.bike = b.id; f.dataset.epoch = S.epoch || ''; hoursReset();
      const cur = curOf(b); $('#hoursInput').value = cur != null ? v2(cur) : ''; drafts.mark('hours'); $('#hoursInput').focus();
    }, ['hours']);
    return true;
  }
  if (t.id === 'hoursCancel') { if (S.ops.hoursForm && S.ops.hoursForm.saving) return true; parkOp('hoursForm'); closeDraft('hoursForm'); return true; }
  if (t.id === 'hoursTypo') {
    /* Statt einer Korrektur die falsche Ablesung selbst berichtigen (Vorschau, nichts wird vorher gespeichert) */
    const f = $('#hoursForm'), b = S.bikes[f.dataset.bike];
    if (!b || b.id !== S.bike || (S.ops.hoursForm && S.ops.hoursForm.saving)) return true;
    const plan = typoPlan(b, Number(f.dataset.confirm));
    if (!openFix(plan, {onDone: () => { parkOp('hoursForm'); closeDraft('hoursForm'); }})) { t.hidden = true; toast('Dafür gibt es keine eindeutig falsche Ablesung. Speicher den Stand als Korrektur.'); }
    return true;
  }
  if (t.dataset.chk) { const b = S.bikes[t.dataset.chk]; if (!b || !openFix(checkPlan(b), {})) toast('Hier lässt sich nichts automatisch berichtigen. Prüf den Wartungspunkt und den Stand.'); return true; }
  if (t.dataset.segfix) { const b = S.bikes[t.dataset.segfix]; if (b) segFix(b); return true; }
  if (t.dataset.qtypo != null) {
    const p = S.pending; if (!p || p.saving) return true;
    const x = p.entries[+t.dataset.qtypo], b = x && S.bikes[x.bike]; if (!b) return true;
    if (!openFix(typoPlan(b, x.at), {onDone: () => { if (S.pending === p) { p.entries = p.entries.filter(e => e !== x); if (!p.entries.length) { S.pending = null; $('#quickText').value = ''; } } renderQuick(); }})) toast('Dafür gibt es keine eindeutig falsche Ablesung.');
    return true;
  }
  if (t.id === 'qCommit') { await commitPending(); return true; }
  /* Übernahme in das passende Formular gehört zum Schnell-Eintrag: dessen Fokus ist kein Formularwechsel */
  if (t.dataset.qedit != null) { const i = +t.dataset.qedit; drafts.begin(() => drafts.quietly(() => editPending(i)), ['quick']); return true; }
  if (t.dataset.qwrm) { const [i, j] = t.dataset.qwrm.split(':').map(Number), x = S.pending && !S.pending.saving && S.pending.entries[i]; if (x) { x.work.splice(j, 1); quickIv(x); renderQuick(); } return true; }
  if (t.id === 'qSwap') { if (S.pending && !S.pending.saving && !S.pending.tried && S.pending.entries.length === 2) { S.pending.entries.reverse(); S.pending.entries.forEach(x => { x.created = 0; }); renderQuick(); } return true; }
  if (t.dataset.qdrop != null) { if (S.pending && !S.pending.saving) { parkPendingEntries(S.pending.entries.splice(+t.dataset.qdrop, 1)); if (!S.pending.entries.length) S.pending = null; } renderQuick(); return true; }
  if (t.id === 'qDrop') { if (S.pending && S.pending.saving) return true; if (S.pending) parkPendingEntries(S.pending.entries); S.pending = null; renderQuick(); return true; }
  if (t.id === 'checkReset') { const b = curBike(); if (b) { lsSet('check-' + b.id, JSON.stringify({date: todayISO(), ids: []})); renderChecklist(b); } return true; }
  if (t.id === 'sCancel') { resetSetupForm(); return true; }
  if (t.id === 'dfCancel') { if (S.ops.doneForm && S.ops.doneForm.saving) return true; parkOp('doneForm'); closeDraft('doneForm'); renderStatus(); return true; }
  if (t.id === 'manReplace') { drafts.begin(() => { S.editing.manual = true; S.manMsg = null; renderManual(true); drafts.mark('manual'); }, ['manual']); return true; }
  if (t.id === 'manCancel') { S.editing.manual = false; S.manMsg = null; renderManual(true); drafts.mark('manual'); return true; }
  if (t.id === 'manRemove') {
    if (!arm(t)) return true;
    const b = curBike(); if (!b) return true;
    const base = clone(nu((store.peek('bikes', b.id) || {}).manual)), old = base && base.kind === 'pdf' ? base.fileId : '';
    const r = await flow(() => store.commitR([{coll: 'bikes', id: b.id, patch: {manual: null}, guard: {manual: base}}], null, 'manual', {epoch: S.epoch || ''}));
    if (r === 'ok') { if (old) cleanupFiles([old]); toast('Anleitung entfernt.'); renderManual(true); }
    else if (r === 'fail' && S.lastErr && S.lastErr.code === 'changed') { await store.reloadAll().catch(() => {}); renderManual(true); toast(EDIT_MSG); }
    else toast(r === 'fail' ? errText(S.lastErr) + ' Es wurde nichts entfernt.' : UNCLEAR_MSG);
    return true;
  }
  if (t.id === 'bikePhotoRemove') {
    if (!arm(t)) return true;
    const b = curBike(); if (!b || !b.photo) return true;
    const old = payloadFiles({photo: b.photo});
    if (await bikeUpdate(b.id, {photo: null})) { cleanupFiles(old); toast('Foto entfernt.'); }
    return true;
  }
  if (t.id === 'bikeRemove') { if (!arm(t)) return true; const b = curBike(); if (b) await removeBike(b); return true; }
  /* Setup erst nach der Rückfrage auflösen (ab 1.3.2, wie Lager und Mängel) */
  if (t.dataset.editsetup || t.dataset.copysetup) {
    const id = t.dataset.editsetup || t.dataset.copysetup, copy = !t.dataset.editsetup;
    if (S.setups.some(x => x.id === id)) drafts.begin(() => { const s = S.setups.find(x => x.id === id); if (s) fillSetupForm(s, copy); else toast('Dieses Setup gibt es inzwischen nicht mehr.'); });
    return true;
  }
  if (t.dataset.done) {
    const b = curBike(); if (!b) return true;
    if (!(await drafts.begin(() => {}))) return true;
    const item = t.dataset.done, so = S.ops.doneForm;
    /* Jeder neu geöffnete Wartungsentwurf ist eine neue Generation. Ein ungeklärter Vorgang zu einem
       anderen Punkt wird getrennt weiter abgeglichen; ein laufender endet für seinen eigenen Punkt. */
    if (so && !so.saving && so.item !== item) parkOp('doneForm');
    bumpGen('doneForm');
    if (S.ops.doneForm && !S.ops.doneForm.saving && S.ops.doneForm.item === item) S.ops.doneForm.gen = S.gen.doneForm;
    S.doneOpen = item; S.doneDraft = {date: todayISO(), atStr: '', costStr: ''};
    renderStatus();
    drafts.mark('done');
    const f = $('#dfDate'); if (f) f.focus();
    return true;
  }
  if (t.dataset.del) {
    if (!arm(t)) return true;
    const [coll, id] = t.dataset.del.split('/');
    const doc = S[coll] && Array.isArray(S[coll]) ? S[coll].find(x => x.id === id) : null;
    if (await sDel(coll, id)) { toast('Gelöscht.'); if (doc) cleanupFiles(payloadFiles(doc)); }
    return true;
  }
  if (t.dataset.qty) {
    /* Eine Änderung pro Teil zur Zeit. Gespeichert wird „eins mehr/weniger“ mit fester Vorgangskennung, auf den
       dann gespeicherten Bestand angewendet: Zwei Fenster gleichzeitig zählen beide. Schlägt sie sicher fehl,
       wird genau diese Änderung zurückgenommen; ist das Ergebnis offen, wird sie getrennt weiter abgeglichen. */
    const pid = t.dataset.qty;
    if (S.qtyBusy.has(pid)) return true;
    const p = S.parts.find(x => x.id === pid); if (!p) return true;
    const d = Number(t.dataset.d), prev = Math.round(p.qty || 0), q = Math.max(0, Math.min(99999, prev + d));
    if (q === prev) return true;
    const op = uid(), spec = {id: pid, add: d}, label = 'Teil ' + p.name + ' ' + (d > 0 ? '+' : '−') + Math.abs(d), ep = S.epoch || '';
    S.qtyBusy.add(pid); p.qty = q; renderInventory(); renderGarage(); renderBanner();
    let r = 'fail';
    try { r = await flow(() => store.sAdjustR(pid, op, spec, {epoch: ep})); } finally { S.qtyBusy.delete(pid); }
    if (r === 'fail') { const now = S.parts.find(x => x.id === pid); if (now && now.qty === q) now.qty = prev; toast(errText(S.lastErr) + ' Es wurde nichts gespeichert.'); }
    else if (r === 'unclear') {
      addUnres('parts', op, spec, label, false, ep, true);
      toast('Unklar, ob die Änderung gespeichert wurde. Racebook gleicht das selbst ab. Tipp erst wieder, wenn der Hinweis oben verschwunden ist, sonst zählt es doppelt.');
      /* Anzeige wieder auf den bekannten gespeicherten Stand; eine späte Bestätigung wird übernommen */
      store.emit('parts'); reconcile();
    }
    renderInventory(); renderGarage(); renderBanner();
    return true;
  }
  return false;
}

export function onInput(t){
  if (t.id === 'abModel') {
    const tp = MODEL_TPL[$('#abBrand').value + '|' + t.value.trim().toLowerCase()];
    if (tp && TEMPLATES[tp]) { $('#abTpl').value = tp; $('#abUnit').value = TEMPLATES[tp].unit; }
    return true;
  }
  if (t.id === 'hoursInput') { hoursReset(); return true; }
  if (S.doneDraft && t.closest && t.closest('#doneForm')) {
    if (t.id === 'dfAt') { S.doneDraft.atStr = t.value; if (S.ops.doneForm) delete S.ops.doneForm.confirmLow; }
    if (t.id === 'dfCost') S.doneDraft.costStr = t.value;
  }
  if ((t.id === 'lAt' || t.id === 'lDate') && S.ops.logForm) delete S.ops.logForm.confirmLow;
  if (t.dataset && t.dataset.wdetail != null) { const w = (S.logWork || [])[+t.dataset.wdetail]; if (w) w.detail = t.value.slice(0, 300); }
  if (t.id === 'lWorkSearch') { renderWorkResults(); return true; }
  if (S.logEditPrev && t.closest && t.closest('#logForm')) dropEditPrev();
  return false;
}

export function onChange(t){
  if (t.dataset && t.dataset.check != null) {
    const b = curBike(); if (!b) return true;
    const s = checkState(b), id = t.dataset.check;
    s.ids = t.checked ? Array.from(new Set(s.ids.concat(id))) : s.ids.filter(x => x !== id);
    lsSet('check-' + b.id, JSON.stringify({date: s.date, ids: s.ids})); renderChecklist(b);
    return true;
  }
  if (t.id === 'dfDate' && S.doneDraft) {
    S.doneDraft.date = t.value;
    if (S.ops.doneForm) delete S.ops.doneForm.confirmLow;
    renderStatus();
    return true;
  }
  if (t.id === 'lDate') { updateLogAtHint(); dropEditPrev(); return true; }
  if (t.id === 'lKind') { renderLogWork(); return true; }
  if ((t.id === 'lPhoto' || t.id === 'lPhotoDrop') && S.logEditPrev) { dropEditPrev(); return true; }
  if (t.dataset && t.dataset.qiv) { const [i, id] = [+t.dataset.qiv.split(':')[0], t.dataset.qiv.split(':').slice(1).join(':')], x = S.pending && !S.pending.saving && S.pending.entries[i]; if (x) { x.ivMan = x.ivMan || {}; x.ivMan[id] = t.checked; x.tasks = t.checked ? Array.from(new Set(x.tasks.concat([id]))) : x.tasks.filter(y => y !== id); } return true; }
  if (t.dataset && t.dataset.qopen) { const [i, k] = t.dataset.qopen.split(':').map(Number), x = S.pending && !S.pending.saving && S.pending.entries[i]; if (x && x.open[k]) { x.open[k].pick = t.value; quickIv(x); renderQuick(); } return true; }
  if (t.dataset && t.dataset.chkon != null) { const it = S.checkDraft && S.checkDraft.items[+t.dataset.chkon]; if (it) it.on = t.checked; return true; }
  if (t.id === 'mDate') { meterPlaceholder(curBike()); return true; }
  if (t.id === 'rDate') { updateRideIn(); return true; }
  if (t.id === 'abBrand') {
    const br = BRANDS.find(x => x.n === t.value); if (br) $('#abColor').value = br.c;
    $('#abBrandOtherWrap').hidden = t.value !== 'Andere';
    $('#abModels').innerHTML = modelOptions(t.value);
    return true;
  }
  if (t.id === 'abTpl') { const tp = TEMPLATES[t.value]; if (tp && tp.unit) $('#abUnit').value = tp.unit; return true; }
  if (t.id === 'ebBrand') {
    const br = BRANDS.find(x => x.n === t.value); if (br && t.value !== 'Andere') $('#ebColor').value = br.c;
    $('#ebOtherWrap').hidden = t.value !== 'Andere';
    $('#ebModels').innerHTML = modelOptions(t.value);
    return true;
  }
  if (t.id === 'manFile' && t.files && t.files[0]) { const f = t.files[0]; t.value = ''; uploadManual(f); return true; }
  if ((t.id === 'bikePhotoFile' || t.id === 'abPhoto') && t.files && t.files[0]) { const f = t.files[0]; t.value = ''; pickBikePhoto(f, t.id === 'abPhoto'); return true; }
  return false;
}

export async function onSubmit(f, busy){
  if (f.id === 'quickForm') return false;
  if (f.id === 'addBikeForm') { busy(true); await addBike(); return true; }
  if (f.id === 'manLinkForm') {
    /* Für das Motorrad, zu dem das Formular gehört (nicht ein inzwischen gewähltes anderes) */
    const b = S.bikes[f.dataset.bike] || null; if (!b) { toast('Dieses Motorrad gibt es nicht mehr. Der Link wurde nicht gespeichert.'); return true; }
    const bid = b.id, url = safeUrl($('#manUrl').value);
    if (!url) throw new VErr($('#manUrl'), 'Der Link muss mit https:// beginnen.');
    busy(true);
    let name = url; try { name = new URL(url).hostname.replace(/^www\./, ''); } catch (err) {}
    await saveManual(bid, {kind: 'link', url, name}, null, $('#manUrl').value);
    return true;
  }
  if (f.id === 'partForm') {
    const name = str($('#pName').value).slice(0, 120);
    if (!name) throw new VErr($('#pName'), 'Gib dem Teil einen Namen.');
    const qty = fieldNum('pQty', 'Anzahl', {int: true, min: 0, max: 99999}) || 0;
    const min = fieldNum('pMin', 'Nachkaufen ab', {int: true, min: 0, max: 99999}) || 0;
    const pb = $('#pBike').value;
    if (pb !== 'both' && !S.bikes[pb]) throw new VErr($('#pBike'), 'Dieses Motorrad gibt es nicht mehr. Bitte die Zuordnung wählen.');
    const forBike = pb;
    if (f.dataset.part) {
      /* Vorhandenen Posten ändern: dieselbe ID, Anzahl als Änderung gegenüber dem Bestand beim Öffnen */
      const pid = f.dataset.part, base = Number(f.dataset.base) || 0;
      const ex = S.parts.find(x => x.id === pid);
      if (!ex) { closeDraft('partForm'); toast('Dieses Teil gibt es inzwischen nicht mehr. Leg es bei Bedarf neu an.'); return true; }
      /* Nur was gegenüber dem Stand beim Öffnen geändert wurde, und nur auf dieser Grundlage (Prüfung im Speicher).
         Fremde Änderungen an anderen Angaben bleiben; die Anzahl zählt als Änderung (Einkäufe anderswo zählen mit). */
      const pb0 = S.partBase && S.partBase.id === pid ? S.partBase : {id: pid, name: ex.name, bike: ex.bike, min: ex.min};
      const o = opFor('partForm', '', 'parts', pid, [pid, base, name, forBike, qty, min, canon(pb0)].join('|')); if (o.saving) return true;
      const g = S.gen.partForm || 0;
      if (!o.payload) {
        const set = {}, guard = {};
        if (name !== pb0.name) { set.name = name; guard.name = pb0.name; }
        if (forBike !== pb0.bike) { set.bike = forBike; guard.bike = pb0.bike; }
        if (min !== pb0.min) { set.min = min; guard.min = pb0.min; }
        o.payload = {id: pid, add: qty - base, set, guard}; o.adj = true; o.label = 'Teil ' + name; o.quietFail = true;
      }
      busy(true);
      const r = await execOp('partForm', o, () => store.sAdjustR(pid, o.op, o.payload, {epoch: o.epoch}));
      if (r === 'fail' && S.lastErr && S.lastErr.code === 'changed') { await partConflict(pid, o.payload, base, qty, pb0); return true; }
      if (r === 'fail') toast(errText(S.lastErr) + ' Es wurde nichts gespeichert.');
      if (r === 'ok') {
        const now = store.peek('parts', pid);
        if ((S.gen.partForm || 0) === g) closeDraft('partForm');
        toast(now && now.qty !== qty ? 'Gespeichert. „' + name + '“: jetzt ' + fmt(now.qty, 0) + ' im Vorrat, weil der Bestand inzwischen auch in einem anderen Fenster geändert wurde.' : 'Teil gespeichert.');
      }
      return true;
    }
    const o = opFor('partForm', '', 'parts', null, [name, forBike, qty, min].join('|')); if (o.saving) return true;
    const g = S.gen.partForm || 0;
    if (!o.payload) { o.payload = canonDoc('parts', {name, bike: forBike, qty, min, created: o.created}); o.label = 'Teil ' + name; }
    busy(true);
    const r = await execOp('partForm', o, () => store.sSetR('parts', o.op, o.payload, null, {epoch: o.epoch}));
    if (r === 'ok') { if ((S.gen.partForm || 0) === g) closeDraft('partForm'); toast('Teil hinzugefügt.'); }
    return true;
  }
  const own = ['hoursForm', 'doneForm', 'logForm', 'rideForm', 'setupForm', 'bikeForm', 'tcForm', 'oilForm', 'intForm', 'oemForm', 'meterForm'];
  if (!own.includes(f.id)) return false;
  const b = formBike(f); if (!b) return true;
  const lim = LIM[U(b)];

  if (f.id === 'hoursForm') {
    const v = fieldNum('hoursInput', 'Stand', {req: true, min: 0, max: lim.cnt});
    const cur = curOf(b), corr = cur != null && v < cur;
    if (corr && f.dataset.confirm !== String(v)) {
      f.dataset.confirm = String(v);
      /* War der bisherige Stand ein Tippfehler, lässt er sich direkt berichtigen (statt eine Korrektur anzulegen) */
      const plan = typoPlan(b, v), h = $('#hoursHint'); h.hidden = false;
      h.textContent = 'Das ist weniger als der aktuelle Stand (' + fmt(cur, 2) + ' ' + U(b) + ').' + (plan
        ? ' Hast du dich vorher vertippt (' + fmt(plan.subject.old, 2) + ' ' + U(b) + ' am ' + fmtDate(plan.subject.date) + ')? Dann tipp auf „Tippfehler berichtigen“. Sonst zum Bestätigen auf „Korrektur speichern“ tippen.'
        : ' Das ist nur zum Korrigieren eines Tippfehlers gedacht. Zum Bestätigen auf „Korrektur speichern“ tippen.');
      $('#hoursTypo').hidden = !plan;
      $('#hoursSave').textContent = 'Korrektur speichern';
      return true;
    }
    /* Eine bestätigte Ablesung wird immer gespeichert, auch wenn sie dem berechneten Stand entspricht.
       Identität nur aus der Eingabe; ob es eine Korrektur ist, gehört zum ersten Versuch (eingefrorene Nutzdaten) */
    const o = opFor('hoursForm', b.id, 'log', null, String(v)); if (o.saving) return true;
    if (!o.payload && !(await jumpOk(o, b, todayISO(), v, 'hoursInput', cur))) return true;
    const g = S.gen.hoursForm || 0;
    if (!o.payload) { o.payload = canonDoc('log', {bike: b.id, kind: 'reading', date: todayISO(), at: v, atAuto: false, correction: corr, tasks: [], taskNames: [], extra: '', cost: null, note: '', created: o.created}); o.label = 'Ablesung ' + fmt(v, 2) + ' ' + U(b); }
    busy(true);
    const r = await execOp('hoursForm', o, () => store.sSetR('log', o.op, o.payload, null, {epoch: o.epoch}));
    if (r === 'ok') { if ((S.gen.hoursForm || 0) === g) closeDraft('hoursForm'); toast(o.payload.correction ? 'Stand korrigiert.' : 'Stand gespeichert.'); }
    return true;
  }
  if (f.id === 'doneForm') {
    const item = f.dataset.item, it = (b.items || []).find(i => i.id === item);
    if (!it) { S.doneOpen = null; renderStatus(); return true; }
    const date = fieldDate('dfDate', 'Datum', {req: true});
    const at = fieldNum('dfAt', 'Stand', {min: 0, max: lim.cnt});
    const cost = fieldNum('dfCost', 'Kosten', {min: 0, max: MAX_COST});
    const o = opFor('doneForm', b.id, 'log', item, [date, at, cost].join('|')); if (o.saving) return true;
    if (!o.payload && !lowCheck(o, b, date, at)) return true;
    if (!o.payload && !(await jumpOk(o, b, date, at, 'dfAt'))) return true;
    const g = S.gen.doneForm || 0;
    if (!o.payload) { o.payload = serviceDoc(b, {date, at, tasks: [item], cost, created: o.created}); o.label = 'Wartung ' + it.name; }
    const r = await execOp('doneForm', o, () => store.sSetR('log', o.op, o.payload, null, {epoch: o.epoch}));
    if (r === 'ok') { if ((S.gen.doneForm || 0) === g) closeDraft('doneForm'); toast('Eingetragen.'); }
    renderStatus();
    return true;
  }
  if (f.id === 'logForm') {
    if (S.logEdit) { await saveLogEdit(b, busy); return true; }
    const kind = $('#lKind').value === 'note' ? 'note' : 'service';
    const tasks = kind === 'service' ? Array.from(S.logTasks).filter(id => (b.items || []).some(i => i.id === id)) : [];
    const works = kind === 'service' ? (S.logWork || []).map(w => workEntry(w.id, w.name, w.detail, w.cat)) : [];
    const date = fieldDate('lDate', 'Datum', {req: true});
    const at = fieldNum('lAt', 'Stand', {min: 0, max: lim.cnt});
    const cost = fieldNum('lCost', 'Kosten', {min: 0, max: MAX_COST});
    const extra = str($('#lExtra').value).slice(0, 500), note = str($('#lNote').value).slice(0, 4000);
    if (kind === 'note' && tasks.length) throw new VErr($('#lKind'), 'Eine Notiz hat keine erledigten Wartungspunkte. Stell die Art auf „Wartung“ oder wähl die Punkte ab.');
    const file = $('#lPhoto').files && $('#lPhoto').files[0];
    if (!tasks.length && !works.length && !extra && !note && cost == null && !file) { toast('Wähl eine Arbeit aus oder schreib etwas dazu.'); return true; }
    if (kind === 'service' && (S.logOpen || []).length) { toast('Noch offen: ' + S.logOpen.map(x => '„' + x + '“').join(', ') + '. Wähl die tatsächlich erledigte Tätigkeit aus und tipp im Hinweis auf „Ist ausgewählt“.'); return true; }
    /* Vorgang, Erfassungszeit und Inhalt vor dem ersten await festlegen */
    const orig = kind === 'service' ? (S.logOrig || '') : '';
    const sig = [kind, date, at, cost, extra, note, tasks.join(','), canon(works), orig, file ? file.name + ':' + file.size + ':' + file.lastModified : ''].join('|');
    const o = opFor('logForm', b.id, 'log', null, sig); if (o.saving) return true;
    if (!o.payload && kind === 'service' && !lowCheck(o, b, date, at)) return true;
    if (!o.payload && !(await jumpOk(o, b, date, at, 'lAt'))) return true;
    const g = S.gen.logForm || 0;
    const base = {date, at, tasks, extra, cost, note, created: o.created, work: works, orig};
    busy(true);
    const r = await execOp('logForm', o, async () => {
      if (!o.payload) {
        /* Erster Versuch: Foto verkleinern und Nutzdaten einfrieren. Eine Wiederholung nutzt dasselbe Foto. */
        let photo = null;
        if (file) {
          try { const m = await makePhoto(file); photo = m.photo; o.files = m.files; }
          catch (e) { S.lastErr = e; o.quietFail = true; toast('Das Foto konnte nicht gelesen werden. Der Eintrag wurde nicht gespeichert.'); return 'fail'; }
        }
        const cur = S.bikes[b.id]; if (!cur) return 'fail';
        o.payload = kind === 'note' ? noteDoc(cur, Object.assign({photo}, base)) : serviceDoc(cur, Object.assign({photo}, base));
        o.label = kind === 'note' ? 'Notiz' : 'Wartung ' + ((o.payload.work || []).map(w => w.name).concat(o.payload.taskNames).join(', ') || o.payload.extra || '');
      }
      return store.sSetR('log', o.op, o.payload, o.files, {epoch: o.epoch});
    });
    if (r === 'ok') { if ((S.gen.logForm || 0) === g) { closeDraft('logForm'); renderLogTasks(); updateLogAtHint(); } toast('Eingetragen.'); }
    return true;
  }
  if (f.id === 'rideForm') {
    const feel = $('input[name="feel"]:checked');
    const rd = {date: fieldDate('rDate', 'Datum', {req: true}), amount: fieldNum('rAmount', U(b) === 'km' ? 'Strecke' : 'Fahrzeit', {req: true, gt: 0, max: lim.ride}),
      track: str($('#rTrack').value).slice(0, 120), ground: $('#rGround').value, weather: $('#rWeather').value, setupId: $('#rSetup').value,
      feel: feel ? Number(feel.value) : null, inReading: !$('#rInWrap').hidden && $('#rIn').checked, note: str($('#rNote').value).slice(0, 4000)};
    const o = opFor('rideForm', b.id, 'rides', null, canon(rd)); if (o.saving) return true;
    const g = S.gen.rideForm || 0;
    if (!o.payload) { o.payload = rideDoc(b, Object.assign({created: o.created}, rd)); o.label = 'Fahrt ' + fmt(rd.amount, 2) + ' ' + U(b); }
    busy(true);
    const r = await execOp('rideForm', o, () => store.sSetR('rides', o.op, o.payload, null, {epoch: o.epoch}));
    if (r === 'ok') { if ((S.gen.rideForm || 0) === g) { closeDraft('rideForm'); updateRideIn(); } toast('Fahrt gespeichert.'); }
    return true;
  }
  if (f.id === 'setupForm') {
    const data = {bike: b.id, track: str($('#sTrack').value).slice(0, 120), note: str($('#sNote').value).slice(0, 2000), updated: todayISO()};
    if (!data.track) throw new VErr($('#sTrack'), 'Gib der Strecke einen Namen.');
    SF.forEach(([el, k, l, r]) => { data[k] = fieldNum(el, l, r); });
    const g = S.gen.setupForm || 0;
    busy(true);
    let ok;
    if (S.editSetup) ok = await sSet('setups', S.editSetup, canonDoc('setups', data));
    else {
      const o = opFor('setupForm', b.id, 'setups', null, canon(Object.assign({}, data, {updated: null}))); if (o.saving) return true;
      if (!o.payload) { o.payload = canonDoc('setups', data); o.label = 'Setup ' + data.track; }
      ok = (await execOp('setupForm', o, () => store.sSetR('setups', o.op, o.payload, null, {epoch: o.epoch}))) === 'ok';
    }
    if (ok) { if ((S.gen.setupForm || 0) === g) closeDraft('setupForm'); toast('Setup gespeichert.'); }
    return true;
  }
  if (f.id === 'bikeForm') { busy(true); if (await saveBikeEdit(b)) closeEdit('bike'); return true; }
  if (f.id === 'tcForm') { busy(true); if (await saveTC(b)) closeEdit('tc'); return true; }
  if (f.id === 'oilForm') { busy(true); if (await saveOil(b)) closeEdit('oil'); return true; }
  if (f.id === 'intForm') { busy(true); if (await saveInt(b)) closeEdit('int'); return true; }
  if (f.id === 'meterForm') { await saveMeter(b, busy); return true; }
  if (f.id === 'oemForm') { busy(true); if (S.oemDraft && S.oemDraft.bike !== b.id) { closeEdit('oem'); return true; } if (await saveOem(b)) closeEdit('oem'); return true; }
  return false;
}

/* Statische Formularteile einmal füllen */
export function initBikeForms(){
  $('#rGround').innerHTML = '<option value="">–</option>' + GROUNDS.map(g => '<option>' + g + '</option>').join('');
  $('#rWeather').innerHTML = '<option value="">–</option>' + WEATHER.map(g => '<option>' + g + '</option>').join('');
  $('#rFeel').innerHTML = [1, 2, 3, 4, 5].map(i => '<label><input type="radio" name="feel" value="' + i + '"><span>' + i + '</span><span class="sr"> von 5</span></label>').join('');
  $('#lDate').max = todayISO(); $('#rDate').max = todayISO(); $('#mDate').max = todayISO(); $('#mDate').value = todayISO();
  /* Suche im Tätigkeitskatalog: Eingabetaste wählt den ersten Treffer (statt das Formular abzuschicken) */
  $('#lWorkSearch').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const first = $('#lWorkRes [data-wadd]') || $('#lWorkRes [data-wfree]'); if (first) first.click(); } });
  registerDrafts();
}
/* Entwürfe dieser Ansicht (drafts.js): wie erkennen, speichern, verwerfen, wieder anzeigen */
function registerDrafts(){
  const submitOf = id => async () => { const f = $('#' + id); return f ? R.submitForm(f) : true; };
  const show = (sec, anchor, det) => () => { if (det) { const d = $('#' + det); if (d) d.open = true; } setSection(sec, anchor); };
  drafts.register({key: 'quick', label: 'Schnell-Eintrag', root: () => $('#quickForm'),
    extra: () => S.pending ? S.pending.entries.map(x => [x.kind, x.at, x.amount, x.tasks, x.work, (x.open || []).map(q => q.pick || '')]) : null,
    save: async () => { if (!S.pending) { if (str($('#quickText').value)) onQuick({preventDefault(){}}); return false; } await commitPending(); return !S.pending; },
    discard: () => { if (S.pending && S.pending.saving) return; if (S.pending) parkPendingEntries(S.pending.entries, S.pending.epoch); S.pending = null; $('#quickText').value = ''; renderQuick(); },
    reveal: show('status', 'quickForm')});
  drafts.register({key: 'hours', label: 'Stand eintragen', root: () => $('#hoursForm'), open: () => !$('#hoursForm').hidden, isOpen: () => !$('#hoursForm').hidden, save: submitOf('hoursForm'),
    discard: () => { parkOp('hoursForm'); closeDraft('hoursForm'); }, reveal: show('status')});
  drafts.register({key: 'done', label: 'Wartung abhaken', root: () => $('#doneForm'), isOpen: () => !!S.doneOpen, save: submitOf('doneForm'),
    discard: () => { parkOp('doneForm'); closeDraft('doneForm'); renderStatus(); }, reveal: show('status', 'c-items')});
  drafts.register({key: 'log', label: 'Logbuch-Eintrag', root: () => $('#logForm'), extra: () => [S.logWork, Array.from(S.logTasks || []).sort(), S.logEdit ? S.logEdit.id : '', S.logOrig],
    isOpen: () => $('#logDetails').open, save: submitOf('logForm'), discard: () => { parkOp('logForm'); closeDraft('logForm'); }, reveal: show('log', 'logDetails', 'logDetails')});
  drafts.register({key: 'ride', label: 'Fahrt', root: () => $('#rideForm'), isOpen: () => $('#rideDetails').open, save: submitOf('rideForm'), discard: () => { parkOp('rideForm'); closeDraft('rideForm'); }, reveal: show('rides', 'rideDetails', 'rideDetails')});
  drafts.register({key: 'setup', label: 'Fahrwerk-Setup', root: () => $('#setupForm'), extra: () => S.editSetup || '', isOpen: () => $('#setupDetails').open, save: submitOf('setupForm'), discard: () => { parkOp('setupForm'); closeDraft('setupForm'); }, reveal: show('setup', 'setupDetails', 'setupDetails')});
  const partDet = () => { const f = $('#partForm'); return f ? f.closest('details') : null; };
  drafts.register({key: 'part', label: 'Teil', root: () => $('#partForm'), extra: () => $('#partForm').dataset.part || '', save: submitOf('partForm'), discard: () => { parkOp('partForm'); closeDraft('partForm'); },
    isOpen: () => !!$('#partForm').dataset.part || !!(partDet() && partDet().open), close: () => { parkOp('partForm'); closeDraft('partForm'); const d = partDet(); if (d) d.open = false; }, reveal: show('inventory', 'g-parts')});
  drafts.register({key: 'meter', label: 'Zählerwechsel', root: () => $('#meterForm'), save: submitOf('meterForm'), discard: () => { parkOp('meterForm'); closeDraft('meterForm'); },
    isOpen: () => !!($('#g-meter') && $('#g-meter').open), close: () => { parkOp('meterForm'); closeDraft('meterForm'); $('#g-meter').open = false; }, reveal: show('vehicle', 'g-meter', 'g-meter')});
  [['bike', 'Motorrad bearbeiten', 'bikeForm', 'g-bike'], ['tc', 'Reifen & Kette', 'tcForm', 'g-tc'], ['oil', 'Öle & Flüssigkeiten', 'oilForm', 'g-oil'], ['int', 'Wartungsintervalle', 'intForm', 'g-int'], ['oem', 'Herstellervorgaben', 'oemForm', 'oemBody']].forEach(([k, label, id, anchor]) => {
    drafts.register({key: 'edit-' + k, label, root: () => S.editing[k] ? $('#' + id) : null, extra: () => k === 'oem' && S.oemDraft ? S.oemDraft.rows.length : null, isOpen: () => !!S.editing[k],
      save: async () => { const f = $('#' + id); if (!f) return true; await R.submitForm(f); return !S.editing[k]; }, discard: () => closeEdit(k), reveal: show(({oem:'manual',bike:'vehicle',tc:'components',oil:'specs',int:'maintenance'})[k], anchor)});
  });
  drafts.register({key: 'add', label: 'Motorrad hinzufügen', root: () => $('#addBikeForm'), extra: () => S.addPhoto ? S.addPhoto.photo.id : '', save: submitOf('addBikeForm'), discard: () => closeDraft('addBikeForm')});
  drafts.register({key: 'check', label: 'Checkliste anpassen', root: () => $('#checkForm'), extra: () => S.checkDraft ? S.checkDraft.items : null, isOpen: () => !!S.checkDraft, save: () => saveCheckEdit(), discard: () => closeCheckEdit(), reveal: show('status', 'c-check')});
  /* ab 1.2.1: Link zur Anleitung (gehört zu dem Motorrad, für das das Formular gezeichnet wurde) */
  drafts.register({key: 'manual', label: 'Link zur Anleitung', root: () => $('#manLinkForm'), isOpen: () => !!S.editing.manual, save: submitOf('manLinkForm'),
    discard: () => { const i = $('#manUrl'); if (i) i.value = ''; S.editing.manual = false; S.manMsg = null; renderManual(true); }, reveal: show('manual', 'manBody')});
  drafts.mark('quick');
}
