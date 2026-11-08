/* Racebook – Teilehistorie und eigene Erfahrungen (ab 1.7.0, Roadmap 6, Auftrag Issue #5): Berechnungen ohne Oberfläche.
   Ein Eintrag (rec) ist ein Einbau eines Teils an einem Einbauort: montierte Reifen/Kette aus tires/chain (cur: true), ausgebaute
   Teile und weitere Teile aus bike.hist. Datenmodell siehe js/domain.js (Teilehistorie).
   Nutzung = Gesamtlaufleistung beim Ausbau (bzw. jetzt) minus Gesamtlaufleistung bei der Montage. Eingetragen werden Anzeigen des
   Zählers, der damals eingebaut war; welcher das war, bestimmt die Stelle im Verlauf (mountTot). Ein Zählerwechsel verjüngt deshalb
   kein Teil. Fehlt ein Stand, ist die Nutzung unbekannt – sie wird nie geschätzt. Am Tag eines Zählerwechsels ohne gespeicherte
   Stelle ist der Zähler unklar (dann keine Zahl). Vergleiche sind Listen eigener Einsätze, keine Rangliste. */
import {mountTot, deriveBike, HIST_SLOTS, PART_REASONS, PART_USES, PART_VERDICTS} from './domain.js';
import {dayNum, todayISO, isISO, str} from './util.js';
import {S, U} from './state.js';

export const SLOT_NAME = Object.fromEntries(HIST_SLOTS);
export const REASON_NAME = Object.fromEntries(PART_REASONS);
export const USE_NAME = Object.fromEntries(PART_USES);
export const VERDICT_NAME = Object.fromEntries(PART_VERDICTS);
/* Verschleiß und Defekt beenden die Lebensdauer; vorsorglich oder für einen anderen Einsatz ausgebaute Teile sind nicht verbraucht */
export const ENDS_LIFE = r => !!r && !!r.off && (r.reason === 'worn' || r.reason === 'defect');
const r2 = v => Math.round(v * 100) / 100;
const norm = s => str(s).toLowerCase().replace(/\s+/g, ' ');
/* Verlauf des Motorrads: berechnet (S.der) oder neu aus den geladenen Einträgen */
export const derOf = b => (S.der && S.der[b.id]) || deriveBike(b);

/* Bezeichnung: Hersteller und Modell (ohne doppelten Hersteller, wenn das Modell schon damit beginnt) */
export function partLabel(r){
  const maker = str(r && r.maker), model = str(r && r.model);
  if (maker && model && !norm(model).startsWith(norm(maker))) return maker + ' ' + model;
  return model || maker;
}
export const slotLabel = r => r.slot === 'x' ? str(r.name) : (SLOT_NAME[r.slot] || '');
/* Einbauort-Schlüssel: Reifen vorn/hinten und Kette fest, weitere Teile nach Bauteilname */
export const slotKey = r => r.slot === 'x' ? 'x:' + norm(r.name) : r.slot;

const DETAILS = ['maker', 'artNo', 'use', 'track', 'ground', 'rating', 'verdict', 'note', 'prev'];
/* Montierte Reifen und Kette als Einträge (aus tires/chain); ohne Modell/Bezeichnung nichts montiert eingetragen */
export function currentOf(b){
  const t = (b && b.tires) || {}, c = (b && b.chain) || {}, out = [];
  const mk = (slot, x, model) => {
    if (!x || !str(model)) return;
    const r = {id: 'cur:' + slot, slot, name: '', model: str(slot === 'chain' ? x.brand : x.model), on: {date: x.date || '', at: x.at == null ? null : x.at}, off: null, reason: '', cur: true, bike: b.id};
    if (x.c != null) r.on.c = x.c;
    DETAILS.forEach(k => { if (x[k] != null && x[k] !== '') r[k] = x[k]; });
    out.push(r);
  };
  /* Belegt ist ein Platz mit Modell/Bezeichnung oder – nur aus älteren oder eingespielten Daten möglich – allein mit Hersteller */
  mk('tf', t.front, t.front && (str(t.front.model) || str(t.front.maker))); mk('tr', t.rear, t.rear && (str(t.rear.model) || str(t.rear.maker))); mk('chain', c, str(c.brand) || str(c.maker));
  return out;
}
/* Alle Einträge eines Motorrads: montierte (Reifen, Kette, weitere Teile) und ausgebaute */
export function recordsOf(b){
  if (!b) return [];
  return currentOf(b).concat((Array.isArray(b.hist) ? b.hist : []).map(r => Object.assign({}, r, {bike: b.id})));
}
export const mountedOf = b => recordsOf(b).filter(r => !r.off);
export const removedOf = b => recordsOf(b).filter(r => !!r.off);

/* Gesamtlaufleistung an einer Stelle {date, at, c}; unknown = Stand fehlt, amb = Zähler am Tag eines Zählerwechsels unklar */
export function posTot(b, p, d){
  if (!p || p.at == null) return {tot: null, amb: false, unknown: true};
  const m = mountTot(b, {at: p.at, date: p.date || '', c: p.c}, d);
  return {tot: m.tot, amb: m.amb, unknown: false};
}
/* Nutzung eines Einbaus: amount (h bzw. km, nur wenn eindeutig), state 'ok' | 'unknown' | 'amb' | 'check', days (Tage seit der
   Montage bis zum Ausbau bzw. heute; nur mit bekanntem Datum) */
export function usageOf(b, r, d, today){
  d = d || derOf(b); today = today || todayISO();
  const a = posTot(b, r.on, d);
  const e = r.off ? posTot(b, r.off, d) : {tot: d.tot == null ? null : d.tot, amb: false, unknown: d.tot == null};
  let state = 'ok', amount = null;
  if (a.amb || e.amb) state = 'amb';
  else if (a.tot == null || e.tot == null) state = 'unknown';
  else if (e.tot < a.tot - 0.005) state = 'check';
  else amount = Math.max(0, r2(e.tot - a.tot));
  const end = r.off ? (r.off.date || '') : today;
  const days = isISO(r.on && r.on.date) && isISO(end) && end >= r.on.date ? dayNum(end) - dayNum(r.on.date) : null;
  return {amount, state, days, unit: U(b)};
}
/* Lebensdauer eines wieder montierten Teils: alle Einbauten (prev-Kette) zusammen. complete = jeder Einbau bekannt */
export function lifeOf(b, r, d, today){
  d = d || derOf(b);
  const recs = recordsOf(b), seen = new Set(), parts = [];
  for (let x = r; x && !seen.has(x.id); x = x.prev ? recs.find(y => y.id === x.prev) : null) { seen.add(x.id); parts.push(x); }
  const us = parts.map(x => usageOf(b, x, d, today));
  const known = us.filter(u => u.amount != null);
  return {n: parts.length, amount: known.length ? r2(known.reduce((s, u) => s + u.amount, 0)) : null, complete: known.length === us.length, unit: U(b)};
}
/* Kann ein ausgebautes Teil wieder montiert werden? Nicht nach Verschleiß/Defekt und nicht, wenn es schon wieder montiert wurde */
export function remountable(b, r){
  if (!r || !r.off || ENDS_LIFE(r)) return false;
  return !recordsOf(b).some(x => x.prev === r.id);
}

/* Zeitraum zum Prüfen von Überschneidungen am selben Einbauort (nur mit bekanntem Montagedatum; Grenztage berühren sich) */
function span(r){
  if (!isISO(r.on && r.on.date)) return null;
  if (r.off && !isISO(r.off.date)) return null;
  return [r.on.date, r.off ? r.off.date : '9999-12-31'];
}
/* Erster Eintrag desselben Einbauorts, dessen Zeitraum sich mit rec überschneidet (ohne ignore-Kennungen) */
export function overlapOf(recs, rec, ignore){
  const s = span(rec); if (!s) return null;
  const k = slotKey(rec), ign = new Set(ignore || []);
  return recs.find(x => !ign.has(x.id) && x.id !== rec.id && slotKey(x) === k && (() => { const t = span(x); return t && s[0] < t[1] && t[0] < s[1]; })()) || null;
}

/* Fahrten im Zeitraum eines Einbaus (Einordnung, nur wenn das Montagedatum bekannt ist): Anzahl, häufigste Strecken, Untergründe */
export function ridesIn(b, r, rides, today){
  if (!isISO(r.on && r.on.date)) return null;
  const end = r.off ? r.off.date : (today || todayISO());
  if (!isISO(end)) return null;
  const own = (rides || []).filter(x => x.bike === b.id && isISO(x.date) && x.date >= r.on.date && x.date <= end);
  const tr = {}; own.forEach(x => { const t = str(x.track); if (t) tr[t] = (tr[t] || 0) + 1; });
  const grounds = Array.from(new Set(own.map(x => str(x.ground)).filter(Boolean)));
  return {n: own.length, tracks: Object.entries(tr).sort((a, c) => c[1] - a[1] || a[0].localeCompare(c[0], 'de')).slice(0, 3), grounds};
}

/* Vergleich ähnlicher eigener Einsätze: alle Einbauten desselben Einbauorts (bikes = Liste der Motorräder), gruppiert nach
   Hersteller/Modell. Je Gruppe die Einsätze (älteste zuerst) und je Zähleinheit die Spanne der bekannten Nutzung. Keine Rangliste:
   Gruppen alphabetisch, keine „beste“ Angabe, keine Wertung aus der Lebensdauer. */
export function compareGroups(bikes, key, rides, today){
  const groups = new Map();
  (bikes || []).forEach(b => {
    const d = derOf(b);
    recordsOf(b).filter(r => slotKey(r) === key).forEach(r => {
      const label = partLabel(r) || 'ohne Bezeichnung', gk = norm(label);
      if (!groups.has(gk)) groups.set(gk, {label, items: []});
      groups.get(gk).items.push({r, b, use: usageOf(b, r, d, today)});
    });
  });
  return Array.from(groups.values()).sort((a, c) => a.label.localeCompare(c.label, 'de')).map(g => {
    g.items.sort((x, y) => (x.r.on.date || '') < (y.r.on.date || '') ? -1 : (x.r.on.date || '') > (y.r.on.date || '') ? 1 : 0);
    const span = {};
    g.items.forEach(it => { if (it.use.amount == null) return; const u = it.use.unit, s = span[u] || (span[u] = {min: it.use.amount, max: it.use.amount, n: 0}); s.min = Math.min(s.min, it.use.amount); s.max = Math.max(s.max, it.use.amount); s.n++; });
    g.span = span; g.ended = g.items.filter(it => ENDS_LIFE(it.r)).length; g.mounted = g.items.filter(it => !it.r.off).length;
    return g;
  });
}
/* Einbauorte, zu denen es Einträge gibt (für die Auswahl im Vergleich): feste Orte zuerst, dann weitere Teile nach Namen */
export function slotKeysOf(bikes){
  const keys = new Map();
  (bikes || []).forEach(b => recordsOf(b).forEach(r => { const k = slotKey(r); if (!keys.has(k)) keys.set(k, slotLabel(r)); }));
  const fixed = ['tf', 'tr', 'chain'].filter(k => keys.has(k)).map(k => [k, keys.get(k)]);
  const other = Array.from(keys.entries()).filter(([k]) => k.startsWith('x:')).sort((a, c) => a[1].localeCompare(c[1], 'de'));
  return fixed.concat(other);
}

/* Angaben zum Teil (ohne Montage) übernehmen bzw. entfernen */
export const detailsOf = x => { const o = {}; DETAILS.forEach(k => { if (x && x[k] != null && x[k] !== '') o[k] = x[k]; }); return o; };
export const withoutDetails = x => { const o = Object.assign({}, x || {}); DETAILS.forEach(k => { delete o[k]; }); return o; };
/* Stelle {date, at, c} – c nur mit Stand und Datum (wie bei der Montage) */
export function pos(date, at, c){ const p = {date: date || '', at: at == null ? null : at}; if (c != null && p.at != null && p.date) p.c = c; return p; }
/* Montierter Reifen bzw. montierte Kette als Verlaufseintrag beim Ausbau (off = Stelle des Ausbaus) */
export function histOfCurrent(x, slot, off, id){
  const r = {id, slot, name: '', model: str(slot === 'chain' ? x.brand : x.model), on: pos(x.date, x.at, x.c), off: pos(off.date, off.at, off.c), reason: ''};
  return Object.assign(r, detailsOf(x));
}
/* Wechsel oder Berichtigung (Formular „Reifen & Kette“)? Berichtigung: gleiche Stelle (Datum und Stand), oder dasselbe Teil
   (gleiche Bezeichnung) mit gleichem Datum bzw. gleichem Stand. Sonst ist es ein Wechsel: das bisherige Teil kommt in den Verlauf. */
export function isSwap(prev, next, identOf){
  const pi = str(identOf(prev || {})), ni = str(identOf(next || {}));
  if (!pi || !ni) return false;
  const sameAt = (prev.at == null ? null : prev.at) === (next.at == null ? null : next.at), sameDate = (prev.date || '') === (next.date || '');
  if (sameAt && sameDate) return false;
  if (pi === ni && (sameAt || sameDate)) return false;
  return true;
}
