/* Racebook – Übersicht (Startseite): Zusammenfassung, Motorradkarten (ab 1.7.3 direkt verschiebbar), „Motorrad hinzufügen“.
   Zustände stehen immer als Text da; fehlt die Grundlage, wirkt nichts „in Ordnung“.
   Stunden und Kilometer werden nie zusammengezählt. */
import {esc, fmt} from '../util.js';
import {S, bikeList, bikeName} from '../state.js';
import {bikeStatus, garageSummary, brandOf} from '../domain.js';
import {$, $$, imgTag, hydrate, icon, toast, errText} from '../ui.js';
import * as store from '../store.js';
import {flow} from '../ops.js';
import {plateStyle, titleOf} from './bike.js';
import {countText} from '../backup.js';
import {R} from '../registry.js';

export const brandLabel = b => { const br = brandOf(b); return (br && br.short) || b.brand || 'Motorrad'; };
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

/* Wiederverwendbare Karte für ein Motorrad */
export function bikeCard(b, ord){
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
  return '<li data-bid="' + esc(b.id) + '"><a class="bcard st-' + st.state + '" draggable="false" href="#/bike/' + encodeURIComponent(b.id) + '/status" data-bikecard="' + esc(b.id) + '" style="' + plateStyle(b) + '">'
    + '<span class="bc-photo">' + photo + '</span>'
    + '<span class="bc-body">'
    + '<span class="bc-name">' + esc(titleOf(b)) + '</span>'
    + (sub ? '<span class="bc-sub">' + esc(sub) + '</span>' : '')
    + '<span class="bc-count"><span class="plate sm">' + (cur == null ? '–' : fmt(cur)) + '<small>' + u + '</small></span><span class="bc-count-l">' + (cur == null ? 'Stand unbekannt' : (st.off ? 'Zähleranzeige' : (u === 'km' ? 'Kilometerstand' : 'Betriebsstunden')))
    + (st.off && st.tot != null ? '<span class="bc-total">Gesamt ' + fmt(st.tot) + ' ' + u + '</span>' : '') + '</span></span>'
    + '<span class="bc-next">' + next + '</span>'
    + '<span class="bc-foot"><span class="state st-' + st.state + '">' + icon(st.state === 'none' ? 'none' : st.state) + esc(st.text) + '</span>' + unkNote
    + '<span class="bc-defs' + (st.defects ? ' has' : '') + '">' + icon('defects') + esc(defs) + '</span></span>'
    + '</span></a>'
    + (ord ? '<button class="bc-move" type="button" data-cardmenu="' + esc(b.id) + '" aria-haspopup="dialog" aria-label="Reihenfolge ändern: ' + esc(titleOf(b)) + ', Position ' + (ord.i + 1) + ' von ' + ord.n + '">' + icon('more') + '</button>' : '')
    + '</li>';
}

function summaryHTML(sum){
  const extra = [sum.soon ? plural(sum.soon, 'Wartungspunkt ist', 'Wartungspunkte sind') + ' bald fällig.' : '', sum.check ? 'Bei ' + plural(sum.check, 'Wartungspunkt', 'Wartungspunkten') + ' passt der Stand nicht zusammen (Wartungsstand prüfen).' : '', sum.unknown ? 'Bei ' + plural(sum.unknown, 'Wartungspunkt', 'Wartungspunkten') + ' fehlt die Grundlage (Stand oder Datum).' : ''].filter(Boolean).join(' ');
  return '<section class="summary" aria-label="Zusammenfassung">'
    + '<div class="sum"><b>' + sum.bikes + '</b><span>' + (sum.bikes === 1 ? 'Motorrad' : 'Motorräder') + '</span></div>'
    + '<div class="sum' + (sum.overdue ? ' is-bad' : '') + '"><b>' + sum.overdue + '</b><span>Wartung überfällig</span></div>'
    + '<div class="sum' + (sum.defects ? ' is-warn' : '') + '"><b>' + sum.defects + '</b><span>' + (sum.defects === 1 ? 'offener Mangel' : 'offene Mängel') + '</span></div>'
    + '</section>' + (extra ? '<p class="sum-note">' + esc(extra) + '</p>' : '');
}
export function renderHome(){
  const el = $('#homeBody'); if (!el) return;
  if (drag) { renderLater = true; return; }   /* während eine Karte gezogen wird, nicht neu zeichnen (danach sofort) */
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
  const multi = bikes.length > 1;
  parts.push(summaryHTML(garageSummary()));
  /* ab 1.7.3 (Issue #14): keine globalen Knöpfe „Fahrt eintragen“/„Wartung eintragen“ mehr (Erfassung am Motorrad) und kein
     großer Sicherungshinweis unten (Status oben in der Kopfleiste, Daten & Sicherung über „Mehr“). Reihenfolge direkt an den
     Karten: lange drücken und ziehen oder die drei Punkte an der Karte. */
  const cards = shown(); shownOrders = {}; cards.forEach(b => { shownOrders[b.id] = b.order == null ? null : b.order; });
  parts.push('<h2 class="sr">Motorräder</h2><ul class="cards" id="bikeCards">' + cards.map((b, i) => bikeCard(b, multi ? {i, n: bikes.length} : null)).join('') + '</ul>');
  if (multi) parts.push('<p class="hint reorder-hint" id="reorderHint">Reihenfolge ändern: Karte lange drücken und ziehen – oder die drei Punkte an der Karte antippen.</p>');
  parts.push('<p class="sr" aria-live="polite" id="orderLive">' + esc(S.orderMsg || '') + '</p>');
  parts.push('<section class="actions" aria-label="Aktionen"><button class="btn" type="button" id="addBikeBtn">' + icon('plus') + 'Motorrad hinzufügen</button></section>');
  el.innerHTML = parts.join('');
  el.classList.toggle('order-busy', !!S.orderBusy);
  hydrate(el);
  if (focusAfter) { const f = document.querySelector(focusAfter); focusAfter = null; if (f) f.focus(); }
}

/* ---------- Reihenfolge der Karten (ab 1.7.3, Issue #14; vorher eigene Ansicht „Reihenfolge ändern“ ab 1.2.0) ----------
   Jede Verschiebung wird beim Loslassen bzw. beim Tippen auf „Nach oben“/„Nach unten“ gespeichert: nur das Feld order und nur,
   wenn es im Speicher noch den Wert hat, auf dem die angezeigte Reihenfolge beruht (guard), mit der Bestandskennung (epoch).
   Gleichzeitige Änderungen in einem anderen Fenster oder ein inzwischen entferntes Motorrad überschreiben nichts. */
let focusAfter = null, renderLater = false, shownSeq = null;
/* Plätze der Karten, wie sie zuletzt angezeigt wurden: Grundlage einer Geste. Während gezogen wird, zeichnet die Garage nicht neu;
   übernimmt der Speicher inzwischen eine Änderung aus einem anderen Fenster, prüft das Speichern trotzdem gegen das, was zu sehen war
   (Befund P2 in PR #19) – sonst würde die veraltete Liste die neue Reihenfolge überschreiben */
let shownOrders = {};
/* Während des Speicherns die neue Reihenfolge zeigen (die Karte springt nicht bis zur Bestätigung an die alte Stelle zurück);
   danach gilt wieder, was im Speicher steht */
function shown(){
  const list = bikeList(); if (!shownSeq) return list;
  const pos = id => { const i = shownSeq.indexOf(id); return i < 0 ? 1e6 : i; };
  return list.slice().sort((a, b) => pos(a.id) - pos(b.id));
}
const say = m => { S.orderMsg = m; const l = $('#orderLive'); if (l) l.textContent = m; };
const CONFLICT = 'Die Reihenfolge wurde inzwischen in einem anderen Fenster geändert oder ein Motorrad entfernt. Es wurde nichts gespeichert. Bitte prüf die aktuelle Reihenfolge.';
const STALE = () => errText({code: 'stale'}) + ' Die Reihenfolge ist unverändert.';
async function saveOrder(seq, focusSel, base, epoch){
  /* Bestandskennung, zu der der Vorgang gehört: bei einer Geste die beim Aufnehmen der Karte. Wurde der Bestand inzwischen ersetzt
     (Sicherung eingespielt, auch in einem anderen Fenster), nichts speichern (Befund P2 in PR #19, dritte Prüfung) */
  const ep = typeof epoch === 'string' ? epoch : (S.epoch || '');
  if (ep !== (S.epoch || '')) {
    await store.reloadAll().catch(() => {});
    say(''); toast(STALE()); focusAfter = focusSel || null; renderHome(); renderMenu();
    return false;
  }
  /* Ist eine der angezeigten Karten inzwischen entfernt (z. B. in einem anderen Fenster während der Geste), nichts speichern –
     auch nicht die übrigen (Befund P2 in PR #19, zweite Prüfung); die verbleibende Reihenfolge bleibt und wird angezeigt */
  if (seq.some(id => !store.peek('bikes', id))) {
    await store.reloadAll().catch(() => {});
    say(''); toast(CONFLICT); focusAfter = focusSel || null; renderHome(); renderMenu();
    return false;
  }
  /* Alle angezeigten Karten prüfen, auch die, die an ihrer Stelle bleiben (leerer patch): hat ein anderes Fenster
     die Reihenfolge inzwischen geändert, wird nichts gespeichert, statt sie teilweise zu überschreiben */
  const items = []; let moved = 0;
  seq.forEach((id, i) => { const raw = store.peek('bikes', id);
    const cur = base && Object.prototype.hasOwnProperty.call(base, id) ? base[id] : raw.order === undefined ? null : raw.order;
    if (cur !== i) moved++; items.push({coll: 'bikes', id, patch: cur !== i ? {order: i} : {}, guard: {order: cur}}); });
  if (!moved) { renderHome(); return true; }
  S.orderBusy = true; shownSeq = seq.slice(); focusAfter = focusSel || null; renderHome(); renderMenu();
  const r = await flow(() => store.commitR(items, null, 'reihenfolge', {epoch: ep}));
  S.orderBusy = false; shownSeq = null;
  if (r === 'ok') say('Reihenfolge gespeichert: ' + bikeList().map(titleOf).join(', ') + '.');
  else if (r === 'fail' && S.lastErr && (S.lastErr.code === 'changed' || S.lastErr.code === 'not_found' || S.lastErr.code === 'orphan' || S.lastErr.code === 'stale')) {
    const stale = S.lastErr.code === 'stale';
    await store.reloadAll().catch(() => {});
    say('');
    toast(stale ? STALE() : CONFLICT);
  } else toast(r === 'fail' ? errText(S.lastErr) + ' Die Reihenfolge ist unverändert.' : 'Unklar, ob die Reihenfolge gespeichert wurde. Sie wird gleich neu angezeigt.');
  focusAfter = focusSel || null;
  renderHome(); renderMenu();
  return r === 'ok';
}
function moveBike(id, d, focusSel){
  if (S.orderBusy) return;
  const seq = bikeList().map(b => b.id), i = seq.indexOf(id), j = i + d;
  if (i < 0 || j < 0 || j >= seq.length) return;
  seq.splice(i, 1); seq.splice(j, 0, id);
  saveOrder(seq, focusSel);
}

/* Zugängliche Alternative zur Geste: die drei Punkte an der Karte öffnen „Nach oben“/„Nach unten“ (Tastatur, Bildschirmleser, Schaltersteuerung) */
let menuId = '';
function renderMenu(){
  const dlg = $('#cardMenuDlg'); if (!dlg || !dlg.open) return;
  const list = shown(), i = list.findIndex(b => b.id === menuId), b = list[i];
  if (!b) { dlg.close(); return; }
  $('#cardMenuTitle').textContent = 'Reihenfolge: ' + titleOf(b);
  $('#cardMenuPos').textContent = 'Position ' + (i + 1) + ' von ' + list.length + '.';
  $('#cardUp').disabled = !!S.orderBusy || i === 0;
  $('#cardDown').disabled = !!S.orderBusy || i === list.length - 1;
}
function openMenu(id){
  const dlg = $('#cardMenuDlg'); if (!dlg || !S.bikes[id]) return;
  menuId = id; dlg.showModal(); renderMenu();
  const f = !$('#cardUp').disabled ? $('#cardUp') : !$('#cardDown').disabled ? $('#cardDown') : $('#cardMenuClose'); f.focus();
}
document.addEventListener('close', e => {
  if (e.target && e.target.id === 'cardMenuDlg' && menuId) { const b = document.querySelector('[data-cardmenu="' + CSS.escape(menuId) + '"]'); menuId = ''; if (b) b.focus(); }
}, true);

/* Lange drücken und ziehen (Pointer Events: Finger, Maus, Stift). Kurzes Antippen öffnet das Motorrad wie bisher; bewegt sich der
   Finger vor Ablauf der Haltezeit, scrollt die Seite normal. Beim Ziehen scrollt die Seite am Rand mit. Abbruch (Esc, Unterbrechung
   durch den Browser, Loslassen außerhalb der Liste) stellt die vorherige Reihenfolge wieder her und speichert nichts. */
const HOLD = 450, SLOP = 10, EDGE = 72;
let press = null, drag = null, eatClick = false, scrollRaf = 0;
const cardIds = list => $$(':scope > li', list).map(li => li.dataset.bid);
const cardOf = (list, bid) => Array.from(list.children).find(x => x.dataset.bid === bid) || null;
function cancelPress(){ if (press) { clearTimeout(press.t); press = null; } }
document.addEventListener('pointerdown', e => {
  const card = e.target.closest && e.target.closest('#bikeCards .bcard');
  if (!card || e.button > 0 || S.orderBusy || drag || R.route.page !== 'home' || bikeList().length < 2) return;
  const li = card.closest('li'); if (!li) return;
  cancelPress();
  press = {bid: li.dataset.bid, pid: e.pointerId, x: e.clientX, y: e.clientY, t: setTimeout(startDrag, HOLD)};
});
function startDrag(){
  if (!press) return;
  const p = press; press = null;
  /* die Karte über ihre Kennung holen: die Liste kann während des Haltens neu gezeichnet worden sein */
  const list = $('#bikeCards'), li = list ? cardOf(list, p.bid) : null; if (!li || R.route.page !== 'home') return;
  drag = {li, list, pid: p.pid, x: p.x, y: p.y, before: cardIds(list), base: Object.assign({}, shownOrders), epoch: S.epoch || ''};
  eatClick = true;
  li.classList.add('dragging'); list.classList.add('drag-active'); document.body.classList.add('card-drag');
  try { if (navigator.vibrate) navigator.vibrate(12); } catch (x) {}
  say('Verschieben: ' + titleOf(S.bikes[p.bid] || {}) + '. Loslassen speichert die neue Stelle.');
  scrollLoop();
}
function place(){
  if (!drag) return;
  const others = $$(':scope > li', drag.list).filter(li => li !== drag.li);
  const target = others.find(li => { const r = li.getBoundingClientRect(), cy = r.top + r.height / 2;
    return drag.y < r.top || (drag.y <= r.bottom && (drag.y < cy - r.height / 4 || (Math.abs(drag.y - cy) <= r.height / 4 && drag.x < r.left + r.width / 2))); });
  if (target) { if (target.previousElementSibling !== drag.li) drag.list.insertBefore(drag.li, target); }
  else if (drag.list.lastElementChild !== drag.li) drag.list.appendChild(drag.li);
}
function scrollLoop(){
  cancelAnimationFrame(scrollRaf);
  if (!drag) return;
  const bar = $('#tabs'), bottom = innerHeight - (bar && !bar.hidden ? bar.getBoundingClientRect().height : 0);
  const v = drag.y < EDGE ? -Math.ceil((EDGE - drag.y) / 4) : drag.y > bottom - EDGE ? Math.ceil((drag.y - (bottom - EDGE)) / 4) : 0;   /* je näher am Rand, desto schneller */
  if (v) { window.scrollBy(0, v); place(); }
  scrollRaf = requestAnimationFrame(scrollLoop);
}
document.addEventListener('pointermove', e => {
  if (press && e.pointerId === press.pid && Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP) cancelPress();
  if (!drag || e.pointerId !== drag.pid) return;
  e.preventDefault();
  drag.x = e.clientX; drag.y = e.clientY; place();
}, {passive: false});
/* Solange gezogen wird, scrollt der Finger die Seite nicht (die Seite scrollt am Rand selbst mit) */
document.addEventListener('touchmove', e => { if (drag && e.cancelable) e.preventDefault(); }, {passive: false});
/* Links und Bilder lassen sich sonst mit der Maus als Datei/Adresse wegziehen (Drag-and-drop des Browsers bricht das Verschieben ab) */
document.addEventListener('dragstart', e => { if (e.target.closest && e.target.closest('#bikeCards')) e.preventDefault(); });
/* Lange drücken auf einem Link öffnet sonst das Kontextmenü des Browsers */
document.addEventListener('contextmenu', e => { if ((press || drag) && e.target.closest && e.target.closest('#bikeCards')) e.preventDefault(); });
function endDrag(save){
  const d = drag; drag = null; cancelAnimationFrame(scrollRaf);
  d.li.classList.remove('dragging'); d.list.classList.remove('drag-active'); document.body.classList.remove('card-drag');
  setTimeout(() => { eatClick = false; }, 450);
  const seq = cardIds(d.list), changed = seq.join('|') !== d.before.join('|');
  renderLater = false;
  if (save && changed) saveOrder(seq, null, d.base, d.epoch);
  else { if (changed) say('Verschieben abgebrochen. Die Reihenfolge ist unverändert.'); else say(''); renderHome(); }
}
document.addEventListener('pointerup', e => {
  if (press && e.pointerId === press.pid) cancelPress();
  if (!drag || e.pointerId !== drag.pid) return;
  const r = drag.list.getBoundingClientRect(), inside = e.clientY >= r.top - 48 && e.clientY <= r.bottom + 48 && e.clientX >= r.left - 48 && e.clientX <= r.right + 48;
  endDrag(inside);
});
document.addEventListener('pointercancel', e => {
  if (press && e.pointerId === press.pid) cancelPress();
  if (drag && e.pointerId === drag.pid) endDrag(false);
});
document.addEventListener('keydown', e => { if (drag && e.key === 'Escape') { e.preventDefault(); endDrag(false); } });
/* Nach dem Ziehen keinen Klick auslösen (die Karte ist ein Link) */
document.addEventListener('click', e => { if (eatClick && e.target.closest && e.target.closest('#bikeCards')) { e.preventDefault(); e.stopPropagation(); eatClick = false; } }, true);

export function onClick(t, e){
  if (t.dataset.cardmenu) { e.preventDefault(); openMenu(t.dataset.cardmenu); return true; }
  if (t.id === 'cardUp' || t.id === 'cardDown') { if (menuId) moveBike(menuId, t.id === 'cardUp' ? -1 : 1, '#' + t.id); return true; }
  if (t.id === 'cardMenuClose') { $('#cardMenuDlg').close(); return true; }
  if (t.dataset.bikecard) { e.preventDefault(); if (drag || eatClick) return true; R.go({page: 'bike', bike: t.dataset.bikecard, section: 'status'}); return true; }
  if (t.id === 'addBikeBtn') { R.go({page: 'add'}); return true; }
  if (t.id === 'migrateStart') { R.startMigration(); return true; }
  return false;
}
