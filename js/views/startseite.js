/* Racebook – „Startseite anpassen“ (ab 1.14.0, Roadmap 11, Auftrag in Issue #5). Adresse #/startseite; erreichbar über den Knopf
   auf der Garage und unter Einstellungen (kein neuer Platz in der Leiste oder unter „Mehr“).
   Je Baustein ein Häkchen „anzeigen“ und Pfeile für die Reihenfolge (Tastatur, Bildschirmleser, Handy). „Motorräder“ bleibt immer
   sichtbar. Gespeichert wird erst mit „Startseite speichern“; ungespeicherte Änderungen schützt die Rückfrage (./drafts.js).
   Gleichzeitige Änderung in einem anderen Fenster: der Speicher prüft beim Schreiben, ob die Auswahl noch die ist, auf der der
   Entwurf beruht (expectMeta), und die Bestandskennung (epoch). Sonst wird nichts gespeichert, die eigene Auswahl bleibt stehen. */
import {S} from '../state.js';
import * as DB from '../db.js';
import * as drafts from '../drafts.js';
import {BLOCK, rowsOf, showOf, showFromRows, dashRecord, DEFAULT_SHOW} from '../dashboard.js';
import {$, toast, errText} from '../ui.js';
import {flow} from '../ops.js';
import {esc, canon} from '../util.js';
import {R} from '../registry.js';

let draft = null;
const clone = x => x == null ? null : JSON.parse(JSON.stringify(x));

/* Gespeicherte Auswahl neu lesen (beim Start und nach Änderungen, auch aus einem anderen Fenster). Ein unveränderter Entwurf auf
   einer anderen Grundlage wird verworfen und neu aufgebaut; geänderte Eingaben bleiben stehen (Konflikt erst beim Speichern). */
export async function refreshDashboard(){
  if (!DB.isOpen()) return;
  const next = (await DB.getMeta('dashboard')) || null;
  if (draft && !drafts.isDirty('dashboard') && canon(draft.base) !== canon(next)) { draft = null; drafts.forget('dashboard'); }
  S.dashboard = next;
}
export function resetEditor(){ draft = null; drafts.forget('dashboard'); }
export const isOpen = () => !!draft;

export function renderEditor(){
  if (S.mode !== 'ready') return;
  if (!draft) {
    draft = {rows: rowsOf(showOf(S.dashboard)), base: clone(S.dashboard || null), epoch: S.epoch || '', msg: '', live: ''};
    draw(); drafts.mark('dashboard');
  } else if (!$('#dashForm')) draw();
}
function draw(focus){
  const box = $('#dashEditor'); if (!box || !draft) return;
  const n = draft.rows.length;
  box.innerHTML = '<form id="dashForm" class="card stack" novalidate aria-describedby="dashIntro">'
    + (draft.msg ? '<p class="warnbox" role="alert" id="dashMsg">' + esc(draft.msg) + '</p>' : '')
    + '<p class="hint" id="dashIntro">Wähle, was auf der Startseite „Meine Garage“ steht und in welcher Reihenfolge. „Motorräder“ bleibt immer sichtbar. Die Auswahl gilt für die ganze App und steht in der Sicherung.</p>'
    + '<ol class="dash-rows" id="dashRows">' + draft.rows.map((r, i) => {
      const b = BLOCK[r.id], id = 'dashOn-' + r.id;
      return '<li class="dash-row' + (r.on ? '' : ' is-off') + '" data-dashrow="' + r.id + '">'
        + '<div class="check"><input type="checkbox" id="' + id + '" data-dashon="' + r.id + '"' + (r.on || b.fixed ? ' checked' : '') + (b.fixed ? ' disabled aria-describedby="' + id + '-h"' : '') + '>'
        + '<label for="' + id + '"><b>' + esc(b.name) + '</b><span class="hint" id="' + id + '-h">' + esc(b.hint) + (b.fixed ? ' – immer sichtbar' : '') + '</span></label></div>'
        + '<div class="nav-arrows"><button class="mini" type="button" data-dashmove="' + i + ':-1" aria-label="' + esc(b.name) + ' nach oben, Platz ' + (i + 1) + ' von ' + n + '"' + (i === 0 ? ' disabled' : '') + '>↑</button>'
        + '<button class="mini" type="button" data-dashmove="' + i + ':1" aria-label="' + esc(b.name) + ' nach unten, Platz ' + (i + 1) + ' von ' + n + '"' + (i === n - 1 ? ' disabled' : '') + '>↓</button></div></li>';
    }).join('') + '</ol>'
    + '<p class="sr" aria-live="polite" id="dashLive">' + esc(draft.live || '') + '</p>'
    + '<div class="row"><button class="btn primary" type="submit">Startseite speichern</button><button class="btn" type="button" id="dashDefault">Standard</button><button class="btn ghost" type="button" id="dashCancel">Abbrechen</button></div></form>';
  if (focus) { const f = $(focus); if (f) f.focus(); }
}
function move(from, to){
  if (!draft || to < 0 || to >= draft.rows.length || from === to) return;
  drafts.touch('dashboard');
  const [r] = draft.rows.splice(from, 1); draft.rows.splice(to, 0, r);
  draft.live = BLOCK[r.id].name + ': jetzt Platz ' + (to + 1) + ' von ' + draft.rows.length + '.';
  /* Fokus bleibt am verschobenen Baustein: auf demselben Pfeil, am Rand auf dem anderen */
  const d = to > from ? 1 : -1, edge = d < 0 ? to === 0 : to === draft.rows.length - 1;
  draw('[data-dashmove="' + to + ':' + (edge ? -d : d) + '"]');
}

/* Ergebnis: true = gespeichert (oder nichts offen), false = nicht gespeichert, Entwurf bleibt */
export async function saveEditor(){
  if (!draft) return true;
  const own = draft;
  let rec;
  try { rec = dashRecord(showFromRows(own.rows)); } catch (e) { own.msg = 'Die Auswahl ist ungültig. Bitte prüf die Häkchen.'; draw('#dashMsg'); return false; }
  const op = rec ? {store: 'meta', type: 'put', value: rec} : {store: 'meta', type: 'del', id: 'dashboard'};
  try {
    /* Unverändert gegenüber der Grundlage: nichts schreiben (keine Änderung, kein neuer Sicherungsbedarf) */
    if (canon(rec) === canon(own.base || null)) { if (draft === own) { draft = null; drafts.forget('dashboard'); } renderEditor(); toast('Die Startseite ist unverändert.'); return true; }
    await flow(() => DB.commit([op], {epoch: own.epoch, bump: true, expectMeta: {k: 'dashboard', value: own.base}}));
    S.dashboard = rec;
    await refreshDashboard().catch(() => {});
    if (draft === own) { draft = null; drafts.forget('dashboard'); }
    R.renderAll(); toast('Startseite gespeichert.');
    return true;
  } catch (e) {
    if (draft !== own) return false;
    if (e && e.code === 'changed') {
      await refreshDashboard().catch(() => {});
      own.base = clone(S.dashboard || null);
      own.msg = 'Die Startseite wurde in einem anderen Fenster geändert. Deine Auswahl bleibt erhalten. Erneut speichern ersetzt die dort gespeicherte Auswahl; Abbrechen übernimmt sie.';
    } else own.msg = errText(e) + ' Deine Auswahl wurde nicht gespeichert.';
    draw('#dashMsg'); return false;
  }
}

export async function onClick(t){
  if (!t.closest || !t.closest('#dashForm')) return false;
  if (t.dataset.dashmove) { const [i, d] = t.dataset.dashmove.split(':').map(Number); move(i, i + d); return true; }
  if (t.id === 'dashDefault') {
    drafts.touch('dashboard');
    draft.rows = rowsOf(DEFAULT_SHOW); draft.live = 'Standard eingestellt: Zusammenfassung und Motorräder. Noch nicht gespeichert.';
    draw('#dashDefault'); return true;
  }
  if (t.id === 'dashCancel') { resetEditor(); R.toGarage(); return true; }
  return false;
}
export function onChange(t){
  if (!draft || !t.dataset || t.dataset.dashon == null) return false;
  const r = draft.rows.find(x => x.id === t.dataset.dashon);
  if (!r || BLOCK[r.id].fixed) { t.checked = true; return true; }
  drafts.touch('dashboard');
  r.on = !!t.checked;
  const li = t.closest('.dash-row'); if (li) li.classList.toggle('is-off', !r.on);
  return true;
}
export function register(){
  drafts.register({key: 'dashboard', label: 'Startseite', root: () => $('#dashForm'), extra: () => draft ? draft.rows : null,
    save: saveEditor, discard: resetEditor, reveal: () => R.navigate({page: 'dashboard'})});
}
