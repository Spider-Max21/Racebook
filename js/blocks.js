/* Racebook – Inhalte der Bausteine auf der Startseite „Meine Garage“ (ab 1.14.0, Roadmap 11). Reine Berechnung aus dem geladenen
   Bestand; es entstehen keine neuen Daten. Fehlt eine Grundlage, steht das im Ergebnis (nichts wird geschätzt oder als 0 gezählt).
   Auswahl und Reihenfolge der Bausteine: ./dashboard.js. */
import {S, bikeList} from './state.js';
import {sortedItems, pillText, STATE_RANK} from './domain.js';
import {isISO, todayISO} from './util.js';
import * as st from './stats.js';
import * as T from './tracks.js';

/* ---------- Inhalte ---------- */
const bikesOf = () => bikeList();

/* Fällige Wartung: alle Punkte mit Zustand überfällig, prüfen oder bald fällig, dringendste zuerst (je Zustand in der Reihenfolge
   der Garage). Dazu, wie viele Punkte ohne Grundlage sind und wie viele Motorräder keine Wartungspunkte haben – nichts davon
   gilt als „in Ordnung“. */
export function dueOf(){
  const out = {list: [], unknown: 0, none: 0, ok: 0, total: 0};
  const bikes = bikesOf(), ord = new Map(bikes.map((b, i) => [b.id, i]));
  bikes.forEach(b => {
    const items = sortedItems(b);
    if (!items.length) { out.none++; return; }
    items.forEach(x => {
      out.total++;
      if (x.st.s === 'unk') out.unknown++;
      else if (x.st.s === 'ok') out.ok++;
      else out.list.push({bike: b.id, item: x.it.id, name: x.it.name, s: x.st.s, text: pillText(b, x.st), f: x.st.f});
    });
  });
  out.list.sort((a, b) => (STATE_RANK[a.s] - STATE_RANK[b.s]) || (ord.get(a.bike) - ord.get(b.bike)) || ((a.f == null ? 0 : a.f) - (b.f == null ? 0 : b.f)));
  return out;
}

/* Offene Mängel aller Motorräder: hohe Priorität zuerst, dann neuere zuerst */
const PRIO = {high: 0, mid: 1, low: 2};
export function defectsOf(){
  return S.defects.filter(d => d.status !== 'done' && S.bikes[d.bike])
    .sort((x, y) => ((PRIO[x.priority] == null ? 1 : PRIO[x.priority]) - (PRIO[y.priority] == null ? 1 : PRIO[y.priority])) || (y.date || '').localeCompare(x.date || '') || ((y.created || 0) - (x.created || 0)));
}

/* Kosten im laufenden Monat und im laufenden Jahr, alle Motorräder (Berechnung wie die Seite „Auswertung“).
   n = Posten im Zeitraum (auch ohne Betrag), withAmount = davon mit Betrag. Ohne Posten mit Betrag gibt es keine Summe
   („nichts erfasst“ bzw. „kein Betrag bekannt“ statt „0 €“); ausdrücklich 0 € zählt als bekannt. */
export function costsOf(day){
  const t = isISO(day) ? day : todayISO();
  const items = st.costItems({bikes: S.bikes, log: S.log, parts: S.parts});
  const one = range => { const s = st.costSummary(items, range, ''); return {range, known: s.known, n: s.items.length, withAmount: s.items.filter(x => x.cents != null).length, unknownLog: s.unknownLog, unknownBuy: s.unknownBuy, byBike: s.byBike, shared: s.shared}; };
  return {month: one(st.periodRange({kind: 'month', month: t.slice(0, 7)})), year: one(st.periodRange({kind: 'year', year: t.slice(0, 4)}))};
}

/* Nutzung im laufenden Jahr je Motorrad (über Zählerwechsel hinweg, wie die Seite „Auswertung“); nie über Motorräder summiert */
export function usageOf(day){
  const t = isISO(day) ? day : todayISO(), range = st.periodRange({kind: 'year', year: t.slice(0, 4)});
  return {range, bikes: bikesOf().map(b => ({bike: b.id, u: st.usage(b, S.log, S.rides, range)}))};
}

/* Letzte Fahrten aller Motorräder: neuestes Datum zuerst, am selben Tag die zuletzt eingetragene zuerst */
export function ridesOf(){
  return S.rides.filter(r => S.bikes[r.bike] && isISO(r.date))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || ((b.created || 0) - (a.created || 0)));
}

/* Lieblingsstrecken (nur ausdrücklich markierte) mit Besuchen und Bestzeit je Variante, zuletzt besuchte zuerst.
   Ohne Markierung: die zuletzt besuchte Strecke als Hinweis (nicht als Favorit). */
export function favTracksOf(){
  const all = T.trackList({bikes: S.bikes, rides: S.rides, setups: S.setups, fav: S.tracks || null});
  const fav = all.filter(t => t.fav).sort((a, b) => (b.last || '').localeCompare(a.last || '') || a.name.localeCompare(b.name, 'de'));
  const visited = all.filter(t => t.last).sort((a, b) => b.last.localeCompare(a.last) || a.name.localeCompare(b.name, 'de'));
  return {fav, last: visited[0] || null, count: all.length};
}

/* Nachzukaufen: Bestand höchstens Nachkaufgrenze (wie „Nur nachzukaufen“ im Lager), nach Name */
export function stockOf(){
  return S.parts.filter(p => p.qty <= p.min).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de'));
}
