/* Racebook – Auswertung Kosten und Nutzung (ab 1.12.0, Roadmap 7, Auftrag in Issue #5).
   Reine Berechnung aus den gespeicherten Einträgen; es entstehen keine neuen Daten und nichts geht in die Sicherung.
   Kosten:
   - Logbuch: Kosten in Euro je Eintrag (Wartung, Reparatur eines Mangels, Reifen, Kette, Sonstiges). Ohne Kostenangabe
     (null) zählt ein Eintrag nicht als 0 €, sondern wird gesondert genannt; ausdrücklich 0 € zählt als bekannt.
   - Lager: jeder Einkauf (Menge × bezahlter Preis je Einheit) genau einmal, am Einkaufsdatum. Ohne Preis (null) nicht als 0 €.
     Entnahmen aus dem Lager (Verbrauch) sind keine weiteren Kosten. Ein Einkauf gehört nur dann zu einem Motorrad, wenn
     der Artikel genau diesem einen (vorhandenen) Motorrad zugeordnet ist; Artikel für mehrere, alle oder kein Motorrad
     werden nicht verteilt, sondern nur in der Gesamtsicht gesondert ausgewiesen.
   - Keine Kosten pro Stunde oder Kilometer.
   Nutzung: Gesamtlaufleistung (über Zählerwechsel hinweg, deriveBike) am Ende des letzten Tags minus am Ende des Tags vor
   dem Beginn. Ist davor nichts bekannt, zählt ab dem ersten bekannten Stand im Zeitraum (gekennzeichnet). Stunden und
   Kilometer werden nie zusammengezählt. */
import {deriveBike} from './domain.js';
import {U} from './state.js';
import {isISO, pad} from './util.js';

export const ARTS = [['wartung', 'Wartung'], ['reparatur', 'Reparatur'], ['reifen', 'Reifen'], ['kette', 'Kette'], ['sonstiges', 'Sonstiges'], ['lager', 'Teile aus dem Lager']];
export const ART_NAME = Object.fromEntries(ARTS);
/* Kostenart eines Logbucheintrags; null = kein Kostenposten (Stand, Zählerwechsel) */
export const artOfLog = l => l.kind === 'service' ? (l.repairOf ? 'reparatur' : 'wartung') : l.kind === 'tire' ? 'reifen' : l.kind === 'chain' ? 'kette' : l.kind === 'note' ? 'sonstiges' : null;
const r2 = v => Math.round(v * 100) / 100;

/* Zeitraum → {from, to} (beide einschließlich, ISO-Datum) oder null bei ungültiger Angabe.
   {kind: 'month', month: 'JJJJ-MM'} | {kind: 'year', year: 'JJJJ'} | {kind: 'range', from, to} */
export function periodRange(p){
  if (!p) return null;
  if (p.kind === 'month' && /^\d{4}-(0[1-9]|1[0-2])$/.test(p.month || '')) {
    const y = +p.month.slice(0, 4), m = +p.month.slice(5, 7);
    return {from: p.month + '-01', to: p.month + '-' + pad(new Date(Date.UTC(y, m, 0)).getUTCDate())};
  }
  if (p.kind === 'year' && /^\d{4}$/.test(p.year || '')) return {from: p.year + '-01-01', to: p.year + '-12-31'};
  if (p.kind === 'range' && isISO(p.from) && isISO(p.to) && p.from <= p.to) return {from: p.from, to: p.to};
  return null;
}
/* Vortag eines ISO-Datums */
export function dayBefore(iso){
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) - 1));
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

/* Alle Kostenposten. data = {bikes: {id: Motorrad}, log: [...], parts: [...]}.
   Ergebnis je Posten: {src: 'log'|'buy', id, bike (Kennung oder null), art, date, cents (null = unbekannt), qty, label, shared} */
export function costItems(data){
  const out = [];
  (data.log || []).forEach(l => {
    const art = artOfLog(l);
    if (!art || !isISO(l.date)) return;
    /* Eine Notiz ohne Betrag ist kein Kostenposten; Arbeiten ohne Betrag werden als „ohne Kostenangabe“ genannt */
    if (art === 'sonstiges' && l.cost == null) return;
    out.push({src: 'log', id: l.id, bike: l.bike, art, date: l.date, cents: l.cost == null ? null : Math.round(l.cost * 100), qty: null,
      label: l.extra || l.title || l.note || '', shared: ''});
  });
  (data.parts || []).forEach(p => {
    const bikes = p.bike === 'some' ? (Array.isArray(p.bikes) ? p.bikes : []) : p.bike === 'both' ? [] : [p.bike];
    const own = p.bike !== 'both' && bikes.length === 1 && data.bikes && data.bikes[bikes[0]] ? bikes[0] : null;
    const shared = own ? '' : p.bike === 'both' ? 'alle' : bikes.length > 1 ? 'mehrere' : 'keins';
    (p.buys || []).forEach((b, i) => {
      if (!isISO(b.date)) return;
      out.push({src: 'buy', id: p.id + '#' + i, part: p.id, bike: own, art: 'lager', date: b.date, cents: b.price == null ? null : b.price * b.qty, qty: b.qty,
        label: p.name || '', shared});
    });
  });
  return out;
}

/* Kosten im Zeitraum, für ein Motorrad (bike) oder alle (bike = ''). Bekannte Summe in Cent, je Kostenart, je Motorrad,
   gemeinsam zugeordnete Lagereinkäufe (shared), Posten ohne Betrag gesondert. */
export function costSummary(items, range, bike){
  const sel = items.filter(x => x.date >= range.from && x.date <= range.to && (!bike || x.bike === bike));
  const s = {known: 0, byArt: {}, byBike: {}, shared: 0, unknownLog: 0, unknownBuy: 0, unknownBuyQty: 0, items: sel.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) || (a.id < b.id ? -1 : 1))};
  sel.forEach(x => {
    if (x.cents == null) { if (x.src === 'log') s.unknownLog++; else { s.unknownBuy++; s.unknownBuyQty += x.qty || 0; } return; }
    s.known += x.cents;
    s.byArt[x.art] = (s.byArt[x.art] || 0) + x.cents;
    if (x.bike) s.byBike[x.bike] = (s.byBike[x.bike] || 0) + x.cents; else s.shared += x.cents;
  });
  return s;
}

/* Anzahl der Kalendermonate im Zeitraum */
export const monthSpan = range => (+range.to.slice(0, 4) - +range.from.slice(0, 4)) * 12 + (+range.to.slice(5, 7) - +range.from.slice(5, 7)) + 1;
/* Bekannte Kosten je Monat im Zeitraum: [{month: 'JJJJ-MM', cents, unknown}], nach Monat sortiert.
   Bis 24 Monate jeder Monat (auch mit 0 €), bei längeren Zeiträumen nur Monate mit Posten – ohne Obergrenze, damit die
   Monatszeilen zusammen immer die Gesamtsumme ergeben (kein Posten fällt still heraus). */
export function costByMonth(items, range, bike){
  const map = new Map();
  if (monthSpan(range) <= 24) {
    let y = +range.from.slice(0, 4), m = +range.from.slice(5, 7);
    for (let n = monthSpan(range); n > 0; n--) { const k = y + '-' + pad(m); map.set(k, {month: k, cents: 0, unknown: 0}); m++; if (m > 12) { m = 1; y++; } }
  }
  items.forEach(x => {
    if (x.date < range.from || x.date > range.to || (bike && x.bike !== bike)) return;
    const k = x.date.slice(0, 7);
    let o = map.get(k);
    if (!o) { o = {month: k, cents: 0, unknown: 0}; map.set(k, o); }
    if (x.cents == null) o.unknown++; else o.cents += x.cents;
  });
  return Array.from(map.values()).sort((a, b) => a.month < b.month ? -1 : a.month > b.month ? 1 : 0);
}

/* Gefahrene Stunden bzw. Kilometer eines Motorrads im Zeitraum, nur aus Belegtem.
   Messpunkte sind die Ereignisse mit bekannter Gesamtlaufleistung (Stände, Zählerwechsel, Fahrten nach einem bekannten Stand;
   über Zählerwechsel hinweg, deriveBike). Zwischen zwei Messpunkten ist nur die Summe bekannt, nicht wann gefahren wurde:
   - Abschnitt ganz im Zeitraum (vom Ende des Vortags des Beginns bis zum letzten Tag): zählt genau.
   - Abschnitt über den Beginn oder das Ende hinweg: nicht zuordenbar – 0 bis zu seiner ganzen Summe (keine Verteilung).
   - vor dem ersten bzw. nach dem letzten Messpunkt: nichts bekannt („mindestens“).
   Ergebnis: {unit, state: 'ok'|'range'|'unknown'|'unclear', value (belegt), max (Obergrenze oder null), from (erster bekannter
   Stand, wenn davor nichts bekannt ist), until (letzter bekannter Stand, wenn danach nichts bekannt ist), cross: [{v, a, z}]
   nicht zuordenbare Abschnitte, rides: {n, sum}} */
export function usage(b, logs, rides, range){
  const d = deriveBike(b, logs, rides), u = U(b);
  const lo = dayBefore(range.from), hi = range.to;
  const pts = d.ev.filter(e => e.tot != null && isISO(e.date));
  const rs = (rides || []).filter(r => r.bike === b.id && isISO(r.date) && r.date >= range.from && r.date <= range.to && r.amount != null && r.amount > 0);
  const out = {unit: u, state: 'unknown', value: null, max: null, from: null, until: null, cross: [], rides: {n: rs.length, sum: r2(rs.reduce((a, r) => a + r.amount, 0))}};
  let exact = 0, extra = 0, any = false, neg = false;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], z = pts[i + 1], v = r2(z.tot - a.tot);
    /* ganz vor bzw. ganz nach dem Zeitraum. Ein Abschnitt, der am letzten Tag beginnt und endet (mehrere Stände, Fahrten oder
       Zählerwechsel an diesem Tag), liegt im Zeitraum; erst ein Abschnitt vom letzten Stand des letzten Tags zu einem späteren
       Tag liegt danach (wie am Vortag des Beginns: der letzte Stand eines Tags gilt als Stand am Ende dieses Tags). */
    if (z.date <= lo || (a.date >= hi && z.date > hi)) continue;
    any = true; if (v < 0) neg = true;
    if (a.date >= lo && z.date <= hi) exact = r2(exact + v);
    else { extra = r2(extra + v); if (v) out.cross.push({v, a: a.date, z: z.date}); }
  }
  if (!any) return out;
  if (neg) return Object.assign(out, {state: 'unclear'});
  const first = pts[0], last = pts[pts.length - 1];
  out.from = first.date > lo ? first.date : null;
  out.until = last.date < hi ? last.date : null;
  /* Nichts belegt und nach einer Seite offen: keine Zahl, nur die Hinweise (from/until/cross) */
  if (!exact && (out.from || out.until)) return Object.assign(out, {state: 'unknown'});
  out.value = exact;
  if (!out.from && !out.until && !extra) return Object.assign(out, {state: 'ok'});
  out.max = out.from || out.until ? null : r2(exact + extra);
  return Object.assign(out, {state: 'range'});
}
