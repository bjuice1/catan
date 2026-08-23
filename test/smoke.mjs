/**
 * Smoke test. Boots the real server, then drives four jsdom "phones" against
 * it through the real bundle: create a game, claim seats over one invite link,
 * play the full snake-draft setup and ~35 turns with sevens, discards and
 * robber moves. Every phone polls the server (fast, via HARBOR_POLL_MS) — no
 * link is ever passed, which is the whole point.
 *
 *   npm run build && npm test
 */
import { JSDOM } from "jsdom";
import { readFileSync } from "fs";
import { spawn } from "child_process";

const code_js = readFileSync(new URL("../bundle.js", import.meta.url), "utf8");
const PORT = 34871;
const BASE = `http://127.0.0.1:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (label, ok) => { console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}`); if (!ok) failures++; };

// the server under test is the real one — package.json's "type": "module"
// once turned server.js's require() into a crash-loop on Railway
const srv = spawn(process.execPath, [new URL("../server.js", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT) } });
let srvErr = "";
srv.stderr.on("data", (c) => { srvErr += c; });
{
  let up = false;
  for (let i = 0; i < 50 && !up; i++) {
    await sleep(100);
    try { up = (await (await fetch(BASE + "health")).text()) === "ok"; } catch { /* not yet */ }
  }
  check("server.js boots and serves /health", up);
  if (!up) { console.log(srvErr.slice(0, 500)); process.exit(1); }
}

function boot(url, seedStorage) {
  const dom = new JSDOM('<!doctype html><html><body><div id=root></div></body></html>',
    { url, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  Object.assign(w, {
    CompressionStream: globalThis.CompressionStream,
    DecompressionStream: globalThis.DecompressionStream,
    Response: globalThis.Response,
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
  });
  w.fetch = (u, o) => globalThis.fetch(u, o);
  w.HARBOR_POLL_MS = 120;
  w.btoa = (s) => Buffer.from(s, "binary").toString("base64");
  w.atob = (s) => Buffer.from(s, "base64").toString("binary");
  w.navigator.clipboard = { writeText: async () => {} };
  if (seedStorage) Object.entries(seedStorage).forEach(([k, v]) => w.localStorage.setItem(k, v));
  w.eval(code_js);
  return w;
}

const H = (w) => w.document.getElementById("root").innerHTML;
const btn = (w, t) => [...w.document.querySelectorAll("button")]
  .find((x) => x.textContent.trim().toLowerCase().includes(t.toLowerCase()));
const click = (w, t) => { const b = btn(w, t); if (!b) return false; b.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); return true; };
const tap = (w, el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
const spots = (w) => [...w.document.querySelectorAll("circle")].filter((c) => c.getAttribute("r") === "5.2");
const roadPicks = (w) => [...w.document.querySelectorAll("line")].filter((l) => l.getAttribute("stroke") === "transparent");
const setInput = (w, el, v) => {
  Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set.call(el, v);
  el.dispatchEvent(new w.Event("input", { bubbles: true }));
};
const wait = async (w, fn, ms = 5000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn(w)) return true; await sleep(60); }
  return false;
};

// ---- create a game on phone A ----
const A = boot(BASE);
await wait(A, (x) => x.document.querySelectorAll("input").length === 1);
setInput(A, A.document.querySelector("input"), "Ann");
await sleep(80);
click(A, "Create game");
await wait(A, (x) => H(x).includes("<svg"));
check("creator lands on the board with seat 0", H(A).includes("Your turn, Ann"));
const code = (H(A).match(/HARBOR · ([A-Z0-9]{4})/) || [])[1];
check("game code is visible in the header", !!code);

// ---- three more phones join via the one invite link ----
const joinLink = BASE + "#g=" + code;
const phones = [A];
for (const name of ["Ben", "Cal", "Dot"]) {
  const w = boot(joinLink);
  const picked = await wait(w, (x) => H(x).includes("pick your seat"));
  if (!picked) { check(`${name} reaches the seat picker`, false); continue; }
  setInput(w, w.document.querySelector("input"), name);
  await sleep(80);
  const open = [...w.document.querySelectorAll("button")].find((b) => b.textContent.includes("Take this seat") && !b.disabled);
  tap(w, open);
  check(`${name} claims a seat`, await wait(w, (x) => H(x).includes("<svg")));
  phones.push(w);
}
check("claimed names sync to the creator's phone",
  await wait(A, (x) => H(x).includes("Ben") && H(x).includes("Cal") && H(x).includes("Dot")));

// ---- setup: snake draft happens across phones with no link sends ----
let sawHandoffScreen = false;
const noHandoffs = () => { if (phones.some((w) => H(w).includes("SEND THIS TO"))) sawHandoffScreen = true; };
const activePlacer = async () => {
  for (let i = 0; i < 100; i++) {
    for (const w of phones) if (spots(w).length) return w;
    await sleep(60);
  }
  return null;
};
const order = [];
for (let s = 0; s < 8; s++) {
  const w = await activePlacer();
  if (!w) { check(`setup step ${s} has an active phone`, false); break; }
  order.push((H(w).match(/Your turn, ([A-Za-z]+)/) || [])[1]);
  const sp = spots(w); tap(w, sp[Math.floor(Math.random() * sp.length)]);
  await wait(w, (x) => roadPicks(x).length > 0);
  const rd = roadPicks(w); tap(w, rd[Math.floor(Math.random() * rd.length)]);
  await sleep(200);
  noHandoffs();
}
check("snake draft order is A B C D D C B A", order.join("") === "AnnBenCalDotDotCalBenAnn");
check("setup completes into the roll phase",
  await wait(phones[0], () => phones.some((w) => btn(w, "Roll the dice")), 6000));

// ---- turns: each phone acts on its own, server carries the moves ----
let passes = 0, sevens = 0, discards = 0, robbers = 0;
for (let t = 0; t < 35; t++) {
  await sleep(180);
  noHandoffs();
  // anyone who owes cards from a seven discards from their own phone
  for (const w of phones) {
    if (!btn(w, "Discard ")) continue;
    sevens++;
    click(w, "Discard "); await sleep(150);
    for (let i = 0; i < 16; i++) {
      const go = [...w.document.querySelectorAll("button")].find((b) => /^Discard \d+$/i.test(b.textContent.trim()) && !b.disabled);
      if (go) { tap(w, go); discards++; break; }
      const plus = [...w.document.querySelectorAll("button")].filter((b) => b.textContent === "+" && !b.disabled);
      if (!plus.length) break;
      tap(w, plus[0]); await sleep(60);
    }
    await sleep(250);
  }
  const roller = phones.find((w) => btn(w, "Roll the dice"));
  if (roller) { click(roller, "Roll the dice"); await sleep(280); }
  const robberW = phones.find((w) => H(w).includes("move the robber"));
  if (robberW) {
    const hx = [...robberW.document.querySelectorAll("polygon")].filter((p) => p.getAttribute("stroke") === "#e0a437");
    if (hx.length) { tap(robberW, hx[0]); robbers++; await sleep(280); }
  }
  const stealer = phones.find((w) => H(w).includes("Rob one of them"));
  if (stealer) {
    const v = [...stealer.document.querySelectorAll("button")].find((x) => /\(\d+\)/.test(x.textContent));
    if (v) { tap(stealer, v); await sleep(240); }
  }
  const ender = phones.find((w) => btn(w, "End turn"));
  if (ender) { click(ender, "End turn"); passes++; await sleep(200); }
}
check("turns advance across phones", passes > 15);
check("sevens were resolved from each phone", sevens === 0 || discards >= sevens);
check("no phone was ever asked to send a link", !sawHandoffScreen);
check("every phone still shows a coherent board", phones.every((w) => H(w).includes("<svg") && H(w).includes("HARBOR · " + code)));

// ---- the server copy stays URL-blob sized ----
const stored = await (await fetch(BASE + "api/g/" + code)).json();
check("server state blob stays small", stored.blob.length > 0 && stored.blob.length < 2000);

// ---- a phone that reopens the invite link keeps its seat ----
{
  const storage = {};
  for (let i = 0; i < A.localStorage.length; i++) { const k = A.localStorage.key(i); storage[k] = A.localStorage.getItem(k); }
  const re = boot(joinLink, storage);
  const backIn = await wait(re, (x) => H(x).includes("<svg"));
  check("reopening the invite link restores your seat", backIn && H(re).includes("you're Ann") || H(re).includes("Your turn, Ann"));
}

srv.kill();
console.log(`\nsetup steps ${order.length} · turns passed ${passes} · sevens ${sevens} · discards ${discards} · robber moves ${robbers} · blob ${stored.blob.length} chars`);
console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
