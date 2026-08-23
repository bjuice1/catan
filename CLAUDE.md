# Harbor

A settlers-of-catan-style board game for 4 friends, each on their own phone.
One invite link (`#g=CODE`) goes into the group chat once; everyone taps it,
claims a seat with their own name, and plays. The Node server is a **dumb
versioned store**: it holds the latest client-encoded state blob per game code
and enforces "strictly newer version wins" — it never reads game state. Clients
poll every 3 seconds and push moves; on a version conflict they rebase (adopt
the server state, re-apply the move) and retry.

The state blob is the same gzipped/base64url `pack()` payload the old
pass-the-phone version put in the URL hash — typically 350–750 characters.

## History

v1 used Claude artifacts' `window.storage` (needed accounts — rejected). v2
put the whole game in the URL hash and passed links every turn — worked, but
the send-the-link-every-turn flow was miserable in practice. v3 (current)
keeps the same codec but syncs through our own server; old v2 blob links
still decode and get imported into the server on open.

## Layout

```
src/harbor.jsx    Everything: geometry, rules, codec, sync, UI. ~1800 lines.
src/main.jsx      Mounts App into #root.
build.mjs         esbuild → inlines React + app into a single index.html.
index.html        Build output. COMMITTED — Railway serves it directly.
server.js         Versioned game store + web push + static PWA files.
manifest.webmanifest, sw.js, icons/   The PWA shell (icons are generated
                  by scripts/make-icons.mjs and committed).
test/smoke.mjs    Real server + four jsdom phones. See below.
```

`src/harbor.jsx` is organised in four bands, in order:

1. **Geometry** — `baseGeometry()` builds the 19 hexes, 54 vertices, 72 edges
   and 30 coastal edges once at module load, from fixed math. `GEO` is a
   module-level constant and is never serialised.
2. **Rules** — placement legality, production, robber, dev cards, longest road,
   scoring. All pure functions taking `(g, ...)` and mutating a draft.
3. **Codec** — `pack`/`unpack` and `encodeGame`/`decodeGame`.
4. **UI** — `Board` (SVG), `App`, `Modals`.

## Things that will bite you

- **Roads are keyed by owner index, and player 0 is falsy.** `if (g.roads[e])`
  is a bug — player 0's roads read as empty and get overwritten. Use
  `g.roads[e] !== undefined`. This shipped broken once.
- **Vertex ids are rounded coordinate strings.** `snap()` normalises `-0` to
  `0`; without it you get 56 vertices instead of 54 and the board silently
  develops duplicate corners. Don't touch it without re-checking those counts.
- **`pack` and `unpack` must stay in lockstep.** Anything you add to game state
  must be added to both or it vanishes on the next hand-off — and it will look
  like a gameplay bug, not a serialisation one. Round-trip test before shipping.
- **Only derivable-free data goes in the link.** Hex positions, port positions,
  and vertex ids are all rebuilt from `GEO` on unpack. Only terrain, numbers,
  port types and indices travel.
- **The log is truncated to 5 entries** in the link. The group chat is the real
  history.
- **`history.replaceState` throws on `file://`** and in sandboxed frames, so
  `publish()` falls back to setting `location.hash`. Keep both paths.

## Rules coverage

Full ruleset: snake-draft setup, production with the official bank-shortage
rule, robber and discards on 7, roads/towns/cities with piece limits, all 25
dev cards, 3:1 and 2:1 ports, bank trades, longest road (with opponent
settlements breaking paths), largest army, win at 10.

**Player trading is deliberately not an offer/accept flow.** That would need two
extra link hand-offs per trade. Instead you haggle in the group chat and record
the agreed trade, which validates both hands before executing.

## Testing

```bash
npm install
npm run build      # must run before npm test
npm test
```

`test/smoke.mjs` boots the real `server.js`, then drives four jsdom "phones"
through the real bundle: create a game, claim all seats over the one invite
link, full 8-step snake-draft setup, then ~35 turns with sevens, discards and
robber moves — each acted from the owning phone, synced only through the
server (poll interval shortened via `window.HARBOR_POLL_MS`).

It asserts the snake draft order, that no phone is ever asked to send a link,
that the stored blob stays small, that seats survive reopening the invite
link, and that the board stays coherent everywhere. Add a check here for any
bug you fix.

## Deploying

Railway, connected to this repo, auto-deploys on push. `npm start` runs
`server.js`. `npm run build` runs automatically on deploy, so `src/` is the
source of truth — but `index.html` is committed too, so a broken build step
never takes the site down.

Live at: catan-production-f877.up.railway.app

Remember to hard-refresh on mobile after a deploy; `Cache-Control` is 5 minutes.

## Known open items

- ~~**Zoom on real hardware is unverified.**~~ Confirmed fixed by an iPhone
  screenshot (2026-08-23): board fits at `52vh` with the whole UI on one
  screen. The screenshot instead exposed the status-bar overlap in standalone
  mode, fixed with safe-area insets.
- ~~**No notifications.**~~ Web push ships: the server pings the next player
  on turn changes and seven-discards (driven by client-sent `meta`, so the
  server stays blob-blind; deduped per turn number). On iPhone this only works
  after Add to Home Screen + tapping 🔔. VAPID keys are generated per server
  run unless pinned with `VAPID_PUBLIC`/`VAPID_PRIVATE` env vars on Railway —
  pin them, else subscriptions silently re-key after each deploy (clients do
  self-heal by re-subscribing on next open).
- **Hidden information isn't actually hidden.** Anyone who decodes the link can
  read every hand. Unavoidable in this design; the UI just doesn't show it.
  This is stated plainly on the home screen.
- ~~**Opening an old link forks the game.**~~ Gone by design: the server is
  authoritative and rejects any push whose `seq` isn't strictly newer, so a
  stale link just loads and then syncs forward on the next poll.
- **Games live in server memory only.** A Railway redeploy or restart wipes
  the store; any phone with the game open reseeds it automatically on its next
  poll or push. If *every* phone has closed the tab when the server restarts,
  the game is gone. A disk or KV persistence layer would fix this.
