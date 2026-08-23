/* Harbor service worker: keeps the app shell openable offline and handles
   push notifications. Game state itself always comes from the network. */
const CACHE = "harbor-shell-v1";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.add("/")).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith("/api/")) return; // live data, never cached
  if (e.request.mode !== "navigate") return;
  // network first so deploys show up; cached shell if offline
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put("/", copy));
        return res;
      })
      .catch(() => caches.match("/"))
  );
});

self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data.json(); } catch { /* no payload */ }
  e.waitUntil(self.registration.showNotification(data.title || "Harbor", {
    body: data.body || "It's your turn.",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: "harbor-" + (data.code || "game"), // one notification per game, newest wins
    data: { code: data.code || "" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = "/#g=" + (e.notification.data.code || "");
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) { w.navigate(target); return w.focus(); }
      }
      return self.clients.openWindow(target);
    })
  );
});
