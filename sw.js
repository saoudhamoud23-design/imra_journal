// Service worker: works offline, and brings back happy memories as notifications.
importScripts('gift.js', 'db.js', 'shared.js');

const CACHE = 'little-journal-v1';
const SHELL = [
  './', 'index.html', 'style.css', 'app.js', 'gift.js', 'db.js', 'shared.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first (so updates arrive), cache as the offline fallback.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    } catch (err) {
      return (await caches.match(req, { ignoreSearch: true }))
        || (await caches.match('index.html'))
        || Response.error();
    }
  })());
});

const FREQ_HOURS = { daily: 20, every2: 44, weekly: 6 * 24 + 20 };

async function sendPing(force) {
  const s = Object.assign(
    { remind: false, freq: 'daily', from: 9, to: 21, onlyHappy: true, lastPing: 0 },
    await getKV('settings', {})
  );

  if (!force) {
    if (!s.remind) return;
    const h = new Date().getHours();
    const inWindow = s.from <= s.to ? (h >= s.from && h < s.to) : (h >= s.from || h < s.to);
    if (!inWindow) return;
    const gap = (FREQ_HOURS[s.freq] || FREQ_HOURS.daily) * 3600e3;
    if (Date.now() - s.lastPing < gap) return;
  }

  const entries = await allEntries();
  const pick = pickRandom(memoryPool(entries, s.onlyHappy));
  if (!pick) return;

  const p = pingContent(pick);
  await self.registration.showNotification(p.title, p.options);

  const cur = await getKV('settings', {});
  cur.lastPing = Date.now();
  await setKV('settings', cur);
}

// Chrome on Android runs this now and then for installed apps. It decides the exact timing.
self.addEventListener('periodicsync', event => {
  if (event.tag === 'memory-ping') event.waitUntil(sendPing(false));
});

// Future-proofing: a content-free push (if you ever add a server) just wakes this up
// and the memory is still picked from the data on her phone.
self.addEventListener('push', event => {
  event.waitUntil(sendPing(true));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const id = event.notification.data && event.notification.data.id;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of wins) {
      if ('focus' in c) {
        c.postMessage({ open: id });
        return c.focus();
      }
    }
    return self.clients.openWindow('./?m=' + encodeURIComponent(id || ''));
  })());
});
