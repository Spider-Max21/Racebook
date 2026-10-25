/* Racebook – Sicherung (ZIP mit Daten und Dateien), Einspielen und Übernahme der bisherigen Version.
   Ablauf beim Einspielen: Datei lesen → vollständig prüfen → Vorschau → nach Bestätigung in einem
   einzigen Schreibvorgang ersetzen (vorher Sicherheitskopie) → zurücklesen und vergleichen.
   Keine Oberfläche; die Texte der Fehler sind für Menschen geschrieben. */
import * as DB from './db.js';
import {makeZip, readZip, isZip} from './zip.js';
import {sha256, sniff} from './images.js';
import {validateZipJson, validateV8Backup, fileRefs, splitOrphans, mergeOrphans, ZIP_FORMAT, ZIP_VERSION, ZIP_VERSION_PLAIN, DEP_COLLS, KEYS, NAMES} from './domain.js';
import {COLLS} from './state.js';
import {pad, canon, isISO, fmtDate} from './util.js';

export const APP_VERSION = '1.0.3';
export const V8_LOCAL_KEY = 'wh-garage-local';
const MAX_JSON = 60 * 1024 * 1024;
const enc = new TextEncoder();
const err = msg => { const e = new Error(msg); e.user = true; return e; };

const toNext = recs => { const n = {}; COLLS.forEach(c => { n[c] = {}; (recs[c] || []).forEach(d => { n[c][d.id] = d; }); }); return n; };
export const refsOf = recs => new Set(fileRefs(toNext(recs)).keys());

function stamp(d){
  d = d || new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
}
export function counts(next){ const c = {}; COLLS.forEach(k => { c[k] = Object.keys(next[k] || {}).length; }); return c; }
export function countText(c){
  const parts = [[c.bikes, 'Motorrad', 'Motorräder'], [c.log, 'Logbuch-Eintrag', 'Logbuch-Einträge'], [c.rides, 'Fahrt', 'Fahrten'], [c.setups, 'Setup', 'Setups'], [c.defects, 'Mangel', 'Mängel'], [c.parts, 'Teil', 'Teile']];
  return parts.map(([n, s, p]) => (n || 0) + ' ' + (n === 1 ? s : p)).join(', ');
}

/* ---------- Sicherung erstellen ---------- */
export async function buildBackup(){
  /* Ein Lesevorgang über Einträge, Dateien und Zähler: die Sicherung zeigt einen stimmigen Stand */
  const recs = await DB.readRecords(COLLS.concat(['files', 'meta']));
  const next = toNext(recs);
  const refs = fileRefs(next);
  const fmap = new Map((recs.files || []).map(f => [f.id, f]));
  const files = [], fehlend = [], missingText = [];
  refs.forEach((what, id) => { const f = fmap.get(id); if (f) files.push(f); else { fehlend.push(id); missingText.push(what); } });
  const info = (recs.meta || []).find(m => m.k === 'info') || {};
  /* Einträge ohne Motorrad (nur aus früheren Versionen) kommen getrennt in „verwaist“ und gehen nicht verloren */
  const sp = splitOrphans(next);
  const dateien = [];
  for (const f of files) {
    const sh = f.sha256 || await sha256(f.blob);
    dateien.push({id: f.id, name: f.name || '', type: f.type, size: f.blob.size, sha256: sh, path: 'dateien/' + f.id,
      w: Number.isInteger(f.w) ? f.w : null, h: Number.isInteger(f.h) ? f.h : null, created: f.created || 0});
  }
  const now = new Date();
  const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  const json = {format: ZIP_FORMAT, version: sp.count ? ZIP_VERSION : ZIP_VERSION_PLAIN, app: APP_VERSION, exportiert: now.toISOString(), stand: {changeSeq: info.changeSeq || 0}};
  COLLS.forEach(c => { json[KEYS[c]] = (recs[c] || []).filter(d => c === 'bikes' || sp.clean[c][d.id]).sort(byId); });
  if (sp.count) {
    json.verwaist = {};
    DEP_COLLS.forEach(c => { const a = (recs[c] || []).filter(d => sp.orphans[c][d.id]).sort(byId); if (a.length) json.verwaist[KEYS[c]] = a; });
  }
  json.dateien = dateien;
  json.fehlend = fehlend;
  const c = counts(next);
  const readme = 'Racebook-Sicherung vom ' + now.toLocaleString('de-DE') + '\r\n\r\n'
    + 'Inhalt: ' + countText(c) + ', ' + dateien.length + ' Dateien (Fotos, Anleitungen).\r\n'
    + (sp.count ? 'Davon gehören ' + sp.count + ' Einträge zu keinem Motorrad mehr (aus einer früheren Version); sie stehen getrennt unter „verwaist“.\r\n' : '')
    + 'racebook.json enthält alle Einträge, der Ordner dateien/ die Fotos und PDFs.\r\n\r\n'
    + 'Einspielen: Racebook öffnen → Daten & Sicherung → Sicherung einspielen → diese ZIP-Datei wählen.\r\n'
    + 'Die Datei nicht entpacken und neu packen, sonst stimmen die Prüfsummen eventuell nicht mehr.\r\n';
  const blob = await makeZip([{name: 'racebook.json', data: enc.encode(JSON.stringify(json, null, 1)), date: now}]
    .concat(files.map(f => ({name: 'dateien/' + f.id, data: f.blob, date: new Date(f.created || now)})))
    .concat([{name: 'LIESMICH.txt', data: enc.encode(readme), date: now}]));
  return {blob, name: 'racebook-sicherung-' + stamp(now) + '.zip', seq: info.changeSeq || 0, at: now.getTime(), counts: c, fileCount: dateien.length, missing: missingText,
    epoch: typeof info.epoch === 'string' ? info.epoch : '', orphans: sp.count};
}
/* Sicherung vermerken, aber nur für den Bestand, aus dem sie erstellt wurde */
export async function markBackup(b, how){
  await DB.setMeta({k: 'backup', at: b.at, seq: b.seq, name: b.name, size: b.blob.size, files: b.fileCount, how, epoch: b.epoch}, b.epoch);
}

/* ---------- Sicherung lesen und prüfen ---------- */
function draftOf(r, extra){
  const c = counts(r.next);
  const bikes = Object.values(r.next.bikes).map(b => ((b.nickname ? b.nickname + ' – ' : '') + (b.brand + ' ' + (b.model || '')).trim() + (b.year ? ' (' + b.year + ')' : '')));
  const orphans = r.orphans || null;
  const orphanCount = orphans ? DEP_COLLS.reduce((n, k) => n + Object.keys(orphans[k] || {}).length, 0) : 0;
  return Object.assign({next: r.next, orphans, orphanCount, files: r.files || [], missing: r.missing || [], counts: c, bikes, source: r.source, version: r.version,
    exported: isISO(String(r.exported || '').slice(0, 10)) ? r.exported : ''}, extra || {});
}
export async function readBackupFile(file){
  if (!file) throw err('Keine Datei gewählt.');
  if (await isZip(file)) return readZipBackup(file, file.name);
  if (file.size > MAX_JSON) throw err('Die Datei ist zu groß für eine Racebook-Sicherung.');
  let text;
  try { text = await file.text(); } catch (e) { throw err('Die Datei konnte nicht gelesen werden.'); }
  return readJsonBackup(text, file.name);
}
export function readJsonBackup(text, name){
  let d;
  try { d = JSON.parse(text); } catch (e) { throw err('Das ist keine gültige Sicherung (weder ZIP noch lesbares JSON).'); }
  const r = validateV8Backup(d);
  return draftOf(r, {fileName: name || '', size: text.length});
}
async function readZipBackup(blob, name){
  const m = await readZip(blob).catch(e => { throw err(e.message || 'Die ZIP-Datei ist beschädigt.'); });
  const je = m.get('racebook.json');
  if (!je) throw err('In der ZIP-Datei fehlt racebook.json. Ist das eine Racebook-Sicherung?');
  if (je.size > MAX_JSON) throw err('racebook.json ist zu groß.');
  let d;
  try { d = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(await je.read())); }
  catch (e) { throw err(e && e.code === 'zip' ? e.message : 'racebook.json in der Sicherung ist beschädigt.'); }
  const r = validateZipJson(d);
  const files = [];
  const what = fileRefs(r.next);
  for (const f of r.files) {
    const label = what.get(f.id) || f.name || f.id;
    const e = m.get(f.path);
    if (!e) throw err('In der Sicherung fehlt die Datei für: ' + label + '.');
    let bytes;
    try { bytes = await e.read(); } catch (x) { throw err((x && x.message) || ('Die Datei für „' + label + '“ ist beschädigt.')); }
    if (bytes.length !== f.size) throw err('Die Datei für „' + label + '“ hat die falsche Größe.');
    const type = sniff(bytes.subarray(0, 16));
    if (type !== f.type) throw err('Die Datei für „' + label + '“ hat nicht den angegebenen Typ (' + f.type + ').');
    const b = new Blob([bytes], {type: f.type});
    if ((await sha256(b)) !== f.sha256) throw err('Die Prüfsumme der Datei für „' + label + '“ stimmt nicht.');
    files.push({id: f.id, blob: b, type: f.type, size: f.size, name: f.name, sha256: f.sha256, w: f.w, h: f.h, created: f.created || Date.now()});
  }
  return draftOf(Object.assign({}, r, {files}), {fileName: name || '', size: blob.size});
}

/* ---------- Ersetzen ---------- */
function asArrays(next){ const o = {}; COLLS.forEach(c => { o[c] = Object.keys(next[c] || {}).map(id => Object.assign({}, next[c][id], {id})); }); return o; }

/* Nach dem Schreiben alles zurücklesen und mit der geprüften Vorlage vergleichen */
export async function verifyStored(next, files){
  const back = await DB.readRecords(COLLS.concat(['files']));
  for (const c of COLLS) {
    const want = next[c] || {}, got = back[c] || [];
    if (got.length !== Object.keys(want).length) return 'Im Bereich „' + NAMES[c] + '“ stimmt die Anzahl nicht.';
    for (const d of got) {
      const w = want[d.id];
      if (!w) return 'Im Bereich „' + NAMES[c] + '“ ist ein unerwarteter Eintrag.';
      const x = Object.assign({}, d); delete x.id;
      const y = Object.assign({}, w); delete y.id;
      if (canon(x) !== canon(y)) return 'Ein Eintrag im Bereich „' + NAMES[c] + '“ weicht ab.';
    }
  }
  const have = new Map((back.files || []).map(f => [f.id, f]));
  for (const f of files || []) {
    const h = have.get(f.id);
    if (!h || !(h.blob instanceof Blob) || h.blob.size !== f.blob.size) return 'Eine Datei fehlt nach dem Speichern.';
  }
  return '';
}

export async function applyDraft(draft, how){
  /* Verwaiste Einträge (Version 5) werden mit übernommen und erscheinen danach unter „Daten & Sicherung“ */
  const all = draft.orphanCount ? mergeOrphans(draft.next, draft.orphans) : draft.next;
  const next = asArrays(all);
  const meta = [{k: 'lastImport', at: Date.now(), source: draft.source, counts: draft.counts, fileName: draft.fileName || '', missing: draft.missing || []}];
  if (draft.source === 'v8-local') meta.push({k: 'migration', from: 'v8-local', at: Date.now(), counts: draft.counts, verified: false, sourceKept: true});
  const exportedAt = draft.exported ? Date.parse(draft.exported) : NaN;
  /* Scheitert dieser Schritt, ist nichts verändert. */
  const res = await DB.replaceAll(next, draft.files || [], {reason: how || 'Sicherung eingespielt', refsOf, meta,
    importSeq: draft.source === 'zip' && !isNaN(exportedAt) ? {at: exportedAt, name: draft.fileName || 'Sicherung', size: draft.size || 0} : null});
  /* Ab hier ist der neue Bestand gespeichert: Abweichungen ehrlich melden, nie „unverändert“ behaupten */
  let bad;
  try { bad = await verifyStored(all, draft.files); } catch (e) { bad = 'Die Prüfung konnte nicht abgeschlossen werden.'; }
  if (bad) { const e = err('Die Sicherung wurde eingespielt, aber beim Nachprüfen gab es eine Abweichung: ' + bad + ' Der vorherige Stand liegt als Sicherheitskopie unter „Daten & Sicherung“.'); e.committed = true; throw e; }
  if (draft.source === 'v8-local') await DB.setMeta({k: 'migration', from: 'v8-local', at: Date.now(), counts: draft.counts, verified: true, sourceKept: true});
  return res;
}

export async function snapshotInfo(){
  const s = await DB.getSnapshot();
  if (!s) return null;
  const c = {}; COLLS.forEach(k => { c[k] = (s.data[k] || []).length; });
  return {created: s.created, reason: s.reason, counts: c, files: (s.fileIds || []).length};
}
export async function restoreSnapshot(){
  const s = await DB.getSnapshot();
  if (!s) throw err('Es gibt keine Sicherheitskopie.');
  const next = {}; COLLS.forEach(c => { next[c] = s.data[c] || []; });
  await DB.replaceAll(next, [], {reason: 'Vor dem Wiederherstellen', refsOf});
  const back = toNext(next);
  let bad;
  try { bad = await verifyStored(back, []); } catch (e) { bad = 'Die Prüfung konnte nicht abgeschlossen werden.'; }
  if (bad) { const e = err('Die Sicherheitskopie wurde zurückgeholt, aber beim Nachprüfen gab es eine Abweichung: ' + bad); e.committed = true; throw e; }
}

/* ---------- Bisherige lokale Version (Racebook bis Version 8, Gerätespeicher) ---------- */
export function readV8Local(){
  let raw = null;
  try { raw = localStorage.getItem(V8_LOCAL_KEY); } catch (e) { return null; }
  if (!raw) return null;
  let s;
  try { s = JSON.parse(raw); } catch (e) { return {error: 'Die Daten der bisherigen Version auf diesem Gerät sind nicht lesbar.', raw}; }
  if (!s || typeof s !== 'object') return {error: 'Die Daten der bisherigen Version auf diesem Gerät sind nicht lesbar.', raw};
  const arr = k => (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k])) ? Object.keys(s[k]).map(id => Object.assign({}, s[k][id], {id})) : [];
  const d = {format: 'racebook', version: 3, motorraeder: arr('bikes'), logbuch: arr('log'), fahrten: arr('rides'), fahrwerk: arr('setups'), teile: arr('parts')};
  if (!d.motorraeder.length) return {empty: true, raw};
  try { return {draft: draftOf(validateV8Backup(d), {fileName: 'bisherige Version (dieses Gerät)', size: raw.length, source: 'v8-local'}), raw}; }
  catch (e) { return {error: 'Die Daten der bisherigen Version sind unvollständig oder beschädigt: ' + e.message, raw}; }
}
export function removeV8Local(){ try { localStorage.removeItem(V8_LOCAL_KEY); return true; } catch (e) { return false; } }

export const fmtWhen = ms => { if (!ms) return ''; const d = new Date(ms); return fmtDate(d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())) + ', ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' Uhr'; };
