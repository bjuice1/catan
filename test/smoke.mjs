/**
 * Smoke test. Runs the real bundle in jsdom and plays a game through the UI:
 * full snake-draft setup, link hand-offs between simulated devices, then turns
 * with sevens, discards and robber moves. Catches the class of bug that unit
 * tests miss — state that survives the codec but breaks the interface.
 *
 *   npm run build && npm test
 */
import { JSDOM } from "jsdom";
import { readFileSync } from "fs";

// Read bundle.js rather than slicing it out of index.html — React's own source
// contains a literal "<script>" string that breaks naive splitting.
const code = readFileSync(new URL("../bundle.js", import.meta.url), "utf8");

const BASE = "https://harbor.test/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function boot(url) {
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
  w.btoa = (s) => Buffer.from(s, "binary").toString("base64");
  w.atob = (s) => Buffer.from(s, "base64").toString("binary");
  w.navigator.clipboard = { writeText: async () => {} };
  w.eval(code);
  return w;
}

const H = (w) => w.document.getElementById("root").innerHTML;
const btn = (w, t) => [...w.document.querySelectorAll("button")]
  .find((x) => x.textContent.trim().toLowerCase().includes(t.toLowerCase()));
const click = (w, t) => { const b = btn(w, t); if (!b) return false; b.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); return true; };
const tap = (w, el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
const spots = (w) => [...w.document.querySelectorAll("circle")].filter((c) => c.getAttribute("r") === "5.2");
const roads = (w) => [...w.document.querySelectorAll("line")].filter((l) => l.getAttribute("stroke") === "transparent");
const shownLink = (w) => (H(w).match(/https?:\/\/[^<\s]+#[A-Za-z0-9_-]+/) || [])[0] || null;
const wait = async (w, fn, ms = 4000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn(w)) return true; await sleep(80); }
  return false;
};

let failures = 0;
const check = (label, ok) => { console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}`); if (!ok) failures++; };

let w = boot(BASE);
await wait(w, (x) => x.document.querySelectorAll("input").length === 4);

const inputs = [...w.document.querySelectorAll("input")];
const setVal = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set;
["Ann", "Ben", "Cal", "Dot"].forEach((n, i) => {
  setVal.call(inputs[i], n);
  inputs[i].dispatchEvent(new w.Event("input", { bubbles: true }));
});
await sleep(120);
click(w, "Create game");
await wait(w, (x) => H(x).includes("SEND THIS TO"));
check("new game reaches the hand-off screen", H(w).includes("SEND THIS TO ANN"));

const svg = w.document.querySelector("svg");
check("board height is capped for phones", (svg.getAttribute("style") || "").includes("52vh"));
check("pinch-zoom is not blocked", !(svg.getAttribute("style") || "").includes("touch-action"));

// setup, hopping devices via the real on-screen link
let hops = 0, order = [];
for (let s = 0; s < 8; s++) {
  if (!(await wait(w, (x) => spots(x).length > 0))) { check(`setup step ${s} offers town spots`, false); break; }
  order.push((H(w).match(/playing as ([A-Za-z]+)/) || [])[1]);
  const sp = spots(w); tap(w, sp[Math.floor(Math.random() * sp.length)]);
  await wait(w, (x) => roads(x).length > 0);
  const rd = roads(w); tap(w, rd[Math.floor(Math.random() * rd.length)]);
  await sleep(280);
  if (H(w).includes("SEND THIS TO")) {
    const lk = shownLink(w);
    if (lk) { hops++; w = boot(lk); await wait(w, (x) => H(x).includes("<svg")); }
  }
}
check("snake draft order is A B C D D C B A", order.join("") === "AnnBenCalDotDotCalBenAnn");
check("six hand-offs during setup (Dot goes twice)", hops === 6);
check("setup completes into the roll phase", H(w).includes("Roll the dice"));

// play turns
let sevens = 0, discards = 0, robbers = 0, passes = 0, longest = 0;
for (let t = 0; t < 30; t++) {
  if (btn(w, "Discard ")) {
    sevens++;
    click(w, "Discard "); await sleep(160);
    for (let i = 0; i < 14; i++) {
      const go = [...w.document.querySelectorAll("button")].find((b) => /^Discard \d+$/i.test(b.textContent.trim()) && !b.disabled);
      if (go) { tap(w, go); discards++; break; }
      const plus = [...w.document.querySelectorAll("button")].filter((b) => b.textContent === "+" && !b.disabled);
      if (!plus.length) break;
      tap(w, plus[0]); await sleep(70);
    }
    await sleep(260);
    if (H(w).includes("SEND THIS TO")) {
      const l2 = shownLink(w);
      if (l2) { longest = Math.max(longest, l2.split("#")[1].length); w = boot(l2); await wait(w, (x) => H(x).includes("<svg")); }
    }
  }
  if (click(w, "Roll the dice")) await sleep(260);
  if (H(w).includes("move the robber")) {
    const hx = [...w.document.querySelectorAll("polygon")].filter((p) => p.getAttribute("stroke") === "#e0a437");
    if (hx.length) { tap(w, hx[0]); robbers++; await sleep(260); }
  }
  if (H(w).includes("Rob one of them")) {
    const v = [...w.document.querySelectorAll("button")].find((x) => /\(\d+\)/.test(x.textContent));
    if (v) { tap(w, v); await sleep(240); }
  }
  click(w, "End turn"); await sleep(280);
  if (H(w).includes("SEND THIS TO") || H(w).includes("WINS")) {
    const l3 = shownLink(w);
    if (l3) { longest = Math.max(longest, l3.split("#")[1].length); passes++; w = boot(l3); await wait(w, (x) => H(x).includes("<svg")); }
  }
}
check("turns were handed off by link", passes > 15);
check("sevens were resolved by the right players", sevens === 0 || discards === sevens);
check("link payload stays URL-sized", longest > 0 && longest < 1500);
check("game still coherent after many hand-offs", H(w).includes("<svg") && H(w).includes("playing as"));

console.log(`\nsetup hops ${hops} · turns passed ${passes} · sevens ${sevens} · robber moves ${robbers} · longest link ${longest} chars`);
console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
