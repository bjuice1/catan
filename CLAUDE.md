# Harbor

A settlers-of-catan-style board game for 4 friends, played untimed over a group
chat. **The URL is the save file.** There is no server-side state, no database,
no accounts. The whole game — board, hands, dev cards, robber, roads — is
gzipped and base64url'd into the location hash. You take your turn, tap "Send
the link", and the next player taps it in iMessage.

Typical payload is 350–750 characters. It has never exceeded ~1.5KB in testing.

## Why it works this way

The first version used Claude artifacts' `window.storage` API with shared keys,
which synced automatically across everyone's phone. It was better in every way
except one: opening a published artifact that uses the storage API triggers
"You need a Claude account to use this artifact." Three friends were not going
to make accounts. So it was rebuilt with zero persistence.

**Don't reintroduce a storage layer** without checking that constraint still
matters. If everyone ends up with accounts, the older shared-storage design is
genuinely nicer and worth resurrecting.

## Layout

```
src/harbor.jsx    Everything: geometry, rules, codec, UI. ~1400 lines.
src/main.jsx      Mounts App into #root.
build.mjs         esbuild → inlines React + app into a single index.html.
index.html        Build output. COMMITTED — Railway serves it directly.
server.js         12 lines of Node. Serves index.html on every path.
test/smoke.mjs    Plays a real game through jsdom. See below.
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

`test/smoke.mjs` boots the real shipped bundle in jsdom and plays through the
UI: full 8-step setup with link hand-offs between simulated devices, then ~30
turns with sevens, discards and robber moves. It re-boots a fresh jsdom window
from the on-screen link at each hand-off, so it exercises the codec end to end
the way a real pass does.

It asserts the snake draft order, that setup produces exactly 6 hand-offs (the
4th player places twice in a row), that link payloads stay URL-sized, and that
the board stays coherent. Add a check here for any bug you fix.

## Deploying

Railway, connected to this repo, auto-deploys on push. `npm start` runs
`server.js`. `npm run build` runs automatically on deploy, so `src/` is the
source of truth — but `index.html` is committed too, so a broken build step
never takes the site down.

Live at: catan-production-f877.up.railway.app

Remember to hard-refresh on mobile after a deploy; `Cache-Control` is 5 minutes.

## Known open items

- **Zoom on real hardware is unverified.** The board is capped at `52vh` and
  pinch is unblocked, but the original report ("way too zoom, then the zoom is
  broken") was never confirmed fixed on an actual iPhone. Get a screenshot.
- **No notifications.** The group chat is the notification system. A player who
  doesn't get poked will stall the game indefinitely.
- **Hidden information isn't actually hidden.** Anyone who decodes the link can
  read every hand. Unavoidable in this design; the UI just doesn't show it.
  This is stated plainly on the home screen.
- **Opening an old link forks the game.** Newest link wins; there's no guard
  against someone scrolling up in the chat and tapping a stale one. A turn
  counter check with a warning would be a real improvement.
