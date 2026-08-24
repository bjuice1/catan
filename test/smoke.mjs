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
import { readFileSync, mkdtempSync } from "fs";
import { spawn } from "child_process";
import { tmpdir } from "os";
import { join } from "path";

const code_js = readFileSync(new URL("../bundle.js", import.meta.url), "utf8");
const PORT = 34871;
const BASE = `http://127.0.0.1:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (label, ok) => { console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}`); if (!ok) failures++; };

// the server under test is the real one — package.json's "type": "module"
// once turned server.js's require() into a crash-loop on Railway
const dataA = mkdtempSync(join(tmpdir(), "harbor-a-"));
const dataB = mkdtempSync(join(tmpdir(), "harbor-b-"));
const spawnServer = (dataDir = dataA) => spawn(process.execPath, [new URL("../server.js", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), HARBOR_DATA: dataDir } });
const waitHealthy = async () => {
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    try { if ((await (await fetch(BASE + "health")).text()) === "ok") return true; } catch { /* not yet */ }
  }
  return false;
};
let srv = spawnServer();
let srvErr = "";
srv.stderr.on("data", (c) => { srvErr += c; });
{
  const up = await waitHealthy();
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
  w.HARBOR_DEPUTY_MS = 250;
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
// first player is randomized, so Ann is either up or watching
check("creator lands on the board with seat 0", /Your turn, Ann|you're Ann/.test(H(A)));
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
const activePlacer = async (list = phones) => {
  for (let i = 0; i < 100; i++) {
    for (const w of list) if (spots(w).length) return w;
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
// order is randomized per game, but must be a snake: P then P reversed,
// where P is a permutation of all four names
const half = order.slice(0, 4);
check("draft order is a permutation of all four players",
  [...half].sort().join() === ["Ann", "Ben", "Cal", "Dot"].sort().join());
check("draft snakes back in reverse", order.join() === [...half, ...[...half].reverse()].join());
check("setup completes into the roll phase",
  await wait(phones[0], () => phones.some((w) => btn(w, "Roll the dice")), 6000));
{
  const roller = phones.find((w) => btn(w, "Roll the dice"));
  check("the draft's first player also rolls first",
    !!roller && (H(roller).match(/Your turn, ([A-Za-z]+)/) || [])[1] === half[0]);
}

// ---- turns: each phone acts on its own, server carries the moves ----
let passes = 0, sevens = 0, discards = 0, robbers = 0;
let deputyTried = false, deputyWorked = false;
// the own-discard button is exactly "Discard N cards" — the deputy button
// also contains the word "discard", so match precisely
const owesBtn = (w) => [...w.document.querySelectorAll("button")]
  .find((b) => /^Discard \d+ cards$/.test(b.textContent.trim()));
for (let t = 0; t < 35; t++) {
  await sleep(180);
  noHandoffs();
  // anyone who owes cards from a seven discards from their own phone
  for (const w of phones) {
    if (!owesBtn(w)) continue;
    if (!deputyTried) {
      // play the away-player: don't discard, wait for a table-mate's deputy button
      deputyTried = true;
      let helper = null;
      for (let i = 0; i < 40 && !helper; i++) {
        await sleep(100);
        helper = phones.find((x) => x !== w && btn(x, "holding things up"));
      }
      if (helper) {
        click(helper, "holding things up");
        deputyWorked = await wait(w, (x) => !owesBtn(x), 4000);
      }
      if (deputyWorked) { sevens++; discards++; continue; }
    }
    sevens++;
    tap(w, owesBtn(w)); await sleep(150);
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
check("a table-mate can discard for an away player", sevens === 0 || deputyWorked);
check("no phone was ever asked to send a link", !sawHandoffScreen);
check("every phone still shows a coherent board", phones.every((w) => H(w).includes("<svg") && H(w).includes("HARBOR · " + code)));

// ---- trade offers travel to the target's phone ----
{
  const seatOf = { Ann: 0, Ben: 1, Cal: 2, Dot: 3 };
  let offered = false, declined = false;
  for (let round = 0; round < 12 && !offered; round++) {
    await sleep(180);
    for (const w of phones) { // clear any pending sevens first
      if (owesBtn(w)) {
        tap(w, owesBtn(w)); await sleep(150);
        for (let i = 0; i < 16; i++) {
          const go = [...w.document.querySelectorAll("button")].find((b) => /^Discard \d+$/i.test(b.textContent.trim()) && !b.disabled);
          if (go) { tap(w, go); break; }
          const plus = [...w.document.querySelectorAll("button")].filter((b) => b.textContent === "+" && !b.disabled);
          if (!plus.length) break;
          tap(w, plus[0]); await sleep(60);
        }
        await sleep(250);
      }
    }
    const roller = phones.find((w) => btn(w, "Roll the dice"));
    if (roller) { click(roller, "Roll the dice"); await sleep(280); }
    const robberW = phones.find((w) => H(w).includes("move the robber"));
    if (robberW) {
      const hx = [...robberW.document.querySelectorAll("polygon")].filter((p) => p.getAttribute("stroke") === "#e0a437");
      if (hx.length) { tap(robberW, hx[0]); await sleep(280); }
    }
    const stealer = phones.find((w) => H(w).includes("Rob one of them"));
    if (stealer) {
      const v = [...stealer.document.querySelectorAll("button")].find((x) => /\(\d+\)/.test(x.textContent));
      if (v) { tap(stealer, v); await sleep(240); }
    }
    const me = phones.find((w) => btn(w, "End turn"));
    if (!me) continue;
    click(me, "trade"); await sleep(120);
    const offerBtn = btn(me, "Offer a trade");
    if (!offerBtn || offerBtn.disabled) { click(me, "End turn"); await sleep(200); continue; }
    tap(me, offerBtn); await sleep(150);
    const toBtns = [...me.document.querySelectorAll("button")].filter((b) => Object.keys(seatOf).includes(b.textContent.trim()));
    if (!toBtns.length) { click(me, "×"); click(me, "End turn"); await sleep(200); continue; }
    const targetName = toBtns[0].textContent.trim();
    tap(me, toBtns[0]); await sleep(100);
    const pluses = [...me.document.querySelectorAll("button")].filter((b) => b.textContent === "+");
    const givePlus = pluses.slice(0, 5).find((b) => !b.disabled);
    if (!givePlus) { click(me, "×"); click(me, "End turn"); await sleep(200); continue; }
    tap(me, givePlus); await sleep(80);
    tap(me, pluses[5]); await sleep(80); // want: first resource, always steppable
    click(me, "Send the offer"); await sleep(200);
    offered = true;
    const target = phones[seatOf[targetName]];
    const arrived = await wait(target, (x) => H(x).includes("offers you a trade"), 4000);
    check("a trade offer reaches the target's phone", arrived);
    click(target, "Decline");
    declined = await wait(me, (x) => !H(x).includes("Waiting on"), 4000);
    check("declining clears the offer for the offerer", declined);
  }
  if (!offered) check("a trade offer could be sent", false);
}

// ---- roll history travels through the codec and shows hot/cold ----
check("recent rolls strip shows on a synced phone", H(phones[1]).includes("LAST ROLLS"));
{
  click(phones[1], "Rolls");
  const opened = await wait(phones[1], (x) => H(x).includes("Hot and cold"));
  check("rolls sheet shows the hot and cold board", opened && / — \d+ so far/.test(H(phones[1])));
  click(phones[1], "×");
  await sleep(120);
}

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

// ---- renaming yourself mid-game syncs to everyone ----
{
  const card = A.document.querySelector('[title="Edit your name"]');
  if (card) {
    tap(A, card);
    await wait(A, (x) => !!x.document.querySelector("input"));
    setInput(A, A.document.querySelector("input"), "Annie");
    await sleep(80);
    click(A, "Save");
    check("rename syncs to the other phones", await wait(phones[1], (x) => H(x).includes("Annie")));
  } else {
    check("own player card offers a rename control", false);
  }
}

// ---- rejoining a claimed seat from a brand-new phone ----
{
  const G = boot(joinLink); // no seeded storage: a phone this game has never seen
  await wait(G, (x) => H(x).includes("pick your seat"));
  click(G, "Ben — taken · rejoin?");
  await sleep(80);
  click(G, "Yes, I'm Ben — rejoin");
  check("an unprotected seat can be rejoined from a new phone", await wait(G, (x) => H(x).includes("<svg")));
}

// ---- a secret word protects a seat from strangers ----
{
  // Annie sets a secret word on her seat
  tap(A, A.document.querySelector('[title="Edit your name"]'));
  await wait(A, (x) => x.document.querySelectorAll("input").length === 2);
  setInput(A, A.document.querySelectorAll("input")[1], "harborqueen");
  await sleep(80);
  click(A, "Save");
  await sleep(400);

  const G = boot(joinLink);
  await wait(G, (x) => H(x).includes("pick your seat"));
  click(G, "Annie — taken · rejoin?");
  await wait(G, (x) => !!x.document.querySelector('input[placeholder="Secret word"]'));
  setInput(G, G.document.querySelector('input[placeholder="Secret word"]'), "wrongword");
  await sleep(80);
  click(G, "Yes, I'm Annie — rejoin");
  await sleep(300);
  check("the wrong secret word is rejected", !H(G).includes("<svg") && H(G).includes("secret word"));
  setInput(G, G.document.querySelector('input[placeholder="Secret word"]'), "HarborQueen  ");
  await sleep(80);
  click(G, "Yes, I'm Annie — rejoin");
  check("the right secret word rejoins the seat", await wait(G, (x) => H(x).includes("<svg")));
}

// ---- PWA surface: manifest, service worker, icons ----
{
  const man = await fetch(BASE + "manifest.webmanifest");
  const manOk = man.ok && (await man.json()).name === "Harbor";
  const sw = await fetch(BASE + "sw.js");
  const swOk = sw.ok && (await sw.text()).includes("notificationclick");
  const icon = await fetch(BASE + "icon-192.png");
  const iconBytes = new Uint8Array(await icon.arrayBuffer());
  const iconOk = icon.ok && iconBytes[0] === 0x89 && iconBytes[1] === 0x50; // PNG magic
  const touch = await fetch(BASE + "apple-touch-icon.png");
  check("manifest, sw.js and icons are served", manOk && swOk && iconOk && touch.ok);
}

// ---- push plumbing: key, subscribe, and a PUT that triggers a ping ----
{
  const key = await (await fetch(BASE + "api/push/key")).json();
  check("push key endpoint serves a VAPID key", typeof key.key === "string" && key.key.length > 20);
  const subRes = await fetch(BASE + "api/push/sub/" + code, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seat: 1, sub: { endpoint: "https://127.0.0.1:9/dead", keys: { p256dh: "x", auth: "y" } } }),
  });
  check("push subscriptions are accepted", subRes.ok);
  // a turn-change PUT must succeed even though delivering to the dead endpoint fails
  const cur = await (await fetch(BASE + "api/g/" + code)).json();
  const put = await fetch(BASE + "api/g/" + code, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ v: cur.v + 1, blob: cur.blob, meta: { by: 0, turn: 1, tn: 999, discard: [], winner: null } }),
  });
  await sleep(300);
  const alive = (await (await fetch(BASE + "health")).text()) === "ok";
  check("a failing push delivery never breaks the store", put.ok && alive);
}

// ---- the lobby: the app icon opens a list of your games ----
{
  const storage = {};
  for (let i = 0; i < A.localStorage.length; i++) { const k = A.localStorage.key(i); storage[k] = A.localStorage.getItem(k); }
  const L = boot(BASE, storage); // no hash: straight to the home screen
  const listed = await wait(L, (x) => H(x).includes("Your games") && H(x).includes(code));
  check("home screen lists the games this phone is in", listed);
  const row = [...L.document.querySelectorAll("button")].find((b) => b.textContent.includes(code));
  tap(L, row);
  check("tapping a lobby game opens its board", await wait(L, (x) => H(x).includes("<svg")));
  const back = L.document.querySelector('[title="All your games"]');
  if (back) { tap(L, back); }
  check("the header takes you back to the lobby", !!back && await wait(L, (x) => H(x).includes("Your games")));
}

// ---- the volume store alone revives games across restarts ----
{
  await sleep(600); // let the debounced persist flush
  srv.kill();
  await sleep(400);
  srv = spawnServer(dataA); // same data dir = same volume
  check("games survive a restart via the data file, no phone needed",
    await waitHealthy() && (await fetch(BASE + "api/g/" + code)).ok);
}

// ---- and with a wiped volume, any phone's backup still revives it ----
{
  srv.kill();
  await sleep(400);
  srv = spawnServer(dataB); // pristine data dir = lost volume
  // (no 404 assertion here: the still-open phones re-seed the game within
  // one poll tick of the empty server coming up, which is the point)
  check("a wiped server comes back healthy", await waitHealthy());
  const storage = {};
  for (let i = 0; i < A.localStorage.length; i++) { const k = A.localStorage.key(i); storage[k] = A.localStorage.getItem(k); }
  const R = boot(joinLink, storage);
  const revived = await wait(R, (x) => H(x).includes("<svg"), 6000);
  const back = await fetch(BASE + "api/g/" + code);
  check("a phone's backup revives the lost game", revived && back.ok);
}

// ---- a two-player game works end to end through setup ----
{
  const E = boot(BASE);
  await wait(E, (x) => x.document.querySelectorAll("input").length === 1);
  setInput(E, E.document.querySelector("input"), "Uno");
  await sleep(80);
  click(E, "2");
  await sleep(80);
  click(E, "Create game");
  await wait(E, (x) => H(x).includes("<svg"));
  const code2 = (H(E).match(/HARBOR · ([A-Z0-9]{4})/) || [])[1];
  check("two-player game is created with two seats", (H(E).match(/·\s*\d+d/g) || []).length === 2);

  const F = boot(BASE + "#g=" + code2);
  await wait(F, (x) => H(x).includes("pick your seat"));
  setInput(F, F.document.querySelector("input"), "Duo");
  await sleep(80);
  const open = [...F.document.querySelectorAll("button")].find((b) => b.textContent.includes("Take this seat") && !b.disabled);
  tap(F, open);
  await wait(F, (x) => H(x).includes("<svg"));

  const pair = [E, F], order2 = [];
  for (let s = 0; s < 4; s++) {
    const w = await activePlacer(pair);
    if (!w) break;
    order2.push((H(w).match(/Your turn, ([A-Za-z]+)/) || [])[1]);
    const sp = spots(w); tap(w, sp[Math.floor(Math.random() * sp.length)]);
    await wait(w, (x) => roadPicks(x).length > 0);
    const rd = roadPicks(w); tap(w, rd[Math.floor(Math.random() * rd.length)]);
    await sleep(200);
  }
  check("two-player draft is a randomized snake",
    [...order2.slice(0, 2)].sort().join() === "Duo,Uno" &&
    order2.join() === [order2[0], order2[1], order2[1], order2[0]].join());
  check("two-player setup reaches the roll phase",
    await wait(E, () => pair.some((w) => btn(w, "Roll the dice")), 6000));
}

srv.kill();
console.log(`\nsetup steps ${order.length} · turns passed ${passes} · sevens ${sevens} · discards ${discards} · robber moves ${robbers} · blob ${stored.blob.length} chars`);
console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
