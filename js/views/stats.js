/* Racebook – Auswertung „Kosten und Nutzung“ (ab 1.12.0, Roadmap 7). Berechnung in ../stats.js.
   Die Auswahl (Motorrad, Monat/Jahr/Zeitraum) gilt nur für dieses Gerät (localStorage), sie ist keine Eingabe, die gespeichert
   werden müsste (data-nodirty). Die Bedienelemente bleiben beim Neuzeichnen stehen; neu gezeichnet wird nur das Ergebnis. */
import {esc, fmt, fmtDate, todayISO} from '../util.js';
import {S, bikeList, lsJSON, lsSet} from '../state.js';
import {$} from '../ui.js';
import * as st from '../stats.js';

const titleOf = b => b.nickname || ((b.brand || '') + ' ' + (b.model || '')).trim() || 'Motorrad';
export const euro = c => (c / 100).toLocaleString('de-DE', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + ' €';
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const monthName = k => MONTHS[+k.slice(5, 7) - 1] + ' ' + k.slice(0, 4);
const SHARED = {alle: 'allen Motorrädern', mehrere: 'mehreren Motorrädern', keins: 'keinem Motorrad'};

function choice(){
  const t = todayISO();
  const c = Object.assign({bike: '', kind: 'year', month: t.slice(0, 7), year: t.slice(0, 4), from: t.slice(0, 4) + '-01-01', to: t}, lsJSON('auswertung', {}) || {});
  if (c.bike && !S.bikes[c.bike]) c.bike = '';
  if (!['month', 'year', 'range'].includes(c.kind)) c.kind = 'year';
  return c;
}
/* Jahre zur Auswahl: aus den Daten und das laufende Jahr */
function years(){
  const ys = new Set([todayISO().slice(0, 4)]);
  S.log.forEach(l => { if (l.date) ys.add(l.date.slice(0, 4)); });
  S.parts.forEach(p => (p.buys || []).forEach(b => { if (b.date) ys.add(b.date.slice(0, 4)); }));
  S.rides.forEach(r => { if (r.date) ys.add(r.date.slice(0, 4)); });
  return Array.from(ys).filter(y => /^\d{4}$/.test(y)).sort().reverse();
}
const setHTML = (el, html) => { if (el && el.innerHTML !== html) el.innerHTML = html; };

export function renderStats(){
  const box = $('#statsOut'); if (!box) return;
  const c = choice(), bikes = bikeList();
  setHTML($('#stBike'), '<option value="">Alle Motorräder</option>' + bikes.map(b => '<option value="' + esc(b.id) + '">' + esc(titleOf(b)) + '</option>').join(''));
  setHTML($('#stYear'), years().map(y => '<option value="' + y + '">' + y + '</option>').join(''));
  const set = (id, v) => { const el = $('#' + id); if (el && document.activeElement !== el && el.value !== v) el.value = v; };
  set('stBike', c.bike); set('stKind', c.kind); set('stMonth', c.month); set('stYear', c.year); set('stFrom', c.from); set('stTo', c.to);
  $('#stMonthF').hidden = c.kind !== 'month'; $('#stYearF').hidden = c.kind !== 'year'; $('#stRangeF').hidden = c.kind !== 'range';
  const range = st.periodRange(c);
  if (!range) { setHTML(box, '<p class="warnbox" id="statsInvalid">Bitte einen gültigen Zeitraum wählen' + (c.kind === 'range' ? ' (Beginn nicht nach dem Ende).' : '.') + '</p>'); return; }
  const items = st.costItems({bikes: S.bikes, log: S.log, parts: S.parts});
  const sum = st.costSummary(items, range, c.bike);
  const b = c.bike ? S.bikes[c.bike] : null;
  const when = c.kind === 'month' ? monthName(c.month) : c.kind === 'year' ? 'Jahr ' + c.year : fmtDate(range.from) + ' bis ' + fmtDate(range.to);
  let h = '<div class="card stats-card" id="statsCosts"><h2>Kosten</h2><p class="hint" id="statsWhat">' + esc(b ? titleOf(b) : 'Alle Motorräder') + ' · ' + esc(when) + '</p>'
    + '<p class="stats-total"><b id="statsTotal">' + euro(sum.known) + '</b> <span>bekannte Kosten</span></p>';
  const arts = st.ARTS.filter(([k]) => sum.byArt[k] != null);
  if (arts.length) h += '<table class="stats-tab" id="statsArts"><caption>Nach Kostenart</caption><tbody>' + arts.map(([k, n]) => '<tr data-art="' + k + '"><th scope="row">' + esc(n) + '</th><td>' + euro(sum.byArt[k]) + '</td></tr>').join('') + '</tbody></table>';
  if (!b) {
    const rows = bikes.filter(x => sum.byBike[x.id] != null).map(x => '<tr data-bike="' + esc(x.id) + '"><th scope="row">' + esc(titleOf(x)) + '</th><td>' + euro(sum.byBike[x.id]) + '</td></tr>');
    if (sum.shared) rows.push('<tr data-bike="shared"><th scope="row">Lager, mehreren, allen oder keinem Motorrad zugeordnet</th><td>' + euro(sum.shared) + '</td></tr>');
    if (rows.length) h += '<table class="stats-tab" id="statsBikes"><caption>Je Motorrad</caption><tbody>' + rows.join('') + '</tbody></table>';
  }
  const notes = [];
  if (sum.unknownLog) notes.push((sum.unknownLog === 1 ? 'Eine Arbeit' : sum.unknownLog + ' Arbeiten') + ' ohne Kostenangabe – nicht mitgezählt (nicht als 0 €).');
  if (sum.unknownBuy) notes.push((sum.unknownBuy === 1 ? 'Ein Einkauf' : sum.unknownBuy + ' Einkäufe') + ' ohne Preis (' + sum.unknownBuyQty + ' Stück bzw. Gebinde) – nicht mitgezählt.');
  notes.push('Lagereinkäufe zählen einmal am Einkaufsdatum; Entnahmen aus dem Lager sind keine weiteren Kosten.');
  if (b) notes.push('Lagereinkäufe zählen hier nur, wenn der Artikel allein diesem Motorrad zugeordnet ist. Artikel für mehrere oder alle Motorräder werden nicht aufgeteilt; sie stehen unter „Alle Motorräder“.');
  h += '<ul class="hint stats-notes" id="statsNotes">' + notes.map(n => '<li>' + esc(n) + '</li>').join('') + '</ul>';
  /* Bis 24 Monate jeder Monat (auch mit 0 €), bei längeren Zeiträumen nur Monate mit Posten; zusammen immer die Gesamtsumme */
  const months = st.costByMonth(items, range, c.bike), full = st.monthSpan(range) <= 24;
  if (st.monthSpan(range) > 1 && months.length) h += '<details class="stats-more" id="statsMonths"><summary>Je Monat' + (full ? '' : ' (nur Monate mit Posten)') + '</summary><table class="stats-tab"><tbody>' + months.map(m => '<tr data-month="' + m.month + '"><th scope="row">' + esc(monthName(m.month)) + '</th><td>' + euro(m.cents) + (m.unknown ? ' <span class="hint">+ ' + m.unknown + ' ohne Betrag</span>' : '') + '</td></tr>').join('') + '</tbody></table></details>';
  if (sum.items.length) h += '<details class="stats-more" id="statsItems"><summary>Einzelne Posten (' + sum.items.length + ')</summary><ul class="stats-list">' + sum.items.map(x => {
    const bk = x.bike && S.bikes[x.bike] ? titleOf(S.bikes[x.bike]) : x.src === 'buy' ? 'Lager, ' + SHARED[x.shared] + ' zugeordnet' : '';
    const what = x.src === 'buy' ? (x.label || 'Lagerartikel') + ', ' + x.qty + '×' : (x.label || st.ART_NAME[x.art]);
    return '<li data-item="' + esc(x.id) + '"><span>' + fmtDate(x.date) + ' · ' + esc(st.ART_NAME[x.art]) + (b ? '' : ' · ' + esc(bk)) + '<br>' + esc(what) + '</span><b>' + (x.cents == null ? 'ohne Betrag' : euro(x.cents)) + '</b></li>';
  }).join('') + '</ul></details>';
  h += '</div>';
  /* Nutzung je Motorrad – Stunden und Kilometer werden nie zusammengezählt; keine Kosten pro Stunde */
  const ub = b ? [b] : bikes;
  h += '<div class="card stats-card" id="statsUse"><h2>Nutzung</h2><p class="hint">Gefahren im Zeitraum, über Zählerwechsel hinweg (Gesamtlaufleistung). Gezählt wird nur, was zwischen zwei bekannten Ständen im Zeitraum liegt; liegt zwischen zwei Ständen der Beginn oder das Ende des Zeitraums, ist offen, wann gefahren wurde.</p>';
  if (!ub.length) h += '<p class="hint">Noch kein Motorrad angelegt.</p>';
  else h += '<table class="stats-tab" id="statsUsage"><tbody>' + ub.map(x => {
    const u = st.usage(x, S.log, S.rides, range), {val, notes} = usageText(u);
    return '<tr data-bike="' + esc(x.id) + '" data-state="' + u.state + '"><th scope="row">' + esc(titleOf(x)) + '</th><td><b>' + esc(val) + '</b>' + (notes.length ? '<br><span class="hint">' + esc(notes.join('; ')) + '</span>' : '') + '</td></tr>';
  }).join('') + '</tbody></table>';
  h += '</div>';
  setHTML(box, h);
}

/* Nutzung als Text (auch für die Startseite, ab 1.14.0): Wert nur aus Belegtem („mindestens“, „bis“, „unbekannt“, „unklar“) und Hinweise */
export function usageText(u){
  const unit = u.unit === 'km' ? 'km' : 'h', n = v => fmt(v, 2) + ' ' + unit;
  const val = u.state === 'ok' ? n(u.value) : u.state === 'range' ? (u.max != null ? fmt(u.value, 2) + ' bis ' + n(u.max) : 'mindestens ' + n(u.value)) : u.state === 'unclear' ? 'unklar' : 'unbekannt';
  const notes = [];
  if (u.state === 'unclear') notes.push('Stand wurde nach unten berichtigt');
  else {
    if (u.from) notes.push('vor dem ersten bekannten Stand am ' + fmtDate(u.from) + ' ist nichts bekannt');
    if (u.until) notes.push('nach dem letzten bekannten Stand am ' + fmtDate(u.until) + ' ist nichts bekannt');
    u.cross.forEach(g => notes.push(n(g.v) + ' zwischen ' + fmtDate(g.a) + ' und ' + fmtDate(g.z) + ' lassen sich nicht genauer zuordnen'));
    if (u.state === 'unknown' && !notes.length) notes.push('zu wenige bekannte Stände');
  }
  if (u.rides.n) notes.push('in Fahrten erfasst: ' + n(u.rides.sum) + ' (' + u.rides.n + (u.rides.n === 1 ? ' Fahrt' : ' Fahrten') + ')');
  return {val, notes};
}

/* Auswahl geändert: merken (nur auf diesem Gerät) und neu zeichnen */
export function onInput(t){
  if (!t || !t.closest || !t.closest('#statsForm')) return false;
  const c = choice();
  const map = {stBike: 'bike', stKind: 'kind', stMonth: 'month', stYear: 'year', stFrom: 'from', stTo: 'to'};
  if (!map[t.id]) return false;
  c[map[t.id]] = t.value || '';
  lsSet('auswertung', JSON.stringify(c));
  renderStats();
  return true;
}
