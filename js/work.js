/* Racebook – Tätigkeiten (ab 1.2.0): Katalog, Erkennung im Text, betroffene Wartungsintervalle.
   Getrennt gespeichert: log.work = tatsächlich erledigte Tätigkeiten, log.tasks = davon betroffene Wartungsintervalle.
   Ein Intervall wird nur vorausgewählt, wenn die erledigten Tätigkeiten es nachvollziehbar vollständig abdecken
   (z. B. „Motoröl + Ölfilter“ nur mit Ölwechsel UND Ölfilterwechsel). Sonst wird es höchstens zur Auswahl angeboten,
   mit Begründung. Kein Intervall wird erledigt, nur weil es existiert. Unklare Angaben („Gabel gemacht“) bleiben offen,
   bis der Nutzer ausdrücklich wählt. Keine modellspezifischen Angaben: Der Katalog nennt nur Tätigkeiten.
   Gleiche Regeln für das Formular „Neuer Eintrag“, das Bearbeiten und den Schnell-Eintrag (offline, ohne KI).
   Keine Oberfläche, kein Speicher. */
import {str, reEsc} from './util.js';

export const CATS = [['wartung', 'Wartung'], ['pflege', 'Pflege & Kontrolle'], ['umbau', 'Umbau & Teilewechsel'], ['einstellung', 'Einstellungen']];
export const catName = c => (CATS.find(x => x[0] === c) || CATS[0])[1];

/* Katalog. common = häufige Arbeit (direkt im Formular sichtbar), kw = weitere Suchwörter.
   iv: betroffene Wartungspunkte der Vorlagen ({item, with: weitere nötige Tätigkeiten, pre: false = nur anbieten}) */
export const WORK = [
  /* Wartung */
  {id: 'oil-change', name: 'Motoröl gewechselt', cat: 'wartung', common: 1, kw: 'ölwechsel motoröl', iv: [{item: 'oil', with: ['oil-filter']}]},
  {id: 'oil-filter', name: 'Ölfilter gewechselt', cat: 'wartung', common: 1, kw: 'filter', iv: [{item: 'oil', with: ['oil-change']}]},
  {id: 'air-clean', name: 'Luftfilter gereinigt', cat: 'wartung', common: 1, kw: 'luffi', iv: [{item: 'air'}]},
  {id: 'air-replace', name: 'Luftfilter gewechselt', cat: 'wartung', common: 1, kw: 'luffi neu', iv: [{item: 'air'}]},
  {id: 'plug', name: 'Zündkerze gewechselt', cat: 'wartung', kw: 'kerze', iv: [{item: 'plug'}]},
  {id: 'valves', name: 'Ventilspiel geprüft', cat: 'wartung', kw: 'ventile einstellen', iv: [{item: 'valves'}]},
  {id: 'coolant', name: 'Kühlflüssigkeit gewechselt', cat: 'wartung', kw: 'kühlwasser kühlmittel', iv: [{item: 'coolant'}]},
  {id: 'brake-fluid', name: 'Bremsflüssigkeit gewechselt', cat: 'wartung', kw: 'bremse dot', iv: [{item: 'brake'}]},
  {id: 'gear-oil', name: 'Getriebeöl gewechselt', cat: 'wartung', kw: 'getriebe', iv: [{item: 'gear'}]},
  {id: 'fork-service', name: 'Gabelservice', cat: 'wartung', kw: 'gabel wartung', iv: [{item: 'fork'}]},
  {id: 'fork-oil', name: 'Gabelöl gewechselt', cat: 'wartung', kw: 'gabel', iv: [{item: 'fork', with: ['fork-seals']}]},
  {id: 'shock-service', name: 'Federbein-Service', cat: 'wartung', kw: 'federbein dämpfer', iv: [{item: 'shock'}]},
  {id: 'piston', name: 'Kolben gewechselt', cat: 'wartung', kw: 'kolbenwechsel motor', iv: [{item: 'piston', with: ['rings']}]},
  {id: 'rings', name: 'Kolbenringe gewechselt', cat: 'wartung', kw: 'kolben ringe', iv: [{item: 'piston', with: ['piston']}]},
  {id: 'reed', name: 'Membran geprüft', cat: 'wartung', kw: 'membranventil', iv: [{item: 'reed'}]},
  {id: 'silencer', name: 'Dämmwolle erneuert', cat: 'wartung', kw: 'auspuff schalldämpfer', iv: [{item: 'silencer'}]},
  {id: 'fuel-filter', name: 'Benzinsieb gewechselt', cat: 'wartung', kw: 'benzinfilter kraftstofffilter'},
  /* Pflege & Kontrolle */
  {id: 'fork-bleed', name: 'Gabel entlüftet', cat: 'pflege', common: 1, kw: 'entlüften luft gabel'},
  {id: 'chain-tension', name: 'Kette gespannt', cat: 'pflege', common: 1, kw: 'kettenspannung'},
  {id: 'chain-lube', name: 'Kette geschmiert', cat: 'pflege', common: 1, kw: 'kettenspray', iv: [{item: 'chain', with: ['chain-check']}]},
  {id: 'chain-check', name: 'Kette geprüft', cat: 'pflege', kw: 'kettenverschleiß', iv: [{item: 'chain', with: ['chain-lube']}]},
  {id: 'chain-clean', name: 'Kette gereinigt', cat: 'pflege'},
  {id: 'spokes', name: 'Speichen nachgezogen', cat: 'pflege', common: 1, kw: 'speichen'},
  {id: 'bolts', name: 'Schrauben geprüft/nachgezogen', cat: 'pflege', common: 1, kw: 'schrauben achsen'},
  {id: 'wash', name: 'Motorrad gewaschen', cat: 'pflege', common: 1, kw: 'waschen putzen reinigen'},
  {id: 'tire-pressure', name: 'Reifendruck geprüft', cat: 'pflege', kw: 'luftdruck'},
  {id: 'pads-check', name: 'Bremsbeläge geprüft', cat: 'pflege', kw: 'bremse beläge', iv: [{item: 'pads'}]},
  {id: 'brake-bleed', name: 'Bremse entlüftet', cat: 'pflege', kw: 'bremse entlüften'},
  {id: 'oil-topup', name: 'Motoröl nachgefüllt', cat: 'pflege', kw: 'öl nachfüllen'},
  {id: 'oil-check', name: 'Ölstand geprüft', cat: 'pflege', kw: 'öl'},
  {id: 'coolant-fill', name: 'Kühlflüssigkeit nachgefüllt', cat: 'pflege', kw: 'kühlwasser'},
  /* ab 1.2.1: Nachfüllen und Reinigen sind eigene Tätigkeiten, kein Wechsel (kein Wartungsintervall) */
  {id: 'brake-fluid-fill', name: 'Bremsflüssigkeit nachgefüllt', cat: 'pflege', kw: 'bremse dot nachfüllen'},
  {id: 'fuel-filter-clean', name: 'Benzinsieb gereinigt', cat: 'pflege', kw: 'benzinfilter kraftstofffilter reinigen'},
  {id: 'air-oil', name: 'Luftfilter geölt', cat: 'pflege', kw: 'luftfilteröl'},
  {id: 'fork-clean', name: 'Gabel-Staubkappen gereinigt', cat: 'pflege', kw: 'gabel simmerringe reinigen'},
  /* Umbau & Teilewechsel */
  {id: 'pads-replace', name: 'Bremsbeläge gewechselt', cat: 'umbau', kw: 'bremse beläge', iv: [{item: 'pads'}]},
  {id: 'brake-disc', name: 'Bremsscheibe gewechselt', cat: 'umbau', kw: 'bremse'},
  {id: 'tire-front', name: 'Reifen vorn gewechselt', cat: 'umbau', kw: 'reifenwechsel'},
  {id: 'tire-rear', name: 'Reifen hinten gewechselt', cat: 'umbau', kw: 'reifenwechsel'},
  {id: 'wheelset', name: 'Radsatz gewechselt', cat: 'umbau', common: 1, kw: 'räder laufräder felgen'},
  {id: 'chain-new', name: 'Kette gewechselt', cat: 'umbau', kw: 'neue kette'},
  {id: 'chain-kit', name: 'Kettensatz gewechselt', cat: 'umbau', kw: 'kette ritzel kettenrad'},
  {id: 'gearing', name: 'Übersetzung geändert', cat: 'umbau', common: 1, kw: 'ritzel kettenrad kettenblatt zähne'},
  {id: 'sprocket', name: 'Ritzel gewechselt', cat: 'umbau'},
  {id: 'rear-sprocket', name: 'Kettenrad gewechselt', cat: 'umbau', kw: 'kettenblatt'},
  {id: 'fork-seals', name: 'Gabeldichtringe gewechselt', cat: 'umbau', kw: 'simmerringe gabel', iv: [{item: 'fork', with: ['fork-oil']}]},
  {id: 'guard', name: 'Schutz montiert', cat: 'umbau', kw: 'motorschutz handschutz kettenschutz'},
  {id: 'grips', name: 'Griffe gewechselt', cat: 'umbau'},
  {id: 'clutch', name: 'Kupplung gewechselt', cat: 'umbau', kw: 'kupplungsbeläge lamellen'},
  {id: 'battery', name: 'Batterie gewechselt', cat: 'umbau', kw: 'akku'},
  {id: 'reed-replace', name: 'Membran gewechselt', cat: 'umbau'},
  /* Einstellungen */
  {id: 'controls', name: 'Armaturen eingestellt', cat: 'einstellung', common: 1, kw: 'hebel lenker'},
  {id: 'suspension', name: 'Fahrwerk abgestimmt', cat: 'einstellung', common: 1, kw: 'setup klicks gabel federbein'},
  {id: 'clutch-adj', name: 'Kupplung eingestellt', cat: 'einstellung', kw: 'kupplungsspiel'},
  {id: 'brake-adj', name: 'Bremse eingestellt', cat: 'einstellung'},
  {id: 'idle', name: 'Leerlauf eingestellt', cat: 'einstellung', kw: 'gemisch vergaser'}
];
export const WORK_BY = {}; WORK.forEach(w => { WORK_BY[w.id] = w; });
/* Wartungspunkte der Vorlagen (IDs wie in domain.TEMPLATES) */
export const TPL_ITEMS = ['oil', 'air', 'chain', 'plug', 'valves', 'fork', 'shock', 'piston', 'coolant', 'brake', 'gear', 'reed', 'silencer', 'pads'];

const norm = s => String(s || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
/* Eigene Tätigkeit: ID aus dem Namen (gleicher Name = gleiche Tätigkeit, z. B. für Favoriten) */
export const customId = name => 'x-' + (norm(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'eigene');
export const isCustom = id => /^x-/.test(id);
/* Tätigkeit zum Speichern: {id, name, cat, detail} */
export function workEntry(id, name, detail, cat){
  const w = WORK_BY[id];
  return {id, name: str(name || (w ? w.name : '')).slice(0, 120), cat: w ? w.cat : (cat || 'wartung'), detail: str(detail || '').slice(0, 300)};
}
export const workLabel = w => w.name + (w.detail ? ' (' + w.detail + ')' : '');

/* ---------- Suche im Katalog (Formular) ---------- */
export function searchWork(q){
  const t = norm(q).trim(); if (!t) return [];
  const words = t.split(/\s+/);
  return WORK.filter(w => { const h = norm(w.name + ' ' + (w.kw || '')); return words.every(x => h.includes(x)); }).slice(0, 12);
}

/* ---------- Betroffene Wartungsintervalle ----------
   works: [{id}], open: offene Fragen [{options: [ids]}]. Ergebnis je Wartungspunkt des Motorrads, für den es einen
   Bezug gibt: {item, pre (vorausgewählt), why (Begründung)}. */
export function ivProposal(b, works, open){
  const items = (b && b.items) || [], ids = new Set((works || []).map(w => w.id)), out = [];
  const nameOf = id => (WORK_BY[id] && WORK_BY[id].name) || id;
  items.forEach(it => {
    const pre = [], maybe = [];
    (works || []).forEach(w => {
      const def = WORK_BY[w.id];
      if (def && def.iv) def.iv.forEach(r => {
        if (r.item !== it.id) return;
        const need = (r.with || []).filter(x => !ids.has(x));
        if (r.pre !== false && !need.length) pre.push(def.name);
        else maybe.push(def.name + (need.length ? ' (deckt „' + it.name + '“ nur zusammen mit „' + need.map(nameOf).join('“, „') + '“ ab)' : ''));
      });
      /* Eigener Wartungspunkt (nicht aus der Vorlage): nur anbieten, wenn der Name passt */
      if (!TPL_ITEMS.includes(it.id) && nameMatch(it.name, w.name)) maybe.push(w.name);
    });
    /* Offene Frage: Deckt jede mögliche Antwort den Punkt ab, steht er schon fest; sonst erst nach der Auswahl */
    (open || []).forEach(q => {
      const all = q.options.length && q.options.every(o => (WORK_BY[o] && WORK_BY[o].iv || []).some(r => r.item === it.id && r.pre !== false && !(r.with || []).length));
      if (all) pre.push(q.label + ' (jede Auswahl)');
    });
    if (pre.length) out.push({item: it.id, pre: true, why: 'durch ' + Array.from(new Set(pre)).join(', ')});
    else if (maybe.length) out.push({item: it.id, pre: false, why: 'nur wählen, wenn tatsächlich erledigt: ' + Array.from(new Set(maybe)).join('; ')});
  });
  return out;
}
function nameMatch(a, b){
  const ws = s => norm(s).split(/[^a-z0-9]+/).filter(x => x.length >= 5).map(x => x.slice(0, 6));
  const A = new Set(ws(a)); return ws(b).some(x => A.has(x));
}

/* ---------- Erkennung im Text (Schnell-Eintrag) ---------- */
const BB = '(?<![\\wäöüß])', EE = '(?![\\wäöüß])';
/* Gegenstände: [Schlüssel, Muster]; spezifische vor allgemeinen */
const OBJ = [
  ['oelfilter', '(?:öl|oel)filter\\w*'], ['getriebeoel', 'getriebe(?:öl|oel)\\w*|getriebe'], ['gabeloel', 'gabel(?:öl|oel)\\w*'],
  ['gabeldicht', 'gabel(?:dicht\\w*|simmerring\\w*)|simmerring\\w*|dichtringe'],
  ['luftfilter', 'luftfilter\\w*|luffi'], ['kuehl', 'kühl(?:flüssigkeit|wasser|mittel)|kuehl(?:fluessigkeit|wasser|mittel)'],
  ['bremsfl', 'bremsflüssigkeit|bremsfluessigkeit'], ['belaege', '(?:brems)?beläge|(?:brems)?belaege|bremsklötze'],
  ['bremsscheibe', 'bremsscheiben?'], ['bremse', 'bremsen?'], ['zuendkerze', 'zündkerzen?|zuendkerzen?|kerzen?'],
  ['ventil', 'ventil(?:spiel|e)?'], ['kolbenringe', '(?:kolben)?ringe'], ['kolben', 'kolben'], ['membran', 'membran\\w*'],
  ['daemm', 'dämmwolle|daemmwolle|dämmung|daemmung'], ['auspuff', 'auspuff\\w*'], ['benzinsieb', '(?:benzin|kraftstoff)(?:sieb|filter)'],
  ['kettensatz', 'kettensatz'], ['kettenrad', 'ketten(?:rad|blatt)'], ['ritzel', 'ritzel'], ['kette', 'kette'],
  ['speichen', 'speichen'], ['schrauben', 'schrauben?'], ['reifendruck', '(?:reifen|luft)druck'], ['reifen', 'reifen'],
  ['radsatz', 'radsatz|laufräder|laufraeder|räder|raeder'], ['schutz', '[a-zäöüß]*schutz'], ['armaturen', 'armaturen|hebel'],
  ['fahrwerk', 'fahrwerk'], ['gabel', 'gabel'], ['federbein', 'federbein|stoßdämpfer|stossdaempfer|dämpfer|daempfer'],
  ['griffe', 'griffe?'], ['kupplung', 'kupplung'], ['batterie', 'batterie|akku'], ['oel', '(?:motor)?(?:öl|oel)']
];
/* Nachsilben, die schon die Tätigkeit nennen („Ölwechsel“, „Gabelservice“) */
const SUFFIX = {wechsel: 'wechsel', service: 'service', reinigung: 'reinig', kontrolle: 'pruef', check: 'pruef'};
const ACTS = [
  ['einstell', 'neu eingestellt|eingestellt|abgestimmt|justiert|angepasst'],
  ['wechsel', 'gewechselt|getauscht|ausgetauscht|erneuert|ersetzt|neu gestopft|gestopft|neu gemacht|neu drauf|neu'],
  ['reinig', 'gereinigt|geputzt|sauber gemacht|saubergemacht|ausgewaschen|ausgeblasen'],
  ['pruef', 'geprüft|geprueft|kontrolliert|gecheckt|gemessen|nachgesehen'],
  ['spann', 'nachgespannt|gespannt'], ['schmier', 'geschmiert|gefettet|geölt|geoelt|eingesprüht|gesprüht|gesprayt'],
  ['entlueft', 'entlüftet|entlueftet'], ['zieh', 'nachgezogen|angezogen|festgezogen'],
  ['montier', 'montiert|angebaut|eingebaut|drangebaut|aufgezogen'], ['fuell', 'nachgefüllt|nachgefuellt|aufgefüllt|aufgefuellt'],
  ['wasch', 'gewaschen|abgespritzt'], ['mach', 'gemacht|erledigt|gewartet|überholt|ueberholt|revidiert']
];
/* Was bedeutet Gegenstand + Tätigkeit? Wert: Tätigkeit, {open: [Auswahl]} oder 'tire' (vorn/hinten aus dem Text).
   _ = Gegenstand ohne Tätigkeitswort (z. B. „Wartung: Luftfilter“) */
const MAP = {
  oel: {wechsel: 'oil-change', fuell: 'oil-topup', pruef: 'oil-check', mach: {open: ['oil-change', 'oil-topup']}, _: {open: ['oil-change', 'oil-topup', 'oil-check']}},
  oelfilter: {wechsel: 'oil-filter', montier: 'oil-filter', mach: 'oil-filter', _: 'oil-filter'},
  luftfilter: {wechsel: 'air-replace', reinig: 'air-clean', schmier: 'air-oil', mach: {open: ['air-clean', 'air-replace']}, _: {open: ['air-clean', 'air-replace']}},
  zuendkerze: {wechsel: 'plug', montier: 'plug', mach: 'plug', _: 'plug'},
  ventil: {pruef: 'valves', einstell: 'valves', mach: 'valves', _: 'valves'},
  kuehl: {wechsel: 'coolant', fuell: 'coolant-fill', mach: {open: ['coolant', 'coolant-fill']}, _: {open: ['coolant', 'coolant-fill']}},
  bremsfl: {wechsel: 'brake-fluid', fuell: 'brake-fluid-fill', entlueft: 'brake-bleed', mach: {open: ['brake-fluid', 'brake-bleed', 'brake-fluid-fill']}, _: {open: ['brake-fluid', 'brake-bleed', 'brake-fluid-fill']}},
  belaege: {wechsel: 'pads-replace', montier: 'pads-replace', pruef: 'pads-check', mach: {open: ['pads-replace', 'pads-check']}, _: {open: ['pads-replace', 'pads-check']}},
  bremsscheibe: {wechsel: 'brake-disc', montier: 'brake-disc', _: 'brake-disc'},
  bremse: {entlueft: 'brake-bleed', einstell: 'brake-adj', mach: {open: ['brake-bleed', 'brake-fluid', 'pads-replace', 'brake-adj']}, _: {open: ['brake-bleed', 'brake-fluid', 'pads-replace', 'brake-adj']}},
  kolben: {wechsel: 'piston', montier: 'piston', mach: {open: ['piston', 'rings']}, _: {open: ['piston', 'rings']}},
  kolbenringe: {wechsel: 'rings', montier: 'rings', _: 'rings'},
  membran: {pruef: 'reed', wechsel: 'reed-replace', mach: {open: ['reed', 'reed-replace']}, _: {open: ['reed', 'reed-replace']}},
  daemm: {wechsel: 'silencer', mach: 'silencer', _: 'silencer'},
  /* „Auspuff gewechselt/montiert/gereinigt“ ist keine neue Dämmwolle: bleibt wie geschrieben; nur „gemacht“ fragt nach */
  auspuff: {mach: {open: ['silencer']}, _: {open: ['silencer']}},
  benzinsieb: {wechsel: 'fuel-filter', montier: 'fuel-filter', reinig: 'fuel-filter-clean', mach: {open: ['fuel-filter', 'fuel-filter-clean']}, _: {open: ['fuel-filter', 'fuel-filter-clean']}},
  kettensatz: {wechsel: 'chain-kit', montier: 'chain-kit', _: 'chain-kit'},
  kettenrad: {wechsel: 'rear-sprocket', montier: 'rear-sprocket', _: 'rear-sprocket'},
  ritzel: {wechsel: 'sprocket', montier: 'sprocket', _: 'sprocket'},
  kette: {spann: 'chain-tension', zieh: 'chain-tension', schmier: 'chain-lube', reinig: 'chain-clean', pruef: 'chain-check', wechsel: 'chain-new', montier: 'chain-new',
    mach: {open: ['chain-tension', 'chain-lube', 'chain-clean', 'chain-check', 'chain-new']}, _: {open: ['chain-tension', 'chain-lube', 'chain-clean', 'chain-check', 'chain-new']}},
  speichen: {zieh: 'spokes', spann: 'spokes', mach: 'spokes', _: 'spokes'},
  schrauben: {zieh: 'bolts', pruef: 'bolts', mach: 'bolts', _: 'bolts'},
  reifendruck: {pruef: 'tire-pressure', _: 'tire-pressure'},
  reifen: {wechsel: 'tire', montier: 'tire', _: 'tire'},
  radsatz: {wechsel: 'wheelset', montier: 'wheelset', _: 'wheelset'},
  schutz: {montier: 'guard', wechsel: 'guard', _: 'guard'},
  armaturen: {einstell: 'controls', _: 'controls'},
  fahrwerk: {einstell: 'suspension', mach: 'suspension', _: 'suspension'},
  gabel: {entlueft: 'fork-bleed', service: 'fork-service', einstell: 'suspension', wechsel: {open: ['fork-oil', 'fork-seals', 'fork-service']},
    mach: {open: ['fork-service', 'fork-bleed', 'fork-oil', 'fork-clean']}, _: {open: ['fork-service', 'fork-bleed', 'fork-oil', 'fork-clean']}},
  gabeloel: {wechsel: 'fork-oil', _: 'fork-oil'}, gabeldicht: {wechsel: 'fork-seals', reinig: 'fork-clean', _: 'fork-seals'},
  federbein: {service: 'shock-service', einstell: 'suspension', mach: {open: ['shock-service']}, _: {open: ['shock-service']}},
  griffe: {wechsel: 'grips', montier: 'grips', _: 'grips'},
  kupplung: {wechsel: 'clutch', einstell: 'clutch-adj', mach: {open: ['clutch', 'clutch-adj']}, _: {open: ['clutch', 'clutch-adj']}},
  batterie: {wechsel: 'battery', montier: 'battery', _: 'battery'}
};
const OBJ_RE = OBJ.map(([k, p]) => [k, new RegExp(BB + '(' + p + ')(wechsel|service|reinigung|kontrolle|check)?' + EE, 'g')]);
const ACT_RE = ACTS.map(([k, p]) => [k, new RegExp(BB + '(?:' + p + ')' + EE, 'g')]);
const CAT_OF_ACT = {pruef: 'pflege', reinig: 'pflege', schmier: 'pflege', spann: 'pflege', zieh: 'pflege', wasch: 'pflege', fuell: 'pflege', entlueft: 'pflege', einstell: 'einstellung', wechsel: 'umbau', montier: 'umbau', mach: 'wartung'};
/* Füllwörter, Mengen, Datum und Stand gehören nicht in den Namen einer eigenen Tätigkeit */
function cleanFree(s){
  return cap(String(s).replace(/(?:bei|stand|auf|mit)?\s*[-+]?\d[\d.,]*\s*(?:h|std\.?|stunden?|betriebsstunden|km|kilometer|€|euro|eur)(?![\wäöüß])/gi, ' ')
    .replace(/€\s*\d[\d.,]*/g, ' ').replace(/(?<![\wäöüß])(heute|gestern|vorgestern|noch|auch|dann|danach|vorher|davor|zuvor|und|sowie|schnell)(?![\wäöüß])/gi, ' ')
    .replace(/\d{1,2}\.\d{1,2}\.(\d{2,4})?/g, ' ').replace(/\s+/g, ' ').replace(/^[\s,;:.\-–]+|[\s,;:.\-–]+$/g, '').trim());
}
const GEAR_RE = /(\d{1,3})\s*(?:auf|->|→|zu|nach)\s*(\d{1,3})/;
const STOP = new Set(['und', 'sowie', 'auch', 'noch', 'dann', 'danach', 'vorher', 'davor', 'zuvor', 'bei', 'stand', 'mit', 'auf', 'am', 'im', 'in', 'die', 'der', 'das', 'den', 'dem', 'ein', 'eine', 'einen', 'heute', 'gestern', 'vorgestern', 'euro', 'eur', 'h', 'km', 'std', 'stunden', 'stunde', 'kilometer', 'wartung', 'service', 'erledigt']);

/* Gegenstände und Tätigkeitswörter eines Satzteils mit Position */
function scan(t){
  const taken = [], objs = [], acts = [];
  const free = (a, z) => !taken.some(([x, y]) => a < y && z > x);
  OBJ_RE.forEach(([k, re]) => { re.lastIndex = 0; let m; while ((m = re.exec(t))) { const a = m.index, z = a + m[0].length; if (free(a, z)) { taken.push([a, z]); objs.push({k, a, z, word: m[1], suf: m[2] ? SUFFIX[m[2]] : null}); } } });
  ACT_RE.forEach(([k, re]) => { re.lastIndex = 0; let m; while ((m = re.exec(t))) { const a = m.index, z = a + m[0].length; if (free(a, z)) { taken.push([a, z]); acts.push({k, a, z, word: m[0]}); } } });
  objs.sort((x, y) => x.a - y.a); acts.sort((x, y) => x.a - y.a);
  return {objs, acts};
}
/* Satzteile: an Satzzeichen trennen; an Komma/„und“ nur, wenn davor schon ein vollständiger Teil (Gegenstand + Tätigkeit)
   steht und danach ein eigener Gegenstand oder ein anderes Wort folgt („Öl gewechselt und Lenker getauscht“).
   „Öl und Luftfilter gewechselt“ und „Kette locker, gespannt“ bleiben zusammen. */
function groups(text){
  const out = [];
  String(text).split(/[.;!?\n]+(?!\d)/).forEach(sent => {
    const parts = sent.split(/\s*(?:(?<!\d),(?!\d)|\s(?:und|sowie|\+|&)\s)\s*/i).filter(x => x.trim());
    let cur = null;
    parts.forEach(p => {
      const sc = scan(' ' + p.toLowerCase() + ' ');
      const words = p.toLowerCase().split(/[^\wäöüß]+/).filter(w => w && !STOP.has(w) && !/^\d/.test(w) && !ACT_RE.some(([, re]) => { re.lastIndex = 0; return re.test(' ' + w + ' '); }));
      const complete = g => g && g.objs && g.acts;
      const own = sc.objs.length > 0 || (sc.acts.length > 0 && words.length > 0);
      if (cur && !(complete(cur) && own)) { cur.text += ', ' + p; cur.objs = cur.objs || sc.objs.length > 0; cur.acts = cur.acts || sc.acts.length > 0; }
      else { cur = {text: p, objs: sc.objs.length > 0, acts: sc.acts.length > 0}; out.push(cur); }
    });
  });
  return out.map(g => g.text);
}
/* Stelle der ersten erkannten Arbeit im Text (für die Reihenfolge von Fahrt und Wartung), sonst -1 */
export function workPos(text){
  const sc = scan(' ' + String(text).toLowerCase() + ' ');
  const p = sc.objs.concat(sc.acts).map(x => x.a - 1);
  return p.length ? Math.max(0, Math.min(...p)) : -1;
}
/* Ergebnis: {works: [{id, name, cat, detail}], open: [{key, label, options}]} */
export function parseWork(text){
  const works = [], open = [], gear = [];
  let acted = false;
  const add = (id, name, detail, cat) => {
    const ex = works.find(w => w.id === id && (!isCustom(id) || w.name === name));
    if (ex) { if (detail && !ex.detail.includes(detail)) ex.detail = ex.detail ? ex.detail + ', ' + detail : detail; return; }
    works.push(workEntry(id, name, detail, cat));
  };
  groups(text).forEach(g => {
    const t = ' ' + g.toLowerCase() + ' ', sc = scan(t), objs = sc.objs, acts = sc.acts;
    /* Tätigkeitswörter je Gegenstand: die danach bis zum nächsten Gegenstand; ohne eigene die des nächsten
       Gegenstands mit Tätigkeit („Öl und Luftfilter gewechselt“), sonst die vor dem ersten Gegenstand */
    const own = objs.map((o, i) => acts.filter(a => a.a > o.a && (i + 1 >= objs.length || a.a < objs[i + 1].a)));
    const lead = objs.length ? acts.filter(a => a.a < objs[0].a) : [];
    objs.forEach((o, i) => {
      let as = own[i];
      if (!as.length) { for (let j = i + 1; j < objs.length; j++) if (own[j].length) { as = own[j]; break; } }
      if (!as.length) as = lead;
      const kinds = o.suf ? [o.suf] : Array.from(new Set(as.map(a => a.k)));
      if (kinds.length) acted = true;
      const span = t.slice(o.z, i + 1 < objs.length ? objs[i + 1].a : t.length);
      /* Übersetzung: „Ritzel 13 auf 14“, „Kettenblatt 46 auf 52“ */
      if ((o.k === 'ritzel' || o.k === 'kettenrad') && GEAR_RE.test(span)) { acted = true; const m = span.match(GEAR_RE); gear.push((o.k === 'ritzel' ? 'Ritzel ' : 'Kettenrad ') + m[1] + ' → ' + m[2]); return; }
      const map = MAP[o.k] || {};
      const list = kinds.length ? kinds : ['_'];
      let any = false;
      list.forEach(k => {
        let v = map[k];
        if (v == null && k === 'service') v = map.mach;
        if (v == null) return;
        any = true;
        if (v === 'tire') {
          const fr = /(?<![\wäöüß])(vorn|vorne|vr)(?![\wäöüß])/.test(span + ' ' + t.slice(0, o.a)), rr = /(?<![\wäöüß])(hinten|hi)(?![\wäöüß])/.test(span + ' ' + t.slice(0, o.a));
          if (fr) add('tire-front'); if (rr) add('tire-rear'); if (!fr && !rr) add('x-reifen-gewechselt', 'Reifen gewechselt', '', 'umbau');
          return;
        }
        if (typeof v === 'object') {
          const label = cap(o.word + (as.length ? ' ' + as.map(a => a.word).join(', ') : ''));
          if (!open.some(q => q.label === label)) open.push({key: 'q' + open.length, label, options: v.open.slice()});
          return;
        }
        let name = '', detail = '';
        if (v === 'guard') name = cap(o.word) + ' montiert';
        if (v === 'wheelset') { const m = span.match(/(?<![\wäöüß])auf\s+([\wäöüß-]+)/); if (m && !/^\d/.test(m[1])) detail = 'auf ' + (m[1].length <= 3 ? m[1].toUpperCase() : cap(m[1])); }
        add(v, name, detail);
      });
      if (!any && kinds.length) {
        /* Gegenstand bekannt, Tätigkeit dazu nicht im Katalog: als eigene Tätigkeit wie geschrieben */
        const n = cleanFree(o.word + ' ' + as.map(a => a.word).join(' '));
        if (n) add(customId(n), n, '', CAT_OF_ACT[kinds[0]] || 'wartung');
      }
    });
    if (!objs.length && acts.length) {
      acted = true;
      if (acts.some(a => a.k === 'wasch')) { add('wash'); return; }
      const n = cleanFree(g);
      if (n && n.split(/\s+/).length > 1) add(customId(n), n, '', CAT_OF_ACT[acts[0].k] || 'wartung');
    }
  });
  if (gear.length) add('gearing', '', gear.join(', '));
  /* acted: mindestens eine Tätigkeit ist ausdrücklich genannt (Tätigkeitswort, „…wechsel“, Zähnezahlen). Ein bloßer
     Gegenstand („Bremse funktioniert nicht“) macht einen Text allein noch nicht zur Wartung. */
  return {works, open, acted};
}
