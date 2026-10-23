const CACHE_NAME = "stock-pwa-v1";
const ASSETS = ["/", "/index.html", "/app.js", "/manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener("fetch", (e) => {
  // API 請求走網路，靜態檔案走快取
  if (e.request.url.includes("/api/")) {
    e.respondWith(fetch(e.request));
  } else {
    e.respondWith(
      caches.match(e.request).then((res) => res || fetch(e.request))
    );
  }
});