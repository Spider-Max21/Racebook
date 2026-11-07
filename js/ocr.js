/* Racebook – Texterkennung auf dem Gerät für „Artikel aus einem Foto“ (ab 1.4.0).
   Liest Text auf Etiketten und Bildschirmfotos (OCR). Das ist keine Produkterkennung: Racebook erkennt nicht, was
   ein Gegenstand ist, sondern nur, was darauf geschrieben steht.
   Alles läuft im Browser: Tesseract.js (Apache-2.0) mit deutschen Sprachdaten liegt unverändert in vendor/tesseract/
   und wird erst beim ersten Erkennen von derselben Adresse wie die App geladen (danach offline aus dem Zwischenspeicher
   des Service Workers). Es werden keine Bilder oder Texte an andere Dienste geschickt, es gibt keine Schlüssel.
   Strichcodes liest Racebook nur, wenn der Browser das selbst auf dem Gerät kann (BarcodeDetector, z. B. Chrome auf
   Android); sonst wird ohne Strichcode erkannt. */
import {decodeImage} from './images.js';

export const OCR_BASE = new URL('../vendor/tesseract/', import.meta.url).href;
/* Dateien der Erkennung; geladen wird je Gerät nur eine der beiden Kernvarianten (mit oder ohne SIMD) */
export const OCR_FILES = ['tesseract.min.js', 'worker.min.js', 'tesseract-core-simd-lstm.js', 'tesseract-core-simd-lstm.wasm', 'tesseract-core-lstm.js', 'tesseract-core-lstm.wasm', 'deu.traineddata.gz'];
const OCR_MAX = 1600;
const T = () => window.__T || null;

let scriptP = null, current = null;
function loadScript(){
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!scriptP) scriptP = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = OCR_BASE + 'tesseract.min.js'; s.async = true;
    s.onload = () => window.Tesseract ? res(window.Tesseract) : rej({code: 'unavailable'});
    s.onerror = () => { s.remove(); rej({code: 'unavailable'}); };
    document.head.appendChild(s);
  }).catch(e => { scriptP = null; throw e; });
  return scriptP;
}
/* WebAssembly-SIMD vorhanden? (gleiche Prüfung wie in Tesseract.js; ohne SIMD langsamer, aber gleich genau) */
function simd(){ const t = T(); if (t && t.noSimd) return false; try { return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])); } catch (e) { return false; } }

/* Bild für die Erkennung: Ausrichtung übernehmen, auf höchstens 1600 px verkleinern; dazu eine Graustufen-Fassung
   mit vertauschten Hell/Dunkel-Werten (helle Schrift auf dunklem Grund) */
async function canvases(blob){
  const dec = await decodeImage(blob);
  try {
    const sc = Math.min(1, OCR_MAX / Math.max(dec.w, dec.h)), w = Math.max(1, Math.round(dec.w * sc)), h = Math.max(1, Math.round(dec.h * sc));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(dec.src, 0, 0, w, h);
    const g = document.createElement('canvas'); g.width = w; g.height = h;
    const gx = g.getContext('2d'), d = x.getImageData(0, 0, w, h), a = d.data;
    for (let i = 0; i < a.length; i += 4) { const v = 255 - (0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2]); a[i] = a[i + 1] = a[i + 2] = v; }
    gx.putImageData(d, 0, 0);
    return {c, inv: g};
  } finally { dec.close(); }
}
const overlap = (a, b) => { const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0); return w > 0 && h > 0 ? (w * h) / Math.max(1, Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0))) : 0; };
function linesOf(r){
  const out = [];
  ((r && r.data && r.data.blocks) || []).forEach(b => (b.paragraphs || []).forEach(p => (p.lines || []).forEach(l => {
    const t = String(l.text || '').replace(/\s+/g, ' ').trim();
    if (t) out.push({t, c: Math.round(l.confidence || 0), h: l.bbox.y1 - l.bbox.y0, box: l.bbox});
  })));
  return out;
}
/* Zeilen eines weiteren Durchgangs nur dort ergänzen, wo der erste nichts Lesbares gefunden hat */
function merge(base, more){
  more.forEach(l => { if (l.c >= 60 && !base.some(b => b.c >= 40 && overlap(b.box, l.box) > 0.3)) base.push(l); });
  return base;
}

/* Laufende Erkennung abbrechen (Formular verworfen, anderes Bild gewählt) */
export function cancel(){ const w = current; current = null; if (w) { w.cancelled = true; try { w.worker && w.worker.terminate(); } catch (e) {} } }

/* Erkennen: {lines: [{t, c, h}], codes: [{format, value}], ms}. Fehler: {code: 'unavailable'|'cancelled'|'decode'|'too_big'} */
export async function recognize(blob, onProgress){
  cancel();
  const run = current = {worker: null, cancelled: false};
  const step = (status, p) => { if (!run.cancelled && onProgress) { try { onProgress(status, p); } catch (e) {} } };
  const t0 = Date.now();
  const stop = () => { if (run.cancelled) throw {code: 'cancelled'}; };
  const t = T();
  if (t && t.ocrDelay) await new Promise(r => setTimeout(r, t.ocrDelay));
  step('Bild wird vorbereitet', 0);
  const cv = await canvases(blob); stop();
  /* Strichcodes nur mit der Erkennung des Browsers (auf dem Gerät); fehlt sie, wird ohne erkannt */
  let codes = [];
  if (typeof window.BarcodeDetector === 'function') {
    try { const bd = new window.BarcodeDetector(); codes = (await bd.detect(cv.c)).map(x => ({format: String(x.format || ''), value: String(x.rawValue || '')})).filter(x => x.value); } catch (e) { codes = []; }
  }
  stop();
  step('Texterkennung wird geladen', 0);
  let TS;
  try { TS = await loadScript(); } catch (e) { throw {code: 'unavailable'}; }
  stop();
  try {
    run.worker = await TS.createWorker('deu', 1, {
      workerPath: OCR_BASE + 'worker.min.js', corePath: OCR_BASE + (simd() ? 'tesseract-core-simd-lstm.js' : 'tesseract-core-lstm.js'),
      langPath: OCR_BASE.replace(/\/$/, ''), gzip: true, cacheMethod: 'none', workerBlobURL: false,
      logger: m => { if (m && m.status === 'recognizing text') step('Text wird gelesen', m.progress); }
    });
  } catch (e) { if (run.cancelled) throw {code: 'cancelled'}; throw {code: 'unavailable'}; }
  try {
    stop();
    await run.worker.setParameters({tessedit_pageseg_mode: '3'});
    const opt = {text: true, blocks: true};
    const lines = linesOf(await run.worker.recognize(cv.c, {}, opt)); stop();
    merge(lines, linesOf(await run.worker.recognize(cv.inv, {}, opt))); stop();
    /* Kaum Text gefunden: noch einmal als verstreuten Text lesen (kleine Etiketten neben Gegenständen) */
    if (lines.filter(l => l.c >= 60 && /[A-Za-zÄÖÜäöü]{3}/.test(l.t)).length < 2) {
      await run.worker.setParameters({tessedit_pageseg_mode: '11'});
      merge(lines, linesOf(await run.worker.recognize(cv.c, {}, opt))); stop();
    }
    lines.sort((a, b) => (a.box.y0 - b.box.y0) || (a.box.x0 - b.box.x0));
    return {lines: lines.map(l => ({t: l.t, c: l.c, h: l.h})), codes, ms: Date.now() - t0};
  } catch (e) {
    if (run.cancelled || (e && e.code === 'cancelled')) throw {code: 'cancelled'};
    throw {code: 'unavailable'};
  } finally {
    if (current === run) current = null;
    try { await run.worker.terminate(); } catch (e) {}
    cv.c.width = cv.c.height = cv.inv.width = cv.inv.height = 0;
  }
}

/* Für den Offlinebetrieb vorab laden (Einstellungen): holt die Dateien einmal, der Service Worker legt sie ab */
export async function prefetch(){
  const core = simd() ? 'tesseract-core-simd-lstm' : 'tesseract-core-lstm';
  const need = ['tesseract.min.js', 'worker.min.js', core + '.js', core + '.wasm', 'deu.traineddata.gz'];
  for (const f of need) { const r = await fetch(OCR_BASE + f, {cache: 'no-cache'}); if (!r.ok) throw {code: 'unavailable'}; await r.arrayBuffer(); }
  return true;
}
export async function offlineReady(){
  try {
    if (!('caches' in window)) return false;
    const core = simd() ? 'tesseract-core-simd-lstm' : 'tesseract-core-lstm';
    for (const f of ['tesseract.min.js', 'worker.min.js', core + '.js', core + '.wasm', 'deu.traineddata.gz']) { if (!(await caches.match(OCR_BASE + f))) return false; }
    return true;
  } catch (e) { return false; }
}
