/* Racebook – Übersicht (Startseite): Zusammenfassung, Motorradkarten, Aktionen.
   Zustände stehen immer als Text da; fehlt die Grundlage, wirkt nichts „in Ordnung“.
   Stunden und Kilometer werden nie zusammengezählt. */
import {esc, fmt} from '../util.js';
import {S, bikeList, bikeName} from '../state.js';
import {bikeStatus, garageSummary, brandOf} from '../domain.js';
import {$, imgTag, hydrate, icon} from '../ui.js';
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
    + '<span class="bc-count"><span class="plate sm">' + (cur == null ? '–' : fmt(cur)) + '<small>' + u + '</small></span><span class="bc-count-l">' + (cur == null ? 'Stand unbekannt' : (u === 'km' ? 'Kilometerstand' : 'Betriebsstunden')) + '</span></span>'
    + '<span class="bc-next">' + next + '</span>'
    + '<span class="bc-foot"><span class="state st-' + st.state + '">' + icon(st.state === 'none' ? 'none' : st.state) + esc(st.text) + '</span>' + unkNote
    + '<span class="bc-defs' + (st.defects ? ' has' : '') + '">' + icon('defects') + esc(defs) + '</span></span>'
    + '</span></a></li>';
}

function summaryHTML(sum){
  const extra = [sum.soon ? plural(sum.soon, 'Wartungspunkt ist', 'Wartungspunkte sind') + ' bald fällig.' : '', sum.unknown ? 'Bei ' + plural(sum.unknown, 'Wartungspunkt', 'Wartungspunkten') + ' fehlt die Grundlage (Stand oder Datum).' : ''].filter(Boolean).join(' ');
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
  parts.push(summaryHTML(garageSummary()));
  parts.push('<h2 class="sr">Motorräder</h2><ul class="cards" id="bikeCards">' + bikes.map(bikeCard).join('') + '</ul>');
  parts.push('<section class="actions" aria-label="Aktionen"><button class="btn" type="button" id="addBikeBtn">' + icon('plus') + 'Motorrad hinzufügen</button>'
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

export function onClick(t, e){
  if (t.dataset.bikecard) { e.preventDefault(); R.navigate({page: 'bike', bike: t.dataset.bikecard, section: 'status'}); return true; }
  if (t.id === 'addBikeBtn') { R.navigate({page: 'add'}); return true; }
  if (t.id === 'actRide') { forBike('Fahrt eintragen für …', id => { R.navigate({page: 'bike', bike: id, section: 'rides'}); R.openForm('rideDetails', 'rAmount'); }); return true; }
  if (t.id === 'actService') { forBike('Wartung eintragen für …', id => { R.navigate({page: 'bike', bike: id, section: 'log'}); R.openForm('logDetails', 'lDate'); }); return true; }
  if (t.id === 'migrateStart') { R.startMigration(); return true; }
  return false;
}
