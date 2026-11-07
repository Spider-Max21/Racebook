/* Racebook – Fachlogik: Konstanten, Prüfregeln, Zähler- und Fälligkeitsberechnung, Texterkennung.
   Übernommen aus Version 8 (geprüft mit 70 Regressionen) und erweitert um Mängel, Motorradfotos und lokale Dateien.
   Keine Oberfläche und kein Speicherzugriff: liest nur den geladenen Zustand S. */
import {esc, pad, str, fmt, eur, uid, clone, reEsc, validId, safeUrl, parseNum, num, turns, isISO, todayISO, dayNum,
  fromDayNum, shiftDate, addMonths, fmtDate, hexRgb, rgbHex, mixHex, lum, contrast, towards, onColor, canon, same, subOf, MAX_BUYS} from './util.js';
import {navigationOf} from './preferences.js';
import {S, COLLS, bikeList, curBike, U, bikeName} from './state.js';
import {parseWork, ivProposal, workPos, workEntry} from './work.js';
import {CAT_KEYS} from './label.js';
export {COLLS};

/* ---------- Konstanten ---------- */
/* Checkliste „Vor der Fahrt“: Standardliste. Die IDs c0–c8 entsprechen den Positionen der festen Liste bis 1.1.2
   (abgehakte Punkte des laufenden Tages werden darüber übernommen). „Gabel entlüften“ ist ab 1.2.0 dabei (c9).
   Je Motorrad anpassbar (bikes.checklist); eine organisatorische Liste, keine Wartungsanweisung. */
/* Höchstzahl der Punkte einer eigenen Checkliste (Oberfläche, Speichern und Einlesen gleich, ab 1.2.2) */
export const CHECK_MAX = 40;
export const CHECK = [{id: 'c0', name: 'Kette: Spannung & Schmierung'}, {id: 'c1', name: 'Speichen'}, {id: 'c2', name: 'Schrauben & Achsen'}, {id: 'c3', name: 'Bremsen & Beläge'},
  {id: 'c4', name: 'Luftfilter sauber'}, {id: 'c5', name: 'Reifen & Luftdruck'}, {id: 'c6', name: 'Kühlflüssigkeit'}, {id: 'c7', name: 'Ölstand'}, {id: 'c8', name: 'Gaszug & Kupplung'}, {id: 'c9', name: 'Gabel entlüften'}];
export const checkListOf = b => (b && Array.isArray(b.checklist)) ? b.checklist : CHECK;
export const GROUNDS = ['hart','griffig','lehmig','sandig','steinig','wurzelig','schlammig','nass'];
export const WEATHER = ['sonnig','bewölkt','Nieselregen','Regen','staubig','kalt','heiß'];
export const FLUIDS = [['motor','Motoröl'],['fork','Gabelöl'],['coolant','Kühlflüssigkeit'],['brake','Bremsflüssigkeit'],['airfilter','Luftfilteröl'],['chain','Kettenspray']];
export const MONTHS = ['J','F','M','A','M','J','J','A','S','O','N','D'];
export const NUMW = {ein:1,eine:1,einer:1,einen:1,eins:1,zwei:2,drei:3,vier:4,'fünf':5,fuenf:5,sechs:6,sieben:7,acht:8,neun:9,zehn:10,elf:11,'zwölf':12,halbe:0.5,anderthalb:1.5,eineinhalb:1.5,zweieinhalb:2.5,dreieinhalb:3.5};
export const LOG_KINDS = ['service','tire','chain','note','reading','meter'];
/* Kategorien der Tätigkeiten (ab 1.2.0) */
export const WORK_CATS = ['wartung', 'pflege', 'umbau', 'einstellung'];
/* Rückfrage vor dem Speichern, wenn ein Stand um mehr als so viel über dem bisherigen liegt */
export const JUMP = {h: 20, km: 2000};
export const LIM = {h: {cnt: 100000, ride: 24}, km: {cnt: 9999999, ride: 3000}};
export const MAX_COST = 100000;
/* Version 5 ging am 23.10.2026 um 08:45 Uhr online (1792737909 s). Bis dahin hat die App das Feld
   bikes.current bei jeder Fahrt und Wartung hochgezählt, seitdem nie wieder. Ein gespeichertes
   current ohne currentT ist deshalb ein Altbestand, der alle Einträge von vor diesem Zeitpunkt
   bereits enthält. Diese Regel hängt nur an den Daten selbst und ändert sich nicht beim Neuladen. */
const V5_MS = 1792737909000;
/* Sicherungsformate: Claude-Version 3/4 ohne Kennung, Version 5 = 2, Version 6–8 = 3 (JSON, Dateien nur verlinkt).
   Eigenständige App: ZIP mit racebook.json (format 'racebook-backup') und allen Dateien, Version 4. */
const V8_BACKUP_VERSION = 3;
export const ZIP_FORMAT = 'racebook-backup';
/* Sicherungsformat: 4 = Standard. 5 = wie 4, zusätzlich der Teil „verwaist“ (Einträge ohne Motorrad aus einer
   früheren Version). 6 = Logbuch enthält Zählerwechsel (kind 'meter', Feld meterNew) oder berichtigte Stände
   (Feld fix); ältere Versionen lehnen sie als „neuer“ ab, statt diese Angaben still zu verlieren.
   7 (ab 1.1.1) = zusätzlich ist bei einem Motorrad mit Zählerwechsel gespeichert, an welcher Stelle seines Tages ein
   Startwert oder eine Montage eingetragen wurde (Felder lastC bzw. c). 1.1.0 kennt diese Felder nicht und würde
   solche Angaben wieder dem Zähler am Tagesende zuordnen; deshalb lehnt es Version 7 als „neuer“ ab.
   8 (ab 1.2.0) = Tätigkeiten im Logbuch (Felder work, orig, edited), eigene Checkliste oder Favoriten je Motorrad
   (Felder checklist, favs). 1.1.x kennt diese Felder nicht und würde sie beim Einlesen still verwerfen; deshalb lehnt es
   Version 8 als „neuer“ ab.
   Ab 1.3.0 Version 9, wenn eine eigene Menübelegung (navigation) gespeichert ist; 1.2.x lehnt Version 9 ab.
   Ab 1.4.0 Version 10, wenn ein Lagerartikel Artikelangaben oder ein Artikelbild hat (Felder cat, sub, maker, artNo,
   spec, pack, ean, photo). 1.3.x kennt sie nicht und würde sie beim Einlesen still verwerfen; deshalb lehnt es Version 10 ab.
   Ab 1.5.0 Version 11, wenn ein Lagerartikel mehreren ausgewählten Motorrädern zugeordnet ist (bike 'some', bikes),
   eine Bestandseinheit, einen Einkaufspreis oder Einkäufe hat (unit, price, buys). 1.4.x lehnt Version 11 ab.
   Ohne solche Einträge schreibt die App weiter Version 4, 5, 6, 7, 8, 9 bzw. 10. */
export const ZIP_VERSION = 11;
export const ZIP_VERSION_V10 = 10;
export const ZIP_VERSION_NAV = 9;
export const ZIP_VERSION_V8 = 8;
export const ZIP_VERSION_POS = 7;
export const ZIP_VERSION_METER = 6;
export const ZIP_VERSION_ORPH = 5;
export const ZIP_VERSION_PLAIN = 4;
/* Enthält der Bestand Angaben, die erst ab Sicherungsversion 6 lesbar sind? */
export const needsV6 = next => Object.values((next && next.log) || {}).some(l => l && (l.kind === 'meter' || l.fix != null));
/* Version 7: Motorrad mit Zählerwechsel, dessen Startwerte oder Montagen ihre Stelle im Tag mitbringen */
export const needsV7 = next => {
  const meterBikes = new Set(Object.values((next && next.log) || {}).filter(l => l && l.kind === 'meter').map(l => l.bike));
  return Object.entries((next && next.bikes) || {}).some(([id, b]) => meterBikes.has(id) && b && (
    (b.items || []).some(it => it && it.lastC != null) || [b.tires && b.tires.front, b.tires && b.tires.rear, b.chain].some(x => x && x.c != null)));
};
/* Version 8: Angaben, die erst ab 1.2.0 gespeichert werden */
export const hasV8Log = l => !!l && typeof l === 'object' && (l.work != null || l.orig != null || l.edited != null);
export const hasV8Bike = b => !!b && typeof b === 'object' && (b.checklist != null || b.favs != null);
export const needsV8 = next => Object.values((next && next.log) || {}).some(hasV8Log) || Object.values((next && next.bikes) || {}).some(hasV8Bike);
/* Version 10: Lagerartikel mit Angaben oder Bild, die erst ab 1.4.0 gespeichert werden */
export const PART_V10 = ['cat', 'sub', 'maker', 'artNo', 'spec', 'pack', 'ean', 'photo'];
export const hasV10Part = p => !!p && typeof p === 'object' && PART_V10.some(k => p[k] != null && p[k] !== '');
export const needsV10 = next => Object.values((next && next.parts) || {}).some(hasV10Part);
/* Version 11: Mehrfachzuordnung, Einheit, Einkaufspreis, Einkäufe (ab 1.5.0) */
export const hasV11Part = p => !!p && typeof p === 'object' && (p.bike === 'some' || (Array.isArray(p.bikes) && p.bikes.length > 0) || (p.unit != null && p.unit !== '') || p.price != null || (Array.isArray(p.buys) && p.buys.length > 0));
export const needsV11 = next => Object.values((next && next.parts) || {}).some(hasV11Part);
/* Bereiche, deren Einträge zu einem Motorrad gehören; Teile auch zu 'both' */
export const DEP_COLLS = ['log', 'rides', 'setups', 'defects', 'parts'];
const isOrphan = (k, d, bikeIds) => k === 'parts' ? (d.bike !== 'both' && d.bike !== 'some' && !bikeIds.has(d.bike)) : !bikeIds.has(d.bike);
/* Verwaiste Einträge abtrennen: {clean: {coll: {id: doc}}, orphans: {coll: {id: doc}}, count} */
export function splitOrphans(next){
  const bikeIds = new Set(Object.keys(next.bikes || {}));
  const clean = {bikes: Object.assign({}, next.bikes || {})}, orphans = {};
  let count = 0;
  DEP_COLLS.forEach(k => {
    clean[k] = {}; orphans[k] = {};
    Object.keys(next[k] || {}).forEach(id => { const d = next[k][id]; if (isOrphan(k, d, bikeIds)) { orphans[k][id] = d; count++; } else clean[k][id] = d; });
  });
  return {clean, orphans, count};
}
export function mergeOrphans(next, orphans){
  const m = {}; Object.keys(next).forEach(k => { m[k] = Object.assign({}, next[k], (orphans && orphans[k]) || {}); });
  return m;
}
export const DEFECT_PRIOS = [['high', 'hoch'], ['mid', 'mittel'], ['low', 'niedrig']];
export const DEFECT_STATES = [['open', 'offen'], ['progress', 'in Arbeit'], ['done', 'erledigt']];

/* Markenfarben (nur Farben, keine Logos). plate = [Tafel, Ziffern, Rand] */
export const BRANDS = [
  {n:'KTM', c:'#E3620C'},
  {n:'Husqvarna', c:'#1F3F8F', short:'Husky', plate:['#FFFFFF','#1F3F8F','#1F3F8F']},
  {n:'GasGas', c:'#D0202E'},
  {n:'Honda', c:'#CC1E2B'},
  {n:'Yamaha', c:'#1E4FC2'},
  {n:'Kawasaki', c:'#62B132'},
  {n:'Suzuki', c:'#F2C500'},
  {n:'Beta', c:'#E1251B'},
  {n:'Sherco', c:'#1B5FA8'},
  {n:'TM Racing', c:'#0A64B0', short:'TM'},
  {n:'Fantic', c:'#F2A900'},
  {n:'BMW', c:'#1C69D4'},
  {n:'Ducati', c:'#C8102E'},
  {n:'Andere', c:'#4F6D7A'}
];

/* Für Auswahllisten: alphabetisch (deutsch), „Andere“ am Ende */
export const BRAND_LIST = BRANDS.filter(b => b.n !== 'Andere').sort((a, b) => a.n.localeCompare(b.n, 'de')).concat(BRANDS.filter(b => b.n === 'Andere'));

/* Vorlagen für neue Motorräder (Richtwerte) */
export const KW = {oil:['öl','oel','motoröl','ölwechsel','ölfilter'], air:['luftfilter','luffi'], chain:['kette'], plug:['zündkerze','kerze'], valves:['ventil'], fork:['gabel'], shock:['federbein','dämpfer','stoßdämpfer'], piston:['kolben'], coolant:['kühlflüssigkeit','kühlwasser','kühlmittel'], brake:['bremsflüssigkeit','entlüftet'], gear:['getriebeöl','getriebe'], reed:['membran'], silencer:['dämmwolle','dämmung','auspuff'], pads:['bremsbeläge','beläge']};
export const INAMES = {oil:'Motoröl + Ölfilter', air:'Luftfilter reinigen', chain:'Kette prüfen & schmieren', plug:'Zündkerze', valves:'Ventilspiel prüfen', fork:'Gabelservice', shock:'Federbein-Service', piston:'Kolben + Ringe', coolant:'Kühlflüssigkeit', brake:'Bremsflüssigkeit', gear:'Getriebeöl', reed:'Membran prüfen', silencer:'Schalldämpfer-Dämmwolle', pads:'Bremsbeläge prüfen'};
export const TEMPLATES = {
  mx4: {label:'Viertakt Motocross', unit:'h', items:[['oil',10],['air',3],['chain',5],['plug',30],['valves',15],['fork',40],['shock',40],['piston',45],['coolant',null,12],['brake',null,12]]},
  en4: {label:'Viertakt Enduro', unit:'h', items:[['oil',15],['air',5],['chain',5],['plug',30],['valves',30],['fork',50],['shock',50],['piston',100],['coolant',null,12],['brake',null,12]]},
  t2: {label:'Zweitakt', unit:'h', items:[['gear',20],['air',3],['chain',5],['plug',15],['reed',30],['silencer',30],['fork',40],['shock',40],['piston',40],['coolant',null,12],['brake',null,12]]},
  street: {label:'Straße (Kilometer)', unit:'km', items:[['oil',10000,12],['air',20000],['chain',1000],['plug',20000],['valves',30000],['pads',10000],['coolant',null,48],['brake',null,24]]},
  none: {label:'Leer, ich trage selbst ein', unit:null, items:[]}
};

/* Modellvorschläge pro Marke, gruppiert nach passender Vorlage */
export const MODELS = {
  'KTM': {mx4:'250 SX-F|350 SX-F|450 SX-F', en4:'250 EXC-F|350 EXC-F|450 EXC-F|500 EXC-F|250 XC-F|350 XC-F|450 XC-F', t2:'50 SX|65 SX|85 SX|125 SX|150 SX|250 SX|300 SX|150 EXC|250 EXC|300 EXC|125 XC|300 XC', street:'690 Enduro R|390 Adventure|890 Adventure R|390 Duke|790 Duke|990 Duke|1390 Super Duke R'},
  'Husqvarna': {mx4:'FC 250|FC 350|FC 450', en4:'FE 250|FE 350|FE 450|FE 501|FX 350|FX 450', t2:'TC 50|TC 65|TC 85|TC 125|TC 250|TE 150|TE 250|TE 300|TX 300', street:'701 Enduro|Norden 901|Svartpilen 401|Vitpilen 401'},
  'GasGas': {mx4:'MC 250F|MC 350F|MC 450F', en4:'EC 250F|EC 350F|EX 350F|EX 450F', t2:'MC 50|MC 65|MC 85|MC 125|MC 250|EC 250|EC 300|EX 300', street:'ES 700|SM 700'},
  'Honda': {mx4:'CRF250R|CRF450R|CRF250RX|CRF450RX', en4:'CRF110F|CRF125F|CRF250F', street:'CRF300L|CRF300 Rally|CRF450RL|CRF1100L Africa Twin|XL750 Transalp|NX500|CB650R|CBR650R|CB750 Hornet'},
  'Yamaha': {mx4:'YZ250F|YZ450F', en4:'YZ250FX|YZ450FX|WR250F|WR450F', t2:'PW50|YZ65|YZ85|YZ125|YZ250|YZ125X|YZ250X', street:'Ténéré 700|WR125R|MT-07|MT-09|Tracer 9|XSR700'},
  'Kawasaki': {mx4:'KX250|KX450', en4:'KX250X|KX450X|KLX140R|KLX300R', t2:'KX65|KX85|KX112', street:'KLX230|KLX300|KLR650|Versys 650|Z650|Z900|Ninja 650'},
  'Suzuki': {mx4:'RM-Z250|RM-Z450', street:'DR-Z4S|DR-Z4SM|DR-Z400S|DR650S|V-Strom 800DE|V-Strom 650|GSX-8S|SV650'},
  'Beta': {mx4:'RX 450 4T', en4:'RR 350 4T|RR 390 4T|RR 430 4T|RR 480 4T', t2:'RR 125 2T|RR 200 2T|RR 250 2T|RR 300 2T|RX 300 2T|Xtrainer 250|Xtrainer 300'},
  'Sherco': {en4:'250 SEF|300 SEF|450 SEF|500 SEF', t2:'125 SE|250 SE|300 SE'},
  'TM Racing': {mx4:'MX 250F|MX 450F', en4:'EN 250F|EN 450F', t2:'MX 125|MX 144|MX 250|MX 300|EN 125|EN 300'},
  'Fantic': {mx4:'XXF 250|XXF 450', en4:'XEF 250|XEF 450', t2:'XX 125|XX 250|XE 125|XE 300', street:'Caballero 500'},
  'BMW': {street:'G 310 GS|F 800 GS|F 900 GS|R 1300 GS|R 1300 GS Adventure|S 1000 RR'},
  'Ducati': {mx4:'Desmo450 MX', street:'DesertX|Multistrada V4|Monster|Scrambler Icon|Panigale V4'}
};
export const MODEL_TPL = {};
Object.keys(MODELS).forEach(br => Object.keys(MODELS[br]).forEach(tp => MODELS[br][tp].split('|').forEach(m => { MODEL_TPL[br + '|' + m.toLowerCase()] = tp; })));

/* Fahrwerksfelder: [Formular-ID, Datenfeld, Bezeichnung, Regeln] */
export const SF = [
  ['sForkC', 'forkC', 'Gabel Druckstufe', {int:true, min:0, max:60}],
  ['sForkR', 'forkR', 'Gabel Zugstufe', {int:true, min:0, max:60}],
  ['sForkAir', 'forkAir', 'Gabel Luftdruck', {min:0, max:20}],
  ['sForkPre', 'forkPre', 'Gabel Vorspannung', {min:0, max:40}],
  ['sHSC', 'shockHSC', 'High Speed', {min:0, max:10}],
  ['sLSC', 'shockLSC', 'Low Speed', {int:true, min:0, max:60}],
  ['sShockR', 'shockR', 'Federbein Zugstufe', {int:true, min:0, max:60}],
  ['sSag', 'sag', 'Sag', {min:0, max:200}],
  ['sPF', 'pf', 'Reifendruck vorn', {min:0, max:5}],
  ['sPR', 'pr', 'Reifendruck hinten', {min:0, max:5}]
];

export const brandOf = b => BRANDS.find(x => x.n.toLowerCase() === String((b && b.brand) || '').toLowerCase()) || null;
export function colorOf(b){
  if (b && /^#[0-9a-f]{6}$/i.test(b.color || '')) return b.color;
  const br = brandOf(b); if (br) return br.c;
  if (b && b.color === 'husky') return '#1F3F8F';
  if (b && b.color === 'ktm') return '#E3620C';
  /* Ohne Marke und ohne gewählte Farbe: neutrales Grau, keine Markenfarbe */
  return '#5B6670';
}
export function darkFill(c){ return contrast(c, '#191D22') < 2.4 ? towards(c, '#E4E7E2', '#191D22', 2.6) : c; }
export function plateOf(b){
  const c = colorOf(b), br = brandOf(b);
  if (br && br.plate && c.toLowerCase() === br.c.toLowerCase()) return br.plate;
  return [c, onColor(c), mixHex(c, '#000000', 0.3)];
}
export const shortName = b => { if (!b) return ''; if (b.nickname) return b.nickname; if (b.short) return b.short; const br = brandOf(b); return (br && br.short) || b.brand || ''; };
/* ---------- Datenprüfung (Import streng, Lesen nachsichtig) ---------- */
export function H(strict, where){
  const fail = (f, msg) => { if (strict) throw new Error(where + ': ' + f + ' ' + msg); return undefined; };
  return {
    s(v, f, o){ o = o || {}; const max = o.max || 2000; if (v == null || v === '') { if (o.req) { const r = fail(f, 'fehlt.'); return r === undefined ? '' : r; } return ''; } if (typeof v !== 'string') { fail(f, 'ist kein Text.'); return ''; } if (v.length > max) { fail(f, 'ist zu lang.'); return v.slice(0, max); } return v; },
    n(v, f, o){ o = o || {}; if (v == null || v === '') return null; if (typeof v !== 'number' || !isFinite(v)) { fail(f, 'ist keine gültige Zahl.'); return null; } if (o.int && !Number.isInteger(v)) { fail(f, 'ist keine ganze Zahl.'); return null; } if ((o.min != null && v < o.min) || (o.max != null && v > o.max) || (o.gt != null && !(v > o.gt))) { fail(f, 'liegt außerhalb des erlaubten Bereichs.'); return null; } return v; },
    d(v, f, o){ o = o || {}; if (v == null || v === '') { if (o.req) fail(f, 'fehlt.'); return null; } if (!isISO(v)) { fail(f, 'ist kein gültiges Datum.'); return null; } return v; },
    id(v, f, o){ o = o || {}; if (validId(v)) return v; if (o.opt && (v == null || v === '')) return ''; fail(f, 'ist ungültig.'); return ''; },
    o(v, f){ if (v == null) return {}; if (typeof v !== 'object' || Array.isArray(v)) { fail(f, 'ist kein Objekt.'); return {}; } return v; },
    a(v, f){ if (v == null) return []; if (!Array.isArray(v)) { fail(f, 'ist keine Liste.'); return []; } return v; },
    one(v, f, list, def){ if (v == null || v === '') return def; if (!list.includes(v)) { fail(f, 'hat einen unbekannten Wert.'); return def; } return v; },
    fail
  };
}
export function cleanBike(x, strict, where){
  const h = H(strict, where); x = h.o(x, 'Eintrag');
  const seen = new Set();
  const items = h.a(x.items, 'Wartungspunkte').map((it, i) => {
    const w = 'Wartungspunkt ' + (i + 1);
    if (!it || typeof it !== 'object' || Array.isArray(it)) { h.fail(w, 'ist ungültig.'); return null; }
    const id = h.id(it.id, w + ' (ID)');
    if (id && seen.has(id)) { h.fail(w, 'kommt doppelt vor.'); return null; }
    if (id) seen.add(id);
    const o = {id, name: h.s(it.name, w + ' (Name)', {req:true, max:120}),
      every: h.n(it.every, w + ' (Intervall)', {gt:0, max:1e7}), months: h.n(it.months, w + ' (Monate)', {int:true, min:1, max:240}),
      lastAt: h.n(it.lastAt, w + ' (Startwert)', {min:0, max:1e7}), lastDate: h.d(it.lastDate, w + ' (Startdatum)'),
      kw: h.a(it.kw, w + ' (Stichworte)').filter(k => typeof k === 'string' && k.length <= 60).slice(0, 20)};
    /* ab 1.1.1: Stelle des Startwerts im Verlauf seines Tages (wie die Erfassungszeit eines Logbuch-Eintrags) */
    const lc = h.n(it.lastC, w + ' (Erfassungszeit Startwert)', {int:true, min:0});
    if (lc != null && o.lastAt != null && o.lastDate) o.lastC = lc;
    return o;
  }).filter(it => it && it.id && it.name);
  const withC = (o, v, f) => { const c = h.n(v, f + ' Erfassungszeit', {int:true, min:0}); if (c != null && o.at != null && o.date) o.c = c; return o; };
  const tire = (t, f) => { t = h.o(t, f); return withC({model: h.s(t.model, f + ' Modell', {max:120}), at: h.n(t.at, f + ' Stand', {min:0, max:1e7}), date: h.d(t.date, f + ' Datum') || ''}, t.c, f); };
  const tires = h.o(x.tires, 'Reifen'), chain = h.o(x.chain, 'Kette'), fl = h.o(x.fluids, 'Öle'), oem = h.o(x.oem, 'Herstellervorgaben');
  const fluids = {};
  FLUIDS.forEach(([k, l]) => { const f = h.o(fl[k], l); fluids[k] = {brand: h.s(f.brand, l, {max:120}), spec: h.s(f.spec, l, {max:120}), qty: h.s(f.qty, l, {max:60})}; });
  let manual = null;
  if (x.manual != null) {
    const m = h.o(x.manual, 'Anleitung'), kind = h.one(m.kind, 'Anleitung', ['pdf', 'link'], 'link');
    if (kind === 'pdf' && validId(m.fileId)) manual = {kind: 'pdf', fileId: m.fileId, name: h.s(m.name, 'Anleitung', {max:200}), size: h.n(m.size, 'Anleitung (Größe)', {int:true, min:0}) || 0};
    else if (kind === 'link' && safeUrl(m.url)) manual = {kind: 'link', url: safeUrl(m.url), name: h.s(m.name, 'Anleitung', {max:200})};
    else h.fail('Anleitung', 'hat weder eine gültige Datei noch einen gültigen Link.');
  }
  let photo = null;
  if (x.photo != null) {
    const ph = h.o(x.photo, 'Foto');
    if (validId(ph.id)) photo = {id: ph.id, thumbId: validId(ph.thumbId) ? ph.thumbId : ''};
    else h.fail('Foto', 'ist ungültig.');
  }
  const color = (typeof x.color === 'string' && (/^#[0-9a-f]{6}$/i.test(x.color) || x.color === 'ktm' || x.color === 'husky')) ? x.color : null;
  return {
    brand: h.s(x.brand, 'Marke', {req:true, max:60}) || 'Motorrad', short: x.short == null ? null : (h.s(x.short, 'Kurzname', {max:30}) || null),
    nickname: h.s(x.nickname, 'Spitzname', {max:40}), photo,
    model: h.s(x.model, 'Modell', {max:80}), year: h.n(x.year, 'Baujahr', {int:true, min:1900, max:2200}),
    unit: h.one(x.unit, 'Einheit', ['h', 'km'], 'h'), current: h.n(x.current, 'Startstand', {min:0, max:1e7}), currentT: h.n(x.currentT, 'Startzeit', {int:true, min:0}),
    color, order: h.n(x.order, 'Reihenfolge', {int:true, min:0, max:9999}), items, fluids,
    tires: {front: tire(tires.front, 'Reifen vorn'), rear: tire(tires.rear, 'Reifen hinten')},
    chain: withC({front: h.n(chain.front, 'Ritzel', {int:true, min:5, max:99}), rear: h.n(chain.rear, 'Kettenrad', {int:true, min:5, max:99}), brand: h.s(chain.brand, 'Kette', {max:120}), links: h.n(chain.links, 'Kettenglieder', {int:true, min:40, max:250}), at: h.n(chain.at, 'Kette Stand', {min:0, max:1e7}), date: h.d(chain.date, 'Kette Datum') || ''}, chain.c, 'Kette'),
    ...cleanBikeV8(x, h),
    oem: {rows: h.a(oem.rows, 'Herstellervorgaben').filter(r => r && typeof r === 'object').slice(0, 50).map(r => ({when: h.s(r.when, 'Herstellervorgabe', {max:60}), what: h.s(r.what, 'Herstellervorgabe', {max:300})})), note: h.s(oem.note, 'Hinweis', {max:2000}), sourceTitle: h.s(oem.sourceTitle, 'Quelle', {max:200}), sourceUrl: safeUrl(oem.sourceUrl)},
    manual
  };
}
/* Ab 1.2.0, nur wenn vorhanden (bestehende Motorräder bleiben exakt gleich):
   checklist = eigene Liste „Vor der Fahrt“ [{id, name}], favs = Lieblings-Tätigkeiten (IDs aus dem Katalog oder eigene) */
function cleanBikeV8(x, h){
  const o = {};
  if (x.checklist != null) {
    const seen = new Set();
    o.checklist = h.a(x.checklist, 'Checkliste').slice(0, CHECK_MAX).map((c, i) => {
      if (!c || typeof c !== 'object' || Array.isArray(c)) { h.fail('Checkliste ' + (i + 1), 'ist ungültig.'); return null; }
      const id = h.id(c.id, 'Checkliste ' + (i + 1) + ' (ID)'), name = h.s(c.name, 'Checkliste ' + (i + 1), {req: true, max: 80});
      if (!id || !name || seen.has(id)) { if (id && seen.has(id)) h.fail('Checkliste ' + (i + 1), 'kommt doppelt vor.'); return null; }
      seen.add(id); return {id, name};
    }).filter(Boolean);
  }
  if (x.favs != null) o.favs = Array.from(new Set(h.a(x.favs, 'Favoriten').filter(validId))).slice(0, 40);
  return o;
}
export function cleanSnap(x, h){
  if (x == null) return null;
  x = h.o(x, 'Setup-Kopie'); const o = {track: h.s(x.track, 'Setup-Kopie Strecke', {max:120}), updated: h.d(x.updated, 'Setup-Kopie Datum')};
  SF.forEach(([, k, l, r]) => { o[k] = h.n(x[k], 'Setup-Kopie ' + l, {int:r.int, min:r.min, max:r.max}); });
  return o;
}
export const FIX_HOW = ['tippfehler', 'festgehalten'];
function cleanFix(v, h){
  v = h.o(v, 'Berichtigung');
  const how = h.one(v.how, 'Berichtigung', FIX_HOW, null), from = h.n(v.from, 'Berichtigung (alter Stand)', {min:0, max:1e7});
  if (!how || from == null) { h.fail('Berichtigung', 'ist unvollständig.'); return null; }
  return {how, from, t: h.n(v.t, 'Berichtigung (Zeit)', {int:true, min:0}) || 0, op: validId(v.op) ? v.op : ''};
}
export function cleanDoc(coll, x, strict, where){
  if (coll === 'bikes') return cleanBike(x, strict, where);
  const h = H(strict, where); x = h.o(x, 'Eintrag');
  const bike = h.id(x.bike, 'Motorrad');
  if (coll === 'log') {
    const d = {bike, kind: h.one(x.kind, 'Art', LOG_KINDS, 'note'), date: h.d(x.date, 'Datum', {req:true}) || '',
    at: h.n(x.at, 'Stand', {min:0, max:1e7}), atAuto: x.atAuto === true ? true : (x.atAuto === false ? false : null), correction: x.correction === true,
    tasks: h.a(x.tasks, 'Arbeiten').filter(validId).slice(0, 50), taskNames: h.a(x.taskNames, 'Arbeiten').filter(t => typeof t === 'string').map(t => t.slice(0, 120)).slice(0, 50),
    extra: h.s(x.extra, 'Weitere Arbeiten', {max:500}), title: h.s(x.title, 'Titel', {max:300}), cost: h.n(x.cost, 'Kosten', {min:0, max:1e6}),
    note: h.s(x.note, 'Notiz', {max:4000}), created: h.n(x.created, 'Zeitstempel', {int:true, min:0}) || 0,
    photoId: validId(x.photoId) ? x.photoId : '', thumbId: validId(x.thumbId) ? x.thumbId : '', repairOf: validId(x.repairOf) ? x.repairOf : ''};
    /* Neue Felder nur, wenn benutzt: bestehende Einträge bleiben exakt gleich.
       meterNew (nur Zählerwechsel): Anzeige des neuen Zählers; at = letzter Stand des alten Zählers.
       fix: Stand bei einer Tippfehler-Berichtigung geändert ({how: 'tippfehler', from: alter Wert}) oder als
       automatisch berechneter Wert festgehalten ({how: 'festgehalten', from: Wert}); t = Zeitpunkt, op = Vorgang */
    if (d.kind === 'meter') { d.meterNew = h.n(x.meterNew, 'Neuer Zählerstand', {min:0, max:1e7}); if (d.meterNew == null) { h.fail('Neuer Zählerstand', 'fehlt.'); d.meterNew = 0; } }
    if (x.fix != null) { const fx = cleanFix(x.fix, h); if (fx) d.fix = fx; }
    /* ab 1.2.0: work = tatsächlich erledigte Tätigkeiten [{id, name, cat, detail}] (getrennt von tasks = betroffene
       Wartungsintervalle), orig = Originaleingabe des Schnell-Eintrags, edited = Zeitpunkt der letzten Bearbeitung */
    if (x.work != null) d.work = h.a(x.work, 'Tätigkeiten').slice(0, 40).map((w, i) => {
      if (!w || typeof w !== 'object' || Array.isArray(w)) { h.fail('Tätigkeit ' + (i + 1), 'ist ungültig.'); return null; }
      const id = h.id(w.id, 'Tätigkeit ' + (i + 1) + ' (ID)'), name = h.s(w.name, 'Tätigkeit ' + (i + 1), {req: true, max: 120});
      if (!id || !name) return null;
      return {id, name, cat: h.one(w.cat, 'Tätigkeit ' + (i + 1) + ' (Kategorie)', WORK_CATS, 'wartung'), detail: h.s(w.detail, 'Tätigkeit ' + (i + 1) + ' (Angaben)', {max: 300})};
    }).filter(Boolean);
    if (x.orig != null) d.orig = h.s(x.orig, 'Originaleingabe', {max: 4000});
    if (x.edited != null) { const t = h.n(x.edited, 'Bearbeitet', {int: true, min: 0}); if (t != null) d.edited = t; }
    return d;
  }
  if (coll === 'rides') return {bike, date: h.d(x.date, 'Datum', {req:true}) || '', track: h.s(x.track, 'Strecke', {max:120}),
    amount: h.n(x.amount, 'Fahrzeit', {gt:0, max:LIM.km.ride}), ground: h.s(x.ground, 'Boden', {max:40}), weather: h.s(x.weather, 'Wetter', {max:40}),
    setupId: h.id(x.setupId, 'Setup', {opt:true}), setupSnap: cleanSnap(x.setupSnap, h), feel: h.n(x.feel, 'Gefühl', {int:true, min:1, max:5}), inReading: x.inReading === true,
    note: h.s(x.note, 'Notiz', {max:4000}), created: h.n(x.created, 'Zeitstempel', {int:true, min:0}) || 0};
  if (coll === 'setups') { const o = {bike, track: h.s(x.track, 'Strecke', {req:true, max:120}), note: h.s(x.note, 'Notiz', {max:2000}), updated: h.d(x.updated, 'Datum')}; SF.forEach(([, k, l, r]) => { o[k] = h.n(x[k], l, {int:r.int, min:r.min, max:r.max}); }); return o; }
  if (coll === 'defects') return {bike, title: h.s(x.title, 'Titel', {req:true, max:120}), description: h.s(x.description, 'Beschreibung', {max:4000}),
    date: h.d(x.date, 'Datum', {req:true}) || '', priority: h.one(x.priority, 'Priorität', DEFECT_PRIOS.map(p => p[0]), 'mid'),
    status: h.one(x.status, 'Status', DEFECT_STATES.map(p => p[0]), 'open'),
    photos: h.a(x.photos, 'Fotos').filter(p => p && typeof p === 'object' && validId(p.id)).slice(0, 6).map(p => ({id: p.id, thumbId: validId(p.thumbId) ? p.thumbId : ''})),
    doneDate: h.d(x.doneDate, 'Erledigt am'), repairs: h.n(x.repairs, 'Reparaturen', {int:true, min:0, max:999}) || 0,
    repairLogId: h.id(x.repairLogId, 'Reparatureintrag', {opt:true}), created: h.n(x.created, 'Zeitstempel', {int:true, min:0}) || 0};
  if (coll === 'parts') {
    /* Ab 1.4.0: Artikelangaben (Kategorie, Hersteller, Artikelnummer, Spezifikation, Gebinde, Strichcode) und Artikelbild */
    const ph = x.photo && typeof x.photo === 'object' && validId(x.photo.id) ? {id: x.photo.id, thumbId: validId(x.photo.thumbId) ? x.photo.thumbId : ''} : null;
    /* Ab 1.5.0: Zuordnung 'both' (alle Motorräder), eine Kennung (genau ein Motorrad) oder 'some' mit der Liste bikes
       (ausgewählte Motorräder; leer = „Zuordnung prüfen“). Einheit, Einkaufspreis (Cent) und Einkäufe (Zugänge). */
    const multi = x.bike === 'some';
    const bikes = multi ? Array.from(new Set(h.a(x.bikes, 'Motorräder').filter(v => { if (validId(v)) return true; h.fail('Motorräder', 'enthält eine ungültige Kennung.'); return false; }))).sort() : [];
    /* Einkäufe werden nie still gekürzt: mehr als MAX_BUYS gelten bei der strengen Prüfung (Sicherung) als Fehler */
    const buysIn = h.a(x.buys, 'Einkäufe'); if (buysIn.length > MAX_BUYS) h.fail('Einkäufe', 'sind mehr als ' + MAX_BUYS + ' Einträge.');
    return {name: h.s(x.name, 'Teil', {req:true, max:120}), bike: x.bike === 'both' ? 'both' : multi ? 'some' : bike, bikes,
      unit: h.one(x.unit, 'Einheit', PART_UNITS, ''), price: h.n(x.price, 'Einkaufspreis', {int:true, min:0, max:MAX_PRICE}),
      buys: buysIn.map((b, i) => cleanBuy(b, h, i)).filter(Boolean),
      qty: h.n(x.qty, 'Anzahl', {int:true, min:0, max:99999}) || 0, min: h.n(x.min, 'Nachkaufen ab', {int:true, min:0, max:99999}) || 0, created: h.n(x.created, 'Zeitstempel', {int:true, min:0}) || 0,
      cat: h.one(x.cat, 'Kategorie', CAT_KEYS, ''), sub: h.s(x.sub, 'Unterkategorie', {max:60}), maker: h.s(x.maker, 'Hersteller', {max:60}), artNo: h.s(x.artNo, 'Artikelnummer', {max:60}),
      spec: h.s(x.spec, 'Spezifikation', {max:200}), pack: h.s(x.pack, 'Gebindegröße', {max:40}), ean: /^\d{8}$|^\d{12,14}$/.test(str(x.ean)) ? str(x.ean) : '', photo: ph};
  }
  return null;
}
/* Einkauf (Zugang) eines Lagerartikels: Datum, Menge, bezahlter Preis je Einheit in Cent (null = nicht erfasst,
   0 = ausdrücklich kostenlos), Vorgangskennung und – unveränderlich mit dem Einkauf – der damals bestätigte Bezug:
   Einheit (Stück/Gebinde) und Gebindegröße. Spätere Änderungen am Artikel deuten alte Einkäufe nicht um. */
export const PART_UNITS = ['piece', 'pack'];
export const MAX_PRICE = 9999999;
function cleanBuy(b, h, i){
  b = h.o(b, 'Einkauf ' + (i + 1)); if (!b || typeof b !== 'object') return null;
  const date = h.d(b.date, 'Einkauf ' + (i + 1) + ' (Datum)', {req:true}), qty = h.n(b.qty, 'Einkauf ' + (i + 1) + ' (Menge)', {int:true, min:1, max:99999});
  if (!date || qty == null) return null;
  return {date, qty, price: h.n(b.price, 'Einkauf ' + (i + 1) + ' (Preis)', {int:true, min:0, max:MAX_PRICE}), op: validId(b.op) ? b.op : '',
    unit: h.one(b.unit, 'Einkauf ' + (i + 1) + ' (Einheit)', PART_UNITS, ''), pack: h.s(b.pack, 'Einkauf ' + (i + 1) + ' (Gebindegröße)', {max:40})};
}
/* Gehört ein Lagerartikel (auch) zu diesem Motorrad? 'both' gilt für alle */
export const partFor = (p, bid) => !!p && (p.bike === 'both' || p.bike === bid || (p.bike === 'some' && Array.isArray(p.bikes) && p.bikes.includes(bid)));
/* Konkrete Motorräder eines Artikels ([] bei 'both') */
export const partBikes = p => !p ? [] : p.bike === 'some' ? (Array.isArray(p.bikes) ? p.bikes : []) : p.bike === 'both' ? [] : [p.bike];
/* „Zuordnung prüfen“: ausgewählte Motorräder, aber keines mehr vorhanden */
export const partNeedsCheck = p => !!p && p.bike === 'some' && !(Array.isArray(p.bikes) && p.bikes.length);
/* Dokumentierte Einkaufskosten (Cent), Menge mit und ohne bekannten Preis, Mengen je Bezug (Einheit und Gebindegröße
   des jeweiligen Einkaufs; verschiedene Bezüge werden nicht zusammengezählt) */
export function buySum(p){
  let cents = 0, known = 0, unknown = 0; const by = new Map();
  ((p && p.buys) || []).forEach(b => {
    if (b.price == null) { unknown += b.qty; return; }
    cents += b.price * b.qty; known += b.qty;
    const k = (b.unit || '') + '|' + (b.unit === 'pack' ? str(b.pack) : '');
    const g = by.get(k) || {unit: b.unit || '', pack: b.unit === 'pack' ? str(b.pack) : '', qty: 0}; g.qty += b.qty; by.set(k, g);
  });
  return {cents, known, unknown, groups: Array.from(by.values())};
}
/* Geldbetrag in Euro (deutsche Eingabe „9,90“, auch „9.90“, „1.234,50“, „0“) → Cent; leer = null */
export function parsePrice(t){
  const raw = String(t == null ? '' : t).trim(), s = raw.replace(/\s|€|eur/gi, '');
  if (!raw) return {empty: true, cents: null};
  if (!s) return {err: 'Bitte einen Betrag wie 9,90 eingeben.'};
  let m = s.match(/^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/) || s.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return {err: 'Bitte einen Betrag wie 9,90 eingeben.'};
  const euros = Number(m[1].replace(/\./g, '')), cents = euros * 100 + Number((m[2] || '').padEnd(2, '0') || 0);
  if (!Number.isSafeInteger(cents) || cents > MAX_PRICE) return {err: 'Der Betrag ist zu groß.'};
  return {cents};
}
export const fmtPrice = c => c == null ? '' : (c / 100).toLocaleString('de-DE', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + ' €';
export const unitName = (u, n) => u === 'pack' ? (n === 1 ? 'Gebinde' : 'Gebinde') : u === 'piece' ? 'Stück' : '';

/* Einheitliche Form jedes gespeicherten Eintrags (alle Felder, Standardwerte). Damit ist ein
   Eintrag nach Sicherung und Wiederherstellung exakt gleich, egal auf welchem Weg er entstand. */
export const canonDoc = (coll, d) => cleanDoc(coll, d, false, '');
/* ---------- Abgeleitete Werte: Stand und Wartungsmarker ---------- */
export function dateOfMs(ms){ const d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
export const cmpEv = (x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0) || (x.ph - y.ph) || (x.c - y.c) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
/* Wartung mit eingetipptem Stand = Messpunkt. Ohne Stand: heute erfasst (atAuto) oder Altbestand = aus dem Verlauf; sonst unbekannt. */
export const isMeasured = l => l.at != null && l.atAuto !== true;
export const isDerivedAt = l => l.atAuto === true || (l.atAuto === null && l.at == null);
export const hasSetOn = (bid, date) => S.log.some(l => l.bike === bid && l.date === date && (l.kind === 'reading' ? l.at != null : (l.kind === 'meter' || (l.kind === 'service' && isMeasured(l)))));
/* Stelle eines alten, hochgezählten Stands im Verlauf: hinter allen Einträgen, die er schon enthält
   (alle bis currentT bzw. alle von vor Version 5), unabhängig von deren Fahrdatum (siehe V5_MS) */
export function legacyPos(b, logs, rides){
  const lim = b.currentT != null ? b.currentT : V5_MS - 1;
  const own = (logs || S.log).filter(l => l.bike === b.id && l.created <= lim).concat((rides || S.rides).filter(r => r.bike === b.id && r.created <= lim));
  let t = b.currentT != null ? b.currentT : 0, date = '';
  own.forEach(x => { if (b.currentT == null && x.created > t) t = x.created; if (isISO(x.date) && x.date > date) date = x.date; });
  if (t) { const dt = dateOfMs(t); if (dt > date) date = dt; }
  return {date: date || '0000-00-00', c: t + 0.5};
}
const r2 = v => Math.round(v * 100) / 100;
/* Verlauf eines Motorrads (rein: arbeitet auch mit geänderten Listen, z. B. für die Vorschau einer Berichtigung).
   Alle Werte im Verlauf sind Gesamtlaufleistung. off = Gesamtlaufleistung minus Anzeige des eingebauten Zählers;
   off ändert sich nur bei einem Zählerwechsel (kind 'meter': at = letzter Stand des alten Zählers, meterNew =
   Anzeige des neuen). Eingetippte Stände sind immer Anzeigen; ohne Zählerwechsel ist beides gleich.
   Ergebnis: cur = Anzeige jetzt, tot = Gesamtlaufleistung jetzt, items = letzte Wartung je Punkt
   ({at: Gesamt, disp: Anzeige damals, date, …}), ev = Ereignisse mit prev/tot/off, probe/poff je Eintrag. */
export function deriveBike(b, logs, rides){
  logs = logs || S.log; rides = rides || S.rides;
  const ev = [];
  if (b.current != null) { const lp = legacyPos(b, logs, rides); ev.push({date: lp.date, ph: 1, c: lp.c, id: '', k: 'set', v: b.current, legacy: true}); }
  logs.forEach(l => {
    if (l.bike !== b.id) return;
    const base = {date: l.date || '', ph: 1, c: l.created || 0, id: l.id, probe: true};
    if (l.kind === 'reading' && l.at != null) ev.push(Object.assign(base, {k: 'set', v: l.at, src: 'reading'}));
    else if (l.kind === 'service' && isMeasured(l)) ev.push(Object.assign(base, {k: 'set', v: l.at, src: 'service'}));
    else if (l.kind === 'service' && isDerivedAt(l)) ev.push(Object.assign(base, {k: 'probe'}));
    else if (l.kind === 'meter') ev.push(Object.assign(base, {k: 'meter', v: l.at, nv: l.meterNew || 0}));
  });
  rides.forEach(r => { if (r.bike === b.id && r.amount != null && r.amount > 0) ev.push({date: r.date || '', ph: r.inReading ? 0 : 1, c: r.created || 0, id: r.id, k: 'add', v: r.amount}); });
  ev.sort(cmpEv);
  let cur = null, off = 0; const probe = {}, poff = {};
  ev.forEach(e => {
    e.prev = cur; e.prevOff = off;
    if (e.k === 'set') cur = off ? r2(e.v + off) : e.v;
    else if (e.k === 'add') { if (cur != null) cur = r2(cur + e.v); }
    else if (e.k === 'meter') {
      /* Ohne bekannten alten Stand gibt es keine Gesamtlaufleistung zu erhalten: dann zählt der neue Zähler wie bisher */
      const tot = e.v != null ? (off ? r2(e.v + off) : e.v) : cur;
      if (tot != null) { cur = tot; off = r2(tot - e.nv); }
    }
    e.tot = cur; e.off = off;
    if (e.probe) { probe[e.id] = cur; poff[e.id] = off; }
  });
  /* Startwert aus den Intervallen: Anzeige am Startdatum (ohne Datum: vor allem anderen, also erster Zähler).
     Welcher Zähler gemeint ist, bestimmt die Stelle im Verlauf (offAtPos); am Tag eines Zählerwechsels ohne
     gespeicherte Stelle (Angaben aus 1.1.0 und älter) ist das unklar: dann kein Wert, sondern amb (zum Klären) */
  const items = {};
  (b.items || []).forEach(it => {
    let best = null;
    if (it.lastAt != null || it.lastDate) {
      const p = it.lastAt != null && it.lastDate ? offAtPos(ev, it.lastDate, it.lastC) : {off: 0, amb: false};
      best = {at: it.lastAt != null && !p.amb ? (p.off ? r2(it.lastAt + p.off) : it.lastAt) : null, disp: it.lastAt, date: it.lastDate || null, src: 'base', key: (it.lastDate || '') + '|0', amb: !!(p.amb && it.lastAt != null)};
    }
    logs.forEach(l => {
      if (l.bike !== b.id || l.kind !== 'service' || !isISO(l.date) || !l.tasks.includes(it.id)) return;
      const key = l.date + '|' + String(l.created || 0).padStart(15, '0');
      if (best && key <= best.key) return;
      const v = (isMeasured(l) || isDerivedAt(l)) && probe[l.id] != null ? probe[l.id] : null;
      best = {at: v, disp: v == null ? null : (poff[l.id] ? r2(v - poff[l.id]) : v), date: l.date, src: 'log', auto: isDerivedAt(l), id: l.id, key};
    });
    items[it.id] = best;
  });
  return {cur: cur == null ? null : (off ? r2(cur - off) : cur), tot: cur, off, items, ev, probe, poff};
}
/* Abstand Gesamt − Anzeige an einer Stelle des Tages date. c = Erfassungszeit der Angabe (Stelle im Verlauf des Tages).
   Ohne c: eindeutig nur, wenn an diesem Tag kein Zähler gewechselt wurde (dann ist der Abstand den ganzen Tag gleich). */
export function offAtPos(ev, date, c){
  const swapDay = ev.some(e => e.k === 'meter' && e.date === date);
  if (c == null && swapDay) return {off: null, amb: true};
  const key = c == null ? {date, ph: 2, c: 0, id: ''} : {date, ph: 1, c, id: '\uffff'};
  let o = 0; for (const e of ev) { if (cmpEv(e, key) >= 0) break; o = e.off; }
  return {off: o, amb: false};
}
/* Zählerwechsel an einem Tag (in der Reihenfolge ihrer Erfassung) und die Stellen davor/dazwischen/danach zur Auswahl:
   [{c, label}] – c ist die Erfassungszeit, die eine Angabe in genau diesen Zählerabschnitt legt */
export function meterSegments(b, date, d){
  d = d || S.der[b.id]; if (!d) return [];
  const sw = d.ev.filter(e => e.k === 'meter' && e.date === date);
  if (!sw.length) return [];
  const u = U(b), n = sw.length, hv = v => fmt(v, 2) + ' ' + u;
  const disp = e => e.prev == null ? null : (e.prevOff ? r2(e.prev - e.prevOff) : e.prev);
  const out = [];
  for (let k = 0; k <= n; k++) {
    const from = k ? sw[k - 1].nv : null, to = k < n ? (sw[k].v != null ? sw[k].v : disp(sw[k])) : null;
    const name = k === 0 ? 'Alter Zähler' : k === n ? 'Neuer Zähler' : (n > 2 ? k + '. Ersatzzähler' : 'Zwischenzeitlicher Zähler');
    const range = k === 0 ? (to != null ? 'bis ' + hv(to) : 'vor dem Wechsel') : k === n ? 'ab ' + hv(from) : hv(from) + ' bis ' + (to != null ? hv(to) : '…');
    out.push({c: k === 0 ? Math.max(0, sw[0].c - 1) : sw[k - 1].c, label: name + ' (' + range + ')'});
  }
  return out;
}
/* Montage von Reifen/Kette: Gesamtlaufleistung bei der Montage; amb = Tag eines Zählerwechsels ohne gespeicherte Stelle */
export function mountTot(b, x, d){
  d = d || S.der[b.id];
  if (!d || !x || x.at == null) return {tot: null, amb: false};
  if (!x.date) return {tot: d.off ? r2(x.at + d.off) : x.at, amb: false};
  const p = offAtPos(d.ev, x.date, x.c);
  return p.amb ? {tot: null, amb: true} : {tot: p.off ? r2(x.at + p.off) : x.at, amb: false};
}
/* Angaben, deren Zähler am Tag eines Zählerwechsels unklar ist (nur, wo sie noch etwas bewirken) */
export function ambList(b, d){
  d = d || S.der[b.id]; if (!d) return [];
  const out = [], u = U(b);
  (b.items || []).forEach(it => { const m = d.items[it.id]; if (it.every && m && m.src === 'base' && m.amb) out.push({kind: 'item', id: it.id, label: 'Startwert ' + it.name, at: it.lastAt, date: it.lastDate}); });
  const t = b.tires || {}, c = b.chain || {};
  [['front', t.front, 'Reifen vorn'], ['rear', t.rear, 'Reifen hinten']].forEach(([k, x, l]) => { if (x && x.model && mountTot(b, x, d).amb) out.push({kind: 'tire', id: k, label: l + ' montiert', at: x.at, date: x.date}); });
  if ((c.brand || c.front || c.rear) && mountTot(b, c, d).amb) out.push({kind: 'chain', id: 'chain', label: 'Kette montiert', at: c.at, date: c.date});
  return out;
}
export function derive(){
  const der = {};
  Object.values(S.bikes).forEach(b => { der[b.id] = deriveBike(b); });
  S.der = der;
}
/* Anzeige des eingebauten Zählers jetzt; Gesamtlaufleistung; Abstand zwischen beiden (nach einem Zählerwechsel) */
export const curOf = b => (b && S.der[b.id]) ? S.der[b.id].cur : null;
export const totOf = b => (b && S.der[b.id]) ? S.der[b.id].tot : null;
export const offOf = b => (b && S.der[b.id]) ? S.der[b.id].off : 0;
export const markOf = (b, it, d) => { d = d || (b && S.der[b.id]); return (d && d.items[it.id]) || null; };
/* Stand einer Wartung zur Anzeige: gemessen, aus dem Verlauf oder unbekannt. v = Anzeige damals, tot = Gesamt */
export function svcAtOf(l){
  if (l.kind !== 'service') return {v: l.at, tot: null, src: l.at == null ? 'unk' : 'mess'};
  const d = S.der[l.bike], tot = d && d.probe[l.id] != null ? d.probe[l.id] : null;
  if (isMeasured(l)) return {v: l.at, tot, src: 'mess'};
  if (isDerivedAt(l)) return {v: tot == null ? null : (d.poff[l.id] ? r2(tot - d.poff[l.id]) : tot), tot, src: 'auto'};
  return {v: null, tot: null, src: 'unk'};
}
/* Berechneter Stand an einer Stelle im Verlauf (vor einem neuen Eintrag mit Datum und Erfassungszeit):
   tot = Gesamtlaufleistung, off = Abstand zur Anzeige, disp = Anzeige des damals eingebauten Zählers */
export function posAt(bid, date, c, d){
  d = d || S.der[bid]; if (!d) return {tot: null, off: 0, disp: null};
  const key = {date, ph: 1, c, id: '￿'};
  let tot = null, off = 0;
  for (const e of d.ev) { if (cmpEv(e, key) >= 0) break; tot = e.tot; off = e.off; }
  return {tot, off, disp: tot == null ? null : (off ? r2(tot - off) : tot)};
}
export const valueAt = (bid, date, c) => posAt(bid, date, c).disp;
/* Auffälliger Sprung nach oben gegenüber dem passenden bisherigen Stand (Anzeige)? Ergebnis: Text der Rückfrage oder '' */
export function jumpText(b, at, prev){
  if (at == null || prev == null) return '';
  const diff = r2(at - prev), u = U(b);
  if (!(diff > JUMP[u === 'km' ? 'km' : 'h'] + 1e-9)) return '';
  return fmt(at, 2) + ' ' + u + ' übernehmen? Bisheriger Stand: ' + fmt(prev, 2) + ' ' + u + '. Das sind ' + fmt(diff, 2) + ' ' + u + ' mehr.';
}
/* ---------- Wartungslogik ---------- */
export function itemState(b, it, d){
  d = d || (b && S.der[b.id]) || null;
  const m = d ? (d.items[it.id] || null) : null, cur = d ? d.tot : null;
  const lastAt = m ? m.at : null, lastDate = m ? m.date : null;
  let remain = null, frac = null, days = null, dfrac = null;
  if (it.months && isISO(lastDate)) {
    days = dayNum(addMonths(lastDate, it.months)) - dayNum(todayISO());
    dfrac = days / (it.months * 30.44);
  }
  /* Widerspruch: die letzte Wartung steht bei mehr als dem heutigen Stand (meist nach einem Tippfehler).
     Dann keine Restlaufzeit ausrechnen, sondern zum Prüfen auffordern. */
  if (it.every && lastAt != null && cur != null && lastAt > cur + 0.005) return {s:'chk', used:0, remain: null, days, f: -1, frac: null, dfrac, m};
  /* Startwert vom Tag eines Zählerwechsels, ohne dass feststeht, welcher Zähler gemeint war: erst klären lassen */
  if (it.every && m && m.amb) return {s:'chk', amb: true, used:0, remain: null, days, f: -1, frac: null, dfrac, m};
  if (it.every && lastAt != null && cur != null) { remain = Math.round((lastAt + it.every - cur) * 100) / 100; frac = remain / it.every; }
  if (frac == null && dfrac == null) return {s:'unk', used:0, remain, days, f:Infinity, m};
  const f = Math.min(frac == null ? Infinity : frac, dfrac == null ? Infinity : dfrac);
  let s = 'ok';
  if ((remain != null && remain <= 0) || (days != null && days <= 0)) s = 'bad';
  else if (f <= 0.2 || (days != null && days <= 21)) s = 'warn';
  /* Fehlt die Grundlage für einen Teil des Intervalls (z. B. Stunden unbekannt, Datum bekannt),
     darf der Punkt nicht „in Ordnung“ wirken: fällig/bald fällig bleibt, sonst „Stand unbekannt“. */
  const partial = (it.every && frac == null) || (it.months && dfrac == null);
  if (s === 'ok' && partial) return {s:'unk', partial: true, used:0, remain, days, f, frac, dfrac, m};
  return {s, partial, used: Math.max(0, Math.min(1, 1 - f)), remain, days, f, frac, dfrac, m};
}
export function pillText(b, st){
  const u = U(b);
  const useHours = st.frac != null && (st.dfrac == null || st.frac <= st.dfrac);
  if (st.s === 'chk') return 'Wartungsstand prüfen';
  if (st.s === 'unk') return 'Stand unbekannt';
  if (useHours) {
    if (st.remain <= 0) return st.remain === 0 ? 'jetzt fällig' : fmt(-st.remain) + ' ' + u + ' drüber';
    return 'noch ' + fmt(st.remain) + ' ' + u;
  }
  if (st.days <= 0) return st.days === 0 ? 'heute fällig' : 'seit ' + (-st.days) + ' Tagen fällig';
  if (st.days > 75) return 'noch ' + Math.round(st.days / 30.44) + ' Mon.';
  return 'noch ' + st.days + ' Tage';
}
export const STATE_RANK = {bad:0, chk:1, warn:2, ok:3, unk:4};
export function sortedItems(b, d){
  return (b.items || []).map(it => ({it, st: itemState(b, it, d)}))
    .sort((x, y) => (STATE_RANK[x.st.s] - STATE_RANK[y.st.s]) || (x.st.f - y.st.f));
}
/* Stand einer Wartung: eingetippt = Messpunkt; heute leer = aus dem Verlauf (kein gespeicherter Wert,
   wird bei jeder Änderung neu berechnet); rückdatiert leer = unbekannt */
export function serviceAt(b, date, at){
  if (at != null) return {at, atAuto: false};
  if (date === todayISO()) return {at: null, atAuto: true};
  return {at: null, atAuto: false};
}

/* ---------- Einträge bauen (ein Dokument pro Vorgang) ---------- */
export function serviceDoc(b, o){
  const items = b.items || [];
  const tasks = (o.tasks || []).filter(id => items.some(i => i.id === id));
  const sa = serviceAt(b, o.date, o.at);
  const d = {bike: b.id, kind: 'service', date: o.date, at: sa.at, atAuto: sa.atAuto, tasks, taskNames: tasks.map(id => items.find(i => i.id === id).name),
    extra: o.extra || '', cost: o.cost == null ? null : o.cost, note: o.note || '', created: o.created || Date.now()};
  /* ab 1.2.0, nur wenn benutzt: erledigte Tätigkeiten und Originaleingabe */
  if (o.work && o.work.length) d.work = o.work.map(w => workEntry(w.id, w.name, w.detail, w.cat));
  if (o.orig && o.orig !== d.extra && o.orig !== d.note) d.orig = o.orig;
  if (o.photo) { d.photoId = o.photo.id; d.thumbId = o.photo.thumbId || ''; }
  return canonDoc('log', d);
}
export function snapOf(s){ if (!s) return null; const o = {track: s.track || '', updated: s.updated || null}; SF.forEach(([, k]) => { o[k] = s[k] == null ? null : s[k]; }); return o; }
export const sigOf = s => SF.map(([, k]) => s && s[k] != null ? s[k] : '').join('|');
export function rideDoc(b, o){
  const setup = o.setupId ? S.setups.find(s => s.id === o.setupId) : null;
  return canonDoc('rides', {bike: b.id, date: o.date, track: o.track || '', amount: o.amount, ground: o.ground || '', weather: o.weather || '',
    setupId: setup ? setup.id : '', setupSnap: setup ? snapOf(setup) : null, feel: o.feel || null, inReading: o.inReading === true, note: o.note || '', created: o.created || Date.now()});
}
export function noteDoc(b, o){
  const d = {bike: b.id, kind: 'note', date: o.date, at: o.at == null ? null : o.at, atAuto: false, tasks: [], taskNames: [], extra: o.extra || '', cost: o.cost == null ? null : o.cost, note: o.note || '', created: o.created || Date.now()};
  if (o.photo) { d.photoId = o.photo.id; d.thumbId = o.photo.thumbId || ''; }
  return canonDoc('log', d);
}
/* ---------- Schnell-Eintrag: Auswertung ---------- */
export const B = '(?<![\\wäöüß])', E = '(?![\\wäöüß])';
/* Ganze Zahl-Token inklusive Vorzeichen und Trennzeichen erfassen, dann mit derselben strikten Prüfung wie im Formular lesen */
export const NUM_TOK = '([-+−]?(?:\\d[\\d.,]*\\d|\\d)|' + Object.keys(NUMW).sort((a, b) => b.length - a.length).join('|') + ')';
export function tokNum(tok){ const w = NUMW[tok.toLowerCase()]; if (w != null) return {ok: true, value: w}; return parseNum(tok.replace('−', '-')); }
export const RIDE_RE = /(gefahren|fahrt|training|trainiert|runden|unterwegs|session|ausfahrt)/;
export const DONE_RE = /(gewechselt|getauscht|ausgetauscht|ersetzt|gemacht|repariert|eingebaut|erneuert|gereinigt|geputzt|geprüft|geprueft|kontrolliert|gecheckt|eingestellt|abgestimmt|nachgefüllt|nachgefuellt|geschmiert|gefettet|gespannt|entlüftet|entlueftet|nachgezogen|montiert|angebaut|aufgezogen|gewaschen|neu drauf|neue)/;
export const NEG_RE = new RegExp(B + '(nicht|kein|keine|keinen|keiner|nie|noch nicht)' + E);
export const PLAN_RE = new RegExp(B + '(muss|müsste|muesste|sollte|sollten|bald|demnächst|demnaechst|morgen|übermorgen|geplant|planen|vorhaben|bestellen|erinnere|erinnern)' + E + '|nächste woche|naechste woche');

/* Wartung, Fahrt und Notiz aus einem Text (unverändert aus Version 8). ctx: Motorrad und Datum aus dem ganzen Text.
   opts.keepNeg: Verneinung/Planung nicht als Notiz abfangen (bei ausdrücklichem Stichwort) */
function coreParse(text, ctx, opts){
  opts = opts || {};
  const t = ' ' + text.toLowerCase() + ' ';
  const b = ctx.b, bike = b.id, lim = LIM[U(b)], date = ctx.date;
  const problems = [];
  let cost = null;
  const cre = new RegExp(B + NUM_TOK + '\\s*(?:€|euro|eur)' + E + '|€\\s*' + NUM_TOK, 'g');
  let cm;
  while ((cm = cre.exec(t))) {
    const tok = cm[1] || cm[2], r = tokNum(tok);
    if (!r.ok) problems.push('„' + tok + '“ ist als Betrag unklar'); else if (r.value < 0 || r.value > MAX_COST) problems.push('Der Betrag „' + tok + '“ ist nicht möglich'); else if (cost == null) cost = r.value;
  }
  const unitRe = U(b) === 'km' ? '(?:km|kilometer)' : '(?:stunden|stunde|std\\.?|h|betriebsstunden)';
  const re = new RegExp('(bei|stand|auf|mit)?\\s*' + B + NUM_TOK + '\\s*' + unitRe + E, 'g');
  let at = null, amount = null, m;
  while ((m = re.exec(t))) {
    const r = tokNum(m[2]);
    if (!r.ok) { problems.push('„' + m[2] + ' ' + U(b) + '“ ist als Zahl unklar'); continue; }
    const v = r.value;
    if (v < 0) { problems.push('Negative Werte wie „' + m[2] + ' ' + U(b) + '“ sind nicht möglich'); continue; }
    if (m[1]) { if (v <= lim.cnt) at = v; else problems.push('Der Stand „' + m[2] + '“ ist zu groß'); }
    else if (amount == null && v > 0) amount = v;
  }
  /* Ab 1.2.0: erledigte Tätigkeiten aus dem Katalog (work.js) und getrennt davon die betroffenen Wartungsintervalle.
     Ein Intervall ist nur vorausgewählt, wenn die Tätigkeiten es vollständig abdecken; Stichwörter allein reichen nicht. */
  const wk0 = parseWork(text);
  /* Bloße Gegenstände ohne Tätigkeitswort zählen nur bei ausdrücklicher Wartung („Wartung: Luftfilter“) oder Erledigt-Wort */
  const wk = (wk0.acted || opts.service || DONE_RE.test(t)) ? wk0 : {works: [], open: []}, iv = ivProposal(b, wk.works, wk.open);
  const tasks = iv.filter(p => p.pre).map(p => p.item), iTask = workPos(text);
  const base = {bike, date, at: null, amount: null, tasks: [], extra: '', cost: null, track: null, note: text.trim()};
  /* Verneint oder geplant: nichts als erledigt behaupten */
  if (!opts.keepNeg && (NEG_RE.test(t) || PLAN_RE.test(t))) {
    return {entries: [Object.assign({}, base, {kind: 'note'})], warn: 'Das klingt nach etwas, das noch nicht erledigt ist. Ich schlage es deshalb nur als Notiz vor.'};
  }
  const iRide = t.search(RIDE_RE), iDone = t.search(DONE_RE);
  const rideWords = iRide >= 0, done = iDone >= 0;
  let track = null; const tm = text.match(/(?:\bin|\bauf|\bim|\bbei)\s+([A-ZÄÖÜ][\wäöüßÄÖÜ-]+(?:\s[A-ZÄÖÜ][\wäöüßÄÖÜ-]+)?)/);
  if (tm && !bikeList().some(x => [x.brand, x.short, shortName(x), x.model].filter(Boolean).some(w => String(w).toLowerCase() === tm[1].toLowerCase()))) track = tm[1];
  const isService = wk.works.length > 0 || wk.open.length > 0 || tasks.length > 0 || done;
  const isRide = rideWords && amount != null && amount <= lim.ride;
  const entries = [];
  /* Wartung: Tätigkeiten, offene Fragen und Intervallvorschlag; der eingegebene Text bleibt als Originaleingabe (orig),
     nicht noch einmal als Notiz. Ohne erkannte Tätigkeit bleibt er wie bisher als „Weitere Arbeiten“ (extra). */
  const svc = () => { const known = wk.works.length || wk.open.length; return Object.assign({}, base, {kind: 'service', at: at != null ? at : (!isRide && !rideWords && amount != null && amount <= lim.cnt ? amount : null), tasks: tasks.slice(), work: wk.works.map(w => Object.assign({}, w)), open: wk.open.map(q => Object.assign({}, q, {options: q.options.slice()})), extra: known ? '' : text.trim(), orig: known ? text.trim() : '', note: '', cost}); };
  if (isService && isRide) {
    /* Reihenfolge wie im Text; „vorher/davor/zuvor“ dreht sie um. Die Vorschau zeigt sie und lässt sie tauschen. */
    const iSvc = [iTask, iDone].filter(i => i >= 0).reduce((a, i) => Math.min(a, i), Infinity);
    let rideFirst = iRide < iSvc;
    if (/(vorher|davor|zuvor)/.test(t)) rideFirst = !rideFirst;
    const r = Object.assign({}, base, {kind: 'ride', amount, track});
    entries.push(...(rideFirst ? [r, svc()] : [svc(), r]));
  } else if (isService) entries.push(svc());
  else if (isRide) entries.push(Object.assign({}, base, {kind: 'ride', amount, track}));
  if (!entries.length) {
    if (rideWords || (amount != null && amount <= lim.ride)) entries.push(Object.assign({}, base, {kind: 'ride', amount: amount != null && amount <= lim.ride ? amount : null, track}));
    else if (cost != null) entries.push(Object.assign({}, base, {kind: 'service', at, extra: text.trim(), note: '', work: [], open: [], cost}));
    else entries.push(Object.assign({}, base, {kind: 'note', at, cost}));
  }
  const warn = [];
  if (problems.length) warn.push(problems.join('. ') + '. Bitte prüfen und gegebenenfalls über „Bearbeiten“ korrigieren.');
  if (entries.length > 1) warn.push('Ich habe zwei Tätigkeiten erkannt und in dieser Reihenfolge vorbereitet. Prüf beide.');
  else if (entries[0].kind === 'service' && entries[0].open && entries[0].open.length) warn.push('Bitte bei ' + entries[0].open.map(q => '„' + q.label + '“').join(', ') + ' auswählen, was gemacht wurde.');
  else if (entries[0].kind === 'service' && !entries[0].tasks.length && !(entries[0].work || []).length) warn.push('Keinem Wartungspunkt zugeordnet. Tipp auf „Bearbeiten“, um ihn auszuwählen.');
  if (entries.some(x => x.kind === 'ride' && x.amount == null)) warn.push('Bei der Fahrt fehlt eine gültige Fahrzeit.');
  return {entries, warn: warn.join(' ')};
}

/* ---------- Schnell-Eintrag: Stichwörter, Mängel, offene Punkte, Stand, Teile ----------
   Am Anfang (nach einem Motorradnamen) bestimmt ein Stichwort die Art, mit oder ohne Doppelpunkt:
     Mangel/Mängel/Defekt/Problem/Aufgabe/Todo → Mangel   Stand/Zählerstand/Kilometerstand → Ablesung
     Gekauft/Vorrat → Teilevorrat erhöhen                  Kaufen/Bestellen/Einkauf → Teil als knapp markieren
     Notiz → Notiz   Fahrt/Training → Fahrt   Wartung/Service/Erledigt → Wartung
   Ohne Stichwort: Schadenswörter (locker, undicht, quietscht …) ohne Erledigt-Wort → Mangel;
   ein Wartungspunkt mit Verb in der Grundform ohne Erledigt-Wort („Kette spannen“) → offener Mangel. */
export const QUICK_CMDS = [
  ['defect', ['mängel', 'maengel', 'mangel', 'defekt', 'problem', 'todo', 'to-do', 'aufgabe', 'offen']],
  ['reading', ['zählerstand', 'zaehlerstand', 'kilometerstand', 'km-stand', 'betriebsstunden', 'stand', 'tacho']],
  ['bought', ['gekauft', 'eingekauft', 'vorrat']],
  ['buy', ['einkaufsliste', 'einkaufen', 'einkauf', 'kaufen', 'bestellen', 'besorgen']],
  ['note', ['notiz', 'info', 'merken']],
  ['ride', ['fahrt', 'training']],
  ['service', ['wartung', 'service', 'erledigt']]
];
export const DEFECT_RE = new RegExp(B + '(mängel|maengel|mangel|defekt|kaputt|locker|undicht|leckt|leck' + E + '|tropft|sifft|schwitzt|verbogen|gerissen|gebrochen|abgebrochen|klappert|quietscht|schleift|rasselt|rattert|ölverlust|oelverlust|verschlissen|abgenutzt|rissig|porös|poroes|schwammig|hakt|klemmt|wackelt|ausgefallen|fehlt|beschädigt|beschaedigt|delle' + E + '|riss' + E + '|hat spiel|spiel (?:im|am|in)|geht nicht|funktioniert nicht|springt nicht an|zieht nicht|bremst schlecht|rutscht|ruckelt|stottert|vibriert|qualmt|raucht|verliert|geht aus|säuft ab|saeuft ab|nimmt kein gas|zieht schlecht)');
export const TODO_RE = new RegExp(B + '(spannen|wechseln|tauschen|austauschen|ersetzen|prüfen|pruefen|kontrollieren|checken|reinigen|sauber machen|schmieren|ölen|oelen|fetten|nachfüllen|nachfuellen|einstellen|entlüften|entlueften|reparieren|richten|erneuern|einbauen|nachziehen|anziehen|machen)' + E);
const PRIO_HIGH_RE = new RegExp(B + '(dringend|sofort|gefährlich|gefaehrlich|wichtig|sicherheit)');
const PRIO_LOW_RE = new RegExp(B + '(irgendwann|später|spaeter|kein stress|nicht eilig|kosmetisch|optisch)');
const KIND_TEXT = {defect: 'Mangel', reading: 'Stand', bought: 'Teilevorrat', buy: 'Einkaufsliste', note: 'Notiz', ride: 'Fahrt', service: 'Wartung'};
const lc = s => ' ' + String(s).toLowerCase() + ' ';
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
/* Satzteile trennen, ohne Zahlen zu zerlegen: Komma oder Punkt zwischen zwei Ziffern gehört zur Zahl
   („1,5“, „1.5“, „12.400“, „24.10.“). Getrennt wird an ; ! ? Zeilenumbruch, an , und . außerhalb von Zahlen
   sowie an „und“, „aber“, „sowie“. */
const CLAUSE_RE = /\s*(?:[;!?\n]|(?<!\d)[,.]|[,.](?!\d))+\s*|\s+(?:und|aber|sowie)\s+/i;
export const splitClauses = s => String(s).split(CLAUSE_RE).map(c => c.trim()).filter(Boolean);
/* Satzteil mit Schadenswort und ohne Erledigt-Wort (dann ist „funktioniert nicht“ ein Schaden, keine Verneinung) */
const isDefectClause = c => DEFECT_RE.test(lc(c)) && !DONE_RE.test(lc(c));
/* Verneint oder geplant („nicht“, „noch nicht“, „kein“, „morgen“, „sollte“, „nächste Woche“ …), außerhalb von Schadens-Satzteilen */
const openClause = s => splitClauses(s).some(c => !isDefectClause(c) && (NEG_RE.test(lc(c)) || PLAN_RE.test(lc(c))));

function bikeWords(x){
  const w = [x.brand, x.short, shortName(x), x.model].filter(Boolean).map(v => String(v).toLowerCase());
  if (String(x.brand || '').toLowerCase() === 'ktm') w.push('exc', 'katie');
  if (String(x.brand || '').toLowerCase() === 'husqvarna') w.push('husi', 'husq', 'fc');
  return w;
}
/* Motorrad und Datum aus dem ganzen Text */
function parseCtx(text){
  const t = lc(text);
  let bike = S.bike;
  const named = bikeList().filter(x => bikeWords(x).some(w => new RegExp(B + reEsc(w) + E).test(t)));
  if (named.length) bike = named[0].id;
  const b = S.bikes[bike] || curBike();
  let date = todayISO();
  if (/vorgestern/.test(t)) date = shiftDate(-2); else if (/gestern/.test(t)) date = shiftDate(-1);
  const dm = t.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})?/);
  if (dm) { let y = dm[3] ? +dm[3] : new Date().getFullYear(); if (y < 100) y += 2000; const iso = y + '-' + pad(+dm[2]) + '-' + pad(+dm[1]); if (isISO(iso) && iso <= todayISO()) date = iso; }
  const words = Array.from(new Set(bikeList().flatMap(bikeWords))).sort((a, c) => c.length - a.length);
  return {b, date, named: named.length > 0, words};
}
/* Motorradnamen, Datumswörter und Satzzeichen am Anfang entfernen */
function stripLead(s, ctx){
  let x = String(s).trim(), prev;
  do {
    prev = x;
    x = x.replace(/^[\s:;,.\-–—]+/, '');
    for (const w of ctx.words) { const m = x.match(new RegExp('^' + reEsc(w) + E, 'i')); if (m) { x = x.slice(m[0].length); break; } }
    x = x.replace(/^(heute|gestern|vorgestern)(?![\wäöüß])/i, '');
  } while (x !== prev);
  return x.trim();
}
/* Stichwort am Anfang? → {kind, rest} */
function quickCommand(text, ctx){
  const x = stripLead(text, ctx), low = x.toLowerCase();
  for (const [kind, ws] of QUICK_CMDS) {
    for (const w of ws) {
      if (low.startsWith(w) && !/[\wäöüß]/.test(low.charAt(w.length) || ' ')) {
        let rest = x.slice(w.length).replace(/^\s*[:\-–—]?\s*/, '');
        return {kind, rest: stripLead(rest, ctx), word: cap(x.slice(0, w.length))};
      }
    }
  }
  return null;
}
function priorityOf(text){ const t = lc(text); return PRIO_HIGH_RE.test(t) ? 'high' : PRIO_LOW_RE.test(t) ? 'low' : 'mid'; }
function defectEntry(clause, ctx, full, extraDesc){
  /* Prioritätswörter bestimmen die Priorität und bleiben nicht im Titel */
  let title = cap(stripLead(clause, ctx).replace(/[\s,;:]*(dringend|sofort|wichtig|irgendwann|später|spaeter|kein stress|nicht eilig)[\s.!]*$/i, '').replace(/[\s.,;:!?]+$/, ''));
  let description = extraDesc || '';
  if (title.length > 120) { const cut = title.lastIndexOf(' ', 117); description = (title + (description ? '\n' + description : '')); title = title.slice(0, cut > 40 ? cut : 117) + ' …'; }
  return {kind: 'defect', bike: ctx.b.id, date: ctx.date, title, description, priority: priorityOf(full), note: full.trim()};
}
/* Teile aus „2 Ölfilter, 1 Zündkerze“ */
function partItems(rest){
  /* Komma zwischen zwei Ziffern gehört zur Zahl („1,5“), sonst trennt es zwei Teile */
  return rest.split(/\s*(?:;|(?<!\d),|,(?!\d)|\s(?:und|sowie)\s)\s*/i).map(s => s.trim()).filter(Boolean).map(s => {
    let qty = null, name = s;
    const m = s.match(new RegExp('^' + NUM_TOK + '\\s*(?:x|×|stück|stueck|stk\\.?|mal)?\\s+(.+)$', 'i')) || null;
    const m2 = !m && s.match(new RegExp('^(.+?)\\s+' + NUM_TOK + '\\s*(?:x|×|stück|stueck|stk\\.?)?$', 'i'));
    if (m) { const r = tokNum(m[1]); if (r.ok) { qty = r.value; name = m[2]; } }
    else if (m2) { const r = tokNum(m2[2]); if (r.ok) { qty = r.value; name = m2[1]; } }
    return {name: cap(name.replace(/[\s.,;:!?]+$/, '').trim()).slice(0, 120), qty};
  }).filter(p => p.name);
}
const normName = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
function partEntries(kind, rest, ctx){
  const out = [], notes = [];
  partItems(rest).forEach(it => {
    const n = it.qty;
    if (n != null && (!Number.isInteger(n) || n < 0 || n > 99999)) { notes.push('Die Anzahl bei „' + it.name + '“ ist unklar'); return; }
    const ex = S.parts.find(p => normName(p.name) === normName(it.name) && partFor(p, ctx.b.id));
    const base = {kind: 'part', mode: kind, bike: ctx.b.id, date: ctx.date, name: ex ? ex.name : it.name, partId: ex ? ex.id : '', count: n == null ? (kind === 'bought' ? 1 : 0) : n};
    if (kind === 'bought') out.push(Object.assign(base, ex ? {before: ex.qty, after: Math.min(99999, ex.qty + base.count), min: ex.min} : {before: null, after: base.count, min: 1}));
    else if (ex) {
      if (ex.qty <= ex.min) notes.push('„' + ex.name + '“ ist schon als knapp markiert (' + ex.qty + ' im Vorrat)');
      else out.push(Object.assign(base, {before: ex.qty, after: ex.qty, min: ex.qty, minBefore: ex.min}));
    } else out.push(Object.assign(base, {before: null, after: 0, min: 1}));
  });
  return {out, notes};
}
function readingEntry(rest, ctx){
  const b = ctx.b, lim = LIM[U(b)];
  const m = lc(rest).match(new RegExp(B + NUM_TOK));
  const e = {kind: 'reading', bike: b.id, date: ctx.date, at: null};
  if (!m) return {e, problem: 'Keine Zahl für den Stand gefunden'};
  const r = tokNum(m[1]);
  if (!r.ok) return {e, problem: '„' + m[1] + '“ ist als Stand unklar'};
  if (r.value < 0 || r.value > lim.cnt) return {e, problem: 'Der Stand „' + m[1] + '“ ist nicht möglich'};
  e.at = r.value;
  return {e, problem: ''};
}
const withBase = (ctx, text) => ({bike: ctx.b.id, date: ctx.date, at: null, amount: null, tasks: [], extra: '', cost: null, track: null, note: text.trim()});
/* Den ganzen eingegebenen Text behalten: bei einer Wartung als Originaleingabe (einklappbar, nicht als Notiz und nicht
   doppelt), sonst als Notiz wie bisher */
function keepText(x, text){
  if (x.kind !== 'service') { x.note = text.trim(); return; }
  x.note = '';
  x.orig = x.extra === text.trim() ? '' : text.trim();
}

export function localParse(text){
  const ctx = parseCtx(text);
  const cmd = quickCommand(text, ctx);
  if (cmd) {
    const k = cmd.kind, rest = cmd.rest, warn = [];
    if (k === 'defect') {
      const e = defectEntry(rest, ctx, text);
      if (!e.title) warn.push('Gib dem Mangel einen Titel, z. B. „Mangel: Kette locker“.');
      return {entries: [e], warn: warn.join(' '), cmd: k};
    }
    if (k === 'reading') {
      const r = readingEntry(rest, ctx);
      if (r.problem) warn.push(r.problem + '. Tipp auf „Bearbeiten“.');
      return {entries: [r.e], warn: warn.join(' '), cmd: k};
    }
    if (k === 'bought' || k === 'buy') {
      const r = partEntries(k, rest, ctx);
      if (!r.out.length && !r.notes.length) warn.push('Kein Teil erkannt, z. B. „' + (k === 'bought' ? 'Gekauft: 2 Ölfilter' : 'Kaufen: Bremsbeläge vorn') + '“.');
      if (r.notes.length) warn.push(r.notes.join('. ') + '.');
      return {entries: r.out, warn: warn.join(' '), cmd: k};
    }
    if (k === 'note') return {entries: [Object.assign(withBase(ctx, text), {kind: 'note', note: rest || text.trim()})], warn: '', cmd: k};
    /* Fahrt oder Wartung ausdrücklich. Das Stichwort bestimmt nur die Art. Ist etwas verneint oder geplant
       („Wartung: Öl noch nicht gewechselt“, „Wartung: morgen Öl wechseln“), entsteht daraus nie eine erledigte
       Wartung oder Fahrt: Es gilt dieselbe Auswertung wie ohne Stichwort (verneint → Notiz, geplante Tätigkeit
       → offener Mangel), mit Hinweis. Schadenswörter wie „funktioniert nicht“ zählen nicht als Verneinung. */
    if (openClause(rest || text)) {
      const r = naturalParse(rest || text, ctx, text);
      const es = r.entries.filter(x => x.kind !== 'ride' && x.kind !== 'service');
      if (!es.length) es.push(Object.assign(withBase(ctx, text), {kind: 'note'}));
      es.forEach(x => { if (x.kind === 'note') x.note = text.trim(); });
      const asDefect = es.every(x => x.kind === 'defect');
      return {entries: es, warn: 'Trotz „' + cmd.word + '“ keine erledigte ' + (k === 'ride' ? 'Fahrt' : 'Wartung') + ': Der Text klingt verneint oder geplant („nicht“, „morgen“ …). '
        + (asDefect ? (es.length > 1 ? 'Ich lege offene Mängel an.' : 'Ich lege es als offenen Mangel an.') : 'Ich schlage es als Notiz vor.') + ' Ist es doch erledigt, tipp auf „Bearbeiten“.', cmd: k};
    }
    const r = coreParse(rest || text, ctx, {keepNeg: true, service: k === 'service'});
    let es = r.entries.filter(x => x.kind === k);
    if (!es.length) es = [Object.assign(withBase(ctx, text), k === 'ride' ? {kind: 'ride'} : {kind: 'service', extra: rest || text.trim(), work: [], open: []})];
    es.forEach(x => keepText(x, text));
    let w = r.warn;
    if (k === 'ride' && es.some(x => x.amount == null) && !/fehlt eine gültige Fahrzeit/.test(w)) w = (w ? w + ' ' : '') + 'Bei der Fahrt fehlt eine gültige Fahrzeit.';
    return {entries: es, warn: w, cmd: k};
  }
  return naturalParse(text, ctx, text);
}
/* Auswertung ohne Stichwort. text: der auszuwertende Text, full: der ganze eingetippte Text (für die Notiz) */
function naturalParse(text, ctx, full){
  const t = lc(text);
  /* Schadenswörter ohne Erledigt-Wort: Mangel. Ein kurzer Nachsatz wie „gespannt“ gehört zum Satz davor.
     Zahlen bleiben beim Aufteilen ganz („1,5 Stunden gefahren, Gabel schwitzt“ → 1,5 Stunden). */
  const raw = splitClauses(text);
  const clauses = [];
  raw.forEach(c => { const words = c.split(/\s+/).length; if (clauses.length && words <= 2 && DONE_RE.test(lc(c))) clauses[clauses.length - 1] += ', ' + c; else clauses.push(c); });
  const defects = clauses.filter(isDefectClause);
  if (defects.length) {
    const others = clauses.filter(c => !defects.includes(c));
    const entries = [], left = [], warn = [];
    if (others.length) {
      const r = coreParse(others.join(', '), ctx, {});
      r.entries.forEach(x => {
        keepText(x, full);
        if (x.kind === 'ride' && x.amount != null) entries.push(x);
        else if (x.kind === 'service' && (x.tasks.length || DONE_RE.test(lc(others.join(' '))))) entries.push(x);
      });
      if (!entries.length) left.push(...others.map(c => stripLead(c, ctx)).filter(Boolean));
      else if (r.warn) warn.push(r.warn);
    }
    defects.forEach((c, i) => entries.push(defectEntry(c, ctx, full, i === 0 && left.length ? left.join(', ') : '')));
    warn.push(defects.length > 1 ? 'Ich habe ' + defects.length + ' Mängel erkannt.' : 'Als Mangel erkannt.');
    if (entries.length > 1) warn.push('Prüf die Einträge; einzelne kannst du entfernen.');
    return {entries, warn: warn.join(' ')};
  }
  /* Wartungspunkt mit Verb in der Grundform, ohne Erledigt-Wort: offener Punkt, nicht erledigt */
  if (!DONE_RE.test(t) && !RIDE_RE.test(t) && !NEG_RE.test(t) && TODO_RE.test(t)) {
    return {entries: [defectEntry(text, ctx, full)], warn: 'Das klingt nach etwas, das noch zu tun ist. Ich lege es als offenen Mangel an. Ist es schon erledigt, schreib z. B. „gespannt“ oder „gewechselt“ dazu.'};
  }
  return coreParse(text, ctx, {});
}
export const quickKindText = k => KIND_TEXT[k] || k;
/* ---------- Sicherungen prüfen ---------- */
export const NAMES = {bikes: 'Motorrad', log: 'Logbuch-Eintrag', rides: 'Fahrt', setups: 'Setup', parts: 'Teil', defects: 'Mangel'};
/* Schlüssel in der Sicherungsdatei (deutsch, wie seit Version 3) */
export const KEYS = {bikes: 'motorraeder', log: 'logbuch', rides: 'fahrten', setups: 'fahrwerk', parts: 'teile', defects: 'maengel'};
export const FILE_TYPES = ['image/jpeg', 'image/webp', 'image/png', 'application/pdf'];
export const MAX_FILE = 40 * 1024 * 1024;
const bikeLabel = b => '„' + ((str(b.brand) + ' ' + str(b.model)).trim() || 'Motorrad') + '“';

/* Gemeinsame strenge Prüfung aller Bereiche; liefert {bikes:{id:doc}, log:{…}, …} */
function strictCollections(map){
  if (!Array.isArray(map.bikes)) throw new Error('In der Sicherung fehlen die Motorräder.');
  const next = {};
  COLLS.forEach(k => {
    next[k] = {};
    const arr = map[k] == null ? [] : map[k];
    if (!Array.isArray(arr)) throw new Error('Der Bereich „' + NAMES[k] + '“ ist beschädigt.');
    if (arr.length > 5000) throw new Error('Zu viele Einträge im Bereich „' + NAMES[k] + '“.');
    arr.forEach((x, i) => {
      const where = NAMES[k] + ' ' + (i + 1);
      if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Error(where + ' ist ungültig.');
      if (!validId(x.id)) throw new Error(where + ' hat eine ungültige ID.');
      if (Object.prototype.hasOwnProperty.call(next[k], x.id)) throw new Error(where + ' kommt doppelt vor.');
      next[k][x.id] = cleanDoc(k, x, true, where);
    });
  });
  const bikeIds = new Set(Object.keys(next.bikes));
  ['log', 'rides', 'setups', 'defects'].forEach(k => Object.keys(next[k]).forEach(id => { if (!bikeIds.has(next[k][id].bike)) throw new Error(NAMES[k] + ' „' + id + '“ gehört zu keinem Motorrad in der Sicherung.'); }));
  Object.keys(next.parts).forEach(id => { const p = next.parts[id]; if (p.bike !== 'both' && p.bike !== 'some' && !bikeIds.has(p.bike)) throw new Error('Teil „' + p.name + '“ gehört zu keinem Motorrad in der Sicherung.');
    if (p.bike === 'some') p.bikes.forEach(b => { if (!bikeIds.has(b)) throw new Error('Teil „' + p.name + '“ ist einem Motorrad zugeordnet, das nicht in der Sicherung steht.'); }); });
  /* Gleiche Grenzen wie im Formular, abhängig von der Einheit des Motorrads */
  Object.keys(next.bikes).forEach(id => {
    const b = next.bikes[id], lim = LIM[b.unit === 'km' ? 'km' : 'h'], n = 'Motorrad ' + bikeLabel(b);
    if (b.current != null && b.current > lim.cnt) throw new Error(n + ': Stand liegt außerhalb des erlaubten Bereichs.');
    b.items.forEach(it => { if ((it.every != null && it.every > lim.cnt) || (it.lastAt != null && it.lastAt > lim.cnt)) throw new Error(n + ', Wartungspunkt „' + it.name + '“: Wert liegt außerhalb des erlaubten Bereichs.'); });
  });
  const today = todayISO();
  Object.keys(next.log).forEach(id => { const l = next.log[id], lim = LIM[next.bikes[l.bike].unit === 'km' ? 'km' : 'h']; if (l.at != null && l.at > lim.cnt) throw new Error('Logbuch-Eintrag „' + id + '“: Stand liegt außerhalb des erlaubten Bereichs.'); if (l.date > today) throw new Error('Logbuch-Eintrag „' + id + '“: Datum liegt in der Zukunft.'); });
  Object.keys(next.rides).forEach(id => { const r = next.rides[id], lim = LIM[next.bikes[r.bike].unit === 'km' ? 'km' : 'h']; if (r.amount != null && r.amount > lim.ride) throw new Error('Fahrt „' + id + '“: Fahrzeit liegt außerhalb des erlaubten Bereichs.'); if (r.date > today) throw new Error('Fahrt „' + id + '“: Datum liegt in der Zukunft.'); });
  Object.keys(next.defects).forEach(id => { const d = next.defects[id]; if (d.date > today || (d.doneDate && d.doneDate > today)) throw new Error('Mangel „' + d.title + '“: Datum liegt in der Zukunft.'); });
  return next;
}

/* Teil „verwaist“ einer Sicherung (Version 5) prüfen: dieselben Regeln wie für normale Einträge, aber das
   Motorrad darf (und muss) fehlen. Ergebnis: {coll: {id: doc}} */
function strictOrphans(v, next){
  const out = {}; DEP_COLLS.forEach(k => { out[k] = {}; });
  if (v == null) return out;
  if (typeof v !== 'object' || Array.isArray(v)) throw new Error('Der Teil „verwaist“ der Sicherung ist beschädigt.');
  const bikeIds = new Set(Object.keys(next.bikes)), today = todayISO();
  Object.keys(v).forEach(key => {
    const k = DEP_COLLS.find(c => KEYS[c] === key);
    if (!k) throw new Error('Der Teil „verwaist“ enthält einen unbekannten Bereich.');
    const arr = v[key];
    if (!Array.isArray(arr)) throw new Error('Der Teil „verwaist“ ist beschädigt.');
    if (arr.length > 5000) throw new Error('Zu viele verwaiste Einträge.');
    arr.forEach((x, i) => {
      const where = 'Verwaister Eintrag (' + NAMES[k] + ') ' + (i + 1);
      if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Error(where + ' ist ungültig.');
      if (!validId(x.id)) throw new Error(where + ' hat eine ungültige ID.');
      if (Object.prototype.hasOwnProperty.call(next[k], x.id) || Object.prototype.hasOwnProperty.call(out[k], x.id)) throw new Error(where + ' kommt doppelt vor.');
      const d = cleanDoc(k, x, true, where);
      if (!isOrphan(k, d, bikeIds)) throw new Error(where + ' gehört doch zu einem Motorrad der Sicherung.');
      const lim = LIM.km;
      if (k === 'log' && d.at != null && d.at > lim.cnt) throw new Error(where + ': Stand liegt außerhalb des erlaubten Bereichs.');
      if (k === 'rides' && d.amount != null && d.amount > lim.ride) throw new Error(where + ': Fahrzeit liegt außerhalb des erlaubten Bereichs.');
      if ((d.date && d.date > today) || (d.doneDate && d.doneDate > today)) throw new Error(where + ': Datum liegt in der Zukunft.');
      out[k][x.id] = d;
    });
  });
  return out;
}

/* Alle Dateien, auf die Einträge verweisen: id -> Beschreibung (für Fehlermeldungen und Aufräumen) */
export function fileRefs(next){
  const refs = new Map();
  const add = (id, what) => { if (validId(id) && !refs.has(id)) refs.set(id, what); };
  Object.values(next.bikes || {}).forEach(b => {
    if (b.photo) { add(b.photo.id, 'Foto von ' + bikeLabel(b)); add(b.photo.thumbId, 'Vorschaubild von ' + bikeLabel(b)); }
    if (b.manual && b.manual.kind === 'pdf') add(b.manual.fileId, 'Anleitung „' + (b.manual.name || 'PDF') + '“ von ' + bikeLabel(b));
  });
  Object.values(next.log || {}).forEach(l => { add(l.photoId, 'Foto im Logbuch vom ' + fmtDate(l.date)); add(l.thumbId, 'Vorschaubild im Logbuch vom ' + fmtDate(l.date)); });
  Object.values(next.defects || {}).forEach(d => (d.photos || []).forEach((p, i) => { add(p.id, 'Foto ' + (i + 1) + ' zum Mangel „' + d.title + '“'); add(p.thumbId, 'Vorschaubild ' + (i + 1) + ' zum Mangel „' + d.title + '“'); }));
  Object.values(next.parts || {}).forEach(p => { if (p && p.photo) { add(p.photo.id, 'Bild zum Artikel „' + p.name + '“'); add(p.photo.thumbId, 'Vorschaubild zum Artikel „' + p.name + '“'); } });
  return refs;
}

/* JSON-Sicherung aus der Claude-App (Version 3/4 ohne Kennung, 2 = Version 5, 3 = Version 6–8).
   Hochgeladene Fotos und PDF-Anleitungen liegen dort in Claudes Dateispeicher und sind nur verlinkt.
   Sie werden nicht übernommen, sondern einzeln als fehlend benannt; Web-Links zu Anleitungen bleiben. */
export function validateV8Backup(d){
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('Die Datei enthält keine Racebook-Sicherung.');
  if (d.format === ZIP_FORMAT) throw new Error('Das ist der Inhalt einer ZIP-Sicherung. Bitte die ganze ZIP-Datei auswählen.');
  if (d.format != null && d.format !== 'racebook') throw new Error('Die Datei stammt nicht aus Racebook.');
  if (d.format == null && d.version != null) throw new Error('Die Sicherungsversion ist unbekannt.');
  if (d.format != null) {
    if (!Number.isInteger(d.version) || d.version < 2) throw new Error('Die Sicherungsversion ist unbekannt.');
    if (d.version > V8_BACKUP_VERSION) throw new Error('Die Sicherung stammt aus einer neueren Racebook-Version (' + d.version + ') und kann hier nicht gelesen werden.');
  }
  if (!Array.isArray(d.motorraeder)) throw new Error('In der Sicherung fehlen die Motorräder.');
  if ((Array.isArray(d.logbuch) ? d.logbuch : []).some(l => l && typeof l === 'object' && (l.kind === 'meter' || l.fix != null || hasV8Log(l)))) throw new Error('Die Sicherung ist beschädigt (unbekannte Einträge im Logbuch).');
  const missing = [];
  const arr = v => Array.isArray(v) ? v.map(x => (x && typeof x === 'object' && !Array.isArray(x)) ? Object.assign({}, x) : x) : v;
  const map = {bikes: arr(d.motorraeder), log: arr(d.logbuch), rides: arr(d.fahrten), setups: arr(d.fahrwerk), parts: arr(d.teile), defects: []};
  const bikeById = {};
  map.bikes.forEach(b => { if (b && typeof b === 'object' && validId(b.id)) bikeById[b.id] = b; });
  map.bikes.forEach(b => {
    if (!b || typeof b !== 'object') return;
    delete b.photo;
    const m = b.manual;
    if (m && typeof m === 'object') {
      const url = str(m.url);
      if (m.kind === 'pdf' || m.assetId || /^\/_blob\//.test(url)) {
        missing.push({where: 'Motorrad ' + bikeLabel(b), what: 'Anleitung „' + (str(m.name) || 'PDF') + '“ (in der Claude-App hochgeladen)'});
        b.manual = null;
      } else b.manual = safeUrl(url) ? {kind: 'link', url: safeUrl(url), name: typeof m.name === 'string' ? m.name : ''} : m;
    }
  });
  (map.log || []).forEach(l => {
    if (!l || typeof l !== 'object') return;
    if (l.photoId || l.photoUrl) {
      const b = bikeById[l.bike];
      missing.push({where: 'Logbuch vom ' + (isISO(l.date) ? fmtDate(l.date) : '?') + (b ? ', ' + bikeLabel(b) : ''), what: 'Foto (in der Claude-App hochgeladen)'});
    }
    delete l.photoId; delete l.photoUrl; delete l.thumbId; delete l.repairOf;
  });
  const next = strictCollections(map);
  return {next, missing, files: [], source: 'v8', version: d.format == null ? 1 : d.version, exported: typeof d.exportiert === 'string' ? d.exportiert : ''};
}

/* racebook.json aus einer ZIP-Sicherung der eigenständigen App */
export function validateZipJson(d){
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('Die Sicherung enthält keine lesbaren Racebook-Daten.');
  if (d.format !== ZIP_FORMAT) throw new Error('Die ZIP-Datei ist keine Racebook-Sicherung.');
  if (!Number.isInteger(d.version) || d.version < 4) throw new Error('Die Sicherungsversion ist unbekannt.');
  if (d.version > ZIP_VERSION) throw new Error('Die Sicherung stammt aus einer neueren Racebook-Version (' + d.version + ') und kann hier nicht gelesen werden. Bitte die App aktualisieren.');
  if (d.version < 5 && d.verwaist != null) throw new Error('Die Sicherung ist beschädigt (unerwarteter Teil „verwaist“).');
  const logs = [].concat(Array.isArray(d.logbuch) ? d.logbuch : [], d.verwaist && Array.isArray(d.verwaist.logbuch) ? d.verwaist.logbuch : []);
  if (d.version < 6 && logs.some(l => l && typeof l === 'object' && (l.kind === 'meter' || l.fix != null))) throw new Error('Die Sicherung ist beschädigt (Zählerwechsel oder Berichtigungen in einer Sicherung vor Version 6).');
  if (d.version < 8 && (logs.some(hasV8Log) || (Array.isArray(d.motorraeder) ? d.motorraeder : []).some(hasV8Bike))) throw new Error('Die Sicherung ist beschädigt (Tätigkeiten, Checkliste oder Favoriten in einer Sicherung vor Version 8).');
  if (d.version < 9 && d.navigation != null) throw new Error('Menübelegung in einer Sicherung vor Version 9.');
  const teile = [].concat(Array.isArray(d.teile) ? d.teile : [], d.verwaist && Array.isArray(d.verwaist.teile) ? d.verwaist.teile : []);
  if (d.version < 10 && teile.some(hasV10Part)) throw new Error('Die Sicherung ist beschädigt (Artikelangaben oder Artikelbilder in einer Sicherung vor Version 10).');
  if (d.version < 11 && teile.some(hasV11Part)) throw new Error('Die Sicherung ist beschädigt (Mehrfachzuordnung oder Einkaufspreise in einer Sicherung vor Version 11).');
  const navigation = navigationOf(d.navigation);
  const map = {}; COLLS.forEach(k => { map[k] = d[KEYS[k]]; });
  const next = strictCollections(map);
  const orphans = strictOrphans(d.verwaist, next);
  const all = mergeOrphans(next, orphans);
  if (d.dateien != null && !Array.isArray(d.dateien)) throw new Error('Die Dateiliste der Sicherung ist beschädigt.');
  const files = [], seen = new Set();
  (d.dateien || []).forEach((f, i) => {
    const w = 'Datei ' + (i + 1);
    if (!f || typeof f !== 'object' || Array.isArray(f)) throw new Error(w + ' ist ungültig.');
    if (!validId(f.id)) throw new Error(w + ' hat eine ungültige ID.');
    if (seen.has(f.id)) throw new Error(w + ' kommt doppelt vor.');
    seen.add(f.id);
    if (!FILE_TYPES.includes(f.type)) throw new Error(w + ' („' + str(f.name) + '“) hat einen nicht erlaubten Dateityp.');
    if (!Number.isInteger(f.size) || f.size < 0 || f.size > MAX_FILE) throw new Error(w + ' hat eine ungültige Größe.');
    if (typeof f.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(f.sha256)) throw new Error(w + ' hat keine gültige Prüfsumme.');
    if (f.path !== 'dateien/' + f.id) throw new Error(w + ' hat einen ungültigen Pfad.');
    files.push({id: f.id, name: typeof f.name === 'string' ? f.name.slice(0, 200) : '', type: f.type, size: f.size, sha256: f.sha256, path: f.path,
      w: Number.isInteger(f.w) && f.w > 0 ? f.w : null, h: Number.isInteger(f.h) && f.h > 0 ? f.h : null, created: Number.isInteger(f.created) && f.created > 0 ? f.created : 0});
  });
  /* Anhänge, die schon beim Erstellen der Sicherung fehlten, stehen in „fehlend“ und werden nur benannt.
     Fehlt ein Anhang ohne diesen Vermerk, ist die Sicherung beschädigt. */
  const known = new Set(Array.isArray(d.fehlend) ? d.fehlend.filter(validId) : []);
  const missing = [], broken = [], needed = new Set();
  fileRefs(all).forEach((what, id) => { if (seen.has(id)) needed.add(id); else if (known.has(id)) missing.push(what); else broken.push(what); });
  if (broken.length) throw new Error('In der Sicherung fehlen Anhänge: ' + broken.join('; ') + '.');
  const meta = d.stand && typeof d.stand === 'object' ? d.stand : {};
  return {next, navigation, orphans, missing, files: files.filter(f => needed.has(f.id)), needed, source: 'zip', version: d.version,
    exported: typeof d.exportiert === 'string' ? d.exportiert : '', changeSeq: Number.isInteger(meta.changeSeq) ? meta.changeSeq : null};
}

/* ---------- Übersicht: Zustand je Motorrad ---------- */
export const STATE_TEXT = {ok: 'in Ordnung', warn: 'bald fällig', bad: 'überfällig', chk: 'Wartungsstand prüfen', unk: 'Stand unbekannt', none: 'keine Wartungspunkte'};
export const openDefects = bid => S.defects.filter(d => d.bike === bid && d.status !== 'done');
export function bikeStatus(b){
  const list = sortedItems(b);
  const n = {bad: 0, chk: 0, warn: 0, ok: 0, unk: 0};
  list.forEach(x => { n[x.st.s]++; });
  const state = !list.length ? 'none' : n.bad ? 'bad' : n.chk ? 'chk' : n.warn ? 'warn' : n.unk ? 'unk' : 'ok';
  /* Nächste Wartung: dringendster Punkt mit bekannter Grundlage; ohne Grundlage keine Restangabe */
  const known = list.find(x => x.st.s !== 'unk') || null;
  const nextItem = known ? {name: known.it.name, s: known.st.s, text: pillText(b, known.st)} : null;
  const defs = openDefects(b.id);
  return {state, text: STATE_TEXT[state], cur: curOf(b), tot: totOf(b), off: offOf(b), unit: U(b), counts: n, next: nextItem,
    unknown: n.unk, check: n.chk, defects: defs.length, defectsHigh: defs.filter(d => d.priority === 'high').length};
}
export function garageSummary(){
  const bikes = bikeList();
  let overdue = 0, soon = 0, unknown = 0, check = 0;
  bikes.forEach(b => { const st = bikeStatus(b); overdue += st.counts.bad; soon += st.counts.warn; unknown += st.counts.unk; check += st.counts.chk; });
  const defects = S.defects.filter(d => d.status !== 'done' && S.bikes[d.bike]).length;
  return {bikes: bikes.length, overdue, soon, unknown, check, defects};
}

/* ---------- Tippfehler berichtigen ----------
   Ausgangslage: ein niedrigerer Stand (neu eingegeben oder schon im Verlauf, z. B. als Korrektur gespeichert)
   folgt auf einen zu hohen. Die falsche Ablesung W ist der letzte eingetragene Stand davor (gleicher Zähler).
   Sie bekommt den Wert, der zum niedrigeren Stand passt: niedriger Stand minus alles, was seitdem gefahren wurde.
   Davor liegende Stände, die ebenfalls zu hoch wären, und alle Wartungen dazwischen werden angezeigt:
   - aus dem Verlauf (kein gespeicherter Wert): ergeben sich neu, vorausgewählt; abwählen = alten Wert festhalten
   - von Hand eingetippt oder Herkunft unklar (ältere Daten): nur nach ausdrücklicher Entscheidung
   Nicht angeboten, wenn der Ausgangswert ein alter, hochgezählter Stand ohne eigenen Eintrag ist, ein
   Zählerwechsel dazwischen liegt oder das Ergebnis unter 0 läge.
   target: {value, date, c} = neuer Stand (wird nicht zusätzlich gespeichert) oder {id} = vorhandener Eintrag. */
const logName = l => !l ? 'Eintrag' : l.kind === 'reading' ? 'Ablesung' : l.kind === 'service' ? ([].concat(l.taskNames || [], l.extra ? [l.extra] : []).join(', ') || 'Wartung') : 'Eintrag';
export function fixPlan(b, logs, rides, target){
  logs = logs || S.log; rides = rides || S.rides;
  const d = deriveBike(b, logs, rides), ev = d.ev, byId = {};
  logs.forEach(l => { if (l.bike === b.id) byId[l.id] = l; });
  let idx, vt, C = null;
  if (target.id) {
    idx = ev.findIndex(e => e.id === target.id && e.k === 'set' && !e.legacy);
    if (idx < 0) return null;
    C = ev[idx]; vt = C.v;
  } else {
    const key = {date: target.date, ph: 1, c: target.c, id: '￿'};
    idx = ev.findIndex(e => cmpEv(e, key) >= 0); if (idx < 0) idx = ev.length;
    vt = target.value;
  }
  if (vt == null) return null;
  let adds = 0, j = idx - 1; const autos = [];
  for (; j >= 0; j--) { const e = ev[j]; if (e.k === 'add') adds = r2(adds + e.v); else if (e.k === 'probe') autos.push(e); else break; }
  if (j < 0) return null;
  const W = ev[j];
  if (W.k !== 'set' || W.legacy || !byId[W.id]) return null;
  const off = W.off, wDisp = r2(vt - adds);
  if (wDisp < 0) return null;
  const wTot = off ? r2(wDisp + off) : wDisp;
  if (!(W.tot > wTot + 0.005)) return null;
  /* Weitere zu hohe Stände direkt davor (z. B. dieselbe falsche Zahl auch bei einer Wartung eingetippt) */
  const earlier = []; let need = wTot, adds2 = 0, pend = [];
  for (let k = j - 1; k >= 0; k--) {
    const e = ev[k];
    if (e.k === 'add') { adds2 = r2(adds2 + e.v); continue; }
    if (e.k === 'probe') { pend.push(e); continue; }
    if (e.k !== 'set' || e.legacy || !byId[e.id]) break;
    const eTot = r2(need - adds2);
    if (eTot < 0 || !(e.tot > eTot + 0.005)) break;
    autos.push(...pend); pend = [];
    earlier.push({e, tot: eTot}); need = eTot; adds2 = 0;
  }
  const disp = (tot, o) => o ? r2(tot - o) : tot;
  const kindOf = l => l.kind === 'reading' ? 'manual' : (l.atAuto === false ? 'manual' : 'unclear');
  /* Alle zu hohen Stände, jüngster zuerst. Die falsche Ablesung ist die jüngste Ablesung darunter: sie wird berichtigt
     (darum geht es). Eingetippte Stände bei Wartungen, weitere Ablesungen und unklare ältere Werte nur nach Entscheidung.
     Gibt es keine Ablesung darunter, ist der jüngste Stand der Ausgangspunkt, ebenfalls nur nach Entscheidung. */
  const group = [{e: W, tot: wTot}].concat(earlier);
  const asRow = x => { const l = byId[x.e.id]; return {id: l.id, kind: kindOf(l), what: logName(l), date: l.date, old: x.e.v, proposed: disp(x.tot, off), src: l.kind}; };
  const si = group.findIndex(x => byId[x.e.id].kind === 'reading');
  const subject = si >= 0 ? Object.assign(asRow(group[si]), {kind: 'subject'}) : asRow(group[0]);
  const rows = [];
  if (si < 0) rows.push(subject);
  group.forEach((x, i) => { if (i !== si && (si >= 0 || i > 0)) rows.push(asRow(x)); });
  autos.forEach(e => { const l = byId[e.id]; if (l) rows.push({id: l.id, kind: 'auto', what: logName(l), date: l.date, old: disp(e.tot, e.off), proposed: null, src: l.kind}); });
  rows.sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0) || ((byId[y.id].created || 0) - (byId[x.id].created || 0)));
  return {bike: b.id, mode: C ? 'existing' : 'new', target: C ? {id: C.id} : {value: vt, date: target.date, c: target.c}, value: vt,
    subject, rows, cur: d.cur, unit: U(b), id: C ? C.id : null, corrOf: C && byId[C.id] && byId[C.id].correction ? C.id : null};
}
/* Was eine Berichtigung mit den gewählten Entscheidungen speichert, und wie es danach aussieht.
   choice: {auto: {id: true/false}, dec: {id: 'fix'|'keep'}}. Ergebnis: patches [{id, patch}], reading (zusätzliche
   Ablesung, nur wenn behaltene Werte den neuen Stand sonst nicht erreichen ließen), der (Verlauf danach), proposed je Zeile. */
export function fixResult(b, logs, rides, plan, choice, stamp){
  logs = logs || S.log; rides = rides || S.rides;
  const fx = (from) => ({how: 'tippfehler', from, t: stamp.t, op: stamp.op});
  const patches = [];
  const decided = r => r.kind === 'subject' || (r.kind === 'auto' ? true : (choice.dec[r.id] === 'fix' || choice.dec[r.id] === 'keep'));
  const open = plan.rows.filter(r => !decided(r)).length;
  if (plan.subject.kind === 'subject') patches.push({id: plan.subject.id, patch: {at: plan.subject.proposed, fix: fx(plan.subject.old)}});
  plan.rows.forEach(r => {
    if (r.kind === 'manual' || r.kind === 'unclear') { if (choice.dec[r.id] === 'fix') patches.push({id: r.id, patch: {at: r.proposed, fix: fx(r.old)}}); }
    else if (r.kind === 'auto' && choice.auto[r.id] === false) patches.push({id: r.id, patch: {at: r.old, atAuto: false, fix: {how: 'festgehalten', from: r.old, t: stamp.t, op: stamp.op}}});
  });
  const apply = list => list.map(l => { const p = patches.find(x => x.id === l.id); return p ? Object.assign({}, l, p.patch) : l; });
  let next = apply(logs);
  let d2 = deriveBike(b, next, rides);
  let reading = null;
  if (plan.mode === 'new') {
    const pos = posAt(b.id, plan.target.date, plan.target.c, d2);
    if (pos.disp != null && Math.abs(pos.disp - plan.value) > 0.005) {
      reading = {bike: b.id, kind: 'reading', date: plan.target.date, at: plan.value, atAuto: false, correction: pos.disp > plan.value, tasks: [], taskNames: [], extra: '', cost: null, note: '', created: plan.target.c};
      next = next.concat([Object.assign({id: '￿neu'}, reading)]);
      d2 = deriveBike(b, next, rides);
    }
  } else if (plan.corrOf) {
    /* Die bisherige Korrektur ist danach keine mehr, wenn der Stand davor jetzt passt */
    const e = d2.ev.find(x => x.id === plan.corrOf);
    if (e && e.prev != null && Math.abs(e.prev - e.tot) <= 0.005) patches.push({id: plan.corrOf, patch: {correction: false}});
  }
  const proposed = {};
  plan.rows.forEach(r => {
    const p = patches.find(x => x.id === r.id);
    if (r.kind === 'auto') proposed[r.id] = p ? r.old : (d2.probe[r.id] != null ? (d2.poff[r.id] ? r2(d2.probe[r.id] - d2.poff[r.id]) : d2.probe[r.id]) : null);
    else proposed[r.id] = p ? p.patch.at : r.old;
  });
  /* Fälligkeit danach je betroffener Wartung (für die Punkte, deren letzte Wartung dieser Eintrag ist) */
  const due = {};
  plan.rows.forEach(r => {
    const l = logs.find(x => x.id === r.id); if (!l || l.kind !== 'service') return;
    (b.items || []).forEach(it => { const m = d2.items[it.id]; if (m && m.id === r.id) { const z = itemState(b, it, d2); (due[r.id] = due[r.id] || []).push({name: it.name, text: pillText(b, z), s: z.s}); } });
  });
  const effects = (b.items || []).map(it => {
    const a = itemState(b, it), z = itemState(b, it, d2);
    return {name: it.name, before: pillText(b, a), after: pillText(b, z), s0: a.s, s1: z.s};
  }).filter(x => x.before !== x.after);
  const changes = patches.filter(p => !('correction' in p.patch && Object.keys(p.patch).length === 1)).length + (reading ? 1 : 0);
  return {patches, reading, der: d2, proposed, due, effects, open, changes, cur: d2.cur};
}
/* Vorhandener Widerspruch im Verlauf, der sich als Tippfehler berichtigen lässt (für „Wartungsstand prüfen“):
   der jüngste niedrigere Stand, dessen Berichtigung mindestens einen Punkt mit diesem Zustand auflöst */
export function fixCandidate(b){
  const d = S.der[b.id]; if (!d) return null;
  /* Unklare Startwerte am Tag eines Zählerwechsels sind kein Tippfehler: die klärt „Zuordnen“ (ambList) */
  const chk = (b.items || []).filter(it => { const st = itemState(b, it); return st.s === 'chk' && !st.amb; });
  if (!chk.length) return null;
  for (let i = d.ev.length - 1; i >= 0; i--) {
    const e = d.ev[i];
    if (e.k !== 'set' || e.legacy || e.prev == null || !(e.tot < e.prev - 0.005)) continue;
    const plan = fixPlan(b, S.log, S.rides, {id: e.id});
    if (!plan) continue;
    const auto = {}; plan.rows.forEach(r => { if (r.kind === 'auto') auto[r.id] = true; });
    const dec = {}; plan.rows.forEach(r => { if (r.kind === 'manual' || r.kind === 'unclear') dec[r.id] = 'fix'; });
    const res = fixResult(b, S.log, S.rides, plan, {auto, dec}, {t: 0, op: ''});
    if (chk.some(it => itemState(b, it, res.der).s !== 'chk')) return plan;
  }
  return null;
}
