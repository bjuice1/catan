import React, { useState, useEffect, useMemo, useRef } from "react";

/* ============================================================
   HARBOR — an untimed, play-by-turn settlers game for 4 friends
   Everyone opens the same link. State lives in shared storage.
   ============================================================ */

const RES = ["brick", "lumber", "wool", "grain", "ore"];
const RES_LABEL = { brick: "Brick", lumber: "Lumber", wool: "Wool", grain: "Grain", ore: "Ore" };
const RES_ICON = { brick: "🧱", lumber: "🪵", wool: "🐑", grain: "🌾", ore: "🪨" };
const TERRAIN_ICON = { hills: "🧱", forest: "🌲", pasture: "🐑", fields: "🌾", mountains: "🪨", desert: "🏜️" };
const TERRAIN_RES = {
  hills: "brick", forest: "lumber", pasture: "wool",
  fields: "grain", mountains: "ore", desert: null,
};
const HEX_FILL = {
  hills: "#a8563a", forest: "#2e5a3b", pasture: "#8fae57",
  fields: "#d7a83a", mountains: "#69727e", desert: "#cdbb8d",
};
const RES_COLOR = {
  brick: "#a8563a", lumber: "#2e5a3b", wool: "#8fae57",
  grain: "#d7a83a", ore: "#69727e",
};
const PC = [
  { name: "Red", hex: "#c2412d" },
  { name: "Blue", hex: "#3b7fb0" },
  { name: "Orange", hex: "#dd8a2a" },
  { name: "Bone", hex: "#e9e4d6" },
];
const C = {
  sea: "#0e2a35", seaDeep: "#071c25", ink: "#061419",
  parch: "#efe6d2", parchDim: "#bfb69f", line: "#1e4a5a",
  gold: "#e0a437", rust: "#c05a3f", panel: "#0c2129",
};

const COST = {
  road: { brick: 1, lumber: 1 },
  settlement: { brick: 1, lumber: 1, wool: 1, grain: 1 },
  city: { grain: 2, ore: 3 },
  dev: { wool: 1, grain: 1, ore: 1 },
};
const LIMIT = { road: 15, settlement: 5, city: 4 };
const SIZE = 10;
const HW = Math.sqrt(3) * SIZE;

/* ---------- small utils ---------- */
const clone = (o) => JSON.parse(JSON.stringify(o));
const shuffle = (a) => {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
};
const emptyHand = () => ({ brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 });
const handTotal = (h) => RES.reduce((s, r) => s + (h[r] || 0), 0);
const pips = (n) => 6 - Math.abs(7 - n);
const snap = (n) => { const v = Math.round(n * 10) / 10; return (Object.is(v, -0) ? 0 : v).toFixed(1); };
const vid = (x, y) => `${snap(x)}:${snap(y)}`;
const eid = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const ends = (e) => e.split("|");

/* ---------- board generation ---------- */
function hexCorners(cx, cy) {
  const out = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 90);
    out.push([cx + SIZE * Math.cos(a), cy + SIZE * Math.sin(a)]);
  }
  return out;
}

function baseGeometry() {
  const rows = [3, 4, 5, 4, 3];
  const hexes = [];
  rows.forEach((n, r) => {
    const y = (r - 2) * 1.5 * SIZE;
    const x0 = (-(n - 1) / 2) * HW;
    for (let i = 0; i < n; i++) {
      hexes.push({ id: `h${hexes.length}`, cx: x0 + i * HW, cy: y, corners: [], verts: [] });
    }
  });

  const vertexHexes = {};
  const vertexPos = {};
  const edgeHexes = {};

  hexes.forEach((h) => {
    const cs = hexCorners(h.cx, h.cy);
    h.corners = cs;
    h.verts = cs.map(([x, y]) => {
      const id = vid(x, y);
      vertexPos[id] = { x, y };
      (vertexHexes[id] = vertexHexes[id] || []).push(h.id);
      return id;
    });
    for (let i = 0; i < 6; i++) {
      const e = eid(h.verts[i], h.verts[(i + 1) % 6]);
      (edgeHexes[e] = edgeHexes[e] || []).push(h.id);
    }
  });

  const vertexEdges = {};
  Object.keys(edgeHexes).forEach((e) => {
    const [a, b] = ends(e);
    (vertexEdges[a] = vertexEdges[a] || []).push(e);
    (vertexEdges[b] = vertexEdges[b] || []).push(e);
  });

  // coastal edges, ordered around the ring
  const coast = Object.keys(edgeHexes)
    .filter((e) => edgeHexes[e].length === 1)
    .map((e) => {
      const [a, b] = ends(e);
      const mx = (vertexPos[a].x + vertexPos[b].x) / 2;
      const my = (vertexPos[a].y + vertexPos[b].y) / 2;
      return { e, ang: Math.atan2(my, mx), mx, my };
    })
    .sort((p, q) => p.ang - q.ang);

  return { hexes, vertexPos, vertexHexes, vertexEdges, edgeHexes, coast };
}

const GEO = baseGeometry();

function hexNeighbors(hexes) {
  const nb = {};
  hexes.forEach((a) => {
    nb[a.id] = [];
    hexes.forEach((b) => {
      if (a.id === b.id) return;
      const shared = a.verts.filter((v) => b.verts.includes(v)).length;
      if (shared === 2) nb[a.id].push(b.id);
    });
  });
  return nb;
}
const HEX_NB = hexNeighbors(GEO.hexes);

function makeBoard() {
  const terrain = shuffle([
    ...Array(4).fill("forest"), ...Array(4).fill("pasture"), ...Array(4).fill("fields"),
    ...Array(3).fill("hills"), ...Array(3).fill("mountains"), "desert",
  ]);
  const tokens = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

  let hexes = null;
  for (let attempt = 0; attempt < 800; attempt++) {
    const t = attempt === 0 ? terrain : shuffle(terrain);
    const nums = shuffle(tokens);
    let k = 0;
    const cand = GEO.hexes.map((h, i) => ({
      id: h.id, cx: h.cx, cy: h.cy, verts: h.verts,
      terrain: t[i],
      number: t[i] === "desert" ? null : nums[k++],
    }));
    const byId = Object.fromEntries(cand.map((h) => [h.id, h]));
    const bad = cand.some((h) =>
      HEX_NB[h.id].some((n) => {
        const o = byId[n];
        if (!h.number || !o.number) return false;
        const red = (x) => x === 6 || x === 8;
        return (red(h.number) && red(o.number)) || h.number === o.number;
      })
    );
    if (!bad) { hexes = cand; break; }
    if (attempt === 799) hexes = cand;
  }

  const portTypes = shuffle(["any", "any", "any", "any", "brick", "lumber", "wool", "grain", "ore"]);
  const slots = [0, 3, 7, 10, 13, 17, 20, 23, 27];
  const ports = slots.map((s, i) => {
    const c = GEO.coast[s % GEO.coast.length];
    const [a, b] = ends(c.e);
    return { type: portTypes[i], edge: c.e, verts: [a, b], mx: c.mx, my: c.my };
  });

  return {
    hexes,
    ports,
    robber: hexes.find((h) => h.terrain === "desert").id,
  };
}

/* ---------- board lookups ---------- */
const hexById = (board, id) => board.hexes.find((h) => h.id === id);
const vertexHexIds = (v) => GEO.vertexHexes[v] || [];
const vertexNeighborVerts = (v) =>
  (GEO.vertexEdges[v] || []).map((e) => { const [a, b] = ends(e); return a === v ? b : a; });

/* ---------- placement legality ---------- */
function canPlaceSettlement(g, v, p, setup) {
  if (g.buildings[v]) return false;
  if (vertexNeighborVerts(v).some((n) => g.buildings[n])) return false;
  /* house rule: no towns mid-run of a single colour's road — a corner where
     two or more roads meet is only buildable when different colours contest
     it. (Player 0 is falsy: compare against undefined, never truthiness.) */
  const roadOwners = (GEO.vertexEdges[v] || []).filter((e) => g.roads[e] !== undefined).map((e) => g.roads[e]);
  if (roadOwners.length >= 2 && new Set(roadOwners).size === 1) return false;
  if (setup) return true;
  return (GEO.vertexEdges[v] || []).some((e) => g.roads[e] === p);
}
function canPlaceRoad(g, e, p, restrictVertex) {
  if (g.roads[e] !== undefined) return false;
  const [a, b] = ends(e);
  if (restrictVertex) return a === restrictVertex || b === restrictVertex;
  const touches = (v) => {
    const b2 = g.buildings[v];
    if (b2 && b2.owner === p) return true;
    if (b2 && b2.owner !== p) return false; // can't build through an opponent's town
    return (GEO.vertexEdges[v] || []).some((x) => g.roads[x] === p);
  };
  return touches(a) || touches(b);
}
const legalSettlements = (g, p, setup) =>
  Object.keys(GEO.vertexPos).filter((v) => canPlaceSettlement(g, v, p, setup));
const legalCities = (g, p) =>
  Object.keys(g.buildings).filter((v) => g.buildings[v].owner === p && g.buildings[v].type === "settlement");
const legalRoads = (g, p, restrictVertex) =>
  Object.keys(GEO.edgeHexes).filter((e) => canPlaceRoad(g, e, p, restrictVertex));

/* ---------- economy ---------- */
const canAfford = (hand, cost) => Object.keys(cost).every((r) => (hand[r] || 0) >= cost[r]);
const pay = (hand, cost) => { Object.keys(cost).forEach((r) => (hand[r] -= cost[r])); };
const countOwned = (g, p, type) =>
  type === "road"
    ? Object.values(g.roads).filter((o) => o === p).length
    : Object.values(g.buildings).filter((b) => b.owner === p && b.type === type).length;

function portsFor(g, p) {
  const owned = Object.keys(g.buildings).filter((v) => g.buildings[v].owner === p);
  const out = new Set();
  g.board.ports.forEach((pt) => { if (pt.verts.some((v) => owned.includes(v))) out.add(pt.type); });
  return out;
}
function tradeRate(g, p, res) {
  const ports = portsFor(g, p);
  if (ports.has(res)) return 2;
  if (ports.has("any")) return 3;
  return 4;
}

/* ---------- longest road ---------- */
function longestRoadFor(g, p) {
  const mine = Object.keys(g.roads).filter((e) => g.roads[e] === p);
  if (!mine.length) return 0;
  const vE = {};
  mine.forEach((e) => { const [a, b] = ends(e); (vE[a] = vE[a] || []).push(e); (vE[b] = vE[b] || []).push(e); });
  const blocked = (v) => { const b = g.buildings[v]; return !!b && b.owner !== p; };
  let best = 0;
  const walk = (v, used, start) => {
    if (used.size > best) best = used.size;
    if (!start && blocked(v)) return;
    for (const e of vE[v] || []) {
      if (used.has(e)) continue;
      const [a, b] = ends(e);
      used.add(e);
      walk(a === v ? b : a, used, false);
      used.delete(e);
    }
  };
  mine.forEach((e) => { const [a, b] = ends(e); walk(a, new Set(), true); walk(b, new Set(), true); });
  return best;
}

function recomputeAwards(g) {
  // longest road: 5+, challenger must beat the holder outright
  let holder = g.longestRoad;
  g.players.forEach((_, i) => { g.roadLen[i] = longestRoadFor(g, i); });
  let len = holder == null ? 4 : g.roadLen[holder];
  g.players.forEach((_, i) => {
    if (i !== holder && g.roadLen[i] >= 5 && g.roadLen[i] > len) { holder = i; len = g.roadLen[i]; }
  });
  if (holder != null && g.roadLen[holder] < 5) { holder = null; len = 4; }
  g.longestRoad = holder;
  g.longestRoadLen = holder == null ? 0 : g.roadLen[holder];

  let ah = g.largestArmy;
  let an = ah == null ? 2 : g.knights[ah];
  g.players.forEach((_, i) => { if (g.knights[i] >= 3 && g.knights[i] > an) { ah = i; an = g.knights[i]; } });
  g.largestArmy = ah;
}

function scoreFor(g, i, includeHidden) {
  let s = countOwned(g, i, "settlement") + countOwned(g, i, "city") * 2;
  if (g.longestRoad === i) s += 2;
  if (g.largestArmy === i) s += 2;
  if (includeHidden) s += (g.devHands[i] || []).filter((c) => c.type === "vp").length;
  return s;
}

/* ---------- dev deck ---------- */
const makeDevDeck = () =>
  shuffle([
    ...Array(14).fill("knight"),
    ...Array(5).fill("vp"),
    ...Array(2).fill("road"),
    ...Array(2).fill("plenty"),
    ...Array(2).fill("monopoly"),
  ]);
const DEV_LABEL = {
  knight: "Knight", vp: "Victory point", road: "Road building",
  plenty: "Year of plenty", monopoly: "Monopoly",
};
const DEV_TEXT = {
  knight: "Move the robber, then steal a card.",
  vp: "Worth 1 point. Stays hidden until you win.",
  road: "Build 2 roads for free.",
  plenty: "Take any 2 resources from the bank.",
  monopoly: "Name a resource. Everyone hands you all of theirs.",
};

/* ---------- game creation ---------- */
function newGame(code, names) {
  const board = makeBoard();
  const n = names.length;
  /* who goes first is random — the creator gets no edge */
  const base = shuffle(Array.from({ length: n }, (_, i) => i));
  const order = [...base, ...base.slice().reverse()];
  return {
    v: 1,
    code,
    seq: 0,
    createdAt: Date.now(),
    hostTok: "",
    players: names.map((nm, i) => ({ name: nm, color: i, claimed: false, lock: "", tok: "" })),
    board,
    buildings: {},
    roads: {},
    hands: names.map(() => emptyHand()),
    devHands: names.map(() => []),
    devDeck: makeDevDeck(),
    bank: { brick: 19, lumber: 19, wool: 19, grain: 19, ore: 19 },
    knights: names.map(() => 0),
    roadLen: names.map(() => 0),
    longestRoad: null,
    longestRoadLen: 0,
    largestArmy: null,
    turn: order[0],
    turnNo: 0,
    rolls: [],
    sevenAt: 0,
    phase: "lobby",
    setupOrder: order,
    setupIdx: 0,
    lastSetupVertex: null,
    dice: null,
    pendingDiscard: {},
    stealFrom: [],
    robberReturn: "main",
    freeRoads: 0,
    devPlayed: false,
    trade: null,
    winner: null,
    log: [{ t: Date.now(), m: "Game created. Place your first town." }],
  };
}

const say = (g, m) => { g.log.push({ t: Date.now(), m }); if (g.log.length > 120) g.log = g.log.slice(-120); };
const pname = (g, i) => g.players[i]?.name ?? "?";

/* ---------- lobby ---------- */
const resetLobbyOrder = (g) => {
  const b = Array.from({ length: g.players.length }, (_, i) => i);
  g.setupOrder = [...b, ...b.slice().reverse()];
  g.turn = 0;
};
function lobbyKick(g, i) {
  const p = g.players[i];
  if (g.phase !== "lobby" || !p || !p.claimed) return false;
  say(g, `${p.name} was removed from the lobby.`);
  p.claimed = false; p.tok = ""; p.lock = ""; p.name = `Player ${i + 1}`;
  return g;
}
function lobbyRemoveSeat(g, i) {
  if (g.phase !== "lobby" || g.players.length <= 2 || !g.players[i] || g.players[i].claimed) return false;
  g.players.splice(i, 1); g.hands.splice(i, 1); g.devHands.splice(i, 1);
  g.knights.splice(i, 1); g.roadLen.splice(i, 1);
  g.players.forEach((p, j) => { p.color = j; if (!p.claimed) p.name = `Player ${j + 1}`; });
  resetLobbyOrder(g);
  say(g, "A seat was removed.");
  return g;
}
function lobbyAddSeat(g) {
  if (g.phase !== "lobby" || g.players.length >= 4) return false;
  const j = g.players.length;
  g.players.push({ name: `Player ${j + 1}`, color: j, claimed: false, lock: "", tok: "" });
  g.hands.push(emptyHand()); g.devHands.push([]); g.knights.push(0); g.roadLen.push(0);
  resetLobbyOrder(g);
  say(g, "A seat was added.");
  return g;
}
/* the moment everyone is in (or the host says go), shuffle who starts */
function startLobby(g, dropOpen) {
  if (g.phase !== "lobby") return false;
  if (dropOpen) {
    for (let i = g.players.length - 1; i >= 0; i--) {
      if (!g.players[i].claimed) {
        g.players.splice(i, 1); g.hands.splice(i, 1); g.devHands.splice(i, 1);
        g.knights.splice(i, 1); g.roadLen.splice(i, 1);
      }
    }
    g.players.forEach((p, j) => { p.color = j; });
  }
  const n = g.players.length;
  if (n < 2 || g.players.some((p) => !p.claimed)) return false;
  const base = shuffle(Array.from({ length: n }, (_, i) => i));
  g.setupOrder = [...base, ...base.slice().reverse()];
  g.setupIdx = 0;
  g.turn = base[0];
  g.phase = "setupTown";
  say(g, `Anchors up — ${pname(g, g.turn)} places first.`);
  return g;
}

/* ---------- setup phase ---------- */
function placeSetupTown(g, v, p) {
  g.buildings[v] = { owner: p, type: "settlement" };
  g.lastSetupVertex = v;
  g.phase = "setupRoad";
  say(g, `${pname(g, p)} founded a town.`);
  if (g.setupIdx >= g.players.length) {
    vertexHexIds(v).forEach((hid) => {
      const h = hexById(g.board, hid);
      const r = TERRAIN_RES[h.terrain];
      if (r && g.bank[r] > 0) { g.hands[p][r] += 1; g.bank[r] -= 1; }
    });
    say(g, `${pname(g, p)} collected from the surrounding land.`);
  }
  return g;
}
function placeSetupRoad(g, e, p) {
  g.roads[e] = p;
  g.setupIdx += 1;
  g.lastSetupVertex = null;
  if (g.setupIdx >= g.setupOrder.length) {
    recomputeAwards(g);
    g.turn = g.setupOrder[0];
    g.turnNo = 1;
    g.phase = "roll";
    say(g, `Setup complete. ${pname(g, g.turn)} rolls first.`);
  } else {
    g.turn = g.setupOrder[g.setupIdx];
    g.phase = "setupTown";
  }
  return g;
}

/* ---------- rolling & production ---------- */
function distribute(g, roll) {
  const claims = {}; // res -> [{p, n}]
  g.board.hexes.forEach((h) => {
    if (h.number !== roll || g.board.robber === h.id) return;
    const r = TERRAIN_RES[h.terrain];
    if (!r) return;
    h.verts.forEach((v) => {
      const b = g.buildings[v];
      if (!b) return;
      (claims[r] = claims[r] || []).push({ p: b.owner, n: b.type === "city" ? 2 : 1 });
    });
  });
  const gained = {};
  Object.keys(claims).forEach((r) => {
    const list = claims[r];
    const need = list.reduce((s, c) => s + c.n, 0);
    const owners = new Set(list.map((c) => c.p));
    if (need > g.bank[r] && owners.size > 1) {
      say(g, `The bank is out of ${RES_LABEL[r].toLowerCase()} — nobody collects it.`);
      return;
    }
    list.forEach((c) => {
      const amt = Math.min(c.n, g.bank[r]);
      if (amt <= 0) return;
      g.hands[c.p][r] += amt;
      g.bank[r] -= amt;
      gained[c.p] = gained[c.p] || {};
      gained[c.p][r] = (gained[c.p][r] || 0) + amt;
    });
  });
  const parts = Object.keys(gained).map(
    (p) => `${pname(g, +p)} +${Object.entries(gained[p]).map(([r, n]) => `${n} ${RES_LABEL[r].toLowerCase()}`).join(", ")}`
  );
  say(g, parts.length ? parts.join(" · ") : "Nobody collected anything.");
}

function rollDice(g) {
  const d1 = 1 + Math.floor(Math.random() * 6);
  const d2 = 1 + Math.floor(Math.random() * 6);
  g.dice = [d1, d2];
  g.rolls.push(d1 + d2);
  if (g.rolls.length > 200) g.rolls = g.rolls.slice(-200);
  const sum = d1 + d2;
  say(g, `${pname(g, g.turn)} rolled ${sum} (${d1}+${d2}).`);
  if (sum === 7) {
    const pend = {};
    g.hands.forEach((h, i) => { const t = handTotal(h); if (t > 7) pend[i] = Math.floor(t / 2); });
    g.pendingDiscard = pend;
    g.robberReturn = "main";
    if (Object.keys(pend).length) {
      g.phase = "discard";
      g.sevenAt = Date.now();
      say(g, `Seven — ${Object.keys(pend).map((i) => pname(g, +i)).join(", ")} must discard.`);
    } else {
      g.phase = "robber";
      say(g, "Seven — move the robber.");
    }
  } else {
    distribute(g, sum);
    g.phase = "main";
  }
  return g;
}

function doDiscard(g, p, sel, deputy) {
  RES.forEach((r) => { g.hands[p][r] -= sel[r] || 0; g.bank[r] += sel[r] || 0; });
  delete g.pendingDiscard[p];
  say(g, deputy == null
    ? `${pname(g, p)} discarded ${handTotal(sel)}.`
    : `${pname(g, deputy)} discarded ${handTotal(sel)} random cards for ${pname(g, p)} (they were away).`);
  if (!Object.keys(g.pendingDiscard).length) {
    g.phase = "robber";
    say(g, `${pname(g, g.turn)} moves the robber.`);
  }
  return g;
}

/* a table-mate throws random cards for a player who has wandered off */
function deputyDiscard(g, p, by) {
  const owed = g.pendingDiscard[p];
  if (!owed) return false;
  const pool = [];
  RES.forEach((r) => { for (let i = 0; i < g.hands[p][r]; i++) pool.push(r); });
  const sel = emptyHand();
  for (let i = 0; i < owed && pool.length; i++) {
    sel[pool.splice(Math.floor(Math.random() * pool.length), 1)[0]] += 1;
  }
  return doDiscard(g, p, sel, by);
}

function moveRobber(g, hid, p) {
  g.board.robber = hid;
  const h = hexById(g.board, hid);
  const victims = new Set();
  h.verts.forEach((v) => {
    const b = g.buildings[v];
    if (b && b.owner !== p && handTotal(g.hands[b.owner]) > 0) victims.add(b.owner);
  });
  g.stealFrom = [...victims];
  say(g, `${pname(g, p)} moved the robber.`);
  if (g.stealFrom.length === 1) return stealFrom(g, g.stealFrom[0], p);
  if (g.stealFrom.length === 0) {
    say(g, `No one to rob there — nobody with cards borders that hex.`);
    g.phase = g.robberReturn;
    return g;
  }
  g.phase = "steal";
  return g;
}

function stealFrom(g, victim, p) {
  const pool = [];
  RES.forEach((r) => { for (let i = 0; i < g.hands[victim][r]; i++) pool.push(r); });
  if (pool.length) {
    const r = pool[Math.floor(Math.random() * pool.length)];
    g.hands[victim][r] -= 1;
    g.hands[p][r] += 1;
    say(g, `${pname(g, p)} stole a card from ${pname(g, victim)}.`);
    /* underscore fields are never pack()ed — this stays on the thief's phone */
    g._stole = { from: pname(g, victim), res: r };
  }
  g.stealFrom = [];
  g.phase = g.robberReturn;
  return g;
}

/* ---------- building ---------- */
function buildRoad(g, e, p) {
  const free = g.freeRoads > 0;
  if (free) {
    g.freeRoads -= 1;
  } else {
    pay(g.hands[p], COST.road);
    RES.forEach((r) => { g.bank[r] += COST.road[r] || 0; });
  }
  g.roads[e] = p;
  recomputeAwards(g);
  say(g, `${pname(g, p)} built a road${free ? " (free)" : ""}.`);
  return g;
}
function buildTown(g, v, p) {
  pay(g.hands[p], COST.settlement);
  RES.forEach((r) => { g.bank[r] += COST.settlement[r] || 0; });
  g.buildings[v] = { owner: p, type: "settlement" };
  recomputeAwards(g);
  say(g, `${pname(g, p)} built a town.`);
  return g;
}
function buildCity(g, v, p) {
  pay(g.hands[p], COST.city);
  RES.forEach((r) => { g.bank[r] += COST.city[r] || 0; });
  g.buildings[v] = { owner: p, type: "city" };
  say(g, `${pname(g, p)} upgraded to a city.`);
  return g;
}
function buyDev(g, p) {
  pay(g.hands[p], COST.dev);
  RES.forEach((r) => { g.bank[r] += COST.dev[r] || 0; });
  const card = g.devDeck.pop();
  g.devHands[p].push({ type: card, turn: g.turnNo, used: false });
  say(g, `${pname(g, p)} bought a development card.`);
  return g;
}

/* ---------- development cards ---------- */
function playDev(g, p, idx, payload) {
  const card = g.devHands[p][idx];
  card.used = true;
  g.devPlayed = true;
  if (card.type === "knight") {
    g.knights[p] += 1;
    recomputeAwards(g);
    g.robberReturn = g.phase === "roll" ? "roll" : "main";
    g.phase = "robber";
    say(g, `${pname(g, p)} played a knight.`);
  } else if (card.type === "road") {
    g.freeRoads = 2;
    say(g, `${pname(g, p)} played road building.`);
  } else if (card.type === "plenty") {
    payload.forEach((r) => { if (g.bank[r] > 0) { g.bank[r] -= 1; g.hands[p][r] += 1; } });
    say(g, `${pname(g, p)} took ${payload.map((r) => RES_LABEL[r].toLowerCase()).join(" and ")}.`);
  } else if (card.type === "monopoly") {
    const r = payload;
    let got = 0;
    g.hands.forEach((h, i) => { if (i !== p) { got += h[r]; h[r] = 0; } });
    g.hands[p][r] += got;
    say(g, `${pname(g, p)} monopolised ${RES_LABEL[r].toLowerCase()} and took ${got}.`);
  }
  return g;
}

/* ---------- trading ---------- */
const fmtHand = (h) => RES.filter((r) => h[r] > 0).map((r) => `${h[r]} ${RES_LABEL[r].toLowerCase()}`).join(" + ") || "nothing";

function offerTrade(g, from, to, give, want) {
  if (!RES.every((r) => g.hands[from][r] >= (give[r] || 0))) return false;
  g.trade = { from, to, give, want };
  say(g, `${pname(g, from)} offered ${pname(g, to)} a trade: ${fmtHand(give)} for ${fmtHand(want)}.`);
  return g;
}
function acceptTrade(g) {
  const t = g.trade;
  if (!t) return false;
  const ok = RES.every((r) => g.hands[t.from][r] >= (t.give[r] || 0) && g.hands[t.to][r] >= (t.want[r] || 0));
  g.trade = null;
  if (!ok) {
    say(g, `The trade fell through — someone no longer had the cards.`);
    return g;
  }
  RES.forEach((r) => {
    g.hands[t.from][r] += (t.want[r] || 0) - (t.give[r] || 0);
    g.hands[t.to][r] += (t.give[r] || 0) - (t.want[r] || 0);
  });
  say(g, `${pname(g, t.to)} accepted ${pname(g, t.from)}'s trade.`);
  return g;
}
function declineTrade(g, byOfferer) {
  const t = g.trade;
  if (!t) return false;
  g.trade = null;
  say(g, byOfferer ? `${pname(g, t.from)} withdrew the trade offer.` : `${pname(g, t.to)} declined the trade.`);
  return g;
}

function bankTrade(g, p, give, want) {
  const rate = tradeRate(g, p, give);
  g.hands[p][give] -= rate;
  g.bank[give] += rate;
  g.hands[p][want] += 1;
  g.bank[want] -= 1;
  say(g, `${pname(g, p)} traded ${rate} ${RES_LABEL[give].toLowerCase()} for 1 ${RES_LABEL[want].toLowerCase()}.`);
  return g;
}

/* ---------- turn end / win ---------- */
function endTurn(g) {
  const p = g.turn;
  if (scoreFor(g, p, true) >= 10) {
    g.winner = p;
    g.phase = "over";
    say(g, `${pname(g, p)} reached 10 points and wins.`);
    return g;
  }
  /* play proceeds in the drafted order, not seat order */
  const base = g.setupOrder.slice(0, g.players.length);
  g.turn = base[(base.indexOf(g.turn) + 1) % base.length];
  g.turnNo += 1;
  g.phase = "roll";
  g.dice = null;
  g.devPlayed = false;
  g.freeRoads = 0;
  g.trade = null;
  return g;
}


/* ============================================================
   Codec — the whole game squeezed into a URL
   ============================================================ */
const T_LIST = ["hills", "forest", "pasture", "fields", "mountains", "desert"];
const P_LIST = ["any", "brick", "lumber", "wool", "grain", "ore"];
const D_LIST = ["knight", "vp", "road", "plenty", "monopoly"];
/* "lobby" must stay LAST — these indices are baked into every live blob */
const PH_LIST = ["setupTown", "setupRoad", "roll", "main", "discard", "robber", "steal", "over", "lobby"];

const VIDX = Object.keys(GEO.vertexPos).sort();
const EIDX = Object.keys(GEO.edgeHexes).sort();
const vI = Object.fromEntries(VIDX.map((v, i) => [v, i]));
const eI = Object.fromEntries(EIDX.map((e, i) => [e, i]));
const hI = Object.fromEntries(GEO.hexes.map((h, i) => [h.id, i]));

function makeCode4() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join("");
}

function pack(g) {
  const flatB = [];
  Object.entries(g.buildings).forEach(([v, b]) => flatB.push(vI[v], b.owner, b.type === "city" ? 1 : 0));
  const flatR = [];
  Object.entries(g.roads).forEach(([e, o]) => flatR.push(eI[e], o));
  const flatPD = [];
  Object.entries(g.pendingDiscard).forEach(([p, n]) => flatPD.push(+p, n));
  return {
    c: g.code,
    q: g.seq || 0,
    n: g.players.map((p) => p.name),
    cl: g.players.map((p) => (p.claimed ? 1 : 0)),
    lk: g.players.map((p) => p.lock || ""),
    tk: g.players.map((p) => p.tok || ""),
    ht: g.hostTok || "",
    t: g.board.hexes.map((h) => T_LIST.indexOf(h.terrain)).join(""),
    m: g.board.hexes.map((h) => h.number || 0).join(","),
    rb: hI[g.board.robber],
    pt: g.board.ports.map((p) => P_LIST.indexOf(p.type)).join(""),
    b: flatB,
    r: flatR,
    h: g.hands.map((x) => RES.map((r) => x[r])),
    bk: RES.map((r) => g.bank[r]),
    dh: g.devHands.map((cards) => cards.map((c) => [D_LIST.indexOf(c.type), c.turn, c.used ? 1 : 0])),
    dd: g.devDeck.map((d) => D_LIST.indexOf(d)).join(""),
    kn: g.knights,
    lr: g.longestRoad == null ? -1 : g.longestRoad,
    ll: g.longestRoadLen,
    la: g.largestArmy == null ? -1 : g.largestArmy,
    tu: g.turn, tn: g.turnNo,
    so: g.setupOrder.slice(0, g.players.length).join(""),
    rl: g.rolls.join(","),
    sa: g.sevenAt || 0,
    tr: g.trade ? [g.trade.from, g.trade.to, ...RES.map((r) => g.trade.give[r] || 0), ...RES.map((r) => g.trade.want[r] || 0)] : 0,
    ph: PH_LIST.indexOf(g.phase),
    si: g.setupIdx,
    lv: g.lastSetupVertex == null ? -1 : vI[g.lastSetupVertex],
    d: g.dice || 0,
    pd: flatPD,
    sf: g.stealFrom,
    rr: PH_LIST.indexOf(g.robberReturn),
    fr: g.freeRoads,
    dp: g.devPlayed ? 1 : 0,
    w: g.winner == null ? -1 : g.winner,
    lg: g.log.slice(-30).map((l) => l.m),
  };
}

function unpack(o) {
  const nums = o.m.split(",").map(Number);
  const hexes = GEO.hexes.map((h, i) => ({
    id: h.id, cx: h.cx, cy: h.cy, verts: h.verts,
    terrain: T_LIST[+o.t[i]],
    number: nums[i] || null,
  }));
  const slots = [0, 3, 7, 10, 13, 17, 20, 23, 27];
  const ports = slots.map((s, i) => {
    const c = GEO.coast[s % GEO.coast.length];
    const [a, b] = ends(c.e);
    return { type: P_LIST[+o.pt[i]], edge: c.e, verts: [a, b], mx: c.mx, my: c.my };
  });
  const buildings = {};
  for (let i = 0; i < o.b.length; i += 3) buildings[VIDX[o.b[i]]] = { owner: o.b[i + 1], type: o.b[i + 2] ? "city" : "settlement" };
  const roads = {};
  for (let i = 0; i < o.r.length; i += 2) roads[EIDX[o.r[i]]] = o.r[i + 1];
  const pendingDiscard = {};
  for (let i = 0; i < o.pd.length; i += 2) pendingDiscard[o.pd[i]] = o.pd[i + 1];
  const n = o.n.length;
  /* legacy blobs predate the shuffled order and used seat order */
  const base = o.so ? [...o.so].map(Number) : Array.from({ length: n }, (_, i) => i);
  const order = [...base, ...base.slice().reverse()];

  const g = {
    v: 1, code: o.c,
    seq: o.q || 0,
    /* legacy blobs have no cl — everyone starts unclaimed and re-picks a seat */
    hostTok: o.ht || "",
    players: o.n.map((nm, i) => ({ name: nm, color: i, claimed: !!(o.cl && o.cl[i]), lock: (o.lk && o.lk[i]) || "", tok: (o.tk && o.tk[i]) || "" })),
    board: { hexes, ports, robber: GEO.hexes[o.rb].id },
    buildings, roads,
    hands: o.h.map((x) => Object.fromEntries(RES.map((r, i) => [r, x[i]]))),
    bank: Object.fromEntries(RES.map((r, i) => [r, o.bk[i]])),
    devHands: o.dh.map((cards) => cards.map((c) => ({ type: D_LIST[c[0]], turn: c[1], used: !!c[2] }))),
    devDeck: o.dd.split("").map((d) => D_LIST[+d]),
    knights: o.kn,
    roadLen: o.n.map(() => 0),
    longestRoad: o.lr < 0 ? null : o.lr,
    longestRoadLen: o.ll,
    largestArmy: o.la < 0 ? null : o.la,
    turn: o.tu, turnNo: o.tn,
    rolls: o.rl ? o.rl.split(",").map(Number) : [],
    sevenAt: o.sa || 0,
    phase: PH_LIST[o.ph],
    setupOrder: order, setupIdx: o.si,
    lastSetupVertex: o.lv < 0 ? null : VIDX[o.lv],
    dice: o.d || null,
    pendingDiscard,
    stealFrom: o.sf,
    robberReturn: PH_LIST[o.rr],
    freeRoads: o.fr,
    devPlayed: !!o.dp,
    trade: o.tr ? {
      from: o.tr[0], to: o.tr[1],
      give: Object.fromEntries(RES.map((r, i) => [r, o.tr[2 + i]])),
      want: Object.fromEntries(RES.map((r, i) => [r, o.tr[7 + i]])),
    } : null,
    winner: o.w < 0 ? null : o.w,
    log: o.lg.map((m) => ({ t: 0, m })),
  };
  g.players.forEach((_, i) => { g.roadLen[i] = longestRoadFor(g, i); });
  return g;
}

/* gzip via CompressionStream, with a plain-base64 fallback */
const b64url = (bytes) => {
  let s = "";
  bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64url = (str) => {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
};

async function encodeGame(g) {
  const json = JSON.stringify(pack(g));
  if (typeof CompressionStream === "undefined") return "u" + b64url(new TextEncoder().encode(json));
  const cs = new CompressionStream("gzip");
  const w = cs.writable.getWriter();
  w.write(new TextEncoder().encode(json)); w.close();
  const buf = await new Response(cs.readable).arrayBuffer();
  return "z" + b64url(new Uint8Array(buf));
}
/* ---------- server sync ----------
   The server is a dumb versioned store: GET returns {v, blob}, PUT accepts
   only a strictly newer v (else 409 with the current state). v is g.seq. */
const apiUrl = (code) => new URL("/api/g/" + code, window.location.href).toString();
/* Every phone keeps the newest blob it has seen per game, so any player can
   silently restore a game the server lost in a restart or redeploy. */
const blobKey = (code) => "harbor-blob-" + code;
function cacheBlob(code, v, blob) {
  try {
    const cur = JSON.parse(window.localStorage.getItem(blobKey(code)) || "null");
    if (!cur || v > cur.v) window.localStorage.setItem(blobKey(code), JSON.stringify({ v, blob }));
  } catch { /* best effort */ }
}
function cachedBlob(code) {
  try { return JSON.parse(window.localStorage.getItem(blobKey(code)) || "null"); } catch { return null; }
}

async function serverGet(code) {
  try {
    const r = await fetch(apiUrl(code));
    if (!r.ok) return null;
    const j = await r.json();
    cacheBlob(code, j.v, j.blob);
    return j;
  } catch { return null; }
}

/* push this phone's backup of a lost game back onto the server */
async function restoreGame(code) {
  const c = cachedBlob(code);
  if (!c) return null;
  try {
    await fetch(apiUrl(code), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ v: c.v, blob: c.blob }),
    });
  } catch { return null; }
  return c;
}
async function serverPut(g, by) {
  const blob = await encodeGame(g);
  /* meta lets the server ping whoever is up next without reading the blob */
  const meta = {
    by: by == null ? -1 : by,
    turn: g.turn, tn: g.turnNo,
    discard: Object.keys(g.pendingDiscard || {}).map(Number),
    winner: g.winner == null ? null : g.winner,
    tradeTo: g.trade ? g.trade.to : null,
  };
  try {
    const r = await fetch(apiUrl(g.code), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ v: g.seq || 0, blob, meta }),
    });
    if (r.ok) { cacheBlob(g.code, g.seq || 0, blob); return { ok: true }; }
    if (r.status === 409) return { ok: false, conflict: await r.json() };
    return { ok: false };
  } catch { return { ok: false, offline: true }; }
}

/* Casual protection only: the state is client-readable by design, so this
   hash keeps honest friends honest — it is not cryptography. */
const hashWord = (s) => {
  let h = 5381;
  for (const ch of s.trim().toLowerCase()) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return h.toString(36);
};

/* per-device identity token per game: lets a phone find its seat even after
   lobby seats shift, and lets a kick actually stick */
const tokKey = (code) => "harbor-tok-" + code;
function tokOf(code) {
  try { return window.localStorage.getItem(tokKey(code)) || ""; } catch { return ""; }
}
function makeTok(code) {
  let t = tokOf(code);
  if (t) return t;
  t = Array.from({ length: 8 }, () => "abcdefghjkmnpqrstuvwxyz23456789"[Math.floor(Math.random() * 31)]).join("");
  try { window.localStorage.setItem(tokKey(code), t); } catch { /* best effort */ }
  return t;
}

const seatKey = (code) => "harbor-seat-" + code;
function knownSeat(code) {
  try { const s = window.localStorage.getItem(seatKey(code)); return s == null ? null : +s; } catch { return null; }
}
function rememberSeat(code, i) {
  try { window.localStorage.setItem(seatKey(code), String(i)); } catch { /* best effort */ }
}

/* the lobby: every game this phone has sat down in */
function knownGames() {
  try { return JSON.parse(window.localStorage.getItem("harbor-games") || "[]"); } catch { return []; }
}
function rememberGame(code) {
  try {
    const list = knownGames().filter((g) => g.code !== code);
    list.unshift({ code, t: Date.now() });
    window.localStorage.setItem("harbor-games", JSON.stringify(list.slice(0, 12)));
  } catch { /* best effort */ }
}
function forgetGame(code) {
  try {
    window.localStorage.setItem("harbor-games", JSON.stringify(knownGames().filter((g) => g.code !== code)));
  } catch { /* best effort */ }
}

/* ---------- push notifications ---------- */
const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in window.navigator &&
  "PushManager" in window && "Notification" in window;

function vapidToBytes(b64url) {
  const s = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const bin = window.atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

/* Subscribe (or quietly re-subscribe if the server's key rotated) and tell
   the server which seat this phone is. Safe to call repeatedly. */
async function syncPush(code, seat) {
  if (!pushSupported() || window.Notification.permission !== "granted") return false;
  try {
    const reg = await window.navigator.serviceWorker.ready;
    const { key } = await (await fetch(new URL("/api/push/key", window.location.href))).json();
    let sub = await reg.pushManager.getSubscription();
    if (sub) {
      const cur = sub.options.applicationServerKey && btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey)))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      if (cur && cur !== key) { await sub.unsubscribe(); sub = null; }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidToBytes(key) });
    await fetch(new URL("/api/push/sub/" + code, window.location.href), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seat, sub: sub.toJSON() }),
    });
    return true;
  } catch { return false; }
}

async function decodeGame(str) {
  const tag = str[0], body = unb64url(str.slice(1));
  let json;
  if (tag === "z") {
    const ds = new DecompressionStream("gzip");
    const w = ds.writable.getWriter();
    w.write(body); w.close();
    json = await new Response(ds.readable).text();
  } else {
    json = new TextDecoder().decode(body);
  }
  return unpack(JSON.parse(json));
}

/* ============================================================
   UI
   ============================================================ */
const FONTS = `@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@300;500;600&family=Spectral:ital,wght@0,400;0,600;1,400&display=swap');`;
const dispFont = "'Oswald', 'Helvetica Neue', sans-serif";
const bodyFont = "'Spectral', Georgia, serif";

function Btn({ children, onClick, disabled, tone = "plain", style }) {
  const tones = {
    plain: { bg: "rgba(255,255,255,.06)", fg: C.parch, bd: C.line },
    go: { bg: C.gold, fg: "#20160a", bd: C.gold },
    warn: { bg: "rgba(192,90,63,.18)", fg: "#f0b9a8", bd: "#7a3527" },
  };
  const t = tones[tone];
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: disabled ? "rgba(255,255,255,.03)" : t.bg,
      color: disabled ? "rgba(239,230,210,.28)" : t.fg,
      border: `1px solid ${disabled ? "rgba(255,255,255,.07)" : t.bd}`,
      borderRadius: 5, padding: "9px 12px", fontFamily: dispFont, fontSize: 13,
      letterSpacing: ".06em", textTransform: "uppercase", cursor: disabled ? "default" : "pointer",
      WebkitTapHighlightColor: "transparent", ...style,
    }}>{children}</button>
  );
}
function Fireworks() {
  const pieces = useMemo(() => Array.from({ length: 70 }, (_, i) => ({
    left: Math.random() * 100,
    delay: Math.random() * 3,
    dur: 2.8 + Math.random() * 2.6,
    color: [...PC.map((p) => p.hex), C.gold, C.parch][i % 6],
    size: 5 + Math.random() * 7,
    drift: -50 + Math.random() * 100,
  })), []);
  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 70, overflow: "hidden" }}>
      <style>{"@keyframes hbFall{0%{transform:translateY(-8vh) translateX(0) rotate(0deg);opacity:1}85%{opacity:1}100%{transform:translateY(108vh) translateX(var(--dx)) rotate(720deg);opacity:.4}}"}</style>
      {pieces.map((p, i) => (
        <span key={i} style={{ position: "absolute", top: 0, left: p.left + "%", width: p.size, height: p.size * 0.55,
          background: p.color, borderRadius: 1, "--dx": p.drift + "px",
          animation: `hbFall ${p.dur}s linear ${p.delay}s infinite` }} />
      ))}
    </div>
  );
}

function Die({ n, hot }) {
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  return (
    <span style={{ display: "inline-grid", gridTemplate: "repeat(3,1fr)/repeat(3,1fr)", width: 28, height: 28,
      background: "#f2ead6", borderRadius: 6, padding: 4, boxSizing: "border-box", gap: 1,
      border: "1px solid rgba(6,20,25,.45)", boxShadow: "0 1px 2px rgba(0,0,0,.4)" }}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} style={{ borderRadius: "50%", background: PIPS[n].includes(i) ? (hot ? C.rust : "#20262b") : "transparent" }} />
      ))}
    </span>
  );
}

function Eyebrow({ children }) {
  return <div style={{ fontFamily: dispFont, fontSize: 10, letterSpacing: ".22em",
    textTransform: "uppercase", color: C.parchDim, marginBottom: 6 }}>{children}</div>;
}
function Chip({ res, n }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "rgba(255,255,255,.05)",
      border: `1px solid ${C.line}`, borderRadius: 4, padding: "3px 7px", fontFamily: dispFont,
      fontSize: 13, color: C.parch, letterSpacing: ".04em" }}>
      <span>{RES_ICON[res]}</span>
      {RES_LABEL[res]} <b style={{ fontWeight: 600 }}>{n}</b>
    </span>
  );
}
function ResStepper({ value, max, onChange }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {RES.map((r) => (
        <div key={r} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 15 }}>{RES_ICON[r]}</span>
          <span style={{ flex: 1, fontFamily: dispFont, fontSize: 13, color: C.parch, letterSpacing: ".05em" }}>
            {RES_LABEL[r]}<span style={{ color: C.parchDim, fontSize: 11 }}> / {max[r] ?? 0}</span>
          </span>
          <Btn onClick={() => onChange(r, Math.max(0, (value[r] || 0) - 1))} disabled={(value[r] || 0) <= 0} style={{ padding: "4px 11px" }}>−</Btn>
          <span style={{ width: 22, textAlign: "center", fontFamily: dispFont, fontSize: 16, color: C.parch }}>{value[r] || 0}</span>
          <Btn onClick={() => onChange(r, (value[r] || 0) + 1)} disabled={(value[r] || 0) >= (max[r] ?? 0)} style={{ padding: "4px 11px" }}>+</Btn>
        </div>
      ))}
    </div>
  );
}
function Sheet({ title, onClose, children, footer }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(4,12,16,.7)", zIndex: 60,
      display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.panel, border: `1px solid ${C.line}`,
        borderBottom: "none", borderRadius: "10px 10px 0 0", width: "100%", maxWidth: 520, padding: 16,
        paddingBottom: "calc(16px + env(safe-area-inset-bottom))",
        maxHeight: "82vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontFamily: dispFont, fontSize: 15, letterSpacing: ".12em", textTransform: "uppercase", color: C.parch }}>{title}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.parchDim, fontSize: 22, cursor: "pointer" }}>×</button>
        </div>
        {children}
        {footer && <div style={{ marginTop: 14, display: "flex", gap: 8 }}>{footer}</div>}
      </div>
    </div>
  );
}
function BuildRow({ label, cost, note, disabled, active, onClick }) {
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled} style={{
      display: "flex", alignItems: "center", justifyContent: "space-between", textAlign: "left",
      background: active ? "rgba(224,164,55,.14)" : "rgba(255,255,255,.04)",
      border: `1px solid ${active ? C.gold : C.line}`, borderRadius: 6, padding: "10px 12px",
      opacity: disabled ? 0.38 : 1, cursor: disabled ? "default" : "pointer", width: "100%" }}>
      <span>
        <span style={{ fontFamily: dispFont, fontSize: 14, letterSpacing: ".1em", textTransform: "uppercase", color: C.parch }}>{label}</span>
        <span style={{ display: "block", color: C.parchDim, fontSize: 12, fontFamily: bodyFont }}>{cost}</span>
      </span>
      <span style={{ color: C.parchDim, fontFamily: dispFont, fontSize: 12 }}>{note}</span>
    </button>
  );
}

/* board is unchanged from the shared-storage build */
function Board({ g, sel, onPick }) {
  const b = g.board;
  const opts = sel ? sel.options : null;
  const roadPath = (e) => {
    const [a, c] = ends(e);
    const p1 = GEO.vertexPos[a], p2 = GEO.vertexPos[c];
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    return { x1: p1.x + dx * 0.16, y1: p1.y + dy * 0.16, x2: p2.x - dx * 0.16, y2: p2.y - dy * 0.16 };
  };
  return (
    <svg viewBox="-58 -54 116 108" preserveAspectRatio="xMidYMid meet"
      style={{ width: "100%", maxHeight: "52vh", display: "block", margin: "0 auto" }}>
      <defs>
        <radialGradient id="seaG" cx="50%" cy="45%" r="70%">
          <stop offset="0%" stopColor={C.sea} /><stop offset="100%" stopColor={C.seaDeep} />
        </radialGradient>
      </defs>
      <rect x="-58" y="-54" width="116" height="108" fill="url(#seaG)" />
      {b.ports.map((pt, i) => {
        const len = Math.hypot(pt.mx, pt.my) || 1;
        const px = pt.mx + (pt.mx / len) * 6.2, py = pt.my + (pt.my / len) * 6.2;
        return (
          <g key={i}>
            {pt.verts.map((v) => (
              <line key={v} x1={px} y1={py} x2={GEO.vertexPos[v].x} y2={GEO.vertexPos[v].y}
                stroke="rgba(224,164,55,.35)" strokeWidth="0.5" strokeDasharray="1.4 1" />
            ))}
            <circle cx={px} cy={py} r="3.6" fill={C.seaDeep} stroke={pt.type === "any" ? C.gold : RES_COLOR[pt.type]} strokeWidth="0.9" />
            <text x={px} y={py + 1.3} textAnchor="middle" fontSize="3.2" fontFamily={dispFont} fontWeight="600"
              fill={pt.type === "any" ? C.gold : RES_COLOR[pt.type]}>{pt.type === "any" ? "3:1" : "2:1"}</text>
          </g>
        );
      })}
      {b.hexes.map((h) => {
        const pts = hexCorners(h.cx, h.cy).map((p) => p.join(",")).join(" ");
        const target = sel && sel.kind === "robber" && opts.has(h.id);
        return (
          <g key={h.id}>
            <polygon points={pts} fill={HEX_FILL[h.terrain]} stroke="rgba(6,20,25,.55)" strokeWidth="0.6" />
            {b.robber !== h.id && (
              <text x={h.cx} y={h.cy - 4.9} textAnchor="middle" fontSize="4"
                style={{ pointerEvents: "none" }}>{TERRAIN_ICON[h.terrain]}</text>
            )}
            {h.number && (
              <g>
                <circle cx={h.cx} cy={h.cy} r="4.1" fill="#f2ead6" stroke="rgba(6,20,25,.35)" strokeWidth="0.4" />
                <text x={h.cx} y={h.cy + 0.4} textAnchor="middle" fontSize="4.4" fontFamily={dispFont} fontWeight="600"
                  fill={pips(h.number) === 5 ? C.rust : "#2a2118"}>{h.number}</text>
                <text x={h.cx} y={h.cy + 3.3} textAnchor="middle" fontSize="2.6"
                  fill={pips(h.number) === 5 ? C.rust : "#5c5041"}>{"•".repeat(pips(h.number))}</text>
              </g>
            )}
            {b.robber === h.id && (
              <g>
                <ellipse cx={h.cx} cy={h.cy - 5.6} rx="2.2" ry="2.9" fill="#141414" stroke="#000" strokeWidth="0.3" />
                <circle cx={h.cx} cy={h.cy - 8.3} r="1.5" fill="#141414" />
              </g>
            )}
            {target && <polygon points={pts} fill="rgba(224,164,55,.22)" stroke={C.gold} strokeWidth="0.9"
              style={{ cursor: "pointer" }} onClick={() => onPick(h.id)} />}
          </g>
        );
      })}
      {Object.entries(g.roads).map(([e, owner]) => {
        const r = roadPath(e);
        return <line key={e} x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2} stroke={PC[g.players[owner].color].hex}
          strokeWidth="2.1" strokeLinecap="round" />;
      })}
      {Object.entries(g.buildings).map(([v, bl]) => {
        const p = GEO.vertexPos[v];
        const col = PC[g.players[bl.owner].color].hex;
        return bl.type === "settlement" ? (
          <polygon key={v} points={`${p.x - 2},${p.y + 2} ${p.x - 2},${p.y - 0.6} ${p.x},${p.y - 2.6} ${p.x + 2},${p.y - 0.6} ${p.x + 2},${p.y + 2}`}
            fill={col} stroke="rgba(6,20,25,.75)" strokeWidth="0.45" />
        ) : (
          <g key={v}>
            <rect x={p.x - 2.8} y={p.y - 1.2} width="5.6" height="3.4" fill={col} stroke="rgba(6,20,25,.75)" strokeWidth="0.45" />
            <polygon points={`${p.x - 2.8},${p.y - 1.2} ${p.x},${p.y - 3.6} ${p.x + 2.8},${p.y - 1.2}`}
              fill={col} stroke="rgba(6,20,25,.75)" strokeWidth="0.45" />
          </g>
        );
      })}
      {sel && sel.kind === "road" && [...opts].map((e) => {
        const r = roadPath(e);
        return (
          <g key={e}>
            <line x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2} stroke={C.gold} strokeWidth="1.1" opacity="0.75" strokeDasharray="1.6 1.2" />
            <line x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2} stroke="transparent" strokeWidth="6"
              style={{ cursor: "pointer" }} onClick={() => onPick(e)} />
          </g>
        );
      })}
      {sel && (sel.kind === "town" || sel.kind === "city") && [...opts].map((v) => {
        const p = GEO.vertexPos[v];
        return (
          <g key={v}>
            <circle cx={p.x} cy={p.y} r="2.4" fill="rgba(224,164,55,.3)" stroke={C.gold} strokeWidth="0.8" />
            <circle cx={p.x} cy={p.y} r="5.2" fill="transparent" style={{ cursor: "pointer" }} onClick={() => onPick(v)} />
          </g>
        );
      })}
    </svg>
  );
}

/* ============================================================
   App — one invite link, one seat per phone, server keeps sync
   ============================================================ */
export default function App() {
  const [g, setG] = useState(null);
  const [seat, setSeat] = useState(null);
  const [sel, setSel] = useState(null);
  const [modal, setModal] = useState(null);
  const [tab, setTab] = useState("build");
  const [note, setNote] = useState("");
  const [myName, setMyName] = useState("");
  const [myCount, setMyCount] = useState(4);
  const [claimName, setClaimName] = useState("");
  const [rejoinSel, setRejoinSel] = useState(null);
  const [rejoinWord, setRejoinWord] = useState("");
  const [booting, setBooting] = useState(true);
  const [lobby, setLobby] = useState(null);
  const [pushReady, setPushReady] = useState(false);
  const [now, setNow] = useState(0);
  const gRef = useRef(null);
  gRef.current = g;

  const setHashCode = (code) => {
    try { window.history.replaceState(null, "", "#g=" + code); }
    catch { try { window.location.hash = "g=" + code; } catch { /* nothing else to try */ } }
  };

  const adopt = (loaded) => {
    setG(loaded);
    const s = knownSeat(loaded.code);
    if (s != null && loaded.players[s]) { setSeat(s); rememberGame(loaded.code); }
  };

  const loadByCode = async (code) => {
    let res = await serverGet(code);
    if (!res) {
      // the server may have restarted — restore from this phone's backup
      const c = await restoreGame(code);
      if (c) res = c;
    }
    if (!res) {
      setNote("Game " + code + " isn't on the server right now — probably a server restart. It comes back the moment anyone who was in the game opens Harbor on their phone, so ask in the chat, then tap the link again.");
      return false;
    }
    try { adopt(await decodeGame(res.blob)); setHashCode(code); return true; }
    catch { setNote("Game " + code + " couldn't be read from the server."); return false; }
  };

  /* load from the URL — either a join code or a legacy pass-the-phone blob */
  useEffect(() => {
    (async () => {
      const h = window.location.hash.replace(/^#/, "");
      const jm = h.match(/^g=([A-Za-z0-9]{4,8})$/);
      if (jm) {
        await loadByCode(jm[1].toUpperCase());
      } else if (h) {
        /* old-style link with the whole game in it: sync it into the server
           and carry on in shared mode. Newest version wins. */
        try {
          const local = await decodeGame(h);
          const res = await serverGet(local.code);
          let best = local;
          if (res && res.v > (local.seq || 0)) best = await decodeGame(res.blob);
          else await serverPut(local);
          adopt(best);
          setHashCode(best.code);
        } catch {
          setNote("That link is damaged — the game state couldn't be read.");
        }
      }
      setBooting(false);
    })();
  }, []);

  /* on the home screen, look up how each remembered game is doing */
  useEffect(() => {
    if (g || booting) return;
    let dead = false;
    (async () => {
      const list = knownGames().slice(0, 8);
      if (!list.length) { setLobby([]); return; }
      const out = [];
      for (const it of list) {
        let res = await serverGet(it.code);
        if (!res) { const c = await restoreGame(it.code); if (c) res = c; }
        if (!res) { out.push({ code: it.code, gone: true }); continue; }
        try {
          const gm = await decodeGame(res.blob);
          const s = knownSeat(it.code);
          out.push({
            code: it.code,
            names: gm.players.filter((p) => p.claimed).map((p) => p.name).join(", "),
            turnName: pname(gm, gm.turn),
            myTurn: s != null && gm.winner == null && gm.phase !== "lobby" && (gm.turn === s || (gm.pendingDiscard[s] || 0) > 0),
            over: gm.winner != null,
            inLobby: gm.phase === "lobby",
          });
        } catch { out.push({ code: it.code, gone: true }); }
      }
      if (!dead) setLobby(out);
    })();
    return () => { dead = true; };
  }, [g, booting]);

  /* find my seat by device token — seats can shift in the lobby, and a kick
     must actually unseat the kicked phone */
  useEffect(() => {
    if (!g) return;
    const t = tokOf(g.code);
    if (!t) return;
    const idx = g.players.findIndex((p) => p.tok === t);
    if (idx >= 0) {
      if (idx !== seat) { setSeat(idx); rememberSeat(g.code, idx); }
    } else if (seat != null && g.phase === "lobby") {
      setSeat(null);
      setNote("The host removed you from this game — you can take an open seat again if that was a mistake.");
    }
  }, [g, seat]);

  /* keep this phone's push subscription registered for the current game */
  useEffect(() => {
    if (!g || seat == null) return;
    syncPush(g.code, seat).then((ok) => { if (ok) setPushReady(true); });
  }, [g && g.code, seat]);

  const enablePush = async () => {
    if (!pushSupported()) {
      setNote("Turn alerts need Harbor on your Home Screen first: tap Share, then \"Add to Home Screen\", open it from there and tap 🔔 again.");
      return;
    }
    const perm = await window.Notification.requestPermission();
    if (perm !== "granted") { setNote("Notifications stayed off."); return; }
    const ok = await syncPush(gRef.current.code, seat);
    setPushReady(ok);
    setNote(ok ? "Turn alerts are on — this phone gets a ping when you're up." : "Couldn't set up notifications — try again in a moment.");
  };

  const goHome = () => {
    setG(null); setSeat(null); setNote(""); setLobby(null); setPushReady(false);
    try { window.history.replaceState(null, "", window.location.pathname); }
    catch { try { window.location.hash = ""; } catch { /* fine */ } }
  };

  /* poll the server for other players' moves */
  useEffect(() => {
    if (!g) return;
    const code = g.code;
    const id = setInterval(async () => {
      setNow(Date.now()); // keeps time-gated UI (deputy discard) fresh
      const cur = gRef.current;
      if (!cur || cur.code !== code) return;
      const res = await serverGet(code);
      if (!res) { serverPut(cur); return; } // server restarted — reseed it from here
      if (res.v > (cur.seq || 0)) {
        try { setG(await decodeGame(res.blob)); } catch { /* skip a bad poll */ }
      }
    }, window.HARBOR_POLL_MS || 3000);
    return () => clearInterval(id);
  }, [g && g.code]);

  /* run a mutation, push it, and rebase-retry if someone else moved first */
  const apply = async (fn) => {
    let latest = gRef.current;
    for (let attempt = 0; attempt < 3; attempt++) {
      const d = clone(latest);
      let out;
      try { out = fn(d); } catch { out = false; }
      if (out === false) {
        if (attempt > 0) setNote("Someone else moved first — that move no longer works.");
        return false;
      }
      if (d.phase !== "over" && scoreFor(d, d.turn, true) >= 10) {
        d.winner = d.turn; d.phase = "over";
        say(d, `${pname(d, d.turn)} reached 10 points and wins.`);
      }
      d.seq = (d.seq || 0) + 1;
      const r = await serverPut(d, seat);
      if (r.ok) {
        if (d._stole) {
          setNote(`You stole 1 ${RES_LABEL[d._stole.res].toLowerCase()} ${RES_ICON[d._stole.res]} from ${d._stole.from}.`);
          delete d._stole;
        } else setNote("");
        setG(d); setSel(null);
        return true;
      }
      if (r.conflict) {
        try { latest = await decodeGame(r.conflict.blob); } catch { return false; }
        setG(latest);
        continue;
      }
      setNote(r.offline ? "Can't reach the server — your move wasn't saved. Check your connection and try again." : "The server rejected that move.");
      return false;
    }
    setNote("The game moved while you were tapping — try again.");
    return false;
  };

  const inviteUrl = g ? window.location.origin + window.location.pathname + "#g=" + g.code : "";
  const share = async () => {
    try {
      if (navigator.share) { await navigator.share({ text: `Join our Harbor game — code ${g.code}.`, url: inviteUrl }); return; }
      await navigator.clipboard.writeText(inviteUrl);
      setNote("Invite link copied — paste it in the group chat.");
    } catch { setNote("Couldn't copy. The invite link is: " + inviteUrl); }
  };

  /* ---- new game ---- */
  const create = async () => {
    const me = (myName.trim() || "Player 1").slice(0, 14);
    const seats = [me];
    for (let i = 2; i <= myCount; i++) seats.push(`Player ${i}`);
    let game = null, r = null;
    for (let tries = 0; tries < 5; tries++) {
      game = newGame(makeCode4(), seats);
      game.players[0].claimed = true;
      const t = makeTok(game.code);
      game.players[0].tok = t;
      game.hostTok = t;
      game.seq = 1;
      r = await serverPut(game, 0);
      if (r.ok || !r.conflict) break; // a conflict means the code is taken — reroll it
    }
    if (!r.ok) { setNote("Couldn't reach the server to create the game — try again in a moment."); return; }
    rememberSeat(game.code, 0);
    rememberGame(game.code);
    setSeat(0);
    setG(game);
    setHashCode(game.code);
  };

  /* ---- claim a seat ---- */
  const claim = async (i) => {
    const nm = claimName.trim().slice(0, 14);
    const ok = await apply((d) => {
      if (d.players[i].claimed) return false;
      d.players[i].claimed = true;
      d.players[i].tok = makeTok(d.code);
      if (nm) d.players[i].name = nm;
      say(d, `${d.players[i].name} joined the game.`);
      if (d.phase === "lobby" && d.players.every((p) => p.claimed)) startLobby(d, false);
    });
    if (ok) { rememberSeat(gRef.current.code, i); rememberGame(gRef.current.code); setSeat(i); }
    else setNote((n) => n || "That seat was just taken — pick another.");
  };

  /* ---- rejoin a claimed seat from a new phone ---- */
  const rejoin = async (i, word) => {
    const p = gRef.current.players[i];
    if (p.lock && hashWord(word || "") !== p.lock) {
      setNote("That's not " + p.name + "'s secret word.");
      return;
    }
    const ok = await apply((d) => {
      d.players[i].tok = makeTok(d.code);
      say(d, `${d.players[i].name} rejoined from another phone.`);
    });
    if (ok) { rememberSeat(gRef.current.code, i); rememberGame(gRef.current.code); setSeat(i); }
  };

  if (booting) return <div style={{ background: C.ink, minHeight: "100vh" }} />;

  /* ---- HOME ---- */
  if (!g) {
    return (
      <div style={{ minHeight: "100vh", background: C.ink, color: C.parch, fontFamily: bodyFont, padding: "28px 18px 60px" }}>
        <style>{FONTS}</style>
        <div style={{ maxWidth: 520, margin: "0 auto" }}>
          <div style={{ fontFamily: dispFont, fontWeight: 300, fontSize: 44, letterSpacing: ".26em", lineHeight: 1 }}>HARBOR</div>
          <div style={{ color: C.parchDim, marginTop: 10, fontSize: 15, fontStyle: "italic" }}>
            Settlers with friends, no clock. Start a game, send one invite link, and everyone plays from their own phone.
          </div>
          {lobby && lobby.length > 0 && (
            <div style={{ marginTop: 26, border: `1px solid ${C.line}`, borderRadius: 8, padding: 16, background: C.panel }}>
              <Eyebrow>Your games</Eyebrow>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {lobby.map((it) => (
                  <div key={it.code} style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                    <Btn tone={it.myTurn ? "go" : "plain"} style={{ flex: 1, textAlign: "left" }}
                      onClick={() => loadByCode(it.code)}>
                      <b style={{ letterSpacing: ".08em" }}>{it.code}</b>
                      {" · "}
                      {it.gone ? "unreachable right now"
                        : it.over ? "finished"
                        : it.inLobby ? "in the lobby"
                        : it.myTurn ? "YOUR TURN"
                        : `waiting on ${it.turnName}`}
                      {it.names ? <span style={{ color: C.parchDim }}> — {it.names}</span> : null}
                    </Btn>
                    <Btn onClick={() => { forgetGame(it.code); setLobby(lobby.filter((x) => x.code !== it.code)); }}
                      style={{ padding: "6px 10px" }}>×</Btn>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{ marginTop: 26, border: `1px solid ${C.line}`, borderRadius: 8, padding: 16, background: C.panel }}>
            <Eyebrow>Start a new island</Eyebrow>
            <input value={myName} placeholder="Your name"
              onChange={(e) => setMyName(e.target.value)}
              style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,.05)", border: `1px solid ${C.line}`, borderRadius: 4,
                padding: "9px 10px", color: C.parch, fontFamily: bodyFont, fontSize: 15, marginBottom: 12 }} />
            <Eyebrow>How many settlers</Eyebrow>
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              {[2, 3, 4].map((n) => (
                <button key={n} onClick={() => setMyCount(n)} style={{ flex: 1,
                  background: myCount === n ? "rgba(224,164,55,.16)" : "rgba(255,255,255,.04)",
                  border: `1px solid ${myCount === n ? C.gold : C.line}`, color: myCount === n ? C.gold : C.parchDim,
                  borderRadius: 5, padding: "10px", fontFamily: dispFont, fontSize: 15, cursor: "pointer" }}>{n}</button>
              ))}
            </div>
            <Btn tone="go" onClick={create} style={{ width: "100%" }}>Create game</Btn>
          </div>
          {note && <div style={{ marginTop: 16, color: "#f0b9a8", lineHeight: 1.5 }}>{note}</div>}
          <div style={{ marginTop: 26, color: C.parchDim, fontSize: 13, lineHeight: 1.65 }}>
            No accounts. You'll get one invite link to drop in the group chat — everyone taps it,
            picks their seat and name, and the game syncs to all four phones by itself.
            <br /><br />
            Fair warning: the game state is technically readable by anyone nosy enough to dig.
            Play with people you trust.
          </div>
        </div>
      </div>
    );
  }

  /* ---- SEAT PICKER ---- */
  if (seat == null) {
    return (
      <div style={{ minHeight: "100vh", background: C.ink, color: C.parch, fontFamily: bodyFont, padding: "28px 18px 60px" }}>
        <style>{FONTS}</style>
        <div style={{ maxWidth: 520, margin: "0 auto" }}>
          <div style={{ fontFamily: dispFont, fontWeight: 300, fontSize: 44, letterSpacing: ".26em", lineHeight: 1 }}>HARBOR</div>
          <div style={{ color: C.parchDim, marginTop: 10, fontSize: 15 }}>Game {g.code} — pick your seat.</div>
          <div style={{ marginTop: 20, border: `1px solid ${C.line}`, borderRadius: 8, padding: 16, background: C.panel }}>
            <Eyebrow>Your name</Eyebrow>
            <input value={claimName} placeholder="Your name"
              onChange={(e) => setClaimName(e.target.value)}
              style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,.05)", border: `1px solid ${C.line}`, borderRadius: 4,
                padding: "9px 10px", color: C.parch, fontFamily: bodyFont, fontSize: 15, marginBottom: 14 }} />
            <Eyebrow>Seats</Eyebrow>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {g.players.map((p, i) => (
                <React.Fragment key={i}>
                  <Btn tone={rejoinSel === i ? "go" : "plain"}
                    onClick={() => (p.claimed ? setRejoinSel(rejoinSel === i ? null : i) : claim(i))}>
                    <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: PC[p.color].hex, marginRight: 8 }} />
                    {p.claimed ? `${p.name} — taken · rejoin?` : `Take this seat${p.name.startsWith("Player ") ? "" : ` (${p.name})`}`}
                  </Btn>
                  {rejoinSel === i && (
                    <div style={{ border: `1px solid ${C.line}`, borderRadius: 6, padding: 12 }}>
                      <div style={{ color: C.parchDim, fontSize: 13, lineHeight: 1.5, marginBottom: 10 }}>
                        {p.lock
                          ? `${p.name}'s seat is protected — enter their secret word.`
                          : `Only do this if you really are ${p.name} on a new phone. Everyone will see it in the game log.`}
                      </div>
                      {p.lock ? (
                        <input value={rejoinWord} placeholder="Secret word"
                          onChange={(e) => setRejoinWord(e.target.value)}
                          style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,.05)", border: `1px solid ${C.line}`,
                            borderRadius: 4, padding: "9px 10px", color: C.parch, fontFamily: bodyFont, fontSize: 15, marginBottom: 10 }} />
                      ) : null}
                      <Btn tone="warn" style={{ width: "100%" }} onClick={() => rejoin(i, rejoinWord)}>
                        Yes, I'm {p.name} — rejoin
                      </Btn>
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
          {note && <div style={{ marginTop: 16, color: "#f0b9a8", lineHeight: 1.5 }}>{note}</div>}
          <div style={{ marginTop: 18, color: C.parchDim, fontSize: 13, lineHeight: 1.6 }}>
            Your phone remembers your seat for this game — you only do this once. If you switch phones,
            use rejoin. You can set a secret word on your seat (tap your name card in the game) so nobody
            else can rejoin as you.
          </div>
        </div>
      </div>
    );
  }

  /* ---- LOBBY ---- */
  if (g.phase === "lobby") {
    const isHost = g.hostTok && tokOf(g.code) === g.hostTok;
    const aboard = g.players.filter((p) => p.claimed).length;
    return (
      <div style={{ minHeight: "100vh", background: C.ink, color: C.parch, fontFamily: bodyFont, padding: "28px 18px 60px" }}>
        <style>{FONTS}</style>
        <div style={{ maxWidth: 520, margin: "0 auto" }}>
          <div style={{ fontFamily: dispFont, fontWeight: 300, fontSize: 44, letterSpacing: ".26em", lineHeight: 1 }}>HARBOR</div>
          <div style={{ color: C.parchDim, marginTop: 10, fontSize: 15 }}>
            Game {g.code} — the island appears when everyone's aboard.
          </div>
          <div style={{ marginTop: 20, border: `1px solid ${C.line}`, borderRadius: 8, padding: 16, background: C.panel }}>
            <Eyebrow>Game lobby — {aboard} of {g.players.length} aboard</Eyebrow>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {g.players.map((p, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, border: `1px solid ${C.line}`,
                  borderRadius: 6, padding: "10px 12px", background: p.claimed ? "rgba(255,255,255,.04)" : "transparent" }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: PC[p.color].hex }} />
                  <span style={{ flex: 1, fontSize: 15, color: p.claimed ? C.parch : C.parchDim, fontStyle: p.claimed ? "normal" : "italic" }}>
                    {p.claimed ? `${p.name}${i === seat ? " (you)" : ""}` : "open seat — waiting…"}
                  </span>
                  {isHost && p.claimed && i !== seat && (
                    <Btn tone="warn" onClick={() => apply((d) => lobbyKick(d, i))} style={{ padding: "5px 10px", fontSize: 11 }}>Kick</Btn>
                  )}
                  {isHost && !p.claimed && g.players.length > 2 && (
                    <Btn onClick={() => apply((d) => lobbyRemoveSeat(d, i))} style={{ padding: "5px 10px", fontSize: 11 }}>Remove</Btn>
                  )}
                </div>
              ))}
            </div>
            {isHost && g.players.length < 4 && (
              <Btn onClick={() => apply((d) => lobbyAddSeat(d))} style={{ width: "100%", marginTop: 10 }}>Add a seat</Btn>
            )}
          </div>
          <Btn tone="go" onClick={share} style={{ width: "100%", marginTop: 14, padding: "13px", fontSize: 15 }}>
            Send the invite link
          </Btn>
          {isHost && aboard >= 2 && aboard < g.players.length && (
            <Btn tone="warn" onClick={() => apply((d) => startLobby(d, true))} style={{ width: "100%", marginTop: 10 }}>
              Start with {aboard} — drop the empty seats
            </Btn>
          )}
          {note && <div style={{ marginTop: 14, color: "#f0b9a8", lineHeight: 1.5 }}>{note}</div>}
          <div style={{ marginTop: 18, color: C.parchDim, fontSize: 13, lineHeight: 1.6 }}>
            The game starts itself the moment every seat is taken — turn order is drawn at random right then,
            so nobody knows who goes first until the anchor drops.
          </div>
        </div>
      </div>
    );
  }

  /* ---- derived ---- */
  const actor = seat;
  const hand = g.hands[actor];
  const owed = g.pendingDiscard[actor] || 0;
  const myTurn = g.turn === actor && g.winner == null;
  const canBuy = (k) => canAfford(hand, COST[k]);
  /* before rolling, only a knight may be played; one dev card per turn */
  const devPlayable = (c) => myTurn && (g.phase === "main" || (g.phase === "roll" && c.type === "knight"))
    && !g.devPlayed && c.turn < g.turnNo && !c.used && c.type !== "vp";
  const startBuild = (kind) => {
    if (kind === "road") setSel({ kind: "road", options: new Set(legalRoads(g, actor, null)) });
    if (kind === "town") setSel({ kind: "town", options: new Set(legalSettlements(g, actor, false)) });
    if (kind === "city") setSel({ kind: "city", options: new Set(legalCities(g, actor)) });
  };
  /* setup and robber placement highlight themselves; build modes are chosen by tapping a button */
  const autoSel = (() => {
    if (!myTurn) return null;
    if (g.phase === "setupTown") return { kind: "town", options: new Set(legalSettlements(g, actor, true)) };
    if (g.phase === "setupRoad") return { kind: "road", options: new Set(legalRoads(g, actor, g.lastSetupVertex)) };
    if (g.phase === "robber") return { kind: "robber", options: new Set(g.board.hexes.filter((h) => h.id !== g.board.robber).map((h) => h.id)) };
    return null;
  })();
  const effSel = autoSel || (g.phase === "main" ? sel : null);

  const onPick = (id) => {
    if (!effSel || !myTurn) return;
    if (effSel.kind === "robber") return apply((d) => moveRobber(d, id, actor));
    if (g.phase === "setupTown") return apply((d) => placeSetupTown(d, id, actor));
    if (g.phase === "setupRoad") return apply((d) => placeSetupRoad(d, id, actor));
    if (effSel.kind === "road") return apply((d) => buildRoad(d, id, actor));
    if (effSel.kind === "town") return apply((d) => buildTown(d, id, actor));
    if (effSel.kind === "city") return apply((d) => buildCity(d, id, actor));
  };

  const status = (() => {
    if (g.winner != null) return `${pname(g, g.winner)} wins with ${scoreFor(g, g.winner, true)} points.`;
    if (owed > 0) return `You rolled into a seven — discard ${owed} cards.`;
    if (!myTurn) {
      const up = g.players[g.turn];
      if (!up.claimed) return `Waiting for someone to take ${up.name}'s seat — send them the invite link.`;
      if (g.phase === "discard") {
        const owing = Object.keys(g.pendingDiscard).map((p) => pname(g, +p)).join(", ");
        return `Waiting for ${owing} to discard from the seven.`;
      }
      return `Waiting for ${up.name} — updates come through on their own.`;
    }
    switch (g.phase) {
      case "setupTown": return "Tap a highlighted corner to found a town.";
      case "setupRoad": return "Now lay a road beside it.";
      case "roll": return "Roll the dice to start your turn.";
      case "discard": return "Waiting for the others to discard from the seven.";
      case "robber": return "Tap a hex to move the robber.";
      case "steal": return "Choose someone to rob.";
      case "main": return "Build, trade, or end the turn.";
      default: return "";
    }
  })();

  return (
    <div style={{ minHeight: "100vh", background: C.ink, color: C.parch, fontFamily: bodyFont, paddingBottom: 24 }}>
      <style>{FONTS}</style>

      {/* header */}
      <div style={{ padding: "12px 14px 8px", borderBottom: `1px solid ${C.line}` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div onClick={goHome} title="All your games" style={{ fontFamily: dispFont, fontSize: 13, letterSpacing: ".28em", color: C.parchDim, cursor: "pointer" }}>
            ‹ HARBOR · {g.code}</div>
          <div style={{ display: "flex", gap: 6 }}>
            {!pushReady && (!pushSupported() || window.Notification.permission === "default") && (
              <Btn onClick={enablePush} style={{ padding: "5px 9px", fontSize: 11 }}>🔔</Btn>
            )}
            <Btn onClick={() => setModal({ k: "rolls" })} style={{ padding: "5px 9px", fontSize: 11 }}>Rolls</Btn>
            <Btn onClick={() => setModal({ k: "log" })} style={{ padding: "5px 9px", fontSize: 11 }}>Log</Btn>
            <Btn onClick={share} style={{ padding: "5px 9px", fontSize: 11 }}>Invite</Btn>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          {g.players.map((p, i) => (
            <div key={i} title={i === actor ? "Edit your name" : undefined}
              onClick={i === actor ? () => setModal({ k: "rename" }) : undefined}
              style={{ flex: 1, border: `1px solid ${i === g.turn && g.winner == null ? C.gold : C.line}`,
              background: i === g.turn && g.winner == null ? "rgba(224,164,55,.09)" : "rgba(255,255,255,.02)",
              borderRadius: 5, padding: "6px 5px", textAlign: "center", cursor: i === actor ? "pointer" : "default" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: PC[p.color].hex }} />
                <span style={{ fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 58 }}>{p.name}</span>
              </div>
              <div style={{ fontFamily: dispFont, fontSize: 19, lineHeight: 1.15 }}>{scoreFor(g, i, i === actor)}</div>
              <div style={{ fontSize: 10, color: C.parchDim, fontFamily: dispFont, letterSpacing: ".06em" }}>
                {handTotal(g.hands[i])}c · {g.devHands[i].filter((c) => !c.used).length}d
                {g.longestRoad === i ? " · LR" : ""}{g.largestArmy === i ? " · LA" : ""}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* whose turn */}
      {g.winner == null && (
        <div style={{ padding: "8px 14px", background: "rgba(224,164,55,.1)", borderBottom: `1px solid ${C.line}`,
          fontFamily: dispFont, fontSize: 12, letterSpacing: ".12em", textTransform: "uppercase", color: C.gold }}>
          {myTurn ? `Your turn, ${pname(g, actor)}` : `${pname(g, g.turn)}'s turn — you're ${pname(g, actor)}`}
        </div>
      )}

      <Board g={g} sel={effSel} onPick={onPick} />

      <div style={{ padding: "10px 14px", borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {g.dice && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
              <Die n={g.dice[0]} hot={g.dice[0] + g.dice[1] === 7} />
              <Die n={g.dice[1]} hot={g.dice[0] + g.dice[1] === 7} />
              <span style={{ fontFamily: dispFont, fontSize: 24, marginLeft: 3,
                color: g.dice[0] + g.dice[1] === 7 ? C.rust : C.gold }}>{g.dice[0] + g.dice[1]}</span>
            </span>
          )}
          <span style={{ fontSize: 15, lineHeight: 1.4 }}>{status}</span>
        </div>
        {g.rolls.length > 1 && (
          <div onClick={() => setModal({ k: "rolls" })} style={{ marginTop: 6, color: C.parchDim, fontSize: 12,
            fontFamily: dispFont, letterSpacing: ".08em", cursor: "pointer" }}>
            LAST ROLLS · {g.rolls.slice(-8).reverse().map((n, i) => (
              <span key={i} style={{ color: n === 7 ? C.rust : i === 0 ? C.gold : C.parchDim, marginRight: 6 }}>{n}</span>
            ))}
          </div>
        )}
        {note && <div style={{ marginTop: 6, color: "#f0b9a8", fontSize: 13, lineHeight: 1.4 }}>{note}</div>}
      </div>

      <div style={{ padding: "12px 14px" }}>
        {g.winner != null && (
          <div style={{ border: `1px solid ${C.gold}`, borderRadius: 7, padding: 14, marginBottom: 12, background: "rgba(224,164,55,.1)" }}>
            <div style={{ fontFamily: dispFont, fontSize: 22, letterSpacing: ".12em" }}>🎆 {pname(g, g.winner).toUpperCase()} WINS 🎆</div>
          </div>
        )}
        {g.winner != null && <Fireworks />}

        {/* a trade offer aimed at you — answer from any phase, any turn */}
        {g.trade && g.trade.to === actor && g.winner == null && (
          <div style={{ border: `1px solid ${C.gold}`, borderRadius: 7, padding: 14, marginBottom: 12, background: "rgba(224,164,55,.08)" }}>
            <Eyebrow>{pname(g, g.trade.from)} offers you a trade</Eyebrow>
            <div style={{ fontSize: 15, lineHeight: 1.6, marginBottom: 10 }}>
              You get <b>{fmtHand(g.trade.give)}</b> — you give <b>{fmtHand(g.trade.want)}</b>.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn tone="go" style={{ flex: 1 }} disabled={!RES.every((r) => hand[r] >= (g.trade.want[r] || 0))}
                onClick={() => apply((d) => acceptTrade(d))}>
                {RES.every((r) => hand[r] >= (g.trade.want[r] || 0)) ? "Accept" : "Can't afford it"}
              </Btn>
              <Btn tone="warn" style={{ flex: 1 }} onClick={() => apply((d) => declineTrade(d, false))}>Decline</Btn>
            </div>
          </div>
        )}

        {owed > 0 && (
          <Btn tone="warn" style={{ width: "100%", marginBottom: 10 }}
            onClick={() => setModal({ k: "discard" })}>Discard {owed} cards</Btn>
        )}

        {/* someone wandered off mid-seven: after a long wait, anyone may throw
            random cards for them (it's announced in the log) */}
        {g.phase === "discard" && g.sevenAt > 0 && now - g.sevenAt > (window.HARBOR_DEPUTY_MS || 600000) &&
          Object.keys(g.pendingDiscard).map(Number).filter((p) => p !== actor).map((p) => (
            <Btn key={p} tone="warn" style={{ width: "100%", marginBottom: 10 }}
              onClick={() => apply((d) => deputyDiscard(d, p, actor))}>
              {pname(g, p)} is holding things up — discard {g.pendingDiscard[p]} random cards for them
            </Btn>
          ))}

        {myTurn && g.phase === "steal" && (
          <div style={{ marginBottom: 12 }}>
            <Eyebrow>Rob one of them</Eyebrow>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {g.stealFrom.map((i) => (
                <Btn key={i} tone="warn" onClick={() => apply((d) => stealFrom(d, i, actor))}>
                  {pname(g, i)} ({handTotal(g.hands[i])})
                </Btn>
              ))}
            </div>
          </div>
        )}

        {myTurn && g.phase === "roll" && (
          <Btn tone="go" style={{ width: "100%", padding: "14px", fontSize: 16 }}
            onClick={() => apply((d) => rollDice(d))}>Roll the dice</Btn>
        )}

        {myTurn && g.phase === "main" && (
          <>
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              {["build", "trade", "cards"].map((t) => (
                <button key={t} onClick={() => setTab(t)} style={{ flex: 1,
                  background: tab === t ? "rgba(224,164,55,.14)" : "rgba(255,255,255,.03)",
                  border: `1px solid ${tab === t ? C.gold : C.line}`, color: tab === t ? C.gold : C.parchDim,
                  borderRadius: 5, padding: "8px", fontFamily: dispFont, fontSize: 12,
                  letterSpacing: ".14em", textTransform: "uppercase", cursor: "pointer" }}>{t}</button>
              ))}
            </div>

            {tab === "build" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {g.freeRoads > 0 && <div style={{ color: C.gold, fontSize: 13 }}>Road building: {g.freeRoads} free left.</div>}
                <BuildRow label="Road" cost="1 brick · 1 lumber" note={`${countOwned(g, actor, "road")}/15`}
                  disabled={(!canBuy("road") && !g.freeRoads) || countOwned(g, actor, "road") >= LIMIT.road || !legalRoads(g, actor, null).length}
                  active={sel?.kind === "road"} onClick={() => startBuild("road")} />
                <BuildRow label="Town" cost="1 brick · 1 lumber · 1 wool · 1 grain" note={`${countOwned(g, actor, "settlement")}/5`}
                  disabled={!canBuy("settlement") || countOwned(g, actor, "settlement") >= LIMIT.settlement || !legalSettlements(g, actor, false).length}
                  active={sel?.kind === "town"} onClick={() => startBuild("town")} />
                <BuildRow label="City" cost="2 grain · 3 ore" note={`${countOwned(g, actor, "city")}/4`}
                  disabled={!canBuy("city") || countOwned(g, actor, "city") >= LIMIT.city || !legalCities(g, actor).length}
                  active={sel?.kind === "city"} onClick={() => startBuild("city")} />
                <BuildRow label="Development card" cost="1 wool · 1 grain · 1 ore" note={`${g.devDeck.length} left`}
                  disabled={!canBuy("dev") || !g.devDeck.length} onClick={() => apply((d) => buyDev(d, actor))} />
                {sel && <div style={{ color: C.gold, fontSize: 13 }}>Tap a highlighted spot on the board.</div>}
              </div>
            )}

            {tab === "trade" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Btn onClick={() => setModal({ k: "bank" })} disabled={handTotal(hand) < 2}>Trade with the bank</Btn>
                {g.trade && g.trade.from === actor ? (
                  <div style={{ border: `1px solid ${C.gold}`, borderRadius: 6, padding: 12 }}>
                    <div style={{ fontSize: 14, lineHeight: 1.5, marginBottom: 8 }}>
                      Waiting on {pname(g, g.trade.to)}: your {fmtHand(g.trade.give)} for their {fmtHand(g.trade.want)}.
                    </div>
                    <Btn tone="warn" onClick={() => apply((d) => declineTrade(d, true))}>Withdraw the offer</Btn>
                  </div>
                ) : (
                  <Btn onClick={() => setModal({ k: "offer" })} disabled={handTotal(hand) < 1}>Offer a trade</Btn>
                )}
                <div style={{ color: C.parchDim, fontSize: 13, lineHeight: 1.55 }}>
                  They get the offer on their phone and accept or decline there. One open offer at a time.
                </div>
                <div style={{ color: C.parchDim, fontSize: 13 }}>
                  Your rates: {RES.map((r) => `${RES_LABEL[r]} ${tradeRate(g, actor, r)}:1`).join(" · ")}
                </div>
              </div>
            )}

            {tab === "cards" && <DevList g={g} actor={actor} devPlayable={devPlayable} apply={apply} setModal={setModal} />}

            <Btn tone="warn" style={{ width: "100%", marginTop: 14 }}
              onClick={() => apply((d) => endTurn(d))}>End turn</Btn>
          </>
        )}

        {myTurn && g.phase === "roll" && g.devHands[actor].some(devPlayable) && (
          <div style={{ marginTop: 12 }}>
            <Eyebrow>You may play a knight before rolling</Eyebrow>
            <DevList g={g} actor={actor} devPlayable={devPlayable} apply={apply} setModal={setModal} />
          </div>
        )}

        <div style={{ marginTop: 18, borderTop: `1px solid ${C.line}`, paddingTop: 12 }}>
          <Eyebrow>Your hand — {handTotal(hand)} cards</Eyebrow>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {RES.map((r) => <Chip key={r} res={r} n={hand[r]} />)}
          </div>
          {g.devHands[actor].filter((c) => !c.used).length > 0 && (
            <div style={{ marginTop: 8, color: C.parchDim, fontSize: 13 }}>
              Cards: {g.devHands[actor].filter((c) => !c.used).map((c) => DEV_LABEL[c.type]).join(", ")}
            </div>
          )}
        </div>
      </div>

      {modal && <Modals modal={modal} setModal={setModal} g={g} actor={actor} hand={hand} apply={apply} owed={owed} setNote={setNote} />}
    </div>
  );
}

function DevList({ g, actor, devPlayable, apply, setModal }) {
  const cards = g.devHands[actor].filter((c) => !c.used);
  if (!cards.length) return <div style={{ color: C.parchDim, fontSize: 14 }}>No development cards.</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {cards.map((c, i) => {
        const idx = g.devHands[actor].indexOf(c);
        const ok = devPlayable(c);
        return (
          <div key={i} style={{ border: `1px solid ${C.line}`, borderRadius: 6, padding: "10px 12px" }}>
            <div style={{ fontFamily: dispFont, fontSize: 14, letterSpacing: ".1em", textTransform: "uppercase" }}>{DEV_LABEL[c.type]}</div>
            <div style={{ color: C.parchDim, fontSize: 13, margin: "3px 0 8px" }}>{DEV_TEXT[c.type]}</div>
            {c.type !== "vp" && (
              <Btn disabled={!ok} onClick={() => {
                if (c.type === "plenty") return setModal({ k: "plenty", idx });
                if (c.type === "monopoly") return setModal({ k: "monopoly", idx });
                apply((d) => playDev(d, actor, idx, null));
              }}>{ok ? "Play" : c.turn >= g.turnNo ? "Bought this turn" : "Not now"}</Btn>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Modals({ modal, setModal, g, actor, hand, apply, owed, setNote }) {
  const [pick, setPick] = useState(emptyHand());
  const [give, setGive] = useState(emptyHand());
  const [want, setWant] = useState(emptyHand());
  const [plenty, setPlenty] = useState(emptyHand());
  const [partner, setPartner] = useState(null);
  const [bankGive, setBankGive] = useState(null);
  const [bankWant, setBankWant] = useState(null);
  const [newName, setNewName] = useState(g.players[actor].name);
  const [secretWord, setSecretWord] = useState("");
  useEffect(() => {
    setPick(emptyHand()); setGive(emptyHand()); setWant(emptyHand());
    setPlenty(emptyHand()); setPartner(null); setBankGive(null); setBankWant(null);
    setNewName(g.players[actor].name); setSecretWord("");
  }, [modal.k]);
  const close = () => setModal(null);
  const cap = (n) => ({ brick: n, lumber: n, wool: n, grain: n, ore: n });

  if (modal.k === "log") {
    return (
      <Sheet title="Recent moves" onClose={close}>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {g.log.slice().reverse().map((l, i) => (
            <div key={i} style={{ color: i === 0 ? C.parch : C.parchDim, fontSize: 14, lineHeight: 1.4 }}>{l.m}</div>
          ))}
        </div>
        <div style={{ marginTop: 12, color: C.parchDim, fontSize: 12, lineHeight: 1.5 }}>
          The last thirty moves. Anything older is lost to the sea.
        </div>
      </Sheet>
    );
  }

  if (modal.k === "rename") {
    const nm = newName.trim().slice(0, 14);
    const sw = secretWord.trim();
    return (
      <Sheet title="Your seat" onClose={close}
        footer={<Btn tone="go" disabled={!nm} style={{ flex: 1 }}
          onClick={() => {
            apply((d) => {
              const renamed = d.players[actor].name !== nm;
              if (!renamed && !sw) return false;
              if (renamed) {
                say(d, `${d.players[actor].name} is now ${nm}.`);
                d.players[actor].name = nm;
              }
              if (sw) d.players[actor].lock = hashWord(sw);
            });
            close();
          }}>Save</Btn>}>
        <Eyebrow>Name</Eyebrow>
        <input value={newName} onChange={(e) => setNewName(e.target.value)}
          style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,.05)", border: `1px solid ${C.line}`,
            borderRadius: 4, padding: "10px", color: C.parch, fontFamily: bodyFont, fontSize: 16, marginBottom: 14 }} />
        <Eyebrow>Secret word{g.players[actor].lock ? " — set" : ""}</Eyebrow>
        <input value={secretWord} onChange={(e) => setSecretWord(e.target.value)}
          placeholder={g.players[actor].lock ? "Enter a new one to change it" : "Optional"}
          style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,.05)", border: `1px solid ${C.line}`,
            borderRadius: 4, padding: "10px", color: C.parch, fontFamily: bodyFont, fontSize: 16 }} />
        <div style={{ marginTop: 10, color: C.parchDim, fontSize: 13, lineHeight: 1.5 }}>
          If you ever open the game on a different phone, the secret word proves the seat is yours.
          Without one, anyone can rejoin as you (it does get announced in the log).
        </div>
      </Sheet>
    );
  }

  if (modal.k === "rolls") {
    const counts = {};
    for (let n = 2; n <= 12; n++) counts[n] = 0;
    g.rolls.forEach((n) => { counts[n] += 1; });
    const maxC = Math.max(1, ...Object.values(counts));
    const hot = g.rolls.length ? +Object.keys(counts).reduce((a, b) => (counts[b] > counts[a] ? b : a)) : null;
    return (
      <Sheet title={`Rolls — ${g.rolls.length} so far`} onClose={close}>
        {g.rolls.length === 0 && <div style={{ color: C.parchDim, fontSize: 14 }}>No dice have been rolled yet.</div>}
        {g.rolls.length > 0 && (
          <>
            <Eyebrow>Most recent first</Eyebrow>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 16 }}>
              {g.rolls.slice(-24).reverse().map((n, i) => (
                <span key={i} style={{ width: 30, height: 30, display: "inline-flex", alignItems: "center", justifyContent: "center",
                  borderRadius: "50%", fontFamily: dispFont, fontSize: 14,
                  border: `1px solid ${n === 7 ? C.rust : C.line}`,
                  background: i === 0 ? "rgba(224,164,55,.16)" : "rgba(255,255,255,.04)",
                  color: n === 7 ? C.rust : i === 0 ? C.gold : C.parch }}>{n}</span>
              ))}
            </div>
            <Eyebrow>Hot and cold</Eyebrow>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => (
                <div key={n} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 20, textAlign: "right", fontFamily: dispFont, fontSize: 13,
                    color: n === 7 ? C.rust : n === hot && counts[n] > 0 ? C.gold : C.parch }}>{n}</span>
                  <div style={{ flex: 1, height: 14, background: "rgba(255,255,255,.04)", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ width: `${(counts[n] / maxC) * 100}%`, height: "100%",
                      background: n === 7 ? "rgba(164,85,61,.75)" : n === hot && counts[n] > 0 ? C.gold : "rgba(239,230,210,.35)" }} />
                  </div>
                  <span style={{ width: 22, fontFamily: dispFont, fontSize: 12, color: counts[n] ? C.parch : "rgba(239,230,210,.3)" }}>
                    {counts[n] || "—"}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, color: C.parchDim, fontSize: 12, lineHeight: 1.5 }}>
              {hot != null && counts[hot] > 0 ? `${hot} is running hot. ` : ""}The dice owe nobody anything.
            </div>
          </>
        )}
      </Sheet>
    );
  }

  if (modal.k === "discard") {
    const total = handTotal(pick);
    return (
      <Sheet title={`Discard ${owed}`} onClose={close}
        footer={<Btn tone="warn" disabled={total !== owed} style={{ flex: 1 }}
          onClick={() => { apply((d) => doDiscard(d, actor, pick)); close(); }}>
          {total === owed ? `Discard ${owed}` : `${total} of ${owed} chosen`}</Btn>}>
        <ResStepper value={pick} max={hand} onChange={(r, v) => setPick({ ...pick, [r]: Math.min(v, hand[r]) })} />
      </Sheet>
    );
  }

  if (modal.k === "bank") {
    const rate = bankGive ? tradeRate(g, actor, bankGive) : null;
    const row = (label, value, onSet, filter, showRate) => (
      <div style={{ marginBottom: 14 }}>
        <Eyebrow>{label}</Eyebrow>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {RES.map((r) => {
            const dis = !filter(r);
            return (
              <button key={r} disabled={dis} onClick={() => onSet(r)} style={{
                background: value === r ? "rgba(224,164,55,.16)" : "rgba(255,255,255,.04)",
                border: `1px solid ${value === r ? C.gold : C.line}`, borderRadius: 5, padding: "8px 10px",
                color: dis ? "rgba(239,230,210,.25)" : C.parch, fontFamily: dispFont, fontSize: 12,
                letterSpacing: ".06em", cursor: dis ? "default" : "pointer" }}>
                <span style={{ marginRight: 5 }}>{RES_ICON[r]}</span>
                {RES_LABEL[r]}{showRate && <span style={{ color: C.parchDim }}> {tradeRate(g, actor, r)}:1</span>}
              </button>
            );
          })}
        </div>
      </div>
    );
    return (
      <Sheet title="Trade with the bank" onClose={close}
        footer={<Btn tone="go" style={{ flex: 1 }} disabled={!bankGive || !bankWant || bankGive === bankWant}
          onClick={() => { apply((d) => bankTrade(d, actor, bankGive, bankWant)); close(); }}>
          {bankGive && bankWant ? `Give ${rate} ${RES_LABEL[bankGive].toLowerCase()}` : "Pick both sides"}</Btn>}>
        {row("Give", bankGive, setBankGive, (r) => hand[r] >= tradeRate(g, actor, r), true)}
        {row("Receive 1 of", bankWant, setBankWant, (r) => g.bank[r] > 0, false)}
      </Sheet>
    );
  }

  if (modal.k === "offer") {
    const ok = partner != null && handTotal(give) > 0 && handTotal(want) > 0
      && RES.every((r) => hand[r] >= give[r]);
    return (
      <Sheet title="Offer a trade" onClose={close}
        footer={<Btn tone="go" style={{ flex: 1 }} disabled={!ok}
          onClick={() => { apply((d) => offerTrade(d, actor, partner, give, want)); close(); }}>
          {ok ? `Send the offer to ${pname(g, partner)}` : "Fill in both sides"}</Btn>}>
        <Eyebrow>To</Eyebrow>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          {g.players.map((p, i) => i === actor ? null : (
            <button key={i} onClick={() => setPartner(i)} style={{
              background: partner === i ? "rgba(224,164,55,.16)" : "rgba(255,255,255,.04)",
              border: `1px solid ${partner === i ? C.gold : C.line}`, borderRadius: 5, padding: "8px 12px",
              color: C.parch, fontFamily: dispFont, fontSize: 13, cursor: "pointer" }}>
              <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: PC[p.color].hex, marginRight: 6 }} />
              {p.name}
            </button>
          ))}
        </div>
        <Eyebrow>You give</Eyebrow>
        <ResStepper value={give} max={hand} onChange={(r, v) => setGive({ ...give, [r]: Math.min(v, hand[r]) })} />
        <div style={{ height: 16 }} />
        <Eyebrow>You want in return</Eyebrow>
        <ResStepper value={want} max={cap(19)} onChange={(r, v) => setWant({ ...want, [r]: v })} />
        <div style={{ marginTop: 10, color: C.parchDim, fontSize: 12, lineHeight: 1.5 }}>
          Their cards stay hidden — if they can't cover it, they'll see "can't afford" on their end.
        </div>
      </Sheet>
    );
  }

  if (modal.k === "plenty") {
    const total = handTotal(plenty);
    return (
      <Sheet title="Year of plenty" onClose={close}
        footer={<Btn tone="go" style={{ flex: 1 }} disabled={total !== 2}
          onClick={() => {
            const arr = []; RES.forEach((r) => { for (let i = 0; i < plenty[r]; i++) arr.push(r); });
            apply((d) => playDev(d, actor, modal.idx, arr)); close();
          }}>{total === 2 ? "Take them" : `Choose ${2 - total} more`}</Btn>}>
        <ResStepper value={plenty} max={cap(2)} onChange={(r, v) => {
          const next = { ...plenty, [r]: v }; if (handTotal(next) <= 2) setPlenty(next);
        }} />
      </Sheet>
    );
  }

  if (modal.k === "monopoly") {
    return (
      <Sheet title="Monopoly" onClose={close}>
        <div style={{ color: C.parchDim, fontSize: 14, marginBottom: 12 }}>Name a resource. Everyone hands you all of theirs.</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {RES.map((r) => (
            <Btn key={r} onClick={() => { apply((d) => playDev(d, actor, modal.idx, r)); close(); }}>{RES_ICON[r]} {RES_LABEL[r]}</Btn>
          ))}
        </div>
      </Sheet>
    );
  }
  return null;
}
