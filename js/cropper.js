/* Racebook – Bildausschnitt wählen (4:3). Ziehen oder Pfeiltasten verschieben, Regler oder +/− zoomt.
   Die Vorschau zeigt genau den Ausschnitt, der gespeichert wird. */
import {$, toast} from './ui.js';
import {decodeImage, centerCrop, BIKE_RATIO} from './images.js';

export async function openCropper(file, opts){
  opts = opts || {};
  let dec;
  try { dec = await decodeImage(file); }
  catch (e) { toast(e && e.code === 'too_big' ? 'Das Bild ist zu groß (über 30 MB).' : 'Das Bild konnte nicht gelesen werden. Versuch es mit einem JPEG oder PNG.'); return null; }
  const ratio = opts.ratio || BIKE_RATIO;
  const dlg = $('#cropDlg'), cv = $('#cropCanvas'), zoom = $('#cropZoom');
  $('#cropTitle').textContent = opts.title || 'Ausschnitt wählen';
  const base = centerCrop(dec.w, dec.h, ratio);
  let z = 1, cx = base.x + base.w / 2, cy = base.y + base.h / 2;
  const rect = () => {
    const w = base.w / z, h = base.h / z;
    cx = Math.min(Math.max(cx, w / 2), dec.w - w / 2);
    cy = Math.min(Math.max(cy, h / 2), dec.h - h / 2);
    return {x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w: Math.round(w), h: Math.round(h)};
  };
  let raf = 0;
  const draw = () => {
    raf = 0;
    const box = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(1, Math.round(box.width * dpr)), Hh = Math.max(1, Math.round(W / ratio));
    if (cv.width !== W || cv.height !== Hh) { cv.width = W; cv.height = Hh; }
    const r = rect(), ctx = cv.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(dec.src, r.x, r.y, r.w, r.h, 0, 0, W, Hh);
  };
  const redraw = () => { if (!raf) raf = requestAnimationFrame(draw); };
  zoom.value = '1';
  let drag = null;
  const down = e => { drag = {x: e.clientX, y: e.clientY, cx, cy}; cv.setPointerCapture(e.pointerId); };
  const move = e => {
    if (!drag) return;
    const s = rect().w / cv.getBoundingClientRect().width;
    cx = drag.cx - (e.clientX - drag.x) * s; cy = drag.cy - (e.clientY - drag.y) * s; redraw();
  };
  const up = () => { drag = null; };
  const setZoom = v => { z = Math.min(4, Math.max(1, v)); zoom.value = String(z); redraw(); };
  const onZoom = () => setZoom(parseFloat(zoom.value) || 1);
  const key = e => {
    const r = rect(), st = r.w * 0.05;
    if (e.key === 'ArrowLeft') cx -= st; else if (e.key === 'ArrowRight') cx += st;
    else if (e.key === 'ArrowUp') cy -= st; else if (e.key === 'ArrowDown') cy += st;
    else if (e.key === '+' || e.key === '=') { setZoom(z * 1.15); e.preventDefault(); return; }
    else if (e.key === '-') { setZoom(z / 1.15); e.preventDefault(); return; }
    else return;
    e.preventDefault(); redraw();
  };
  const wheel = e => { e.preventDefault(); setZoom(z * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); };
  cv.addEventListener('pointerdown', down); cv.addEventListener('pointermove', move);
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('keydown', key); cv.addEventListener('wheel', wheel, {passive: false});
  zoom.addEventListener('input', onZoom);
  const onResize = () => redraw();
  window.addEventListener('resize', onResize);
  return new Promise(resolve => {
    let result = null;
    const finish = () => {
      cv.removeEventListener('pointerdown', down); cv.removeEventListener('pointermove', move);
      cv.removeEventListener('pointerup', up); cv.removeEventListener('pointercancel', up);
      cv.removeEventListener('keydown', key); cv.removeEventListener('wheel', wheel);
      zoom.removeEventListener('input', onZoom); window.removeEventListener('resize', onResize);
      $('#cropOk').onclick = null; $('#cropCancel').onclick = null; $('#cropReset').onclick = null;
      dlg.removeEventListener('close', finish);
      if (!result) dec.close();
      resolve(result);
    };
    $('#cropOk').onclick = () => { result = {dec, crop: rect()}; dlg.close(); };
    $('#cropCancel').onclick = () => dlg.close();
    $('#cropReset').onclick = () => { z = 1; cx = base.x + base.w / 2; cy = base.y + base.h / 2; zoom.value = '1'; redraw(); };
    dlg.addEventListener('close', finish);
    dlg.showModal();
    requestAnimationFrame(() => { draw(); cv.focus(); });
  });
}
