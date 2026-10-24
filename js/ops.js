/* Racebook – Vorgänge (aus Version 8 übernommen, auf den lokalen Speicher angepasst).
   Ein Vorgang hat feste ID, Erfassungszeit (created) und eingefrorene Nutzdaten (payload, files).
   Ein Speicherversuch endet mit 'ok', 'fail' (sicher nicht gespeichert) oder 'unclear'.
   - ok:      Vorgang abgeschlossen.
   - fail:    Vorgang verworfen. Jeder weitere Versuch ist ein neuer Vorgang mit neuer Erfassungszeit.
   - unclear: Gleicher Inhalt erneut abgesendet = Wiederholung mit gleicher ID, Zeit, Nutzdaten und Dateien.
              Abbrechen oder geänderter Inhalt: Der alte Vorgang wird getrennt weiter abgeglichen
              (S.unres) und nie für eine neue Eingabe verwendet.
   Formularabschlüsse nach einem await gelten nur, solange die Formulargeneration (S.gen) gleich ist.
   Jeder Vorgang gehört zu dem Bestand (o.epoch), in dem er begonnen wurde. Wird der Bestand ersetzt,
   weist der Speicher ihn ab; er wird nie in einen neuen Bestand geschrieben.
   Laufende Abläufe (flow) werden gezählt, damit das Einspielen warten kann, bis nichts mehr gespeichert wird.
   Dateien werden nur entfernt, wenn feststeht, dass kein gespeicherter Eintrag, keine Sicherheitskopie
   und kein offener oder ungeklärter Vorgang sie mehr verwendet (geprüft in derselben Transaktion). */
import {S, COLLS, lsSet} from './state.js';
import {uid, same, subOf, validId, fmt} from './util.js';
import {valueAt} from './domain.js';
import {U} from './state.js';
import * as store from './store.js';
import * as DB from './db.js';
import {toast, errText, forgetFile} from './ui.js';
import {refsOf} from './backup.js';

export const hooks = {closeDraft: () => {}, renderSys: () => {}, renderStatus: () => {}, reconcilePending: () => {}};

export const BIKE_FORMS = ['hoursForm', 'doneForm', 'logForm', 'rideForm', 'setupForm', 'defectForm', 'defDoneForm'];
export const bumpGen = k => { S.gen[k] = (S.gen[k] || 0) + 1; };
export function opFor(k, bike, coll, item, sig){
  let o = S.ops[k];
  if (o && o.saving) return o;
  if (o && (o.bike !== bike || o.coll !== coll || (item != null && o.item !== item) || o.sig !== sig)) { parkOp(k); o = null; }
  if (!o) o = S.ops[k] = {op: uid(), created: Date.now(), bike, coll, item: item == null ? null : item, sig, saving: false, state: 'new', payload: null, files: null, label: '', gen: S.gen[k] || 0, epoch: S.epoch || ''};
  return o;
}
/* Laufende Abläufe in diesem Fenster (Speichern samt Foto verkleinern, Schnell-Eintrag, Anleitung, Foto) */
const flows = new Set();
export async function flow(fn){ const tok = {}; flows.add(tok); try { return await fn(); } finally { flows.delete(tok); } }
export const busy = () => flows.size > 0 || store.inflight() > 0;
/* Warten, bis in diesem Fenster nichts mehr gespeichert wird (höchstens ms). Ergebnis: true = frei */
export async function waitIdle(ms){
  const end = Date.now() + (ms == null ? 30000 : ms);
  while (busy()) { if (Date.now() > end) return false; await new Promise(r => setTimeout(r, 50)); }
  return true;
}
/* Offenen Vorgang lösen: ungeklärte Versuche weiter abgleichen, alles andere einfach vergessen */
export function parkOp(k){
  const o = S.ops[k]; if (!o || o.saving) return;
  delete S.ops[k];
  if (o.state === 'unclear' && o.payload && !o.noTrack) addUnres(o.coll, o.op, o.payload, o.label, o.patch, o.epoch);
}
/* Dateien eines Vorgangs, die nicht gespeichert wurden, freigeben (nur wenn ungenutzt) */
export function releasePayload(p){ const ids = payloadFiles(p); if (ids.length) cleanupFiles(ids); }
export async function execOp(k, o, write){
  o.saving = true;
  if (k === 'doneForm') hooks.renderStatus();
  let r = 'fail';
  try { r = await flow(write); } finally { o.saving = false; }
  if (r === 'ok') { if (S.ops[k] === o) delete S.ops[k]; dropUnres(o.coll, o.op); }
  else if (r === 'fail') { if (S.ops[k] === o) delete S.ops[k]; releasePayload(o.payload); if (!o.quietFail) toast(errText(S.lastErr) + ' Es wurde nichts gespeichert.'); }
  else {
    o.state = 'unclear';
    if (S.ops[k] !== o && !o.noTrack) addUnres(o.coll, o.op, o.payload, o.label, o.patch, o.epoch);
    toast('Unklar, ob gespeichert wurde. ' + (S.lastErr && S.lastErr.code === 'timeout' ? 'Der Speicher hat nicht geantwortet; ist Racebook noch in einem anderen Tab offen? Schließ es dort. ' : '') + 'Tipp nochmal auf „Eintragen“, dabei entsteht kein doppelter Eintrag.');
    /* Eine bestätigte Meldung kann schon während des Speicherns angekommen sein: sofort abgleichen */
    reconcile();
  }
  hooks.renderSys();
  return r;
}
/* Ein Vorgang, dessen Eintrag der Speicher bestätigt hat, gilt als erledigt */
export function opDone(o){
  if (!S.loaded[o.coll]) return false;
  if (o.coll === 'bikes') return !!(S.bikes[o.op] && !S.bikes[o.op]._pending && (!o.patch || subOf(o.payload, S.bikes[o.op])));
  /* Änderungs-Vorgang (patch): erledigt, wenn der Eintrag die geänderten Werte trägt */
  if (o.patch) return S[o.coll].some(x => x.id === o.op && !x._pending && subOf(o.payload, x));
  return S[o.coll].some(x => x.id === o.op && !x._pending);
}
export function reconcile(){
  Object.keys(S.ops).forEach(k => {
    const o = S.ops[k]; if (!o || o.saving || o.state !== 'unclear' || !opDone(o)) return;
    delete S.ops[k];
    if (o.gen === (S.gen[k] || 0)) hooks.closeDraft(k);
    toast('Der Eintrag ist gespeichert.');
  });
  const found = S.unres.filter(u => opDone({coll: u.coll, op: u.id, patch: u.patch, payload: u.payload}));
  if (found.length) { found.forEach(u => dropUnres(u.coll, u.id)); toast('Ein früherer, unklarer Speicherversuch ist doch angekommen: ' + found.map(u => u.label || 'Eintrag').join(', ') + '. Prüf bei Bedarf das Logbuch.'); }
  hooks.reconcilePending();
}
/* Ungeklärte frühere Speicherversuche */
function saveUnres(){ lsSet('unresolved', JSON.stringify(S.unres)); }
export function addUnres(coll, id, payload, label, patch, epoch){
  if (!payload) return;
  /* Gehört der Versuch zu einem inzwischen ersetzten Bestand, gibt es nichts mehr abzugleichen */
  if (typeof epoch === 'string' && epoch !== (S.epoch || '')) return;
  S.unres = S.unres.filter(u => !(u.coll === coll && u.id === id)); S.unres.push({coll, id, payload, label: label || 'Eintrag', patch: !!patch, epoch: S.epoch || ''}); saveUnres(); hooks.renderSys();
}
/* Nach dem Ersetzen des Bestands: ungeklärte Versuche des alten Bestands verwerfen. Ergebnis: Anzahl */
export function dropForeignUnres(){
  const n = S.unres.length;
  S.unres = S.unres.filter(u => (u.epoch == null ? '' : u.epoch) === (S.epoch || ''));
  if (S.unres.length !== n) { saveUnres(); hooks.renderSys(); }
  return n - S.unres.length;
}
export function dropUnres(coll, id){ const n = S.unres.length; S.unres = S.unres.filter(u => !(u.coll === coll && u.id === id)); if (S.unres.length !== n) { saveUnres(); hooks.renderSys(); } }
export async function checkUnres(){
  let arrived = 0, lost = 0;
  for (const u of S.unres.slice()) {
    const n = await store.askStore(u.coll, u.id);
    if (n.state !== 'known') continue;
    if (n.exists && (u.patch ? subOf(u.payload, n.data) : same(n.data, u.payload))) { arrived++; dropUnres(u.coll, u.id); }
    else if (!n.exists || u.patch) { lost++; dropUnres(u.coll, u.id); if (!u.patch) releasePayload(u.payload); }
  }
  toast((arrived ? arrived + ' doch gespeichert. ' : '') + (lost ? lost + ' nicht gespeichert, bitte neu eintragen. ' : '') + (S.unres.length ? S.unres.length + ' weiterhin unklar.' : (arrived || lost ? '' : 'Nichts mehr offen.')));
}
/* Eingetippter Stand niedriger als der berechnete an dieser Stelle: nur als bestätigte Korrektur */
export function lowCheck(o, b, date, at){
  if (at == null) return true;
  const pos = valueAt(b.id, date, o.created);
  if (pos != null && at < pos && o.confirmLow !== at) {
    o.confirmLow = at;
    toast('Der Stand ' + fmt(at, 2) + ' ' + U(b) + ' ist niedriger als der berechnete Stand an diesem Tag (' + fmt(pos, 2) + ' ' + U(b) + '). Zum Übernehmen als Korrektur nochmal auf „Eintragen“ tippen.');
    return false;
  }
  return true;
}

/* ---------- Dateien sicher freigeben ---------- */
export function payloadFiles(p){
  if (!p || typeof p !== 'object') return [];
  const ids = [p.photoId, p.thumbId];
  if (p.photo && typeof p.photo === 'object') ids.push(p.photo.id, p.photo.thumbId);
  if (p.manual && typeof p.manual === 'object') ids.push(p.manual.fileId);
  if (Array.isArray(p.photos)) p.photos.forEach(x => { if (x) ids.push(x.id, x.thumbId); });
  return ids.filter(validId);
}
/* Alles, was offene, ungeklärte oder vorbereitete Vorgänge noch brauchen könnten */
export function keepSet(){
  const s = new Set();
  const add = p => payloadFiles(p).forEach(id => s.add(id));
  Object.values(S.ops).forEach(o => { add(o.payload); (o.files || []).forEach(f => s.add(f.id)); });
  S.unres.forEach(u => add(u.payload));
  if (S.pending) S.pending.entries.forEach(x => add(x.payload));
  (S.keepFiles || []).forEach(id => s.add(id));
  return s;
}
export async function cleanupFiles(ids){
  ids = (ids || []).filter(validId);
  if (!ids.length || !DB.isOpen()) return [];
  try {
    const del = await DB.releaseFiles(ids, refsOf, keepSet());
    del.forEach(id => forgetFile(id));
    const t = window.__T; if (t && t.assetsDeleted) t.assetsDeleted.push(...del);
    return del;
  } catch (e) { return []; }
}
/* Verwaiste Dateien (z. B. nach Absturz während des Speicherns) erst nach einer Wartezeit entfernen,
   damit ein gerade laufender Vorgang in einem anderen Fenster nicht gestört wird */
export async function sweepOrphans(minAgeMs){
  if (!DB.isOpen()) return [];
  try {
    const del = await DB.releaseFiles('orphans', refsOf, keepSet(), {olderThan: Date.now() - (minAgeMs == null ? 3600000 : minAgeMs)});
    del.forEach(id => forgetFile(id));
    const t = window.__T; if (t && t.assetsDeleted) t.assetsDeleted.push(...del);
    return del;
  } catch (e) { return []; }
}
export {COLLS};
