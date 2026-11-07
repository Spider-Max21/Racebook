/* Racebook – Rechnungspositionen aus erkanntem Text (ab 1.6.0, Issue #4).
   Eingabe: Textzeilen der Erkennung auf dem Gerät ({t, c = Sicherheit 0–100}). Ergebnis: ein Vorschlag zum Prüfen, nie gespeichert.
   Regeln:
   - Eine Position ist eine Zeile mit mindestens einem Betrag („2 x Ölfilter HF204 9,90 19,80“). Reine Textzeilen danach gehören
     zur Bezeichnung (zweizeilige Bezeichnung). Eine Betragszeile ohne Bezeichnung („2 x 9,90 19,80“) übernimmt die Textzeile davor.
   - Versand, Steuer, Zwischen- und Endsummen, Rabatte, Zahlungs- und Kopfangaben (Rechnungs-, Kunden-, Bestellnummer, Datum)
     werden nie Positionen; ihre Beträge werden als „nicht übernommen“ genannt.
   - Mehrere Beträge: der letzte ist die Zeilensumme, der davor der Einzelpreis. Ein einzelner Betrag ist bei Menge 1 Einzelpreis
     und Zeilensumme; bei größerer oder unbekannter Menge bleibt offen, was er ist (kein Umrechnen, kein Schätzen).
   - Menge nur aus einer lesbaren Angabe: „2 x …“ oder „2 Stk …“ am Zeilenanfang (auch nach einer Positionsnummer), „2 x 9,90“,
     „Menge 2“, oder eine einzelne Zahl direkt vor den Beträgen, wenn Menge × Einzelpreis genau die Zeilensumme ergibt. „100 Stück“
     in der Bezeichnung ist keine Menge. Passt Menge × Einzelpreis nicht zur Zeilensumme, wird die Position zur Prüfung markiert.
   - Die Einheit (Stück/Gebinde) wird nie vorgeschlagen; der Nutzer bestätigt sie. Eine Gebindegröße („4 L“) nur aus der Bezeichnung.
   - Artikelnummer mit Bezeichnung („Art.-Nr.“, „Artikel-Nr.“, „Bestell-Nr.“ in Positions- oder Fortsetzungszeile) oder als
     Typnummer aus Großbuchstaben und Ziffern in der Positionszeile (dann „bitte prüfen“); Rechnungs- und Kundennummern nie.
   - Kaufdatum und Händler nur, wenn sie im Ausschnitt lesbar sind: Händler nur als oberste Textzeile vor sichtbaren Kopfangaben
     (Rechnung, Datum, Kunden-Nr. …). Ein Ausschnitt ohne Kopf und ohne Summe ist gültig. */

export const OK_CONF = 75, MIN_CONF = 50;
const AMT_RE = /(?<![\d.,])(-?\d{1,3}(?:\.\d{3})+,\d{2}|-?\d{1,5},\d{2}|-?\d{1,5}\.\d{2})(?![\d.,])(?:\s*(?:€|eur\b))?/gi;
const SKIP = [
  ['Versand', /versand|porto|fracht|lieferkosten|liefergeb|shipping|nachnahme/i],
  ['Steuer', /mwst|mehrwertsteuer|umsatzsteuer|\bust\b|\bust\.|steuer|\bvat\b|\btax\b/i],
  ['Summe', /zwischensumme|endsumme|gesamtsumme|gesamtbetrag|rechnungsbetrag|endbetrag|\bsumme\b|\bgesamt\b|\btotal\b|zu\s+zahlen|bezahlt|betrag\s+erhalten|r(?:ü|ue|u)ckgeld/i],
  ['Rabatt', /rabatt|nachlass|gutschein|skonto|coupon|discount/i],
  ['Netto/Brutto', /\bnetto\b|\bbrutto\b/i],
  ['Zahlung', /zahlung|(?:ü|ue)berweisung|paypal|kreditkarte|girocard|\biban\b|\bbic\b|bankverbindung|kontonummer/i],
  ['Kopfangabe', /rechnung|quittung|kassenbon|beleg-?\s*nr|kunden-?\s*nr|kundennummer|bestell-?\s*nr\.?\s*:|bestellnummer\s*:|auftrags-?\s*nr|lieferschein|ust-?\s*id|steuer-?\s*nr|\btel\.|telefon|\bfax\b|e-?mail|www\.|https?:|seite\s+\d|\bdatum\b/i]
];
const TABLE_HEAD = /\b(?:pos\.?|position)\b.*\b(?:menge|anz\.?|anzahl|bezeichnung|artikel)\b|\b(?:menge|anzahl)\b.*\b(?:einzel|preis|betrag|summe)\b|\bbezeichnung\b.*\b(?:preis|betrag)\b/i;
const QTY_LEAD = /^((?:pos\.?\s*)?\d{1,3}[.)]?\s+|\S{1,3}\s+(?=\d{1,4}\s*[x×]\s+[A-Za-zÄÖÜäöü]))?(\d{1,4})\s*(?:x|×|stk\.?|stck\.?|st(?:ü|ue|u)ck|st\.)(?=\s|$)/i;
const QTY_TIMES = /(?:^|\s)(\d{1,4})\s*[x×]\s*(?=-?\d{1,5}[.,]\d{2})/i;
const QTY_LABEL = /\b(?:menge|anzahl|anz\.?)\s*:?\s*(\d{1,4})\b/i;
const ART_LABEL = /(?:art(?:ikel)?\.?\s*-?\s*n(?:r|o)\.?|artikel-?nummer|best(?:ell)?\.?\s*-?\s*nr\.?|teile-?nummer|part\s*(?:no|number)\.?)\s*:?\s*([A-Z0-9][A-Z0-9.\-\/]{1,24})/i;
const CODE_RE = /\b(?=[A-Z0-9-]{4,16}\b)(?=[A-Z0-9-]*\d)(?=[A-Z0-9-]*[A-Z])[A-Z0-9]+(?:-[A-Z0-9]+)*\b/g;
const VISC = /^\d{1,2}W-?\d{2}$/i;
const PACK_RE = /(\d+(?:[.,]\d+)?)\s*(ml|l|ltr\.?|liter|kg|g)(?![a-zäöü])/i;
const DATE_RE = /\b(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})\b/;

const clean = s => String(s == null ? '' : s).replace(/[‘’‚‛]/g, "'").replace(/[“”„]/g, '"').replace(/\s+/g, ' ').trim();
const letters = s => (String(s).match(/[A-Za-zÄÖÜäöüß]/g) || []).length;
const field = (value, state, from) => ({value: value == null ? '' : value, state: value === '' || value == null ? 'none' : state, from: from || ''});
const codes = t => Array.from(String(t).matchAll(CODE_RE), m => m[0]);
/* Betrag in deutscher oder englischer Schreibweise → Cent */
export function amountCents(s){
  let t = String(s).replace(/\s|€|eur/gi, ''), neg = t.startsWith('-'); if (neg) t = t.slice(1);
  if (/^\d{1,3}(?:\.\d{3})+,\d{2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.'); else t = t.replace(',', '.');
  const v = Math.round(Number(t) * 100);
  return Number.isSafeInteger(v) ? (neg ? -v : v) : null;
}
export const centsText = c => c == null ? '' : (c / 100).toFixed(2).replace('.', ',');
function amounts(t){
  const out = []; let m; AMT_RE.lastIndex = 0;
  while ((m = AMT_RE.exec(t))) out.push({text: m[1], cents: amountCents(m[1]), at: m.index, len: m[0].length});
  return out;
}
const skipOf = t => { for (const [why, re] of SKIP) if (re.test(t)) return why; return ''; };
function isoDate(m){
  let d = +m[1], mo = +m[2], y = +m[3]; if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return '';
  const dt = new Date(Date.UTC(y, mo - 1, d)); if (dt.getUTCDate() !== d) return '';
  return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}
const cut = (s, at, len) => s.slice(0, at) + ' '.repeat(len) + s.slice(at + len);

/* Menge einer Positionszeile: {n, at, len} oder null (nur ausdrücklich lesbar, siehe oben) */
function qtyOf(t, am){
  let m = t.match(QTY_LEAD);
  if (m) return {n: +m[2], at: 0, len: m[0].length};   /* samt Positionsspalte davor (auch falsch gelesen) */
  m = t.match(QTY_TIMES); if (m) { const o = m[0].indexOf(m[1]); return {n: +m[1], at: m.index + o, len: m[0].length - o}; }
  m = t.match(QTY_LABEL); if (m) return {n: +m[1], at: m.index, len: m[0].length};
  /* einzelne Zahl direkt vor den Beträgen (Spalte „Menge“) – nur wenn Menge × Einzelpreis = Zeilensumme */
  if (am.length >= 2) {
    const before = t.slice(0, am[am.length - 2].at), b = before.match(/(?:^|\s)(\d{1,4})\s*$/);
    if (b && +b[1] > 0 && +b[1] * am[am.length - 2].cents === am[am.length - 1].cents) return {n: +b[1], at: before.length - b[0].length + b[0].indexOf(b[1]), len: b[1].length};
  }
  return null;
}
/* Bezeichnung aus einer Positionszeile: ohne Positionsnummer, Menge, Beträge, Artikelnummer mit Bezeichnung */
function nameOf(t, am, q, art){
  let s = t;
  am.forEach(a => { s = cut(s, a.at, a.len); });
  if (q) s = cut(s, q.at, q.len);
  if (art) s = cut(s, art.index, art[0].length);
  s = s.replace(/€|\beur\b/gi, ' ').replace(/^\s*(?:pos\.?\s*)?\d{1,3}[.)]?\s+(?=\S)/i, ' ').replace(/\s[x×](?=\s|$)/g, ' ');
  return clean(s).replace(/^[-–:;,.\s]+|[-–:;,\s]+$/g, '');
}

export function parseReceipt(lines){
  const L = (lines || []).map(l => ({t: clean(l.t), c: Number.isFinite(l.c) ? l.c : 100})).filter(l => l.t && l.c >= MIN_CONF);
  const out = {items: [], skipped: [], date: field('', ''), vendor: field('', ''), header: false, totals: false, net: false, empty: true};
  let cur = null, pending = [], firstHead = -1, firstItem = -1;
  const dl = L.find(l => /datum/i.test(l.t) && DATE_RE.test(l.t)) || L.find(l => DATE_RE.test(l.t) && !amounts(l.t).length);
  if (dl) { const v = isoDate(dl.t.match(DATE_RE)); if (v) out.date = field(v, 'check', dl.t); }
  L.forEach((l, i) => {
    const t = l.t, am = amounts(t), why = skipOf(t);
    if (TABLE_HEAD.test(t)) { out.header = true; if (firstHead < 0) firstHead = i; cur = null; pending = []; return; }
    if (why) {
      if (/\bnetto\b|zzgl\.?/i.test(t)) out.net = true;
      if (why === 'Summe') out.totals = true;
      if (why === 'Kopfangabe') { out.header = true; if (firstHead < 0) firstHead = i; }
      if (am.length) out.skipped.push({t, why});
      if (why === 'Rabatt' && cur) cur.notes.push('Rabatt in der nächsten Zeile – nicht eingerechnet, bitte prüfen');
      cur = null; pending = [];
      return;
    }
    if (!am.length && !(QTY_LEAD.test(t) && letters(t) >= 3)) {
      if (letters(t) < 2) return;
      if (cur) cur.cont.push(l); else pending.push(l);
      return;
    }
    const art = t.match(ART_LABEL), q = qtyOf(t, am);
    let name = nameOf(t, am, q, art);
    const from = [l];
    if (letters(name) < 3) {
      /* „2 x 9,90 19,80“: die Bezeichnung steht in der Zeile davor */
      const prev = cur && cur.cont.length ? cur.cont.pop() : pending.length ? pending.pop() : null;
      if (prev) { name = clean(prev.t + (name ? ' ' + name : '')); from.unshift(prev); }
    }
    pending = [];
    if (firstItem < 0) firstItem = i;
    cur = {name, art, q, am, from, cont: [], notes: [], conf: Math.min(...from.map(x => x.c))};
    out.items.push(cur);
  });
  /* Händler: oberste Textzeile, nur wenn danach Kopfangaben folgen und sie vor der ersten Position steht */
  if (firstHead > 0) {
    const end = firstItem < 0 ? firstHead : Math.min(firstHead, firstItem);
    const v = L.slice(0, end).find(l => !amounts(l.t).length && letters(l.t) >= 3 && !skipOf(l.t));
    if (v && L.indexOf(v) <= 2) out.vendor = field(v.t.slice(0, 80), 'check', v.t);
  }
  out.items = out.items.map(itemOf).filter(Boolean);
  out.empty = !out.items.length && !out.skipped.length && !out.date.value;
  return out;
}

function itemOf(x){
  const ok = x.conf >= OK_CONF ? 'ok' : 'check';
  let art = x.art, name = x.name;
  x.cont.forEach(l => {
    const a = l.t.match(ART_LABEL);
    if (a && !art) { art = a; const rest = clean(l.t.replace(ART_LABEL, ' ')); if (letters(rest) >= 2) name = clean(name + ' ' + rest); }
    else name = clean(name + ' ' + l.t);
  });
  if (letters(name) < 2 && !art) return null;
  const notes = x.notes.slice();
  let artNo = field('', '');
  if (art) artNo = field(art[1].replace(/[.\-\/]+$/, ''), ok, art[0]);
  else { const c = codes(x.from.map(l => l.t).join(' ')).find(v => !VISC.test(v)); if (c) artNo = field(c, 'check', c); }
  const a = x.am.filter(v => v.cents != null && v.cents >= 0);
  if (!x.am.length) {
    /* Mengenangabe lesbar, Beträge nicht: Ziffernfolgen am Ende („12750 1250“) sind vermutlich falsch gelesene Preise */
    name = clean(name.replace(/(?:\s+\d{3,})+\s*$/, ''));
    notes.push('Preise nicht lesbar – bitte selbst eintragen');
  }
  const qty = x.q ? x.q.n : null;
  let unit = null, total = null;
  if (a.length >= 2) { unit = a[a.length - 2].cents; total = a[a.length - 1].cents; }
  else if (a.length === 1) {
    if (qty === 1) { unit = a[0].cents; total = a[0].cents; }
    else { total = a[0].cents; notes.push(qty == null ? 'Nur ein Betrag lesbar – Menge und Einzelpreis bitte selbst eintragen' : 'Nur ein Betrag lesbar – Einzelpreis bitte selbst eintragen'); }
  }
  if (x.am.some(v => v.cents != null && v.cents < 0)) notes.push('Negativer Betrag in der Zeile – bitte prüfen');
  let sumOk = null;
  if (qty != null && unit != null && total != null) {
    sumOk = qty * unit === total;
    if (!sumOk) notes.push('Menge × Einzelpreis ergibt nicht die Zeilensumme – bitte prüfen');
  } else if (qty == null && unit != null) notes.push('Menge nicht lesbar – bitte selbst eintragen');
  const pk = name.match(PACK_RE);
  const st = sumOk === false || notes.length ? 'check' : ok;
  return {
    name: field(name.slice(0, 120), name.length > 120 ? 'check' : st),
    artNo,
    qty: field(qty == null ? '' : String(qty), st),
    price: field(unit == null ? '' : centsText(unit), st),
    total: field(total == null ? '' : centsText(total), st),
    pack: field(pk ? pk[1] + ' ' + ({ml: 'ml', kg: 'kg', g: 'g'}[pk[2].toLowerCase()] || 'L') : '', 'check'),
    sumOk, notes, lines: x.from.concat(x.cont).map(l => l.t), select: qty != null && unit != null && sumOk === true
  };
}
