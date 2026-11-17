/* Racebook – Reifen je Rad und Untergrund im Fahrwerk-Setup (ab 1.9.0, Issue #16).
   Je Vorder-/Hinterrad optional Hersteller, Modell (frei), Mischung bzw. Einsatz (Super Soft, Soft, Medium, Hart; „Sand“ als
   Einsatz-/Profilangabe, keine Gummihärte; eigene Angabe) und System (Schlauch, Mousse, Tubeless, Tubliss getrennt; andere Angabe).
   Untergrund als Mehrfachauswahl (gemischt möglich) mit eigener Angabe; nichts gewählt = unbekannt. Die Strecke bleibt eigenes Feld.
   Das Setup speichert eine eigene Kopie: „Montierte Reifen übernehmen“ füllt nur auf Wunsch Hersteller und Modell als Vorschlag ins
   Formular; ein späterer Reifenwechsel am Motorrad ändert gespeicherte Setups nicht. Keine Druck- oder Produktempfehlungen, kein
   Reifenwechsel, kein Lager, keine Wartung. Datenmodell und Prüfung: js/domain.js (cleanSetupTyres, cleanSurface). */
import {$, $$, toast} from '../ui.js';
import {esc, str, canon} from '../util.js';
import {TYRE_COMPS, TYRE_COMP_HARD, TYRE_SYSTEMS, SURFACES, TYRE_MAX} from '../domain.js';
import * as drafts from '../drafts.js';

const WHEELS = [['front', 'Tf', 'vorn'], ['rear', 'Tr', 'hinten']];
const COMP_NAME = Object.fromEntries(TYRE_COMPS), SYS_NAME = Object.fromEntries(TYRE_SYSTEMS), SURF_NAME = Object.fromEntries(SURFACES);

/* Auswahllisten und Kästchen einmal füllen */
export function init(){
  const hard = TYRE_COMPS.filter(([k]) => TYRE_COMP_HARD.includes(k));
  const comp = '<option value="">nicht erfasst</option><optgroup label="Gummimischung">' + hard.map(([k, l]) => '<option value="' + k + '">' + esc(l) + '</option>').join('') + '</optgroup>'
    + '<optgroup label="Einsatz / Profil"><option value="sand">Sand (Einsatz, keine Härte)</option></optgroup><option value="x">Eigene Angabe …</option>';
  const sys = '<option value="">nicht erfasst</option>' + TYRE_SYSTEMS.map(([k, l]) => '<option value="' + k + '">' + esc(l) + '</option>').join('') + '<option value="x">Andere Angabe …</option>';
  WHEELS.forEach(([, p]) => { $('#s' + p + 'Comp').innerHTML = comp; $('#s' + p + 'Sys').innerHTML = sys; });
  $('#sSurfBox').innerHTML = SURFACES.map(([k, l]) => '<label class="check"><input type="checkbox" name="sSurf" value="' + k + '" id="sSurf-' + k + '"><span>' + esc(l) + '</span></label>').join('');
  sync();
}
/* Feld „eigene/andere Angabe“ nur bei dieser Auswahl zeigen */
export function sync(){
  WHEELS.forEach(([, p]) => {
    const c = $('#s' + p + 'Comp'), s = $('#s' + p + 'Sys');
    if (c) $('#s' + p + 'CompXWrap').hidden = c.value !== 'x';
    if (s) $('#s' + p + 'SysXWrap').hidden = s.value !== 'x';
  });
}
/* Formular aus einem Setup füllen (Bearbeiten, „Als Vorlage“): fehlende Angaben bleiben leer */
export function fill(s){
  const t = (s && s.tyres) || {};
  WHEELS.forEach(([w, p]) => {
    const x = t[w] || {};
    $('#s' + p + 'Maker').value = x.maker || ''; $('#s' + p + 'Model').value = x.model || '';
    $('#s' + p + 'Comp').value = x.comp || ''; $('#s' + p + 'CompX').value = x.compX || '';
    $('#s' + p + 'Sys').value = x.sys || ''; $('#s' + p + 'SysX').value = x.sysX || '';
  });
  const su = (s && s.surface) || {}, sel = Array.isArray(su.sel) ? su.sel : [];
  $$('#sSurfBox input[name="sSurf"]').forEach(i => { i.checked = sel.includes(i.value); });
  $('#sSurfX').value = su.x || '';
  sync();
}
/* Eingaben lesen: {tyres, surface} in der gespeicherten Form (leer = null) */
export function read(){
  const val = id => str(($('#' + id) || {}).value || '');
  const wheel = p => {
    const o = {};
    const maker = val('s' + p + 'Maker').slice(0, TYRE_MAX.maker), model = val('s' + p + 'Model').slice(0, TYRE_MAX.model);
    if (maker) o.maker = maker; if (model) o.model = model;
    const comp = val('s' + p + 'Comp'), compX = val('s' + p + 'CompX').slice(0, TYRE_MAX.compX);
    if (comp === 'x') { if (compX) { o.comp = 'x'; o.compX = compX; } } else if (comp) o.comp = comp;
    const sys = val('s' + p + 'Sys'), sysX = val('s' + p + 'SysX').slice(0, TYRE_MAX.sysX);
    if (sys === 'x') { if (sysX) { o.sys = 'x'; o.sysX = sysX; } } else if (sys) o.sys = sys;
    return Object.keys(o).length ? o : null;
  };
  const front = wheel('Tf'), rear = wheel('Tr');
  const tyres = front || rear ? Object.assign({}, front ? {front} : {}, rear ? {rear} : {}) : null;
  const sel = SURFACES.map(x => x[0]).filter(k => { const i = $('#sSurf-' + k); return i && i.checked; });
  const x = val('sSurfX').slice(0, TYRE_MAX.surfaceX);
  const surface = sel.length || x ? Object.assign({}, sel.length ? {sel} : {}, x ? {x} : {}) : null;
  return {tyres, surface};
}
/* Hersteller und Modell der jetzt montierten Reifen als Vorschlag übernehmen (nur leere oder bewusst überschriebene Felder) */
export function takeMounted(b){
  const t = (b && b.tires) || {}, got = [];
  WHEELS.forEach(([w, p, name]) => {
    const x = t[w] || {}, maker = str(x.maker), model = str(x.model);
    if (!maker && !model) return;
    $('#s' + p + 'Maker').value = maker; $('#s' + p + 'Model').value = model; got.push(name);
  });
  if (!got.length) { toast('Am Motorrad sind keine Reifen eingetragen (Verbaute Teile → Reifen & Kette).'); return false; }
  drafts.touch('setup');
  toast('Übernommen (Reifen ' + got.join(' und ') + ') – bitte prüfen und dann speichern.');
  return true;
}
/* Werte für Entwürfe über das Einspielen einer Sicherung hinweg (keepSetupDraft) */
export function values(){
  const v = {};
  WHEELS.forEach(([, p]) => ['Maker', 'Model', 'Comp', 'CompX', 'Sys', 'SysX'].forEach(f => { v['s' + p + f] = $('#s' + p + f).value; }));
  v.sSurfX = $('#sSurfX').value; v.sSurfSel = SURFACES.map(x => x[0]).filter(k => $('#sSurf-' + k).checked);
  return v;
}
export function restore(v){
  if (!v) return;
  Object.keys(v).forEach(id => { if (id === 'sSurfSel') return; const i = $('#' + id); if (i) i.value = v[id]; });
  if (Array.isArray(v.sSurfSel)) $$('#sSurfBox input[name="sSurf"]').forEach(i => { i.checked = v.sSurfSel.includes(i.value); });
  sync();
}
/* Konflikt beim Speichern (anderes Fenster hat das Setup geändert): von dir nicht geänderte Angaben zeigen den neuen Stand,
   beidseitig geänderte werden genannt (wie bei den Klicks, ab 1.4.0) */
export function merge(base, now, took, both){
  const form = read(), parts = [];
  const wheelOf = (o, w) => ((o && o.tyres) || {})[w] || null;
  WHEELS.forEach(([w, p, name]) => parts.push({label: 'Reifen ' + name, get: o => wheelOf(o, w), mine: wheelOf(form, w), set: v => fillWheel(p, v), text: wheelText}));
  parts.push({label: 'Untergrund', get: o => (o && o.surface) || null, mine: form.surface, set: v => fillSurface(v), text: surfaceText});
  parts.forEach(x => {
    const b = canon(x.get(base)), n = canon(x.get(now)), m = canon(x.mine);
    if (n === b || m === n) return;
    if (m === b) { x.set(x.get(now)); took.push(x.label + ' ' + (x.text(x.get(now)) || '(leer)')); }
    else both.push(x.label + ': dort ' + (x.text(x.get(now)) || '(leer)') + ', bei dir ' + (x.text(x.mine) || '(leer)'));
  });
  sync();
}
function fillWheel(p, x){
  x = x || {};
  $('#s' + p + 'Maker').value = x.maker || ''; $('#s' + p + 'Model').value = x.model || '';
  $('#s' + p + 'Comp').value = x.comp || ''; $('#s' + p + 'CompX').value = x.compX || '';
  $('#s' + p + 'Sys').value = x.sys || ''; $('#s' + p + 'SysX').value = x.sysX || '';
}
function fillSurface(v){
  const sel = v && Array.isArray(v.sel) ? v.sel : [];
  $$('#sSurfBox input[name="sSurf"]').forEach(i => { i.checked = sel.includes(i.value); });
  $('#sSurfX').value = (v && v.x) || '';
}

/* ---------- Anzeige ---------- */
export function compText(x){
  if (!x || !x.comp) return '';
  if (x.comp === 'x') return 'Mischung/Einsatz: ' + x.compX;
  if (x.comp === 'sand') return 'Einsatz Sand';
  return 'Mischung ' + (COMP_NAME[x.comp] || x.comp);
}
export function sysText(x){ return !x || !x.sys ? '' : x.sys === 'x' ? x.sysX : (SYS_NAME[x.sys] || x.sys); }
export function wheelText(x){
  if (!x) return '';
  const name = [x.maker, x.model].filter(Boolean).join(' ');
  return [name, compText(x), sysText(x)].filter(Boolean).join(' · ');
}
export function surfaceText(v){
  if (!v) return '';
  return (Array.isArray(v.sel) ? v.sel.map(k => SURF_NAME[k] || k) : []).concat(v.x ? [v.x] : []).join(', ');
}
/* Zeilen für die Setup-Karte (nur was erfasst ist) */
export function cardHTML(s){
  const t = (s && s.tyres) || {}, lines = [];
  WHEELS.forEach(([w, , name]) => { const x = wheelText(t[w]); if (x) lines.push('Reifen ' + name + ': ' + x); });
  const su = surfaceText(s && s.surface);
  if (su) lines.push('Untergrund: ' + su);
  return lines.length ? '<p class="hint setup-tyres">' + lines.map(esc).join('<br>') + '</p>' : '';
}
