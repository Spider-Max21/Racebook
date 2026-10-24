/* Racebook – ZIP-Dateien schreiben und lesen, ohne fremde Bibliothek.
   Schreiben: unkomprimiert („stored“); Fotos und PDFs sind ohnehin komprimiert.
   Lesen: „stored“ und „deflate“ (über DecompressionStream des Browsers). Jede Datei wird gegen
   ihre CRC-32-Prüfsumme geprüft; beschädigte oder manipulierte Archive werden abgelehnt. */

const CRC_T = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(bytes, crc){
  let c = (crc || 0) ^ 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_T[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
const zerr = msg => ({code: 'zip', message: msg});

function dos(d){
  d = d instanceof Date ? d : new Date();
  const y = Math.max(1980, d.getFullYear());
  return {time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2), date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()};
}

/* entries: [{name, data: Uint8Array | Blob, date?}] → Blob */
export async function makeZip(entries){
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  const seen = new Set();
  for (const e of entries) {
    if (seen.has(e.name)) throw zerr('Doppelter Dateiname im Archiv: ' + e.name);
    seen.add(e.name);
    const bytes = e.data instanceof Uint8Array ? e.data : new Uint8Array(await e.data.arrayBuffer());
    const name = enc.encode(e.name), crc = crc32(bytes), size = bytes.length, t = dos(e.date);
    if (offset + size > 0xFFFFFFF0) throw zerr('Die Sicherung ist zu groß für eine ZIP-Datei.');
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, t.time, true); lh.setUint16(12, t.date, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, e.data instanceof Blob ? e.data : bytes);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, t.time, true); ch.setUint16(14, t.date, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, size, true); ch.setUint32(24, size, true); ch.setUint16(28, name.length, true);
    ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + size;
  }
  const cdSize = central.reduce((a, p) => a + p.length, 0);
  const eo = new DataView(new ArrayBuffer(22));
  eo.setUint32(0, 0x06054b50, true); eo.setUint16(4, 0, true); eo.setUint16(6, 0, true);
  eo.setUint16(8, entries.length, true); eo.setUint16(10, entries.length, true);
  eo.setUint32(12, cdSize, true); eo.setUint32(16, offset, true); eo.setUint16(20, 0, true);
  return new Blob(parts.concat(central, [new Uint8Array(eo.buffer)]), {type: 'application/zip'});
}

async function inflate(bytes, max){
  if (typeof DecompressionStream !== 'function') throw zerr('Dieser Browser kann komprimierte ZIP-Dateien nicht lesen.');
  const ds = new DecompressionStream('deflate-raw');
  const w = ds.writable.getWriter();
  w.write(bytes).catch(() => {}); w.close().catch(() => {});
  const r = ds.readable.getReader(), out = [];
  let n = 0;
  for (;;) {
    let c;
    try { c = await r.read(); } catch (e) { throw zerr('Eine Datei im Archiv ist beschädigt.'); }
    if (c.done) break;
    n += c.value.length;
    if (n > max) { try { r.cancel(); } catch (e) {} throw zerr('Eine Datei im Archiv ist größer als angegeben.'); }
    out.push(c.value);
  }
  const res = new Uint8Array(n); let o = 0;
  out.forEach(p => { res.set(p, o); o += p.length; });
  return res;
}

/* Inhaltsverzeichnis lesen. Ergebnis: Map name → {size, read(): Promise<Uint8Array>} */
export async function readZip(blob, lim){
  lim = Object.assign({maxEntries: 5000, maxTotal: 1024 * 1024 * 1024}, lim || {});
  const size = blob.size;
  if (size < 22) throw zerr('Die Datei ist zu kurz für eine ZIP-Datei.');
  const tailLen = Math.min(size, 22 + 65535);
  const tail = new Uint8Array(await blob.slice(size - tailLen).arrayBuffer());
  let p = -1;
  for (let i = tail.length - 22; i >= 0; i--) { if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) { p = i; break; } }
  if (p < 0) throw zerr('Das ist keine vollständige ZIP-Datei (Inhaltsverzeichnis fehlt). Vielleicht wurde sie nicht ganz heruntergeladen.');
  const ev = new DataView(tail.buffer, p, 22);
  const n = ev.getUint16(10, true), cdSize = ev.getUint32(12, true), cdOff = ev.getUint32(16, true);
  if (n === 0xFFFF || cdOff === 0xFFFFFFFF) throw zerr('Dieses ZIP-Format (ZIP64) wird nicht unterstützt.');
  if (n > lim.maxEntries) throw zerr('Das Archiv enthält zu viele Dateien.');
  const eocdAbs = size - tailLen + p;
  if (cdOff + cdSize > eocdAbs) throw zerr('Das Inhaltsverzeichnis der ZIP-Datei ist beschädigt.');
  const cd = new Uint8Array(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const dv = new DataView(cd.buffer);
  const dec = new TextDecoder('utf-8', {fatal: false}), decL = new TextDecoder('latin1');
  const map = new Map();
  let o = 0, total = 0;
  for (let i = 0; i < n; i++) {
    if (o + 46 > cd.length || dv.getUint32(o, true) !== 0x02014b50) throw zerr('Das Inhaltsverzeichnis der ZIP-Datei ist beschädigt.');
    const flags = dv.getUint16(o + 8, true), method = dv.getUint16(o + 10, true), crc = dv.getUint32(o + 16, true);
    const csize = dv.getUint32(o + 20, true), usize = dv.getUint32(o + 24, true);
    const nl = dv.getUint16(o + 28, true), xl = dv.getUint16(o + 30, true), cl = dv.getUint16(o + 32, true), lo = dv.getUint32(o + 42, true);
    if (o + 46 + nl > cd.length) throw zerr('Das Inhaltsverzeichnis der ZIP-Datei ist beschädigt.');
    const nb = cd.subarray(o + 46, o + 46 + nl);
    const name = (flags & 0x0800) ? dec.decode(nb) : decL.decode(nb);
    o += 46 + nl + xl + cl;
    if (flags & 0x0001) throw zerr('Verschlüsselte ZIP-Dateien werden nicht unterstützt.');
    if (method !== 0 && method !== 8) throw zerr('Unbekannte Komprimierung im Archiv (' + name + ').');
    if (csize === 0xFFFFFFFF || usize === 0xFFFFFFFF || lo === 0xFFFFFFFF) throw zerr('Dieses ZIP-Format (ZIP64) wird nicht unterstützt.');
    if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) throw zerr('Ungültiger Dateiname im Archiv.');
    if (name.endsWith('/')) continue;
    if (map.has(name)) throw zerr('Doppelter Dateiname im Archiv: ' + name);
    if (lo + 30 > cdOff) throw zerr('Die ZIP-Datei ist beschädigt (' + name + ').');
    total += usize;
    if (total > lim.maxTotal) throw zerr('Das Archiv ist zu groß.');
    map.set(name, {name, size: usize, method, read: async () => {
      const h = new DataView(await blob.slice(lo, lo + 30).arrayBuffer());
      if (h.byteLength < 30 || h.getUint32(0, true) !== 0x04034b50) throw zerr('Die ZIP-Datei ist beschädigt (' + name + ').');
      const start = lo + 30 + h.getUint16(26, true) + h.getUint16(28, true);
      if (start + csize > cdOff) throw zerr('Die ZIP-Datei ist beschädigt oder unvollständig (' + name + ').');
      const raw = new Uint8Array(await blob.slice(start, start + csize).arrayBuffer());
      const data = method === 0 ? raw : await inflate(raw, usize);
      if (data.length !== usize) throw zerr('Eine Datei im Archiv hat die falsche Größe (' + name + ').');
      if (crc32(data) !== crc) throw zerr('Eine Datei im Archiv ist beschädigt, die Prüfsumme stimmt nicht (' + name + ').');
      return data;
    }});
  }
  return map;
}
export async function isZip(blob){
  if (!blob || blob.size < 4) return false;
  const b = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  return b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05) ;
}
