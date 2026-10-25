/* Racebook – Daten & Sicherung: Sicherung erstellen und einspielen, Sicherheitskopie, Übernahme der
   bisherigen Version, Speicherzustand, Darstellung, App-Version. */
import {esc, fmtDate, fmt} from '../util.js';
import {S, COLLS, allLoaded, lsGet, lsSet, bikeList} from '../state.js';
import * as DB from '../db.js';
import * as store from '../store.js';
import {buildBackup, markBackup, readBackupFile, readJsonBackup, applyDraft, restoreSnapshot, snapshotInfo,
  readV8Local, removeV8Local, countText, fmtWhen, APP_VERSION} from '../backup.js';
import {sweepOrphans, waitIdle, cleanupFiles, payloadFiles} from '../ops.js';
import {$, toast, errText, arm, fmtSize, icon} from '../ui.js';
import {R} from '../registry.js';

const SRC = {zip: 'ZIP-Sicherung von Racebook', v8: 'Sicherung aus der bisherigen Racebook-App (JSON)', 'v8-local': 'bisherige Racebook-Version auf diesem Gerät'};

/* Verwaltungsdaten neu lesen (Änderungszähler, letzte Sicherung, Sicherheitskopie, Übernahme) */
export async function refreshMeta(){
  if (!DB.isOpen()) return;
  try {
    const [info, backup, mig, last] = await Promise.all([DB.getMeta('info'), DB.getMeta('backup'), DB.getMeta('migration'), DB.getMeta('lastImport')]);
    S.changeSeq = info ? info.changeSeq || 0 : 0;
    /* Eine Sicherung zählt nur für den Bestand, aus dem sie stammt */
    const mine = !backup || !backup.epoch || backup.epoch === (S.epoch || '');
    S.backup = mine ? backup : null; S.backupForeign = !mine;
    S.migration = mig; S.lastImport = last;
    S.snapshot = await snapshotInfo();
  } catch (e) {}
}
export async function refreshStorage(){
  try {
    S.estimate = await DB.estimate();
    S.persisted = await DB.persisted();
    const files = DB.isOpen() ? await DB.getAll('files') : [];
    S.fileStats = {count: files.length, size: files.reduce((a, f) => a + (f.blob ? f.blob.size : 0), 0)};
  } catch (e) {}
}

function backupStatus(){
  const b = S.backup, n = (S.changeSeq || 0) - (b ? b.seq || 0 : 0);
  if (!b) return S.backupForeign
    ? '<p><b>Für den jetzigen Stand gibt es noch keine Sicherung.</b> Die letzte Sicherung stammt aus dem Stand vor dem letzten Einspielen oder Wiederherstellen.</p>'
    : '<p><b>Noch keine Sicherung erstellt.</b> Alle Daten liegen nur in diesem Browser auf diesem Gerät.</p>';
  const how = b.how === 'share' ? 'zum Teilen übergeben' : b.how === 'import' ? 'aus dieser Sicherung eingespielt' : 'zum Herunterladen übergeben';
  return '<dl class="kv"><dt>Letzte Sicherung</dt><dd>' + esc(fmtWhen(b.at)) + '</dd><dt>Datei</dt><dd>' + esc(b.name || '–') + (b.size ? ' (' + fmtSize(b.size) + ')' : '') + '</dd><dt>Vorgang</dt><dd>' + how + '</dd>'
    + '<dt>Seitdem</dt><dd>' + (n > 0 ? '<b class="txt-warn">' + n + (n === 1 ? ' Änderung' : ' Änderungen') + '</b>' : 'keine Änderungen') + '</dd></dl>'
    + '<p class="hint">Racebook weiß nur, dass die Datei erstellt wurde. Ob sie noch in deinen Downloads, deiner Cloud oder auf dem PC liegt, kann die App nicht prüfen.</p>';
}
function previewHTML(d){
  const cur = {}; COLLS.forEach(k => { cur[k] = k === 'bikes' ? bikeList().length : S[k].length; });
  const fileSize = (d.files || []).reduce((a, f) => a + (f.size || 0), 0);
  const empty = !d.counts.bikes;
  return '<div class="preview" id="importPreview"><h3>Sicherung prüfen</h3><dl class="kv">'
    + '<dt>Quelle</dt><dd>' + esc(SRC[d.source] || 'Sicherung') + '</dd>'
    + (d.fileName ? '<dt>Datei</dt><dd>' + esc(d.fileName) + '</dd>' : '')
    + (d.exported ? '<dt>Erstellt</dt><dd>' + esc(fmtWhen(Date.parse(d.exported))) + '</dd>' : '')
    + '<dt>Inhalt</dt><dd>' + esc(countText(d.counts)) + '</dd>'
    + '<dt>Motorräder</dt><dd>' + (d.bikes.length ? esc(d.bikes.join('; ')) : '–') + '</dd>'
    + '<dt>Dateien</dt><dd>' + (d.files || []).length + (fileSize ? ' (' + fmtSize(fileSize) + ')' : '') + '</dd></dl>'
    + (d.orphanCount ? '<p class="warnbox"><b>' + (d.orphanCount === 1 ? 'Ein Eintrag gehört' : d.orphanCount + ' Einträge gehören') + ' zu keinem Motorrad</b> (aus einer früheren Version). Sie werden ohne Motorrad übernommen und danach hier unter „Einträge ohne Motorrad“ zum Zuordnen oder Löschen angezeigt.</p>' : '')
    + (d.missing && d.missing.length ? '<div class="warnbox"><b>Nicht übernommen werden ' + d.missing.length + ' Anhänge:</b><ul class="miss">' + d.missing.map(m => '<li>' + esc(typeof m === 'string' ? m : m.where + ': ' + m.what) + '</li>').join('') + '</ul>'
      + (d.source === 'zip' ? 'Sie fehlten schon beim Erstellen der Sicherung.' : 'Diese Dateien liegen im Speicher der Claude-App und sind nicht in der Sicherung enthalten. Lade sie bei Bedarf hier neu hoch (Technik → Foto, Handbuch → PDF).') + '</div>' : '')
    + (empty ? '<p class="warnbox"><b>Diese Sicherung enthält keine Motorräder.</b> Sie wird nicht eingespielt, damit deine Garage nicht geleert wird.</p>'
      : '<p class="warnbox">Die Sicherung ersetzt alle Daten auf diesem Gerät (jetzt: ' + esc(countText(cur)) + '). ' + (cur.bikes ? 'Der jetzige Stand wird vorher als Sicherheitskopie aufbewahrt und lässt sich wiederherstellen.' : 'Die Garage auf diesem Gerät ist leer.') + '</p>')
    + '<div class="row">' + (cur.bikes && !empty ? '<button class="btn" type="button" id="exportBefore">' + icon('save') + 'Aktuellen Stand vorher herunterladen</button>' : '')
    + (empty ? '' : '<button class="btn primary" type="button" id="importDo"' + (S.importBusy ? ' disabled' : '') + '>' + (S.importBusy ? 'Wird eingespielt …' : (d.source === 'v8-local' ? 'Übernehmen' : 'Alle Daten ersetzen')) + '</button>')
    + '<button class="btn ghost" type="button" id="importCancel"' + (S.importBusy ? ' disabled' : '') + '>Abbrechen</button></div></div>';
}
function migrationHTML(){
  const v = S.v8, m = S.migration;
  if (!v) return '';
  if (v.error) return '<section class="card"><h2>Bisherige Version</h2><p class="warnbox">' + esc(v.error) + ' Es wurde nichts übernommen und nichts verändert.</p><div class="row"><button class="btn" type="button" id="v8Raw">Alte Daten als Datei speichern</button></div></section>';
  if (v.empty) return '';
  if (m && m.verified) return '<section class="card"><h2>Bisherige Version</h2><p>Übernommen und geprüft am ' + esc(fmtWhen(m.at)) + ': ' + esc(countText(m.counts || {})) + '.</p><p class="hint">Die alten Daten liegen weiterhin unverändert in diesem Browser. Entferne sie erst, wenn hier alles stimmt. Die bisherige Einzeldatei-Version zeigt danach eine leere Garage.</p><div class="row"><button class="btn" type="button" id="v8Remove" data-arm="Alte Daten wirklich entfernen?">Alte Daten entfernen</button></div></section>';
  return '<section class="card"><h2>Bisherige Version gefunden</h2><p>In diesem Browser liegen Daten der bisherigen Racebook-Version: ' + esc(countText(v.draft.counts)) + '.</p><p class="hint">Sie werden geprüft, als Vorschau gezeigt und erst nach deiner Bestätigung übernommen. Die alten Daten bleiben unverändert erhalten.</p><div class="row"><button class="btn primary" type="button" id="migrateStart2">Prüfen und übernehmen</button></div></section>';
}
/* ---------- Einträge ohne Motorrad (nur aus früheren Versionen) ---------- */
const OC = ['log', 'rides', 'setups', 'defects', 'parts'];
const OC_NAME = {log: 'Logbuch', rides: 'Fahrt', setups: 'Setup', defects: 'Mangel', parts: 'Teil'};
export function orphanList(){
  const has = id => !!S.bikes[id];
  const out = [];
  OC.forEach(c => S[c].forEach(x => { if (c === 'parts' ? (x.bike !== 'both' && !has(x.bike)) : !has(x.bike)) out.push({coll: c, doc: x}); }));
  return out;
}
function orphanText(c, d){
  if (c === 'log') return (d.kind === 'reading' ? 'Stand' : d.kind === 'note' ? 'Notiz' : 'Wartung') + ' vom ' + fmtDate(d.date) + (d.at != null ? ', Stand ' + fmt(d.at, 2) : '') + (d.taskNames && d.taskNames.length ? ', ' + d.taskNames.join(', ') : '') + (d.extra ? ', ' + d.extra : '') + (d.title ? ', ' + d.title : '');
  if (c === 'rides') return 'Fahrt vom ' + fmtDate(d.date) + (d.amount != null ? ', Dauer bzw. Strecke ' + fmt(d.amount, 2) + ' (Einheit des früheren Motorrads)' : '') + (d.track ? ', ' + d.track : '') + (d.note ? ', ' + d.note : '');
  if (c === 'setups') return 'Setup ' + (d.track || '');
  if (c === 'defects') return 'Mangel „' + d.title + '“ vom ' + fmtDate(d.date);
  return 'Teil ' + (d.name || '');
}
function orphanHTML(){
  const list = orphanList(); if (!list.length) return '';
  const bikes = bikeList();
  const opts = bikes.map(b => '<option value="' + esc(b.id) + '">' + esc(((b.nickname ? b.nickname + ' – ' : '') + b.brand + ' ' + (b.model || '')).trim() + ' (' + (b.unit === 'km' ? 'km' : 'h') + ')') + '</option>').join('');
  return '<section class="card" id="orphanCard"><h2>Einträge ohne Motorrad</h2><p>' + (list.length === 1 ? 'Ein Eintrag gehört' : list.length + ' Einträge gehören') + ' zu keinem Motorrad mehr. Das kann aus einer früheren Version stammen, in der ein Motorrad entfernt wurde, während ein anderes Fenster noch speicherte. Sie bleiben erhalten und sind in jeder Sicherung, bis du entscheidest.</p>'
    + '<p class="hint">Zahlen werden beim Zuordnen nicht umgerechnet. Ordne Einträge nur einem Motorrad mit derselben Einheit (h oder km) zu.</p>'
    + list.map(({coll, doc}) => { const k = coll + '/' + doc.id, sid = 'ob-' + coll + '-' + doc.id;
      return '<div class="orow"><p><b>' + esc(OC_NAME[coll]) + ':</b> ' + esc(orphanText(coll, doc)) + '</p><div class="row">'
        + (bikes.length ? '<label class="sr" for="' + esc(sid) + '">Motorrad für diesen Eintrag</label><select id="' + esc(sid) + '" data-orphanbike="' + esc(k) + '">' + opts + '</select><button class="mini" type="button" data-orphanmove="' + esc(k) + '">Zuordnen</button>' : '')
        + '<button class="mini" type="button" data-orphandel="' + esc(k) + '" data-arm="Endgültig löschen?">Löschen</button></div></div>'; }).join('')
    + '</section>';
}

function storageHTML(){
  const e = S.estimate, fs = S.fileStats || {count: 0, size: 0};
  const pers = S.persisted === true ? 'Ja. Der Browser löscht die Daten nicht von selbst, auch wenn der Speicher knapp wird.'
    : S.persisted === false ? 'Nein. Bei sehr knappem Speicher darf der Browser die Daten löschen. Installiere die App oder tippe auf „Dauerhaft speichern“.'
    : 'Unbekannt (vom Browser nicht unterstützt).';
  const pct = e && e.quota ? Math.round(e.usage / e.quota * 1000) / 10 : null;
  return '<section class="card"><h2>Speicher auf diesem Gerät</h2><dl class="kv">'
    + '<dt>Belegt</dt><dd>' + (e ? fmtSize(e.usage) + ' von etwa ' + fmtSize(e.quota) + (pct != null ? ' (' + String(pct).replace('.', ',') + ' %)' : '') : 'unbekannt') + '</dd>'
    + '<dt>Fotos & PDFs</dt><dd>' + fs.count + ' Dateien, ' + fmtSize(fs.size) + '</dd>'
    + '<dt>Dauerhaft</dt><dd>' + pers + '</dd></dl>'
    + '<div class="row">' + (S.persisted === false ? '<button class="btn" type="button" id="persistBtn">Dauerhaft speichern</button>' : '') + '<button class="btn ghost" type="button" id="sweepBtn">Speicher aufräumen</button></div>'
    + '<p class="warnbox"><b>Wichtig:</b> Racebook speichert alles nur in diesem Browser auf diesem Gerät. Wenn du die Website-Daten löschst (auch über „Browserverlauf löschen“ samt Website-Daten), die App samt Daten entfernst oder das Handy wechselst, sind die Daten weg, außer in einer Sicherung.</p></section>';
}

export function renderData(){
  const el = $('#dataBody'); if (!el) return;
  if (S.mode !== 'ready') { el.innerHTML = '<p class="hint thinking">Speicher wird geladen …</p>'; return; }
  const has = bikeList().length > 0;
  const parts = [];
  parts.push('<section class="card" id="bkCard"><h2>Sicherung</h2>' + backupStatus()
    + '<div class="row"><button class="btn primary" type="button" id="exportBtn"' + (allLoaded() && has && !S.exporting ? '' : ' disabled') + '>' + icon('save') + (S.exporting ? 'Wird erstellt …' : 'Sicherung herunterladen') + '</button>'
    + (navigator.canShare ? '<button class="btn" type="button" id="shareBtn"' + (allLoaded() && has && !S.exporting ? '' : ' disabled') + '>' + icon('share') + 'Sicherung teilen …</button>' : '') + '</div>'
    + '<div id="exportOut">' + (S.shareReady ? '<p class="hint">Sicherung ist bereit: ' + esc(S.shareReady.name) + ' (' + fmtSize(S.shareReady.blob.size) + ').</p><div class="row"><button class="btn primary" type="button" id="shareNow">Jetzt teilen</button></div>' : '') + '</div>'
    + '<p class="hint">Die Sicherung ist eine ZIP-Datei mit allen Einträgen, Fotos und PDFs. Bewahre eine Kopie außerhalb des Handys auf, zum Beispiel in deiner Cloud oder auf dem PC.</p></section>');
  parts.push('<section class="card" id="importCard"><h2>Sicherung einspielen</h2>'
    + (S.importDraft ? previewHTML(S.importDraft)
      : '<p class="hint">ZIP-Sicherung von Racebook oder JSON-Sicherung aus der bisherigen Racebook-App in Claude. Vor dem Einspielen siehst du, was drin ist.</p>'
        + '<div class="f"><label for="importFile">Datei wählen</label><input type="file" id="importFile" accept=".zip,application/zip,application/x-zip-compressed,.json,application/json,text/plain"' + (S.importBusy ? ' disabled' : '') + '></div>'
        + '<div class="f"><label for="importPaste">Oder kopierte Sicherung hier einfügen</label><textarea id="importPaste" class="paste" rows="3" placeholder="{&quot;format&quot;:&quot;racebook&quot; …"></textarea></div>'
        + '<div class="row"><button class="btn" type="button" id="importPasteBtn">Eingefügten Text prüfen</button></div>'
        + (S.importBusy ? '<p class="hint thinking">Sicherung wird geprüft …</p>' : ''))
    + '</section>');
  if (S.snapshot) {
    const sn = S.snapshot;
    parts.push('<section class="card"><h2>Sicherheitskopie</h2><p>Vor dem letzten Ersetzen am ' + esc(fmtWhen(sn.created)) + ' wurde der damalige Stand aufbewahrt: ' + esc(countText(sn.counts)) + ', ' + sn.files + ' Dateien.</p>'
      + '<div class="row"><button class="btn" type="button" id="snapRestore" data-arm="Jetzigen Stand gegen die Kopie tauschen?">Wiederherstellen</button><button class="btn ghost" type="button" id="snapDrop" data-arm="Kopie endgültig löschen?">Kopie löschen</button></div>'
      + '<p class="hint">Beim Wiederherstellen wird der jetzige Stand selbst zur Sicherheitskopie, du kannst also zurücktauschen.</p></section>');
  }
  parts.push(orphanHTML());
  parts.push(migrationHTML());
  parts.push(storageHTML());
  const th = lsGet('theme') || 'system';
  parts.push('<section class="card"><h2>Darstellung</h2><div class="f"><label for="themeSel">Farbschema</label><select id="themeSel"><option value="system"' + (th === 'system' ? ' selected' : '') + '>wie das Gerät</option><option value="dark"' + (th === 'dark' ? ' selected' : '') + '>dunkel</option><option value="light"' + (th === 'light' ? ' selected' : '') + '>hell</option></select></div></section>');
  const sw = 'serviceWorker' in navigator ? (navigator.serviceWorker.controller ? 'bereit, die App funktioniert auch ohne Netz' : 'noch nicht bereit, einmal neu laden') : 'nicht unterstützt';
  parts.push('<section class="card"><h2>App</h2><dl class="kv"><dt>Version</dt><dd>' + APP_VERSION + '</dd><dt>Offline</dt><dd>' + sw + '</dd></dl><div class="row"><button class="btn ghost" type="button" id="updateCheck">Nach Aktualisierung suchen</button><a class="btn ghost" href="#/hilfe" data-nav="help">Hilfe</a></div></section>');
  el.innerHTML = parts.join('');
}

/* ---------- Sicherung erstellen ---------- */
function download(blob, name){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 60000);
}
async function doExport(how){
  if (!allLoaded()) { toast('Einen Moment, es sind noch nicht alle Daten geladen.'); return; }
  if (S.exporting) return;
  S.exporting = true; S.shareReady = null; renderData();
  let b;
  try { b = await buildBackup(); }
  catch (e) { toast('Die Sicherung konnte nicht erstellt werden: ' + (e && e.message || errText(e))); return; }
  finally { S.exporting = false; renderData(); }
  if (how === 'share') { S.shareReady = b; renderData(); const s = $('#shareNow'); if (s) s.focus(); return; }
  download(b.blob, b.name);
  try { await markBackup(b, 'download'); } catch (e) {}
  await refreshMeta();
  toast('Sicherung erstellt (' + fmtSize(b.blob.size) + ', ' + b.fileCount + ' Dateien) und zum Herunterladen übergeben. Prüf, ob sie in deinen Downloads angekommen ist.' + (b.missing.length ? ' ' + b.missing.length + ' Anhänge fehlten im Speicher.' : ''));
  R.renderAll();
}
async function shareNow(){
  const b = S.shareReady; if (!b) return;
  const file = new File([b.blob], b.name, {type: 'application/zip'});
  if (!navigator.canShare || !navigator.canShare({files: [file]})) { toast('Teilen von Dateien geht auf diesem Gerät nicht. Nutz „Sicherung herunterladen“.'); return; }
  try { await navigator.share({files: [file], title: 'Racebook-Sicherung'}); }
  catch (e) { toast(e && e.name === 'AbortError' ? 'Teilen abgebrochen. Es wurde keine Sicherung vermerkt.' : 'Teilen hat nicht geklappt.'); return; }
  S.shareReady = null;
  try { await markBackup(b, 'share'); } catch (e) {}
  await refreshMeta();
  toast('Sicherung zum Teilen übergeben.');
  R.renderAll();
}

/* ---------- Einspielen ---------- */
async function prepareFile(file){
  S.importBusy = true; renderData();
  try { S.importDraft = await readBackupFile(file); }
  catch (e) { toast((e && e.message || 'Die Datei ist keine gültige Sicherung.') + ' Deine Daten bleiben unverändert.'); }
  finally { S.importBusy = false; renderData(); }
  const p = $('#importPreview'); if (p) p.scrollIntoView({block: 'start', behavior: 'smooth'});
}
function preparePaste(text){
  try { S.importDraft = readJsonBackup(text, 'eingefügter Text'); }
  catch (e) { toast(e.message + ' Deine Daten bleiben unverändert.'); }
  renderData();
}
export function startMigration(){
  S.v8 = readV8Local();
  if (S.v8 && S.v8.draft) S.importDraft = S.v8.draft;
  else if (S.v8 && S.v8.error) toast(S.v8.error);
  else toast('Es wurden keine Daten der bisherigen Version gefunden.');
  R.navigate({page: 'data'});
  setTimeout(() => { const p = $('#importPreview'); if (p) p.scrollIntoView({block: 'start'}); }, 50);
}
/* Bestand ersetzen (Einspielen, Wiederherstellen). Zuerst warten, bis in diesem Fenster nichts mehr
   gespeichert wird: was schon läuft, landet so noch im bisherigen Bestand (und damit in der Sicherheitskopie).
   Was danach noch aus einem älteren Vorgang ankommt, aus diesem oder einem anderen Fenster, weist der
   Speicher ab, weil die Bestandskennung nicht mehr stimmt. */
async function replaceGuarded(kind, fn){
  if (!(await waitIdle(30000))) { const e = new Error('Es wird gerade noch gespeichert. Versuch es in einem Moment noch einmal.'); e.user = true; throw e; }
  S.replacing = kind;
  try { return await fn(); }
  finally {
    /* Neu lesen, solange „dieses Fenster ersetzt“ gilt: die Oberfläche schließt alte Entwürfe ohne Fremdhinweis */
    try { await store.reloadAll(); } catch (e) {}
    S.replacing = null;
  }
}
const resetNote = () => (S.lastReset && S.lastReset.drafts ? ' Offene Eingaben wurden geschlossen, weil sie zum vorherigen Stand gehörten.' : '')
  + (S.lastReset && S.lastReset.unres ? ' Ungeklärte Speicherversuche des vorherigen Stands sind damit hinfällig.' : '');
async function doImport(){
  const d = S.importDraft; if (!d || S.importBusy) return;
  if (!d.counts.bikes) { toast('Diese Sicherung enthält keine Motorräder und wird nicht eingespielt.'); return; }
  S.importBusy = true; S.lastReset = null; renderData();
  try { await replaceGuarded('import', () => applyDraft(d, d.source === 'v8-local' ? 'Übernahme der bisherigen Version' : 'Sicherung eingespielt')); }
  catch (e) {
    S.importBusy = false;
    toast((e && e.user ? e.message : errText(e)) + (e && e.committed ? resetNote() : ' Deine bisherigen Daten sind unverändert.'));
    await refreshMeta(); R.renderAll();
    return;
  }
  S.importDraft = null; S.importBusy = false;
  await refreshMeta();
  sweepOrphans(0);
  toast((d.source === 'v8-local' ? 'Übernommen und geprüft: ' : 'Sicherung eingespielt und geprüft: ') + countText(d.counts) + '.' + (d.orphanCount ? ' Dazu ' + d.orphanCount + ' Einträge ohne Motorrad, siehe „Daten & Sicherung“.' : '') + (d.missing && d.missing.length ? ' ' + d.missing.length + ' Anhänge fehlen, siehe Liste.' : '') + resetNote());
  R.navigate({page: 'home'}, {replace: true});
}

export async function onClick(t){
  if (t.id === 'exportBtn' || t.id === 'exportBefore') { await doExport('download'); return true; }
  if (t.id === 'shareBtn') { await doExport('share'); return true; }
  if (t.id === 'shareNow') { await shareNow(); return true; }
  if (t.id === 'importDo') { await doImport(); return true; }
  if (t.id === 'importCancel') { S.importDraft = null; renderData(); return true; }
  if (t.id === 'importPasteBtn') { const v = $('#importPaste').value.trim(); if (v) preparePaste(v); return true; }
  if (t.id === 'migrateStart2') { startMigration(); return true; }
  if (t.id === 'snapRestore') {
    if (!arm(t)) return true;
    if (S.importBusy) return true;
    S.importBusy = true; S.lastReset = null; renderData();
    try { await replaceGuarded('restore', () => restoreSnapshot()); toast('Sicherheitskopie wiederhergestellt. Der vorherige Stand ist jetzt die Kopie.' + resetNote()); }
    catch (e) { toast((e && e.user ? e.message : errText(e)) + (e && e.committed ? resetNote() : ' Es wurde nichts verändert.')); }
    S.importBusy = false;
    await refreshMeta(); R.renderAll();
    return true;
  }
  if (t.dataset.orphanmove) {
    const [coll, id] = t.dataset.orphanmove.split('/'), sel = document.querySelector('[data-orphanbike="' + coll + '/' + id + '"]');
    const bid = sel && sel.value; if (!bid || !S.bikes[bid]) return true;
    /* Zuordnen: Motorrad wird in der Transaktion geprüft */
    const r = await store.commitR([{coll, id, patch: {bike: bid}}], null, 'orphan-move');
    toast(r === 'ok' ? 'Eintrag zugeordnet.' : r === 'unclear' ? 'Unklar, ob gespeichert wurde. Prüf es gleich nochmal.' : errText(S.lastErr) + ' Es wurde nichts geändert.');
    R.renderAll();
    return true;
  }
  if (t.dataset.orphandel) {
    if (!arm(t)) return true;
    const [coll, id] = t.dataset.orphandel.split('/'), doc = (S[coll] || []).find(x => x.id === id);
    const r = await store.sDelR(coll, id);
    if (r === 'ok') { if (doc) cleanupFiles(payloadFiles(doc)); toast('Eintrag gelöscht.'); }
    else toast(r === 'unclear' ? 'Unklar, ob gelöscht wurde. Prüf es gleich nochmal.' : errText(S.lastErr));
    R.renderAll();
    return true;
  }
  if (t.id === 'snapDrop') {
    if (!arm(t)) return true;
    try { await DB.dropSnapshot(); await sweepOrphans(0); toast('Sicherheitskopie gelöscht.'); } catch (e) { toast(errText(e)); }
    await refreshMeta(); await refreshStorage(); renderData();
    return true;
  }
  if (t.id === 'v8Remove') {
    if (!arm(t)) return true;
    if (!(S.migration && S.migration.verified)) { toast('Erst nach bestätigter Übernahme möglich.'); return true; }
    if (removeV8Local()) { S.v8 = null; toast('Alte Daten entfernt.'); } else toast('Die alten Daten konnten nicht entfernt werden.');
    renderData();
    return true;
  }
  if (t.id === 'v8Raw') { const v = S.v8; if (v && v.raw) download(new Blob([v.raw], {type: 'application/json'}), 'racebook-alte-daten.json'); return true; }
  if (t.id === 'persistBtn') { const r = await DB.persist(); await refreshStorage(); toast(r ? 'Der Browser speichert die Daten jetzt dauerhaft.' : 'Der Browser hat abgelehnt. Installiere die App auf dem Startbildschirm und versuch es dann noch einmal.'); renderData(); return true; }
  if (t.id === 'sweepBtn') { const del = await sweepOrphans(0); await refreshStorage(); toast(del.length ? del.length + ' nicht mehr verwendete Dateien entfernt.' : 'Nichts aufzuräumen.'); renderData(); return true; }
  if (t.id === 'updateCheck') { R.checkUpdate(); return true; }
  return false;
}
export function onChange(t){
  if (t.id === 'importFile' && t.files && t.files[0]) { const f = t.files[0]; t.value = ''; prepareFile(f); return true; }
  if (t.id === 'themeSel') { lsSet('theme', t.value); R.applyTheme(); return true; }
  return false;
}
