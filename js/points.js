/* Racebook – automatische Wiederherstellungspunkte auf diesem Gerät (ab 1.10.0, Issue #18).
   Ein Punkt ist ein ganzer gespeicherter Stand (alle Einträge, Menübelegung, verwendete Fotos und PDFs). Er entsteht ohne
   Zutun nach bestätigten Speicherungen, gebündelt, und hilft bei versehentlichem Löschen oder falschem Einspielen.
   Er liegt im selben Browserspeicher wie die Daten: Löschen der Website-Daten, Entfernen der App oder ein Gerätewechsel
   löschen ihn mit. Er ist darum keine Sicherung außerhalb der App und wird nie so genannt.
   - Nur Gespeichertes: offene Formulare, Entwürfe und Vorschläge der Texterkennung stehen nie im Speicher, also nie im Punkt.
   - Ablauf: in einer Transaktion lesen und ablegen (DB.takePoint) → zurücklesen und prüfen (Prüfsumme der Einträge, jede
     Datei vorhanden mit Größe) → erst dann als geprüft vermerken und ältere nach der Aufbewahrung entfernen (DB.confirmPoint).
     Scheitert die Prüfung, wird der neue Punkt verworfen; der letzte geprüfte bleibt.
   - Aufbewahrung: die POINT_NEWEST neuesten und je Tag der letzten POINT_DAYS Tage der letzte.
   - Wann: nach einer Änderung, sobald seit IDLE nichts mehr gespeichert wurde, höchstens alle GAP; wenn die App in den
     Hintergrund geht oder geschlossen wird, sofort (mindestens HIDDEN nach dem letzten Punkt); beim Start, falls nötig.
     Bei geschlossener App entsteht nichts.
   In Tests nur mit window.__T.points (wie der Service Worker), damit ältere Abläufe unverändert bleiben. */
import * as DB from './db.js';
import {S, COLLS} from './state.js';
import {sha256} from './images.js';
import {canon} from './util.js';
import {refsOf, toNext, verifyStored} from './backup.js';

export const POINT_NEWEST = 3, POINT_DAYS = 7;
const DELAYS = {idle: 60000, gap: 10 * 60000, hidden: 60000, boot: 5000};
const T = () => (typeof window !== 'undefined' && window.__T) || null;
const err = msg => { const e = new Error(msg); e.user = true; return e; };
const now = () => Date.now() + ((T() && T().pointClock) || 0);
const delay = k => { const t = T(), d = t && t.pointDelays && t.pointDelays[k]; return typeof d === 'number' ? d : DELAYS[k]; };
export const enabled = () => { const t = T(); return !t || !!t.points; };

/* Prüfsumme über den ganzen Stand des Punkts */
const sumOf = p => sha256(new Blob([canon({data: p.data || {}, navigation: p.navigation || null, epoch: p.epoch || '', changeSeq: p.changeSeq || 0})]));

/* Welche geprüften Punkte bleiben: die neuesten und je Kalendertag (Ortszeit) der letzten Tage der letzte.
   Ab Prüfbefund PR #24: getrennt für vollständige Punkte und für Punkte, in denen beim Anlegen schon Fotos oder PDFs fehlten
   (complete === false) – ein unvollständiger Punkt verdrängt nie einen vollständigen. */
export function keepRule(list, at){
  at = at || now();
  const full = list.filter(p => p.complete !== false), part = list.filter(p => p.complete === false);
  return keepOf(full, at).concat(keepOf(part, at));
}
function keepOf(list, at){
  const s = list.slice().sort((a, b) => b.created - a.created);
  const keep = new Set(s.slice(0, POINT_NEWEST).map(p => p.id));
  const start = new Date(at); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - (POINT_DAYS - 1));
  const day = ms => { const d = new Date(ms); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); };
  const seen = new Set();
  s.forEach(p => { if (p.created >= start.getTime()) { const k = day(p.created); if (!seen.has(k)) { seen.add(k); keep.add(p.id); } } });
  return Array.from(keep);
}

/* Gespeicherten Punkt zurücklesen und prüfen. deep: Dateien zusätzlich über ihre Prüfsumme (vor dem Wiederherstellen). */
async function verifyPoint(id, want, deep){
  const p = await DB.get('snapshots', id);
  if (!DB.isPoint(p)) return 'Der Punkt fehlt im Speicher.';
  if (!want || (await sumOf(p)) !== want) return 'Die gespeicherten Einträge weichen ab.';
  for (const f of p.files || []) {
    const r = await DB.get('files', f.id);
    if (!r || !(r.blob instanceof Blob) || r.blob.size !== f.size) return 'Ein Foto oder PDF fehlt oder hat die falsche Größe.';
    if (deep && f.sha256 && (await sha256(r.blob)) !== f.sha256) return 'Ein Foto oder PDF ist verändert.';
  }
  return '';
}

/* Einen Punkt anlegen. Ergebnis: {result: 'ok'|'same'|'wait'|'empty'|'bad', …}; Speicherfehler als Ausnahme {code} */
export async function makePoint(opts){
  opts = opts || {};
  const at = now();
  const r = await DB.takePoint({refsOf, minGap: opts.minGap, now: at});
  if (r.result !== 'new') return r;
  const p = r.point, want = await sumOf(p);
  const t = T();
  /* Testfall „Einspielen oder Speichern, während ein Punkt geprüft wird“ */
  if (t && t.pointHoldMs) await new Promise(res => setTimeout(res, t.pointHoldMs));
  if (t && t.pointCorrupt) {
    /* Testfall „beim Ablegen beschädigt“: ein Eintrag fehlt im gespeicherten Punkt */
    t.pointCorrupt = false;
    const bad = Object.assign({}, p, {data: Object.assign({}, p.data, {bikes: (p.data.bikes || []).slice(1)})});
    await DB.commit([{store: 'snapshots', type: 'put', value: bad}], {bump: false});
  }
  let bad;
  try { bad = await verifyPoint(p.id, want, false); } catch (e) { bad = 'Die Prüfung konnte nicht abgeschlossen werden.'; }
  if (bad) { try { await DB.dropPoint(p.id); } catch (e) {} return {result: 'bad', reason: bad}; }
  const c = await DB.confirmPoint(p.id, want, list => keepRule(list, at), at);
  if (c.result === 'gone') return {result: 'bad', reason: 'Der Punkt wurde während der Prüfung entfernt.'};
  return {result: 'ok', id: p.id, created: p.created, removed: c.removed, missing: (p.missing || []).length};
}

const countsOf = data => { const c = {}; COLLS.forEach(k => { c[k] = ((data || {})[k] || []).length; }); return c; };
const bikeNames = data => ((data || {}).bikes || []).slice().sort((a, b) => (a.order == null ? 9999 : a.order) - (b.order == null ? 9999 : b.order))
  .map(b => ((b.nickname ? b.nickname + ' – ' : '') + ((b.brand || '') + ' ' + (b.model || '')).trim()).trim());

/* Geprüfte Punkte für die Anzeige, neueste zuerst; ok: Einträge stimmen mit der Prüfsumme überein */
export async function listPoints(){
  const all = (await DB.getPoints()).filter(p => p.verified).sort((a, b) => b.created - a.created);
  const out = [];
  for (const p of all) {
    let ok = false;
    try { ok = !!p.sum && (await sumOf(p)) === p.sum; } catch (e) {}
    out.push({id: p.id, created: p.created, epoch: p.epoch, changeSeq: p.changeSeq, counts: countsOf(p.data), bikes: bikeNames(p.data),
      files: (p.files || []).length, missing: (p.missing || []).length, navigation: !!p.navigation, ok});
  }
  return out;
}

/* Bestand durch einen Punkt ersetzen. Vorher wird der Punkt vollständig geprüft; der jetzige Stand wird dabei zur
   Sicherheitskopie (wie beim Einspielen), andere Fenster werden über die neue Bestandskennung benachrichtigt. */
export async function restorePoint(id){
  const p = await DB.get('snapshots', id);
  if (!DB.isPoint(p) || !p.verified) throw err('Dieser Wiederherstellungspunkt ist nicht mehr vorhanden. Es wurde nichts verändert.');
  let bad;
  try { bad = await verifyPoint(id, p.sum, true); } catch (e) { bad = 'Die Prüfung konnte nicht abgeschlossen werden.'; }
  if (bad) throw err('Dieser Wiederherstellungspunkt ist beschädigt und wird nicht verwendet: ' + bad + ' Es wurde nichts verändert.');
  const next = {}; COLLS.forEach(c => { next[c] = (p.data[c] || []).slice(); });
  await DB.replaceAll(next, [], {reason: 'Vor dem Wiederherstellen eines Punkts', refsOf, navigation: p.navigation || null});
  /* Ab hier ist der Stand ersetzt: Abweichungen ehrlich melden */
  try {
    bad = await verifyStored(toNext(next), [], p.navigation || null);
    if (!bad) for (const f of p.files || []) { const r = await DB.get('files', f.id); if (!r || !(r.blob instanceof Blob) || r.blob.size !== f.size) { bad = 'Ein Foto oder PDF fehlt.'; break; } }
  } catch (e) { bad = 'Die Prüfung konnte nicht abgeschlossen werden.'; }
  if (bad) { const e = err('Der Punkt wurde wiederhergestellt, aber beim Nachprüfen gab es eine Abweichung: ' + bad + ' Der vorherige Stand liegt als Sicherheitskopie unter „Daten & Sicherung“.'); e.committed = true; throw e; }
  return {created: p.created, counts: countsOf(p.data), missing: (p.missing || []).length};
}

/* ---------- Automatischer Ablauf ---------- */
let timer = 0, running = null, again = false;
const listeners = [];
export function onRun(cb){ listeners.push(cb); }
export function schedule(kind){
  if (!enabled()) return;
  clearTimeout(timer);
  timer = setTimeout(() => { run('gap'); }, delay(kind));
}
/* gapKind: Mindestabstand zum letzten Punkt dieses Bestands ('gap' nach Änderungen, 'hidden' beim Verlassen) */
export async function run(gapKind){
  if (!enabled() || !DB.isOpen() || S.mode !== 'ready') return null;
  if (running) { again = true; return running; }
  running = (async () => {
    let r;
    try { r = await makePoint({minGap: delay(gapKind || 'gap')}); }
    catch (e) { const m = DB.mapErr(e); r = {result: 'error', code: m.code}; }
    /* 'pending' (ab Prüfbefund PR #24): ein noch nicht geprüfter Punkt desselben Stands – läuft die Prüfung woanders noch, ist er bis
       dahin geprüft ('same'); ist er liegengeblieben (App zwischen Ablegen und Prüfen beendet), wird er danach ersetzt */
    if (r.result === 'wait' || r.result === 'pending') { clearTimeout(timer); timer = setTimeout(() => { run('gap'); }, Math.max(1000, r.next - now() + 50)); }
    if (r.result === 'ok' || r.result === 'bad' || r.result === 'error') S.pointRun = Object.assign({at: Date.now()}, r);
    return r;
  })();
  let r;
  try { r = await running; } finally { running = null; }
  listeners.forEach(cb => { try { cb(r); } catch (e) {} });
  if (again) { again = false; schedule('idle'); }
  return r;
}
export function initPoints(){
  /* Nach jeder bestätigten Änderung (auch aus einem anderen Fenster: wer zuerst dran ist, legt ab; derselbe Stand nur einmal) */
  DB.onChange(stores => { if (Array.from(stores).some(s => s !== 'snapshots' && s !== 'files')) schedule('idle'); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') run('hidden'); });
  window.addEventListener('pagehide', () => { run('hidden'); });
  schedule('boot');
}
