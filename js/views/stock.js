/* Racebook – Lager: Artikel aus einem Foto erfassen, Artikelangaben und Artikelbild im Teileformular (ab 1.4.0).
   Hier liegen nur Zustand und Anzeige des Formulars. Speichern, Rückfrage und Schreibschutz laufen wie bisher über
   das Teileformular in bike.js (ein Vorgang, Prüfung im Speicher).
   Bildregeln: Das aufgenommene oder gewählte Bild bleibt bis zum Bestätigen nur im Arbeitsspeicher des Browsers
   (Objekt-URL). Gespeichert wird es erst zusammen mit dem Artikel, verkleinert, in derselben Transaktion. Abbrechen,
   Verwerfen oder ein anderes Bild geben es frei; es bleibt nichts in der App gespeichert. */
import {S} from '../state.js';
import {$, $$, imgTag, hydrate, VErr} from '../ui.js';
import {esc, str, fmt} from '../util.js';
import {PART_CATS, catName, catLabel, matchParts} from '../label.js';
import * as ocr from '../ocr.js';

/* Formularfelder je Vorschlagsfeld */
export const FIELDS = [['name', 'pName'], ['cat', 'pCat'], ['sub', 'pSub'], ['maker', 'pMaker'], ['artNo', 'pArt'], ['spec', 'pSpec'], ['pack', 'pPack'], ['ean', 'pEan']];
export const EXTRA = ['cat', 'sub', 'maker', 'artNo', 'spec', 'pack', 'ean'];
export const EXTRA_LABEL = {cat: 'Kategorie', sub: 'Unterkategorie', maker: 'Hersteller', artNo: 'Artikelnummer', spec: 'Spezifikation', pack: 'Gebindegröße', ean: 'Strichcode', photo: 'Bild'};
const MARK = {ok: 'erkannt', check: 'bitte prüfen', none: 'nicht erkannt'};
const EL = Object.fromEntries(FIELDS);

let seq = 0;
/* ---------- Zustand ---------- */
export function capOpen(file){ dropCap(); S.cap = {id: ++seq, file, url: URL.createObjectURL(file), state: 'reading', status: 'Bild wird vorbereitet', prop: null, touched: new Set(), noImage: false}; return S.cap; }
export function dropCap(){ const c = S.cap; S.cap = null; if (c) { c.dead = true; if (c.url) URL.revokeObjectURL(c.url); } ocr.cancel(); }
export function setImg(file){ dropImg(); S.partImg = {kind: 'set', id: ++seq, file, url: URL.createObjectURL(file)}; }
export function removeImg(){ dropImg(); S.partImg = {kind: 'remove', id: ++seq}; }
export function dropImg(){ const i = S.partImg; S.partImg = null; if (i && i.url) URL.revokeObjectURL(i.url); }
/* Teil des Entwurfs für die Rückfrage beim Verlassen: ein gewähltes Bild ist eine ungespeicherte Eingabe */
export const sig = () => (S.cap ? 'cap' + S.cap.id + (S.cap.noImage ? '-' : '') : '') + (S.partImg ? S.partImg.kind + S.partImg.id : '') + (S.fill ? 'fill' + S.fill.pid : '');
/* Bild, das mit einem neuen Artikel gespeichert wird (oder null) */
export function newImageFile(){
  if (S.cap && !S.cap.noImage) return S.cap.file;
  return S.partImg && S.partImg.kind === 'set' ? S.partImg.file : null;
}

/* ---------- Felder ---------- */
export function fillCats(){
  const sel = $('#pCat'); if (!sel) return;
  const want = '<option value="">– keine –</option>' + PART_CATS.map(([k, n]) => '<option value="' + k + '">' + esc(n) + '</option>').join('');
  if (sel.innerHTML !== want) { const v = sel.value; sel.innerHTML = want; sel.value = v || ''; }
  fillSubs();
}
export function fillSubs(){
  const c = PART_CATS.find(x => x[0] === $('#pCat').value), list = c ? c[2] : PART_CATS.flatMap(x => x[2]);
  const html = list.map(s => '<option value="' + esc(s) + '">').join(''), dl = $('#pSubList');
  if (dl && dl.innerHTML !== html) dl.innerHTML = html;
}
export function readExtra(){
  const v = id => str($('#' + id).value);
  const o = {cat: $('#pCat').value || '', sub: v('pSub').slice(0, 60), maker: v('pMaker').slice(0, 60), artNo: v('pArt').slice(0, 60), spec: v('pSpec').slice(0, 200), pack: v('pPack').slice(0, 40), ean: v('pEan').replace(/\s/g, '')};
  if (!PART_CATS.some(c => c[0] === o.cat)) o.cat = '';
  if (o.ean && !/^\d{8}$|^\d{12,14}$/.test(o.ean)) throw new VErr($('#pEan'), 'Strichcode: bitte 8, 12, 13 oder 14 Ziffern, oder leer lassen.');
  return o;
}
/* forId: der Artikel, dessen Angaben jetzt im Formular stehen. Nur für ihn schreibt das Speichern Artikelangaben
   (sonst könnten leere, nie befüllte Felder als bewusste Löschung gelten; Prüfung PR 2) */
export function fillExtra(p, forId){
  p = p || {};
  const f = $('#partForm'); if (f) f.dataset.extraFor = forId || p.id || '';
  fillCats();
  $('#pCat').value = PART_CATS.some(c => c[0] === p.cat) ? p.cat : '';
  fillSubs();
  $('#pSub').value = p.sub || ''; $('#pMaker').value = p.maker || ''; $('#pArt').value = p.artNo || ''; $('#pSpec').value = p.spec || ''; $('#pPack').value = p.pack || ''; $('#pEan').value = p.ean || '';
  $('#pMore').open = EXTRA.some(k => p[k]) || !!p.photo;
}
export const hasExtra = p => !!p && (EXTRA.some(k => p[k]) || !!p.photo);

/* ---------- Kennzeichnung der Vorschläge ---------- */
export function setMarks(prop){
  FIELDS.forEach(([k, id]) => {
    const st = prop ? (prop[k] && prop[k].value ? prop[k].state || 'check' : 'none') : '';
    mark(k, st);
  });
}
function mark(k, st){
  const m = $('#partForm [data-mark="' + k + '"]'), f = $('#' + EL[k]), box = f ? f.closest('.f') : null;
  if (m) { m.className = 'mark' + (st ? ' mark-' + st : ''); m.textContent = st ? MARK[st] : ''; }
  if (box) box.classList.toggle('is-check', st === 'check');
}
export function clearMarks(){ setMarks(null); }
/* Eingabe in einem vorgeschlagenen Feld: ab jetzt deine Angabe (keine Kennzeichnung, wird nicht mehr überschrieben) */
export function onInput(t){
  if (!S.cap || !t || !t.id) return;
  const k = (FIELDS.find(x => x[1] === t.id) || [])[0];
  if (!k) return;
  S.cap.touched.add(k); mark(k, '');
}
/* Vorschlag eintragen: nur in Felder, die du noch nicht selbst ausgefüllt hast. Anzahl und Motorrad nie. */
export function applyProposal(prop){
  const cap = S.cap; if (!cap) return;
  fillCats();
  FIELDS.forEach(([k, id]) => {
    const el = $('#' + id), v = prop[k] && prop[k].value;
    if (!el || cap.touched.has(k)) return;
    if (k === 'cat') { el.value = v || ''; fillSubs(); }
    else if (!str(el.value)) el.value = v || '';
  });
  setMarks(prop);
  FIELDS.forEach(([k]) => { if (cap.touched.has(k)) mark(k, ''); });
  $('#pMore').open = true;
}

/* ---------- Anzeige: gewähltes Bild und Stand der Erkennung ---------- */
export function renderPhotoBox(){
  const box = $('#pPhotoBox'); if (!box) return;
  const c = S.cap;
  if (!c) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  const p = c.prop;
  let st = '';
  if (c.state === 'reading') st = '<p class="hint thinking" role="status">Erkennung läuft auf diesem Gerät: ' + esc(c.status) + ' …</p><div class="row"><button class="btn ghost" type="button" id="capStop">Erkennung abbrechen</button></div>';
  else if (c.state === 'unavailable') st = '<p class="warnbox" role="status">Die Texterkennung ist gerade nicht verfügbar. Sie wird beim ersten Mal von der Racebook-Seite geladen (etwa 4,5 MB) und läuft danach auch offline. Trag die Angaben selbst ein; das Bild bleibt beim Artikel.</p><div class="row"><button class="btn ghost" type="button" id="capRerun">Nochmal erkennen</button></div>';
  else if (c.state === 'cancelled') st = '<p class="hint" role="status">Erkennung abgebrochen. Trag die Angaben selbst ein; das Bild bleibt beim Artikel.</p><div class="row"><button class="btn ghost" type="button" id="capRerun">Nochmal erkennen</button></div>';
  else if (c.state === 'done' && p && p.empty) st = '<p class="warnbox" role="status">Auf dem Bild wurde kein verwertbarer Text erkannt. Trag die Angaben selbst ein; das Bild bleibt beim Artikel.</p>';
  else if (c.state === 'done' && p) {
    st = '<p class="hint" role="status">Vorschlag aus dem Text auf dem Bild. „erkannt“ = so gelesen, „bitte prüfen“ = unsicher, „nicht erkannt“ = bleibt leer. Gespeichert wird erst, wenn du bestätigst.</p>';
    if (p.fit) st += '<p class="warnbox">Auf dem Etikett steht: „' + esc(p.fit) + '“. Racebook ordnet den Artikel deshalb keinem Motorrad zu; das wählst du unten selbst.</p>';
    if (p.text && p.text.length) st += '<details class="cap-read"><summary>Erkannter Text</summary><p class="cap-text">' + esc(p.text.join('\n')) + '</p></details>';
  }
  box.innerHTML = '<div class="cap-box">'
    + (c.noImage ? '<p class="hint">Das Bild wird nicht gespeichert.</p><div class="row"><button class="btn ghost" type="button" id="capKeepImg">Bild doch speichern</button></div>'
      : '<img class="cap-img" src="' + c.url + '" alt="Gewähltes Bild des Artikels"><div class="row"><button class="btn ghost" type="button" id="capNoImg">Bild nicht speichern</button></div>')
    + st + '</div>';
}
/* Bild eines vorhandenen oder manuell angelegten Artikels (unter „Weitere Angaben“) */
export function renderImgBox(cur){
  const box = $('#pImgBox'); if (!box) return;
  if (S.cap) { box.innerHTML = '<p class="hint">Das Bild oben wird mit dem Artikel gespeichert' + (S.cap.noImage ? ' – du hast es abgewählt.' : '.') + '</p>'; return; }
  const file = '<input type="file" id="pImgFile" accept="image/*" class="sr-file">';
  const i = S.partImg;
  let h;
  if (i && i.kind === 'set') h = '<img class="cap-img" src="' + i.url + '" alt="Neues Bild des Artikels"><p class="hint">Wird beim Speichern verkleinert übernommen.</p><div class="row"><label class="btn" for="pImgFile">Anderes Bild</label>' + file + '<button class="btn ghost" type="button" id="pImgDrop">Bild verwerfen</button></div>';
  else if (i && i.kind === 'remove') h = '<p class="hint">Das Bild wird beim Speichern entfernt.</p><div class="row"><button class="btn ghost" type="button" id="pImgDrop">Rückgängig</button></div>';
  else if (cur && cur.photo) h = imgTag(cur.photo.thumbId || cur.photo.id, 'Bild von ' + (cur.name || 'Artikel'), 'cap-img') + '<div class="row"><label class="btn" for="pImgFile">Bild ersetzen</label>' + file + '<button class="btn ghost" type="button" id="pImgDel">Bild entfernen</button></div>';
  else h = '<div class="row"><label class="btn" for="pImgFile">Bild hinzufügen</label>' + file + '</div>';
  box.innerHTML = '<span class="lbl">Bild</span>' + h;
  hydrate(box);
}
/* Passende vorhandene Artikel zum Auffüllen */
export function renderMatch(parts){
  const box = $('#pMatch'); if (!box) return;
  const c = S.cap, m = c && c.state === 'done' && c.prop && !c.prop.empty ? matchParts(c.prop, parts) : [];
  if (!m.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = '<div class="warnbox"><b>Schon im Lager?</b> Diese Artikel passen zum Bild:'
    + m.map(x => '<div class="match-row"><span><b>' + esc(x.part.name) + '</b> <span class="hint">(' + fmt(x.part.qty, 0) + ' im Vorrat, ' + esc(x.why) + ')</span></span><button class="btn" type="button" data-capfill="' + esc(x.part.id) + '">Diesen auffüllen</button></div>').join('')
    + '<p class="hint">Sonst legst du unten einen neuen Artikel an.</p></div>';
}
export function status(cap, text, p){ if (S.cap !== cap) return; cap.status = text + (p > 0 && p < 1 ? ' ' + Math.round(p * 100) + ' %' : ''); const s = $('#pPhotoBox .thinking'); if (s) s.textContent = 'Erkennung läuft auf diesem Gerät: ' + cap.status + ' …'; }
export const label = (p) => [catLabel(p.cat, p.sub), p.maker, p.artNo ? 'Art.-Nr. ' + p.artNo : '', p.pack].filter(Boolean).join(' · ');
export {catName};
