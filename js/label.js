/* Racebook – Artikelvorschlag aus erkanntem Etikettentext (ab 1.4.0).
   Reine Regeln, keine Oberfläche, kein Netz: Eingabe sind die Textzeilen, die die Texterkennung auf dem Gerät gelesen
   hat (Text, Sicherheit 0–100, Zeilenhöhe), dazu gelesene Strichcodes. Das ist Etikettenlesen, keine Produkterkennung:
   Was nicht als Text auf dem Bild steht, wird nicht ergänzt. Jedes Feld trägt eine Einstufung:
     'ok'   = so auf dem Etikett gelesen (deutliche Angabe, gut lesbar),
     'check'= Vorschlag, bitte prüfen (abgeleitet oder schlecht lesbar),
     ''     = nicht erkannt (bleibt leer).
   Nie aus dem Bild abgeleitet: Anzahl (fünf abgebildete Filter sind nicht fünf im Lager), Restinhalt (4 L ist das
   Gebinde), Motorrad-Zuordnung (eine Passungsangabe wird nur als Hinweis gezeigt). */

/* Kategorien des Lagers: Schlüssel (gespeichert), Name, Vorschläge für die Unterkategorie */
export const PART_CATS = [
  ['fluids', 'Betriebsstoffe', ['Motoröl', '2-Takt-Öl', 'Getriebeöl', 'Gabelöl', 'Federbeinöl', 'Bremsflüssigkeit', 'Kühlmittel', 'Fett', 'Luftfilteröl', 'Kraftstoffzusatz']],
  ['filters', 'Filter', ['Ölfilter', 'Luftfilter', 'Kraftstofffilter']],
  ['ignition', 'Zündung & Elektrik', ['Zündkerze', 'Batterie', 'Sicherung', 'Leuchtmittel']],
  ['brakes', 'Bremse', ['Bremsbeläge', 'Bremsscheibe']],
  ['drive', 'Antrieb', ['Kette', 'Kettenkit', 'Ritzel', 'Kettenrad', 'Kupplungsbeläge']],
  ['tyres', 'Reifen & Schläuche', ['Reifen', 'Schlauch', 'Mousse', 'Felgenband']],
  ['care', 'Pflege & Reinigung', ['Kettenspray', 'Reiniger', 'Luftfilterreiniger']],
  ['small', 'Kleinteile & Dichtungen', ['Dichtung', 'O-Ring', 'Schrauben', 'Lager']],
  ['other', 'Sonstiges', []]
];
export const CAT_KEYS = PART_CATS.map(c => c[0]);
export const catName = k => (PART_CATS.find(c => c[0] === k) || [])[1] || '';
export const catLabel = (k, sub) => [catName(k), sub || ''].filter(Boolean).join(' → ');

const OK_CONF = 75, MIN_CONF = 60;
const U = '(?:ö|oe|o|0)', A = '(?:ä|ae|a)', UE = '(?:ü|ue|u)';
/* Regeln für Kategorie und Unterkategorie; die erste passende gilt. generic = Zeile ist nur eine Gattungsangabe */
const RULES = [
  [new RegExp('luftfilter' + U + 'l|air\\s*filter\\s*oil|filter\\s*oil', 'i'), 'fluids', 'Luftfilteröl'],
  [new RegExp('luftfilterreiniger|air\\s*filter\\s*clean', 'i'), 'care', 'Luftfilterreiniger'],
  [new RegExp(U + 'lfilter|oil\\s*filter', 'i'), 'filters', 'Ölfilter'],
  [/luftfilter|air\s*filter/i, 'filters', 'Luftfilter'],
  [/kraftstofffilter|benzinfilter|fuel\s*filter/i, 'filters', 'Kraftstofffilter'],
  [new RegExp('bremsfl' + UE + 'ssigkeit|brake\\s*fluid|\\bdot\\s?(?:3|4|5\\.1|5)\\b', 'i'), 'fluids', 'Bremsflüssigkeit'],
  [new RegExp('gabel' + U + 'l|fork\\s*oil', 'i'), 'fluids', 'Gabelöl'],
  [new RegExp('federbein' + U + 'l|d' + A + 'mpfer' + U + 'l|shock\\s*oil|suspension\\s*fluid', 'i'), 'fluids', 'Federbeinöl'],
  [new RegExp('getriebe' + U + 'l|gear\\s*oil|transmission\\s*oil', 'i'), 'fluids', 'Getriebeöl'],
  [new RegExp('k' + UE + 'hlmittel|k' + UE + 'hlerfrostschutz|coolant|antifreeze', 'i'), 'fluids', 'Kühlmittel'],
  [/kettenspray|kettenfett|kettenschmier|chain\s*(?:lube|spray|wax)/i, 'care', 'Kettenspray'],
  [/kettenreiniger|chain\s*clean|bremsenreiniger|brake\s*clean/i, 'care', 'Reiniger'],
  [new RegExp('\\b2t\\b|2-takt|zweitakt|2-stroke|two-stroke', 'i'), 'fluids', '2-Takt-Öl', true],
  [new RegExp('motor(?:en)?' + U + 'l|engine\\s*oil|motor\\s*oil|\\b4t\\b|4-takt|viertakt|4-stroke', 'i'), 'fluids', 'Motoröl'],
  [new RegExp('z' + UE + 'ndkerze|spark\\s*plug', 'i'), 'ignition', 'Zündkerze'],
  [/batterie|battery/i, 'ignition', 'Batterie'],
  [new RegExp('bremsbel' + A + 'g|brake\\s*pad', 'i'), 'brakes', 'Bremsbeläge'],
  [/bremsscheibe|brake\s*dis[ck]/i, 'brakes', 'Bremsscheibe'],
  [/kettenkit|kettensatz|chain\s*kit/i, 'drive', 'Kettenkit'],
  [/ritzel|front\s*sprocket/i, 'drive', 'Ritzel'],
  [/kettenrad|rear\s*sprocket|\bsprocket\b/i, 'drive', 'Kettenrad'],
  [new RegExp('kupplungsbel' + A + 'g|clutch\\s*(?:plates?|kit|discs?)', 'i'), 'drive', 'Kupplungsbeläge'],
  [/\bkette\b|\bchain\b/i, 'drive', 'Kette'],
  [/\bmousse\b/i, 'tyres', 'Mousse'],
  [/schlauch|inner\s*tube/i, 'tyres', 'Schlauch'],
  [/\breifen\b|\btyre\b|\btire\b/i, 'tyres', 'Reifen'],
  [/\bfett\b|\bgrease\b/i, 'fluids', 'Fett'],
  [/\bo-ring/i, 'small', 'O-Ring'],
  [/dichtung|gasket/i, 'small', 'Dichtung'],
  /* Nur ein allgemeines Wort: Kategorie als Vorschlag, Unterkategorie offen */
  [/filter\b/i, 'filters', '', false, true],
  [new RegExp('(?:^|[^a-z' + 'äöü])' + U + 'l\\b|\\boil\\b', 'i'), 'fluids', '', false, true]
];

/* Hersteller: nur, wenn der Name wörtlich auf dem Etikett steht. cs = nur in genau dieser Schreibweise (kurze Namen) */
const MAKERS = [
  ['LIQUI MOLY', /\bliqui[\s-]?moly\b/i], ['Motul', /\bmotul\b/i], ['Castrol', /\bcastrol\b/i], ['Shell', /\bShell\b/], ['Mobil', /\bMobil\b/],
  ['Putoline', /\bputoline\b/i], ['Motorex', /\bmotorex\b/i], ['Ipone', /\bipone\b/i], ['Repsol', /\brepsol\b/i], ['Silkolene', /\bsilkolene\b/i],
  ['Fuchs', /\bFUCHS\b|\bFuchs\b/], ['Bel-Ray', /\bbel[\s-]?ray\b/i], ['Maxima', /\bmaxima\b/i], ['Elf', /\bELF\b|\bElf\b/], ['TotalEnergies', /\btotal\s?energies\b/i],
  ['Eni', /\bENI\b|\bEni\b/], ['Addinol', /\baddinol\b/i], ['Ravenol', /\bravenol\b/i], ['Mannol', /\bmannol\b/i], ['Valvoline', /\bvalvoline\b/i],
  ['Petronas', /\bpetronas\b/i], ['Amsoil', /\bamsoil\b/i], ['Rock Oil', /\brock\s?oil\b/i], ['WD-40', /\bwd[\s-]?40\b/i], ['S100', /\bS100\b/],
  ['Dr. Wack', /\bdr\.?\s?wack\b/i], ['Muc-Off', /\bmuc[\s-]?off\b/i], ['HifloFiltro', /\bhiflo\s?filtro\b|\bhiflo\b/i], ['K&N', /\bK\s?&\s?N\b/],
  ['Mahle', /\bmahle\b/i], ['Bosch', /\bbosch\b/i], ['Mann-Filter', /\bmann[\s-]?filter\b/i], ['Twin Air', /\btwin\s?air\b/i], ['Champion', /\bchampion\b/i],
  ['NGK', /\bNGK\b/], ['Denso', /\bdenso\b/i], ['Brembo', /\bbrembo\b/i], ['EBC', /\bEBC\b/], ['Galfer', /\bgalfer\b/i], ['Ferodo', /\bferodo\b/i],
  ['SBS', /\bSBS\b/], ['TRW', /\bTRW\b/], ['D.I.D', /\bD\.?I\.?D\b/], ['Regina', /\bregina\b/i], ['RK', /\bRK\b/], ['JT Sprockets', /\bjt\s?sprockets\b/i],
  ['Renthal', /\brenthal\b/i], ['AFAM', /\bafam\b/i], ['Supersprox', /\bsupersprox\b/i], ['Michelin', /\bmichelin\b/i], ['Pirelli', /\bpirelli\b/i],
  ['Metzeler', /\bmetzeler\b/i], ['Dunlop', /\bdunlop\b/i], ['Bridgestone', /\bbridgestone\b/i], ['Continental', /\bcontinental\b/i], ['Mitas', /\bmitas\b/i],
  ['Heidenau', /\bheidenau\b/i], ['Maxxis', /\bmaxxis\b/i], ['Kenda', /\bkenda\b/i], ['Athena', /\bathena\b/i], ['Wiseco', /\bwiseco\b/i],
  ['Vertex', /\bvertex\b/i], ['ProX', /\bpro[\s-]?x\b/i], ['Tusk', /\btusk\b/i], ['Polisport', /\bpolisport\b/i], ['Acerbis', /\bacerbis\b/i],
  ['Öhlins', /\b(?:ö|oe|o)hlins\b/i], ['WP', /\bWP\b/], ['KYB', /\bKYB\b/], ['Showa', /\bshowa\b/i], ['Yuasa', /\byuasa\b/i], ['Varta', /\bvarta\b/i],
  ['Exide', /\bexide\b/i], ['CTEK', /\bCTEK\b/i], ['Optimate', /\boptimate\b/i], ['Moose Racing', /\bmoose\s?racing\b/i], ['All Balls', /\ball\s?balls\b/i],
  ['Stahlbus', /\bstahlbus\b/i], ['Motion Pro', /\bmotion\s?pro\b/i]
];

/* Gattungswörter: eine Zeile damit nach dem Titel ist Beschreibung („Vollsynthetisches Motorenöl“) */
const NOUN = new RegExp('motor(?:en)?' + U + 'l|engine\\s*oil|motor\\s*oil|getriebe' + U + 'l|gear\\s*oil|gabel' + U + 'l|fork\\s*oil|bremsfl' + UE + 'ssigkeit|brake\\s*fluid|k' + UE + 'hlmittel|coolant|'
  + U + 'lfilter|oil\\s*filter|luftfilter|air\\s*filter|z' + UE + 'ndkerze|spark\\s*plug|bremsbel' + A + 'g|brake\\s*pad|kettenspray|chain\\s*lube|batterie|battery', 'i');
const ART_LABEL = /(?:art(?:ikel)?\.?\s*-?\s*n(?:r|o)\.?|artikel-?nummer|best(?:ell)?\.?\s*-?\s*nr\.?|bestellnummer|teile-?nummer|part\s*(?:no|number|#)\.?|item\s*(?:no|number)\.?|ref\.?(?:\s*nr\.?)?)\s*[:#]?\s*([A-Z0-9][A-Z0-9./-]{0,22}[A-Z0-9]|[0-9])/i;
const MAKER_CODES = [['HifloFiltro', /\bHF\s?-?(\d{2,4}[A-Z]{0,2})\b/, m => 'HF' + m[1]], ['K&N', /\bKN\s?-?(\d{3}[A-Z]?)\b/, m => 'KN-' + m[1]]];
const VOLUME = /(\d+(?:[.,]\d+)?)\s*(ml|l|ltr\.?|liter|litre|liters|litres)(?![a-z])/i;
const WEIGHT = /(\d+(?:[.,]\d+)?)\s*(kg|g)(?![a-z])/i;
const PIECES = /(\d+)\s*(st(?:ü|ue|u)ck|stk\.?|pcs|pieces|satz|s(?:ä|ae|a)tze|paar)(?![a-z])/i;
const PACK_N = /\b(\d+)er[\s-]?(pack|set|packung)\b/i;
const VISC = /\b(0|5|10|15|20|25)\s?W\s?-?\s?(20|30|40|50|60)\b/i;
const FIT = /passend\s+f(?:ü|ue|u)r|geeignet\s+f(?:ü|ue|u)r|\bfits?\b|compatible|f(?:ü|ue|u)r\s+modelle/i;
const NOISE = /www\.|https?:|@|made\s+in|inhalt|warnung|achtung|vorsicht|gefahr|warning|danger|warenkorb|preis|€|eur\b|inkl\.|mwst|versand|lieferzeit|\bean\b|charge|lot\b|mhd|haltbar|hergestellt|vertrieb|gmbh|\bkg\b(?=\s*$)|tel\.|fax/i;

const clean = s => String(s == null ? '' : s).replace(/[‘’‚‛]/g, "'").replace(/[“”„]/g, '"').replace(/\s+/g, ' ').trim();
const letters = s => (s.match(/[A-Za-zÄÖÜäöüß]/g) || []).length;
const num = s => String(s).replace(',', '.');
const fmtNum = s => { const n = Number(num(s)); return Number.isFinite(n) ? String(n).replace('.', ',') : String(s); };

/* Zeilen vereinheitlichen: nur lesbare Zeilen zählen (Sicherheit ab 60, mindestens zwei Buchstaben oder Ziffern) */
export function usableLines(lines){
  return (Array.isArray(lines) ? lines : []).map((l, i) => ({t: clean(l && l.t), c: Number(l && l.c) || 0, h: Number(l && l.h) || 0, i}))
    .filter(l => l.t && l.c >= MIN_CONF && (letters(l.t) >= 2 || /\d{2,}/.test(l.t) || VOLUME.test(l.t) || WEIGHT.test(l.t) || PIECES.test(l.t)));
}

function pick(field, value, conf, from){ value = value || ''; return {value, state: value ? (conf >= OK_CONF ? 'ok' : 'check') : '', from: from || ''}; }

/* Hauptfunktion: lines = [{t, c, h}] in Lesereihenfolge, codes = [{format, value}] (Strichcodes, falls gelesen) */
export function parseLabel(lines, codes){
  const L = usableLines(lines);
  const out = {name: pick(), cat: pick(), sub: pick(), maker: pick(), artNo: pick(), spec: pick(), pack: pick(), ean: pick(), fit: '', empty: false, text: L.map(l => l.t)};
  const ean = (Array.isArray(codes) ? codes : []).map(c => String(c && c.value || '')).find(v => /^\d{8}$|^\d{12,14}$/.test(v));
  if (ean) out.ean = {value: ean, state: 'ok', from: 'Strichcode'};
  if (!L.length) { out.empty = !ean; return out; }

  /* Hersteller: wörtlich gelesen; mehrere verschiedene = unsicher */
  const makers = [];
  L.forEach(l => MAKERS.forEach(([name, re]) => { if (re.test(l.t) && !makers.some(m => m.name === name)) makers.push({name, l}); }));
  if (makers.length) {
    const best = makers.slice().sort((a, b) => b.l.h - a.l.h)[0];
    out.maker = {value: best.name, state: makers.length === 1 && best.l.c >= OK_CONF ? 'ok' : 'check', from: best.l.t};
  }

  /* Artikelnummer: nur mit Bezeichnung auf dem Etikett („Art.-Nr.“, „Part No.“ …) sicher; Typnummer eines bekannten
     Herstellers (z. B. HF204) nur zusammen mit dessen Namen sicher, sonst Vorschlag */
  for (const l of L) { const m = l.t.match(ART_LABEL); if (m && /\d/.test(m[1])) { out.artNo = {value: m[1].replace(/[.\-/]$/, ''), state: l.c >= OK_CONF ? 'ok' : 'check', from: l.t}; break; } }
  if (!out.artNo.value) {
    for (const [mk, re, fmt] of MAKER_CODES) {
      const l = L.find(x => re.test(x.t)); if (!l) continue;
      out.artNo = {value: fmt(l.t.match(re)), state: out.maker.value === mk && l.c >= OK_CONF ? 'ok' : 'check', from: l.t}; break;
    }
  }

  /* Gebindegröße: Inhalt eines vollen Gebindes laut Etikett (nicht der Restinhalt) */
  const packs = [];
  L.forEach(l => {
    let m = l.t.match(VOLUME);
    if (m && !/^\d+\s*w\b/i.test(m[0])) { const u = /^ml$/i.test(m[2]) ? 'ml' : 'L'; packs.push({v: fmtNum(m[1]) + ' ' + u, l}); return; }
    if ((m = l.t.match(WEIGHT)) && !NOISE.test(l.t.replace(/\bkg\b/i, ''))) { packs.push({v: fmtNum(m[1]) + ' ' + m[2].toLowerCase(), l}); return; }
    if ((m = l.t.match(PIECES))) { const w = m[2].toLowerCase(); const unit = /satz|s(ä|ae|a)tze/.test(w) ? (m[1] === '1' ? 'Satz' : 'Sätze') : /paar/.test(w) ? 'Paar' : 'Stück'; packs.push({v: m[1] + ' ' + unit, l}); return; }
    if ((m = l.t.match(PACK_N))) packs.push({v: m[1] + 'er-' + (m[2].toLowerCase() === 'set' ? 'Set' : 'Pack'), l});
  });
  if (packs.length) {
    const vals = Array.from(new Set(packs.map(p => p.v))), best = packs.slice().sort((a, b) => b.l.h - a.l.h)[0];
    out.pack = {value: best.v, state: vals.length === 1 && best.l.c >= OK_CONF ? 'ok' : 'check', from: best.l.t};
  }

  /* Kategorie */
  let rule = null, ruleLine = null;
  for (const r of RULES) { const ls = L.filter(x => r[0].test(x.t)); if (ls.length) { rule = r; ruleLine = ls.sort((a, b) => b.c - a.c)[0]; break; } }
  const vis = L.find(l => VISC.test(l.t));
  if (!rule && vis) { rule = [null, 'fluids', 'Motoröl', false, true]; ruleLine = vis; }
  if (rule) {
    const weak = !!rule[4];
    out.cat = {value: rule[1], state: !weak && ruleLine.c >= OK_CONF ? 'ok' : 'check', from: ruleLine.t};
    if (rule[2]) out.sub = {value: rule[2], state: !weak && ruleLine.c >= OK_CONF ? 'ok' : 'check', from: ruleLine.t};
  }

  /* Spezifikation: Viskosität, Takt, Grundöl, Normen, Reifengröße, Belagart */
  const spec = [], add = s => { if (s && !spec.includes(s)) spec.push(s); };
  let specConf = 100;
  const all = L.map(l => l.t).join(' \n ');
  const take = (re, f) => { const l = L.find(x => re.test(x.t)); if (l) { add(f(l.t.match(re))); specConf = Math.min(specConf, l.c); } };
  take(VISC, m => m[1] + 'W-' + m[2]);
  if (out.sub.value === 'Gabelöl' || out.sub.value === 'Federbeinöl') take(/\b(\d{1,2}(?:[.,]5)?)\s?W\b(?!\s?-?\d)/i, m => fmtNum(m[1]) + 'W');
  if (out.cat.value === 'fluids') {
    take(/\b4\s?T\b|4-takt|4-stroke/i, () => '4T'); take(/\b2\s?T\b|2-takt|2-stroke/i, () => '2T');
    /* Häufige Verwechslung beim Lesen: „4T“ als „AT“ neben einer Viskosität; nur als Vorschlag */
    if (!spec.includes('4T') && !spec.includes('2T')) { const l = L.find(x => /\bAT\b/.test(x.t) && VISC.test(x.t)); if (l) { add('4T'); specConf = Math.min(specConf, OK_CONF - 1); } }
    take(/vollsynth\w*|fully\s*synth\w*|full\s*synth\w*/i, () => 'vollsynthetisch');
    if (!spec.includes('vollsynthetisch')) take(/teilsynth\w*|semi[\s-]?synth\w*/i, () => 'teilsynthetisch');
    if (!spec.includes('vollsynthetisch') && !spec.includes('teilsynthetisch')) take(/\bsynth\w*/i, () => 'synthetisch');
    take(/mineral\w*/i, () => 'mineralisch');
  }
  take(/\bJASO\s?(MA2|MA1|MA|MB|FD|FC)\b/i, m => 'JASO ' + m[1].toUpperCase());
  take(/\bAPI\s?(S[A-Z]|C[A-Z](?:-\d)?|T[A-Z])\b/i, m => 'API ' + m[1].toUpperCase());
  take(/\bACEA\s?([A-C]\d(?:\/[A-C]\d)?)\b/i, m => 'ACEA ' + m[1].toUpperCase());
  take(/\bDOT\s?(5\.1|3|4|5)\b/i, m => 'DOT ' + m[1]);
  take(/\b(\d{2,3}\/\d{2,3}[\s-]?R?\d{2})\b/, m => m[1].replace(/\s/g, ''));
  if (out.cat.value === 'brakes') { take(/\bsinter\w*/i, () => 'Sinter'); take(/\borgani\w*/i, () => 'organisch'); }
  if (spec.length) out.spec = {value: spec.join(', '), state: specConf >= OK_CONF ? 'ok' : 'check', from: ''};

  /* Passungsangabe: nur als Hinweis, keine Zuordnung */
  const fit = L.find(l => FIT.test(l.t)); if (fit) out.fit = fit.t;

  /* Bezeichnung: die großen Titelzeilen oben (ohne reine Hersteller-, Mengen-, Nummern- oder Gattungszeilen),
     zusammenhängend bis zur ersten Beschreibung. Sonst aus Unterkategorie, Hersteller und Nummer zusammengesetzt. */
  const isArt = t => ART_LABEL.test(t) || MAKER_CODES.some(([, re]) => re.test(t) && t.replace(re, '').replace(/[^A-Za-z0-9]/g, '').length < 2);
  const brandOnly = t => out.maker.value && MAKERS.some(([n, re]) => n === out.maker.value && re.test(t) && letters(t.replace(re, '')) < 2);
  const packOnly = t => (VOLUME.test(t) || WEIGHT.test(t) || PIECES.test(t)) && letters(t.replace(VOLUME, '').replace(WEIGHT, '').replace(PIECES, '')) < 3;
  const generic = t => { if (!RULES.some(r => r[0].test(t)) || /\d/.test(t)) return false; let rest = t; RULES.forEach(r => { rest = rest.replace(new RegExp(r[0].source, 'gi'), ' '); }); return letters(rest) < 3; };
  const descr = t => /,|\bund\b|\bfür\b|\bmit\b|\bfor\b|\bwith\b|\band\b/i.test(t) || t.split(' ').length > 6;
  const maxH = Math.max(...L.filter(l => !brandOnly(l.t) && !isArt(l.t) && !packOnly(l.t)).map(l => l.h), 0);
  const title = [];
  for (const l of L) {
    if (NOISE.test(l.t) || FIT.test(l.t)) { if (title.length) break; continue; }
    if (brandOnly(l.t)) continue;
    if (isArt(l.t) || packOnly(l.t)) { if (title.length) break; continue; }
    const big = maxH && l.h >= 0.55 * maxH;
    if (!big || descr(l.t) || generic(l.t) || letters(l.t) < 3 || (title.length && NOUN.test(l.t))) { if (title.length) break; continue; }
    title.push(l);
    if (title.length >= 4) break;
  }
  if (title.length) {
    let t = title.map(l => l.t).join(' ');
    if (out.maker.value && !MAKERS.some(([n, re]) => n === out.maker.value && re.test(t))) t = out.maker.value + ' ' + t;
    out.name = {value: t.slice(0, 120), state: title.every(l => l.c >= 80) ? 'ok' : 'check', from: ''};
  } else {
    const t = [out.sub.value || (out.cat.value ? catName(out.cat.value) : ''), out.maker.value, out.artNo.value].filter(Boolean).join(' ');
    if (t) out.name = {value: t.slice(0, 120), state: 'check', from: ''};
  }
  out.empty = !['name', 'cat', 'maker', 'artNo', 'spec', 'pack', 'ean'].some(k => out[k].value);
  return out;
}

/* Vorhandene Artikel, die zum Vorschlag passen (zum Auffüllen). Stark: gleicher Strichcode oder gleiche Artikelnummer
   (bei bekanntem Hersteller auch derselbe); mittel: gleicher Name oder gleiche Unterkategorie, Hersteller, Spezifikation und Gebinde. */
const normCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const normName = s => String(s || '').toLocaleLowerCase('de').replace(/[^a-z0-9äöüß]/g, '');
export function matchParts(prop, parts){
  const v = k => (prop && prop[k] && typeof prop[k] === 'object' ? prop[k].value : prop && prop[k]) || '';
  const out = [];
  (parts || []).forEach(p => {
    let why = '';
    if (v('ean') && p.ean && v('ean') === p.ean) why = 'gleicher Strichcode';
    else if (v('artNo') && p.artNo && normCode(v('artNo')) === normCode(p.artNo) && (!v('maker') || !p.maker || v('maker') === p.maker)) why = 'gleiche Artikelnummer';
    else if (v('name') && normName(v('name')) && normName(v('name')) === normName(p.name)) why = 'gleiche Bezeichnung';
    else if (v('sub') && v('maker') && v('sub') === p.sub && v('maker') === p.maker && v('spec') && v('spec') === p.spec && v('pack') && v('pack') === p.pack) why = 'gleiche Angaben';
    if (why) out.push({part: p, why, strong: why === 'gleicher Strichcode' || why === 'gleiche Artikelnummer'});
  });
  return out.sort((a, b) => (b.strong - a.strong) || String(a.part.name).localeCompare(String(b.part.name), 'de')).slice(0, 3);
}
