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
import { gunzipSync } from "zlib";

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
    // temp-then-rename: a crash mid-write must never leave torn JSON
    try {
      fs.writeFileSync(STORE + ".tmp", JSON.stringify(out));
      fs.renameSync(STORE + ".tmp", STORE);
    } catch (e) { console.log("persist failed: " + e.message); }
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

/* Live link previews: peek inside the blob (it's just gzipped JSON — the
   server stays otherwise blob-blind) and rewrite the OG tags per game. */
const htmlStr = html.toString();
const escapeAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
function ogHtml(code) {
  const g = games.get(code);
  if (!g) return html;
  try {
    const b64 = g.blob.slice(1).replace(/-/g, "+").replace(/_/g, "/");
    let raw = Buffer.from(b64, "base64");
    if (g.blob[0] === "z") raw = gunzipSync(raw);
    const o = JSON.parse(raw.toString());
    const names = (o.n || []).filter((_, i) => o.cl && o.cl[i]).join(", ");
    let desc;
    if (o.w >= 0) desc = `${o.n[o.w]} won! ${names}`;
    else if (o.ph === 8) desc = `In the lobby — ${(o.cl || []).filter(Boolean).length} of ${(o.n || []).length} aboard. Tap to take a seat.`;
    else desc = `Game on — ${o.n[o.tu]} is up. ${names}`;
    return htmlStr
      .replace('<meta property="og:title" content="Harbor">', `<meta property="og:title" content="${escapeAttr("Harbor · " + code)}">`)
      .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${escapeAttr(desc)}">`);
  } catch { return html; }
}

/* If a turn (or a seven-discard) has sat untouched for a while, ping the
   people the game is waiting on again — one push is easy to miss. */
const NUDGE_MS = Number(process.env.HARBOR_NUDGE_MS) || 30 * 60 * 1000;
setInterval(() => {
  for (const [code, g] of games) {
    if (!g.meta || g.meta.winner != null) continue;
    const idle = Date.now() - g.t;
    if (idle < NUDGE_MS) continue;
    const nth = Math.floor(idle / NUDGE_MS);
    if (nth > 2) continue; // two reminders, then let the group chat handle it
    const targets = new Set([g.meta.turn, ...(Array.isArray(g.meta.discard) ? g.meta.discard : [])]);
    for (const seat of targets) {
      if (!Number.isInteger(seat)) continue;
      notify(code, seat, { title: "Harbor · " + code, body: "Still your move — the island waits.", code }, `nudge:${seat}:${g.meta.tn}:${nth}`);
    }
  }
}, Math.min(NUDGE_MS / 3, 5 * 60 * 1000));

/* long-poll: GET ?since=N holds until the game moves past N (or ~20s) */
const waiters = new Map(); // code -> Set of { res, timer }
function flushWaiters(code) {
  const set = waiters.get(code);
  if (!set) return;
  waiters.delete(code);
  const g = games.get(code);
  for (const w of set) {
    clearTimeout(w.timer);
    if (g) json(w.res, 200, { v: g.v, blob: g.blob });
    else json(w.res, 404, { error: "no such game" });
  }
}

http.createServer((req, res) => {
  const u = new URL(req.url, "http://harbor.local");
  const m = u.pathname.match(/^\/api\/g\/([A-Z0-9]{4,8})$/);
  if (m) {
    const code = m[1];
    if (req.method === "GET") {
      const g = games.get(code);
      if (!g) return json(res, 404, { error: "no such game" });
      const since = Number(u.searchParams.get("since"));
      if (!u.searchParams.has("since") || !Number.isInteger(since) || g.v > since) {
        return json(res, 200, { v: g.v, blob: g.blob });
      }
      // nothing new: hold the request open until a PUT lands or we time out
      let set = waiters.get(code);
      if (!set) { set = new Set(); waiters.set(code, set); }
      if (set.size >= 32) return json(res, 200, { unchanged: true });
      const w = { res, timer: null };
      w.timer = setTimeout(() => { set.delete(w); json(res, 200, { unchanged: true }); }, 20000);
      set.add(w);
      req.on("close", () => { clearTimeout(w.timer); set.delete(w); });
      return;
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
        games.set(code, { v, blob, t: Date.now(), meta: meta && typeof meta === "object" ? meta : null });
        persist();
        flushWaiters(code);
        // the client tells us who is up; the server just delivers the nudge
        if (meta && typeof meta === "object") {
          const { turn, tn, by, discard, winner, tradeTo, rematch } = meta;
          if (typeof rematch === "string" && rematch) {
            const gameSubs = subs.get(code) || new Map();
            for (const seat of gameSubs.keys()) {
              if (seat !== by) notify(code, seat, { title: "Harbor · " + code, body: "A rematch is starting — tap to join.", code }, `rm:${seat}:${rematch}`);
            }
          }
          if (Number.isInteger(tradeTo) && tradeTo !== by && winner == null) {
            notify(code, tradeTo, { title: "Harbor · " + code, body: "You have a trade offer.", code }, `trade:${tradeTo}:${v}`);
          }
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

  /* /g/CODE serves the app with live OG tags, so the invite link previews
     in iMessage as the actual game, not a generic page */
  const pg = u.pathname.match(/^\/g\/([A-Za-z0-9]{4,8})$/);
  if (pg && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    return res.end(ogHtml(pg[1].toUpperCase()));
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
