/* Racebook – einstellbare Startseite „Meine Garage“ (ab 1.14.0, Roadmap 11, Auftrag in Issue #5).
   Beschreibung der Bausteine, Prüfung der gespeicherten Auswahl und Berechnung der Inhalte; ohne Oberfläche und ohne Speicher.
   - Auswahl und Reihenfolge der Bausteine gelten für die ganze App wie die Menübelegung (meta 'dashboard', in Sicherung,
     Wiederherstellungspunkten und Sicherheitskopie). Ohne eigene Auswahl bleibt die Startseite wie bis 1.13.0:
     Zusammenfassung und Motorräder.
   - „Motorräder“ (die Karten der Garage) lässt sich verschieben, aber nicht ausblenden: „Meine Garage“ bleibt erhalten.
   - Inhalte nur aus vorhandenen Daten (Wartung, Mängel, Kosten und Nutzung aus ../stats.js, Strecken aus ../tracks.js, Lager).
     Fehlt etwas, steht das so da: kein „in Ordnung“ ohne Grundlage, keine Kosten aus Einträgen ohne Betrag, keine Nutzung ohne
     belegte Stände, Stunden und Kilometer nie zusammengezählt, keine Kosten pro Stunde (Berechnung in ./blocks.js).
   Ohne Abhängigkeiten: wird auch beim Einlesen einer Sicherung (./domain.js) und in den Prüfungen ohne Browser verwendet. */

/* Bausteine in der Reihenfolge, in der ausgeblendete im Editor erscheinen */
export const BLOCKS = [
  {id: 'summary', name: 'Zusammenfassung', hint: 'Zahl der Motorräder, überfällige Wartung und offene Mängel'},
  {id: 'bikes', name: 'Motorräder', hint: 'Die Karten deiner Motorräder mit Stand und nächster Wartung', fixed: true},
  {id: 'due', name: 'Fällige Wartung', hint: 'Überfällige, bald fällige und zu prüfende Wartungspunkte aller Motorräder'},
  {id: 'defects', name: 'Offene Mängel', hint: 'Offene Mängel aller Motorräder, die wichtigsten zuerst'},
  {id: 'costs', name: 'Kosten', hint: 'Bekannte Kosten im laufenden Monat und Jahr'},
  {id: 'usage', name: 'Nutzung', hint: 'Gefahrene Stunden bzw. Kilometer im laufenden Jahr, je Motorrad'},
  {id: 'rides', name: 'Letzte Fahrten', hint: 'Die zuletzt eingetragenen Fahrten aller Motorräder'},
  {id: 'tracks', name: 'Lieblingsstrecken', hint: 'Markierte Strecken mit Besuchen und Bestzeiten'},
  {id: 'stock', name: 'Nachzukaufen', hint: 'Lagerartikel, deren Bestand die Nachkaufgrenze erreicht hat'}
];
export const BLOCK_IDS = BLOCKS.map(b => b.id);
export const BLOCK = Object.fromEntries(BLOCKS.map(b => [b.id, b]));
export const DEFAULT_SHOW = ['summary', 'bikes'];
/* Höchstzahl der Einträge je Baustein; der Rest steht als Zahl da und ist über den Link erreichbar */
export const LIST_MAX = 5;

/* ---------- Auswahl (meta 'dashboard') ----------
   Gespeicherte Form: {k: 'dashboard', show: [Kennung, …]} = angezeigte Bausteine in ihrer Reihenfolge. Jeder Baustein höchstens
   einmal, „Motorräder“ immer dabei. Entspricht die Auswahl dem Standard, wird nichts gespeichert (null). */
export function validShow(v){
  return Array.isArray(v) && v.length >= 1 && v.length <= BLOCK_IDS.length && new Set(v).size === v.length
    && v.every(x => typeof x === 'string' && BLOCK_IDS.includes(x)) && v.includes('bikes');
}
export const isDefault = show => Array.isArray(show) && show.length === DEFAULT_SHOW.length && show.every((x, i) => x === DEFAULT_SHOW[i]);
/* Angezeigte Bausteine aus dem gespeicherten Datensatz; fehlt er oder ist er unbrauchbar, der Standard */
export function showOf(rec){ return rec && validShow(rec.show) ? rec.show.slice() : DEFAULT_SHOW.slice(); }
export function dashRecord(show){
  if (!validShow(show)) throw new Error('Ungültige Auswahl für die Startseite.');
  return isDefault(show) ? null : {k: 'dashboard', show: show.slice()};
}
/* Prüfung beim Einlesen einer Sicherung: ungültig → Fehler (nichts still verwerfen oder ergänzen) */
export function dashboardOf(v){
  if (v == null) return null;
  if (!v || typeof v !== 'object' || Array.isArray(v) || v.k !== 'dashboard' || !validShow(v.show) || Object.keys(v).some(k => k !== 'k' && k !== 'show'))
    throw new Error('Die Auswahl der Startseite in der Sicherung ist ungültig.');
  return {k: 'dashboard', show: v.show.slice()};
}
/* Zeilen für den Editor: erst die angezeigten in ihrer Reihenfolge, dann die übrigen in fester Reihenfolge */
export function rowsOf(show){
  const on = validShow(show) ? show : DEFAULT_SHOW;
  return on.map(id => ({id, on: true})).concat(BLOCK_IDS.filter(id => !on.includes(id)).map(id => ({id, on: false})));
}
export const showFromRows = rows => rows.filter(r => r.on || BLOCK[r.id].fixed).map(r => r.id);
