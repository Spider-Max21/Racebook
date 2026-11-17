/* Navigation preferences: shared by UI, backup validation and tests. */
export const DEFAULT_SLOTS = ['inventory', 'log', 'rides'];
export const SLOT_IDS = ['inventory', 'status', 'log', 'rides', 'defects', 'setup', 'components', 'vehicle', 'maintenance', 'manual'];
/* ab 1.9.1 (Issue #17): frühere Plätze, die es so nicht mehr gibt. Gespeicherte Belegungen (auch aus Sicherungen) bleiben gültig
   und unverändert gespeichert; angezeigt wird der Nachfolger. Stünde er schon auf einem Platz, rückt der erste freie Standardplatz
   nach – kein doppelter und kein toter Menüpunkt. */
export const LEGACY_SLOTS = {specs: 'vehicle'};
export function validSlots(v){ return Array.isArray(v) && v.length === 3 && new Set(v).size === 3 && v.every(x => SLOT_IDS.includes(x) || Object.prototype.hasOwnProperty.call(LEGACY_SLOTS, x)); }
export function slotsOf(v){
  if (!validSlots(v)) return DEFAULT_SLOTS.slice();
  const out = [];
  v.forEach(x => { const y = LEGACY_SLOTS[x] || x; out.push(out.includes(y) || v.includes(y) && y !== x ? null : y); });
  const spare = DEFAULT_SLOTS.concat(SLOT_IDS).filter(x => !out.includes(x));
  return out.map(x => x || spare.shift());
}
export function navigationOf(v){
  if (v == null) return null;
  if (!v || typeof v !== 'object' || Array.isArray(v) || !validSlots(v.slots)) throw new Error('Die Menübelegung in der Sicherung ist ungültig.');
  return {k: 'navigation', slots: v.slots.slice()};
}
