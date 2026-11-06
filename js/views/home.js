/* Racebook – Übersicht (Startseite): Zusammenfassung, Motorradkarten, Aktionen.
   Zustände stehen immer als Text da; fehlt die Grundlage, wirkt nichts „in Ordnung“.
   Stunden und Kilometer werden nie zusammengezählt. */
import {esc, fmt} from '../util.js';
import {S, bikeList, bikeName} from '../state.js';
import {bikeStatus, garageSummary, brandOf} from '../domain.js';
import {$, $$, imgTag, hydrate, icon, toast, errText} from '../ui.js';
import * as store from '../store.js';
import {flow} from '../ops.js';
import {plateStyle, titleOf} from './bike.js';
import {countText, fmtWhen} from '../backup.js';
import {R} from '../registry.js';

export const brandLabel = b => { const br = brandOf(b); return (br && br.short) || b.brand || 'Motorrad'; };
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

/* Wiederverwendbare Karte für ein Motorrad */
export function bikeCard(b){
  const st = bikeStatus(b), u = st.unit, cur = st.cur;
  const sub = [b.nickname ? bikeName(b) : '', b.year ? 'Baujahr ' + b.year : ''].filter(Boolean).join(', ');
  const photo = b.photo
    ? imgTag(b.photo.thumbId || b.photo.id, '', 'bc-img')
    : '<span class="bc-ph">' + icon('bike') + '<span>' + esc(brandLabel(b)) + '</span></span>';
  let next;
  if (st.state === 'none') next = '<span class="bc-next-v">Keine Wartungspunkte angelegt</span>';
  else if (st.next) next = '<span class="bc-next-l">Nächste Wartung</span><span class="bc-next-v"><b>' + esc(st.next.name) + '</b>: <span class="t-' + st.next.s + '">' + esc(st.next.text) + '</span></span>';
  else next = '<span class="bc-next-l">Nächste Wartung</span><span class="bc-next-v">unbekannt, es fehlt die Grundlage</span>';
  const unkNote = st.unknown && st.state !== 'unk' ? '<span class="bc-unk">' + plural(st.unknown, 'Punkt', 'Punkte') + ' ohne Grundlage</span>' : '';
  const defs = st.defects ? plural(st.defects, 'offener Mangel', 'offene Mängel') + (st.defectsHigh ? ', ' + st.defectsHigh + ' davon hoch' : '') : 'Keine offenen Mängel';
  return '<li><a class="bcard st-' + st.state + '" href="#/bike/' + encodeURIComponent(b.id) + '/status" data-bikecard="' + esc(b.id) + '" style="' + plateStyle(b) + '">'
    + '<span class="bc-photo">' + photo + '</span>'
    + '<span class="bc-body">'
    + '<span class="bc-name">' + esc(titleOf(b)) + '</span>'
    + (sub ? '<span class="bc-sub">' + esc(sub) + '</span>' : '')
    + '<span class="bc-count"><span class="plate sm">' + (cur == null ? '–' : fmt(cur)) + '<small>' + u + '</small></span><span class="bc-count-l">' + (cur == null ? 'Stand unbekannt' : (st.off ? 'Zähleranzeige' : (u === 'km' ? 'Kilometerstand' : 'Betriebsstunden')))
    + (st.off && st.tot != null ? '<span class="bc-total">Gesamt ' + fmt(st.tot) + ' ' + u + '</span>' : '') + '</span></span>'
    + '<span class="bc-next">' + next + '</span>'
    + '<span class="bc-foot"><span class="state st-' + st.state + '">' + icon(st.state === 'none' ? 'none' : st.state) + esc(st.text) + '</span>' + unkNote
    + '<span class="bc-defs' + (st.defects ? ' has' : '') + '">' + icon('defects') + esc(defs) + '</span></span>'
    + '</span></a></li>';
}

function summaryHTML(sum){
  const extra = [sum.soon ? plural(sum.soon, 'Wartungspunkt ist', 'Wartungspunkte sind') + ' bald fällig.' : '', sum.check ? 'Bei ' + plural(sum.check, 'Wartungspunkt', 'Wartungspunkten') + ' passt der Stand nicht zusammen (Wartungsstand prüfen).' : '', sum.unknown ? 'Bei ' + plural(sum.unknown, 'Wartungspunkt', 'Wartungspunkten') + ' fehlt die Grundlage (Stand oder Datum).' : ''].filter(Boolean).join(' ');
  return '<section class="summary" aria-label="Zusammenfassung">'
    + '<div class="sum"><b>' + sum.bikes + '</b><span>' + (sum.bikes === 1 ? 'Motorrad' : 'Motorräder') + '</span></div>'
    + '<div class="sum' + (sum.overdue ? ' is-bad' : '') + '"><b>' + sum.overdue + '</b><span>Wartung überfällig</span></div>'
    + '<div class="sum' + (sum.defects ? ' is-warn' : '') + '"><b>' + sum.defects + '</b><span>' + (sum.defects === 1 ? 'offener Mangel' : 'offene Mängel') + '</span></div>'
    + '</section>' + (extra ? '<p class="sum-note">' + esc(extra) + '</p>' : '');
}
function backupNote(){
  const b = S.backup, seq = S.changeSeq || 0;
  if (!b) return '<p class="note">' + icon('save') + '<span>Noch keine Sicherung erstellt. Deine Daten liegen nur auf diesem Gerät. <a href="#/daten" data-nav="data">Sicherung erstellen</a></span></p>';
  const n = seq - (b.seq || 0);
  if (n > 0) return '<p class="note">' + icon('save') + '<span>' + plural(n, 'Änderung', 'Änderungen') + ' seit der letzten Sicherung vom ' + esc(fmtWhen(b.at)) + '. <a href="#/daten" data-nav="data">Jetzt sichern</a></span></p>';
  return '<p class="note quiet">' + icon('save') + '<span>Letzte Sicherung erstellt: ' + esc(fmtWhen(b.at)) + '. Seitdem keine Änderungen.</span></p>';
}

export function renderHome(){
  const el = $('#homeBody'); if (!el) return;
  if (S.mode !== 'ready' || !S.loaded.bikes) { el.innerHTML = '<p class="hint thinking">Garage wird geladen …</p>'; return; }
  const bikes = bikeList(), parts = [];
  const v8 = S.v8 && S.v8.draft && !(S.migration && S.migration.verified);
  if (!bikes.length) {
    if (v8) parts.push('<section class="card migrate"><h2>Daten der bisherigen Version gefunden</h2><p>Auf diesem Gerät liegen Racebook-Daten aus der bisherigen Version: ' + esc(countText(S.v8.draft.counts)) + '.</p><p class="hint">Sie werden vor der Übernahme geprüft. Die alten Daten bleiben unverändert erhalten, bis du sie selbst entfernst.</p><div class="row"><button class="btn primary" type="button" id="migrateStart">Prüfen und übernehmen</button></div></section>');
    parts.push('<section class="card empty-garage"><h2>Noch keine Motorräder</h2><p>Leg dein erstes Motorrad an oder spiel eine Sicherung ein, zum Beispiel aus der bisherigen Racebook-App in Claude.</p>'
      + '<div class="row"><button class="btn primary" type="button" id="addBikeBtn">' + icon('plus') + 'Motorrad hinzufügen</button><a class="btn" href="#/daten" data-nav="data">Sicherung einspielen</a></div></section>');
    el.innerHTML = parts.join('');
    return;
  }
  if (S.ordering && bikes.length > 1) {
    /* Neu zeichnen, ohne den Tastaturfokus zu verlieren */
    const a = document.activeElement, keep = !focusAfter && a && el.contains(a) ? (a.dataset.handle ? '[data-handle="' + a.dataset.handle + '"]' : a.dataset.ordmv ? '[data-ordmv="' + a.dataset.ordmv + '"]' : a.id ? '#' + a.id : null) : null;
    if (keep) focusAfter = keep;
    el.innerHTML = orderHTML(bikes); restoreFocus(); return;
  }
  S.ordering = false;
  parts.push(summaryHTML(garageSummary()));
  parts.push('<h2 class="sr">Motorräder</h2><ul class="cards" id="bikeCards">' + bikes.map(bikeCard).join('') + '</ul>');
  parts.push('<section class="actions" aria-label="Aktionen"><button class="btn" type="button" id="addBikeBtn">' + icon('plus') + 'Motorrad hinzufügen</button>'
    + (bikes.length > 1 ? '<button class="btn" type="button" id="orderBtn">' + icon('sort') + 'Reihenfolge ändern</button>' : '')
    + '<button class="btn primary" type="button" id="actRide">' + icon('rides') + 'Fahrt eintragen</button>'
    + '<button class="btn primary" type="button" id="actService">' + icon('wrench') + 'Wartung eintragen</button></section>');
  parts.push(backupNote());
  el.innerHTML = parts.join('');
  hydrate(el);
}

/* Aktion für ein Motorrad: bei mehreren erst fragen */
function forBike(title, cb){
  const list = bikeList();
  if (list.length === 1) { cb(list[0].id); return; }
  const dlg = $('#pickDlg');
  $('#pickTitle').textContent = title;
  $('#pickList').innerHTML = list.map(b => '<button class="pick" type="button" data-pick="' + esc(b.id) + '" style="' + plateStyle(b) + '"><span class="pick-dot"></span><span><b>' + esc(titleOf(b)) + '</b>' + (b.nickname ? '<span class="hint"> ' + esc(bikeName(b)) + '</span>' : '') + '</span></button>').join('');
  const done = id => { dlg.close(); if (id) cb(id); };
  $('#pickList').onclick = e => { const t = e.target.closest('[data-pick]'); if (t) done(t.dataset.pick); };
  $('#pickCancel').onclick = () => done(null);
  dlg.showModal();
  const first = $('#pickList .pick'); if (first) first.focus();
}

/* ---------- Reihenfolge ändern (ab 1.2.0) ----------
   Eigene Ansicht ohne Links (keine Karte öffnet sich versehentlich). Verschieben per Ziehgriff (Maus, Finger, Stift),
   per Hoch-/Runter-Knopf oder per Pfeiltasten am Griff. Jede Verschiebung wird sofort gespeichert: nur das Feld order und
   nur, wenn es im Speicher noch den Wert hat, auf dem die angezeigte Reihenfolge beruht (guard). Gleichzeitige Änderungen
   in einem anderen Fenster oder ein inzwischen entferntes Motorrad überschreiben nichts. */
let focusAfter = null;
function orderHTML(bikes){
  const busy = !!S.orderBusy, dis = busy ? ' disabled' : '';
  return '<section class="card order" aria-labelledby="orderTitle"><div class="card-h"><h2 id="orderTitle">Reihenfolge ändern</h2><button class="btn primary" type="button" id="orderDone">Fertig</button></div>'
    + '<p class="hint">Zieh ein Motorrad am Griff an die gewünschte Stelle oder nutz ▲ und ▼. Mit der Tastatur: Griff auswählen, dann Pfeiltaste hoch oder runter. Jede Änderung wird sofort gespeichert.</p>'
    + '<ol class="order-list" id="orderList">' + bikes.map((b, i) => '<li class="order-row" data-oid="' + esc(b.id) + '" style="' + plateStyle(b) + '">'
      + '<span class="handle" tabindex="0" role="button" data-handle="' + esc(b.id) + '" aria-label="' + esc(titleOf(b)) + ', Position ' + (i + 1) + ' von ' + bikes.length + '. Ziehen oder mit Pfeiltasten verschieben.">' + icon('grip') + '</span>'
      + '<span class="order-name"><b>' + esc(titleOf(b)) + '</b>' + (b.nickname ? '<span class="hint"> ' + esc(bikeName(b)) + '</span>' : '') + '</span>'
      + '<button class="mini" type="button" data-ordmv="' + esc(b.id) + ':-1" aria-label="' + esc(titleOf(b)) + ' nach oben"' + (i ? dis : ' disabled') + '>▲</button>'
      + '<button class="mini" type="button" data-ordmv="' + esc(b.id) + ':1" aria-label="' + esc(titleOf(b)) + ' nach unten"' + (i < bikes.length - 1 ? dis : ' disabled') + '>▼</button></li>').join('') + '</ol>'
    + '<p class="sr" aria-live="polite" id="orderLive">' + esc(S.orderMsg || '') + '</p></section>';
}
function restoreFocus(){
  if (!focusAfter) return;
  const sel = focusAfter; focusAfter = null;
  const el = document.querySelector(sel) || document.querySelector(sel.replace(/:-?1"\]$/, ':' + (sel.includes(':-1') ? '1' : '-1') + '"]'));
  if (el && !el.disabled) el.focus(); else { const h = document.querySelector('[data-handle]'); if (h) h.focus(); }
}
async function saveOrder(seq, focusSel){
  const items = [];
  seq.forEach((id, i) => { const raw = store.peek('bikes', id); if (!raw) return; const cur = raw.order === undefined ? null : raw.order; if (cur !== i) items.push({coll: 'bikes', id, patch: {order: i}, guard: {order: cur}}); });
  if (!items.length) { renderHome(); return; }
  S.orderBusy = true; focusAfter = focusSel || null; renderHome();
  const r = await flow(() => store.commitR(items, null, 'reihenfolge', {epoch: S.epoch || ''}));
  S.orderBusy = false;
  if (r === 'ok') S.orderMsg = 'Reihenfolge gespeichert: ' + bikeList().map(titleOf).join(', ') + '.';
  else if (r === 'fail' && S.lastErr && (S.lastErr.code === 'changed' || S.lastErr.code === 'not_found' || S.lastErr.code === 'orphan')) {
    await store.reloadAll().catch(() => {});
    S.orderMsg = '';
    toast('Die Reihenfolge wurde inzwischen in einem anderen Fenster geändert oder ein Motorrad entfernt. Es wurde nichts gespeichert. Bitte prüf die aktuelle Reihenfolge.');
  } else toast(r === 'fail' ? errText(S.lastErr) + ' Die Reihenfolge ist unverändert.' : 'Unklar, ob die Reihenfolge gespeichert wurde. Sie wird gleich neu angezeigt.');
  focusAfter = focusSel || null;
  renderHome();
}
function moveBike(id, d){
  if (S.orderBusy) return;
  const seq = bikeList().map(b => b.id), i = seq.indexOf(id), j = i + d;
  if (i < 0 || j < 0 || j >= seq.length) return;
  seq.splice(i, 1); seq.splice(j, 0, id);
  saveOrder(seq, '[data-ordmv="' + id + ':' + d + '"]');
}
/* Ziehen am Griff (Pointer Events: Maus, Finger, Stift) */
let drag = null;
document.addEventListener('pointerdown', e => {
  const h = e.target.closest && e.target.closest('[data-handle]'); if (!h || S.orderBusy || !S.ordering) return;
  const row = h.closest('.order-row'), list = $('#orderList'); if (!row || !list) return;
  e.preventDefault();
  drag = {id: h.dataset.handle, row, list, pid: e.pointerId, moved: false};
  try { h.setPointerCapture(e.pointerId); } catch (x) {}
  row.classList.add('dragging');
});
document.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.pid) return;
  e.preventDefault();
  const rows = $$('.order-row', drag.list).filter(r => r !== drag.row);
  const after = rows.find(r => { const b = r.getBoundingClientRect(); return e.clientY < b.top + b.height / 2; });
  if (after) { if (after.previousElementSibling !== drag.row) { drag.list.insertBefore(drag.row, after); drag.moved = true; } }
  else if (drag.list.lastElementChild !== drag.row) { drag.list.appendChild(drag.row); drag.moved = true; }
});
const endDrag = e => {
  if (!drag || (e && e.pointerId !== drag.pid)) return;
  const d = drag; drag = null;
  d.row.classList.remove('dragging');
  const seq = $$('.order-row', d.list).map(r => r.dataset.oid);
  if (d.moved && e.type === 'pointerup') saveOrder(seq, '[data-handle="' + d.id + '"]'); else renderHome();
};
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);
document.addEventListener('keydown', e => {
  const h = e.target.closest && e.target.closest('[data-handle]'); if (!h || !S.ordering) return;
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const id = h.dataset.handle, seq = bikeList().map(b => b.id), i = seq.indexOf(id), j = i + (e.key === 'ArrowUp' ? -1 : 1); if (j < 0 || j >= seq.length || S.orderBusy) return; seq.splice(i, 1); seq.splice(j, 0, id); saveOrder(seq, '[data-handle="' + id + '"]'); }
});

export function onClick(t, e){
  if (t.id === 'orderBtn') { R.guard(() => { S.ordering = true; S.orderMsg = ''; renderHome(); const h = document.querySelector('[data-handle]'); if (h) h.focus(); }); return true; }
  if (t.id === 'orderDone') { S.ordering = false; S.orderMsg = ''; renderHome(); const b = $('#orderBtn'); if (b) b.focus(); return true; }
  if (t.dataset.ordmv) { const [id, d] = [t.dataset.ordmv.slice(0, t.dataset.ordmv.lastIndexOf(':')), Number(t.dataset.ordmv.slice(t.dataset.ordmv.lastIndexOf(':') + 1))]; moveBike(id, d); return true; }
  if (t.dataset.bikecard) { e.preventDefault(); if (S.ordering) return true; R.go({page: 'bike', bike: t.dataset.bikecard, section: 'status'}); return true; }
  if (t.id === 'addBikeBtn') { R.go({page: 'add'}); return true; }
  if (t.id === 'actRide') { forBike('Fahrt eintragen für …', id => { R.guard(() => { R.navigate({page: 'bike', bike: id, section: 'rides'}); R.openForm('rideDetails', 'rAmount'); }); }); return true; }
  if (t.id === 'actService') { forBike('Wartung eintragen für …', id => { R.guard(() => { R.navigate({page: 'bike', bike: id, section: 'log'}); R.openForm('logDetails', 'lDate'); }); }); return true; }
  if (t.id === 'migrateStart') { R.startMigration(); return true; }
  return false;
}
