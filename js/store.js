/* Racebook – Speicheradapter für die Oberfläche.
   Hält eine Kopie des gespeicherten Bestands im Arbeitsspeicher, meldet Änderungen an die Ansicht
   und liefert für jeden Schreibvorgang ein klares Ergebnis:
     'ok'      gespeichert (bei Zweifel durch Nachlesen im Speicher bestätigt)
     'fail'    sicher nicht gespeichert
     'unclear' nicht feststellbar (nur bei Zeitüberschreitung oder in Fehlertests)
   Neue Einträge erscheinen sofort als „wird gespeichert“ und verschwinden wieder, wenn das
   Speichern sicher scheitert (optimistische Anzeige mit Rücknahme).
   Jeder Schreibvorgang nennt die Bestandskennung (S.epoch), zu der er gehört: beim Aufruf, oder
   ausdrücklich als opts.epoch, wenn der Vorgang schon früher begonnen hat (Foto verkleinern, Schnell-Eintrag).
   Wurde der Bestand inzwischen ersetzt, weist der Speicher ihn ab ('stale'). Ändert sich die Kennung,
   wird alles neu gelesen und die Oberfläche benachrichtigt (onEpochChange).
   Für automatisierte Tests kann window.__T Fehler einspeisen (siehe tests/inject.js). */
import * as DB from './db.js';
import {clone, same, subOf, validId} from './util.js';
import {S, COLLS} from './state.js';

const T = () => (typeof window !== 'undefined' && window.__T) || null;
const wait = ms => new Promise(r => setTimeout(r, ms));
const COMMIT_TIMEOUT = 20000;

const L = {}; COLLS.forEach(k => { L[k] = {}; });
const pend = {};
const subs = {};
let inflightN = 0, epochCb = null, slowCb = null;
/* Hängt ein Schreibvorgang länger als SLOW_MS, meist weil Racebook noch in einem anderen Tab offen ist und den
   Speicher blockiert: Hinweis anzeigen (slowCb(true)), nach dem Ende wieder entfernen (slowCb(false)) */
const SLOW_MS = 4000;
export function onSlowWrite(cb){ slowCb = cb; }
/* Laufende Schreibvorgänge in diesem Fenster (für „erst einspielen, wenn nichts mehr gespeichert wird“) */
export const inflight = () => inflightN;
export function onEpochChange(cb){ epochCb = cb; }
async function counted(fn){ inflightN++; try { return await fn(); } finally { inflightN--; } }
const epochArg = o => (o && typeof o.epoch === 'string') ? o.epoch : (S.epoch || '');

/* ---------- Testschnittstelle ---------- */
function failOf(op, path){
  const t = T(); if (!t || !Array.isArray(t.fail)) return null;
  const i = t.fail.findIndex(f => f.op === op && path.startsWith(f.prefix));
  if (i < 0) return null;
  const f = t.fail[i]; if (f.once) t.fail.splice(i, 1);
  return f;
}
function mirror(coll, id){
  const t = T(); if (!t || !t.store) return;
  const p = coll + '/' + id;
  if (L[coll][id]) t.store[p] = clone(L[coll][id]); else delete t.store[p];
}
function mirrorAll(){
  const t = T(); if (!t || !t.store) return;
  Object.keys(t.store).forEach(k => delete t.store[k]);
  COLLS.forEach(c => Object.keys(L[c]).forEach(id => mirror(c, id)));
}

/* ---------- Laden und Melden ---------- */
const strip = d => { const o = Object.assign({}, d); delete o.id; return o; };
/* Alles in einem Lesevorgang, zusammen mit der Bestandskennung. Ergebnis: true, wenn sich die Kennung geändert hat. */
export async function loadAll(){
  const r = await DB.readRecords(COLLS.concat(['meta']));
  COLLS.forEach(c => { L[c] = {}; (r[c] || []).forEach(d => { if (d && validId(d.id)) L[c][d.id] = strip(d); }); });
  const old = S.epoch, ep = DB.epochOf(r.meta);
  S.epoch = ep;
  mirrorAll();
  return old != null && old !== ep;
}
async function reload(colls){
  const list = COLLS.filter(c => colls.has(c));
  if (!list.length) return;
  const r = await DB.readRecords(list.concat(['meta']));
  /* Bestand in einem anderen Fenster ersetzt: alles neu lesen und die Oberfläche zurücksetzen */
  if (DB.epochOf(r.meta) !== S.epoch) { await reloadAll(); return; }
  list.forEach(c => { L[c] = {}; (r[c] || []).forEach(d => { if (d && validId(d.id)) L[c][d.id] = strip(d); }); mirrorAll(); emit(c); });
}
/* Änderungen aus einem anderen Fenster derselben App übernehmen */
DB.onChange((stores, origin) => { if (origin === 'remote') reload(stores).catch(() => {}); });

export function subscribe(coll, cb){ (subs[coll] = subs[coll] || []).push(cb); }
export function emit(coll, ms){
  const run = () => {
    const out = {};
    Object.keys(L[coll]).forEach(id => { out[id] = Object.assign({}, L[coll][id], {id}); });
    Object.keys(pend).forEach(p => { const i = p.indexOf('/'), c = p.slice(0, i), id = p.slice(i + 1); if (c === coll) out[id] = Object.assign({}, pend[p], {id, _pending: true}); });
    const arr = Object.values(out);
    (subs[coll] || []).forEach(cb => cb(arr));
  };
  if (ms) setTimeout(run, ms); else run();
}
export const emitAll = () => COLLS.forEach(c => emit(c));
export const peek = (coll, id) => L[coll][id] ? clone(L[coll][id]) : null;

/* ---------- Nachfragen ---------- */
export async function askStore(coll, id){
  if (failOf('get', coll + '/' + id)) return {state: 'unclear'};
  try {
    const d = await DB.get(coll, id, 8000);
    return {state: 'known', exists: !!d, data: d ? strip(d) : null};
  } catch (e) { return {state: 'unclear'}; }
}
async function settle(coll, id, test){
  const n = await askStore(coll, id);
  if (n.state !== 'known') return 'unclear';
  return test(n) ? 'ok' : 'fail';
}
const ready = () => S.mode === 'ready' && DB.isOpen();
/* Grund für „nicht bereit“: Speicher lädt noch, oder ein anderes Fenster hat ihn für eine neue Version geschlossen */
const notReady = () => ({code: S.mode === 'ready' && !DB.isOpen() ? 'closed' : 'not_ready'});
const isFinal = e => !!(e && DB.FINAL_CODES.includes(e.code));

/* Schreiben mit Zeitlimit. Hängt der Speicher, bleibt das Ergebnis offen; kommt die Bestätigung
   später doch, wird der Bestand nachgeführt. */
async function run(ops, after, opts){
  const p = DB.commit(ops, opts);
  let slow = false;
  const st = setTimeout(() => { slow = true; if (slowCb) slowCb(true); }, (T() && T().slowMs) || SLOW_MS);
  const endSlow = () => { clearTimeout(st); if (slow && slowCb) slowCb(false); };
  const r = await Promise.race([p.then(res => ({ok: true, res}), e => ({err: DB.mapErr(e)})), wait((T() && T().commitTimeout) || COMMIT_TIMEOUT).then(() => ({timeout: true}))]);
  if (r.timeout) { p.then(res => { endSlow(); after(true, res); }, () => { endSlow(); }); return {timeout: true}; }
  endSlow();
  if (r.ok) after(false, r.res);
  /* Abgewiesen, weil der Bestand ersetzt wurde oder das Motorrad fehlt: neu lesen (auch falls die
     Nachricht aus dem anderen Fenster nicht angekommen ist) */
  if (r.err && (r.err.code === 'stale' || r.err.code === 'orphan')) reloadAll().catch(() => {});
  return r;
}

/* Anlegen oder Ersetzen mit fester ID. files: Dateien, die im selben Vorgang gespeichert werden. */
export function sSetR(coll, id, data, files, opts){
  const ep = epochArg(opts);
  return counted(() => setR(coll, id, data, files, ep));
}
async function setR(coll, id, data, files, ep){
  if (!ready()) { S.lastErr = notReady(); return 'fail'; }
  const path = coll + '/' + id, t = T();
  pend[path] = clone(data); emit(coll);
  if (files && files.length && t && t.uploadDelay) await wait(t.uploadDelay);
  if (t && t.latency) await wait(t.latency);
  const check = n => n.exists && same(n.data, data);
  const f = failOf('set', path);
  if (f && !f.after) { delete pend[path]; emit(coll); S.lastErr = {code: 'unavailable'}; return settle(coll, id, check); }
  const ops = (files || []).map(x => ({store: 'files', type: 'put', value: x})).concat([{store: coll, type: 'put', value: Object.assign(clone(data), {id})}]);
  const r = await run(ops, late => { L[coll][id] = clone(data); delete pend[path]; mirror(coll, id); if (late) emit(coll); }, {epoch: ep});
  if (r.err) { delete pend[path]; emit(coll); S.lastErr = r.err; return isFinal(r.err) ? 'fail' : settle(coll, id, check); }
  if (r.timeout) { S.lastErr = {code: 'timeout'}; return 'unclear'; }
  if (t && t.writes) t.writes.push('set ' + path);
  if (f && f.after) {
    /* Gespeichert, aber die Antwort geht verloren (Testfall) */
    if (f.late) emit(coll, f.lateMs || 80); else { emit(coll); await wait(20); }
    S.lastErr = {code: 'unavailable'};
    return settle(coll, id, check);
  }
  emit(coll);
  return 'ok';
}

/* Felder ändern (oberste Ebene ersetzen). files: im selben Vorgang zu speichernde Dateien. */
export function sUpdateR(coll, id, patch, files, opts){
  const ep = epochArg(opts);
  return counted(() => updateR(coll, id, patch, files, ep));
}
async function updateR(coll, id, patch, files, ep){
  if (!ready()) { S.lastErr = notReady(); return 'fail'; }
  const path = coll + '/' + id, t = T();
  if (files && files.length && t && t.uploadDelay) await wait(t.uploadDelay);
  if (t && t.latency) await wait(t.latency);
  const check = n => n.exists && subOf(patch, n.data);
  const f = failOf('update', path);
  if (f && !f.after) { S.lastErr = {code: 'unavailable'}; return settle(coll, id, check); }
  const ops = (files || []).map(x => ({store: 'files', type: 'put', value: x})).concat([{store: coll, type: 'patch', id, patch: clone(patch)}]);
  const r = await run(ops, late => { if (L[coll][id]) L[coll][id] = Object.assign(clone(L[coll][id]), clone(patch)); mirror(coll, id); if (late) emit(coll); }, {epoch: ep});
  if (r.err) { S.lastErr = r.err; return isFinal(r.err) ? 'fail' : settle(coll, id, check); }
  if (r.timeout) { S.lastErr = {code: 'timeout'}; return 'unclear'; }
  if (t && t.writes) t.writes.push('update ' + path);
  if (f && f.after) {
    if (f.late) emit(coll, f.lateMs || 80); else { emit(coll); await wait(20); }
    S.lastErr = {code: 'unavailable'};
    return settle(coll, id, check);
  }
  emit(coll);
  return 'ok';
}

export function sDelR(coll, id, opts){
  const ep = epochArg(opts);
  return counted(() => delR(coll, id, ep));
}
async function delR(coll, id, ep){
  if (!ready()) { S.lastErr = notReady(); return 'fail'; }
  const path = coll + '/' + id, t = T();
  if (t && t.latency) await wait(t.latency);
  const check = n => !n.exists;
  const f = failOf('delete', path);
  if (f) { S.lastErr = {code: 'unavailable'}; return settle(coll, id, check); }
  const r = await run([{store: coll, type: 'del', id}], late => { delete L[coll][id]; mirror(coll, id); if (late) emit(coll); }, {epoch: ep});
  if (r.err) { S.lastErr = r.err; return isFinal(r.err) ? 'fail' : settle(coll, id, check); }
  if (r.timeout) { S.lastErr = {code: 'timeout'}; return 'unclear'; }
  if (t && t.deletes) t.deletes.push(path);
  emit(coll);
  return 'ok';
}

/* Mehrere Einträge in einem Vorgang (z. B. Mangel erledigt + Reparatur im Logbuch, Motorrad mit
   allen Einträgen entfernen).
   items: [{coll, id, data} | {coll, id, patch} | {coll, id, del: true} | {coll: 'bikes', id, delBike: true}]
   opts.epoch: Bestandskennung des Vorgangs; opts.out: erhält removed (tatsächlich entfernte Einträge) */
export function commitR(items, files, label, opts){
  const ep = epochArg(opts);
  return counted(() => commitRun(items, files, label, ep, opts && opts.out));
}
async function commitRun(items, files, label, ep, out){
  if (!ready()) { S.lastErr = notReady(); return 'fail'; }
  const t = T();
  if (t && t.latency) await wait(t.latency);
  const first = items[0] ? items[0].coll + '/' + items[0].id : '';
  const f = failOf('commit', first);
  const verify = async () => {
    for (const it of items) {
      const n = await askStore(it.coll, it.id);
      if (n.state !== 'known') return 'unclear';
      if ((it.del || it.delBike) ? n.exists : !n.exists) return 'fail';
      if (it.data && !same(n.data, it.data)) return 'fail';
      if (it.patch && !subOf(it.patch, n.data)) return 'fail';
    }
    return 'ok';
  };
  if (f && !f.after) { S.lastErr = {code: 'unavailable'}; return verify(); }
  const ops = (files || []).map(x => ({store: 'files', type: 'put', value: x})).concat(items.map(it =>
    it.delBike ? {store: 'bikes', type: 'delBike', id: it.id}
      : it.del ? {store: it.coll, type: 'del', id: it.id}
      : it.patch ? {store: it.coll, type: 'patch', id: it.id, patch: clone(it.patch)}
      : {store: it.coll, type: 'put', value: Object.assign(clone(it.data), {id: it.id})}));
  const touched = new Set(items.map(it => it.coll));
  if (items.some(it => it.delBike)) COLLS.forEach(c => touched.add(c));
  const r = await run(ops, (late, res) => {
    items.forEach(it => {
      if (it.del || it.delBike) delete L[it.coll][it.id];
      else if (it.patch) { if (L[it.coll][it.id]) L[it.coll][it.id] = Object.assign(clone(L[it.coll][it.id]), clone(it.patch)); }
      else L[it.coll][it.id] = clone(it.data);
      mirror(it.coll, it.id);
    });
    /* Beim Entfernen eines Motorrads: alles, was der Speicher tatsächlich mit entfernt hat */
    ((res && res.removed) || []).forEach(x => { if (x.doc && L[x.store]) { delete L[x.store][x.doc.id]; mirror(x.store, x.doc.id); } });
    if (out) out.removed = (res && res.removed) || [];
    if (late) touched.forEach(c => emit(c));
  }, {epoch: ep});
  if (r.err) { S.lastErr = r.err; return isFinal(r.err) ? 'fail' : verify(); }
  if (r.timeout) { S.lastErr = {code: 'timeout'}; return 'unclear'; }
  if (t && t.writes) t.writes.push('commit ' + (label || first));
  if (f && f.after) { touched.forEach(c => emit(c, f.late ? (f.lateMs || 80) : 0)); S.lastErr = {code: 'unavailable'}; return verify(); }
  touched.forEach(c => emit(c));
  return 'ok';
}

/* Nach einem Ersetzen des ganzen Bestands neu einlesen. Hat sich die Bestandskennung geändert, wird die
   Oberfläche zuerst benachrichtigt (Entwürfe schließen), dann neu gezeichnet. Ergebnis: geändert ja/nein. */
let reloading = null;
export function reloadAll(){
  if (reloading) return reloading.then(() => reloadAll());
  reloading = (async () => {
    const changed = await loadAll();
    Object.keys(pend).forEach(p => delete pend[p]);
    /* Zweistufig: vorher (alte Vorgänge und Entwürfe verwerfen), dann neu zeichnen, dann nachher
       (Formulare an den neuen Bestand und das gewählte Motorrad binden) */
    if (changed && epochCb) epochCb('vorher');
    emitAll();
    if (changed && epochCb) epochCb('nachher');
    return changed;
  })().finally(() => { reloading = null; });
  return reloading;
}

/* Test: Eintrag von „außen“ (anderes Fenster) */
export function installTestHooks(){
  const t = T(); if (!t) return;
  t.external = async (path, d) => {
    const i = path.indexOf('/'), coll = path.slice(0, i), id = path.slice(i + 1);
    await DB.commit([{store: coll, type: 'put', value: Object.assign(clone(d), {id})}]);
    L[coll][id] = clone(d); mirror(coll, id); emit(coll);
  };
  t.dump = async () => { const r = await DB.readRecords(); return r; };
}
