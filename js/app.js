/* Racebook – Start, Navigation, Speicher verbinden, Ereignisse verteilen, Aktualisierung der App.
   Aufbau:  util/domain (Fachlogik) · db/store (Speicher) · ops (Vorgänge) · views/* (Oberfläche). */
import {validId} from './util.js';
import {S, COLLS, lsGet, lsSet, bikeList, curBike} from './state.js';
import {cleanDoc, derive} from './domain.js';
import * as DB from './db.js';
import * as store from './store.js';
import {hooks, reconcile, checkUnres, sweepOrphans, bumpGen, parkOp, dropForeignUnres} from './ops.js';
import {$, $$, toast, VErr, showVErr, fileUrl, parseRoute, routeHash, icon, SECTIONS} from './ui.js';
import {readV8Local} from './backup.js';
import {R} from './registry.js';
import * as bike from './views/bike.js';
import * as defects from './views/defects.js';
import * as home from './views/home.js';
import * as data from './views/data.js';

/* ---------- Darstellung ---------- */
function applyTheme(){
  const t = lsGet('theme');
  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  const dark = t === 'dark' || (t !== 'light' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = dark ? '#16191D' : '#2A2F35';
}
applyTheme();

/* ---------- Seiten ---------- */
const PAGES = ['home', 'bike', 'data', 'help', 'add', 'error'];
function showPage(p){
  PAGES.forEach(x => { const el = $('#v-' + x); if (el) el.hidden = x !== p; });
  $('#tabs').hidden = p !== 'bike';
  document.body.dataset.page = p;
}
/* Kopfleiste und Bereichsleiste an die tatsächliche Schrift anpassen. Geräte haben unterschiedliche Schriften
   (nicht überall gibt es eine schmale Variante); was nicht passt, wird stufenweise kompakter, statt abgeschnitten
   zu werden oder seitlich überzustehen: Sicherungs-Knopf nur mit Symbol, Kurzform je Bereich, kleinere Schrift. */
const over = el => el.scrollWidth > el.clientWidth + 0.5;
/* Beschriftung abgeschnitten? Genau gemessen: scrollWidth rundet auf ganze Pixel und übersieht, dass ein Text
   um Bruchteile eines Pixels zu breit ist (z. B. „Handbuch“ bei 412 px); der Browser zeigt dann trotzdem „…“. */
const cut = el => { if (over(el)) return true; try { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().width > el.getBoundingClientRect().width + 0.01; } catch (e) { return false; } };
function fitBars(){
  const bar = $('.appbar-in'), chip = $('#backupChip');
  if (bar) {
    bar.classList.remove('fit-tight');
    if (over(bar) && chip && !chip.hidden && !chip.classList.contains('compact')) chip.classList.add('compact');
    if (over(bar)) bar.classList.add('fit-tight');
  }
  const box = $('#tabsIn');
  if (!box || $('#tabs').hidden) return;
  box.classList.remove('fit-1', 'fit-2', 'fit-3');
  const tabs = $$('.tab', box);
  tabs.forEach(t => t.classList.remove('short'));
  const label = t => $$('span', t).find(s => s.offsetWidth > 0);
  tabs.forEach(t => { const l = label(t); if (l && cut(l) && t.querySelector('.l-short')) t.classList.add('short'); });
  for (const k of ['fit-1', 'fit-2', 'fit-3']) {
    if (!tabs.some(t => { const l = label(t); return l && cut(l); })) break;
    box.classList.remove('fit-1', 'fit-2', 'fit-3'); box.classList.add(k);
  }
}
let fitQ = 0;
const fitSoon = () => { cancelAnimationFrame(fitQ); fitQ = requestAnimationFrame(fitBars); };
window.addEventListener('resize', fitSoon);
try { if (document.fonts) { document.fonts.ready.then(fitSoon); document.fonts.addEventListener('loadingdone', fitSoon); } } catch (e) {}

function renderChrome(){
  const r = R.route, p = S.mode === 'error' ? 'error' : r.page;
  const b = curBike();
  $('#backBtn').hidden = p === 'home' || p === 'error';
  /* Auf der Motorrad-Seite heißt der Knopf „Garage“ und führt zur Übersicht aller Motorräder */
  const toG = p === 'bike', back = $('#backBtn');
  back.classList.toggle('labeled', toG); $('.back-l', back).hidden = !toG;
  back.setAttribute('aria-label', toG ? 'Garage: alle Motorräder' : 'Zurück');
  $('#homeLink').hidden = p !== 'home' && p !== 'error';
  const title = $('#barTitle');
  const t = p === 'bike' && b ? bike.titleOf(b) : p === 'data' ? 'Daten & Sicherung' : p === 'help' ? 'Hilfe' : p === 'add' ? 'Motorrad hinzufügen' : '';
  title.hidden = !t;
  title.innerHTML = t ? '<span class="bt-main">' + escHTML(t) + '</span>' + (p === 'bike' && b && b.nickname ? '<span class="bt-sub">' + escHTML((b.brand + ' ' + (b.model || '')).trim()) + '</span>' : '') : '';
  const chip = $('#backupChip');
  const has = bikeList().length > 0 && S.mode === 'ready';
  chip.hidden = !has || p === 'data';
  if (has) {
    const n = (S.changeSeq || 0) - (S.backup ? S.backup.seq || 0 : 0);
    const label = !S.backup ? 'Nicht gesichert' : n > 0 ? n + (n === 1 ? ' Änderung' : ' Änderungen') : 'Gesichert';
    chip.className = 'bchip' + (!S.backup || n > 0 ? ' due' : '') + (p === 'home' ? '' : ' compact');
    chip.innerHTML = icon('save') + '<span>' + label + '</span>';
    chip.setAttribute('aria-label', 'Daten und Sicherung: ' + (!S.backup ? 'noch keine Sicherung erstellt' : n > 0 ? n + ' Änderungen seit der letzten Sicherung' : 'seit der letzten Sicherung keine Änderungen'));
  }
  if (p === 'bike') $$('.tab').forEach(x => x.setAttribute('aria-current', x.dataset.v === S.section ? 'page' : 'false'));
  document.title = t ? t + ' – Racebook' : 'Racebook';
  fitBars();
}
const escHTML = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

function renderError(){
  const e = S.err || {}, el = $('#errorBody');
  const msg = {
    unavailable: 'Racebook kann in diesem Browser keine Daten speichern. Das passiert zum Beispiel in manchen privaten Fenstern oder wenn Website-Daten blockiert sind. Es wurde nichts verändert.',
    blocked: 'Der Browser blockiert den Speicher für diese Seite. Prüf die Einstellungen für Website-Daten. Es wurde nichts verändert.',
    version: 'Die Daten in diesem Browser stammen von einer neueren Racebook-Version. Bitte lade die Seite neu, damit die aktuelle Version startet. Deine Daten wurden nicht verändert.',
    upgrade_failed: 'Die Aktualisierung des Speichers ist fehlgeschlagen. Deine Daten sind unverändert im bisherigen Format erhalten. Lade die Seite neu. Tritt der Fehler wieder auf, installiere die App nicht neu und lösch keine Website-Daten, sondern melde den Fehler.',
    closed: 'Racebook wurde in einem anderen Fenster aktualisiert. Lade diese Seite neu, bevor du weiter einträgst.',
    quota_exceeded: 'Der Speicher dieses Geräts ist voll, Racebook konnte nicht starten. Gib Speicher frei und lade neu.'
  }[e.code] || 'Der Speicher konnte nicht geöffnet werden (' + escHTML(e.code || 'unbekannt') + '). Es wurde nichts verändert. Lade die Seite neu.';
  el.innerHTML = '<div class="card"><h2>Racebook kann gerade nicht starten</h2><p>' + msg + '</p><div class="row"><button class="btn primary" type="button" id="reloadBtn">Neu laden</button></div></div>';
}

function renderSys(){
  const el = $('#sysMsg'), parts = [];
  if (S.update) parts.push('<p><b>Eine neue Version von Racebook ist bereit.</b> Deine Daten bleiben dabei erhalten.</p><button class="mini" type="button" id="updateBtn">Jetzt aktualisieren</button>');
  if (S.otherTab) parts.push('<p><b>Racebook wurde in einem anderen Fenster aktualisiert.</b> Lade diese Seite neu, bevor du weiter einträgst.</p><button class="mini" type="button" id="reloadBtn">Neu laden</button>');
  if (S.slowWrite) parts.push('<p><b>Speichern dauert ungewöhnlich lange.</b> Vermutlich ist Racebook noch in einem anderen Tab oder Fenster offen, zum Beispiel in Chrome, und blockiert den Speicher. Schließ Racebook dort, dann geht es hier von selbst weiter.</p>');
  if (S.blocked) parts.push('<p><b>Racebook wird aktualisiert.</b> Bitte schließ andere geöffnete Racebook-Fenster oder -Tabs, dann geht es weiter.</p>');
  if (S.replaced) parts.push('<p><b>Die Daten wurden in einem anderen Fenster ersetzt</b> (' + (S.replaced.how || 'Sicherung eingespielt oder Sicherheitskopie zurückgeholt') + '). Du siehst jetzt den neuen Stand.'
    + (S.replaced.drafts ? ' Offene Eingaben in diesem Fenster wurden geschlossen, weil sie zum vorherigen Stand gehörten.' : '') + (S.replaced.unres ? ' Ungeklärte Speicherversuche des vorherigen Stands sind damit hinfällig.' : '') + '</p><button class="mini" type="button" id="replacedOk">Verstanden</button>');
  const orph = orphanCount();
  if (orph && R.route.page !== 'data') parts.push('<p><b>' + (orph === 1 ? 'Ein Eintrag gehört' : orph + ' Einträge gehören') + ' zu keinem Motorrad.</b> Unter „Daten &amp; Sicherung“ kannst du sie einem Motorrad zuordnen oder löschen.</p><button class="mini" type="button" data-nav="data">Ansehen</button>');
  if (S.unres.length) parts.push('<p><b>' + (S.unres.length === 1 ? 'Ein früherer Speicherversuch ist' : S.unres.length + ' frühere Speicherversuche sind') + ' ungeklärt:</b> ' + escHTML(S.unres.map(u => u.label).join(', ')) + '. Sobald der Speicher sie bestätigt, verschwindet dieser Hinweis von selbst.</p><button class="mini" type="button" id="unresCheck">Jetzt prüfen</button>');
  el.innerHTML = parts.map(p => '<div class="sys-row">' + p + '</div>').join('');
  el.hidden = !parts.length;
}

/* Einträge, deren Motorrad es nicht gibt (nur aus früheren Versionen; neue entstehen nicht mehr) */
function orphanCount(){
  if (S.mode !== 'ready') return 0;
  const has = id => !!S.bikes[id];
  return ['log', 'rides', 'setups', 'defects'].reduce((n, c) => n + S[c].filter(x => !has(x.bike)).length, 0) + S.parts.filter(p => p.bike !== 'both' && !has(p.bike)).length;
}

/* ---------- Bestand ersetzt (Sicherung eingespielt, Sicherheitskopie zurückgeholt, anderes Fenster) ----------
   Alles, was zum vorherigen Bestand gehört, wird hier geschlossen: Formulare, Entwürfe, Schnell-Eintrag,
   Bearbeiten-Ansichten, offene Vorgänge. Laufende Schreibvorgänge des alten Bestands weist der Speicher ab.
   Auch bei gleichen Motorrad-IDs bleibt nichts Altes zum erneuten Speichern stehen. */
function openDraftCount(){
  let n = 0;
  const open = id => { const d = document.getElementById(id); return !!(d && d.open); };
  if (!$('#hoursForm').hidden) n++;
  if (S.doneOpen) n++;
  if (open('logDetails') || open('rideDetails') || open('setupDetails') || open('defectDetails')) n++;
  if (S.defEdit || S.defDone || S.pending || S.adding || S.addPhoto) n++;
  if (Object.values(S.editing || {}).some(Boolean)) n++;
  if ($('#pName') && $('#pName').value) n++;
  return n;
}
let resetInfo = null;
function onDatasetChange(phase){
  if (phase === 'vorher') {
    resetInfo = {drafts: openDraftCount(), local: !!S.replacing};
    S.ops = {};
    if (S.pending) S.pending = null;
    const q = $('#quickText'); if (q) q.value = '';
    bike.renderQuick();
    /* Alle Generationen erhöhen: späte Abschlüsse alter Vorgänge schließen keine neuen Entwürfe */
    Object.keys(S.gen).forEach(k => bumpGen(k));
    bike.closeDraft('partForm');
    if (S.adding || S.addPhoto) bike.closeDraft('addBikeForm');
    S.shareReady = null; S.oemDraft = null; S.editing = {};
    resetInfo.unres = dropForeignUnres();
    return;
  }
  /* nachher: der neue Bestand ist geladen */
  const info = resetInfo || {drafts: 0, unres: 0, local: false}; resetInfo = null;
  if (!S.bikes[S.bike]) { const b = bikeList()[0]; S.bike = b ? b.id : ''; lsSet('bike', S.bike); }
  bike.resetBikeForms();
  S.lastReset = {drafts: info.drafts, unres: info.unres};
  if (!info.local) S.replaced = {drafts: info.drafts, unres: info.unres, how: ''};
  if (R.route.page === 'add') navigate({page: 'home'}, {replace: true});
  renderSys();
}
store.onEpochChange(onDatasetChange);
let slowN = 0;
store.onSlowWrite(on => { slowN = Math.max(0, slowN + (on ? 1 : -1)); S.slowWrite = slowN > 0; renderSys(); });

function renderAll(){
  derive();
  if (S.mode === 'error') { showPage('error'); renderError(); renderChrome(); renderSys(); return; }
  renderChrome(); renderSys();
  const p = R.route.page;
  if (p === 'home') home.renderHome();
  if (p === 'bike' && curBike()) { bike.renderBike(); defects.renderDefects(); }
  if (p === 'data') data.renderData();
  if (p === 'add') bike.renderAddBike();
}

/* ---------- Navigation (Zurück-Geste von Android führt zur Übersicht) ---------- */
function applyRoute(r){
  if (S.mode === 'ready' && r.page === 'bike') {
    if (!S.bikes[r.bike]) { toast('Dieses Motorrad gibt es auf diesem Gerät nicht.'); navigate({page: 'home'}, {replace: true}); return; }
    bike.setBike(r.bike);
    S.section = r.section;
  }
  if (S.mode === 'ready' && r.page === 'add' && R.route.page !== 'add') { S.adding = true; const el = $('#addBike'); if (el) el.innerHTML = ''; }
  const changed = R.route.page !== r.page || R.route.bike !== r.bike;
  R.route = r;
  showPage(S.mode === 'error' ? 'error' : r.page);
  if (r.page === 'bike') { $$('#v-bike .sub').forEach(s => { s.hidden = s.id !== 'v-' + r.section; }); }
  if (r.page === 'data') { data.refreshStorage().then(() => { if (R.route.page === 'data') data.renderData(); }); }
  renderAll();
  if (changed) window.scrollTo(0, 0);
}
function navigate(r, opts){
  opts = opts || {};
  const h = routeHash(r);
  const depth = (history.state && history.state.rb) || 0;
  try {
    if (opts.replace) history.replaceState({rb: depth}, '', h);
    else if (location.hash !== h) history.pushState({rb: depth + 1}, '', h);
  } catch (e) {}
  if (opts.silent) { R.route = r; return; }
  applyRoute(r);
}
/* Zur Garage (Übersicht aller Motorräder). Sie liegt immer ganz unten im Verlauf (rb 0, siehe Start); dorthin
   zurückspringen, damit die Zurück-Geste danach nicht wieder in ein Motorrad führt. */
function toGarage(){
  const depth = (history.state && history.state.rb) || 0;
  if (depth > 0) { try { history.go(-depth); return; } catch (e) {} }
  navigate({page: 'home'}, {replace: true});
}
function goBack(){
  if (history.state && history.state.rb > 0) history.back();
  else navigate({page: 'home'}, {replace: true});
}
window.addEventListener('popstate', () => { const r = parseRoute(); if (routeHash(r) !== routeHash(R.route)) applyRoute(r); });
window.addEventListener('hashchange', () => { const r = parseRoute(); if (routeHash(r) !== routeHash(R.route)) applyRoute(r); });

function openForm(detailsId, focusId){
  const d = document.getElementById(detailsId); if (d) d.open = true;
  bike.setSection(S.section, detailsId);
  setTimeout(() => { const f = document.getElementById(focusId); if (f) f.focus({preventScroll: true}); }, 60);
}

/* ---------- Registrieren ---------- */
Object.assign(R, {
  renderAll, renderSys, navigate, applyTheme, openForm,
  setBike: id => { if (bike.setBike(id)) navigate({page: 'bike', bike: id, section: S.section || 'status'}); },
  closeDraft: k => bike.closeDraft(k),
  closeDefectDraft: k => defects.closeDefectDraft(k),
  resetDefectForms: () => defects.resetDefectForms(),
  openDefectForm: () => defects.openDefectForm(),
  startMigration: () => data.startMigration(),
  checkUpdate: () => checkUpdate()
});
Object.assign(hooks, {
  closeDraft: k => bike.closeDraft(k),
  renderSys, renderStatus: () => { if (R.route.page === 'bike') bike.renderStatus(); },
  reconcilePending: () => bike.reconcilePending()
});

/* ---------- Daten aus dem Speicher übernehmen ---------- */
const byDateDesc = (a, b) => (b.date || '').localeCompare(a.date || '') || ((b.created || 0) - (a.created || 0));
function onData(key, arr){
  const clean = [];
  arr.forEach(x => { if (!x || !validId(x.id)) return; const c = cleanDoc(key, x, false, ''); if (!c) return; if (key !== 'bikes' && key !== 'parts' && !c.bike) return; c.id = x.id; c._pending = x._pending === true; clean.push(c); });
  if (key === 'log' || key === 'rides') clean.sort(byDateDesc);
  if (key === 'bikes') {
    S.bikes = {}; clean.forEach(x => { S.bikes[x.id] = x; });
    /* Motorrad wurde (z. B. in einem anderen Fenster) entfernt: zurück zur Übersicht */
    if (S.loaded.bikes && R.route.page === 'bike' && !S.bikes[R.route.bike]) { S.loaded.bikes = true; setTimeout(() => { if (R.route.page === 'bike' && !S.bikes[R.route.bike]) navigate({page: 'home'}, {replace: true}); }, 0); }
  } else S[key] = clean;
  S.loaded[key] = true;
  reconcile();
  scheduleRender();
}
let renderQ = 0;
function scheduleRender(){ if (renderQ) return; renderQ = requestAnimationFrame(() => { renderQ = 0; renderAll(); }); }
let metaQ = 0;
DB.onChange(() => { clearTimeout(metaQ); metaQ = setTimeout(() => data.refreshMeta().then(scheduleRender), 30); });

/* ---------- Ereignisse ---------- */
document.addEventListener('click', async e => {
  const t = e.target.closest('button, a[data-bikecard], a[data-nav], a[data-filehref], a[data-skip]'); if (!t) return;
  if (t.dataset.skip) { e.preventDefault(); $('#main').focus(); return; }
  if (t.matches('a[data-filehref]')) { if (t.getAttribute('aria-disabled') === 'true') e.preventDefault(); return; }
  if (t.dataset.nav) { e.preventDefault(); navigate({page: t.dataset.nav}); return; }
  if (t.disabled) return;
  if (t.id === 'backBtn') { if (R.route.page === 'bike') toGarage(); else goBack(); return; }
  if (t.id === 'backupChip') { navigate({page: 'data'}); return; }
  if (t.id === 'reloadBtn') { location.reload(); return; }
  if (t.id === 'replacedOk') { S.replaced = null; renderSys(); return; }
  if (t.id === 'unresCheck') { t.disabled = true; await checkUnres(); renderSys(); return; }
  if (t.id === 'updateBtn') { applyUpdate(); return; }
  if (t.dataset.photo) {
    const u = await fileUrl(t.dataset.photo).catch(() => null);
    if (!u) { toast('Das Foto ist nicht mehr vorhanden.'); return; }
    $('#lbImg').src = u; $('#lightbox').showModal(); return;
  }
  if (t.id === 'lbClose') { $('#lightbox').close(); return; }
  for (const h of [home.onClick, defects.onClick, data.onClick, bike.onClick]) { if (await h(t, e)) return; }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.getAttribute && t.getAttribute('aria-invalid')) t.removeAttribute('aria-invalid');
  defects.onInput(t) || bike.onInput(t);
});
document.addEventListener('change', e => { const t = e.target; defects.onChange(t) || data.onChange(t) || bike.onChange(t); });
document.addEventListener('submit', async e => {
  const f = e.target;
  if (f.id === 'quickForm') { bike.onQuick(e); return; }
  e.preventDefault();
  const btn = f.querySelector('button[type="submit"]');
  if (btn && btn.disabled) return;
  const busy = on => { if (btn) btn.disabled = on; };
  try {
    if (await defects.onSubmit(f, busy)) return;
    await bike.onSubmit(f, busy);
  } catch (err) {
    if (err instanceof VErr) { showVErr(err); return; }
    throw err;
  } finally { busy(false); }
});
$('#lightbox').addEventListener('close', () => { $('#lbImg').removeAttribute('src'); });

/* ---------- App-Aktualisierung (Service Worker) ---------- */
let swReg = null, reloading = false;
function registerSW(){
  if (!('serviceWorker' in navigator) || (window.__T && window.__T.noSW)) return;
  navigator.serviceWorker.register('sw.js').then(reg => {
    swReg = reg;
    const watch = w => { if (!w) return; w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) { S.update = w; renderSys(); } }); };
    if (reg.waiting && navigator.serviceWorker.controller) { S.update = reg.waiting; renderSys(); }
    reg.addEventListener('updatefound', () => watch(reg.installing));
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (S.updating && !reloading) { reloading = true; location.reload(); } });
}
function checkUpdate(){
  if (!swReg) { toast('Die Offline-Funktion ist in diesem Browser nicht aktiv.'); return; }
  swReg.update().then(() => { setTimeout(() => { if (!S.update) toast('Racebook ist aktuell.'); }, 1500); }, () => toast('Keine Verbindung, es wurde nicht nach Aktualisierungen gesucht.'));
}
function applyUpdate(){
  if (Object.values(S.ops).some(o => o.saving) || (S.pending && S.pending.saving) || S.importBusy) { toast('Einen Moment, es wird gerade gespeichert.'); return; }
  if (!S.update) return;
  S.updating = true;
  S.update.postMessage({type: 'SKIP_WAITING'});
}

/* ---------- Start ---------- */
function initStatic(){
  /* Kurzform nur auf sehr schmalen Bildschirmen; der vorgelesene Name bleibt vollständig */
  $('#tabsIn').innerHTML = SECTIONS.map(([v, l, full, short]) => '<button class="tab" type="button" data-v="' + v + '" aria-current="false"' + (full || short ? ' aria-label="' + (full || l) + '"' : '') + '>' + icon(v)
    + (short ? '<span class="l-long">' + l + '</span><span class="l-short" aria-hidden="true">' + short + '</span>' : '<span>' + l + '</span>') + '</button>').join('');
  $$('form').forEach(f => f.setAttribute('novalidate', ''));
  bike.initBikeForms();
  bike.resetBikeForms();
}
async function boot(){
  initStatic();
  if (window.__T) store.installTestHooks();
  /* Einstieg mit Motorrad-Adresse: die Übersicht liegt darunter, damit „Zurück“ dorthin führt */
  const first = parseRoute();
  try {
    history.replaceState({rb: 0}, '', '#/');
    if (first.page !== 'home') history.pushState({rb: 1}, '', routeHash(first));
  } catch (e) {}
  R.route = first;
  showPage(first.page === 'bike' ? 'home' : first.page);
  renderAll();
  DB.setHandlers({
    versionchange: () => { S.otherTab = true; renderSys(); },
    blocked: () => { S.blocked = true; renderSys(); }
  });
  try { await DB.openDB((window.__T && window.__T.dbName) || DB.DB_NAME); }
  catch (e) { S.mode = 'error'; S.err = DB.mapErr(e); renderAll(); return; }
  S.blocked = false;
  try { await store.loadAll(); }
  catch (e) { S.mode = 'error'; S.err = DB.mapErr(e); renderAll(); return; }
  COLLS.forEach(c => store.subscribe(c, arr => onData(c, arr)));
  S.mode = 'ready';
  /* Ungeklärte Speicherversuche aus früheren Sitzungen ohne Kennung gehören zum geladenen Bestand;
     solche eines inzwischen ersetzten Bestands sind hinfällig */
  S.unres.forEach(u => { if (u.epoch == null) u.epoch = S.epoch || ''; });
  const gone = dropForeignUnres();
  if (gone) setTimeout(() => toast(gone === 1 ? 'Ein ungeklärter Speicherversuch gehörte zu einem inzwischen ersetzten Datenbestand und wurde verworfen.' : gone + ' ungeklärte Speicherversuche gehörten zu einem inzwischen ersetzten Datenbestand und wurden verworfen.'), 400);
  await data.refreshMeta();
  S.v8 = readV8Local();
  store.emitAll();
  if (!S.bikes[S.bike]) { const b = bikeList()[0]; S.bike = b ? b.id : ''; }
  /* Formulare an den geladenen Bestand und das gewählte Motorrad binden */
  bike.resetBikeForms();
  applyRoute(first);
  sweepOrphans();
  registerSW();
}
boot();

/* nur für automatisierte Tests sichtbar, ohne Einfluss auf die App */
if (window.__RACEBOOK_TEST__) {
  import('./domain.js').then(D => import('./util.js').then(Ut => {
    window.__RB = {S, derive, parseNum: Ut.parseNum, addMonths: Ut.addMonths, localParse: D.localParse, validateV8Backup: D.validateV8Backup,
      turns: Ut.turns, curOf: D.curOf, itemState: D.itemState, valueAt: D.valueAt, svcAtOf: D.svcAtOf, bikeStatus: D.bikeStatus, garageSummary: D.garageSummary,
      navigate, DB, store, bumpGen, parkOp, orphanCount};
  }));
}
