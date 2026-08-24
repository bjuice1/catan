// Serves Harbor, holds the latest state of each game as a dumb versioned
// store, and sends push notifications on turn changes. Game state is the
// client-encoded blob — the server never reads it, it only enforces "newer
// version wins" and pings whoever the client says is up next. Games and push
// subscriptions live in memory; clients re-register and re-seed after a
// restart.
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import webpush from "web-push";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(__dirname, f));
const html = read("index.html");
const statics = {
  "/manifest.webmanifest": { body: read("manifest.webmanifest"), type: "application/manifest+json" },
  "/sw.js": { body: read("sw.js"), type: "text/javascript", noCache: true },
  "/icon-192.png": { body: read("icons/icon-192.png"), type: "image/png" },
  "/icon-512.png": { body: read("icons/icon-512.png"), type: "image/png" },
  "/icon-180.png": { body: read("icons/icon-180.png"), type: "image/png" },
  "/apple-touch-icon.png": { body: read("icons/icon-180.png"), type: "image/png" },
};
const port = process.env.PORT || 3000;

/* ---- persistence ----
   Games, push subscriptions, and the VAPID keys write through to one JSON
   file. Point HARBOR_DATA at a Railway volume mount and nothing survives-only
   -in-memory anymore; /data is picked up automatically when mounted there.
   With no volume the file still rides out crashes within a deployment, and
   phones' local backups cover the rest. */
const DATA_DIR = process.env.HARBOR_DATA || (fs.existsSync("/data") ? "/data" : path.join(__dirname, "data"));
fs.mkdirSync(DATA_DIR, { recursive: true });
const STORE = path.join(DATA_DIR, "harbor.json");
let saved = {};
try { saved = JSON.parse(fs.readFileSync(STORE, "utf8")); } catch { /* first boot */ }

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const out = {
      vapid,
      games: Object.fromEntries(games),
      subs: Object.fromEntries([...subs].map(([c, m]) => [c, Object.fromEntries(m)])),
    };
    try { fs.writeFileSync(STORE, JSON.stringify(out)); } catch (e) { console.log("persist failed: " + e.message); }
  }, 400);
}

/* VAPID keys: env beats the store, the store beats generating fresh ones */
let vapid;
if (process.env.VAPID_PUBLIC && process.env.VAPID_PRIVATE) {
  vapid = { publicKey: process.env.VAPID_PUBLIC, privateKey: process.env.VAPID_PRIVATE };
} else if (saved.vapid) {
  vapid = saved.vapid;
} else {
  vapid = webpush.generateVAPIDKeys();
}
webpush.setVapidDetails("mailto:harbor@example.com", vapid.publicKey, vapid.privateKey);

const games = new Map(Object.entries(saved.games || {}));  // code -> { v, blob, t }
const subs = new Map(Object.entries(saved.subs || {}).map(([c, m]) => [c, new Map(Object.entries(m).map(([s, x]) => [+s, x]))]));
const pinged = new Map(); // code -> Set of "seat:turnNo" already notified
persist();
if (games.size) console.log(`restored ${games.size} game(s) from ${STORE}`);
const MAX_GAMES = 2000;
const MAX_BLOB = 20000;

const json = (res, status, obj) => {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
};
const readBody = (req, cb) => {
  let body = "";
  req.on("data", (c) => { body += c; if (body.length > MAX_BLOB + 4000) req.destroy(); });
  req.on("end", () => cb(body));
};

function notify(code, seat, payload, tag) {
  const gameSubs = subs.get(code);
  const sub = gameSubs && gameSubs.get(seat);
  if (!sub) return;
  let seen = pinged.get(code);
  if (!seen) { seen = new Set(); pinged.set(code, seen); }
  if (seen.has(tag)) return;
  seen.add(tag);
  if (seen.size > 400) pinged.set(code, new Set([...seen].slice(-200)));
  webpush.sendNotification(sub, JSON.stringify(payload)).catch((err) => {
    // 404/410 mean the subscription is dead — forget it
    if (err.statusCode === 404 || err.statusCode === 410) { gameSubs.delete(seat); persist(); }
  });
}

http.createServer((req, res) => {
  const m = req.url.match(/^\/api\/g\/([A-Z0-9]{4,8})$/);
  if (m) {
    const code = m[1];
    if (req.method === "GET") {
      const g = games.get(code);
      return g ? json(res, 200, { v: g.v, blob: g.blob }) : json(res, 404, { error: "no such game" });
    }
    if (req.method === "PUT") {
      readBody(req, (body) => {
        let v, blob, meta;
        try { ({ v, blob, meta } = JSON.parse(body)); } catch { return json(res, 400, { error: "bad json" }); }
        if (!Number.isInteger(v) || typeof blob !== "string" || !blob || blob.length > MAX_BLOB) {
          return json(res, 400, { error: "bad payload" });
        }
        const cur = games.get(code);
        if (cur && v <= cur.v) return json(res, 409, { v: cur.v, blob: cur.blob });
        if (!cur && games.size >= MAX_GAMES) {
          const oldest = [...games.entries()].sort((a, b) => a[1].t - b[1].t)[0];
          games.delete(oldest[0]);
          subs.delete(oldest[0]);
          pinged.delete(oldest[0]);
        }
        games.set(code, { v, blob, t: Date.now() });
        persist();
        // the client tells us who is up; the server just delivers the nudge
        if (meta && typeof meta === "object") {
          const { turn, tn, by, discard, winner } = meta;
          const title = "Harbor · " + code;
          if (winner != null) {
            const gameSubs = subs.get(code) || new Map();
            for (const seat of gameSubs.keys()) {
              if (seat !== by) notify(code, seat, { title, body: "The game is over — come see the final board.", code }, "over:" + seat);
            }
          } else {
            if (Array.isArray(discard)) {
              for (const seat of discard) {
                if (seat !== by) notify(code, seat, { title, body: "A seven was rolled — you need to discard.", code }, `disc:${seat}:${tn}`);
              }
            }
            if (Number.isInteger(turn) && turn !== by) {
              notify(code, turn, { title, body: "Your turn.", code }, `turn:${turn}:${tn}`);
            }
          }
        }
        return json(res, 200, { v });
      });
      return;
    }
    return json(res, 405, { error: "method not allowed" });
  }

  if (req.url === "/api/push/key" && req.method === "GET") {
    return json(res, 200, { key: vapid.publicKey });
  }
  const s = req.url.match(/^\/api\/push\/sub\/([A-Z0-9]{4,8})$/);
  if (s && req.method === "POST") {
    readBody(req, (body) => {
      let seat, sub;
      try { ({ seat, sub } = JSON.parse(body)); } catch { return json(res, 400, { error: "bad json" }); }
      if (!Number.isInteger(seat) || seat < 0 || seat > 5 || !sub || typeof sub.endpoint !== "string") {
        return json(res, 400, { error: "bad payload" });
      }
      let gameSubs = subs.get(s[1]);
      if (!gameSubs) { gameSubs = new Map(); subs.set(s[1], gameSubs); }
      gameSubs.set(seat, sub);
      persist();
      return json(res, 200, { ok: true });
    });
    return;
  }

  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("ok");
  }
  const st = statics[req.url];
  if (st && req.method === "GET") {
    res.writeHead(200, { "Content-Type": st.type, "Cache-Control": st.noCache ? "no-cache" : "public, max-age=86400" });
    return res.end(st.body);
  }
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "public, max-age=300",
  });
  res.end(html);
}).listen(port, () => console.log("Harbor listening on " + port));
