/* Racebook – Bausteine der Oberfläche: Auswahl, Meldungen, Bestätigen, Formularprüfung,
   Anzeige gespeicherter Dateien, Symbole und Navigation. */
import * as DB from './db.js';
import {fmt, isISO, todayISO, parseNum, esc} from './util.js';

export const $ = (s, r) => (r || document).querySelector(s);
export const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

/* ---------- Meldungen ---------- */
let toastT;
export function toast(msg){
  const t = $('#toast'); if (!t) return;
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, Math.max(3200, Math.min(9000, msg.length * 55)));
}
export function errText(e){
  const c = e && e.code;
  if (c === 'quota_exceeded') return 'Der Speicher auf diesem Gerät ist voll. Lösch alte Fotos oder Einträge, nachdem du eine Sicherung gemacht hast.';
  if (c === 'not_ready') return 'Einen Moment, der Speicher lädt noch.';
  if (c === 'closed' || c === 'version') return 'Racebook wurde in einem anderen Fenster aktualisiert. Bitte die Seite neu laden.';
  if (c === 'aborted') return 'Der Speichervorgang wurde abgebrochen.';
  if (c === 'not_found') return 'Der Eintrag existiert nicht mehr.';
  if (c === 'stale') return 'Die Daten wurden inzwischen ersetzt (Sicherung eingespielt oder Sicherheitskopie zurückgeholt), auch in einem anderen Fenster. Dieser Vorgang gehörte zum vorherigen Stand.';
  if (c === 'orphan') return 'Das Motorrad gibt es nicht mehr, es wurde wohl in einem anderen Fenster entfernt.';
  if (c === 'timeout') return 'Der Speicher antwortet gerade nicht.';
  if (c === 'decode') return 'Das Bild konnte nicht gelesen werden.';
  if (c === 'too_big') return 'Die Datei ist zu groß.';
  if (c === 'not_pdf') return 'Die Datei ist keine PDF-Datei.';
  return 'Speichern hat nicht geklappt. Versuch es gleich nochmal.';
}
/* Zweistufig bestätigen: erster Tipp stellt scharf, zweiter führt aus */
export function arm(btn){
  if (btn.classList.contains('armed')) { clearTimeout(btn._t); btn.classList.remove('armed'); btn.textContent = btn.dataset.label; return true; }
  btn.dataset.label = btn.textContent; btn.classList.add('armed'); btn.textContent = btn.dataset.arm || 'Sicher?';
  btn._t = setTimeout(() => { btn.classList.remove('armed'); btn.textContent = btn.dataset.label; }, 4000);
  return false;
}

/* ---------- Formularprüfung ---------- */
export function VErr(el, msg){ this.el = el; this.msg = msg; }
function elOf(x){ return typeof x === 'string' ? document.getElementById(x) : x; }
export function fieldNum(x, label, r){
  r = r || {};
  const el = elOf(x), p = parseNum(el ? el.value : '');
  if (p.empty) { if (r.req) throw new VErr(el, label + ': Bitte ausfüllen.'); return null; }
  if (p.err) throw new VErr(el, label + ': ' + p.err);
  const v = p.value;
  if (r.int && !Number.isInteger(v)) throw new VErr(el, label + ': Bitte eine ganze Zahl eingeben.');
  if (r.gt != null && !(v > r.gt)) throw new VErr(el, label + ': Muss größer als ' + fmt(r.gt) + ' sein.');
  if (r.min != null && v < r.min) throw new VErr(el, label + (r.min === 0 ? ': Darf nicht negativ sein.' : ': Mindestens ' + fmt(r.min) + '.'));
  if (r.max != null && v > r.max) throw new VErr(el, label + ': Höchstens ' + fmt(r.max, 2) + '.');
  return v;
}
export function fieldDate(x, label, r){
  r = r || {};
  const el = elOf(x), v = el ? el.value : '';
  if (!v) { if (r.req) throw new VErr(el, label + ': Bitte ein Datum wählen.'); return null; }
  if (!isISO(v)) throw new VErr(el, label + ': Das Datum ist ungültig.');
  if (!r.future && v > todayISO()) throw new VErr(el, label + ': Das Datum liegt in der Zukunft.');
  return v;
}
export function showVErr(e){
  toast(e.msg);
  if (e.el) { e.el.setAttribute('aria-invalid', 'true'); try { e.el.focus(); } catch (_) {} }
}

/* ---------- Gespeicherte Dateien anzeigen ---------- */
const urls = new Map();
export async function fileUrl(id){
  if (urls.has(id)) return urls.get(id);
  const f = await DB.get('files', id);
  if (!f || !f.blob) return null;
  const u = URL.createObjectURL(f.blob);
  urls.set(id, u);
  return u;
}
export function forgetFile(id){ const u = urls.get(id); if (u) { URL.revokeObjectURL(u); urls.delete(id); } }
export const cachedUrl = id => urls.get(id) || '';
/* <img> für eine gespeicherte Datei; die Adresse wird nachgeladen, falls noch nicht bekannt */
export function imgTag(id, alt, cls, extra){
  const u = cachedUrl(id);
  return '<img class="' + (cls || '') + '" data-file="' + esc(id) + '"' + (u ? ' src="' + u + '"' : '') + ' alt="' + esc(alt || '') + '"' + (extra || '') + '>';
}
export function hydrate(root){
  $$('img[data-file]', root || document).forEach(img => {
    if (img.getAttribute('src')) return;
    const id = img.dataset.file;
    fileUrl(id).then(u => {
      if (img.dataset.file !== id) return;
      if (u) img.src = u;
      else if (!img.dataset.missing) { img.dataset.missing = '1'; img.alt = (img.alt ? img.alt + ': ' : '') + 'Datei fehlt'; img.classList.add('missing'); }
    }, () => {});
  });
}

/* ---------- Symbole (Linien, 24er Raster) ---------- */
const P = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  status: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3.5 17.3a1.8 1.8 0 0 0 2.5 2.6l5.8-5.8a4 4 0 0 0 5.2-5.4l-2.4 2.4-2.3-.6-.6-2.3z"/>',
  defects: '<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
  log: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11M9 8h6"/>',
  rides: '<path d="M5 21V4M5 4h12l-2 4 2 4H5"/>',
  setup: '<path d="M6 4v16M12 4v16M18 4v16"/><path d="M4 9h4M10 15h4M16 7h4"/>',
  garage: '<path d="M3 10l9-6 9 6v10H3z"/><path d="M7 20v-6h10v6"/>',
  manual: '<path d="M12 6c-2-1.5-5-2-8-1.5V19c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V4.5C17 4 14 4.5 12 6z"/><path d="M12 6v14.5"/>',
  save: '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 20h14"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  ok: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
  bad: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6"/><path d="M12 16.5h.01"/>',
  unk: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7"/><path d="M12 17h.01"/>',
  none: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
  bike: '<circle cx="5.5" cy="16.5" r="3.5"/><circle cx="18.5" cy="16.5" r="3.5"/><path d="M5.5 16.5l4-7h5l4 7M9.5 9.5L8 6H5.5M14.5 9.5l1.5-3.5h2.5"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3.5 17.3a1.8 1.8 0 0 0 2.5 2.6l5.8-5.8a4 4 0 0 0 5.2-5.4l-2.4 2.4-2.3-.6-.6-2.3z"/>',
  flag: '<path d="M5 21V4M5 4h12l-2 4 2 4H5"/>',
  data: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7"/><path d="M12 17h.01"/>'
};
export const icon = (n, cls) => '<svg class="ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (P[n] || '') + '</svg>';

/* ---------- Navigation ---------- */
export const SECTIONS = [['status', 'Status'], ['defects', 'Mängel'], ['log', 'Logbuch', 'Logbuch', 'Log'], ['rides', 'Fahrten'], ['setup', 'Setup', 'Fahrwerk-Setups'], ['garage', 'Garage'], ['manual', 'Handbuch', 'Handbuch', 'Handb.']];
export function parseRoute(h){
  h = String(h == null ? location.hash : h).replace(/^#/, '');
  const p = h.split('/').filter(Boolean).map(x => { try { return decodeURIComponent(x); } catch (e) { return ''; } });
  if (p[0] === 'bike' && p[1]) return {page: 'bike', bike: p[1], section: SECTIONS.some(s => s[0] === p[2]) ? p[2] : 'status'};
  if (p[0] === 'daten') return {page: 'data'};
  if (p[0] === 'hilfe') return {page: 'help'};
  if (p[0] === 'neu') return {page: 'add'};
  return {page: 'home'};
}
export function routeHash(r){
  if (r.page === 'bike') return '#/bike/' + encodeURIComponent(r.bike) + '/' + (r.section || 'status');
  if (r.page === 'data') return '#/daten';
  if (r.page === 'help') return '#/hilfe';
  if (r.page === 'add') return '#/neu';
  return '#/';
}
export const fmtSize = n => n == null ? '–' : n < 1024 ? n + ' B' : n < 1024 * 1024 ? fmt(n / 1024, 0) + ' KB' : fmt(n / 1024 / 1024, 1) + ' MB';
