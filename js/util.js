/* Racebook – reine Hilfsfunktionen: Text, Zahlen, Datum, Farben, Vergleich. Keine Oberfläche, kein Speicher. */
export const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const pad = n => String(n).padStart(2, '0');
export const str = v => (typeof v === 'string' ? v : (v == null ? '' : String(v))).trim();
export const fmt = (n, d) => (n == null || isNaN(n)) ? '–' : Number(n).toLocaleString('de-DE', {maximumFractionDigits: d == null ? 1 : d});
export const eur = n => (n == null || isNaN(n)) ? '–' : Number(n).toLocaleString('de-DE', {style:'currency', currency:'EUR'});
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const clone = o => JSON.parse(JSON.stringify(o));
export const v2 = v => v == null ? '' : String(v).replace('.', ',');
export const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const ID_RE = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
export const BAD_KEYS = ['__proto__', 'constructor', 'prototype', '.', '..'];
export const validId = id => typeof id === 'string' && ID_RE.test(id) && !BAD_KEYS.includes(id);
export const safeUrl = u => /^https?:\/\//i.test(str(u)) ? str(u) : '';
export const assetUrl = u => safeUrl(u) || (/^\/_blob\/[A-Za-z0-9]+$/.test(str(u)) ? str(u) : '');
/* ---------- Zahlen: strikt, mit Dezimalkomma ---------- */
export function validThousands(s, sep){
  const g = s.split(sep);
  return /^\d{1,3}$/.test(g[0]) && g.slice(1).every(x => /^\d{3}$/.test(x));
}
export function parseNum(raw){
  let s = String(raw == null ? '' : raw).trim().replace(/[\s  ']/g, '');
  if (s === '') return {empty: true};
  let sign = 1;
  if (s[0] === '-' || s[0] === '+') { if (s[0] === '-') sign = -1; s = s.slice(1); }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return {err: 'Bitte nur eine Zahl eingeben, z. B. 42 oder 42,5.'};
  const hasC = s.includes(','), hasD = s.includes('.');
  let ip = s, fp = '';
  if (hasC && hasD) {
    const dec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    const th = dec === ',' ? '.' : ',';
    const parts = s.split(dec);
    if (parts.length !== 2 || parts[1].includes(th) || !validThousands(parts[0], th)) return {err: 'Die Schreibweise ist unklar. Bitte z. B. 1234,5 eingeben.'};
    ip = parts[0].split(th).join(''); fp = parts[1];
  } else if (hasC) {
    const parts = s.split(',');
    if (parts.length !== 2) return {err: 'Bitte nur ein Komma verwenden, z. B. 42,5.'};
    ip = parts[0]; fp = parts[1];
  } else if (hasD) {
    const parts = s.split('.');
    if (parts.length > 2) {
      if (!validThousands(s, '.')) return {err: 'Die Schreibweise ist unklar. Bitte z. B. 12500 oder 12,5 eingeben.'};
      ip = parts.join('');
    } else {
      if (parts[1].length === 3 && parts[0] !== '' && parts[0] !== '0') return {err: 'Unklar, ob Tausenderpunkt oder Komma gemeint ist. Bitte z. B. 12500 oder 12,5 eingeben.'};
      ip = parts[0]; fp = parts[1];
    }
  }
  if (!/^\d*$/.test(ip) || !/^\d*$/.test(fp) || (ip === '' && fp === '')) return {err: 'Bitte nur eine Zahl eingeben, z. B. 42 oder 42,5.'};
  const v = sign * Number((ip || '0') + '.' + (fp || '0'));
  if (!isFinite(v)) return {err: 'Die Zahl ist zu groß.'};
  return {ok: true, value: v};
}
/* für bereits gespeicherte Daten: nur echte, endliche Zahlen */
export function num(v){
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v === 'string') { const r = parseNum(v); return r.ok ? r.value : null; }
  return null;
}
export function turns(v){
  if (v == null || isNaN(v)) return '–';
  const w = Math.floor(v + 1e-9), f = Math.round((v - w) * 100) / 100;
  const fr = {0:'', 0.25:'¼', 0.5:'½', 0.75:'¾'}[f];
  if (fr == null) return fmt(v, 2);
  return (w || !fr ? String(w) : '') + fr;
}

/* ---------- Datum: Kalendertage ohne Zeitzonen-Effekte ---------- */
export const dim = (y, m0) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
export function isISO(s){
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  return y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= dim(y, m - 1);
}
export function todayISO(){ const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
export function dayNum(iso){ const [y, m, d] = iso.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); }
export function fromDayNum(n){ return new Date(n * 864e5).toISOString().slice(0, 10); }
export function shiftDate(days){ return fromDayNum(dayNum(todayISO()) + days); }
/* Monatsfrist: auf den letzten gültigen Tag des Zielmonats begrenzt (31.01. + 1 Monat = 28.02. bzw. 29.02.) */
export function addMonths(iso, months){
  const [y, m, d] = iso.split('-').map(Number);
  const t = y * 12 + (m - 1) + months, ny = Math.floor(t / 12), nm = ((t % 12) + 12) % 12;
  return ny + '-' + pad(nm + 1) + '-' + pad(Math.min(d, dim(ny, nm)));
}
export function fmtDate(iso){ if (!isISO(iso)) return '–'; const p = iso.split('-'); return p[2] + '.' + p[1] + '.' + p[0].slice(2); }

/* ---------- Farben ---------- */
export function hexRgb(h){ h = String(h || '').replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h, 16); return isNaN(n) ? [128,128,128] : [n >> 16 & 255, n >> 8 & 255, n & 255]; }
export function rgbHex(a){ return '#' + a.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join(''); }
export function mixHex(a, b, t){ const x = hexRgb(a), y = hexRgb(b); return rgbHex(x.map((v, i) => v + (y[i] - v) * t)); }
export function lum(h){ return hexRgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0); }
export function contrast(a, b){ const A = lum(a), B2 = lum(b); return (Math.max(A, B2) + 0.05) / (Math.min(A, B2) + 0.05); }
export function towards(base, target, bg, min){ for (let t = 0; t <= 1.0001; t += 0.05) { const c = mixHex(base, target, t); if (contrast(c, bg) >= min) return c; } return target; }
export function onColor(c){ return contrast(c, '#FFFFFF') >= contrast(c, '#15120E') ? '#FFFFFF' : '#15120E'; }
export function canon(v){ return JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)) ? Object.keys(x).sort().reduce((a, kk) => { a[kk] = x[kk]; return a; }, {}) : x); }
export const same = (a, b) => canon(a) === canon(b);
export function subOf(p, d){
  if (p && typeof p === 'object' && !Array.isArray(p)) return !!d && typeof d === 'object' && Object.keys(p).every(k => subOf(p[k], d[k]));
  return same(p == null ? null : p, d == null ? null : d);
}
/* Nach einem Fehler beim Speicher nachfragen, was wirklich gespeichert ist */
