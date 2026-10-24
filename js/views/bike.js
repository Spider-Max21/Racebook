/* Racebook – Motorrad-Ansicht: Status, Logbuch, Fahrten, Fahrwerk, Garage, Handbuch, Schnell-Eintrag.
   Aus Version 8 übernommen (geprüfte Abläufe für Vorgänge, Formulargenerationen und Korrekturen);
   neu sind Motorradfoto, Spitzname, lokale Fotos und PDFs sowie atomare Mehrfachänderungen. */
import {esc, str, fmt, eur, uid, v2, validId, safeUrl, turns, isISO, todayISO, fmtDate, canon, pad} from '../util.js';
import {S, lsSet, lsJSON, bikeList, curBike, U, bikeName} from '../state.js';
import {CHECK, GROUNDS, WEATHER, FLUIDS, MONTHS, LIM, MAX_COST, BRANDS, KW, INAMES, TEMPLATES, MODELS, MODEL_TPL, SF,
  brandOf, colorOf, plateOf, shortName, curOf, itemState, pillText, sortedItems, svcAtOf, valueAt, hasSetOn,
  serviceDoc, rideDoc, noteDoc, snapOf, sigOf, localParse, openDefects, DEFECT_PRIOS, canonDoc} from '../domain.js';
import * as store from '../store.js';
import {opFor, parkOp, execOp, bumpGen, lowCheck, addUnres, BIKE_FORMS, cleanupFiles, payloadFiles, flow} from '../ops.js';
import {$, $$, toast, errText, arm, VErr, fieldNum, fieldDate, imgTag, hydrate, fileUrl, icon, fmtSize} from '../ui.js';
import {makePhoto, makeBikePhoto, makePdf} from '../images.js';
import {openCropper} from '../cropper.js';
import {R} from '../registry.js';

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
  renderQuick();
}
/* Gestartete, ungeklärte Schnell-Einträge weiter abgleichen; nie gesendete oder sicher nicht gespeicherte entfallen */
export function parkPendingEntries(list, epoch){
  (list || []).forEach(x => { if (x.state === 'unclear' && x.payload) addUnres(x.kind === 'ride' ? 'rides' : 'log', x.op, x.payload, x.kind === 'ride' ? 'Fahrt' : (x.kind === 'note' ? 'Notiz' : 'Wartung'), false, epoch); });
}
export function renderQuick(){
  const out = $('#quickOut'), p = S.pending;
  if (!out) return;
  if (!p || !p.entries.length) { out.innerHTML = ''; return; }
  const kinds = {service: 'Wartung', ride: 'Fahrt', note: 'Notiz'};
  const multi = p.entries.length > 1;
  const blocks = p.entries.map((x, i) => {
    const b = S.bikes[x.bike]; if (!b) return '';
    const u = U(b), items = b.items || [];
    const rows = [['Motorrad', bikeName(b)], ['Art', (multi ? (i + 1) + '. ' : '') + kinds[x.kind]], ['Datum', fmtDate(x.date)]];
    if (x.kind === 'ride') {
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
      rows.push(['Erledigt', x.tasks.length ? '<span class="chips">' + x.tasks.map(id => '<span class="chip static">' + esc((items.find(it => it.id === id) || {}).name || id) + '</span>').join('') + '</span>' : '–', true]);
      if (x.extra) rows.push(['Weiteres', x.extra]);
    } else if (x.at != null) rows.push(['Stand', fmt(x.at, 2) + ' ' + u]);
    if (x.cost != null) rows.push(['Kosten', eur(x.cost)]);
    if (x.note && x.note !== p.text) rows.push(['Notiz', x.note]);
    return '<div class="pend"><dl class="kv">' + rows.map(r => '<dt>' + r[0] + '</dt><dd>' + (r[2] ? r[1] : esc(r[1])) + '</dd>').join('') + '</dl>'
      + '<div class="row"><button class="mini" type="button" data-qedit="' + i + '"' + (p.saving ? ' disabled' : '') + '>Bearbeiten</button>' + (multi ? '<button class="mini" type="button" data-qdrop="' + i + '"' + (p.saving ? ' disabled' : '') + '>Entfernen</button>' : '') + '</div></div>';
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
  /* Erfassungszeit in der angezeigten Reihenfolge festlegen, einmal und vor dem ersten Speichern */
  const base = Date.now();
  p.entries.forEach((x, i) => { if (!x.created) x.created = base + i; });
  p.saving = true; p.tried = true; renderQuick();
  let ok = 0;
  try {
    /* Ein Ablauf für alle Einträge: das Einspielen einer Sicherung wartet, bis er fertig ist */
    await flow(async () => {
      for (const x of p.entries.slice()) {
        const b = S.bikes[x.bike]; if (!b) continue;
        /* Nutzdaten einmal einfrieren; eine Wiederholung sendet dieselben Daten unter derselben ID */
        if (!x.payload) x.payload = x.kind === 'service' ? serviceDoc(b, x) : (x.kind === 'ride' ? rideDoc(b, x) : noteDoc(b, x));
        /* Gehört zum Bestand der Vorschau; wurde er inzwischen ersetzt, weist der Speicher den Eintrag ab */
        const r = await store.sSetR(x.kind === 'ride' ? 'rides' : 'log', x.op, x.payload, null, {epoch: p.epoch});
        x.state = r;
        if (r === 'ok') { ok++; p.entries = p.entries.filter(e => e !== x); } else break;
      }
    });
  } finally { p.saving = false; }
  if (S.pending !== p) {
    /* Die Vorschau wurde inzwischen geschlossen, weil der Bestand ersetzt wurde */
    if (p.entries.length) toast(errText(S.lastErr) + ' ' + (ok ? ok + ' Eintrag gespeichert, der Rest nicht.' : 'Der Schnell-Eintrag wurde nicht gespeichert.'));
    return;
  }
  if (!p.entries.length) { S.pending = null; $('#quickText').value = ''; toast(ok > 1 ? ok + ' Einträge gespeichert.' : 'Eingetragen.'); }
  else {
    const unclear = p.entries.some(e => e.state === 'unclear');
    p.warn = (ok ? ok + ' gespeichert. ' : '') + (unclear ? 'Bei einem Eintrag ist unklar, ob er gespeichert wurde. ' : 'Der Rest wurde nicht gespeichert. ') + 'Tipp nochmal auf „Eintragen“, es entsteht dabei kein doppelter Eintrag.';
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
  if (x.kind === 'ride') {
    $('#rDate').value = x.date; $('#rAmount').value = v2(x.amount);
    $('#rTrack').value = x.track || ''; $('#rNote').value = x.note || '';
    updateRideIn();
    $('#rideDetails').open = true; setSection('rides', 'rideDetails');
  } else {
    $('#lKind').value = x.kind === 'note' ? 'note' : 'service';
    $('#lDate').value = x.date; $('#lAt').value = v2(x.at);
    S.logTasks = new Set(x.tasks); renderLogTasks();
    $('#lExtra').value = x.extra || ''; $('#lCost').value = v2(x.cost);
    $('#lNote').value = x.note || '';
    updateLogAtHint();
    $('#logDetails').open = true; setSection('log', 'logDetails');
  }
  p.entries.splice(i, 1);
  if (!p.entries.length) { S.pending = null; $('#quickText').value = ''; }
  renderQuick();
}
export function reconcilePending(){
  const p = S.pending;
  if (p && !p.saving) {
    const before = p.entries.length;
    p.entries = p.entries.filter(x => !(S.loaded[x.kind === 'ride' ? 'rides' : 'log'] && S[x.kind === 'ride' ? 'rides' : 'log'].some(d => d.id === x.op && !d._pending)));
    if (p.entries.length !== before) { if (!p.entries.length) { S.pending = null; const q = $('#quickText'); if (q) q.value = ''; } toast('Der Eintrag ist gespeichert.'); }
  }
}

/* ---------- Formulare schließen ---------- */
export function closeDraft(k){
  if (k === 'doneForm') { S.doneOpen = null; S.doneDraft = null; }
  else if (k === 'logForm') { $('#logForm').reset(); $('#lDate').value = todayISO(); $('#lKind').value = 'service'; S.logTasks.clear(); $('#logDetails').open = false; }
  else if (k === 'rideForm') { $('#rideForm').reset(); $('#rDate').value = todayISO(); $('#rideDetails').open = false; }
  else if (k === 'hoursForm') { const hf = $('#hoursForm'); hf.hidden = true; delete hf.dataset.confirm; $('#hoursHint').hidden = true; $('#hoursSave').textContent = 'Speichern'; }
  else if (k === 'setupForm') { resetSetupForm(); $('#setupDetails').open = false; }
  else if (k === 'partForm') { $('#pName').value = ''; $('#pQty').value = '1'; $('#pMin').value = '1'; }
  else if (k === 'addBikeForm') { S.adding = false; dropAddPhoto(); const el = $('#addBike'); if (el) el.innerHTML = ''; }
  else if (k === 'defectForm' || k === 'defDoneForm') { R.closeDefectDraft(k); }
  bumpGen(k);
}

/* ---------- Anzeige ---------- */
function renderBanner(){
  const el = $('#banner'), b = curBike(), rows = [];
  if (!el) return;
  if (b) {
    const due = [], soon = [];
    (b.items || []).forEach(it => { const st = itemState(b, it); if (st.s === 'bad') due.push(it.name); else if (st.s === 'warn') soon.push(it.name + ' (' + pillText(b, st) + ')'); });
    if (due.length) rows.push('<button class="banner-row" type="button" data-goto="status" data-anchor="c-items"><b>Überfällig</b><span>' + esc(due.join(', ')) + '</span></button>');
    if (soon.length) rows.push('<button class="banner-row warn" type="button" data-goto="status" data-anchor="c-items"><b>Bald fällig</b><span>' + esc(soon.join(', ')) + '</span></button>');
  }
  const low = S.parts.filter(p => p.qty <= p.min && (!b || p.bike === 'both' || p.bike === b.id));
  if (low.length) rows.push('<button class="banner-row warn" type="button" data-goto="garage" data-anchor="g-parts"><b>Nachkaufen</b><span>' + esc(low.map(p => p.name + ' (' + fmt(p.qty, 0) + ')').join(', ')) + '</span></button>');
  el.innerHTML = rows.join('');
  el.hidden = !rows.length;
}

export function modelOptions(brand){
  const g = MODELS[brand]; if (!g) return '';
  return ['mx4', 'en4', 't2', 'street'].filter(k => g[k]).reduce((a, k) => a.concat(g[k].split('|')), []).map(m => '<option value="' + esc(m) + '"></option>').join('');
}
function addBikeHTML(){
  const opts = BRANDS.map(b => '<option value="' + esc(b.n) + '">' + esc(b.n) + '</option>').join('');
  const tpl = Object.keys(TEMPLATES).map(k => '<option value="' + k + '">' + esc(TEMPLATES[k].label) + '</option>').join('');
  return '<div class="card"><div class="card-h"><h2>Motorrad hinzufügen</h2>' + (bikeList().length ? '<button class="link" type="button" id="addCancel">Abbrechen</button>' : '') + '</div>'
    + '<form id="addBikeForm" class="grid" novalidate>'
    + '<div class="f"><label for="abBrand">Marke</label><select id="abBrand">' + opts + '</select></div>'
    + '<div class="f"><label for="abColor">Farbe</label><input type="color" id="abColor" value="' + BRANDS[0].c + '"></div>'
    + '<div class="f full" id="abBrandOtherWrap" hidden><label for="abBrandOther">Markenname</label><input id="abBrandOther" autocomplete="off" placeholder="z. B. Rieju"></div>'
    + '<div class="f"><label for="abModel">Modell</label><input id="abModel" list="abModels" autocomplete="off" placeholder="tippen oder wählen"><datalist id="abModels">' + modelOptions(BRANDS[0].n) + '</datalist></div>'
    + '<div class="f"><label for="abYear">Baujahr</label><input id="abYear" inputmode="numeric" autocomplete="off"></div>'
    + '<div class="f full"><label for="abNick">Spitzname (optional)</label><input id="abNick" maxlength="40" autocomplete="off" placeholder="z. B. Die Orange"></div>'
    + '<div class="f full"><label for="abTpl">Wartungspunkte vorbelegen</label><select id="abTpl">' + tpl + '</select></div>'
    + '<div class="f full"><label for="abUnit">Zählt nach</label><select id="abUnit"><option value="h">Betriebsstunden</option><option value="km">Kilometern</option></select></div>'
    + '<div class="f full"><span class="lbl" id="abPhotoLbl">Foto (optional)</span><div class="photo-pick" id="abPhotoBox">' + addPhotoInner() + '</div></div>'
    + '<p class="hint full">Die Vorlagen sind Richtwerte, keine Herstellerangaben. Du kannst alles später unter Garage → Intervalle anpassen.</p>'
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
  if (!el.innerHTML) el.innerHTML = addBikeHTML();
}

export function renderStatus(){
  const b = curBike(); if (!b) return;
  const u = U(b), cur = curOf(b);
  $('#statusPhoto').innerHTML = b.photo ? imgTag(b.photo.id, 'Foto von ' + titleOf(b), 'hero-photo') : '';
  $('#plateLabel').textContent = u === 'km' ? 'Kilometerstand' : 'Betriebsstunden';
  $('#plateNum').textContent = cur == null ? '–' : fmt(cur);
  $('#plateUnit').textContent = u;
  $('#plateBtn').setAttribute('style', plateStyle(b));
  $('#plateBtn').setAttribute('aria-label', (cur == null ? 'Stand unbekannt' : 'Stand ' + fmt(cur) + ' ' + (u === 'km' ? 'Kilometer' : 'Stunden')) + ', ändern');
  const next = sortedItems(b).filter(x => x.st.s !== 'unk')[0];
  const last = S.log.filter(l => l.bike === b.id && l.kind === 'service')[0];
  const lines = [];
  if (cur == null) lines.push('<p>Tipp aufs Schild und trag deinen aktuellen Stand ein.</p>');
  if (next) lines.push('<p class="hint">Als Nächstes</p><p><b>' + esc(next.it.name) + '</b>: ' + esc(pillText(b, next.st)) + '</p>');
  else if (cur != null) lines.push('<p class="hint">Tipp unten bei einem Wartungspunkt auf „Erledigt“ und trag ein, wann du ihn zuletzt gemacht hast.</p>');
  if (last) lines.push('<p class="hint">Letzte Wartung ' + fmtDate(last.date) + ': ' + esc([].concat(last.taskNames || [], last.extra ? [last.extra] : []).join(', ') || 'Eintrag') + '</p>');
  $('#heroMeta').innerHTML = lines.join('');

  $('#itemList').innerHTML = (b.items || []).length ? sortedItems(b).map(({it, st}) => {
    const parts = [];
    if (it.every) parts.push('alle ' + fmt(it.every) + ' ' + u);
    if (it.months) parts.push('alle ' + it.months + ' Mon.');
    let sub = parts.join(' / ') || 'kein Intervall';
    const m = st.m;
    if (m && (m.at != null || m.date)) sub += ' · zuletzt ' + (m.at != null ? 'bei ' + fmt(m.at, 2) + ' ' + u + ' ' : '') + (m.date ? '(' + fmtDate(m.date) + ')' : '') + (m.at == null && it.every ? ', Stand unbekannt' : '');
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
  }).join('') : '<p class="hint">Noch keine Wartungspunkte. Leg sie unter Garage → Intervalle an.</p>';

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

function runtime(b, at){ const cur = curOf(b); return (at != null && cur != null) ? fmt(Math.max(0, cur - at)) + ' ' + U(b) + ' gelaufen' : ''; }
function mountHTML(b){
  const t = b.tires || {}, c = b.chain || {}, tf = t.front || {}, tr = t.rear || {};
  const ratio = (c.front && c.rear) ? ' · ' + fmt(c.rear / c.front, 2) : '';
  const cell = (lbl, val, run) => '<div class="mount-cell"><span class="lbl">' + lbl + '</span><b>' + (val ? esc(val) : '<span class="hint">nicht eingetragen</span>') + '</b>' + (run ? '<span class="run">' + esc(run) + '</span>' : '') + '</div>';
  return '<div class="mount">'
    + cell('Reifen vorn', tf.model, runtime(b, tf.at))
    + cell('Reifen hinten', tr.model, runtime(b, tr.at))
    + cell('Übersetzung', (c.front && c.rear) ? c.front + ' / ' + c.rear + ratio : '', '')
    + cell('Kette', [c.brand, c.links ? c.links + ' Glieder' : ''].filter(Boolean).join(', '), runtime(b, c.at))
    + '</div>';
}

function checkState(b){
  const s = lsJSON('check-' + b.id, null);
  if (s && s.date === todayISO() && Array.isArray(s.done)) return s;
  return {date: todayISO(), done: []};
}
function renderChecklist(b){
  const s = checkState(b);
  $('#checkList').innerHTML = CHECK.map((c, i) => { const on = s.done.includes(i); return '<label class="check' + (on ? ' done' : '') + '"><input type="checkbox" data-check="' + i + '"' + (on ? ' checked' : '') + '><span>' + esc(c) + '</span></label>'; }).join('');
  $('#checkCount').textContent = s.done.length + ' von ' + CHECK.length;
}

export function renderLogTasks(){
  const b = curBike(); if (!b) return;
  $('#lTasks').innerHTML = (b.items || []).map(it => '<button type="button" class="chip" data-task="' + esc(it.id) + '" aria-pressed="' + S.logTasks.has(it.id) + '">' + esc(it.name) + '</button>').join('') || '<span class="hint">Keine Wartungspunkte angelegt.</span>';
}
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
  renderLogTasks();
  const entries = S.log.filter(l => l.bike === b.id);
  const work = entries.filter(l => l.kind !== 'reading');
  const year = todayISO().slice(0, 4);
  const sum = work.reduce((a, l) => a + (l.cost || 0), 0);
  const sumY = work.filter(l => (l.date || '').startsWith(year)).reduce((a, l) => a + (l.cost || 0), 0);
  $('#logStats').innerHTML = '<div class="stat"><b>' + work.length + '</b><span>Einträge</span></div><div class="stat"><b>' + eur(sumY).replace(/,00\s/, ' ') + '</b><span>Kosten ' + year + '</span></div><div class="stat"><b>' + eur(sum).replace(/,00\s/, ' ') + '</b><span>Kosten gesamt</span></div>';
  $('#logCount').textContent = entries.length ? entries.length + ' Einträge' : '';
  const kinds = {service: 'Wartung', tire: 'Reifen', chain: 'Kette', note: 'Notiz', reading: 'Stand'};
  const armText = {service: 'Löschen? Fälligkeit wird neu berechnet', reading: 'Löschen? Stand wird neu berechnet'};
  $('#logList').innerHTML = entries.length ? entries.map(l => {
    if (l.kind === 'reading') {
      return '<div class="entry reading"><div><div class="entry-date">' + fmtDate(l.date) + '</div><div class="entry-at">' + fmt(l.at, 2) + '<small> ' + u + '</small></div></div>'
        + '<div class="entry-body"><span class="kind reading">' + (l.correction ? 'Stand korrigiert' : 'Stand abgelesen') + '</span>'
        + '<div class="entry-foot"><span></span><button class="mini" type="button" data-del="log/' + esc(l.id) + '" data-arm="' + armText.reading + '">Löschen</button></div></div></div>';
    }
    const title = [].concat(l.taskNames || [], l.extra ? [l.extra] : [], l.title ? [l.title] : []).join(' · ');
    const sa = svcAtOf(l);
    const atNote = l.kind !== 'service' ? '' : (sa.src === 'auto' ? 'aus Verlauf' : (sa.src === 'unk' ? 'Stand unbekannt' : ''));
    const kind = l.repairOf ? 'Reparatur' : (kinds[l.kind] || 'Eintrag');
    return '<div class="entry"><div><div class="entry-date">' + fmtDate(l.date) + '</div><div class="entry-at">' + (sa.v == null ? '' : fmt(sa.v, 2) + '<small> ' + u + '</small>') + '</div>' + (atNote ? '<div class="hint" style="font-size:12px">' + atNote + '</div>' : '') + '</div>'
      + '<div class="entry-body"><span class="kind">' + kind + (l._pending ? ' <span class="hint">wird gespeichert …</span>' : '') + '</span>'
      + (title ? '<div class="entry-title">' + esc(title) + '</div>' : '')
      + (l.note ? '<div class="entry-note">' + esc(l.note) + '</div>' : '')
      + (l.photoId ? photoBtn(l.photoId, l.thumbId, 'Foto zum Eintrag vom ' + fmtDate(l.date)) : '')
      + '<div class="entry-foot"><span class="cost">' + (l.cost != null ? eur(l.cost) : '') + '</span><button class="mini" type="button" data-del="log/' + esc(l.id) + '" data-arm="' + (armText[l.kind] || 'Löschen?') + '">Löschen</button></div></div></div>';
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
  const parts = S.parts.filter(p => !p.bike || p.bike === 'both' || p.bike === b.id).sort((a, c) => (a.name || '').localeCompare(c.name || '', 'de'));
  $('#partsCount').textContent = parts.length ? parts.length + ' Teile' : '';
  $('#partsBody').innerHTML = parts.length ? parts.map(p => {
    const low = p.qty <= p.min;
    const forB = (p.bike && p.bike !== 'both' && S.bikes[p.bike]) ? shortName(S.bikes[p.bike]) : 'alle';
    return '<div class="part' + (low ? ' low' : '') + '"><div><div class="part-name">' + esc(p.name) + '</div><div class="item-sub">für ' + esc(forB) + ' · nachkaufen ab ' + fmt(p.min, 0) + (low ? ' · <span class="txt-bad">knapp</span>' : '') + '</div></div>'
      + '<div class="qty"><button class="mini" type="button" data-qty="' + esc(p.id) + '" data-d="-1" aria-label="' + esc(p.name) + ': eins weniger"' + (S.qtyBusy.has(p.id) ? ' disabled' : '') + '>−</button><b aria-label="Anzahl">' + fmt(p.qty, 0) + '</b><button class="mini" type="button" data-qty="' + esc(p.id) + '" data-d="1" aria-label="' + esc(p.name) + ': eins mehr"' + (S.qtyBusy.has(p.id) ? ' disabled' : '') + '>+</button><button class="mini" type="button" data-del="parts/' + esc(p.id) + '" data-arm="Weg?" aria-label="' + esc(p.name) + ' entfernen">×</button></div></div>';
  }).join('') : '<p class="hint">Noch keine Teile im Vorrat. Füg Ölfilter, Zündkerzen oder Beläge hinzu, dann siehst du rechtzeitig, wann du nachkaufen musst.</p>';
  const pb = $('#pBike'), pv = pb.value;
  pb.innerHTML = '<option value="both">alle Motorräder</option>' + bikeList().map(x => '<option value="' + esc(x.id) + '">' + esc(bikeName(x)) + '</option>').join('');
  pb.value = pv && Array.from(pb.options).some(o => o.value === pv) ? pv : b.id;
  if (!S.editing.int) {
    $('#intBody').innerHTML = '<p class="hint" style="margin-bottom:8px">Zählt nach ' + (u === 'km' ? 'Kilometern' : 'Betriebsstunden') + '. Die Vorgaben sind Richtwerte. Die Herstellervorgaben findest du im Handbuch.</p><dl class="kv">'
      + ((b.items || []).map(it => '<dt>' + esc(it.name) + '</dt><dd>' + ([it.every ? fmt(it.every) + ' ' + u : '', it.months ? it.months + ' Mon.' : ''].filter(Boolean).join(' / ') || '–') + '</dd>').join('') || '<dt>–</dt><dd>Noch keine Wartungspunkte</dd>') + '</dl>';
  }
  $$('[data-edit]').forEach(x => { x.textContent = 'Bearbeiten'; x.disabled = !!S.editing[x.dataset.edit]; });
}

function renderManual(){
  const b = curBike(); if (!b) return;
  const m = b.manual || null;
  const has = m && ((m.kind === 'pdf' && m.fileId) || (m.kind === 'link' && safeUrl(m.url)));
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
    + '<form id="manLinkForm" class="stack" novalidate><div class="f"><label for="manUrl">Oder Link einfügen</label><input id="manUrl" type="url" inputmode="url" autocomplete="off" placeholder="https://…"></div><div class="row"><button class="btn primary" type="submit">Link speichern</button>' + (S.editing.manual ? '<button class="btn ghost" type="button" id="manCancel">Abbrechen</button>' : '') + '</div></form>';
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
  return '<form id="oemForm" class="stack" data-bike="' + esc(d.bike) + '" novalidate><div id="oemRows" class="stack" style="gap:6px">'
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
function openEdit(key){
  const b = curBike(); if (!b) return;
  S.editing[key] = true;
  const u = U(b), cur = curOf(b);
  if (key === 'bike') {
    const known = !!brandOf(b);
    const opts = BRANDS.map(x => '<option value="' + esc(x.n) + '"' + ((brandOf(b) === x || (!known && x.n === 'Andere')) ? ' selected' : '') + '>' + esc(x.n) + '</option>').join('');
    $('#bikeBody').innerHTML = '<form id="bikeForm" class="grid" data-bike="' + esc(b.id) + '" novalidate>'
      + '<div class="f full"><label for="ebNick">Spitzname</label><input id="ebNick" maxlength="40" value="' + esc(b.nickname || '') + '" placeholder="optional"></div>'
      + '<div class="f"><label for="ebBrand">Marke</label><select id="ebBrand">' + opts + '</select></div>'
      + '<div class="f"><label for="ebColor">Farbe</label><input type="color" id="ebColor" value="' + colorOf(b) + '"></div>'
      + '<div class="f full" id="ebOtherWrap"' + (known && brandOf(b).n !== 'Andere' ? ' hidden' : '') + '><label for="ebOther">Markenname</label><input id="ebOther" value="' + esc(known ? (brandOf(b).n === 'Andere' ? '' : b.brand) : b.brand) + '"></div>'
      + '<div class="f"><label for="ebModel">Modell</label><input id="ebModel" list="ebModels" autocomplete="off" value="' + esc(b.model || '') + '"><datalist id="ebModels">' + modelOptions(known ? brandOf(b).n : '') + '</datalist></div>'
      + '<div class="f"><label for="ebYear">Baujahr</label><input id="ebYear" inputmode="numeric" value="' + esc(b.year || '') + '"></div>'
      + '<div class="f full row"><button class="btn primary" type="submit">Speichern</button><button class="btn ghost" type="button" data-cancel="bike">Abbrechen</button></div>'
      + '<div class="f full danger-zone"><button class="mini" type="button" id="bikeRemove" data-arm="Wirklich alles löschen?">Motorrad entfernen</button><p class="hint" style="margin-top:6px">Löscht das Motorrad mit allen Einträgen, Fahrten, Setups, Mängeln und Fotos. Mach vorher eine Sicherung, wenn du unsicher bist.</p></div></form>';
  }
  if (key === 'tc') {
    const t = b.tires || {}, c = b.chain || {}, tf = t.front || {}, tr = t.rear || {};
    const ph = cur == null ? '' : ' placeholder="' + esc(v2(cur)) + '"';
    $('#tcBody').innerHTML = '<form id="tcForm" class="stack" data-bike="' + esc(b.id) + '" novalidate>'
      + '<fieldset><legend>Reifen vorn</legend><div class="grid"><div class="f full"><label for="tfM">Modell</label><input id="tfM" value="' + esc(tf.model || '') + '" placeholder="z. B. Michelin Starcross 6"></div><div class="f"><label for="tfA">Montiert bei (' + u + ')</label><input id="tfA" inputmode="decimal" value="' + esc(v2(tf.at)) + '"' + ph + '></div><div class="f"><label for="tfD">am</label><input type="date" id="tfD" value="' + esc(tf.date || '') + '" max="' + todayISO() + '"></div></div></fieldset>'
      + '<fieldset><legend>Reifen hinten</legend><div class="grid"><div class="f full"><label for="trM">Modell</label><input id="trM" value="' + esc(tr.model || '') + '"></div><div class="f"><label for="trA">Montiert bei (' + u + ')</label><input id="trA" inputmode="decimal" value="' + esc(v2(tr.at)) + '"' + ph + '></div><div class="f"><label for="trD">am</label><input type="date" id="trD" value="' + esc(tr.date || '') + '" max="' + todayISO() + '"></div></div></fieldset>'
      + '<fieldset><legend>Kette &amp; Übersetzung</legend><div class="grid"><div class="f"><label for="cF">Ritzel (Zähne)</label><input id="cF" inputmode="numeric" value="' + esc(c.front || '') + '"></div><div class="f"><label for="cR">Kettenrad (Zähne)</label><input id="cR" inputmode="numeric" value="' + esc(c.rear || '') + '"></div><div class="f"><label for="cB">Kette</label><input id="cB" value="' + esc(c.brand || '') + '" placeholder="z. B. DID 520 ERV3"></div><div class="f"><label for="cL">Glieder</label><input id="cL" inputmode="numeric" value="' + esc(c.links || '') + '"></div><div class="f"><label for="cA">Montiert bei (' + u + ')</label><input id="cA" inputmode="decimal" value="' + esc(v2(c.at)) + '"' + ph + '></div><div class="f"><label for="cD">am</label><input type="date" id="cD" value="' + esc(c.date || '') + '" max="' + todayISO() + '"></div></div></fieldset>'
      + '<p class="hint">Wenn du ein neues Modell oder einen neuen Montage-Stand einträgst, landet der Wechsel automatisch im Logbuch.</p>'
      + '<div class="row"><button class="btn primary" type="submit">Speichern</button><button class="btn ghost" type="button" data-cancel="tc">Abbrechen</button></div></form>';
  }
  if (key === 'oil') {
    const fl = b.fluids || {};
    $('#oilBody').innerHTML = '<form id="oilForm" class="stack" data-bike="' + esc(b.id) + '" novalidate>' + FLUIDS.map(([k, l]) => { const f = fl[k] || {}; return '<fieldset><legend>' + l + '</legend><div class="grid3"><div class="f"><label for="o_' + k + '_b">Marke</label><input id="o_' + k + '_b" value="' + esc(f.brand || '') + '" maxlength="120"></div><div class="f"><label for="o_' + k + '_s">Sorte</label><input id="o_' + k + '_s" value="' + esc(f.spec || '') + '" maxlength="120"' + (k === 'motor' ? ' placeholder="z. B. 10W-50"' : '') + '></div><div class="f"><label for="o_' + k + '_q">Menge</label><input id="o_' + k + '_q" value="' + esc(f.qty || '') + '" maxlength="60"' + (k === 'motor' ? ' placeholder="z. B. 1,1 l"' : '') + '></div></div></fieldset>'; }).join('')
      + '<div class="row"><button class="btn primary" type="submit">Speichern</button><button class="btn ghost" type="button" data-cancel="oil">Abbrechen</button></div></form>';
  }
  if (key === 'int') {
    const row = it => '<tr data-id="' + esc(it.id || '') + '"><td><input data-k="name" value="' + esc(it.name || '') + '" aria-label="Name" maxlength="120"></td><td class="n"><input data-k="every" inputmode="decimal" value="' + esc(v2(it.every)) + '" aria-label="Intervall ' + u + '"></td><td class="n"><input data-k="months" inputmode="numeric" value="' + esc(it.months || '') + '" aria-label="Intervall Monate"></td><td class="n"><input data-k="lastAt" inputmode="decimal" value="' + esc(v2(it.lastAt)) + '" aria-label="Startwert bei"></td><td><input data-k="lastDate" type="date" value="' + esc(it.lastDate || '') + '" max="' + todayISO() + '" aria-label="Startwert am"></td><td><button class="mini" type="button" data-rmrow aria-label="Punkt entfernen">×</button></td></tr>';
    $('#intBody').innerHTML = '<form id="intForm" class="stack" data-bike="' + esc(b.id) + '" novalidate><div class="f"><label for="iUnit">Zählt nach</label><select id="iUnit"><option value="h">Betriebsstunden</option><option value="km">Kilometern</option></select></div>'
      + '<div class="tbl-wrap"><table class="int"><thead><tr><th>Wartungspunkt</th><th>alle ' + u + '</th><th>alle Mon.</th><th>Startwert bei</th><th>Startwert am</th><th><span class="sr">Entfernen</span></th></tr></thead><tbody id="intRows">' + (b.items || []).map(row).join('') + '</tbody></table></div>'
      + '<div class="row"><button class="btn" type="button" id="intAdd">Punkt hinzufügen</button></div>'
      + '<p class="hint">Den Startwert brauchst du nur, wenn die letzte Arbeit nicht im Logbuch steht. Ein neuerer Logbuch-Eintrag gilt automatisch. Einfacher geht es unter Status über „Erledigt“.</p>'
      + '<div class="row"><button class="btn primary" type="submit">Speichern</button><button class="btn ghost" type="button" data-cancel="int">Abbrechen</button></div></form>';
    $('#iUnit').value = u;
    $('#intAdd').onclick = () => { $('#intRows').insertAdjacentHTML('beforeend', row({})); };
  }
  if (key === 'oem') {
    const o = b.oem || {};
    S.oemDraft = {bike: b.id, rows: oemRows(b).map(r => ({when: r.when || '', what: r.what || ''})), note: o.note || '', sourceTitle: o.sourceTitle || '', sourceUrl: o.sourceUrl || ''};
    if (!S.oemDraft.rows.length) S.oemDraft.rows.push({when: '', what: ''});
    $('#oemBody').innerHTML = oemEditHTML();
  }
  renderGarage();
  $$('[data-edit="oem"]').forEach(x => { x.disabled = !!S.editing.oem; });
}
function closeEdit(key){ S.editing[key] = false; if (key === 'oem') S.oemDraft = null; R.renderAll(); }
function syncOemDraft(){
  if (!S.oemDraft) return;
  $$('[data-oem]').forEach(inp => { const r = S.oemDraft.rows[+inp.dataset.i]; if (r) r[inp.dataset.oem] = inp.value; });
  const n = $('#oemNote'); if (n) S.oemDraft.note = n.value;
  const t = $('#oemSrcT'); if (t) S.oemDraft.sourceTitle = t.value;
  const u = $('#oemSrcU'); if (u) S.oemDraft.sourceUrl = u.value;
}

/* Reifen/Kette: Motorrad und Logbuch-Zeilen in EINEM Vorgang. Eine Wiederholung nutzt dieselben IDs. */
async function saveTC(b){
  const t = b.tires || {}, c = b.chain || {}, tf = t.front || {}, tr = t.rear || {}, lim = LIM[U(b)].cnt;
  const nf = {model: str($('#tfM').value).slice(0, 120), at: fieldNum('tfA', 'Reifen vorn, Stand', {min: 0, max: lim}), date: fieldDate('tfD', 'Reifen vorn, Datum') || ''};
  const nr = {model: str($('#trM').value).slice(0, 120), at: fieldNum('trA', 'Reifen hinten, Stand', {min: 0, max: lim}), date: fieldDate('trD', 'Reifen hinten, Datum') || ''};
  const nc = {front: fieldNum('cF', 'Ritzel', {int: true, min: 5, max: 99}), rear: fieldNum('cR', 'Kettenrad', {int: true, min: 5, max: 99}), brand: str($('#cB').value).slice(0, 120), links: fieldNum('cL', 'Kettenglieder', {int: true, min: 40, max: 250}), at: fieldNum('cA', 'Kette, Stand', {min: 0, max: lim}), date: fieldDate('cD', 'Kette, Datum') || ''};
  const sm = (a, x) => (a == null ? null : a) === (x == null ? null : x);
  const today = todayISO(), cur = curOf(b);
  const fChanged = nf.model && (nf.model !== tf.model || !sm(nf.at, tf.at));
  const rChanged = nr.model && (nr.model !== tr.model || !sm(nr.at, tr.at));
  const cChanged = (nc.brand || nc.front || nc.rear) && (nc.brand !== (c.brand || '') || !sm(nc.at, c.at) || !sm(nc.front, c.front) || !sm(nc.rear, c.rear));
  [[fChanged, nf], [rChanged, nr], [cChanged, nc]].forEach(([ch, o]) => { if (ch) { if (!o.date) o.date = today; if (o.at == null && o.date === today) o.at = cur; } });
  const o = opFor('tcForm', b.id, 'bikes', null, canon([nf, nr, nc])); if (o.saving) return false;
  o.noTrack = true;
  if (!o.payload) {
    const now = o.created, base = {bike: b.id, tasks: [], taskNames: [], extra: '', cost: null, note: '', atAuto: false};
    const items = [{coll: 'bikes', id: b.id, patch: {tires: {front: nf, rear: nr}, chain: nc}}];
    if (fChanged) items.push({coll: 'log', id: 'tc' + uid(), data: canonDoc('log', Object.assign({}, base, {kind: 'tire', date: nf.date, at: nf.at, title: 'Reifen vorn: ' + nf.model, created: now}))});
    if (rChanged) items.push({coll: 'log', id: 'tc' + uid(), data: canonDoc('log', Object.assign({}, base, {kind: 'tire', date: nr.date, at: nr.at, title: 'Reifen hinten: ' + nr.model, created: now + 1}))});
    if (cChanged) items.push({coll: 'log', id: 'tc' + uid(), data: canonDoc('log', Object.assign({}, base, {kind: 'chain', date: nc.date, at: nc.at, title: 'Kette/Übersetzung: ' + [nc.front && nc.rear ? nc.front + '/' + nc.rear : '', nc.brand, nc.links ? nc.links + ' Glieder' : ''].filter(Boolean).join(', '), created: now + 2}))});
    o.payload = {items}; o.label = 'Reifen & Kette';
  }
  const r = await execOp('tcForm', o, () => store.commitR(o.payload.items, null, 'tc', {epoch: o.epoch}));
  if (r === 'ok') { toast(o.payload.items.length > 1 ? 'Gespeichert, Wechsel im Logbuch eingetragen.' : 'Gespeichert.'); return true; }
  return false;
}
async function saveOil(b){
  const fluids = {};
  FLUIDS.forEach(([k]) => { fluids[k] = {brand: str($('#o_' + k + '_b').value).slice(0, 120), spec: str($('#o_' + k + '_s').value).slice(0, 120), qty: str($('#o_' + k + '_q').value).slice(0, 60)}; });
  if (await bikeUpdate(b.id, {fluids})) { toast('Gespeichert.'); return true; }
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
  if (await bikeUpdate(b.id, {items, unit})) { toast('Gespeichert.'); return true; }
  return false;
}
async function saveOem(b){
  syncOemDraft();
  const d = S.oemDraft;
  const oem = {rows: d.rows.map(r => ({when: str(r.when).slice(0, 60), what: str(r.what).slice(0, 300)})).filter(r => r.when || r.what), note: str(d.note).slice(0, 2000), sourceTitle: str(d.sourceTitle).slice(0, 200), sourceUrl: safeUrl(d.sourceUrl)};
  if (await bikeUpdate(b.id, {oem})) { toast('Gespeichert.'); return true; }
  return false;
}
async function saveBikeEdit(b){
  const sel = $('#ebBrand').value;
  const brand = (sel === 'Andere' ? (str($('#ebOther').value) || 'Andere') : sel).slice(0, 60);
  const year = fieldNum('ebYear', 'Baujahr', {int: true, min: 1900, max: new Date().getFullYear() + 1});
  const br = BRANDS.find(x => x.n === brand);
  const patch = {brand, short: br && br.short ? br.short : null, model: str($('#ebModel').value).slice(0, 80), year, color: $('#ebColor').value, nickname: str($('#ebNick').value).slice(0, 40)};
  if (await bikeUpdate(b.id, patch)) { toast('Gespeichert.'); return true; }
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
  S.section = v; lsSet('section', v);
  $$('#v-bike .sub').forEach(s => { s.hidden = s.id !== 'v-' + v; });
  $$('.tab').forEach(t => t.setAttribute('aria-current', t.dataset.v === v ? 'page' : 'false'));
  if (S.bike && R.route.page === 'bike') R.navigate({page: 'bike', bike: S.bike, section: v}, {replace: true, silent: true});
  if (anchor) { const el = document.getElementById(anchor); if (el) requestAnimationFrame(() => el.scrollIntoView({block: 'start', behavior: 'smooth'})); }
  else window.scrollTo(0, 0);
}
/* Alle Formulare, die zu einem Motorrad gehören, schließen und an das neue Motorrad binden */
export function resetBikeForms(){
  const id = S.bike;
  const hf = $('#hoursForm'); hf.hidden = true; delete hf.dataset.confirm; $('#hoursHint').hidden = true; $('#hoursSave').textContent = 'Speichern';
  S.doneOpen = null; S.doneDraft = null;
  /* Offene Vorgänge gehören zum bisherigen Motorrad: ungeklärte werden getrennt weiter abgeglichen,
     laufende Speicherungen beenden sich selbst. Neue Generation: späte Abschlüsse lassen die neuen Entwürfe in Ruhe. */
  BIKE_FORMS.forEach(k => { parkOp(k); bumpGen(k); });
  /* Formulare gehören zu Motorrad UND Bestand (Kennung): nach dem Einspielen derselben Garage sind sie neu */
  ['logForm', 'rideForm', 'setupForm', 'defectForm'].forEach(fid => { const f = $('#' + fid); if (!f) return; f.reset(); f.dataset.bike = id; f.dataset.epoch = S.epoch || ''; $$('[aria-invalid]', f).forEach(x => x.removeAttribute('aria-invalid')); });
  $('#rInWrap').hidden = true;
  hf.dataset.bike = id; hf.dataset.epoch = S.epoch || '';
  $('#logDetails').open = false; $('#rideDetails').open = false; $('#setupDetails').open = false;
  $('#lDate').value = todayISO(); $('#rDate').value = todayISO();
  S.logTasks.clear(); S.editing = {}; S.oemDraft = null; S.editSetup = null;
  $('#setupFormTitle').textContent = 'Setup speichern'; $('#sSave').textContent = 'Setup speichern'; $('#sCancel').hidden = true;
  R.resetDefectForms();
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
  setSection('setup', 'setupDetails');
  if (asCopy) $('#sTrack').focus();
}
function resetSetupForm(){
  const f = $('#setupForm'); f.reset(); f.dataset.bike = S.bike; f.dataset.epoch = S.epoch || ''; S.editSetup = null;
  parkOp('setupForm');
  $('#setupFormTitle').textContent = 'Setup speichern'; $('#sSave').textContent = 'Setup speichern'; $('#sCancel').hidden = true;
}

/* ---------- Dateien ---------- */
async function uploadManual(file){
  const b = curBike(); if (!b || !file) return;
  const bid = b.id, epoch = S.epoch || '';
  await flow(() => uploadManualRun(file, bid, epoch));
}
async function uploadManualRun(file, bid, epoch){
  let rec;
  try { rec = await makePdf(file); }
  catch (e) { toast(e && e.code === 'too_big' ? 'Die PDF ist größer als 40 MB. Füg stattdessen einen Link ein.' : (e && e.code === 'not_pdf' ? 'Das ist keine PDF-Datei.' : 'Die Datei konnte nicht gelesen werden.')); return; }
  const cur = S.bikes[bid]; if (!cur) return;
  const old = cur.manual && cur.manual.kind === 'pdf' ? cur.manual.fileId : '';
  const res = await store.sUpdateR('bikes', bid, {manual: {kind: 'pdf', fileId: rec.id, name: rec.name, size: rec.size}}, [rec], {epoch});
  if (res === 'ok') {
    if (old && old !== rec.id) cleanupFiles([old]);
    S.editing.manual = false; toast('Anleitung gespeichert.'); renderManual();
  } else if (res === 'fail') { cleanupFiles([rec.id]); toast(errText(S.lastErr) + ' Die Anleitung wurde nicht gespeichert.'); }
  else toast('Unklar, ob die Anleitung gespeichert wurde. Lade die Seite später neu und prüf es.');
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
  if (t.id === 'addCancel') { closeDraft('addBikeForm'); R.navigate({page: 'home'}, {replace: true}); return true; }
  if (t.id === 'abPhotoDrop') { dropAddPhoto(); $('#abPhotoBox').innerHTML = addPhotoInner(); return true; }
  if (t.dataset.v) { setSection(t.dataset.v); return true; }
  if (t.dataset.goto) { if (t.dataset.goto === 'defects' && t.dataset.open) R.openDefectForm(); setSection(t.dataset.goto, t.dataset.anchor); return true; }
  if (t.dataset.jump) { const el = document.getElementById(t.dataset.jump); if (el) el.scrollIntoView({block: 'start', behavior: 'smooth'}); return true; }
  if (t.dataset.edit) { openEdit(t.dataset.edit); return true; }
  if (t.dataset.cancel) { closeEdit(t.dataset.cancel); return true; }
  if (t.hasAttribute('data-rmrow')) { t.closest('tr').remove(); return true; }
  if (t.id === 'oemAdd') { syncOemDraft(); S.oemDraft.rows.push({when: '', what: ''}); $('#oemBody').innerHTML = oemEditHTML(); return true; }
  if (t.dataset.oemrm != null) { syncOemDraft(); S.oemDraft.rows.splice(+t.dataset.oemrm, 1); $('#oemBody').innerHTML = oemEditHTML(); return true; }
  if (t.dataset.task) { const id = t.dataset.task; S.logTasks.has(id) ? S.logTasks.delete(id) : S.logTasks.add(id); t.setAttribute('aria-pressed', S.logTasks.has(id)); return true; }
  if (t.id === 'plateBtn') {
    const b = curBike(); if (!b) return true;
    const f = $('#hoursForm'); f.hidden = false; f.dataset.bike = b.id; f.dataset.epoch = S.epoch || ''; delete f.dataset.confirm;
    $('#hoursHint').hidden = true; $('#hoursSave').textContent = 'Speichern';
    const cur = curOf(b); $('#hoursInput').value = cur != null ? v2(cur) : ''; $('#hoursInput').focus(); return true;
  }
  if (t.id === 'hoursCancel') { if (S.ops.hoursForm && S.ops.hoursForm.saving) return true; parkOp('hoursForm'); closeDraft('hoursForm'); return true; }
  if (t.id === 'qCommit') { await commitPending(); return true; }
  if (t.dataset.qedit != null) { editPending(+t.dataset.qedit); return true; }
  if (t.id === 'qSwap') { if (S.pending && !S.pending.saving && !S.pending.tried && S.pending.entries.length === 2) { S.pending.entries.reverse(); S.pending.entries.forEach(x => { x.created = 0; }); renderQuick(); } return true; }
  if (t.dataset.qdrop != null) { if (S.pending && !S.pending.saving) { parkPendingEntries(S.pending.entries.splice(+t.dataset.qdrop, 1)); if (!S.pending.entries.length) S.pending = null; } renderQuick(); return true; }
  if (t.id === 'qDrop') { if (S.pending && S.pending.saving) return true; if (S.pending) parkPendingEntries(S.pending.entries); S.pending = null; renderQuick(); return true; }
  if (t.id === 'checkReset') { const b = curBike(); if (b) { lsSet('check-' + b.id, JSON.stringify({date: todayISO(), done: []})); renderChecklist(b); } return true; }
  if (t.id === 'sCancel') { resetSetupForm(); return true; }
  if (t.id === 'dfCancel') { if (S.ops.doneForm && S.ops.doneForm.saving) return true; parkOp('doneForm'); closeDraft('doneForm'); renderStatus(); return true; }
  if (t.id === 'manReplace') { S.editing.manual = true; renderManual(); return true; }
  if (t.id === 'manCancel') { S.editing.manual = false; renderManual(); return true; }
  if (t.id === 'manRemove') {
    if (!arm(t)) return true;
    const b = curBike(); if (!b) return true;
    const old = b.manual && b.manual.kind === 'pdf' ? b.manual.fileId : '';
    if (await bikeUpdate(b.id, {manual: null})) { if (old) cleanupFiles([old]); toast('Anleitung entfernt.'); }
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
  if (t.dataset.editsetup) { const s = S.setups.find(x => x.id === t.dataset.editsetup); if (s) fillSetupForm(s, false); return true; }
  if (t.dataset.copysetup) { const s = S.setups.find(x => x.id === t.dataset.copysetup); if (s) fillSetupForm(s, true); return true; }
  if (t.dataset.done) {
    const b = curBike(); if (!b) return true;
    const item = t.dataset.done, so = S.ops.doneForm;
    /* Jeder neu geöffnete Wartungsentwurf ist eine neue Generation. Ein ungeklärter Vorgang zu einem
       anderen Punkt wird getrennt weiter abgeglichen; ein laufender endet für seinen eigenen Punkt. */
    if (so && !so.saving && so.item !== item) parkOp('doneForm');
    bumpGen('doneForm');
    if (S.ops.doneForm && !S.ops.doneForm.saving && S.ops.doneForm.item === item) S.ops.doneForm.gen = S.gen.doneForm;
    S.doneOpen = item; S.doneDraft = {date: todayISO(), atStr: '', costStr: ''};
    renderStatus();
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
    /* Eine Änderung pro Teil zur Zeit; schlägt sie fehl, wird genau diese Änderung zurückgenommen */
    const pid = t.dataset.qty;
    if (S.qtyBusy.has(pid)) return true;
    const p = S.parts.find(x => x.id === pid); if (!p) return true;
    const prev = Math.round(p.qty || 0), q = Math.max(0, Math.min(99999, prev + Number(t.dataset.d)));
    if (q === prev) return true;
    S.qtyBusy.add(pid); p.qty = q; renderGarage(); renderBanner();
    let ok = false;
    try { ok = await sUpdate('parts', pid, {qty: q}); } finally { S.qtyBusy.delete(pid); }
    if (!ok) { const now = S.parts.find(x => x.id === pid); if (now && now.qty === q) now.qty = prev; }
    renderGarage(); renderBanner();
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
  if (t.id === 'hoursInput') { const f = $('#hoursForm'); delete f.dataset.confirm; $('#hoursHint').hidden = true; $('#hoursSave').textContent = 'Speichern'; return true; }
  if (S.doneDraft && t.closest && t.closest('#doneForm')) {
    if (t.id === 'dfAt') { S.doneDraft.atStr = t.value; if (S.ops.doneForm) delete S.ops.doneForm.confirmLow; }
    if (t.id === 'dfCost') S.doneDraft.costStr = t.value;
  }
  if ((t.id === 'lAt' || t.id === 'lDate') && S.ops.logForm) delete S.ops.logForm.confirmLow;
  return false;
}

export function onChange(t){
  if (t.dataset && t.dataset.check != null) {
    const b = curBike(); if (!b) return true;
    const s = checkState(b), i = Number(t.dataset.check);
    s.done = t.checked ? Array.from(new Set(s.done.concat(i))) : s.done.filter(x => x !== i);
    lsSet('check-' + b.id, JSON.stringify(s)); renderChecklist(b);
    return true;
  }
  if (t.id === 'dfDate' && S.doneDraft) {
    S.doneDraft.date = t.value;
    if (S.ops.doneForm) delete S.ops.doneForm.confirmLow;
    renderStatus();
    return true;
  }
  if (t.id === 'lDate') { updateLogAtHint(); return true; }
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
    const b = curBike(); if (!b) return true;
    const bid = b.id, url = safeUrl($('#manUrl').value);
    if (!url) throw new VErr($('#manUrl'), 'Der Link muss mit https:// beginnen.');
    busy(true);
    const old = b.manual && b.manual.kind === 'pdf' ? b.manual.fileId : '';
    let name = url; try { name = new URL(url).hostname.replace(/^www\./, ''); } catch (err) {}
    if (await bikeUpdate(bid, {manual: {kind: 'link', url, name}})) { if (old) cleanupFiles([old]); S.editing.manual = false; toast('Link gespeichert.'); renderManual(); }
    return true;
  }
  if (f.id === 'partForm') {
    const name = str($('#pName').value).slice(0, 120);
    if (!name) throw new VErr($('#pName'), 'Gib dem Teil einen Namen.');
    const qty = fieldNum('pQty', 'Anzahl', {int: true, min: 0, max: 99999}) || 0;
    const min = fieldNum('pMin', 'Nachkaufen ab', {int: true, min: 0, max: 99999}) || 0;
    const pb = $('#pBike').value, forBike = pb === 'both' || S.bikes[pb] ? pb : 'both';
    const o = opFor('partForm', '', 'parts', null, [name, forBike, qty, min].join('|')); if (o.saving) return true;
    const g = S.gen.partForm || 0;
    if (!o.payload) { o.payload = canonDoc('parts', {name, bike: forBike, qty, min, created: o.created}); o.label = 'Teil ' + name; }
    busy(true);
    const r = await execOp('partForm', o, () => store.sSetR('parts', o.op, o.payload, null, {epoch: o.epoch}));
    if (r === 'ok') { if ((S.gen.partForm || 0) === g) closeDraft('partForm'); toast('Teil hinzugefügt.'); }
    return true;
  }
  const own = ['hoursForm', 'doneForm', 'logForm', 'rideForm', 'setupForm', 'bikeForm', 'tcForm', 'oilForm', 'intForm', 'oemForm'];
  if (!own.includes(f.id)) return false;
  const b = formBike(f); if (!b) return true;
  const lim = LIM[U(b)];

  if (f.id === 'hoursForm') {
    const v = fieldNum('hoursInput', 'Stand', {req: true, min: 0, max: lim.cnt});
    const cur = curOf(b), corr = cur != null && v < cur;
    if (corr && f.dataset.confirm !== String(v)) {
      f.dataset.confirm = String(v);
      const h = $('#hoursHint'); h.hidden = false;
      h.textContent = 'Das ist weniger als der aktuelle Stand (' + fmt(cur, 2) + ' ' + U(b) + '). Das ist nur zum Korrigieren eines Tippfehlers gedacht. Zum Bestätigen auf „Korrektur speichern“ tippen.';
      $('#hoursSave').textContent = 'Korrektur speichern';
      return true;
    }
    /* Eine bestätigte Ablesung wird immer gespeichert, auch wenn sie dem berechneten Stand entspricht.
       Identität nur aus der Eingabe; ob es eine Korrektur ist, gehört zum ersten Versuch (eingefrorene Nutzdaten) */
    const o = opFor('hoursForm', b.id, 'log', null, String(v)); if (o.saving) return true;
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
    const g = S.gen.doneForm || 0;
    if (!o.payload) { o.payload = serviceDoc(b, {date, at, tasks: [item], cost, created: o.created}); o.label = 'Wartung ' + it.name; }
    const r = await execOp('doneForm', o, () => store.sSetR('log', o.op, o.payload, null, {epoch: o.epoch}));
    if (r === 'ok') { if ((S.gen.doneForm || 0) === g) closeDraft('doneForm'); toast('Eingetragen.'); }
    renderStatus();
    return true;
  }
  if (f.id === 'logForm') {
    const kind = $('#lKind').value === 'note' ? 'note' : 'service';
    const tasks = Array.from(S.logTasks).filter(id => (b.items || []).some(i => i.id === id));
    const date = fieldDate('lDate', 'Datum', {req: true});
    const at = fieldNum('lAt', 'Stand', {min: 0, max: lim.cnt});
    const cost = fieldNum('lCost', 'Kosten', {min: 0, max: MAX_COST});
    const extra = str($('#lExtra').value).slice(0, 500), note = str($('#lNote').value).slice(0, 4000);
    if (kind === 'note' && tasks.length) throw new VErr($('#lKind'), 'Eine Notiz hat keine erledigten Wartungspunkte. Stell die Art auf „Wartung“ oder wähl die Punkte ab.');
    const file = $('#lPhoto').files && $('#lPhoto').files[0];
    if (!tasks.length && !extra && !note && cost == null && !file) { toast('Wähl eine Arbeit aus oder schreib etwas dazu.'); return true; }
    /* Vorgang, Erfassungszeit und Inhalt vor dem ersten await festlegen */
    const sig = [kind, date, at, cost, extra, note, tasks.join(','), file ? file.name + ':' + file.size + ':' + file.lastModified : ''].join('|');
    const o = opFor('logForm', b.id, 'log', null, sig); if (o.saving) return true;
    if (!o.payload && kind === 'service' && !lowCheck(o, b, date, at)) return true;
    const g = S.gen.logForm || 0;
    const base = {date, at, tasks, extra, cost, note, created: o.created};
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
        o.label = kind === 'note' ? 'Notiz' : 'Wartung ' + (o.payload.taskNames.join(', ') || o.payload.extra || '');
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
  if (f.id === 'oemForm') { busy(true); if (S.oemDraft && S.oemDraft.bike !== b.id) { closeEdit('oem'); return true; } if (await saveOem(b)) closeEdit('oem'); return true; }
  return false;
}

/* Statische Formularteile einmal füllen */
export function initBikeForms(){
  $('#rGround').innerHTML = '<option value="">–</option>' + GROUNDS.map(g => '<option>' + g + '</option>').join('');
  $('#rWeather').innerHTML = '<option value="">–</option>' + WEATHER.map(g => '<option>' + g + '</option>').join('');
  $('#rFeel').innerHTML = [1, 2, 3, 4, 5].map(i => '<label><input type="radio" name="feel" value="' + i + '"><span>' + i + '</span><span class="sr"> von 5</span></label>').join('');
  $('#lDate').max = todayISO(); $('#rDate').max = todayISO();
}
