/* Racebook – Service Worker: hält die App für den Offline-Betrieb bereit.
   Die Daten liegen in IndexedDB und werden hier nie angefasst. Eine neue App-Version wird zuerst
   vollständig geladen und erst aktiv, wenn die Seite es anfordert („Jetzt aktualisieren“). */
const VERSION = 'racebook-1.4.0';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/util.js', 'js/state.js', 'js/domain.js', 'js/db.js', 'js/store.js', 'js/ops.js', 'js/ui.js',
  'js/navigation.js', 'js/preferences.js', 'js/images.js', 'js/cropper.js', 'js/zip.js', 'js/backup.js', 'js/registry.js', 'js/work.js', 'js/drafts.js',
  'js/views/home.js', 'js/views/bike.js', 'js/views/defects.js', 'js/views/data.js', 'js/views/counter.js',
  'js/label.js', 'js/ocr.js', 'js/views/stock.js',
  'icons/emblem-light.svg', 'icons/emblem-dark.svg', 'icons/favicon.svg', 'icons/icon.svg', 'icons/icon-maskable.svg',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-192.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png'
];
/* Texterkennung (ab 1.4.0): eigener Zwischenspeicher, gefüllt beim ersten Gebrauch. Er hängt nur an der Fassung der
   Erkennungsdateien, damit nicht jede App-Aktualisierung die etwa 4,5 MB erneut lädt. */
const OCR_CACHE = 'racebook-ocr-tesseract-7.0.0-deu-1';
const OCR_PATH = '/vendor/tesseract/';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(f => new Request(f, {cache: 'reload'})))));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('racebook-') && k !== VERSION && k !== OCR_CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes(OCR_PATH)) {
    e.respondWith(caches.open(OCR_CACHE).then(c => c.match(req, {ignoreSearch: true}).then(r => r || fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }))));
    return;
  }
  /* Seitenaufruf: immer die gespeicherte App-Hülle (funktioniert offline) */
  if (req.mode === 'navigate') {
    e.respondWith(caches.open(VERSION).then(c => c.match('index.html')).then(r => r || fetch(req)));
    return;
  }
  e.respondWith(caches.open(VERSION).then(c => c.match(req, {ignoreSearch: true}).then(r => r || fetch(req))));
});
