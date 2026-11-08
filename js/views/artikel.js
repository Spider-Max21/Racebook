/* Racebook – Lager: Artikelkarten und Artikeldetails (ab 1.7.1, Issue #10).
   - Lagerbestand: je Artikel eine eigene Karte. Bild, Bezeichnung und Hersteller sind EIN Knopf, der die Details öffnet;
     darunter nachgeordnet Kategorie/Artikelnummer, Zuordnung, Preis, Nachkaufgrenze. Der Bestand steht beschriftet mit seiner
     Einheit (Stück bzw. Gebinde mit Gebindegröße); −/+ ändern nur den Bestand und öffnen nichts.
   - Details (Adresse #/lager/<Artikel>): alle gespeicherten Angaben lesbar, fehlende als „nicht erfasst“, Einkaufsverlauf mit
     Belegen. Anschauen ändert nichts und beginnt keinen Entwurf. „Bearbeiten“ und „Einkauf erfassen“ öffnen bewusst das
     vorhandene Formular (es wird dazu in die Details verschoben und danach zurückgelegt); „Artikel löschen“ ist beschriftet und
     verlangt ein zweites Tippen. „Zurück zur Liste“ (oder die Zurück-Geste) erhält Suche, Filter und Scrollposition.
   Keine neuen Bestands- oder Buchungsregeln: Mengen, Preise und Einkäufe kommen unverändert aus dem gespeicherten Artikel. */
import {S, bikeName} from '../state.js';
import {$, imgTag} from '../ui.js';
import {esc, str, fmt} from '../util.js';
import {fmtPrice, partNeedsCheck, unitName} from '../domain.js';
import {catLabel} from '../label.js';
import * as stock from './stock.js';

const NOT = '<span class="hint">nicht erfasst</span>';
/* Hersteller nur zeigen, wenn die Bezeichnung ihn nicht schon enthält (keine Dopplung) */
export function makerShown(p){
  const m = str(p.maker); if (!m) return '';
  return str(p.name).toLocaleLowerCase('de').includes(m.toLocaleLowerCase('de')) ? '' : m;
}
/* Einheit des Bestands: „Stück“, „Gebinde (je 4 L)“, „Gebinde“; ohne Angabe leer (nichts erfinden) */
export function stockUnit(p){
  const u = unitName(p && p.unit);
  if (u === 'Gebinde') return str(p.pack) ? 'Gebinde (je ' + str(p.pack) + ')' : 'Gebinde';
  return u;
}
export function forText(p){
  if (partNeedsCheck(p)) return '';
  if (p.bike === 'both') return 'alle Motorräder';
  if (p.bike === 'some') return stock.assignmentText(p);
  return S.bikes[p.bike] ? bikeName(S.bikes[p.bike]) : 'nicht zugeordnet';
}

/* ---------- Karte im Lagerbestand ---------- */
export function cardHTML(p, titleOf){
  const low = p.qty <= p.min, maker = makerShown(p), unit = stockUnit(p), price = stock.priceLine(p);
  const forB = p.bike === 'both' ? 'alle Motorräder' : p.bike === 'some' ? stock.assignmentText(p) : S.bikes[p.bike] ? titleOf(S.bikes[p.bike]) : 'nicht zugeordnet';
  const info = [catLabel(p.cat, p.sub), p.artNo ? 'Art.-Nr. ' + p.artNo : ''].filter(Boolean).join(' · ');
  const busy = S.qtyBusy.has(p.id) ? ' disabled' : '';
  return '<article class="part part-card' + (low ? ' low' : '') + '" data-pid="' + esc(p.id) + '"><div class="part-main">'
    + '<button class="part-open" type="button" data-partview="' + esc(p.id) + '" aria-label="Details zu ' + esc(p.name) + ' anzeigen">'
    + (p.photo ? imgTag(p.photo.thumbId || p.photo.id, '', 'part-thumb', ' loading="lazy"') : '<span class="part-thumb part-thumb-none" aria-hidden="true"></span>')
    + '<span class="part-title"><span class="part-name">' + esc(p.name) + '</span>' + (maker ? '<span class="part-maker">' + esc(maker) + '</span>' : '') + '</span>'
    + '<span class="part-go" aria-hidden="true">›</span></button>'
    + (info ? '<div class="item-sub">' + esc(info) + '</div>' : '')
    + '<div class="item-sub">' + (partNeedsCheck(p) ? '<span class="txt-warn">Zuordnung prüfen</span>' : 'für ' + esc(forB)) + (price ? ' · ' + esc(price) : '') + ' · nachkaufen ab ' + fmt(p.min, 0) + (low ? ' · <span class="txt-bad">knapp</span>' : '') + '</div></div>'
    + '<div class="qty" role="group" aria-label="Bestand ' + esc(p.name) + '"><span class="qty-label"><span class="lbl">Bestand</span>' + (unit ? '<span class="qty-unit">' + esc(unit) + '</span>' : '') + '</span>'
    + '<button class="mini" type="button" data-qty="' + esc(p.id) + '" data-d="-1" aria-label="' + esc(p.name) + ': eins weniger"' + busy + '>−</button>'
    + '<b aria-label="Anzahl">' + fmt(p.qty, 0) + '</b>'
    + '<button class="mini" type="button" data-qty="' + esc(p.id) + '" data-d="1" aria-label="' + esc(p.name) + ': eins mehr"' + busy + '>+</button></div></article>';
}

/* ---------- Artikeldetails ----------
   Kopf und Angaben (detailBody) und Fuß (detailFoot) werden getrennt gezeichnet; dazwischen liegt der feste Platz für das
   Formular (#partDetailForm), damit ein Neuzeichnen der Angaben nie ein geöffnetes Formular entfernt. */
export function detailFoot(p){
  return '<div class="row part-actions"><button class="btn ghost" type="button" data-partback>Zurück zur Liste</button>'
    + (p ? '<button class="btn ghost danger" type="button" data-del="parts/' + esc(p.id) + '" data-arm="Wirklich löschen?">Artikel löschen</button>' : '') + '</div>';
}
export function detailBody(p, titleOf){
  if (!p) return '<div class="card-h"><h2 id="partDetailTitle" tabindex="-1">Artikel</h2></div><p class="hint">Diesen Artikel gibt es nicht mehr (zum Beispiel in einem anderen Fenster gelöscht).</p>';
  const low = p.qty <= p.min, unit = stockUnit(p);
  const val = v => str(v) ? esc(v) : NOT;
  const forB = partNeedsCheck(p) ? '<span class="txt-warn">Zuordnung prüfen</span>' : esc(p.bike === 'both' ? 'alle Motorräder' : p.bike === 'some' ? stock.assignmentText(p) : S.bikes[p.bike] ? titleOf(S.bikes[p.bike]) : 'nicht zugeordnet');
  const stockTxt = '<b>' + fmt(p.qty, 0) + '</b> ' + (unit ? esc(unit) : '<span class="hint">(Einheit nicht angegeben)</span>');
  const rows = [
    ['Hersteller', val(p.maker)], ['Artikelnummer', val(p.artNo)], ['Kategorie', val(catLabel(p.cat, p.sub))], ['Spezifikation', val(p.spec)],
    ['Bestand', stockTxt + (low ? ' · <span class="txt-bad">knapp</span>' : '')], ['Gebindegröße', val(p.pack)], ['Für', forB],
    ['Nachkaufen ab', esc(fmt(p.min, 0))], ['Einkaufspreis', p.price == null ? NOT : esc(stock.priceLine(p))], ['Strichcode', val(p.ean)]];
  return '<div class="card-h"><h2 id="partDetailTitle" tabindex="-1">' + esc(p.name) + '</h2><button class="link part-back-top" type="button" data-partback>Zurück zur Liste</button></div>'
    + (p.photo ? '<button class="thumb-btn part-detail-pic" type="button" data-photo="' + esc(p.photo.id) + '" aria-label="Bild von ' + esc(p.name) + ' vergrößern">' + imgTag(p.photo.thumbId || p.photo.id, 'Bild von ' + p.name, 'part-detail-img') + '</button>' : '')
    + '<dl class="kv part-kv">' + rows.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + v + '</dd>').join('') + '</dl>'
    + (unit.startsWith('Gebinde') ? '<p class="hint">Gezählt werden ganze Gebinde. Den Restinhalt angebrochener Gebinde erfasst Racebook nicht.</p>' : '')
    + '<div class="part-buys">' + stock.buysHTML(p) + '</div>'
    + '<div class="row part-actions"><button class="btn primary" type="button" data-partedit="' + esc(p.id) + '">Bearbeiten</button>'
    + '<button class="btn" type="button" data-partfill="' + esc(p.id) + '">Einkauf erfassen</button></div>';
}
