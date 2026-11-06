/* Racebook – Bearbeitungsvorgänge in einem Fenster (ab 1.2.0).
   Je Formular ein Entwurf. Geändert = die Eingaben (Text, Zahlen, Auswahl, Häkchen, Anhänge, zusätzlicher Zustand) weichen
   vom Stand beim Öffnen bzw. Zurücksetzen ab. Will der Nutzer mit geänderten Eingaben zu einem anderen Motorrad, Bereich
   oder Formular wechseln (auch „Meine Garage“ und Zurück), fragt Racebook: „Du hast ungespeicherte Änderungen.“
     Speichern         = Eingaben prüfen und vollständig speichern, erst danach zum Ziel; sonst bleibt alles, wie es ist
     Verwerfen         = nur diesen Entwurf schließen, dann zum Ziel (Gespeichertes bleibt)
     Weiter bearbeiten = nicht wechseln, Eingaben bleiben
   Unveränderte Formulare: keine Rückfrage. Verschachtelte Hilfsdialoge (Zählerauswahl, Rückfrage beim Stand) gehören zum
   laufenden Vorgang. Während eine Speicherung läuft, beginnt in diesem Fenster kein zweiter Vorgang.
   Ab 1.2.1 gilt „ein Vorgang“ auch innerhalb eines Bereichs: Wer ein weiteres Formular öffnet (begin) oder in ein anderes
   Formular tippt bzw. tippt-klickt (focusin/click), schließt ein unverändertes offenes Formular ohne Rückfrage; bei
   geänderten Eingaben kommt dieselbe Rückfrage. Zusammengehörige Entwürfe (Schnell-Eintrag → übernommenes Formular, link)
   gelten als ein Vorgang.
   Mehrere Fenster schützt das nicht; dafür prüft der Speicher beim Schreiben die Grundlage des ganzen Entwurfs. */
import {S} from './state.js';
import {$, $$, toast} from './ui.js';

const DEF = new Map();
const snap = {}, touched = {};
let saving = 0;

/* def: {key, label, root() → Element|null, extra() → Zustand außerhalb der Felder, save() → Promise<bool>, discard(),
        isOpen() → Formular ist geöffnet und kann geschlossen werden (sonst bleibt es beim Öffnen eines anderen stehen),
        close() → schließen, falls anders als discard()} */
export function register(def){ DEF.set(def.key, def); }
function serial(def){
  const root = def.root ? def.root() : null;
  const parts = [];
  if (root) $$('input, select, textarea', root).forEach((el, i) => {
    if (el.dataset && el.dataset.nodirty != null) return;
    const name = el.id || el.name || (el.dataset && el.dataset.k) || el.tagName + i;
    let v;
    if (el.type === 'checkbox' || el.type === 'radio') v = el.checked ? (el.value || '1') : '';
    else if (el.type === 'file') v = Array.from(el.files || []).map(f => f.name + ':' + f.size + ':' + f.lastModified).join(',');
    else v = el.value;
    if (el.type === 'radio' && !el.checked) return;
    parts.push(name + '=' + v);
  });
  let x = '';
  try { x = def.extra ? JSON.stringify(def.extra()) : ''; } catch (e) { x = String(Math.random()); }
  return parts.join('\u0001') + '\u0002' + x;
}
/* Ausgangsstand eines Entwurfs festhalten (beim Öffnen, Zurücksetzen oder nach dem Speichern). Solange der Nutzer nichts
   eingegeben hat, wird er nach jedem Neuzeichnen nachgeführt (settle): Änderungen durch die Anzeige selbst, z. B. neu
   gefüllte Auswahllisten, gelten nicht als Eingabe. touch(): Inhalt wurde vom Nutzer oder für ihn eingesetzt (z. B. aus der
   Vorschau des Schnell-Eintrags übernommen). Geändert = berührt und anders als beim Öffnen. */
export function mark(key){ const d = DEF.get(key); if (d) { snap[key] = serial(d); touched[key] = false; } unlink(key); }
export function forget(key){ delete snap[key]; touched[key] = false; unlink(key); }
/* Zusammengehörige Entwürfe (z. B. ein Eintrag aus der Vorschau des Schnell-Eintrags im passenden Formular) */
const links = {};
export function link(a, b){ (links[a] = links[a] || new Set()).add(b); (links[b] = links[b] || new Set()).add(a); }
function unlink(k){ (links[k] || new Set()).forEach(x => { if (links[x]) links[x].delete(k); }); delete links[k]; }
const withLinks = keys => { const out = new Set(); [].concat(keys || []).forEach(k => { out.add(k); (links[k] || new Set()).forEach(x => out.add(x)); }); return Array.from(out); };
export function touch(key){ if (DEF.has(key)) { if (snap[key] == null) snap[key] = serial(DEF.get(key)); touched[key] = true; } }
export function settle(){ DEF.forEach((d, k) => { if (!touched[k]) snap[k] = serial(d); }); }
export function isDirty(key){
  const d = DEF.get(key); if (!d || !touched[key]) return false;
  if (d.open && !d.open()) return false;
  /* Ein Formular, das es nicht mehr gibt (geschlossen, neu gezeichnet), hält keine ungespeicherten Eingaben */
  if (d.root && !d.root() && !d.extra) return false;
  if (snap[key] == null) return false;
  return serial(d) !== snap[key];
}
export const dirtyKeys = except => Array.from(DEF.keys()).filter(k => k !== except && !(Array.isArray(except) && except.includes(k)) && isDirty(k));
/* Unveränderte geöffnete Formulare schließen, außer den genannten (und mit ihnen verbundenen) */
export function closeIdle(except){
  const ex = withLinks(except);
  DEF.forEach((d, k) => {
    if (ex.includes(k) || !d.isOpen || isDirty(k)) return;
    let open = false; try { open = !!d.isOpen(); } catch (e) {}
    if (!open) return;
    try { (d.close || d.discard)(); } finally { mark(k); }
  });
}
/* Neues Formular öffnen: erst Rückfrage bei geänderten anderen Eingaben, dann unveränderte andere schließen, dann öffnen */
export function begin(go, except){ return guard(async () => { closeIdle(except || []); await go(); }, withLinks(except || [])); }
export const labelOf = k => (DEF.get(k) || {}).label || 'Eingaben';

/* Läuft gerade eine Speicherung aus einem Formular? */
export async function savingRun(fn){ saving++; try { return await fn(); } finally { saving--; } }
export const busySaving = () => saving > 0 || Object.values(S.ops || {}).some(o => o && o.saving) || !!(S.pending && S.pending.saving);

/* Wechsel anfragen. except: Entwürfe, die zum Ziel gehören (bleiben unberührt). go(): der eigentliche Wechsel.
   Ergebnis: true = gewechselt, false = geblieben */
let asking = null;
export async function guard(go, except){
  /* Nur für automatisierte Tests älterer Abläufe (window.__T.leaveAuto): 'discard' wählt bei der Rückfrage „Verwerfen“,
     'bypass' stellt das Verhalten bis 1.1.2 her (keine Rückfrage, mehrere Entwürfe gleichzeitig). Ohne Testhaken wirkungslos. */
  const T = typeof window !== 'undefined' && window.__T;
  if (T && T.leaveAuto === 'bypass') { await go(); return true; }
  if (asking) return false;
  if (busySaving()) { toast('Einen Moment, es wird gerade gespeichert.'); return false; }
  for (;;) {
    const keys = dirtyKeys(except);
    if (!keys.length) break;
    const k = keys[0];
    const a = T && T.leaveAuto === 'discard' ? 'discard' : await ask(k);
    if (a === 'keep') { focusDraft(k); return false; }
    const d = DEF.get(k);
    if (a === 'discard') { try { d.discard(); } finally { mark(k); } continue; }
    if (a === 'save') {
      let ok = false;
      try { ok = await d.save(); } catch (e) { ok = false; }
      /* Erst nach vollständigem Speichern wechseln; bei Fehler, Konflikt oder Abbruch im Vorgang bleiben */
      if (!ok || isDirty(k)) { focusDraft(k); return false; }
      mark(k);
    }
  }
  await go();
  return true;
}
function focusDraft(k){
  const d = DEF.get(k), root = d && d.root ? d.root() : null;
  if (d && d.reveal) d.reveal();
  if (root) { const f = $$('input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])', root).find(x => x.offsetParent !== null); if (f) { try { f.focus({preventScroll: true}); } catch (e) {} } root.scrollIntoView({block: 'center'}); }
}
function ask(k){
  const dlg = $('#leaveDlg');
  $('#leaveWhat').textContent = 'Betrifft: ' + labelOf(k) + '.';
  return new Promise(res => {
    asking = v => { asking = null; if (dlg.open) dlg.close(); res(v); };
    dlg.showModal();
    $('#leaveKeep').focus();
  });
}
/* Zu welchem Entwurf gehört ein Element? */
function keyOf(el){ for (const [k, d] of DEF) { const r = d.root ? d.root() : null; if (r && r.contains(el)) return k; } return null; }
let refocus = false;
/* Programmgesteuerte Übergabe innerhalb eines Vorgangs (z. B. Vorschau → Formular): Fokus dabei nicht prüfen */
export function quietly(fn){ const was = refocus; refocus = true; try { return fn(); } finally { refocus = was; } }
/* In ein anderes Formular wechseln (Fokus, z. B. Antippen eines Feldes) = neuer Vorgang */
function onFocus(e){
  if (refocus || asking || S.mode !== 'ready') return;
  const T = window.__T; if (T && T.leaveAuto === 'bypass') return;
  const t = e.target, k = keyOf(t); if (!k) return;
  const ex = withLinks(k), others = dirtyKeys(ex);
  if (!others.length) { if (!busySaving()) { closeIdle(ex); refocusIfGone(t); } return; }
  if (T && T.leaveAuto === 'discard') { guard(() => {}, ex); closeIdle(ex); refocusIfGone(t); return; }
  try { t.blur(); } catch (err) {}
  guard(() => { closeIdle(ex); refocusTo(t); }, ex);
}
function refocusTo(t){
  const n = t.isConnected ? t : (t.id ? document.getElementById(t.id) : null);
  if (!n) return;
  refocus = true; try { n.focus({preventScroll: true}); n.scrollIntoView({block: 'nearest'}); } catch (e) {} finally { refocus = false; }
}
function refocusIfGone(t){ if (!t.isConnected) refocusTo(t); }
/* Knöpfe und Häkchen bekommen nicht in jedem Browser den Fokus (Safari): Klick in ein anderes Formular ebenso prüfen */
function onClickCap(e){
  if (refocus) return;
  const T = window.__T; if (T && T.leaveAuto === 'bypass') return;
  const c = e.target && e.target.closest && e.target.closest('button, input, select, textarea, label'); if (!c) return;
  const k = keyOf(c); if (!k) return;
  if (asking) { e.preventDefault(); e.stopImmediatePropagation(); return; }
  const ex = withLinks(k);
  if (!dirtyKeys(ex).length) return;
  if (T && T.leaveAuto === 'discard') { guard(() => {}, ex); return; }
  e.preventDefault(); e.stopImmediatePropagation();
  guard(() => { closeIdle(ex); }, ex);
}
export function initDrafts(){
  const dlg = $('#leaveDlg');
  document.addEventListener('focusin', onFocus, true);
  document.addEventListener('click', onClickCap, true);
  /* Eingaben in einem Formular machen es zum Bearbeitungsvorgang */
  const onEdit = e => { const t = e.target; if (!t || (t.dataset && t.dataset.nodirty != null)) return; DEF.forEach((d, k) => { const r = d.root ? d.root() : null; if (r && r.contains(t)) touched[k] = true; }); };
  document.addEventListener('input', onEdit, true);
  document.addEventListener('change', onEdit, true);
  $('#leaveSave').addEventListener('click', () => { if (asking) asking('save'); });
  $('#leaveDiscard').addEventListener('click', () => { if (asking) asking('discard'); });
  $('#leaveKeep').addEventListener('click', () => { if (asking) asking('keep'); });
  dlg.addEventListener('cancel', e => { e.preventDefault(); if (asking) asking('keep'); });
}
export const asked = () => !!asking;
/* Für automatisierte Tests: Ausgangsstand und jetziger Stand eines Entwurfs */
export const debugState = key => { const d = DEF.get(key); return d ? {snap: snap[key], now: serial(d), touched: !!touched[key]} : null; };
