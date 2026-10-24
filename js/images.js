/* Racebook – Bilder und Dateien vorbereiten: Ausrichtung übernehmen, verkleinern, zuschneiden,
   Vorschaubild erzeugen, Prüfsumme bilden. Alles läuft auf dem Gerät. Beim Neucodieren entfallen
   die Metadaten der Kamera (z. B. GPS-Position). */
import {uid} from './util.js';

export const PHOTO_MAX = 1600;
export const THUMB_MAX = 400;
export const BIKE_RATIO = 4 / 3;
export const MAX_PDF = 40 * 1024 * 1024;
export const MAX_IMAGE_IN = 30 * 1024 * 1024;

/* Bild dekodieren; die EXIF-Ausrichtung wird angewendet (Hochformat bleibt Hochformat) */
export async function decodeImage(file){
  if (!file || (file.size != null && file.size > MAX_IMAGE_IN)) throw {code: 'too_big'};
  if (typeof createImageBitmap === 'function') {
    try {
      const bm = await createImageBitmap(file, {imageOrientation: 'from-image'});
      return {src: bm, w: bm.width, h: bm.height, close(){ try { bm.close(); } catch (e) {} }};
    } catch (e) { /* ältere Browser: über ein Bild-Element, das die Ausrichtung ebenfalls anwendet */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.decoding = 'async'; i.onload = () => res(i); i.onerror = () => rej(new Error('decode')); i.src = url; });
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('decode');
    return {src: img, w: img.naturalWidth, h: img.naturalHeight, close(){ URL.revokeObjectURL(url); }};
  } catch (e) { URL.revokeObjectURL(url); throw {code: 'decode'}; }
}

/* Ausschnitt (Quellpixel) auf höchstens maxW × maxH verkleinern und als JPEG ausgeben */
export async function render(dec, crop, maxW, maxH, q){
  crop = crop || {x: 0, y: 0, w: dec.w, h: dec.h};
  const sc = Math.min(1, maxW / crop.w, maxH / crop.h);
  const w = Math.max(1, Math.round(crop.w * sc)), h = Math.max(1, Math.round(crop.h * sc));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(dec.src, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
  const blob = await new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej({code: 'encode'}), 'image/jpeg', q || 0.82));
  cv.width = cv.height = 0;
  return {blob, w, h};
}

export async function sha256(blob){
  const buf = await blob.arrayBuffer();
  const d = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* Dateityp an den ersten Bytes erkennen (nicht an der Endung) */
export function sniff(bytes){
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2D) return 'application/pdf';
  return null;
}
export async function sniffBlob(blob){ return sniff(new Uint8Array(await blob.slice(0, 16).arrayBuffer())); }

async function fileRec(blob, o){
  return {id: 'f' + uid(), blob, type: 'image/jpeg', size: blob.size, w: o.w, h: o.h, name: o.name || '', created: Date.now(), sha256: await sha256(blob), role: o.role};
}

/* Foto für Logbuch oder Mangel: ganzes Bild, verkleinert, plus Vorschaubild */
export async function makePhoto(file){
  const dec = await decodeImage(file);
  try {
    const main = await render(dec, null, PHOTO_MAX, PHOTO_MAX, 0.82);
    const th = await render(dec, null, THUMB_MAX, THUMB_MAX, 0.75);
    const name = String(file.name || 'foto').slice(0, 120);
    const a = await fileRec(main.blob, {w: main.w, h: main.h, name, role: 'photo'});
    const b = await fileRec(th.blob, {w: th.w, h: th.h, name: 'vorschau-' + name, role: 'thumb'});
    return {photo: {id: a.id, thumbId: b.id}, files: [a, b]};
  } finally { dec.close(); }
}

/* Motorradfoto: gewählter Ausschnitt im Format 4:3 */
export async function makeBikePhoto(dec, crop, name){
  const main = await render(dec, crop, PHOTO_MAX, Math.round(PHOTO_MAX / BIKE_RATIO), 0.84);
  const th = await render(dec, crop, 480, 360, 0.78);
  const a = await fileRec(main.blob, {w: main.w, h: main.h, name: String(name || 'motorrad').slice(0, 120), role: 'bike'});
  const b = await fileRec(th.blob, {w: th.w, h: th.h, name: 'vorschau-' + String(name || 'motorrad').slice(0, 100), role: 'thumb'});
  return {photo: {id: a.id, thumbId: b.id}, files: [a, b]};
}

/* PDF-Anleitung unverändert übernehmen, nach Prüfung des Inhalts */
export async function makePdf(file){
  if (!file) throw {code: 'decode'};
  if (file.size > MAX_PDF) throw {code: 'too_big'};
  if ((await sniffBlob(file)) !== 'application/pdf') throw {code: 'not_pdf'};
  const blob = file.slice(0, file.size, 'application/pdf');
  const rec = {id: 'f' + uid(), blob, type: 'application/pdf', size: blob.size, name: String(file.name || 'anleitung.pdf').slice(0, 200), created: Date.now(), sha256: await sha256(blob), role: 'manual', w: null, h: null};
  return rec;
}

/* Anfangsausschnitt: größtmögliche 4:3-Fläche in der Bildmitte */
export function centerCrop(w, h, ratio){
  ratio = ratio || BIKE_RATIO;
  if (w / h > ratio) { const cw = Math.round(h * ratio); return {x: Math.round((w - cw) / 2), y: 0, w: cw, h}; }
  const ch = Math.round(w / ratio); return {x: 0, y: Math.round((h - ch) / 2), w, h: ch};
}
