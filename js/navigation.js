/* Stable app navigation: two fixed destinations, three personal favourites.
   Bike actions always name their bike. Only confirmed user choices alter the bar. */
import {S, bikeList, curBike} from './state.js';
import * as DB from './db.js';
import * as drafts from './drafts.js';
import {slotsOf, validSlots, DEFAULT_SLOTS} from './preferences.js';
import {$, $$, icon, SECTIONS, toast, errText} from './ui.js';
import {esc, canon} from './util.js';
import {R} from './registry.js';

const LABELS = {home:'Garage',inventory:'Lager',data:'Einstellungen',help:'Hilfe',navigation:'Menü anpassen',...Object.fromEntries(SECTIONS)};
const SHORT = {components:'Verbaut',vehicle:'Fahrzeug',specs:'Daten',maintenance:'Intervalle'};
const titleOf = b => b.nickname || ((b.brand || '') + ' ' + (b.model || '')).trim() || 'Motorrad';
let draft = null, target = '', dragging = null;
const clone = x => x == null ? null : JSON.parse(JSON.stringify(x));
const close = id => { const el = $('#' + id); if (el && el.open) el.close(); };
export async function refreshPreferences(){
  if (!DB.isOpen()) return;
  const next = await DB.getMeta('navigation');
  if (draft && !drafts.isDirty('navigation') && canon(draft.base) !== canon(next)) { draft = null; drafts.forget('navigation'); }
  S.navigation = next;
}
export function resetEditor(){ draft = null; drafts.forget('navigation'); close('moreDlg'); close('navPickDlg'); }
const menuLabel = (id,label) => id === 'vehicle' ? 'Fahrzeug\u00addaten' : id === 'maintenance' ? 'Wartungs\u00adintervalle' : label;
const button = (id,label,cls='menu-link') => '<button class="' + cls + '" type="button" data-destination="' + id + '" aria-label="' + esc(label || LABELS[id]) + '">' + icon(id === 'navigation' ? 'sort' : id === 'data' ? 'garage' : id) + '<span>' + esc(menuLabel(id,label || LABELS[id])) + '</span></button>';

export function renderNavigation(){
  const page = R.route.page, section = R.route.section, slots = slotsOf(S.navigation && S.navigation.slots);
  const current = page === 'bike' ? section : page;
  const ids = ['home', ...slots, 'more'];
  const html = ids.map(id => '<button class="tab" type="button" data-destination="' + id + '" aria-label="' + esc(LABELS[id] || 'Mehr') + '" aria-current="' + (id === current || (id === 'more' && !ids.includes(current)) ? 'page' : 'false') + '"' + (id === 'more' ? ' aria-haspopup="dialog" aria-controls="moreDlg" aria-expanded="' + !!$('#moreDlg').open + '"' : '') + '>' + icon(id) + '<span>' + esc(SHORT[id] || LABELS[id] || 'Mehr') + '</span></button>').join('');
  if ($('#tabsIn').innerHTML !== html) $('#tabsIn').innerHTML = html;
  const b = curBike(), picker = $('#contextBike');
  const options = bikeList().map(x => '<option value="' + esc(x.id) + '">' + esc(titleOf(x)) + '</option>').join('');
  if (picker.innerHTML !== options) picker.innerHTML = options;
  if (b) picker.value = b.id;
  const links = '<span class="context-section">' + esc(LABELS[section] || 'Übersicht') + '</span><button class="mini" type="button" data-destination="more">Bereiche öffnen</button>';
  if ($('#bikeSectionLinks').innerHTML !== links) $('#bikeSectionLinks').innerHTML = links;
}

function showMore(){
  const b = R.route.page === 'bike' ? curBike() : null;
  $('#moreBody').innerHTML = '<h3>Racebook</h3><div class="menu-grid">' + button('home') + button('inventory') + '</div>'
    + '<h3>' + esc(b ? titleOf(b) : 'Am Motorrad') + '</h3>' + (!b ? '<p class="hint">Beim Öffnen wählst du das Motorrad.</p>' : '')
    + '<div class="menu-grid">' + SECTIONS.map(([id,label]) => button(id,label)).join('') + '</div>'
    + '<h3>App</h3><div class="menu-grid">' + button('data') + button('navigation') + button('help') + '</div>';
  $('#moreDlg').showModal(); renderNavigation();
}
function chooseBike(section){
  const bikes = bikeList();
  if (!bikes.length) { toast('Leg zuerst ein Motorrad in der Garage an.'); R.go({page:'home'}); return; }
  if (R.route.page === 'bike' && S.bikes[R.route.bike]) { R.go({page:'bike',bike:R.route.bike,section}); return; }
  if (bikes.length === 1) { R.go({page:'bike',bike:bikes[0].id,section}); return; }
  target = section;
  $('#navPickHint').textContent = LABELS[section] + ' öffnen für:';
  $('#navPickList').innerHTML = bikes.map(b => '<button class="btn" type="button" data-navbike="' + esc(b.id) + '">' + icon('bike') + esc(titleOf(b)) + '</button>').join('');
  $('#navPickDlg').showModal();
}
function openDestination(id){
  if (id === 'more') { showMore(); return; }
  close('moreDlg');
  /* Garage wie der Knopf „Meine Garage“: im Verlauf zurück zur Übersicht, damit die Zurück-Geste nicht wieder ins Motorrad führt */
  if (id === 'home') { R.toGarage(); return; }
  if (['inventory','data','help','navigation'].includes(id)) { R.go({page:id}); return; }
  if (SECTIONS.some(s => s[0] === id)) chooseBike(id);
}

export function renderEditor(){
  if (S.mode !== 'ready') return;
  if (!draft) {
    draft = {slots:slotsOf(S.navigation && S.navigation.slots),base:clone(S.navigation),epoch:S.epoch,msg:''};
    drawEditor(); drafts.mark('navigation');
  }
}
function drawEditor(focus){
  if (!draft) return;
  const options = selected => ['inventory', ...SECTIONS.map(x => x[0])].map(id => '<option value="' + id + '"' + (id === selected ? ' selected' : '') + '>' + esc(LABELS[id]) + '</option>').join('');
  $('#navigationEditor').innerHTML = '<form id="navigationForm" class="card stack" novalidate>'
    + (draft.msg ? '<p class="warnbox" role="alert">' + esc(draft.msg) + '</p>' : '')
    + '<div class="nav-fixed">' + icon('home') + '<b>Garage</b><span class="hint">fest</span></div>'
    + '<div class="stack" id="navigationChoices">' + draft.slots.map((id,i) => '<div class="nav-choice" data-navrow="' + i + '"><button class="mini nav-grip" type="button" data-navgrip="' + i + '" aria-label="Platz ' + (i+2) + ' verschieben. Alternativ Hoch und Runter verwenden.">' + icon('grip') + '</button><div class="f"><label for="navSlot' + i + '">Platz ' + (i+2) + '</label><select id="navSlot' + i + '" data-navslot="' + i + '">' + options(id) + '</select></div><div class="nav-arrows"><button class="mini" type="button" data-navmove="' + i + ':-1" aria-label="Platz ' + (i+2) + ' nach oben"' + (i === 0 ? ' disabled' : '') + '>↑</button><button class="mini" type="button" data-navmove="' + i + ':1" aria-label="Platz ' + (i+2) + ' nach unten"' + (i === 2 ? ' disabled' : '') + '>↓</button></div></div>').join('') + '</div>'
    + '<div class="nav-fixed">' + icon('more') + '<b>Mehr</b><span class="hint">fest</span></div><p class="hint">Jeden Bereich einmal auswählen. Ziehe am Griff oder nutze die Pfeile. Weitere Bereiche bleiben unter Mehr erreichbar.</p><div class="row"><button class="btn primary" type="submit">Menü speichern</button><button class="btn" type="button" id="navigationDefault">Standardbelegung</button><button class="btn ghost" type="button" id="navigationCancel">Abbrechen</button></div></form>';
  if (focus) $(focus)?.focus();
}
function move(from,to){
  if (!draft || from === to || from < 0 || to < 0 || from > 2 || to > 2) return;
  drafts.touch('navigation'); const [id] = draft.slots.splice(from,1); draft.slots.splice(to,0,id); drawEditor('#navSlot'+to);
}
export async function saveEditor(){
  if (!draft) return true;
  if (!validSlots(draft.slots)) { draft.msg = 'Bitte drei verschiedene Bereiche auswählen.'; drawEditor(); return false; }
  const own = draft;
  try {
    await DB.commit([{store:'meta',type:'put',value:{k:'navigation',slots:own.slots.slice()}}],{epoch:own.epoch,bump:true,expectMeta:{k:'navigation',value:own.base}});
    await refreshPreferences(); draft = null; drafts.mark('navigation'); renderEditor(); R.renderAll(); toast('Menü gespeichert.'); return true;
  } catch(e) {
    if (draft !== own) return false;
    if (e.code === 'changed') { await refreshPreferences(); own.base = clone(S.navigation); own.msg = 'Das Menü wurde in einem anderen Fenster geändert. Deine Auswahl bleibt erhalten. Erneut speichern ersetzt dessen Menübelegung; Abbrechen übernimmt sie.'; }
    else own.msg = errText(e) + ' Deine Auswahl wurde nicht gespeichert.';
    drawEditor(); return false;
  }
}
export async function onClick(t){
  if (t.dataset.destination) { openDestination(t.dataset.destination); return true; }
  if (t.dataset.navbike) { const id=t.dataset.navbike; close('navPickDlg'); if (S.bikes[id]) R.go({page:'bike',bike:id,section:target}); return true; }
  if (t.id === 'moreClose') { close('moreDlg'); return true; }
  if (t.id === 'navPickCancel') { close('navPickDlg'); return true; }
  if (t.dataset.settingsjump) { $('#' + t.dataset.settingsjump)?.scrollIntoView({block:'start',behavior:'smooth'}); return true; }
  if (t.id === 'navigationDefault') { drafts.touch('navigation'); draft.slots = DEFAULT_SLOTS.slice(); drawEditor(); return true; }
  if (t.id === 'navigationCancel') { resetEditor(); R.go({page:'data'}); return true; }
  if (t.dataset.navmove) { const [i,d] = t.dataset.navmove.split(':').map(Number); move(i,i+d); return true; }
  return false;
}
export function onInput(t){ if (t.closest('#navigationForm')) drafts.touch('navigation'); }
export function onChange(t){
  if (t.id === 'contextBike') { const old=R.route.bike, next=t.value; t.value=old; R.go({page:'bike',bike:next,section:R.route.section}); return true; }
  if (t.dataset.navslot != null && draft) { drafts.touch('navigation'); draft.slots[+t.dataset.navslot] = t.value; return true; }
  return false;
}
export function initNavigation(){
  drafts.register({key:'navigation',label:'Menübelegung',root:()=>$('#navigationForm'),extra:()=>draft ? draft.slots : null,save:saveEditor,discard:resetEditor,reveal:()=>R.navigate({page:'navigation'})});
  $('#moreDlg').addEventListener('close',renderNavigation);
  document.addEventListener('pointerdown',e=> { const grip=e.target.closest('[data-navgrip]'); if (!grip || !draft) return; e.preventDefault(); dragging={from:+grip.dataset.navgrip,id:e.pointerId}; grip.setPointerCapture(e.pointerId); });
  document.addEventListener('pointerup',e=> { if (!dragging || dragging.id !== e.pointerId) return; const d=dragging; dragging=null; const rows=$$('[data-navrow]'); let to=d.from; rows.forEach((row,i)=>{ const r=row.getBoundingClientRect(); if (e.clientY >= r.top && e.clientY <= r.bottom) to=i; }); move(d.from,to); });
  document.addEventListener('pointercancel',()=>{ dragging=null; });
  window.addEventListener('storage', e=> { if (e.key === 'rb-theme') R.applyTheme(); });
}
