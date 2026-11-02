/* Racebook – Zählerstände (ab 1.1.0; Zuordnung am Tag eines Zählerwechsels ab 1.1.1):
   - Rückfrage vor dem Speichern, wenn ein Stand um mehr als 20 h bzw. 2.000 km über dem passenden bisherigen liegt
     (alle Eingabewege; Vergleich mit dem Stand an der Stelle des Eintrags, rückwirkende Einträge also mit damals)
   - Tippfehler berichtigen: Vorschau mit allen betroffenen Einträgen und den Auswirkungen auf die Wartung;
     gespeichert wird alles in einem Vorgang, nur wenn sich der Stand des Motorrads seit der Vorschau nicht geändert hat
   - Zählerwechsel unter Technik → Stundenzähler (Kilometerzähler): Anzeige und Gesamtlaufleistung getrennt */
import {esc, fmt, uid, v2, todayISO, fmtDate} from '../util.js';
import {S, U} from '../state.js';
import {LIM, derive, curOf, totOf, offOf, posAt, jumpText, fixPlan, fixResult, fixCandidate, canonDoc, meterSegments} from '../domain.js';
import * as store from '../store.js';
import {flow, opFor, execOp} from '../ops.js';
import {$, toast, errText, VErr, fieldNum, fieldDate} from '../ui.js';
import {R} from '../registry.js';

export const meterName = b => U(b) === 'km' ? 'Kilometerzähler' : 'Stundenzähler';
const hv = (b, v) => v == null ? '–' : fmt(v, 2) + ' ' + U(b);

/* ---------- Rückfrage bei auffälligen Sprüngen ---------- */
let jumpDone = null;
function askJump(text){
  const dlg = $('#jumpDlg');
  if (jumpDone) jumpDone(false);
  $('#jumpText').textContent = text;
  return new Promise(res => {
    jumpDone = v => { jumpDone = null; if (dlg.open) dlg.close(); res(v); };
    dlg.showModal();
    $('#jumpFix').focus();
  });
}
/* Ergebnis true = speichern. o (optional): Vorgang, merkt sich die Bestätigung je Feld; el: Eingabefeld (ID oder Element);
   prev: Vergleichswert (Anzeige), ohne Angabe der berechnete Stand an der Stelle des Eintrags */
export async function jumpOk(o, b, date, at, el, prev){
  if (at == null || !b) return true;
  const key = typeof el === 'string' ? el : ((el && el.id) || '');
  if (o && o.jumpAcc && o.jumpAcc[key] === at) return true;
  if (prev === undefined) prev = posAt(b.id, date || todayISO(), o ? o.created : Date.now()).disp;
  const text = jumpText(b, at, prev);
  if (!text) return true;
  if (await askJump(text)) { if (o) { o.jumpAcc = o.jumpAcc || {}; o.jumpAcc[key] = at; } return true; }
  const f = typeof el === 'string' ? $('#' + el) : el;
  if (f && f.isConnected) { f.focus(); try { f.select(); } catch (e) {} }
  return false;
}

/* ---------- Welcher Zähler war gemeint? (Angaben vom Tag eines Zählerwechsels) ---------- */
/* rows: [{key, label, date}] oder eine Funktion, die die aktuellen Zeilen liefert (z. B. „Angaben zuordnen“).
   Ergebnis: {pick: {key: c}, fp} – c ist die Stelle im Verlauf des Tages, fp der Datenstand des Motorrads, auf dem die
   Auswahl beruht (für die Prüfung im Speicher, store.commitR expect) –, null bei „Abbrechen“ oder {stale: true}, wenn
   eine Angabe nicht mehr zuzuordnen ist. Nichts ist vorausgewählt. Ändert sich der Datenstand des Motorrads, solange die
   Auswahl offen ist (anderes Fenster, Neuladen), werden Zeilen und Zähler neu berechnet, die bisherige Wahl verworfen
   und mit Hinweis neu gefragt; eine Entscheidung wird nie stillschweigend auf einen geänderten Verlauf übertragen. */
let SEG = null;
const SEG_CHANGED = 'Der Zählerverlauf hat sich inzwischen geändert (zum Beispiel in einem anderen Fenster). Die Auswahl wurde zurückgesetzt. Bitte neu wählen.';
export function askSegments(b, rows, msg){
  const dlg = $('#segDlg');
  if (SEG) SEG.done(null);
  return new Promise(res => {
    SEG = {bid: b.id, src: rows, epoch: S.epoch || '', rows: null, fp: '', msg: msg || '',
      done: v => { SEG = null; if (dlg.open) dlg.close(); res(v); }};
    if (!segBuild()) return;
    dlg.showModal();
    $('#segTitle').focus();
  });
}
/* Zeilen und Zähler aus dem aktuellen Stand berechnen und zeichnen. false = nichts mehr zu fragen (Dialog beendet) */
function segBuild(){
  const s = SEG, b = S.bikes[s.bid];
  if (!b || s.epoch !== (S.epoch || '')) { s.done(null); return false; }
  derive();
  const src = typeof s.src === 'function' ? s.src() : s.src;
  const rows = (src || []).map(r => Object.assign({}, r, {opts: meterSegments(b, r.date)}));
  if (!rows.length || rows.some(r => !r.opts.length)) { s.done({stale: true}); return false; }
  s.rows = rows; s.fp = store.bikeFpOf(b.id);
  $('#segBody').innerHTML = '<p>Am Tag dieser Angaben wurde der ' + esc(meterName(b)) + ' ersetzt. Welcher Zähler zeigte den Wert?</p>'
    + rows.map((r, i) => '<div class="fix-row seg-row" data-key="' + esc(r.key) + '"><b>' + esc(r.label) + '</b><span class="hint">am ' + esc(fmtDate(r.date)) + '</span>'
      + '<div class="fix-choice" role="radiogroup" aria-label="' + esc(r.label) + '">' + r.opts.map((o, k) => '<label><input type="radio" name="seg-' + i + '" value="' + k + '"> ' + esc(o.label) + '</label>').join('') + '</div></div>').join('');
  const m = $('#segMsg'); m.textContent = s.msg; m.hidden = !s.msg;
  segCheck();
  return true;
}
/* Datenstand noch derselbe? Sonst neu berechnen und neu fragen (Ergebnis false) */
function segFresh(){
  if (!SEG) return false;
  if (SEG.epoch !== (S.epoch || '') || !S.bikes[SEG.bid]) { SEG.done(null); return false; }
  if (store.bikeFpOf(SEG.bid) === SEG.fp) return true;
  SEG.msg = SEG_CHANGED;
  segBuild();
  return false;
}
export function closeSeg(){ if (SEG) SEG.done(null); }
export const segOpen = () => !!SEG;
function segCheck(){
  const all = SEG && SEG.rows.every((r, i) => !!$('#segBody input[name="seg-' + i + '"]:checked'));
  $('#segOk').disabled = !all;
  $('#segNeed').hidden = !!all;
}
function segPick(){
  if (!SEG) return null;
  const out = {};
  for (let i = 0; i < SEG.rows.length; i++) {
    const x = $('#segBody input[name="seg-' + i + '"]:checked'); if (!x) return null;
    out[SEG.rows[i].key] = SEG.rows[i].opts[+x.value].c;
  }
  return out;
}
export const SEG_SAVE_CHANGED = 'Der Zählerverlauf hat sich beim Speichern geändert. Es wurde nichts gespeichert. Bitte neu wählen.';

/* ---------- Tippfehler berichtigen ---------- */
/* Plan für einen neu eingegebenen, niedrigeren Stand von heute (wird dabei nicht zusätzlich gespeichert) */
export function typoPlan(b, v){
  if (!b || v == null) return null;
  derive();
  const cur = curOf(b);
  if (cur == null || !(v < cur - 0.005)) return null;
  return fixPlan(b, S.log, S.rides, {value: v, date: todayISO(), c: Date.now()});
}
/* Für „Wartungsstand prüfen“: vorhandener Widerspruch, der sich berichtigen lässt */
export function checkPlan(b){ derive(); return b ? fixCandidate(b) : null; }

const KIND_LABEL = {auto: 'automatisch aus dem Verlauf', manual: 'von dir eingetippt', unclear: 'Herkunft unklar (ältere Daten)'};
let F = null;
export const fixOpen = () => !!F;
export function closeFix(){ F = null; const d = $('#fixDlg'); if (d && d.open) d.close(); }
export function openFix(plan, ctx){
  if (!plan) return false;
  F = {plan, ctx: ctx || {}, choice: freshChoice(plan), op: 'fx' + uid(), epoch: S.epoch || '', fp: store.bikeFpOf(plan.bike), busy: false, unclear: false, msg: ''};
  renderFix(true);
  const d = $('#fixDlg'); if (!d.open) d.showModal();
  $('#fixBody').scrollTop = 0;
  $('#fixTitle').focus();
  return true;
}
function freshChoice(plan){ const c = {auto: {}, dec: {}}; plan.rows.forEach(r => { if (r.kind === 'auto') c.auto[r.id] = true; }); return c; }
function rowHTML(b, r){
  const head = '<b>' + esc(r.what) + '</b> · ' + fmtDate(r.date) + ' <span class="fix-tag ' + r.kind + '">' + KIND_LABEL[r.kind] + '</span>';
  const vals = '<span class="fix-vals">' + esc(hv(b, r.old)) + ' → <span class="fix-new" data-new="' + esc(r.id) + '"></span></span>'
    + (r.src === 'service' ? '<span class="fix-due" data-due="' + esc(r.id) + '"></span>' : '');
  if (r.kind === 'auto') return '<div class="fix-row" data-id="' + esc(r.id) + '" data-kind="auto"><label class="fix-check"><input type="checkbox" data-fixauto="' + esc(r.id) + '" checked><span>' + head + '<br>' + vals + '</span></label></div>';
  const n = 'fx-' + r.id;
  return '<div class="fix-row" data-id="' + esc(r.id) + '" data-kind="' + r.kind + '"><div>' + head + '<br>' + vals + '</div>'
    + '<div class="fix-choice" role="radiogroup" aria-label="' + esc(r.what) + ' vom ' + fmtDate(r.date) + '">'
    + '<label><input type="radio" name="' + esc(n) + '" value="fix"><span>auf ' + esc(hv(b, r.proposed)) + ' berichtigen</span></label>'
    + '<label><input type="radio" name="' + esc(n) + '" value="keep"><span>so lassen</span></label></div></div>';
}
function renderFix(full){
  if (!F) return;
  const b = S.bikes[F.plan.bike]; if (!b) { closeFix(); return; }
  const p = F.plan;
  if (full) {
    if (p.none) {
      $('#fixBody').innerHTML = '<p>Nach der Änderung gibt es hier nichts mehr zu berichtigen.</p>';
    } else {
      const s = p.subject, adds = Math.round((p.value - s.proposed) * 100) / 100;
      $('#fixBody').innerHTML = '<dl class="kv fix-subject"><dt>' + (s.kind === 'subject' ? 'Falsche Ablesung' : 'Zu hoher Stand') + '</dt><dd>' + esc(s.what) + ' vom ' + fmtDate(s.date) + '</dd>'
        + '<dt>Bisher</dt><dd><s>' + esc(hv(b, s.old)) + '</s></dd>'
        + '<dt>Neu</dt><dd><b>' + esc(hv(b, s.proposed)) + '</b>' + (s.kind === 'subject' ? '' : ' (wenn du unten „berichtigen“ wählst)') + '</dd>'
        + '<dt>Stand jetzt</dt><dd id="fixCur"></dd></dl>'
        + (adds > 0 ? '<p class="hint">Seitdem sind ' + esc(hv(b, adds)) + ' Fahrten dazugekommen. Deshalb ' + esc(hv(b, s.proposed)) + ' statt ' + esc(hv(b, p.value)) + '.</p>' : '')
        + (p.rows.length ? '<h3>Betroffene Einträge</h3><p class="hint">Automatisch berechnete Werte sind vorausgewählt. Bei eingetippten oder unklaren Werten entscheidest du selbst.</p><div class="fix-list">' + p.rows.map(r => rowHTML(b, r)).join('') + '</div>'
          : '<p class="hint">Keine Wartung hängt von dieser Ablesung ab.</p>')
        + '<h3>Auswirkungen auf die Wartung</h3><ul class="fix-effects" id="fixEffects"></ul>'
        + '<p class="hint fix-meter">Wurde der ' + meterName(b) + ' ausgetauscht? Das ist kein Tippfehler. Trag den Wechsel unter <button class="link inline" type="button" id="fixMeter">Technik → ' + meterName(b) + '</button> ein.</p>';
    }
  }
  const pending = store.pendingFor(b.id);
  let res = null;
  if (!p.none) {
    derive();
    res = fixResult(b, S.log, S.rides, p, F.choice, {t: Date.now(), op: F.op});
    F.res = res;
    p.rows.forEach(r => {
      const el = document.querySelector('#fixBody [data-new="' + CSS.escape(r.id) + '"]'); if (!el) return;
      const open = (r.kind === 'manual' || r.kind === 'unclear') && !F.choice.dec[r.id];
      el.textContent = open ? 'bitte wählen' : hv(b, res.proposed[r.id]) + (res.proposed[r.id] === r.old ? ' (bleibt)' : '');
      const du = document.querySelector('#fixBody [data-due="' + CSS.escape(r.id) + '"]');
      if (du) { const list = res.due[r.id] || []; du.innerHTML = list.map(x => '<br>Danach ' + esc(x.name) + ': <span class="t-' + x.s + '">' + esc(x.text) + '</span>').join(''); }
    });
    const cur = $('#fixCur'); if (cur) cur.textContent = hv(b, curOf(b)) + ' → danach ' + hv(b, res.cur);
    const eff = res.effects.map(x => '<li><b>' + esc(x.name) + '</b>: ' + esc(x.before) + ' → <span class="t-' + x.s1 + '">' + esc(x.after) + '</span></li>');
    if (res.reading) eff.unshift('<li>Weil Werte so bleiben, wird zusätzlich der Stand ' + esc(hv(b, res.reading.at)) + ' als Ablesung gespeichert.</li>');
    if (res.open) eff.unshift('<li class="hint">Vorläufig: Einträge ohne Entscheidung zählen hier wie „so lassen“.</li>');
    $('#fixEffects').innerHTML = eff.join('') || '<li class="hint">Keine Änderung bei den Fälligkeiten.</li>';
  }
  const need = res ? res.open : 0;
  const ap = $('#fixApply');
  ap.disabled = F.busy || !!p.none || !res || need > 0 || !res.changes || pending;
  ap.textContent = F.busy ? 'Wird gespeichert …' : 'Änderungen übernehmen';
  $('#fixCancel').disabled = F.busy;
  $('#fixCancel').textContent = p.none ? 'Schließen' : 'Abbrechen';
  const hint = pending ? 'Ein Eintrag wird gerade noch gespeichert. Einen Moment …'
    : need ? 'Bitte bei ' + (need === 1 ? 'einem Eintrag' : need + ' Einträgen') + ' „berichtigen“ oder „so lassen“ wählen.'
    : (res && !res.changes && !p.none ? 'So bleibt alles unverändert.' : '');
  const nh = $('#fixNeed'); nh.textContent = hint; nh.hidden = !hint;
  const m = $('#fixMsg'); m.textContent = F.msg || ''; m.hidden = !F.msg;
}
/* Neu planen (Daten haben sich geändert): neuer Stand der Dinge, Entscheidungen neu treffen */
function replan(msg){
  const b = S.bikes[F.plan.bike]; if (!b) { closeFix(); return; }
  derive();
  const p = F.plan;
  const np = p.mode === 'existing' ? fixPlan(b, S.log, S.rides, {id: p.target.id}) : fixPlan(b, S.log, S.rides, {value: p.value, date: todayISO(), c: Date.now()});
  F.fp = store.bikeFpOf(b.id); F.msg = msg || ''; F.op = 'fx' + uid(); F.unclear = false;
  F.plan = np || Object.assign({}, p, {rows: [], none: true});
  F.choice = freshChoice(F.plan);
  renderFix(true);
}
const CHANGED_MSG = 'Die Daten haben sich inzwischen geändert (zum Beispiel in einem anderen Fenster). Die Vorschau ist neu berechnet, bitte prüf sie noch einmal.';
/* Nach jeder Neuanzeige: Daten geändert → Vorschau neu prüfen */
export function onRender(){
  if (SEG) segFresh();
  if (!F || F.busy) return;
  if (F.epoch !== (S.epoch || '') || !S.bikes[F.plan.bike]) { closeFix(); return; }
  if (F.unclear) return;
  if (store.bikeFpOf(F.plan.bike) !== F.fp) { replan(CHANGED_MSG); return; }
  renderFix(false);
}
async function applyFix(){
  if (!F || F.busy || F.plan.none) return;
  const me = F, b = S.bikes[me.plan.bike]; if (!b) { closeFix(); return; }
  if (me.unclear) {
    /* Erst nachsehen, ob die Berichtigung schon angekommen ist */
    me.busy = true; renderFix(false);
    const n = await store.askStore('log', me.checkId);
    me.busy = false;
    if (F !== me) return;
    if (n.state !== 'known') { me.msg = 'Weiterhin unklar, ob gespeichert wurde. Versuch es gleich nochmal.'; renderFix(false); return; }
    if (n.exists && n.data && n.data.fix && n.data.fix.op === me.op) { finish(b); return; }
    me.unclear = false;
  }
  if (store.bikeFpOf(b.id) !== me.fp) { replan(CHANGED_MSG); return; }
  derive();
  const res = fixResult(b, S.log, S.rides, me.plan, me.choice, {t: Date.now(), op: me.op});
  if (res.open || !res.changes || store.pendingFor(b.id)) { renderFix(false); return; }
  const items = res.patches.map(x => ({coll: 'log', id: x.id, patch: x.patch}));
  if (res.reading) items.push({coll: 'log', id: 'r' + me.op, data: canonDoc('log', res.reading)});
  const chk = items.find(x => x.patch && x.patch.fix);
  me.checkId = chk ? chk.id : items[0].id;
  me.busy = true; me.msg = ''; renderFix(false);
  const r = await flow(() => store.commitR(items, null, 'tippfehler', {epoch: me.epoch, expect: {bike: b.id, fp: me.fp}}));
  me.busy = false;
  if (F !== me) return;
  if (r === 'ok') { finish(b); return; }
  if (r === 'fail') {
    const code = S.lastErr && S.lastErr.code;
    if (code === 'changed') { await store.reloadAll().catch(() => {}); if (F === me) replan(CHANGED_MSG); return; }
    if (code === 'stale' || code === 'orphan') { closeFix(); toast(errText(S.lastErr) + ' Es wurde nichts geändert.'); return; }
    me.msg = errText(S.lastErr) + ' Es wurde nichts geändert.';
    renderFix(false); return;
  }
  me.unclear = true;
  me.msg = 'Unklar, ob die Berichtigung gespeichert wurde. Tipp nochmal auf „Änderungen übernehmen“: Racebook sieht zuerst nach, es wird nichts doppelt geändert.';
  renderFix(false);
}
function finish(b){
  const ctx = F ? F.ctx : {};
  closeFix();
  if (ctx.onDone) ctx.onDone();
  toast('Tippfehler berichtigt. Stand jetzt ' + hv(b, curOf(b)) + '.');
  R.renderAll();
}

/* ---------- Zählerwechsel (Technik → Stundenzähler) ---------- */
export function renderMeter(b){
  const el = $('#meterInfo'); if (!el || !b) return;
  const name = meterName(b), cur = curOf(b), tot = totOf(b), off = offOf(b);
  const swaps = S.log.filter(l => l.bike === b.id && l.kind === 'meter');
  $('#meterTitle').textContent = name;
  $('#meterTag').textContent = swaps.length ? (swaps.length === 1 ? 'einmal ersetzt' : swaps.length + '× ersetzt') : '';
  el.innerHTML = '<dl class="kv"><dt>Anzeige am Zähler</dt><dd>' + esc(hv(b, cur)) + '</dd><dt>Gesamtlaufleistung</dt><dd>' + esc(hv(b, tot)) + '</dd></dl>'
    + '<p class="hint">' + (off ? 'Der Zähler wurde ersetzt. Eingetragen wird, was der Zähler anzeigt. Die Fälligkeiten rechnen mit der Gesamtlaufleistung.' : 'Solange der Zähler nicht ersetzt wurde, sind Anzeige und Gesamtlaufleistung gleich.') + '</p>'
    + (swaps.length ? '<ul class="mini-list">' + swaps.map(l => '<li><span>' + fmtDate(l.date) + ': alter Zähler zuletzt ' + esc(hv(b, l.at)) + ', neuer Zähler ab ' + esc(hv(b, l.meterNew)) + '</span></li>').join('') + '</ul>' : '');
  $('#meterFormTitle').textContent = name + ' ersetzt';
  $('#mOldLbl').textContent = 'Alter Zähler zuletzt (' + U(b) + ')';
  $('#mNewLbl').textContent = 'Neuer Zähler zeigt (' + U(b) + ')';
  meterPlaceholder(b);
}
export function meterPlaceholder(b){
  const i = $('#mOld'); if (!i || !b) return;
  const d = $('#mDate').value || todayISO(), pd = posAt(b.id, d, Date.now()).disp;
  i.placeholder = pd == null ? 'unbekannt' : v2(pd) + ' (berechnet)';
}
export async function saveMeter(b, busy){
  const u = U(b), lim = LIM[u === 'km' ? 'km' : 'h'].cnt;
  const date = fieldDate('mDate', 'Datum', {req: true});
  let old = fieldNum('mOld', 'Alter Zähler', {min: 0, max: lim});
  const nv = fieldNum('mNew', 'Neuer Zähler', {req: true, min: 0, max: lim});
  const o = opFor('meterForm', b.id, 'log', null, [date, old, nv].join('|')); if (o.saving) return;
  if (!o.payload) {
    const pd = posAt(b.id, date, o.created).disp;
    if (old == null) { if (pd == null) throw new VErr($('#mOld'), 'Trag den letzten Stand des alten Zählers ein.'); old = pd; }
    else if (pd != null && old < pd - 0.005) throw new VErr($('#mOld'), 'Das ist weniger als der letzte bekannte Stand (' + fmt(pd, 2) + ' ' + u + '). Prüf die Eingabe oder lass das Feld leer.');
    if (!(await jumpOk(o, b, date, old, 'mOld', pd))) return;
    o.payload = canonDoc('log', {bike: b.id, kind: 'meter', date, at: old, atAuto: false, meterNew: nv, tasks: [], taskNames: [], extra: '', title: '', cost: null, note: '', created: o.created});
    o.label = meterName(b) + ' ersetzt';
  }
  const g = S.gen.meterForm || 0;
  busy(true);
  const r = await execOp('meterForm', o, () => store.sSetR('log', o.op, o.payload, null, {epoch: o.epoch}));
  if (r === 'ok') { if ((S.gen.meterForm || 0) === g) R.closeDraft('meterForm'); toast('Zählerwechsel gespeichert. Ab jetzt trägst du ein, was der neue Zähler anzeigt.'); }
}

/* ---------- Ereignisse ---------- */
export function initCounter(){
  $('#jumpOk').addEventListener('click', () => { if (jumpDone) jumpDone(true); });
  $('#jumpFix').addEventListener('click', () => { if (jumpDone) jumpDone(false); });
  $('#jumpDlg').addEventListener('cancel', e => { e.preventDefault(); if (jumpDone) jumpDone(false); });
  $('#segDlg').addEventListener('cancel', e => { e.preventDefault(); if (SEG) SEG.done(null); });
  $('#segDlg').addEventListener('change', () => { if (SEG) segCheck(); });
  /* Vor dem Übernehmen noch einmal: beruht die Auswahl auf dem aktuellen Stand? */
  $('#segOk').addEventListener('click', () => { if (!SEG || !segFresh()) return; const p = segPick(); if (p) SEG.done({pick: p, fp: SEG.fp}); });
  $('#segCancel').addEventListener('click', () => { if (SEG) SEG.done(null); });
  const dlg = $('#fixDlg');
  dlg.addEventListener('cancel', e => { e.preventDefault(); if (F && !F.busy) closeFix(); });
  dlg.addEventListener('change', e => {
    if (!F || F.busy) return;
    const t = e.target;
    if (t.dataset.fixauto) F.choice.auto[t.dataset.fixauto] = t.checked;
    else if (t.type === 'radio' && t.name.startsWith('fx-')) F.choice.dec[t.name.slice(3)] = t.value;
    renderFix(false);
  });
  $('#fixCancel').addEventListener('click', () => { if (F && !F.busy) closeFix(); });
  $('#fixApply').addEventListener('click', () => { applyFix(); });
  dlg.addEventListener('click', e => {
    const t = e.target.closest('#fixMeter'); if (!t || !F || F.busy) return;
    const bid = F.plan.bike; closeFix();
    R.navigate({page: 'bike', bike: bid, section: 'garage'});
    const m = $('#g-meter'); if (m) { m.open = true; requestAnimationFrame(() => m.scrollIntoView({block: 'start', behavior: 'smooth'})); }
  });
}
