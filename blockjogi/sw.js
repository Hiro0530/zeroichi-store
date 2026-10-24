// 最新を優先し、電波がない時だけ保存した版を出す
const C = "blockjogi-v1";
self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(C).then((ca) => ca.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
