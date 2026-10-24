/* Racebook – gemeinsamer Zustand der Oberfläche und einfache Selektoren.
   Die Daten selbst liegen in IndexedDB (db.js); S hält nur die geladene Kopie für die Anzeige. */
import {str, validId} from './util.js';

export const COLLS = ['bikes', 'log', 'rides', 'setups', 'parts', 'defects'];

/* Kleine Komfortwerte pro Gerät (ausgewähltes Motorrad, Ansicht). Keine Nutzdaten. */
export function lsGet(k){ try { return localStorage.getItem('rb-' + k); } catch (e) { return null; } }
export function lsSet(k, v){ try { localStorage.setItem('rb-' + k, v); return true; } catch (e) { return false; } }
export function lsDel(k){ try { localStorage.removeItem('rb-' + k); } catch (e) {} }
export function lsJSON(k, def){ try { const v = JSON.parse(lsGet(k) || 'null'); return v == null ? def : v; } catch (e) { return def; } }

export const S = {
  mode: 'loading', err: '', demo: false,
  loaded: {bikes: false, log: false, rides: false, setups: false, parts: false, defects: false},
  bike: lsGet('bike') || '', view: 'home', section: lsGet('section') || 'status',
  bikes: {}, log: [], rides: [], setups: [], parts: [], defects: [], der: {},
  meta: {changeSeq: 0, lastBackupAt: null, lastBackupSeq: 0, lastBackupName: '', lastBackupSize: 0, lastBackupHow: ''},
  editing: {}, logTasks: new Set(), editSetup: null, pending: null,
  adding: false, doneOpen: null, doneDraft: null, oemDraft: null, importDraft: null,
  ops: {}, gen: {}, lastErr: null, qtyBusy: new Set(), defDone: null, defDoneDraft: null, defEdit: null, defKeep: null, defBusy: new Set(),
  addPhoto: null, photoBusy: null, keepFiles: [], update: null, blocked: false, otherTab: false, v8: null, persisted: null, estimate: null, backup: null, snapshot: null, lastImport: null, migration: null,
  /* Bestandskennung des geladenen Bestands; replacing: dieses Fenster ersetzt gerade den Bestand ('import'|'restore');
     replaced: Hinweis, dass ein anderes Fenster den Bestand ersetzt hat; lastReset: was beim Ersetzen geschlossen wurde */
  epoch: null, replacing: null, replaced: null, lastReset: null,
  unres: lsJSON('unresolved', []).filter(u => u && COLLS.includes(u.coll) && validId(u.id) && u.payload && typeof u.payload === 'object')
};

export const bikeList = () => Object.values(S.bikes).sort((a, b) => (a.order == null ? 9999 : a.order) - (b.order == null ? 9999 : b.order));
export const curBike = () => S.bikes[S.bike] || bikeList()[0] || null;
export const U = b => (b && b.unit === 'km') ? 'km' : 'h';
export const bikeName = b => b ? (str(b.brand) + ' ' + str(b.model)).trim() : '';
export const allLoaded = () => COLLS.every(k => S.loaded[k]);
