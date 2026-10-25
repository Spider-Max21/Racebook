/* Racebook – Speicherschicht: IndexedDB für Einträge, Dateien und Verwaltungsdaten.
   - Jede Änderung läuft in genau einer Transaktion: entweder alles gespeichert oder nichts.
   - Das Schema wird über eine Kette von Migrationen hochgezogen. Scheitert eine Migration,
     bricht der Browser die ganze Aktualisierung ab und der alte Bestand bleibt unverändert.
   - Bestandskennung (epoch): ändert sich bei jedem Ersetzen des ganzen Bestands (Sicherung einspielen,
     Sicherheitskopie zurückholen, Übernahme). Ein Schreibvorgang nennt die Kennung des Bestands, zu dem er
     gehört, und wird in seiner Transaktion abgewiesen, wenn sie nicht mehr stimmt (Fehler 'stale').
     Das gilt für jedes Fenster und für Vorgänge, die vor dem Ersetzen begonnen haben.
   - Beziehungen werden in der Transaktion geprüft: Ein Eintrag, der zu einem Motorrad gehört, wird nur
     gespeichert, wenn es das Motorrad im Speicher gibt (Fehler 'orphan'). Ein Motorrad wird mit allen
     tatsächlich gespeicherten Einträgen entfernt, nicht nur mit denen, die ein Fenster kennt.
   - Bestandsänderungen bei Teilen (Einkauf, Plus/Minus) sind Änderungen um eine Anzahl, keine festen
     Zielwerte: Sie werden in der Transaktion auf den dann gespeicherten Bestand angewendet, jeweils genau
     einmal. Dafür hat jede Änderung eine feste Vorgangskennung; angewendete Kennungen stehen im
     Verwaltungsspeicher (meta, Eintrag 'ops'). Eine Wiederholung derselben Kennung ändert nichts; zwei
     verschiedene Einkäufe in zwei Fenstern zählen beide. Der Eintrag 'ops' gehört zu diesem Gerät und ist
     nicht Teil der Sicherung.
   - Keine Oberfläche, keine Fachlogik. */

export const DB_NAME = 'racebook';
export const DB_VERSION = 3;
export const REC = ['bikes', 'log', 'rides', 'setups', 'parts', 'defects'];
/* Bereiche, deren Einträge immer zu einem Motorrad gehören (Teile: Motorrad oder 'both') */
export const DEP = ['log', 'rides', 'setups', 'defects'];
export const newEpoch = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);

const T = () => (typeof window !== 'undefined' && window.__T) || null;
const wait = ms => new Promise(r => setTimeout(r, ms));

/* Migrationen: Index = Zielversion. Nur hinzufügen, nie bestehende ändern. */
export const MIGRATIONS = [
  null,
  /* 1: erste Fassung (Einträge, Dateien, Verwaltungsdaten) */
  (d) => {
    ['bikes', 'log', 'rides', 'setups', 'parts'].forEach(n => d.createObjectStore(n, {keyPath: 'id'}));
    d.createObjectStore('files', {keyPath: 'id'});
    d.createObjectStore('meta', {keyPath: 'k'});
  },
  /* 2: Mängel und Sicherheitskopie vor dem Ersetzen durch eine Sicherung */
  (d, tx) => {
    d.createObjectStore('defects', {keyPath: 'id'});
    d.createObjectStore('snapshots', {keyPath: 'id'});
    const m = tx.objectStore('meta'), r = m.get('info');
    r.onsuccess = () => { const i = r.result || {k: 'info', created: Date.now(), changeSeq: 0}; i.schema = 2; m.put(i); };
  },
  /* 3: Bestandskennung. Die Daten selbst bleiben unverändert. Ältere offene Fenster werden dabei vom
        Browser getrennt und können ohne Kennung nicht mehr schreiben. */
  (d, tx) => {
    const m = tx.objectStore('meta'), r = m.get('info');
    r.onsuccess = () => { const i = r.result || {k: 'info', created: Date.now(), changeSeq: 0}; i.schema = 3; if (typeof i.epoch !== 'string' || !i.epoch) i.epoch = newEpoch(); m.put(i); };
  }
];

/* Fehler des Browsers in feste Codes übersetzen */
export function mapErr(e){
  if (e && e.code && typeof e.code === 'string' && !(e instanceof Error)) return e;
  const n = e && e.name;
  const code = n === 'QuotaExceededError' ? 'quota_exceeded'
    : n === 'AbortError' ? 'aborted'
    : n === 'InvalidStateError' ? 'closed'
    : n === 'VersionError' ? 'version'
    : n === 'NotFoundError' ? 'not_found'
    : n === 'DataCloneError' ? 'clone'
    : n === 'ConstraintError' ? 'constraint'
    : n === 'SecurityError' ? 'blocked'
    : 'unknown';
  return {code, message: (e && e.message) || ''};
}
/* Diese Fehler bedeuten sicher: nichts gespeichert */
export const FINAL_CODES = ['quota_exceeded', 'aborted', 'closed', 'version', 'not_found', 'clone', 'constraint', 'blocked', 'unknown', 'invalid', 'stale', 'orphan'];

let db = null, name = DB_NAME, chan = null;
const changeCbs = [];
let onVersionChange = null, onBlocked = null;
export const dbName = () => name;
export const isOpen = () => !!db;
export function setHandlers(h){ onVersionChange = h.versionchange || null; onBlocked = h.blocked || null; }
export function onChange(cb){ changeCbs.push(cb); }

export function openDB(dbname){
  name = dbname || DB_NAME;
  return new Promise((resolve, reject) => {
    let req;
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) { reject({code: 'unavailable'}); return; }
      req = indexedDB.open(name, DB_VERSION);
    } catch (e) { reject(mapErr(e)); return; }
    let from = null, failed = null;
    req.onupgradeneeded = ev => {
      const d = req.result, tx = req.transaction;
      from = ev.oldVersion;
      try {
        for (let v = ev.oldVersion + 1; v <= DB_VERSION; v++) {
          const t = T();
          if (t && t.failMigration === v) throw new Error('Testfehler in Migration ' + v);
          MIGRATIONS[v](d, tx, ev.oldVersion);
        }
      } catch (e) { failed = e; try { tx.abort(); } catch (_) {} }
    };
    req.onblocked = () => { if (onBlocked) onBlocked(); };
    req.onsuccess = () => {
      db = req.result;
      db.onversionchange = () => { try { db.close(); } catch (e) {} db = null; if (onVersionChange) onVersionChange(); };
      db.onclose = () => { db = null; };
      try {
        if (chan) chan.close();
        chan = typeof BroadcastChannel === 'function' ? new BroadcastChannel('racebook:' + name) : null;
        if (chan) chan.onmessage = ev => { const s = ev.data && ev.data.stores; if (Array.isArray(s)) changeCbs.forEach(cb => cb(new Set(s), 'remote')); };
      } catch (e) { chan = null; }
      resolve({from, version: db.version});
    };
    req.onerror = () => {
      if (failed) reject({code: 'upgrade_failed', message: String(failed && failed.message || failed)});
      else reject(mapErr(req.error));
    };
  });
}
export function closeDB(){ if (db) { try { db.close(); } catch (e) {} db = null; } if (chan) { try { chan.close(); } catch (e) {} chan = null; } }
export function deleteDB(dbname){
  return new Promise((res, rej) => { const r = indexedDB.deleteDatabase(dbname); r.onsuccess = () => res(true); r.onerror = () => rej(mapErr(r.error)); r.onblocked = () => {}; });
}

const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(mapErr(r.error)); });
const validOp = s => typeof s === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(s);
function txOf(stores, mode){
  if (!db) throw {code: 'closed'};
  try { return db.transaction(stores, mode || 'readonly'); } catch (e) { throw mapErr(e); }
}
/* Lesen mit Zeitlimit: eine hängende Nachfrage gilt als „unklar“, nie als „nicht vorhanden“ */
function withTimeout(p, ms){
  return Promise.race([p, wait(ms).then(() => { throw {code: 'timeout'}; })]);
}
export async function get(store, id, ms){ const tx = txOf([store]); return withTimeout(reqP(tx.objectStore(store).get(id)), ms || 15000); }
export async function getAll(store){ const tx = txOf([store]); return reqP(tx.objectStore(store).getAll()); }
/* Alle Einträge in einem einzigen Lesevorgang: ein stimmiger Stand für Anzeige und Sicherung */
export async function readRecords(stores){
  stores = stores || REC;
  const tx = txOf(stores);
  const out = {};
  await Promise.all(stores.map(s => reqP(tx.objectStore(s).getAll()).then(a => { out[s] = a; })));
  return out;
}
export async function getMeta(k){ return (await get('meta', k)) || null; }
export async function setMeta(rec, epoch){ return commit([{store: 'meta', type: 'put', value: rec}], {bump: false, epoch}); }
export const epochOf = meta => { const i = (meta || []).find(m => m && m.k === 'info'); return (i && typeof i.epoch === 'string') ? i.epoch : ''; };

/* Atomarer Schreibvorgang.
   ops: [{store, type: 'put'|'del'|'patch'|'clear'|'delBike'|'adjust', value | id | patch}]
     delBike: Motorrad samt aller gespeicherten Einträge mit bike === id entfernen (Teile mit 'both' bleiben)
     adjust (nur parts): {id, op, add, low, set} – Anzahl um add ändern (Ergebnis 0 … 99999), bei low danach
       „nachkaufen ab“ mindestens auf den Bestand setzen, set: weitere Felder im selben Schritt (Name, Motorrad,
       nachkaufen ab). op: feste Vorgangskennung; schon angewendet → nichts ändern (Ergebnis dup).
   opts.bump (Standard true): Änderungszähler für die Sicherungserinnerung erhöhen.
   opts.epoch: Bestandskennung, zu der der Vorgang gehört. Stimmt sie nicht mehr, wird nichts geschrieben.
   Ergebnis: {changeSeq, removed: [{store, doc}], adjusted: [{id, doc, dup}]} oder Fehler {code}. */
const LEDGER_MAX = 1000;
const needsBike = o => {
  if (o.type === 'put') return !!o.value && (DEP.includes(o.store) || (o.store === 'parts' && o.value.bike !== 'both'));
  if (o.type === 'patch') return !!o.patch && Object.prototype.hasOwnProperty.call(o.patch, 'bike') && (DEP.includes(o.store) || (o.store === 'parts' && o.patch.bike !== 'both'));
  if (o.type === 'adjust') return !!o.set && Object.prototype.hasOwnProperty.call(o.set, 'bike') && o.set.bike !== 'both';
  return false;
};
const bikeOfOp = o => o.type === 'put' ? o.value.bike : o.type === 'adjust' ? o.set.bike : o.patch.bike;
const clampQty = n => Math.max(0, Math.min(99999, Math.round(Number(n) || 0)));
/* Älteste Kennungen entfernen, damit der Eintrag klein bleibt */
function pruneLedger(led){
  const ids = Object.keys(led.ids);
  if (ids.length <= LEDGER_MAX) return;
  ids.sort((a, b) => led.ids[a] - led.ids[b]).slice(0, ids.length - LEDGER_MAX).forEach(k => { delete led.ids[k]; });
}
export function commit(ops, opts){
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const stores = new Set(ops.map(o => o.store));
    const bump = opts.bump !== false && ops.some(o => REC.includes(o.store));
    const guard = typeof opts.epoch === 'string';
    const adj = ops.filter(o => o.type === 'adjust');
    if (adj.some(o => o.store !== 'parts' || !validOp(o.op) || !Number.isInteger(o.add))) { reject({code: 'invalid', message: 'Ungültige Bestandsänderung'}); return; }
    if (bump || guard || adj.length) stores.add('meta');
    if (ops.some(needsBike)) stores.add('bikes');
    if (ops.some(o => o.type === 'delBike')) REC.forEach(s => stores.add(s));
    let tx;
    try { tx = txOf(Array.from(stores), 'readwrite'); } catch (e) { reject(mapErr(e)); return; }
    const t = T(), result = {removed: [], adjusted: []};
    let injected = null, done = false;
    const fail = e => { if (!injected) injected = e; try { tx.abort(); } catch (_) {} };
    tx.oncomplete = () => {
      done = true;
      resolve(result);
      const touched = Array.from(stores).filter(s => s !== 'meta');
      if (touched.length) {
        changeCbs.forEach(cb => cb(new Set(touched), 'local'));
        try { if (chan) chan.postMessage({stores: touched}); } catch (e) {}
      }
    };
    tx.onabort = () => { if (!done) reject(injected || mapErr(tx.error || {name: 'AbortError'})); };
    tx.onerror = ev => { /* Abbruch folgt; Fehler dort melden */ };
    let n = 0;
    /* Testfall „unterbrochenes Schreiben“: nach n Teilschritten abbrechen (alles wird zurückgenommen) */
    const step = () => {
      if (injected) return false;
      if (t && t.abortAfter != null && n >= t.abortAfter) { t.abortAfter = null; fail({code: 'aborted', message: 'Test: Schreibvorgang unterbrochen'}); return false; }
      n++; return true;
    };
    const run = () => {
      try {
        const putBikes = new Set(ops.filter(o => o.store === 'bikes' && o.type === 'put' && o.value).map(o => o.value.id));
        /* Angewendete Bestandsänderungen zuerst lesen; die Anfragen danach sehen das Ergebnis (gleiche Reihenfolge) */
        let led = null, adjLeft = adj.length;
        if (adj.length) {
          const lr = tx.objectStore('meta').get('ops');
          lr.onsuccess = () => { const v = lr.result; led = (v && v.ids && typeof v.ids === 'object' && !Array.isArray(v.ids)) ? v : {k: 'ops', ids: {}}; };
        }
        for (const o of ops) {
          if (!step()) return;
          const st = tx.objectStore(o.store);
          if (needsBike(o)) {
            /* Beziehung in derselben Transaktion prüfen: gibt es das Motorrad (noch)? */
            const bid = bikeOfOp(o);
            if (!putBikes.has(bid)) {
              const c = tx.objectStore('bikes').count(bid);
              c.onsuccess = () => { if (!c.result) fail({code: 'orphan', message: o.store + ' → Motorrad ' + bid}); };
            }
          }
          if (o.type === 'put') st.put(o.value);
          else if (o.type === 'del') st.delete(o.id);
          else if (o.type === 'clear') st.clear();
          else if (o.type === 'patch') {
            const r = st.get(o.id);
            r.onsuccess = () => {
              if (!r.result) { fail({code: 'not_found', message: o.store + '/' + o.id}); return; }
              st.put(Object.assign(r.result, o.patch));
            };
          } else if (o.type === 'adjust') {
            const r = st.get(o.id);
            r.onsuccess = () => {
              if (injected) return;
              if (led.ids[o.op]) result.adjusted.push({id: o.id, doc: r.result || null, dup: true});
              else if (!r.result) { fail({code: 'not_found', message: o.store + '/' + o.id}); return; }
              else {
                const d = r.result;
                d.qty = clampQty(clampQty(d.qty) + o.add);
                if (o.set) Object.assign(d, o.set);
                if (o.low) d.min = Math.max(clampQty(d.min), d.qty);
                st.put(d); led.ids[o.op] = Date.now();
                result.adjusted.push({id: o.id, doc: d, dup: false});
              }
              if (--adjLeft === 0) { pruneLedger(led); tx.objectStore('meta').put(led); }
            };
          } else if (o.type === 'delBike') {
            const g = st.get(o.id);
            g.onsuccess = () => { if (g.result) result.removed.push({store: 'bikes', doc: g.result}); };
            st.delete(o.id);
            /* Abhängige Einträge aus dem tatsächlich gespeicherten Bestand, nicht aus der Anzeige */
            DEP.concat(['parts']).forEach(s => {
              const ds = tx.objectStore(s), r = ds.getAll();
              r.onsuccess = () => { for (const d of r.result) { if (d && d.bike === o.id) { if (!step()) return; ds.delete(d.id); result.removed.push({store: s, doc: d}); } } };
            });
          } else throw {code: 'invalid', message: 'Unbekannte Operation'};
        }
        if (t && t.quota) {
          if (t.quota !== 'always') t.quota = false;
          fail({code: 'quota_exceeded', message: 'Test: Speicher voll'}); return;
        }
        if (bump) {
          const ms = tx.objectStore('meta'), r = ms.get('info');
          r.onsuccess = () => {
            if (injected) return;
            const i = r.result || {k: 'info', created: Date.now(), changeSeq: 0, schema: DB_VERSION};
            i.changeSeq = (i.changeSeq || 0) + 1; i.lastChange = Date.now();
            ms.put(i); result.changeSeq = i.changeSeq;
          };
        }
      } catch (e) { fail(mapErr(e)); }
    };
    if (guard) {
      /* Bestandskennung zuerst lesen; erst wenn sie stimmt, wird geschrieben */
      const r = tx.objectStore('meta').get('info');
      r.onsuccess = () => {
        const ep = (r.result && typeof r.result.epoch === 'string') ? r.result.epoch : '';
        if (ep !== opts.epoch) { fail({code: 'stale', message: 'Der Bestand wurde inzwischen ersetzt.'}); return; }
        run();
      };
    } else run();
  });
}

/* Dateien atomar prüfen und entfernen: nur, wenn kein gespeicherter Eintrag, keine Sicherheitskopie
   und kein offener Vorgang (keep) sie verwendet. refsOf(records) liefert die verwendeten IDs. */
export function releaseFiles(ids, refsOf, keep, opts){
  opts = opts || {};
  return new Promise((resolve, reject) => {
    let tx;
    try { tx = txOf(REC.concat(['files', 'snapshots']), 'readwrite'); } catch (e) { reject(mapErr(e)); return; }
    const deleted = [], recs = {};
    let snaps = [], files = null;
    tx.oncomplete = () => resolve(deleted);
    tx.onabort = () => reject(mapErr(tx.error || {name: 'AbortError'}));
    let pending = REC.length + 2;
    const step = () => {
      if (--pending) return;
      const used = refsOf(recs);
      snaps.forEach(s => (s.fileIds || []).forEach(id => used.add(id)));
      (keep || new Set()).forEach(id => used.add(id));
      const fs = tx.objectStore('files');
      const cand = ids === 'orphans' ? files.filter(f => !opts.olderThan || (f.created || 0) < opts.olderThan).map(f => f.id) : ids;
      cand.forEach(id => { if (id && !used.has(id)) { fs.delete(id); deleted.push(id); } });
    };
    REC.forEach(s => { const r = tx.objectStore(s).getAll(); r.onsuccess = () => { recs[s] = r.result; step(); }; });
    const rs = tx.objectStore('snapshots').getAll(); rs.onsuccess = () => { snaps = rs.result; step(); };
    if (ids === 'orphans') { const rf = tx.objectStore('files').getAll(); rf.onsuccess = () => { files = rf.result; step(); }; }
    else step();
  });
}

/* Gesamten Bestand ersetzen (Sicherung einspielen, Übernahme): eine einzige Transaktion.
   Vorher wird der bisherige Bestand als Sicherheitskopie abgelegt (sofern vorhanden).
   next: {coll: [docs mit id]}, files: [{id, blob, ...}] */
export function replaceAll(next, files, info){
  return new Promise((resolve, reject) => {
    let tx;
    try { tx = txOf(REC.concat(['files', 'meta', 'snapshots']), 'readwrite'); } catch (e) { reject(mapErr(e)); return; }
    const t = T();
    let injected = null, done = false;
    const res = {snapshot: null};
    tx.oncomplete = () => {
      done = true; resolve(res);
      changeCbs.forEach(cb => cb(new Set(REC.concat(['files'])), 'local'));
      try { if (chan) chan.postMessage({stores: REC.concat(['files'])}); } catch (e) {}
    };
    tx.onabort = () => { if (!done) reject(injected || mapErr(tx.error || {name: 'AbortError'})); };
    const old = {};
    let pending = REC.length + 1, existing = new Map();
    REC.forEach(s => { const r = tx.objectStore(s).getAll(); r.onsuccess = () => { old[s] = r.result; step(); }; });
    const fr = tx.objectStore('files').getAll();
    fr.onsuccess = () => { fr.result.forEach(f => existing.set(f.id, f)); step(); };
    function step(){
      if (--pending) return;
      try {
        /* Gleiche Datei-ID mit anderem Inhalt: abbrechen, nichts überschreiben */
        for (const f of files) {
          if (!f || !(f.blob instanceof Blob)) { injected = {code: 'invalid', message: 'Datei ohne Inhalt'}; tx.abort(); return; }
          const ex = existing.get(f.id);
          if (ex && ex.sha256 && f.sha256 && ex.sha256 !== f.sha256) { injected = {code: 'conflict', message: f.id}; tx.abort(); return; }
        }
        const had = REC.some(s => old[s].length);
        const snapStore = tx.objectStore('snapshots');
        if (had && info.snapshot !== false) {
          const fileIds = info.refsOf ? Array.from(info.refsOf(old)) : [];
          const snap = {id: 'vor-ersetzen', created: Date.now(), reason: info.reason || 'Ersetzen', data: old, fileIds};
          snapStore.put(snap); res.snapshot = {created: snap.created, counts: REC.reduce((a, s) => { a[s] = old[s].length; return a; }, {})};
        } else if (info.dropSnapshot) snapStore.clear();
        let n = 0;
        REC.forEach(s => tx.objectStore(s).clear());
        for (const s of REC) {
          for (const d of (next[s] || [])) {
            if (t && t.abortAfter != null && n >= t.abortAfter) { t.abortAfter = null; injected = {code: 'aborted', message: 'Test: Schreibvorgang unterbrochen'}; tx.abort(); return; }
            tx.objectStore(s).put(d); n++;
          }
        }
        const fs = tx.objectStore('files');
        files.forEach(f => { if (!existing.has(f.id)) fs.put(f); });
        if (t && t.quota) { if (t.quota !== 'always') t.quota = false; injected = {code: 'quota_exceeded', message: 'Test: Speicher voll'}; tx.abort(); return; }
        const ms = tx.objectStore('meta'), r = ms.get('info');
        r.onsuccess = () => {
          const i = r.result || {k: 'info', created: Date.now(), changeSeq: 0, schema: DB_VERSION};
          i.changeSeq = (i.changeSeq || 0) + 1; i.lastChange = Date.now();
          /* Neuer Bestand, neue Kennung: was zum bisherigen Bestand gehört, wird ab jetzt abgewiesen */
          i.epoch = newEpoch(); i.schema = DB_VERSION;
          ms.put(i); res.changeSeq = i.changeSeq; res.epoch = i.epoch;
          if (info.meta) info.meta.forEach(m => ms.put(m));
          if (info.importSeq) {
            /* Eine frisch eingespielte Sicherung gilt als gesichert: Stand = Sicherung */
            const b = {k: 'backup', at: info.importSeq.at, seq: i.changeSeq, name: info.importSeq.name, size: info.importSeq.size, how: 'import', epoch: i.epoch};
            ms.put(b);
          }
        };
      } catch (e) { injected = mapErr(e); try { tx.abort(); } catch (_) {} }
    }
  });
}

/* Sicherheitskopie zurückholen: der aktuelle Stand wird dabei selbst zur Kopie (Tausch). */
export async function getSnapshot(){ return (await get('snapshots', 'vor-ersetzen')) || null; }
export function dropSnapshot(){ return commit([{store: 'snapshots', type: 'del', id: 'vor-ersetzen'}], {bump: false}); }

export async function estimate(){
  try { if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate(); } catch (e) {}
  return null;
}
export async function persisted(){
  try { if (navigator.storage && navigator.storage.persisted) return await navigator.storage.persisted(); } catch (e) {}
  return null;
}
export async function persist(){
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (e) {}
  return null;
}
