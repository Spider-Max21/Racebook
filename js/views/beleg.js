/* Racebook – Lager: Artikel und Einkaufspreise aus Rechnungsfotos (ab 1.6.0, Issue #4).
   Ablauf: „Beleg fotografieren“ / „Beleg auswählen“ → Texterkennung auf dem Gerät (Belegmodus) → bearbeitbare Liste erkannter
   Positionen (js/receipt.js) → Nutzer wählt aus, korrigiert, bestätigt Einheit und Motorradzuordnung → „Ausgewählte übernehmen“
   speichert in einer Transaktion: neue Artikel, Zugänge zu vorhandenen Artikeln, Einkäufe (Modell aus 1.5.0) und das Belegbild.
   Erkennung allein ändert nichts. Bis zur Bestätigung liegt das Bild nur im Arbeitsspeicher; Verwerfen hinterlässt keine Datei.
   Wiederholung nach unklarem Ergebnis: dieselbe Vorgangskennung, nichts doppelt. Derselbe Beleg erneut: Hinweis, keine Sperre. */
import {S, bikeList, bikeName} from '../state.js';
import {$, $$, toast, errText, VErr} from '../ui.js';
import {esc, str, fmt, fmtDate, todayISO, isISO, uid, canon, MAX_BUYS} from '../util.js';
import {parsePrice, fmtPrice, unitName, canonDoc} from '../domain.js';
import {parseReceipt, amountCents, centsText} from '../receipt.js';
import {matchParts} from '../label.js';
import * as ocr from '../ocr.js';
import * as store from '../store.js';
import {opFor, parkOp, execOp} from '../ops.js';
import {makeReceiptImage} from '../images.js';
import * as drafts from '../drafts.js';
import {R} from '../registry.js';

const MARK = {ok: 'erkannt', check: 'bitte prüfen', none: 'nicht erkannt'};
const MAX_FILE = 30 * 1024 * 1024;
let seq = 0;

/* ---------- Beginnen, Erkennen, Verwerfen ---------- */
export function open(file){
  close();
  if (!file) return;
  if (file.size > MAX_FILE) { toast('Das Bild ist zu groß (höchstens 30 MB). Es wurde nichts gespeichert.'); return; }
  /* epoch: Bestandskennung beim Öffnen – der Beleg gehört zu diesem Bestand (ab 1.6.0, Prüfung PR 8, R160-1) */
  const rc = S.rcpt = {id: ++seq, epoch: S.epoch || '', file, url: URL.createObjectURL(file), hash: '', state: 'reading', status: 'Bild wird vorbereitet', rows: [], skipped: [], date: '', dateState: '',
    vendor: '', vendorState: '', header: false, totals: false, net: false, dup: null, run: 0};
  render(); drafts.mark('rcpt'); drafts.touch('rcpt');
  $('#rcptForm').scrollIntoView({block: 'start'});
  hashOf(file).then(h => { if (S.rcpt !== rc) return; rc.hash = h; rc.dup = dupOf(h); renderDup(); });
  recognize(rc);
}
export function recognize(rc){
  const tok = rc.run = (rc.run || 0) + 1;
  rc.state = 'reading'; rc.status = 'Bild wird vorbereitet'; renderStatus();
  const live = () => S.rcpt === rc && rc.run === tok && rc.state === 'reading';
  ocr.recognize(rc.file, (st, p) => { if (live()) { rc.status = st + (p > 0 && p < 1 ? ' ' + Math.round(p * 100) + ' %' : ''); renderStatus(); } }, {receipt: true}).then(r => {
    if (!live()) return;
    const pr = parseReceipt(r.lines);
    rc.state = 'done'; rc.ms = r.ms;
    syncRows();
    rc.rows = rc.rows.filter(x => x.manual).concat(pr.items.map(rowOf));
    rc.skipped = pr.skipped; rc.header = pr.header; rc.totals = pr.totals; rc.net = pr.net;
    /* Kaufdatum nur, wenn es im Bild lesbar ist (Vorschlag „bitte prüfen“); sonst bleibt es offen und wird erfragt */
    if (!rc.dateTouched) { rc.date = pr.date.value; rc.dateState = pr.date.value ? 'check' : 'none'; }
    if (!rc.vendorTouched) { rc.vendor = pr.vendor.value; rc.vendorState = pr.vendor.value ? 'check' : ''; }
    render();
  }, e => {
    if (!live()) return;
    if (e && (e.code === 'decode' || e.code === 'too_big')) { close(); toast(e.code === 'too_big' ? 'Das Bild ist zu groß (höchstens 30 MB). Es wurde nichts gespeichert.' : 'Das Bild konnte nicht gelesen werden. Wähle ein anderes Bild.'); return; }
    rc.state = e && e.code === 'cancelled' ? 'cancelled' : 'unavailable';
    syncRows(); if (!rc.dateTouched && !rc.date) rc.dateState = 'none';
    render();
  });
}
export function close(){
  const rc = S.rcpt; if (!rc) return;
  if (rc.state === 'reading') ocr.cancel();
  URL.revokeObjectURL(rc.url); S.rcpt = null;
  const f = $('#rcptForm'); if (f) { f.hidden = true; f.innerHTML = ''; }
  drafts.forget('rcpt');
}
async function hashOf(file){
  try { const d = await crypto.subtle.digest('SHA-256', await file.arrayBuffer()); return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join(''); }
  catch (e) { return ''; }
}
/* Derselbe Beleg (gleiche Bilddatei) wurde schon übernommen: Hinweis mit Datum und Artikeln */
function dupOf(h){
  if (!h) return null;
  const hits = [];
  S.parts.forEach(p => (p.buys || []).forEach(b => { if (b.docHash === h) hits.push({name: p.name, date: b.date}); }));
  return hits.length ? {dates: Array.from(new Set(hits.map(x => x.date))).sort(), names: Array.from(new Set(hits.map(x => x.name)))} : null;
}

/* ---------- Zeilen ---------- */
/* Grundlage eines aufzufüllenden Artikels, so wie der Nutzer ihn ausgewählt hat: Einheit, Gebindegröße, Preis.
   Ändert ein anderes Fenster sie inzwischen, wird nichts still umgedeutet (Prüfung beim Übernehmen und im Speicher). */
const baseOf = p => p ? {id: p.id, unit: p.unit == null ? null : p.unit, pack: p.pack == null ? null : p.pack, price: p.price == null ? null : p.price} : null;
function rowOf(it){
  const prop = {name: it.name, artNo: it.artNo};
  const m = matchParts(prop, S.parts)[0];
  return {base: m ? baseOf(Object.assign({id: m.part.id}, store.peek('parts', m.part.id) || m.part)) : null, sel: it.select, name: it.name.value, artNo: it.artNo.value, qty: it.qty.value, price: it.price.value, unit: '', pack: it.pack.value,
    target: m ? 'fill:' + m.part.id : 'new', why: m ? m.why : '', bike: '', bikes: [], total: it.total.value, sumOk: it.sumOk, notes: it.notes, lines: it.lines,
    st: {name: it.name.state, artNo: it.artNo.state, qty: it.qty.state, price: it.price.state, pack: it.pack.value ? 'check' : 'none'}};
}
const baseText = b => b.unit === 'pack' ? 'Gebinde' + (b.pack ? ' (' + b.pack + ')' : '') : b.unit === 'piece' ? 'Stück' + (b.pack ? ', Gebinde ' + b.pack : '') : 'ohne Einheit' + (b.pack ? ', Gebinde ' + b.pack : '');
const blankRow = () => ({base: null, sel: true, name: '', artNo: '', qty: '', price: '', unit: '', pack: '', target: 'new', why: '', bike: '', bikes: [], total: '', sumOk: null, notes: [], lines: [], st: {}, manual: true});
/* Aufzufüllender Artikel aus dem Speicher (mit Kennung; store.peek liefert den Datensatz ohne id) */
const partOf = r => { if (!r.target.startsWith('fill:')) return null; const id = r.target.slice(5), d = store.peek('parts', id); return d ? Object.assign({id}, d) : null; };
/* Eingaben aus dem Formular in den Zustand übernehmen (vor jedem Neuzeichnen) */
export function syncRows(){
  const rc = S.rcpt, f = $('#rcptForm'); if (!rc || !f || f.hidden || !f.firstChild) return;
  rc.rows.forEach((r, i) => {
    const g = k => $('#rc' + k + '-' + i);
    if (!g('N')) return;
    r.sel = g('S').checked; r.name = g('N').value; r.artNo = g('A').value; r.qty = g('Q').value; r.price = g('P').value;
    r.unit = g('U').value; r.pack = g('K').value; r.target = g('T').value;
    if (g('B')) { r.bike = g('B').value; r.bikes = $$('#rcBs-' + i + ' input:checked').map(x => x.value); }
  });
  if ($('#rcDate')) rc.date = $('#rcDate').value;
  if ($('#rcVendor')) rc.vendor = $('#rcVendor').value;
}

/* ---------- Anzeige ---------- */
const mark = st => '<span class="mark' + (st && MARK[st] ? ' mark-' + st : '') + '">' + (MARK[st] || '') + '</span>';
function lineHint(r){
  const q = Number(str(r.qty)), p = parsePrice(r.price), parts = [];
  if (r.total) parts.push('laut Beleg Zeilensumme ' + r.total + ' €');
  if (Number.isInteger(q) && q > 0 && !p.err && p.cents != null) {
    const t = q * p.cents, tb = r.total ? amountCents(r.total) : null;
    parts.push(fmt(q, 0) + ' × ' + fmtPrice(p.cents) + ' = ' + fmtPrice(t) + (tb != null && tb !== t ? ' – stimmt nicht mit dem Beleg überein, bitte prüfen' : ''));
  }
  return parts.concat(r.notes || []).join(' · ');
}
function targetOpts(r){
  const ms = matchParts({name: {value: r.name}, artNo: {value: r.artNo}}, S.parts).map(m => m.part.id);
  const list = S.parts.slice().sort((a, b) => (ms.includes(b.id) - ms.includes(a.id)) || String(a.name).localeCompare(String(b.name), 'de'));
  return '<option value="new">als neuen Artikel anlegen</option>' + list.map(p => '<option value="fill:' + esc(p.id) + '">„' + esc(p.name) + '“ auffüllen' + (ms.includes(p.id) ? ' (passt)' : '') + '</option>').join('');
}
function bikeOpts(){
  return '<option value="">– bitte wählen –</option><option value="both">alle Motorräder</option>' + bikeList().map(b => '<option value="' + esc(b.id) + '">' + esc(bikeName(b)) + '</option>').join('') + '<option value="some">ausgewählte Motorräder …</option>';
}
function rowHtml(r, i){
  const p = partOf(r), fill = !!p, uFix = fill && (p.unit === 'piece' || p.unit === 'pack');
  const unit = uFix ? p.unit : r.unit, pack = fill && p.pack ? p.pack : r.pack;
  return '<div class="rc-row' + (r.sel ? '' : ' off') + '" data-row="' + i + '">'
    + '<label class="rc-sel"><input type="checkbox" id="rcS-' + i + '"' + (r.sel ? ' checked' : '') + '> Position ' + (i + 1) + ' übernehmen</label>'
    + '<div class="grid">'
    + '<div class="f full"><label for="rcN-' + i + '">Bezeichnung ' + mark(r.st.name) + '</label><input id="rcN-' + i + '" value="' + esc(r.name) + '" autocomplete="off"></div>'
    + '<div class="f"><label for="rcA-' + i + '">Art.-Nr. ' + mark(r.st.artNo) + '</label><input id="rcA-' + i + '" value="' + esc(r.artNo) + '" autocomplete="off"></div>'
    + '<div class="f"><label for="rcQ-' + i + '">Menge ' + mark(r.st.qty) + '</label><input id="rcQ-' + i + '" inputmode="numeric" value="' + esc(r.qty) + '"></div>'
    + '<div class="f"><label for="rcP-' + i + '">Einzelpreis (€) ' + mark(r.st.price) + '</label><input id="rcP-' + i + '" inputmode="decimal" value="' + esc(r.price) + '" placeholder="leer = nicht erfasst"></div>'
    + '<div class="f"><label for="rcU-' + i + '">Menge und Preis gelten pro</label><select id="rcU-' + i + '"' + (uFix ? ' disabled' : '') + '><option value="">– bitte wählen –</option><option value="piece"' + (unit === 'piece' ? ' selected' : '') + '>Stück</option><option value="pack"' + (unit === 'pack' ? ' selected' : '') + '>Gebinde</option></select></div>'
    + '<div class="f"><label for="rcK-' + i + '">Gebindegröße ' + (fill && p.pack ? '' : mark(r.st.pack)) + '</label><input id="rcK-' + i + '" value="' + esc(pack) + '"' + (fill && p.pack ? ' disabled' : '') + ' autocomplete="off" placeholder="z. B. 4 L"></div>'
    + '<div class="f full"><label for="rcT-' + i + '">Ins Lager</label><select id="rcT-' + i + '">' + targetOpts(r) + '</select></div>'
    + (fill ? '<p class="hint f full">Zugang zu „' + esc(p.name) + '“ (jetzt ' + fmt(p.qty, 0) + ' im Vorrat' + (uFix ? ', Preis je ' + esc(unitName(p.unit)) + (p.unit === 'pack' && p.pack ? ' (' + esc(p.pack) + ')' : '') : '') + ').</p>'
      : '<div class="f full"><label for="rcB-' + i + '">Für</label><select id="rcB-' + i + '">' + bikeOpts() + '</select></div>'
        + '<fieldset class="f full bike-pick" id="rcBs-' + i + '"' + (r.bike === 'some' ? '' : ' hidden') + '><legend>Ausgewählte Motorräder</legend><div class="bike-pick-list">'
        + bikeList().map(b => '<label><input type="checkbox" value="' + esc(b.id) + '"' + (r.bikes.includes(b.id) ? ' checked' : '') + '>' + esc(bikeName(b)) + '</label>').join('') + '</div></fieldset>')
    + '<p class="hint f full rc-hint" id="rcH-' + i + '">' + esc(lineHint(r)) + '</p>'
    + (r.lines && r.lines.length ? '<p class="hint f full rc-src">Gelesen: „' + esc(r.lines.join(' / ')) + '“</p>' : '')
    + '</div></div>';
}
/* Artikel oder Motorräder geändert (auch in einem anderen Fenster): Liste mit den eingegebenen Werten neu zeichnen */
const baseSig = () => canon([S.parts.map(p => [p.id, p.name, p.unit || '', p.pack || '', p.qty, p.price == null ? null : p.price]), bikeList().map(b => [b.id, bikeName(b)])]);
export function refresh(){ const rc = S.rcpt; if (rc && rc.state !== 'reading' && rc.sig !== baseSig()) { syncRows(); render(); } }
export function render(){
  const f = $('#rcptForm'), rc = S.rcpt; if (!f) return;
  if (!rc) { f.hidden = true; f.innerHTML = ''; return; }
  f.hidden = false; rc.sig = baseSig();
  const reading = rc.state === 'reading', none = !reading && !rc.rows.length;
  f.innerHTML = '<h3>Beleg übernehmen</h3>'
    + '<div class="rc-head"><img class="rc-img" src="' + esc(rc.url) + '" alt="Gewählter Beleg"><div>'
    + '<p class="hint" id="rcStatus">' + esc(statusText(rc)) + '</p>'
    + (reading ? '<div class="row"><button class="btn ghost" type="button" id="rcStop">Erkennung abbrechen</button></div>' : '')
    + (rc.state === 'cancelled' || rc.state === 'unavailable' ? '<div class="row"><button class="btn ghost" type="button" id="rcRerun">Erneut erkennen</button></div>' : '')
    + '</div></div>'
    + '<p class="warnbox" id="rcDup" role="status"' + (rc.dup ? '' : ' hidden') + '>' + esc(dupText(rc.dup)) + '</p>'
    + (reading ? '' : '<div class="grid">'
      + '<div class="f"><label for="rcDate">Kaufdatum ' + (rc.dateState === 'check' ? mark('check') : rc.dateState === 'none' && !rc.date ? '<span class="mark mark-none">nicht im Beleg – bitte eintragen</span>' : '') + '</label><input type="date" id="rcDate" value="' + esc(rc.date) + '" max="' + todayISO() + '"></div>'
      + '<div class="f"><label for="rcVendor">Händler ' + mark(rc.vendor ? rc.vendorState || '' : 'none') + '</label><input id="rcVendor" maxlength="80" value="' + esc(rc.vendor) + '" autocomplete="off"></div>'
      + '</div>'
      + (rc.net ? '<p class="warnbox">Der Beleg nennt Netto-Beträge oder „zzgl. MwSt“. Racebook rechnet nichts um: trag den tatsächlich bezahlten Preis je Einheit ein.</p>' : '')
      + (!rc.header && !rc.totals && rc.rows.length ? '<p class="hint">Ausschnitt ohne Rechnungskopf und Summe: übernommen wird nur, was du hier auswählst.</p>' : '')
      + (none ? '<p class="hint">' + (rc.state === 'done' ? 'Auf dem Bild war keine Rechnungsposition lesbar.' : rc.state === 'cancelled' ? 'Erkennung abgebrochen.' : 'Die Texterkennung ist gerade nicht verfügbar.') + ' Du kannst Positionen selbst eintragen.</p>' : '')
      + '<div id="rcRows">' + rc.rows.map(rowHtml).join('') + '</div>'
      + '<div class="row"><button class="btn ghost" type="button" id="rcAdd">Position hinzufügen</button></div>'
      + (rc.skipped.length ? '<p class="hint rc-skip">Nicht als Artikel übernommen: ' + esc(rc.skipped.map(s => s.t).join(' · ')) + '</p>' : '')
      + '<p class="warnbox" id="rcConflict" role="alert" hidden></p>'
      + '<div class="row"><button class="btn" type="submit" id="rcSave">Ausgewählte übernehmen</button><button class="btn ghost" type="button" id="rcCancel">Verwerfen</button></div>');
  rc.rows.forEach((r, i) => { const t = $('#rcT-' + i); if (t) t.value = r.target; const b = $('#rcB-' + i); if (b) b.value = r.bike; });
  updateSave();
}
function statusText(rc){
  if (rc.state === 'reading') return 'Erkennung läuft auf diesem Gerät: ' + rc.status + ' …';
  if (rc.state === 'cancelled') return 'Erkennung abgebrochen.';
  if (rc.state === 'unavailable') return 'Die Texterkennung konnte nicht geladen werden (offline noch nicht bereit?).';
  return rc.rows.length ? rc.rows.length + (rc.rows.length === 1 ? ' Position' : ' Positionen') + ' erkannt. Prüfe die Angaben, wähle aus und bestätige Einheit und Motorrad.' : 'Keine Positionen erkannt.';
}
function renderStatus(){ const s = $('#rcStatus'); if (s && S.rcpt) s.textContent = statusText(S.rcpt); }
const dupText = d => d ? 'Diesen Beleg (dasselbe Bild) hast du schon am ' + d.dates.map(fmtDate).join(', ') + ' übernommen: ' + d.names.join(', ') + '. Übernimm ihn nur, wenn du die Waren wirklich noch einmal gekauft hast.' : '';
function renderDup(){ const d = $('#rcDup'); if (d && S.rcpt) { d.textContent = dupText(S.rcpt.dup); d.hidden = !S.rcpt.dup; } }
function updateSave(){ const b = $('#rcSave'), rc = S.rcpt; if (!b || !rc) return; const n = $$('#rcRows input[id^="rcS-"]:checked').length; b.textContent = n ? 'Ausgewählte übernehmen (' + n + ')' : 'Ausgewählte übernehmen'; }

/* ---------- Ereignisse ---------- */
export function onInput(t){
  const rc = S.rcpt; if (!rc || !t.closest || !t.closest('#rcptForm')) return false;
  if (t.id === 'rcDate') rc.dateTouched = true;
  if (t.id === 'rcVendor') rc.vendorTouched = true;
  const m = t.id && t.id.match(/^rc[NAQPK]-(\d+)$/);
  if (m) { syncRows(); const r = rc.rows[+m[1]]; const h = $('#rcH-' + m[1]); if (r && h) h.textContent = lineHint(r); }
  drafts.touch('rcpt');
  return true;
}
export function onChange(t){
  if (t.id === 'rcptCam' || t.id === 'rcptPick') { const file = t.files && t.files[0]; t.value = ''; if (file) drafts.begin(() => open(file)); return true; }
  const rc = S.rcpt; if (!rc || !t.closest || !t.closest('#rcptForm')) return false;
  syncRows();
  if (/^rcT-\d+$/.test(t.id)) { const r = rc.rows[+t.id.slice(4)]; if (r) r.base = baseOf(partOf(r)); render(); }
  else if (/^rcS-\d+$/.test(t.id)) render();
  else if (/^rcB-\d+$/.test(t.id)) { const fs = $('#rcBs-' + t.id.slice(4)); if (fs) fs.hidden = t.value !== 'some'; }
  updateSave(); drafts.touch('rcpt');
  return true;
}
export async function onClick(t){
  const rc = S.rcpt; if (!rc) return false;
  if (t.id === 'rcStop') { if (rc.state === 'reading') { ocr.cancel(); rc.state = 'cancelled'; syncRows(); if (!rc.date) rc.dateState = 'none'; render(); } return true; }
  if (t.id === 'rcRerun') { recognize(rc); return true; }
  if (t.id === 'rcAdd') { syncRows(); rc.rows.push(blankRow()); render(); drafts.touch('rcpt'); const n = $('#rcN-' + (rc.rows.length - 1)); if (n) n.focus(); return true; }
  if (t.id === 'rcCancel') { if (!(S.ops.rcptForm && S.ops.rcptForm.saving)) { parkOp('rcptForm'); close(); } return true; }
  return false;
}

/* ---------- Übernehmen ---------- */
function readRows(){
  const rc = S.rcpt; syncRows();
  const date = rc.date;
  if (!date) throw new VErr($('#rcDate'), 'Kaufdatum fehlt: Es ist auf dem Beleg nicht lesbar. Trag das Datum des Einkaufs ein.');
  if (!isISO(date) || date > todayISO()) throw new VErr($('#rcDate'), 'Gib ein gültiges Kaufdatum an (nicht in der Zukunft).');
  const vendor = str(rc.vendor).slice(0, 80);
  const out = [];
  rc.rows.forEach((r, i) => {
    if (!r.sel) return;
    const el = k => $('#rc' + k + '-' + i), name = str(r.name);
    if (!name) throw new VErr(el('N'), 'Position ' + (i + 1) + ': Bezeichnung fehlt.');
    const q = Number(str(r.qty));
    if (!str(r.qty) || !Number.isInteger(q) || q < 1 || q > 99999) throw new VErr(el('Q'), 'Position ' + (i + 1) + ': Gib die Menge als ganze Zahl an (wie viele Stück bzw. Gebinde ins Lager kommen).');
    const pr = parsePrice(r.price);
    if (pr.err) throw new VErr(el('P'), 'Position ' + (i + 1) + ': ' + pr.err + ' Leer lassen, wenn der Preis nicht bekannt ist.');
    const p = partOf(r);
    if (r.target !== 'new' && !p) throw new VErr(el('T'), 'Position ' + (i + 1) + ': Diesen Artikel gibt es inzwischen nicht mehr. Wähle einen anderen oder „als neuen Artikel anlegen“.');
    if (p && (!r.base || r.base.id !== p.id)) r.base = baseOf(p);
    if (p && (r.base.unit !== (p.unit == null ? null : p.unit) || r.base.pack !== (p.pack == null ? null : p.pack))) {
      /* Einheit oder Gebindegröße inzwischen geändert: nichts speichern, Hinweis; erneutes Übernehmen gilt dem neuen Stand */
      const was = baseText(r.base), now = baseText(p);
      r.base = baseOf(p); render();
      const msg = 'Position ' + (i + 1) + ': „' + p.name + '“ wurde inzwischen geändert (vorher ' + was + ', jetzt ' + now + '). Es wurde nichts gespeichert. Prüfe Menge und Preis und tipp erneut auf „Ausgewählte übernehmen“.';
      const b = $('#rcConflict'); if (b) { b.textContent = msg; b.hidden = false; }
      throw new VErr($('#rcP-' + i) || $('#rcT-' + i), msg);
    }
    const uFix = p && (p.unit === 'piece' || p.unit === 'pack');
    const unit = uFix ? p.unit : r.unit;
    if (pr.cents != null && unit !== 'piece' && unit !== 'pack') throw new VErr(el('U'), 'Position ' + (i + 1) + ': Wähle, ob Menge und Preis pro Stück oder pro Gebinde gelten.');
    const pack = p && p.pack ? p.pack : str(r.pack).slice(0, 40);
    let bike = '', bikes = [];
    if (!p) {
      if (!r.bike) throw new VErr(el('B'), 'Position ' + (i + 1) + ': Wähle, für welche Motorräder der Artikel ist.');
      if (r.bike === 'some') {
        const ids = r.bikes.filter(id => S.bikes[id]).sort();
        if (!ids.length) throw new VErr(el('B'), 'Position ' + (i + 1) + ': Wähle mindestens ein Motorrad aus oder „alle Motorräder“.');
        if (ids.length === 1) bike = ids[0]; else { bike = 'some'; bikes = ids; }
      } else if (r.bike === 'both' || S.bikes[r.bike]) bike = r.bike;
      else throw new VErr(el('B'), 'Position ' + (i + 1) + ': Dieses Motorrad gibt es nicht mehr. Bitte die Zuordnung wählen.');
    } else if (((p.buys || []).length) >= MAX_BUYS) throw new VErr(el('T'), 'Position ' + (i + 1) + ': Für „' + p.name + '“ sind schon ' + MAX_BUYS + ' Einkäufe gespeichert. Weitere lassen sich nicht erfassen.');
    out.push({i, name: name.slice(0, 120), artNo: str(r.artNo).slice(0, 60), qty: q, price: pr.empty ? null : pr.cents, unit: unit === 'piece' || unit === 'pack' ? unit : '', pack, bike, bikes, part: p, base: p ? r.base : null});
  });
  if (!out.length) throw new VErr($('#rcS-0') || $('#rcAdd'), 'Wähle mindestens eine Position aus, die ins Lager soll.');
  const ids = out.filter(x => x.part).map(x => x.part.id);
  if (new Set(ids).size !== ids.length) throw new VErr($('#rcT-' + out.find((x, k) => x.part && ids.indexOf(x.part.id) !== k).i), 'Zwei Positionen füllen denselben Artikel auf. Fasse sie zusammen oder wähle einen anderen Artikel.');
  return {date, vendor, rows: out};
}
export async function submit(busy){
  const rc = S.rcpt; if (!rc) return true;
  if (rc.state === 'reading') throw new VErr($('#rcStop') || $('#rcptForm'), 'Warte, bis die Erkennung fertig ist, oder brich sie ab.');
  /* Bestand inzwischen ersetzt (Sicherung eingespielt, Sicherheitskopie zurückgeholt): der Beleg gehört nicht zum neuen Bestand */
  if (rc.epoch !== (S.epoch || '')) { close(); toast('Die Daten wurden inzwischen ersetzt. Der Beleg wurde nicht übernommen; wähle ihn bei Bedarf neu.'); return true; }
  const v = readRows();
  const sig = canon([rc.id, rc.hash, v.date, v.vendor, v.rows.map(x => [x.name, x.artNo, x.qty, x.price, x.unit, x.pack, x.bike, x.bikes, x.part ? x.part.id : '', x.base ? canon(x.base) : ''])]);
  const o = opFor('rcptForm', '', 'parts', null, sig); if (o.saving) return true;
  if (!o.payload) o.epoch = rc.epoch;   /* der Speicher prüft die Bestandskennung des Belegs, nicht die des Fensters */
  busy(true);
  let r;
  try {
    r = await execOp('rcptForm', o, async () => {
      if (!o.payload) {
        /* Erster Versuch: Belegbild verkleinern und Nutzdaten einfrieren; eine Wiederholung nutzt dieselben Daten */
        let doc = null;
        try { const m = await makeReceiptImage(rc.file); doc = m.doc; o.files = m.files; }
        catch (e) { S.lastErr = e; o.quietFail = true; toast('Das Belegbild konnte nicht gelesen werden. Es wurde nichts gespeichert.'); return 'fail'; }
        const buyOf = x => ({date: v.date, qty: x.qty, price: x.price, unit: x.unit, pack: x.unit === 'pack' ? x.pack : '', vendor: v.vendor, doc, docHash: rc.hash});
        const creates = v.rows.filter(x => !x.part).map(x => Object.assign({id: uid()}, canonDoc('parts', {name: x.name, bike: x.bike, bikes: x.bikes, qty: x.qty, min: 1, created: Date.now(),
          artNo: x.artNo, pack: x.pack, unit: x.unit, price: x.price, buys: [buyOf(x)]})));
        const adjusts = v.rows.filter(x => x.part).map(x => {
          const p = x.part, b = x.base, set = {}, guard = {unit: b.unit, pack: b.pack};
          if (!(b.unit === 'piece' || b.unit === 'pack') && x.unit) set.unit = x.unit;
          if (x.price != null && x.price !== b.price) { set.price = x.price; guard.price = b.price; }
          return {id: p.id, add: x.qty, set, guard, buy: buyOf(x)};
        });
        o.payload = {doc, creates, adjusts, label: 'Beleg'}; o.adj = true; o.label = 'Beleg'; o.quietFail = true;
      }
      return store.sImportR(o.op, {files: o.files, creates: o.payload.creates, adjusts: o.payload.adjusts}, {epoch: o.epoch});
    });
  } finally { busy(false); }
  if (r === 'ok') {
    const n = o.payload.creates.length, m = o.payload.adjusts.length;
    if (S.rcpt === rc) close();
    toast('Beleg übernommen: ' + [n ? n + (n === 1 ? ' Artikel angelegt' : ' Artikel angelegt') : '', m ? m + (m === 1 ? ' Artikel aufgefüllt' : ' Artikel aufgefüllt') : ''].filter(Boolean).join(', ') + '.');
  } else if (r === 'fail') {
    const c = S.lastErr && S.lastErr.code;
    if (c === 'changed' || c === 'not_found') {
      /* Grundlage geändert (z. B. Einheit oder Gebindegröße eines aufzufüllenden Artikels): nichts gespeichert, Eingaben bleiben,
         die Liste zeigt den aktuellen Stand der Artikel */
      await store.reloadAll().catch(() => {});
      if (S.rcpt === rc) {
        syncRows(); render();
        const b = $('#rcConflict'); if (b) { b.textContent = 'Ein Artikel wurde inzwischen in einem anderen Fenster geändert oder entfernt (z. B. Einheit oder Gebindegröße). Es wurde nichts gespeichert. Prüfe die Positionen und tipp erneut auf „Ausgewählte übernehmen“.'; b.hidden = false; }
        drafts.touch('rcpt');
      }
    } else if (S.lastErr && c) toast(errText(S.lastErr) + ' Es wurde nichts gespeichert.');
  }
  return true;
}

/* ---------- Entwurf (Rückfrage bei ungespeicherten Eingaben) ---------- */
export function register(reveal){
  drafts.register({key: 'rcpt', label: 'Beleg', root: () => $('#rcptForm'), extra: () => S.rcpt ? [S.rcpt.id, S.rcpt.rows.length] : '',
    isOpen: () => !!S.rcpt, save: async () => { const f = $('#rcptForm'); return f && !f.hidden ? R.submitForm(f) : true; },
    discard: () => { if (S.ops.rcptForm && S.ops.rcptForm.saving) return; parkOp('rcptForm'); close(); }, reveal});
}
