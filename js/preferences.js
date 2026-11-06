/* Navigation preferences: shared by UI, backup validation and tests. */
export const DEFAULT_SLOTS = ['inventory', 'log', 'rides'];
export const SLOT_IDS = ['inventory', 'status', 'log', 'rides', 'defects', 'setup', 'components', 'vehicle', 'specs', 'maintenance', 'manual'];
export function validSlots(v){ return Array.isArray(v) && v.length === 3 && new Set(v).size === 3 && v.every(x => SLOT_IDS.includes(x)); }
export function slotsOf(v){ return validSlots(v) ? v.slice() : DEFAULT_SLOTS.slice(); }
export function navigationOf(v){
  if (v == null) return null;
  if (!v || typeof v !== 'object' || Array.isArray(v) || !validSlots(v.slots)) throw new Error('Die Menübelegung in der Sicherung ist ungültig.');
  return {k: 'navigation', slots: v.slots.slice()};
}
