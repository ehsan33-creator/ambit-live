/* Ambit Live service worker — network-first so deploys are never stale;
 * cached copy is only used when offline. Socket traffic is left alone. */
const CACHE = "ambit-live-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  const url = e.request.url;
  if (e.request.method !== "GET" || !url.startsWith(self.location.origin) || url.includes("/socket.io/")) return;
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request))
  );
});
