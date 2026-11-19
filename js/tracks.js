/* Racebook – Strecken, Besuche und Bestzeiten (ab 1.13.0, Roadmap 8, Auftrag in Issue #5).
   Reine Berechnung und Prüfung, ohne Oberfläche und ohne Speicher.
   - Strecke: der Name aus Fahrten, Setups und Bestzeiten. Namen, die sich nur in Groß-/Kleinschreibung oder Leerzeichen
     unterscheiden, sind dieselbe Strecke; sonst wird nichts zusammengelegt (keine Ähnlichkeitssuche).
   - Fahrt: ein Eintrag unter „Fahrten“ (wie bisher). Optional mit Variante (Streckenlayout) und Anzahl der Turns.
   - Trainingstag: ein Kalendertag mit mindestens einer Fahrt auf dieser Strecke (mehrere Fahrten oder Motorräder am selben
     Tag sind ein Tag).
   - Besuch: zusammenhängende Trainingstage auf derselben Strecke (z. B. Samstag und Sonntag) sind ein Besuch.
   - Turns: nur die ausdrücklich angegebenen. Fahrten ohne Angabe werden genannt, nicht geschätzt.
   - Fahrzeit bzw. Strecke: je Motorrad in seiner Einheit; Stunden und Kilometer werden nie zusammengezählt.
   - Lieblingsstrecken: nur ausdrücklich markiert (meta 'tracks'); die Zahl der Besuche macht keine Strecke zum Favoriten.
   - Bestzeiten: von Hand eingetragen, am Motorrad gespeichert (bike.laps). Verglichen wird nur innerhalb derselben Strecke und
     derselben Variante; Zeiten ohne Variante werden nicht verglichen. Keine Rundenmessung, kein GPS, kein Import. */
import {str, isISO} from './util.js';

export const TRACK_MAX = 120, LAYOUT_MAX = 80, LAP_NOTE_MAX = 300, MAX_LAPS = 300, MAX_FAV = 200, TURNS_MAX = 99;
export const LAP_MAX_MS = 10 * 3600 * 1000;
/* Gleiche Strecke bzw. Variante: Leerzeichen zusammengefasst, Groß-/Kleinschreibung egal */
export const nameOf = s => str(s).replace(/\s+/g, ' ');
export const trackKey = s => nameOf(s).toLocaleLowerCase('de');

/* ---------- Lieblingsstrecken (meta 'tracks') ---------- */
/* Gespeicherte Form: {k: 'tracks', fav: [Name, …]} – nach Schlüssel sortiert, jeder Schlüssel einmal. Leer → null (nichts gespeichert). */
export function favRecord(names){
  const m = new Map();
  (names || []).forEach(n => { const v = nameOf(n).slice(0, TRACK_MAX), k = trackKey(v); if (k && !m.has(k)) m.set(k, v); });
  const fav = Array.from(m.keys()).sort().map(k => m.get(k));
  return fav.length ? {k: 'tracks', fav} : null;
}
/* Prüfung beim Einlesen einer Sicherung: ungültig → Fehler (nichts still verwerfen) */
export function tracksOf(v){
  if (v == null) return null;
  const bad = () => { throw new Error('Die Lieblingsstrecken in der Sicherung sind ungültig.'); };
  if (!v || typeof v !== 'object' || Array.isArray(v) || v.k !== 'tracks' || !Array.isArray(v.fav) || v.fav.length > MAX_FAV) bad();
  const keys = new Set();
  v.fav.forEach(n => {
    if (typeof n !== 'string' || !nameOf(n) || nameOf(n).length > TRACK_MAX) bad();
    const k = trackKey(n); if (keys.has(k)) bad(); keys.add(k);
  });
  return favRecord(v.fav);
}
export const favKeys = rec => new Set(rec && Array.isArray(rec.fav) ? rec.fav.map(trackKey) : []);
/* Grenze beim Markieren: dieselbe wie beim Einlesen einer Sicherung (tracksOf, MAX_FAV). Sonst entstünde ein Bestand, dessen eigene
   Sicherung abgelehnt würde. Eine schon markierte Strecke (auch in anderer Schreibweise) zählt nicht neu. */
export const favFull = (rec, name) => { const k = favKeys(rec); return !k.has(trackKey(name)) && k.size >= MAX_FAV; };
/* Eine Strecke markieren bzw. die Markierung entfernen, auf dem aktuellen Stand (andere Strecken bleiben, wie sie sind) */
export function toggleFav(rec, name, on){
  const k = trackKey(name), cur = rec && Array.isArray(rec.fav) ? rec.fav : [];
  const rest = cur.filter(n => trackKey(n) !== k);
  return favRecord(on ? rest.concat([nameOf(name)]) : rest);
}

/* ---------- Zeiten ---------- */
/* Eingabe „1:52,34“, „1:52.3“, „52,8“, „1:02:03“ → {ms, dig} (dig = angegebene Nachkommastellen 0–3) oder null.
   Nichts wird gerundet oder ergänzt: „1:52,3“ bleibt eine Zeit mit einer Nachkommastelle. */
export function parseLap(text){
  const t = str(text).replace(/\s+/g, '');
  const m = /^(?:(?:(\d{1,2}):)?(\d{1,3}):)?(\d{1,5})(?:[.,](\d{1,3}))?$/.exec(t);
  if (!m) return null;
  const hh = m[1] == null ? 0 : +m[1], mm = m[2] == null ? 0 : +m[2], ss = +m[3], frac = m[4] || '';
  /* nach einem Doppelpunkt immer zwei Stellen unter 60 („1:05“, nicht „1:5“ oder „1:75“) */
  if (m[2] != null && (m[3].length !== 2 || ss > 59)) return null;
  if (m[1] != null && (m[2].length !== 2 || mm > 59)) return null;
  const ms = ((hh * 60 + mm) * 60 + ss) * 1000 + (frac ? Math.round(+('0.' + frac) * 1000) : 0);
  if (!(ms > 0) || ms > LAP_MAX_MS) return null;
  return {ms, dig: frac.length};
}
const p2 = n => (n < 10 ? '0' : '') + n;
/* Anzeige mit genau den angegebenen Nachkommastellen, deutsches Komma */
export function fmtLap(ms, dig){
  if (!Number.isInteger(ms) || ms <= 0) return '';
  const d = Number.isInteger(dig) && dig >= 0 && dig <= 3 ? dig : 3;
  const whole = Math.floor(ms / 1000), rest = ms % 1000;
  const h = Math.floor(whole / 3600), m = Math.floor(whole / 60) % 60, s = whole % 60;
  const frac = d ? ',' + String(rest).padStart(3, '0').slice(0, d) : '';
  return (h ? h + ':' + p2(m) + ':' + p2(s) : m ? m + ':' + p2(s) : String(s)) + frac;
}
/* Zwei Zeiten mit unterschiedlicher Genauigkeit: verglichen wird auf die gröbere Angabe; gleich → nicht schneller */
export function lapCmp(a, b){
  const d = Math.min(lapDig(a), lapDig(b)), f = Math.pow(10, 3 - d);
  return Math.floor(a.ms / f) - Math.floor(b.ms / f);
}
const lapDig = l => l.dig == null ? 3 : l.dig;
/* a ist sicher schneller als b: auch auf die gröbere der beiden Angaben schneller. „52“ steht für 52,000 bis 52,999 s, „52,1“ für
   52,100 bis 52,199 s: 52,1 ist sicher schneller als 52,2, aber weder 52 noch 52,1 ist sicher schneller als der andere.
   „Sicher schneller“ ist transitiv, „nicht sicher unterscheidbar“ nicht (52,2 ≈ 52 ≈ 52,1). Deshalb entscheidet bei nicht sicher
   unterscheidbaren Zeiten nie das Datum über die Bestzeit. */
export const lapFaster = (a, b) => lapCmp(a, b) < 0;
/* Angegebener Wert auf die eigene Genauigkeit (nichts ergänzt) */
const lapLo = l => { const f = Math.pow(10, 3 - lapDig(l)); return Math.floor(l.ms / f) * f; };
/* Feste Reihenfolge, unabhängig von der Reihenfolge im Speicher: angegebene Zeit, bei gleicher Zahl die genauere Angabe zuerst,
   dann Datum, Eintrag und Kennung. Eine sicher schnellere Zeit steht immer vor der langsameren. */
const cmpS = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export const lapOrder = (a, b) => (lapLo(a) - lapLo(b)) || (lapDig(b) - lapDig(a)) || cmpS(a.date || '', b.date || '')
  || ((a.created || 0) - (b.created || 0)) || cmpS(String(a.bike || ''), String(b.bike || '')) || cmpS(String(a.id || ''), String(b.id || ''));
/* Bestzeit einer Variante aus der nach lapOrder sortierten Liste: alle Zeiten, die keine andere sicher unterbietet. Eine gleiche
   Angabe (gleiche Zahl, gleiche Genauigkeit) zählt einmal: die frühere hält die Bestzeit. Bleibt genau eine, ist sie die Bestzeit;
   sonst ist sie nicht eindeutig (unterschiedlich genaue Angaben) und keine wird bevorzugt. Weil sicher schnellere Zeiten vorn
   stehen, endet die Suche an der ersten sicher unterbotenen Zeit; alle späteren sind es auch. */
export function lapBest(sorted){
  const out = [], kept = new Set();
  for (const l of sorted || []) {
    if (out.some(o => lapFaster(o, l))) break;
    const k = lapLo(l) + '|' + lapDig(l);
    if (!kept.has(k)) { kept.add(k); out.push(l); }
  }
  return out;
}

/* ---------- Tage und Besuche ---------- */
const dayNo = iso => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5);
/* Zusammenhängende Tage → Besuche [{from, to, days: [ISO …]}], neueste zuerst */
export function visitsOf(dates){
  const ds = Array.from(new Set((dates || []).filter(isISO))).sort();
  const out = [];
  ds.forEach(d => {
    const last = out[out.length - 1];
    if (last && dayNo(d) - dayNo(last.to) === 1) { last.to = d; last.days.push(d); }
    else out.push({from: d, to: d, days: [d]});
  });
  return out.reverse();
}

/* ---------- Übersicht je Strecke ----------
   data = {bikes: {id: Motorrad}, rides: [...], setups: [...], fav: meta-Datensatz oder null}
   Ergebnis: [{key, name, fav, rides, days, visits, turns: {known, n, without}, amount: {h, km, without}, byBike: {id: {n, amount, without}},
   first, last, setups, laps: {groups: [{key, layout, list}], open: [...]}}] */
export function trackList(data){
  const bikes = data.bikes || {}, favs = favKeys(data.fav), m = new Map();
  const get = (name, when) => {
    const k = trackKey(name); if (!k) return null;
    let t = m.get(k);
    if (!t) { t = {key: k, name: nameOf(name), seen: '', fav: favs.has(k), ridesList: [], setups: 0, lapsList: []}; m.set(k, t); }
    /* angezeigt wird die zuletzt verwendete Schreibweise */
    if (when && when >= t.seen) { t.seen = when; t.name = nameOf(name); }
    return t;
  };
  (data.rides || []).forEach(r => { if (bikes[r.bike] && isISO(r.date)) { const t = get(r.track, r.date + '|' + String(r.created || 0).padStart(15, '0')); if (t) t.ridesList.push(r); } });
  (data.setups || []).forEach(s => { if (bikes[s.bike]) { const t = get(s.track, ''); if (t) t.setups++; } });
  Object.keys(bikes).forEach(id => (bikes[id].laps || []).forEach(l => { const t = get(l.track, ''); if (t) t.lapsList.push(Object.assign({bike: id}, l)); }));
  /* markierte Strecken ohne Einträge bleiben sichtbar (sonst ließe sich die Markierung nicht mehr entfernen) */
  ((data.fav && data.fav.fav) || []).forEach(n => get(n, ''));
  return Array.from(m.values()).map(t => {
    const rs = t.ridesList, days = Array.from(new Set(rs.map(r => r.date))).sort();
    const byBike = {}, amount = {h: 0, km: 0, without: 0}, turns = {known: 0, n: 0, without: 0};
    rs.forEach(r => {
      const u = bikes[r.bike].unit === 'km' ? 'km' : 'h';
      const bb = byBike[r.bike] || (byBike[r.bike] = {n: 0, amount: 0, without: 0, unit: u});
      bb.n++;
      if (r.amount != null && r.amount > 0) { bb.amount = r2(bb.amount + r.amount); amount[u] = r2(amount[u] + r.amount); } else { bb.without++; amount.without++; }
      if (Number.isInteger(r.turns) && r.turns > 0) { turns.known += r.turns; turns.n++; } else turns.without++;
    });
    return {key: t.key, name: t.name, fav: t.fav, rides: rs.length, days: days.length, visits: visitsOf(days), turns, amount, byBike,
      first: days[0] || '', last: days[days.length - 1] || '', setups: t.setups, laps: lapGroups(t.lapsList), lapCount: t.lapsList.length};
  });
}
const r2 = v => Math.round(v * 100) / 100;
/* Bestzeiten einer Strecke nach Variante: groups = je Variante (list in fester Reihenfolge nach lapOrder, best = Bestzeit bzw. bei
   nicht eindeutiger Bestzeit alle möglichen, siehe lapBest), open = ohne Variante (nicht verglichen, neueste zuerst) */
export function lapGroups(laps){
  const g = new Map(), open = [];
  (laps || []).forEach(l => {
    const k = trackKey(l.layout);
    if (!k) { open.push(l); return; }
    let x = g.get(k); if (!x) { x = {key: k, layout: nameOf(l.layout), seen: -1, list: []}; g.set(k, x); }
    /* angezeigt wird die zuletzt eingetragene Schreibweise der Variante */
    const when = Math.max(l.created || 0, l.edited || 0);
    if (when >= x.seen) { x.seen = when; x.layout = nameOf(l.layout); }
    x.list.push(l);
  });
  const groups = Array.from(g.values()).map(x => { const list = x.list.sort(lapOrder); return {key: x.key, layout: x.layout, list, best: lapBest(list)}; })
    .sort((a, b) => a.layout.localeCompare(b.layout, 'de'));
  open.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) || ((b.created || 0) - (a.created || 0)));
  return {groups, open};
}
/* Bekannte Varianten einer Strecke (für die Auswahlliste), aus Fahrten und Bestzeiten */
export function layoutsOf(data, track){
  const k = trackKey(track), m = new Map();
  const add = v => { const n = nameOf(v), lk = trackKey(n); if (lk && !m.has(lk)) m.set(lk, n); };
  (data.rides || []).forEach(r => { if (trackKey(r.track) === k) add(r.layout); });
  Object.values(data.bikes || {}).forEach(b => (b.laps || []).forEach(l => { if (trackKey(l.track) === k) add(l.layout); }));
  return Array.from(m.values()).sort((a, b) => a.localeCompare(b, 'de'));
}
