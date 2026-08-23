// Serves Harbor and holds the latest state of each game as a dumb versioned
// store. State is still the client-encoded blob — the server never reads it,
// it only enforces "newer version wins". Games live in memory; if the process
// restarts, any client re-uploads its state on the next push or poll.
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(__dirname, "index.html"));
const port = process.env.PORT || 3000;

const games = new Map(); // code -> { v, blob, t }
const MAX_GAMES = 2000;
const MAX_BLOB = 20000;

const json = (res, status, obj) => {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
};

http.createServer((req, res) => {
  const m = req.url.match(/^\/api\/g\/([A-Z0-9]{4,8})$/);
  if (m) {
    const code = m[1];
    if (req.method === "GET") {
      const g = games.get(code);
      return g ? json(res, 200, { v: g.v, blob: g.blob }) : json(res, 404, { error: "no such game" });
    }
    if (req.method === "PUT") {
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > MAX_BLOB + 1000) req.destroy(); });
      req.on("end", () => {
        let v, blob;
        try { ({ v, blob } = JSON.parse(body)); } catch { return json(res, 400, { error: "bad json" }); }
        if (!Number.isInteger(v) || typeof blob !== "string" || !blob || blob.length > MAX_BLOB) {
          return json(res, 400, { error: "bad payload" });
        }
        const cur = games.get(code);
        if (cur && v <= cur.v) return json(res, 409, { v: cur.v, blob: cur.blob });
        if (!cur && games.size >= MAX_GAMES) {
          const oldest = [...games.entries()].sort((a, b) => a[1].t - b[1].t)[0];
          games.delete(oldest[0]);
        }
        games.set(code, { v, blob, t: Date.now() });
        return json(res, 200, { v });
      });
      return;
    }
    return json(res, 405, { error: "method not allowed" });
  }
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("ok");
  }
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "public, max-age=300",
  });
  res.end(html);
}).listen(port, () => console.log("Harbor listening on " + port));
