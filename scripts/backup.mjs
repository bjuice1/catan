/* Back up games from a running Harbor server, by game code.

     node scripts/backup.mjs K7QT M2XP          save those games (and any rematches after them)
     node scripts/backup.mjs --restore FILE     put saved games back on a server that lost them

   The server has no "list everything" endpoint and never reads a blob, so a
   backup starts from codes you know (the home screen lists them) and follows
   each game's rematch pointer forward to the newest game of that arena —
   which is the one carrying the whole leaderboard.

   The output has the same shape as the server's own harbor.json, so a backup
   doubles as a rehearsal data file:

     mkdir -p rehearsal && cp backups/harbor-….json rehearsal/harbor.json
     HARBOR_DATA=rehearsal PORT=3999 node server.js

   Restore only fills gaps: the server refuses any game it already holds at
   the same or a newer version, so it can never roll a live game back.

   HARBOR_URL picks the server (default: the Railway deployment). */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { gunzipSync } from "zlib";

const BASE = (process.env.HARBOR_URL || "https://catan-production-f877.up.railway.app").replace(/\/+$/, "");
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

const decode = (blob) => {
  const b64 = blob.slice(1).replace(/-/g, "+").replace(/_/g, "/");
  const raw = blob[0] === "z" ? gunzipSync(Buffer.from(b64, "base64")) : Buffer.from(b64, "base64");
  return JSON.parse(raw.toString());
};
const describe = (code, v, o) => {
  const tally = (o.ws || "").split(",").map((w, i) => `${o.n[i]} ${w || 0}`).join(", ");
  const arena = o.ar && o.ar[1] ? ` "${o.ar[1]}"` : "";
  return `${code}  v${v}  game ${o.gn || 1}${arena}  [${tally}]${o.w >= 0 ? "  finished" : ""}`;
};

if (args[0] === "--restore") {
  const file = args[1];
  if (!file) { console.log("usage: node scripts/backup.mjs --restore FILE"); process.exit(1); }
  const { games } = JSON.parse(fs.readFileSync(file, "utf8"));
  let put = 0, kept = 0, failed = 0;
  for (const [code, g] of Object.entries(games || {})) {
    // no meta: a restore must not ping anyone's phone
    const r = await fetch(`${BASE}/api/g/${code}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ v: g.v, blob: g.blob }),
    });
    if (r.ok) { put++; console.log(`restored  ${code}  v${g.v}`); }
    else if (r.status === 409) { kept++; console.log(`kept      ${code}  (server already has v${(await r.json()).v}, backup is v${g.v})`); }
    else { failed++; console.log(`FAILED    ${code}  HTTP ${r.status}`); }
  }
  console.log(`\n${put} restored · ${kept} left alone · ${failed} failed  →  ${BASE}`);
  process.exit(failed ? 1 : 0);
}

const codes = args.map((c) => c.toUpperCase()).filter((c) => /^[A-Z0-9]{4,8}$/.test(c));
if (!codes.length || codes.length !== args.length) {
  console.log("usage: node scripts/backup.mjs CODE [CODE...]   |   --restore FILE");
  process.exit(1);
}

const games = {};
let missing = 0;
for (const start of codes) {
  let code = start;
  while (code && !games[code]) {
    const r = await fetch(`${BASE}/api/g/${code}`);
    if (!r.ok) { missing++; console.log(`MISSING   ${code}  HTTP ${r.status}`); break; }
    const { v, blob } = await r.json();
    let o;
    try { o = decode(blob); } catch { missing++; console.log(`UNREADABLE ${code}`); break; }
    games[code] = { v, blob, t: Date.now() };
    console.log("saved     " + describe(code, v, o));
    code = o.rm || ""; // follow the rematch chain to the newest game
  }
}

const n = Object.keys(games).length;
if (!n) { console.log("\nnothing saved"); process.exit(1); }
const dir = path.join(ROOT, "backups");
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
const out = path.join(dir, `harbor-${stamp}.json`);
fs.writeFileSync(out, JSON.stringify({ from: BASE, at: new Date().toISOString(), games }));
console.log(`\n${n} game(s) → ${path.relative(ROOT, out)}${missing ? `  ·  ${missing} code(s) could not be saved` : ""}`);
process.exit(missing ? 1 : 0);
