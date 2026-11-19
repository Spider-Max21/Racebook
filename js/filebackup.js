/* Racebook – Sicherungsdatei außerhalb des App-Speichers (ab 1.11.0, Issue #18 Teil 2).
   Nur in Browsern mit Systemauswahl für Dateien (File System Access: showSaveFilePicker, Freigabe über queryPermission/
   requestPermission; Chrome/Edge am Computer, laut MDN Chrome auf Android ab 132). Die Ablage wird einmal gewählt (Systemdialog
   mit vorgeschlagenem Namen, kein Pfad zum Eintippen). Danach schreibt Racebook die vollständige ZIP-Sicherung nach gespeicherten
   Änderungen gebündelt (zusammen mit den Wiederherstellungspunkten, also höchstens alle 10 Minuten und beim Wechsel in den
   Hintergrund) in diese Datei, liest sie zurück und prüft sie vollständig (Prüfsummen aller Fotos und PDFs). Erst dann gilt sie als
   Sicherung außerhalb der App. Scheitert das Schreiben, bleibt der bisherige Inhalt der Datei (der Browser schreibt erst in eine
   Zwischendatei und ersetzt beim Schließen); scheitert die Prüfung, wird nichts als gesichert vermerkt.
   Fehlt nach einem Neustart die Freigabe, braucht es ein Antippen („Wieder freigeben“, Vorgabe des Browsers). Bei geschlossener
   App wird nichts geschrieben. In Safari und Firefox fehlt die Systemauswahl; dort bleiben Herunterladen und Teilen.
   Einstellung (Name der Datei, letzter Erfolg, letzter Fehler) im Verwaltungsspeicher 'meta', Eintrag 'fileBackup'; sie gehört zu
   diesem Gerät und nicht in die Sicherung. Die Dateikennung selbst (FileSystemFileHandle) liegt getrennt in einer eigenen kleinen
   Datenbank 'racebook-datei' und wird nur hier und erst bei Bedarf gelesen: Start, Sicherung und Einspielen lesen sie nie mit. Bricht
   das Lesen der Kennung die Seite ab (im verfügbaren Testbrowser beobachtet), wird sie beim nächsten Mal verworfen statt erneut
   gelesen; dann erscheint „Datei neu wählen“. Mehrere Fenster schreiben nacheinander (Web Locks), derselbe Stand nur einmal.
   Wird während eines Schreibvorgangs etwas angefordert (Änderung, Einspielen, andere Datei), folgt genau ein weiterer Durchgang mit dem
   dann aktuellen Stand und der dann gewählten Datei. Hat sich die Einrichtung inzwischen geändert (andere Datei gewählt oder beendet,
   auch in einem anderen Fenster), wird der alte Durchgang nicht vermerkt; die Kennung gilt nur für die Einrichtung, zu der sie gehört.
   Vermerke (Erfolg, Fehler) prüfen die Einrichtung in derselben Transaktion, in der sie geschrieben werden (saveIf).
   Fehlen Fotos oder PDFs schon im App-Speicher, ersetzt Racebook eine vollständige Sicherung in der Datei nicht durch eine
   unvollständige; eine unvollständige Sicherung (neue Datei oder schon unvollständige) gilt nie als vollständig gesichert. */
import * as DB from './db.js';
import {S} from './state.js';
import {buildBackup, markBackup, readBackupFile} from './backup.js';

export const KEY = 'fileBackup';
export const SUGGESTED = 'racebook-sicherung.zip';
const T = () => (typeof window !== 'undefined' && window.__T) || null;
const listeners = [];
export function onChange(cb){ listeners.push(cb); }
const tell = () => listeners.forEach(cb => { try { cb(); } catch (e) {} });

/* Kann dieser Browser selbst in eine gewählte Datei schreiben? */
export function supported(){
  try {
    return typeof window.showSaveFilePicker === 'function' && typeof FileSystemHandle !== 'undefined'
      && typeof FileSystemHandle.prototype.queryPermission === 'function' && typeof FileSystemFileHandle.prototype.createWritable === 'function';
  } catch (e) { return false; }
}
/* Freigabe: 'granted' | 'prompt' | 'denied'. ask: nach einem Antippen erneut fragen (requestPermission braucht eine Benutzergeste). */
async function perm(h, ask){
  const t = T();
  if (t && t.filePerm) {
    if (!ask) return t.filePerm.query || 'granted';
    const r = t.filePerm.request || 'granted'; if (r === 'granted') t.filePerm.query = 'granted';   /* wie im Browser: einmal gewährt, gilt die Freigabe */
    return r;
  }
  try { return ask ? await h.requestPermission({mode: 'readwrite'}) : await h.queryPermission({mode: 'readwrite'}); }
  catch (e) { return 'denied'; }
}
/* ---------- Dateikennung in eigener Datenbank ---------- */
const HDB = () => 'racebook-datei' + ((T() && T().dbName) ? '-' + T().dbName : '');
const GUARD = 'rb-datei-lesen';
let cache = null;   /* {since, h}: Kennung der Einrichtung mit diesem Zeitpunkt (ein anderes Fenster kann inzwischen eine andere Datei gewählt haben) */
function hdb(){
  return new Promise((res, rej) => { const q = indexedDB.open(HDB(), 1); q.onupgradeneeded = () => q.result.createObjectStore('h', {keyPath: 'k'}); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}
async function putHandle(h, since){
  cache = {since, h};
  const t = T(); if (t && t.handleStore === 'test') return;
  const d = await hdb();
  await new Promise((res, rej) => { const tx = d.transaction('h', 'readwrite'); tx.objectStore('h').put({k: 'datei', handle: h}); tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
  d.close();
}
async function dropHandle(){
  cache = null;
  try { const d = await hdb(); await new Promise(res => { const tx = d.transaction('h', 'readwrite'); tx.objectStore('h').delete('datei'); tx.oncomplete = res; tx.onerror = res; }); d.close(); } catch (e) {}
}
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} };
/* Kennung laden. Ergebnis: Handle | null (keine) | 'lost' (beim letzten Lesen abgebrochen → verworfen) */
async function getHandle(since){
  if (cache && cache.since === since) return cache.h;
  cache = null;
  const t = T();
  if (t && t.handleStore === 'test') { const h = t.restoreHandle ? await t.restoreHandle() : null; cache = h ? {since, h} : null; return h; }
  /* Markierung eines früheren Lesens, das nicht zu Ende kam (älter als 15 s, sonst liest gerade ein anderes Fenster) */
  const g = Number(lsGet(GUARD) || 0);
  if (g && Date.now() - g > 15000) { lsSet(GUARD, null); await dropHandle(); return 'lost'; }
  lsSet(GUARD, String(Date.now()));
  try {
    const d = await hdb();
    const r = await new Promise((res, rej) => { const g = d.transaction('h').objectStore('h').get('datei'); g.onsuccess = () => res(g.result || null); g.onerror = () => rej(g.error); });
    d.close();
    const h = r && r.handle ? r.handle : null;
    cache = h ? {since, h} : null;
    return h;
  } catch (e) { return null; }
  finally { lsSet(GUARD, null); }
}
/* Eingerichtet? Liefert {…Einstellung, handle} oder null; bei verworfener Kennung {…, lost: true} */
const conf = async () => {
  const c = await DB.getMeta(KEY); if (!c) return null;
  const h = await getHandle(c.since);
  if (h === 'lost') { const n = Object.assign({}, c, {lost: true, err: {at: Date.now(), code: 'kennung'}}); await saveIf(c, {lost: true, err: n.err}); return n; }
  if (!h) return c.lost ? Object.assign({}, c, {lost: true}) : null;
  return Object.assign({}, c, {handle: h});
};
async function save(c){ const o = Object.assign({}, c); delete o.handle; await DB.setMeta(o); }
/* Vermerk nur schreiben, wenn die Einrichtung im Speicher noch genau m ist – Prüfen und Schreiben in einer Transaktion. false: geändert/beendet */
async function saveIf(m, patch){
  const o = Object.assign({}, m, patch); delete o.handle;
  try { await DB.commit([{store: 'meta', type: 'put', value: o}], {bump: false, expectMeta: {k: KEY, value: m}}); return true; }
  catch (e) { if (e && e.code === 'changed') return false; throw e; }
}
const ERR = {
  QuotaExceededError: 'Auf dem Gerät ist nicht genug Platz für die Datei.',
  NotAllowedError: 'Der Browser erlaubt das Schreiben in diese Datei nicht (mehr).',
  NotFoundError: 'Die gewählte Datei gibt es nicht mehr (verschoben oder gelöscht).',
  kennung: 'Die gewählte Datei ließ sich nicht mehr öffnen. Bitte wähle sie neu.',
  NoModificationAllowedError: 'Die Datei ist gerade gesperrt oder schreibgeschützt.',
  InvalidStateError: 'Die Datei hat sich während des Schreibens geändert.',
  pruefung: 'Beim Zurücklesen der Datei gab es eine Abweichung.',
  geaendert: 'Die Datei-Sicherung wurde inzwischen geändert oder beendet (auch in einem anderen Fenster).',
  fehlend: 'Im App-Speicher fehlen Fotos oder PDFs, auf die Einträge verweisen.'
};
export const errText = code => ERR[code] || 'Das Schreiben in die Datei hat nicht geklappt.';

/* Zustand für die Anzeige: {state: 'unsupported'|'off'|'ok'|'pending'|'needs'|'denied'|'error', name, last, err} */
export async function status(){
  if (!supported()) return {state: 'unsupported'};
  if (!DB.isOpen()) return {state: 'off'};
  const c = await conf();
  if (!c) return {state: 'off'};
  const base = {name: c.name || SUGGESTED, last: c.last || null, err: c.err || null, since: c.since || 0};
  if (c.lost) return Object.assign(base, {state: 'lost'});
  const p = await perm(c.handle, false);
  if (p === 'denied') return Object.assign(base, {state: 'denied'});
  if (p !== 'granted') return Object.assign(base, {state: 'needs'});
  if (c.err && (!c.last || c.err.at > c.last.at)) return Object.assign(base, {state: 'error'});
  return Object.assign(base, {state: !c.last ? 'pending' : c.last.missing ? 'partial' : 'ok'});
}
export async function refresh(){ try { S.fileBk = await status(); } catch (e) { S.fileBk = {state: 'off'}; } return S.fileBk; }

const locked = fn => (typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request) ? navigator.locks.request('racebook-sicherungsdatei', fn) : fn();
let chain = Promise.resolve(), waiting = null;

/* In die gewählte Datei schreiben und prüfen. force: auch wenn derselbe Stand schon in der Datei steht (Einrichten, „Jetzt schreiben“).
   Durchgänge laufen nacheinander. Anforderungen, solange noch einer läuft, werden zu genau einem weiteren Durchgang zusammengefasst
   (nie verworfen); dieser liest Einrichtung und Stand erst, wenn er an der Reihe ist.
   Ergebnis: {result: 'ok'|'partial'|'same'|'off'|'needs'|'denied'|'empty'|'error'|'stale', code, n} */
export function write(force){
  if (waiting) { if (force) waiting.force = true; return waiting.p; }
  const job = {force: !!force};
  job.p = chain.then(() => { if (waiting === job) waiting = null; return locked(() => writeLocked(job.force)); })
    .finally(() => refresh().then(tell));
  waiting = job;
  chain = job.p.catch(() => {});
  return job.p;
}
async function writeLocked(force){
  if (!supported() || !DB.isOpen()) return {result: 'off'};
  const c = await conf();
  if (!c) return {result: 'off'};
  if (c.lost) return {result: 'lost'};
  const p = await perm(c.handle, false);
  if (p !== 'granted') return {result: p === 'denied' ? 'denied' : 'needs'};
  const info = await DB.getMeta('info');
  const seq = info ? info.changeSeq || 0 : 0, epoch = info && typeof info.epoch === 'string' ? info.epoch : '';
  if (!force && c.last && c.last.seq === seq && c.last.epoch === epoch) return {result: 'same'};
  const b = await buildBackup();
  if (!b.counts.bikes && !b.counts.parts && !b.prefs) return {result: 'empty'};   /* ab 1.14.0: persönliche Einstellungen allein sind Bestand */
  /* Einrichtung noch dieselbe? (nicht inzwischen beendet oder eine andere Datei gewählt, auch nicht in einem anderen Fenster).
     Vermerkt wird nur über saveIf: geprüft wird dort noch einmal in derselben Transaktion. */
  const cur = async () => { const m = await DB.getMeta(KEY); return m && m.since === c.since ? m : null; };
  const note = async patch => { const m = await cur(); return !!m && await saveIf(m, patch); };
  const STALE = {result: 'stale', code: 'geaendert'};
  /* Fehlende Fotos/PDFs: eine vollständige Sicherung in der Datei nicht durch eine unvollständige ersetzen */
  const miss = (b.missing || []).length;
  if (miss && c.last && !c.last.missing) return await note({err: {at: Date.now(), code: 'fehlend', n: miss}}) ? {result: 'error', code: 'fehlend', n: miss} : STALE;
  const t = T();
  let w = null;
  try {
    if (t && t.fileFail) { const e = new Error('Test'); e.name = t.fileFail; if (!t.fileFailAlways) t.fileFail = null; throw e; }
    w = await c.handle.createWritable();
    await w.write(b.blob);
    await w.close(); w = null;
  } catch (e) {
    if (w) { try { await w.abort(); } catch (_) {} }
    const code = (e && e.name) || 'unknown';
    return await note({err: {at: Date.now(), code}}) ? {result: 'error', code} : STALE;
  }
  /* Zurücklesen und vollständig prüfen: dieselbe Sicherung (Zeitpunkt), gleiche Einträge, alle Dateien mit Prüfsumme */
  let ok = false;
  try {
    if (t && t.fileCorrupt) {
      t.fileCorrupt = false;
      const w2 = await c.handle.createWritable(); await w2.write(new Blob(['keine Sicherung'])); await w2.close();
    }
    const f = await c.handle.getFile();
    const d = await readBackupFile(f);
    ok = f.size === b.blob.size && Date.parse(d.exported) === b.at && (d.files || []).length === b.fileCount
      && Object.keys(b.counts).every(k => (d.counts[k] || 0) === b.counts[k]) && (d.missing || []).length === miss;
  } catch (e) { ok = false; }
  if (!ok) return await note({err: {at: Date.now(), code: 'pruefung'}}) ? {result: 'error', code: 'pruefung'} : STALE;
  if (!(await note({last: {at: b.at, seq: b.seq, epoch: b.epoch, size: b.blob.size, files: b.fileCount, missing: miss, name: c.name || ''}, err: null}))) return STALE;
  /* Unvollständig (Fotos/PDFs fehlten schon im App-Speicher): geschrieben und geprüft, aber nicht als Sicherung vermerkt */
  if (miss) return {result: 'partial', n: miss};
  /* Erst jetzt als Sicherung außerhalb der App vermerken – nur für den Bestand, aus dem sie stammt */
  try { await markBackup(Object.assign({}, b, {name: c.name || SUGGESTED}), 'file'); } catch (e) {}
  return {result: 'ok'};
}

/* Ablage einmal wählen (Systemdialog, vorgeschlagener Name), dann sofort schreiben und prüfen */
export async function choose(){
  const t = T();
  let h;
  try {
    h = t && t.pickFile ? await t.pickFile()
      : await window.showSaveFilePicker({suggestedName: SUGGESTED, types: [{description: 'Racebook-Sicherung (ZIP)', accept: {'application/zip': ['.zip']}}]});
  } catch (e) {
    if (e && e.name === 'AbortError') return {result: 'cancel'};
    return {result: 'error', code: (e && e.name) || 'unknown'};
  }
  const since = Date.now();
  await putHandle(h, since);
  await save({k: KEY, name: h.name || SUGGESTED, since, last: null, err: null});
  return write(true);
}
/* Nach einem Neustart: Freigabe erneut erbitten (nur nach einem Antippen) und dann schreiben */
export async function regrant(){
  const c = await conf();
  if (!c) return {result: 'off'};
  if (c.lost) return {result: 'lost'};
  const p = await perm(c.handle, true);
  if (p !== 'granted') { await refresh(); tell(); return {result: p === 'denied' ? 'denied' : 'needs'}; }
  return write(true);
}
export async function stop(){
  await dropHandle();
  await DB.commit([{store: 'meta', type: 'del', id: KEY}], {bump: false});
  await refresh(); tell();
}
/* Nach jedem Lauf der Wiederherstellungspunkte (gebündelt, auch beim Wechsel in den Hintergrund) */
export function auto(){ if (supported() && DB.isOpen()) write(false).catch(() => {}); }
