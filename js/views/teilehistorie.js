/* Racebook – Verbaute Teile: Teilehistorie und eigene Erfahrungen (ab 1.7.0, Roadmap 6, Auftrag Issue #5).
   - Montierte Teile (Reifen vorn/hinten, Kette, weitere Teile) sind antippbar (auch auf dem Handy): Hersteller, Modell,
     Artikelnummer, Montage mit Stand, bisherige Nutzung über Zählerwechsel hinweg, Einsatz, Fahrten im Zeitraum, eigene Bewertung.
   - Wechsel eintragen / Ausbauen: Ausbau mit Datum, Stand, Grund (verschlissen, defekt, vorsorglich, anderer Einsatz) und eigener
     Bewertung mit Merkhilfe „Wieder kaufen / Nicht noch einmal“; das neue Teil oder ein früher ausgebautes (Wiedermontage).
   - Verlauf ausgebauter Teile: bearbeiten, löschen, früheres Teil nachtragen (unbekannte Angaben bleiben leer, nichts geschätzt).
   - Vergleich eigener Einsätze nach Hersteller/Modell und erreichter Nutzung – keine Rangliste.
   Der Lagerbestand wird nie verändert. Gespeichert wird in einem Vorgang am Motorrad (tires/chain/hist) samt Logbuch-Eintrag bei
   Reifen und Kette. Mehrere Fenster: der Entwurf beruht auf dem Teil beim Öffnen; hat es sich geändert, wird nichts gespeichert
   (Eingaben bleiben, Hinweis, erneut speichern). Änderungen an anderen Teilen werden übernommen, nie überschrieben. */
import {S, bikeList, U, bikeName} from '../state.js';
import {$, $$, toast, errText, arm, VErr, fieldNum, fieldDate} from '../ui.js';
import {esc, str, fmt, fmtDate, todayISO, uid, canon, clone, subOf, v2} from '../util.js';
import {GROUNDS, LIM, PART_USES, PART_VERDICTS, PART_REASONS, HIST_SLOTS, MAX_HIST, canonDoc, curOf, posAt, derive, meterSegments, shortName} from '../domain.js';
import * as M from '../mounts.js';
import * as store from '../store.js';
import {opFor, parkOp, execOp, flow} from '../ops.js';
import * as drafts from '../drafts.js';
import {jumpOk, askSegments} from './counter.js';
import {R} from '../registry.js';

const MODE_TITLE = {edit: 'Angaben bearbeiten', swap: 'Wechsel eintragen', remove: 'Teil ausbauen', mount: 'Teil montieren', addhist: 'Früheres Teil nachtragen'};
const LOG_KIND = {tf: 'tire', tr: 'tire', chain: 'chain'};
const nu = v => v === undefined ? null : v;
const unitOf = b => U(b);

/* ---------- Lesen ---------- */
/* Eintrag zu einer Kennung: 'cur:tf' | 'cur:tr' | 'cur:chain' (montiert) oder Kennung im Verlauf */
export function recOf(b, id){ return M.recordsOf(b).find(r => r.id === id) || null; }
/* Gespeicherter Stand, auf dem ein Entwurf beruht: das Teil selbst (Reifen/Kette aus tires/chain, sonst der Verlaufseintrag) */
function rawTarget(raw, id){
  if (!raw || !id) return null;
  if (id === 'cur:tf') return nu((raw.tires || {}).front);
  if (id === 'cur:tr') return nu((raw.tires || {}).rear);
  if (id === 'cur:chain') return nu(raw.chain);
  return (Array.isArray(raw.hist) ? raw.hist : []).find(r => r.id === id) || null;
}
const slotOfId = id => id === 'cur:tf' ? 'tf' : id === 'cur:tr' ? 'tr' : id === 'cur:chain' ? 'chain' : '';
const isEmptyCur = (b, slot) => !M.currentOf(b).some(r => r.slot === slot);

function useText(b, u){
  if (u.state === 'amb') return 'Zähler unklar (beim Bearbeiten zuordnen)';
  if (u.state === 'check') return 'Stände prüfen';
  if (u.amount == null) return 'unbekannt';
  return fmt(u.amount, 2) + ' ' + u.unit;
}
/* Dauer: „12 Tage“, „etwa 3 Monate“, „etwa 1,5 Jahre“; since = „seit …“ (Dativ, 0 Tage = „seit heute“) */
function daysText(n, since){
  if (n == null) return '';
  if (since && n === 0) return 'seit heute';
  const pre = since ? 'seit ' : '';
  if (n < 60) return pre + n + (n === 1 ? ' Tag' : since ? ' Tagen' : ' Tage');
  const m = Math.round(n / 30.44);
  return pre + (m < 24 ? 'etwa ' + m + (since ? ' Monaten' : ' Monate') : 'etwa ' + fmt(n / 365.25, 1) + (since ? ' Jahren' : ' Jahre'));
}
function posText(b, p){
  const d = p && p.date ? 'am ' + fmtDate(p.date) : '', a = p && p.at != null ? 'bei ' + fmt(p.at, 2) + ' ' + unitOf(b) : '';
  return (d || a) ? [d, a].filter(Boolean).join(' ') : 'unbekannt';
}
function expText(r){
  const out = [];
  if (r.rating) out.push(r.rating + ' von 5');
  if (r.verdict) out.push(M.VERDICT_NAME[r.verdict]);
  return out.join(' · ');
}
function condText(r){
  return [r.use ? M.USE_NAME[r.use] : '', r.track ? 'Strecke ' + r.track : '', r.ground ? 'Untergrund ' + r.ground : ''].filter(Boolean).join(' · ');
}
function ridesText(b, r){
  const x = M.ridesIn(b, r, S.rides);
  if (!x || !x.n) return '';
  return x.n + (x.n === 1 ? ' Fahrt' : ' Fahrten') + (x.tracks.length ? ' · ' + x.tracks.map(([t, n]) => t + (n > 1 ? ' ' + n + '×' : '')).join(', ') : '') + (x.grounds.length ? ' · ' + x.grounds.join(', ') : '');
}

/* ---------- Montierte Teile (Status und Verbaute Teile) ---------- */
/* runtime(b, x): bisherige Anzeige „… gelaufen“ der Reifen/Kette (unverändert aus der Ansicht) */
export function cellsHTML(b, where, runtime){
  const t = b.tires || {}, c = b.chain || {}, tf = t.front || {}, tr = t.rear || {};
  const ratio = (c.front && c.rear) ? ' · ' + fmt(c.rear / c.front, 2) : '';
  const mo = S.mountOpen && S.mountOpen.where === where && S.mountOpen.bike === b.id ? S.mountOpen.id : '';
  const box = 'mi-' + where;
  const btn = (id, lbl, val, run) => '<button type="button" class="mount-cell" data-mount="' + esc(where + '|' + id) + '" aria-expanded="' + (mo === id) + '" aria-controls="' + box + '">'
    + '<span class="lbl">' + esc(lbl) + '</span><b>' + (val ? esc(val) : '<span class="hint">nicht eingetragen</span>') + '</b>' + (run ? '<span class="run">' + esc(run) + '</span>' : '') + '</button>';
  const cur = M.currentOf(b), lab = slot => { const r = cur.find(x => x.slot === slot); return r ? M.partLabel(r) : ''; };
  const xs = M.mountedOf(b).filter(r => r.slot === 'x');
  const xrun = r => { const u = M.usageOf(b, r); return u.amount != null ? fmt(u.amount) + ' ' + u.unit + ' gelaufen' : u.state === 'amb' ? 'Zähler unklar' : u.state === 'check' ? 'Montagestand prüfen' : ''; };
  let html = '<div class="mount">'
    + btn('cur:tf', 'Reifen vorn', lab('tf'), runtime(b, tf))
    + btn('cur:tr', 'Reifen hinten', lab('tr'), runtime(b, tr))
    + '<div class="mount-cell"><span class="lbl">Übersetzung</span><b>' + ((c.front && c.rear) ? esc(c.front + ' / ' + c.rear + ratio) : '<span class="hint">nicht eingetragen</span>') + '</b></div>'
    + btn('cur:chain', 'Kette', [lab('chain'), c.links ? c.links + ' Glieder' : ''].filter(Boolean).join(', '), runtime(b, c))
    + xs.map(r => btn(r.id, r.name, M.partLabel(r), xrun(r))).join('')
    + '</div>';
  const rec = mo ? (recOf(b, mo) || (slotOfId(mo) ? {id: mo, slot: slotOfId(mo), empty: true} : null)) : null;
  html += '<div id="' + box + '" class="mount-info-box">' + (rec ? infoHTML(b, rec, where) : '') + '</div>';
  return html;
}
function infoHTML(b, r, where){
  const head = '<div class="mount-info" role="region" aria-label="' + esc(M.slotLabel(r)) + '"><div class="card-h"><h3>' + esc(M.slotLabel(r)) + '</h3><button class="link" type="button" data-mount="' + esc(where + '|') + '">Schließen</button></div>';
  if (r.empty) return head + '<p class="hint">Nichts eingetragen.</p><div class="row"><button class="mini" type="button" data-hist="' + esc('mount|' + r.slot) + '">Teil eintragen</button></div></div>';
  const u = M.usageOf(b, r), life = r.prev ? M.lifeOf(b, r) : null, rides = ridesText(b, r), cond = condText(r), exp = expText(r);
  const dl = [['Teil', M.partLabel(r) || '–'], r.artNo ? ['Artikelnummer', r.artNo] : null, ['Montiert', posText(b, r.on)],
    ['Bisher', useText(b, u) + (u.amount != null ? ' gelaufen' : '') + (u.days != null ? ' · ' + daysText(u.days, true) + ' montiert' : '')],
    life ? ['Mit früherem Einbau', life.amount != null ? fmt(life.amount, 2) + ' ' + life.unit + ' in ' + life.n + ' Einbauten' + (life.complete ? '' : ' (nicht alle bekannt)') : 'unbekannt'] : null,
    cond ? ['Einsatz', cond] : null, rides ? ['Fahrten seit der Montage', rides] : null, exp ? ['Bewertung', exp] : null, r.note ? ['Erfahrung', r.note] : null].filter(Boolean);
  return head + '<dl class="kv">' + dl.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl>'
    + (u.state === 'unknown' ? '<p class="hint">Die Nutzung ist unbekannt, weil ein Stand fehlt. Racebook schätzt nichts.</p>' : '')
    + '<div class="row"><button class="mini" type="button" data-hist="' + esc('edit|' + r.id) + '">Angaben bearbeiten</button>'
    + '<button class="mini" type="button" data-hist="' + esc('swap|' + r.id) + '">Wechsel eintragen</button>'
    + '<button class="mini" type="button" data-hist="' + esc('remove|' + r.id) + '">Ausbauen</button>'
    + (r.slot === 'x' ? '<button class="mini" type="button" data-histdel="' + esc(r.id) + '" data-arm="Eintrag wirklich löschen?">Eintrag löschen</button>' : '')
    + '</div></div>';
}

/* ---------- Verlauf und Vergleich (Verbaute Teile) ---------- */
export function refresh(b){
  b = b || S.bikes[S.bike]; if (!b) return;
  if (S.hist && (S.hist.bike !== b.id || !$('#histForm'))) { if (S.hist.bike !== b.id) close(); else renderForm(); }
  const list = $('#histList'); if (list) list.innerHTML = listHTML(b);
  const cmp = $('#cmpBox'); if (cmp) cmp.innerHTML = cmpHTML(b);
}
function listHTML(b){
  const rs = M.removedOf(b).sort((x, y) => (y.off.date || '').localeCompare(x.off.date || '') || (y.on.date || '').localeCompare(x.on.date || ''));
  if (!rs.length) return '<p class="hint">Noch keine ausgebauten Teile. Beim nächsten Wechsel kommt das bisherige Teil hierher; frühere Teile kannst du nachtragen.</p>';
  return rs.map(r => {
    const u = M.usageOf(b, r), exp = expText(r), cond = condText(r);
    return '<div class="hist-row" data-hrow="' + esc(r.id) + '"><div class="hist-h"><b>' + esc(M.partLabel(r) || 'ohne Bezeichnung') + '</b><span class="tag">' + esc(M.slotLabel(r)) + '</span></div>'
      + '<div class="hint">' + esc('Montiert ' + posText(b, r.on) + ' · ausgebaut ' + posText(b, r.off)) + '</div>'
      + '<div>' + esc('Nutzung: ' + useText(b, u) + (u.days != null ? ' · ' + daysText(u.days) : '') + ' · Grund: ' + (r.reason ? M.REASON_NAME[r.reason] : 'unbekannt') + (M.ENDS_LIFE(r) ? '' : ' · nicht verbraucht')) + '</div>'
      + (cond ? '<div class="hint">' + esc(cond) + '</div>' : '') + (exp || r.note ? '<div>' + esc([exp, r.note].filter(Boolean).join(' – ')) + '</div>' : '')
      + '<div class="row"><button class="mini" type="button" data-hist="' + esc('edit|' + r.id) + '">Bearbeiten</button>'
      + (M.remountable(b, r) ? '<button class="mini" type="button" data-hist="' + esc('remount|' + r.id) + '">Wieder montieren</button>' : '')
      + '<button class="mini" type="button" data-histdel="' + esc(r.id) + '" data-arm="Eintrag wirklich löschen?">Löschen</button></div></div>';
  }).join('');
}
function cmpHTML(b){
  const st = S.cmp && S.cmp.bike === b.id ? S.cmp : (S.cmp = {bike: b.id, key: '', all: false});
  const bikes = st.all ? bikeList().filter(x => unitOf(x) === unitOf(b)) : [b];
  const keys = M.slotKeysOf(bikes);
  if (!keys.length) return '<p class="hint">Noch nichts zu vergleichen.</p>';
  if (!keys.some(([k]) => k === st.key)) st.key = keys[0][0];
  const groups = M.compareGroups(bikes, st.key, S.rides);
  return '<div class="grid"><div class="f"><label for="cmpSlot">Einbauort</label><select id="cmpSlot" data-nodirty>' + keys.map(([k, l]) => '<option value="' + esc(k) + '"' + (k === st.key ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select></div>'
    + '<div class="f"><label class="check"><input type="checkbox" id="cmpAll" data-nodirty' + (st.all ? ' checked' : '') + '><span>Alle Motorräder (' + (unitOf(b) === 'km' ? 'Kilometer' : 'Betriebsstunden') + ')</span></label></div></div>'
    + '<p class="hint">Eigene Einsätze nebeneinander, ältester zuerst – keine Rangliste und keine allgemeine Bewertung des Herstellers. Teile, die vorsorglich oder für einen anderen Einsatz ausgebaut wurden, waren nicht verbraucht.</p>'
    + groups.map(g => {
      const sp = Object.entries(g.span).map(([u, s]) => s.n > 1 ? fmt(s.min, 2) + '–' + fmt(s.max, 2) + ' ' + u : fmt(s.min, 2) + ' ' + u).join(', ');
      return '<div class="cmp-group"><div class="hist-h"><b>' + esc(g.label) + '</b><span class="tag">' + g.items.length + (g.items.length === 1 ? ' Einsatz' : ' Einsätze') + '</span></div>'
        + (sp ? '<div class="hint">Bekannte Nutzung je Einsatz: ' + esc(sp) + (g.ended ? ' · ' + g.ended + ' verschlissen oder defekt' : '') + (g.mounted ? ' · ' + g.mounted + ' noch montiert' : '') + '</div>' : '')
        + '<ul class="cmp-list">' + g.items.map(it => '<li>' + esc([st.all ? shortName(it.b) || bikeName(it.b) : '', (it.r.on.date ? fmtDate(it.r.on.date) : 'Montage unbekannt') + ' – ' + (it.r.off ? (it.r.off.date ? fmtDate(it.r.off.date) : 'Ausbau unbekannt') : 'montiert'),
          useText(it.b, it.use), it.r.off ? (it.r.reason ? M.REASON_NAME[it.r.reason] : 'Grund unbekannt') : '', condText(it.r), expText(it.r)].filter(Boolean).join(' · ')) + '</li>').join('') + '</ul></div>';
    }).join('');
}

/* ---------- Formular ---------- */
export const isOpen = () => !!S.hist;
export function close(){
  if (!S.hist) return;
  S.hist = null; drafts.forget('hist');
  const box = $('#histBox'); if (box) box.innerHTML = '';
}
/* Öffnen erst im Rückruf von drafts.begin: Teil und Grundlage aus dem Speicher (nicht aus einem vorher gemerkten Objekt) */
function open(mode, id){
  const b = S.bikes[S.bike]; if (!b) return;
  const raw = store.peek('bikes', b.id); if (!raw) return;
  const rb = Object.assign(clone(raw), {id: b.id});
  let target = '', src = '';
  if (mode === 'remount') {
    const r = recOf(rb, id);
    if (!r || !M.remountable(rb, r)) { toast('Dieses Teil kann nicht mehr wieder montiert werden.'); return; }
    src = id;
    const cur = M.mountedOf(rb).find(x => M.slotKey(x) === M.slotKey(r));
    if (cur) { mode = 'swap'; target = cur.id; } else { mode = 'mount'; target = r.slot === 'x' ? '' : 'cur:' + r.slot; }
  } else if (mode === 'mount') {
    target = id === 'x' ? '' : 'cur:' + id;
    if (target && !isEmptyCur(rb, id)) { toast('Hier ist schon ein Teil montiert. Trag einen Wechsel ein.'); return; }
  } else if (mode !== 'addhist') {
    target = id;
    const r = recOf(rb, id); if (!r) { toast('Diesen Eintrag gibt es inzwischen nicht mehr.'); return; }
    if ((mode === 'swap' || mode === 'remove') && r.off) { toast('Dieses Teil ist schon ausgebaut.'); return; }
  }
  const slot = mode === 'mount' ? (src ? recOf(rb, src).slot : (id === 'x' ? 'x' : id)) : mode === 'addhist' ? '' : (recOf(rb, target) || {}).slot;
  S.hist = {bike: b.id, epoch: S.epoch || '', mode, target, slot, src, base: target ? canon(rawTarget(raw, target)) : '', srcBase: src ? canon(rawTarget(raw, src)) : '', msg: ''};
  S.mountOpen = null;
  renderForm(rb);
  R.setSection('components', 'histBox');
  drafts.mark('hist');
  const f = $('#histForm input:not([type=hidden]), #histForm select'); if (f) f.focus();
}
function opt(list, cur, empty){ return (empty != null ? '<option value="">' + esc(empty) + '</option>' : '') + list.map(([k, l]) => '<option value="' + esc(k) + '"' + (k === cur ? ' selected' : '') + '>' + esc(l) + '</option>').join(''); }
function groundOpts(cur){ const l = GROUNDS.map(g => [g, g]); if (cur && !GROUNDS.includes(cur)) l.push([cur, cur]); return opt(l, cur || '', '–'); }
const RATES = [['1', '1 – schlecht'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5 – sehr gut']];
function fieldset(legend, inner){ return '<fieldset><legend>' + esc(legend) + '</legend><div class="grid">' + inner + '</div></fieldset>'; }
const fld = (id, label, input, full) => '<div class="f' + (full ? ' full' : '') + '"><label for="' + id + '">' + esc(label) + '</label>' + input + '</div>';
const inp = (id, val, extra) => '<input id="' + id + '" value="' + esc(val == null ? '' : val) + '"' + (extra || '') + '>';
function renderForm(rb){
  const h = S.hist, box = $('#histBox'); if (!h || !box) return;
  const b = rb || Object.assign(clone(store.peek('bikes', h.bike) || S.bikes[h.bike] || {}), {id: h.bike});
  const u = unitOf(b), cur = curOf(S.bikes[h.bike]), ph = cur == null ? '' : ' placeholder="' + esc(v2(cur)) + '"';
  const t = h.target ? recOf(b, h.target) : null, src = h.src ? recOf(b, h.src) : null, today = todayISO();
  const num = (id, val, p) => inp(id, v2(val), ' inputmode="decimal"' + (p || ''));
  const date = (id, val) => '<input type="date" id="' + id + '" value="' + esc(val || '') + '" max="' + today + '">';
  const teil = (r, withName) => (withName ? fld('hName', 'Bauteil', inp('hName', r ? r.name : '', ' maxlength="60" placeholder="z. B. Bremsbeläge vorn"'), true) : '')
    + fld('hMaker', 'Hersteller', inp('hMaker', r ? r.maker : '', ' maxlength="60"')) + fld('hModel', 'Modell / Bezeichnung', inp('hModel', r ? r.model : '', ' maxlength="120"'))
    + fld('hArt', 'Artikelnummer', inp('hArt', r ? r.artNo : '', ' maxlength="60"'));
  const cond = r => fld('hUse', 'Einsatz', '<select id="hUse">' + opt(PART_USES, r ? r.use || '' : '', '–') + '</select>')
    + fld('hTrack', 'Strecke', inp('hTrack', r ? r.track : '', ' maxlength="120"')) + fld('hGround', 'Untergrund', '<select id="hGround">' + groundOpts(r ? r.ground : '') + '</select>');
  const onF = r => fld('hOnD', 'Montiert am', date('hOnD', r ? r.on.date : '')) + fld('hOnA', 'bei (' + u + ')', num('hOnA', r ? r.on.at : null));
  const offF = (r, def) => fld('hOffD', 'Ausgebaut am', date('hOffD', r && r.off ? r.off.date : def ? today : '')) + fld('hOffA', 'bei (' + u + ')', num('hOffA', r && r.off ? r.off.at : null, def ? ph : ''))
    + fld('hReason', 'Grund', '<select id="hReason">' + opt(PART_REASONS, r ? r.reason || '' : '', 'unbekannt') + '</select>');
  const erf = r => fld('hRate', 'Bewertung', '<select id="hRate">' + opt(RATES, r && r.rating ? String(r.rating) : '', '–') + '</select>')
    + fld('hVerdict', 'Merkhilfe', '<select id="hVerdict">' + opt(PART_VERDICTS, r ? r.verdict || '' : '', '–') + '</select>')
    + fld('hNote', 'Begründung, Erfahrung', '<textarea id="hNote" maxlength="500" rows="2" placeholder="z. B. Grip auf Sand, Verschleiß, Probleme">' + esc(r ? r.note || '' : '') + '</textarea>', true);
  const srcSel = (slotRec) => {
    const cands = M.removedOf(b).filter(x => M.remountable(b, x) && M.slotKey(x) === M.slotKey(slotRec));
    if (!cands.length && !h.src) return '';
    return fld('hSrc', 'Teil', '<select id="hSrc">' + opt([['', 'Neues Teil']].concat(cands.map(x => [x.id, 'Wieder montieren: ' + (M.partLabel(x) || 'ohne Bezeichnung') + ' (ausgebaut ' + (x.off.date ? 'am ' + fmtDate(x.off.date) : 'unbekannt') + (x.reason ? ', ' + M.REASON_NAME[x.reason] : '') + ')'])), h.src) + '</select>', true);
  };
  const lbl = t ? M.slotLabel(t) + (M.partLabel(t) ? ': ' + M.partLabel(t) : '') : '';
  let body = '';
  if (h.mode === 'edit') {
    body = fieldset(lbl, teil(t, t.slot === 'x') + onF(t) + cond(t)) + (t.off ? fieldset('Ausbau', offF(t)) : '') + fieldset('Eigene Erfahrung', erf(t))
      + (t.cur ? '<p class="hint">Berichtigt die Angaben zu diesem Einbau. Für ein neues Teil „Wechsel eintragen“ verwenden.</p>' : '');
  } else if (h.mode === 'swap' || h.mode === 'remove') {
    body = fieldset('Bisheriges Teil ausbauen – ' + lbl, offF(null, true) + erf(t));
    if (h.mode === 'swap') body += fieldset('Neues Teil (montiert am selben Tag und Stand)', srcSel(t) + '<div class="f full" id="hNewWrap"' + (h.src ? ' hidden' : '') + '><div class="grid">' + teil(src, false) + '</div></div>' + cond(src));
  } else if (h.mode === 'mount') {
    const sr = {slot: h.slot, name: src ? src.name : ''};
    body = fieldset(h.slot === 'x' ? (src ? src.name + ' wieder montieren' : 'Weiteres Teil montieren') : (M.SLOT_NAME[h.slot] + ' montieren'), (!src && h.slot === 'x' ? fld('hName', 'Bauteil', inp('hName', '', ' maxlength="60" placeholder="z. B. Bremsbeläge vorn"'), true) : '') + srcSel(sr)
      + '<div class="f full" id="hNewWrap"' + (h.src ? ' hidden' : '') + '><div class="grid">' + teil(null, false) + '</div></div>' + onF({on: {date: today, at: null}}) + cond(src));
  } else if (h.mode === 'addhist') {
    body = fieldset('Früheres Teil', fld('hSlot', 'Einbauort', '<select id="hSlot">' + opt(HIST_SLOTS, '', 'bitte wählen') + '</select>') + '<div class="f" id="hNameWrap" hidden>' + '<label for="hName">Bauteil</label>' + inp('hName', '', ' maxlength="60" placeholder="z. B. Bremsbeläge vorn"') + '</div>'
      + teil(null, false) + onF(null) + cond(null)) + fieldset('Ausbau', offF(null)) + fieldset('Eigene Erfahrung', erf(null));
  }
  box.innerHTML = '<form id="histForm" class="stack hist-form" data-bike="' + esc(h.bike) + '" novalidate><h3>' + esc(MODE_TITLE[h.mode]) + '</h3>'
    + (h.msg ? '<p class="warnbox" role="alert">' + esc(h.msg) + '</p>' : '')
    + body + '<p class="hint">Unbekannte Angaben leer lassen – Racebook schätzt nichts. Der Lagerbestand wird nicht verändert.' + (h.mode === 'swap' || h.mode === 'remove' ? ' Ohne Stand gilt heute der aktuelle Stand.' : '') + '</p>'
    + '<div class="row"><button class="btn primary" type="submit">Speichern</button><button class="btn ghost" type="button" id="histCancel">Abbrechen</button></div></form>';
}
/* Formularwerte erhalten, wenn das Formular neu gezeichnet werden muss (Hinweis nach einer Änderung in einem anderen Fenster) */
function keepValues(fn){
  const vals = {}; $$('#histForm input, #histForm select, #histForm textarea').forEach(el => { vals[el.id] = el.value; });
  fn();
  Object.entries(vals).forEach(([id, v]) => { const el = document.getElementById(id); if (el) el.value = v; });
  syncVisibility();
}
function syncVisibility(){
  const s = $('#hSrc'), w = $('#hNewWrap'); if (s && w) w.hidden = !!s.value;
  const sl = $('#hSlot'), nw = $('#hNameWrap'); if (sl && nw) nw.hidden = sl.value !== 'x';
}

/* ---------- Eingaben lesen ---------- */
function readForm(h, b){
  const lim = LIM[unitOf(b)].cnt, val = id => { const el = $('#' + id); return el ? str(el.value) : ''; }, has = id => !!$('#' + id);
  const v = {};
  if (has('hSlot')) { v.slot = val('hSlot'); if (!v.slot) throw new VErr($('#hSlot'), 'Wähl den Einbauort.'); }
  if (has('hName') && !($('#hNameWrap') && $('#hNameWrap').hidden)) v.name = val('hName').slice(0, 60);
  v.src = has('hSrc') ? val('hSrc') : '';
  if (has('hMaker')) { v.maker = val('hMaker').slice(0, 60); v.model = val('hModel').slice(0, 120); v.artNo = val('hArt').slice(0, 60); }
  if (has('hOnD')) { v.onDate = fieldDate('hOnD', 'Montiert am') || ''; v.onAt = fieldNum('hOnA', 'Stand bei der Montage', {min: 0, max: lim}); }
  if (has('hOffD')) { v.offDate = fieldDate('hOffD', 'Ausgebaut am') || ''; v.offAt = fieldNum('hOffA', 'Stand beim Ausbau', {min: 0, max: lim}); v.reason = val('hReason'); }
  if (has('hUse')) { v.use = val('hUse'); v.track = val('hTrack').slice(0, 120); v.ground = val('hGround').slice(0, 40); }
  if (has('hRate')) { v.rating = val('hRate') ? Number(val('hRate')) : null; v.verdict = val('hVerdict'); v.note = val('hNote').slice(0, 500); }
  return v;
}
const setIf = (o, k, x) => { if (x != null && x !== '') o[k] = x; else delete o[k]; };
function applyCond(o, v){ setIf(o, 'use', v.use); setIf(o, 'track', v.track); setIf(o, 'ground', v.ground); }
function applyExp(o, v){ setIf(o, 'rating', v.rating); setIf(o, 'verdict', v.verdict); setIf(o, 'note', v.note); }
function applyId(o, v){ setIf(o, 'maker', v.maker); setIf(o, 'artNo', v.artNo); }

/* ---------- Speichern ---------- */
export async function submit(busy){
  const h = S.hist; if (!h) return true;
  const b = S.bikes[h.bike];
  if (!b || h.epoch !== (S.epoch || '')) { close(); toast('Das Formular gehörte zu einem anderen Datenstand und wurde geschlossen. Es wurde nichts gespeichert.'); return true; }
  const v = readForm(h, b);
  /* Im Formular gewähltes früher ausgebautes Teil (Wiedermontage): Grundlage ist der Stand bei der Wahl */
  if (v.src !== undefined && v.src !== h.src && ($('#hSrc') || null)) { h.src = v.src; h.srcBase = v.src ? canon(rawTarget(store.peek('bikes', h.bike), v.src)) : ''; }
  busy(true);
  for (let i = 0; i < 3; i++) {
    const r = await saveOnce(h, b, v);
    if (r !== 'retry') return true;
    await store.reloadAll().catch(() => {});
    if (S.hist !== h) return true;
  }
  toast('Die Daten ändern sich gerade laufend. Es wurde nichts gespeichert; versuch es gleich noch einmal.');
  return true;
}
function conflict(h, msg){
  h.msg = msg;
  const raw = store.peek('bikes', h.bike);
  h.base = h.target ? canon(rawTarget(raw, h.target)) : ''; h.srcBase = h.src ? canon(rawTarget(raw, h.src)) : '';
  parkOp('histForm');
  keepValues(() => renderForm());
  toast('Inzwischen geändert. Es wurde nichts gespeichert.');
}
/* Ein Speicherversuch auf dem aktuellen Stand. 'retry' = beim Schreiben geändert (neu lesen und neu prüfen) */
/* Ist ein Vorgang mit diesem Inhalt schon gespeichert? Geprüft werden nur die Einträge, die er ändert (Verlaufseinträge, montiertes
   Teil, Logbuch-Eintrag) – Änderungen anderer Fenster an anderen Teilen stören den Abgleich nicht (ab 1.7.0, Prüfung PR 9, R170-1) */
function applied(p){
  const raw = store.peek('bikes', p.bike); if (!raw || !p.expect) return false;
  return p.expect.every(x => x.f === 'hist' ? canon((Array.isArray(raw.hist) ? raw.hist : []).find(r => r.id === x.id) || null) === canon(x.v)
    : x.f === 'tires' ? canon(nu((raw.tires || {})[x.k])) === canon(x.v)
    : x.f === 'chain' ? canon(nu(raw.chain)) === canon(x.v)
    : x.f === 'log' ? !!store.peek('log', x.id) : false);
}
async function saveOnce(h, b, v){
  const raw = store.peek('bikes', h.bike);
  if (!raw) { close(); toast('Das Motorrad gibt es nicht mehr. Es wurde nichts gespeichert.'); return 'done'; }
  /* Ein unklarer Versuch dieses Formulars ist inzwischen als gespeichert erkannt: abschließen, nichts neu aufbauen. Erst danach
     zählt eine Abweichung vom Stand beim Öffnen als Änderung eines anderen Fensters (Prüfung PR 9, R170-1) */
  const last = h.lastOp;
  if (last && applied(last.payload)) {
    if (S.ops.histForm === last) delete S.ops.histForm;
    const same = last.sig === canon([h.mode, h.target, h.src, v]);
    done(last, same ? '' : 'Der vorherige Versuch ist gespeichert. Spätere Änderungen im Formular bitte neu eintragen.');
    return 'done';
  }
  /* Grundlage des Entwurfs: das Teil beim Öffnen. Geändert oder entfernt → nichts speichern, Eingaben behalten */
  if (h.target && canon(rawTarget(raw, h.target)) !== h.base) {
    if (rawTarget(raw, h.target) == null) { close(); toast('Diesen Eintrag gibt es inzwischen nicht mehr. Es wurde nichts gespeichert.'); return 'done'; }
    conflict(h, 'Dieses Teil wurde inzwischen geändert (zum Beispiel in einem anderen Fenster). Es wurde nichts gespeichert. Deine Eingaben stehen noch im Formular; prüf sie und tipp erneut auf „Speichern“.');
    return 'done';
  }
  if (h.src && canon(rawTarget(raw, h.src)) !== h.srcBase) {
    conflict(h, 'Das wieder zu montierende Teil wurde inzwischen geändert. Es wurde nichts gespeichert. Prüf die Auswahl und tipp erneut auf „Speichern“.');
    return 'done';
  }
  const rb = Object.assign(clone(raw), {id: h.bike});
  const o = opFor('histForm', h.bike, 'bikes', null, canon([h.mode, h.target, h.src, v])); if (o.saving) return 'done';
  o.noTrack = true;
  if (!o.payload) {
    let built;
    try { built = await build(h, rb, v, o); } catch (e) { if (e instanceof VErr) { parkOp('histForm'); throw e; } throw e; }
    if (!built) { parkOp('histForm'); return 'done'; }
    o.payload = built; o.label = 'Teilehistorie';
  }
  /* Nach unklarem Ergebnis erst nachsehen, ob es schon gespeichert ist (die Prüfung würde sonst am eigenen Eintrag scheitern) */
  if (o.state === 'unclear' && applied(o.payload)) { delete S.ops.histForm; done(o); return 'done'; }
  o.quietFail = true;
  const r = await execOp('histForm', o, () => store.commitR(o.payload.items, null, 'teilehistorie', {epoch: o.epoch, expect: o.payload.segFp ? {bike: h.bike, fp: o.payload.segFp} : null}));
  if (r === 'ok') { done(o); return 'done'; }
  /* Unklar: Vorgang merken; jeder weitere Versuch gleicht ihn zuerst ab (auch nach einem Konflikthinweis) */
  if (r === 'unclear') { h.lastOp = o; return 'done'; }
  if (r === 'fail' && S.lastErr && S.lastErr.code === 'changed') return h.lastOp || !o.payload.segFp ? 'retry' : (toast('Der Zählerverlauf hat sich beim Speichern geändert. Es wurde nichts gespeichert. Bitte noch einmal speichern.'), 'done');
  if (r === 'fail') toast(errText(S.lastErr) + ' Es wurde nichts gespeichert.');
  return 'done';
}
function done(o, msg){
  const n = o.payload.items.length - 1;
  close();
  toast(msg || (n > 0 ? 'Gespeichert, im Logbuch eingetragen.' : 'Gespeichert.'));
  R.renderAll();
}
/* Stelle einer Eingabe: Datum, Stand und (am Tag eines Zählerwechsels) welcher Zähler. Ohne Stand am heutigen Tag gilt der
   aktuelle Stand (wie bei Reifen & Kette). prev: bisherige Stelle (unverändert = bisherige Erfassungsstelle behalten) */
const FLAG = new WeakMap();   /* Stelle → 'auto' (aktuelle Anzeige übernommen) | 'same' (unverändert) */
function position(b, date, at, prev, auto, o){
  const today = todayISO();
  if (auto && date === today && at == null && curOf(b) != null) { const p = {date, at: curOf(b), c: o.created}; FLAG.set(p, 'auto'); return p; }
  const p = {date: date || '', at: at == null ? null : at};
  if (prev && (prev.date || '') === p.date && (prev.at == null ? null : prev.at) === p.at) { if (prev.c != null) p.c = prev.c; FLAG.set(p, 'same'); }
  return p;
}
async function build(h, rb, v, o){
  const b = S.bikes[h.bike], next = {tires: clone(rb.tires || {}), chain: clone(rb.chain || {}), hist: clone(Array.isArray(rb.hist) ? rb.hist : [])};
  next.tires.front = next.tires.front || {}; next.tires.rear = next.tires.rear || {};
  const t = h.target ? recOf(rb, h.target) : null, src = h.src ? recOf(rb, h.src) : null;
  if (h.src && (!src || !M.remountable(rb, src) || M.slotKey(src) !== M.slotKey(t || {slot: h.slot, name: src.name}))) throw new VErr($('#hSrc'), 'Dieses Teil kann nicht (mehr) wieder montiert werden. Wähl ein anderes oder „Neues Teil“.');
  const touched = new Set(), logs = [], recsNew = [];
  const curSet = (slot, obj) => { if (slot === 'tf') next.tires.front = obj; else if (slot === 'tr') next.tires.rear = obj; else next.chain = obj; touched.add(slot === 'chain' ? 'chain' : 'tires'); };
  const curGet = slot => slot === 'tf' ? next.tires.front : slot === 'tr' ? next.tires.rear : next.chain;
  const histSet = r => { const i = next.hist.findIndex(x => x.id === r.id); if (i >= 0) next.hist[i] = r; else next.hist.push(r); touched.add('hist'); };
  const needName = (slot, name, el) => { if (slot === 'x' && !str(name)) throw new VErr($('#' + el), 'Gib dem Bauteil einen Namen, z. B. „Bremsbeläge vorn“.'); };
  const needId = (r, el) => { if (!str(r.model) && !str(r.maker)) throw new VErr($('#' + el), 'Gib Hersteller oder Modell an (wenn unbekannt, z. B. „unbekannt“).'); };
  /* Montierte Reifen und Kette erkennt Racebook am Modell bzw. an der Bezeichnung (wie im Formular „Reifen & Kette“): ohne sie wird
     nichts gespeichert, statt ein Teil ohne Bezeichnung zu montieren (Prüfung PR 9, R170-2) */
  const needModel = (r, el) => { if (!str(r.model)) throw new VErr($('#' + el), 'Gib das Modell bzw. die Bezeichnung an – bei unbekanntem Modell z. B. „unbekannt“. Der Hersteller allein reicht für ein montiertes Teil nicht.'); };
  /* Stellen, die zu prüfen bzw. zuzuordnen sind: [{key, p, el, label}] */
  const ps = [];
  const today = todayISO();
  let newRec = null, oldRec = null;

  if (h.mode === 'edit') {
    const r = clone(t);
    const on = position(b, v.onDate, v.onAt, t.on, false, o);
    if (t.slot === 'x') { r.name = str(v.name || r.name); needName('x', r.name, 'hName'); }
    r.model = v.model; applyId(r, v); applyCond(r, v); applyExp(r, v); r.on = on; ps.push({key: 'on', p: on, prev: t.on, el: 'hOnA', label: 'Montage'});
    if (t.off) { r.off = position(b, v.offDate, v.offAt, t.off, false, o); r.reason = v.reason; ps.push({key: 'off', p: r.off, prev: t.off, el: 'hOffA', label: 'Ausbau'}); }
    if (t.slot !== 'x') { needId(r, 'hModel'); if (t.cur) needModel(r, 'hModel'); }
    newRec = r;
  } else if (h.mode === 'swap' || h.mode === 'remove') {
    if (!v.offDate) throw new VErr($('#hOffD'), 'Gib das Datum des ' + (h.mode === 'swap' ? 'Wechsels' : 'Ausbaus') + ' an.');
    const off = position(b, v.offDate, v.offAt, null, true, o);
    ps.push({key: 'off', p: off, el: 'hOffA', label: h.mode === 'swap' ? 'Wechsel' : 'Ausbau'});
    oldRec = clone(t); oldRec.off = off; oldRec.reason = v.reason; applyExp(oldRec, v);
    if (h.mode === 'swap') {
      const nr = src ? {slot: t.slot, name: t.name, model: src.model, maker: src.maker, artNo: src.artNo, prev: src.id} : {slot: t.slot, name: t.name, model: v.model, maker: v.maker, artNo: v.artNo};
      applyCond(nr, v);
      if (!src) { needId(nr, 'hModel'); if (t.slot !== 'x') needModel(nr, 'hModel'); }
      nr.on = off; newRec = nr;
    }
  } else if (h.mode === 'mount') {
    const slot = h.slot;
    const nr = src ? {slot, name: src.name, model: src.model, maker: src.maker, artNo: src.artNo, prev: src.id} : {slot, name: slot === 'x' ? str(v.name) : '', model: v.model, maker: v.maker, artNo: v.artNo};
    needName(slot, nr.name, 'hName'); if (slot !== 'x' && !src) { needId(nr, 'hModel'); needModel(nr, 'hModel'); }
    applyCond(nr, v);
    nr.on = position(b, v.onDate, v.onAt, null, true, o); ps.push({key: 'on', p: nr.on, el: 'hOnA', label: 'Montage'});
    newRec = nr;
  } else if (h.mode === 'addhist') {
    const nr = {slot: v.slot, name: v.slot === 'x' ? str(v.name) : '', model: v.model, maker: v.maker, artNo: v.artNo};
    needName(v.slot, nr.name, 'hName'); if (v.slot !== 'x') needId(nr, 'hModel');
    applyCond(nr, v); applyExp(nr, v);
    nr.on = position(b, v.onDate, v.onAt, null, false, o); nr.off = position(b, v.offDate, v.offAt, null, false, o); nr.reason = v.reason;
    ps.push({key: 'on', p: nr.on, el: 'hOnA', label: 'Montage'}, {key: 'off', p: nr.off, el: 'hOffA', label: 'Ausbau'});
    newRec = nr;
  }

  /* Welcher Zähler war gemeint? Nur neue Stellen am Tag eines Zählerwechsels (nicht die eben übernommene aktuelle Anzeige) */
  derive();
  /* Neue Stellen, und unveränderte ohne gespeicherte Stelle (ältere Angaben): am Tag eines Zählerwechsels wird gefragt */
  const fresh = x => x.p.at != null && x.p.date && x.p.c == null && FLAG.get(x.p) !== 'auto';
  const ask = ps.filter(x => fresh(x) && meterSegments(b, x.p.date).length);
  ps.forEach(x => { if (fresh(x) && !ask.includes(x)) x.p.c = o.created; });
  let segFp = null;
  if (ask.length) {
    const res = await askSegments(b, ask.map(x => ({key: x.key, label: x.label + ' bei ' + fmt(x.p.at, 2) + ' ' + unitOf(b), date: x.p.date})));
    if (!res) return null;
    if (res.stale) { toast('Der Zählerverlauf hat sich inzwischen geändert. Bitte noch einmal speichern.'); return null; }
    ask.forEach(x => { x.p.c = res.pick[x.key]; });
    segFp = res.fp;
  }
  /* Auffällig hoher Stand? Nur geänderte, eingetippte Werte */
  for (const x of ps) {
    if (x.p.at == null || FLAG.has(x.p) || (x.prev && (x.prev.at == null ? null : x.prev.at) === x.p.at)) continue;
    if (!(await jumpOk(o, b, x.p.date || today, x.p.at, x.el, posAt(b.id, x.p.date || today, x.p.c != null ? x.p.c : Infinity).disp))) return null;
  }

  /* Neuen Stand zusammensetzen */
  const idNew = 'h' + uid();
  if (h.mode === 'edit') {
    if (t.cur) {
      const x = M.withoutDetails(curGet(t.slot));
      if (t.slot === 'chain') x.brand = newRec.model; else x.model = newRec.model;
      x.at = newRec.on.at; x.date = newRec.on.date; delete x.c; if (newRec.on.c != null) x.c = newRec.on.c;
      curSet(t.slot, Object.assign(x, M.detailsOf(Object.assign({}, newRec, {prev: t.prev}))));
    } else { const r = Object.assign({}, newRec); delete r.bike; delete r.cur; histSet(r); }
  } else if (h.mode === 'swap' || h.mode === 'remove') {
    if (t.cur) {
      const removed = M.histOfCurrent(curGet(t.slot), t.slot, oldRec.off, 'h' + uid());
      removed.reason = oldRec.reason; applyExp(removed, oldRec);
      histSet(removed);
      const x = M.withoutDetails(curGet(t.slot));
      if (t.slot === 'chain') { x.brand = newRec ? newRec.model : ''; } else x.model = newRec ? newRec.model : '';
      x.at = newRec ? newRec.on.at : null; x.date = newRec ? newRec.on.date : ''; delete x.c; if (newRec && newRec.on.c != null) x.c = newRec.on.c;
      curSet(t.slot, newRec ? Object.assign(x, M.detailsOf(newRec)) : x);
      recsNew.push(removed);
    } else {
      const r = Object.assign({}, oldRec); delete r.bike; delete r.cur; histSet(r); recsNew.push(r);
      if (newRec) { const n = Object.assign({id: idNew, reason: ''}, newRec, {off: null}); histSet(canonRec(n)); recsNew.push(n); }
    }
  } else if (h.mode === 'mount') {
    if (h.slot === 'x') { const n = Object.assign({id: idNew, reason: ''}, newRec, {off: null}); histSet(canonRec(n)); recsNew.push(n); }
    else {
      const x = M.withoutDetails(curGet(h.slot));
      if (h.slot === 'chain') x.brand = newRec.model; else x.model = newRec.model;
      x.at = newRec.on.at; x.date = newRec.on.date; delete x.c; if (newRec.on.c != null) x.c = newRec.on.c;
      curSet(h.slot, Object.assign(x, M.detailsOf(newRec)));
    }
  } else if (h.mode === 'addhist') {
    const n = canonRec(Object.assign({id: idNew}, newRec)); histSet(n); recsNew.push(n);
  }
  if (next.hist.length > MAX_HIST) throw new VErr(null, 'Die Teilehistorie dieses Motorrads ist voll (höchstens ' + MAX_HIST + ' Einträge). Lösch zuerst ältere Einträge.');

  /* Prüfen auf dem neuen Stand: Reihenfolge und Überschneidungen am selben Einbauort */
  const nb = Object.assign({}, rb, next), all = M.recordsOf(nb);
  const changed = all.filter(r => recsNew.some(x => x.id === r.id) || (h.mode === 'edit' && r.id === t.id) || ((h.mode === 'swap' || h.mode === 'mount') && r.cur && r.slot === (t ? t.slot : h.slot)));
  derive();
  for (const r of changed) {
    if (r.off && r.on.date && r.off.date && r.off.date < r.on.date) throw new VErr($('#hOffD'), 'Der Ausbau liegt vor der Montage. Prüf die Daten.');
    if (r.off) { const u = M.usageOf(Object.assign({}, b, next), r, S.der[b.id]); if (u.state === 'check') throw new VErr($('#hOffA'), 'Der Stand beim Ausbau liegt unter dem Stand bei der Montage. Prüf die Stände.'); }
    const ov = M.overlapOf(all, r);
    if (ov) throw new VErr($(r.off ? '#hOffD' : '#hOnD') || $('#hOffD'), 'Überschneidet sich mit „' + (M.partLabel(ov) || M.slotLabel(ov)) + '“ (montiert ' + (ov.on.date ? fmtDate(ov.on.date) : '?') + ', ' + (ov.off ? 'ausgebaut ' + (ov.off.date ? fmtDate(ov.off.date) : '?') : 'noch montiert') + ') am selben Einbauort. Prüf die Daten.');
  }

  /* Ein Vorgang: Motorrad (nur die geänderten Felder, geprüft gegen den Stand beim Lesen) und bei Reifen/Kette ein Logbuch-Eintrag */
  const patch = {}, guard = {};
  touched.forEach(f => { patch[f] = canonDoc('bikes', {brand: 'Motorrad', [f]: next[f]})[f]; guard[f] = clone(nu(rb[f])); });
  const items = [{coll: 'bikes', id: h.bike, patch, guard}];
  const slot = t ? t.slot : h.slot;
  if (LOG_KIND[slot] && (h.mode === 'swap' || h.mode === 'remove' || h.mode === 'mount')) {
    const name = M.SLOT_NAME[slot], at = newRec ? newRec.on : oldRec.off;
    const title = h.mode === 'remove' ? name + ' ausgebaut: ' + (M.partLabel(t) || '–') + (oldRec.reason ? ' (' + M.REASON_NAME[oldRec.reason] + ')' : '')
      : name + ': ' + (M.partLabel(newRec) || '–') + (newRec.prev ? ' (wieder montiert)' : '') + (oldRec ? ' – vorher ' + (M.partLabel(t) || '–') + (oldRec.reason ? ', ' + M.REASON_NAME[oldRec.reason] : '') : '');
    logs.push({coll: 'log', id: 'tc' + uid(), data: canonDoc('log', {bike: h.bike, kind: LOG_KIND[slot], date: at.date || today, at: at.at, atAuto: false, title: title.slice(0, 300), tasks: [], taskNames: [], extra: '', cost: null, note: '', created: o.created})});
  }
  /* Was dieser Vorgang ändert (für den Abgleich nach unklarem Ergebnis) */
  const expect = [];
  if (patch.hist) patch.hist.forEach(r => { const old = (Array.isArray(rb.hist) ? rb.hist : []).find(x => x.id === r.id); if (!old || canon(old) !== canon(r)) expect.push({f: 'hist', id: r.id, v: r}); });
  if (patch.tires) ['front', 'rear'].forEach(k => { if (canon(nu((rb.tires || {})[k])) !== canon(nu(patch.tires[k]))) expect.push({f: 'tires', k, v: nu(patch.tires[k])}); });
  if (patch.chain) expect.push({f: 'chain', v: patch.chain});
  logs.forEach(l => expect.push({f: 'log', id: l.id}));
  return {items: items.concat(logs), segFp, expect, bike: h.bike};
}
/* Eintrag in der gespeicherten Form (ohne Hilfsfelder, ohne leere Angaben) */
function canonRec(r){ const o = Object.assign({}, r); delete o.bike; delete o.cur; return o; }

/* Löschen eines Verlaufseintrags (auch eines montierten weiteren Teils). Verweise einer Wiedermontage darauf werden gelöst. */
async function del(id){
  const b = S.bikes[S.bike]; if (!b) return;
  const raw = store.peek('bikes', b.id);
  const hist = raw && Array.isArray(raw.hist) ? raw.hist : [];
  if (!hist.some(r => r.id === id)) { toast('Diesen Eintrag gibt es inzwischen nicht mehr.'); return; }
  const next = hist.filter(r => r.id !== id).map(r => r.prev === id ? (x => { delete x.prev; return x; })(Object.assign({}, r)) : r);
  const items = [{coll: 'bikes', id: b.id, patch: {hist: next}, guard: {hist: clone(hist)}}];
  const t = raw.tires || {}, c = raw.chain || {};
  /* Auch montierte Reifen/Kette können auf den gelöschten Einbau verweisen */
  const fix = x => x && x.prev === id ? (y => { delete y.prev; return y; })(Object.assign({}, x)) : x;
  if ((t.front && t.front.prev === id) || (t.rear && t.rear.prev === id)) { items[0].patch.tires = {front: fix(t.front), rear: fix(t.rear)}; items[0].guard.tires = clone(t); }
  if (c.prev === id) { items[0].patch.chain = fix(c); items[0].guard.chain = clone(c); }
  const r = await flow(() => store.commitR(items, null, 'teilehistorie-loeschen', {epoch: S.epoch || ''}));
  if (r === 'ok') { if (S.mountOpen && S.mountOpen.id === id) S.mountOpen = null; if (S.hist && (S.hist.target === id || S.hist.src === id)) close(); toast('Gelöscht.'); R.renderAll(); return; }
  if (r === 'fail' && S.lastErr && S.lastErr.code === 'changed') { await store.reloadAll().catch(() => {}); toast('Die Teilehistorie wurde inzwischen geändert. Es wurde nichts gelöscht; bitte noch einmal versuchen.'); R.renderAll(); return; }
  toast(r === 'fail' ? errText(S.lastErr) + ' Es wurde nichts gelöscht.' : 'Unklar, ob gelöscht wurde. Sieh in der Liste nach.');
}

/* ---------- Ereignisse ---------- */
export async function onClick(t){
  if (t.dataset.mount != null) {
    const [where, id] = t.dataset.mount.split('|');
    S.mountOpen = id && !(S.mountOpen && S.mountOpen.where === where && S.mountOpen.id === id) ? {where, id, bike: S.bike} : null;
    R.renderAll();
    const back = id ? document.querySelector('[data-mount="' + CSS.escape(where + '|' + id) + '"]') : null; if (back) back.focus();
    return true;
  }
  if (t.dataset.hist) {
    const [mode, id] = t.dataset.hist.split('|');
    if (S.hist && S.hist.mode === mode && (S.hist.target === id || S.hist.src === id) && $('#histForm')) { R.setSection('components', 'histBox'); return true; }
    drafts.begin(() => open(mode, id));
    return true;
  }
  if (t.id === 'histAddX') { drafts.begin(() => open('mount', 'x')); return true; }
  if (t.id === 'histAddOld') { drafts.begin(() => open('addhist', '')); return true; }
  if (t.id === 'histCancel') { parkOp('histForm'); close(); return true; }
  if (t.dataset.histdel) { if (!arm(t)) return true; await del(t.dataset.histdel); return true; }   /* zweistufig: erst scharf stellen */
  return false;
}
export function onChange(t){
  if (t.id === 'hSrc' || t.id === 'hSlot') { syncVisibility(); return true; }
  if (t.id === 'cmpSlot' || t.id === 'cmpAll') {
    const b = S.bikes[S.bike]; if (!b) return true;
    S.cmp = {bike: b.id, key: t.id === 'cmpSlot' ? t.value : (S.cmp || {}).key || '', all: t.id === 'cmpAll' ? t.checked : !!(S.cmp || {}).all};
    $('#cmpBox').innerHTML = cmpHTML(b);
    const el = document.getElementById(t.id); if (el) el.focus();
    return true;
  }
  return false;
}
export function register(reveal){
  drafts.register({key: 'hist', label: 'Teilehistorie', root: () => $('#histForm'), extra: () => S.hist ? [S.hist.mode, S.hist.target, S.hist.src] : null,
    isOpen: () => !!S.hist, save: async () => { const f = $('#histForm'); if (!f) return true; await R.submitForm(f); return !S.hist; },
    discard: () => { parkOp('histForm'); close(); }, reveal});
}
