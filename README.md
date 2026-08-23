# Harbor

An untimed, play-by-link settlers game for four. No accounts, no server state —
the entire game is compressed into the URL, so you pass it around a group chat
and take turns whenever you feel like it.

## Run it locally

```bash
npm install
npm run build
npm start          # http://localhost:3000
```

## Develop

Source is `src/harbor.jsx`. After editing:

```bash
npm run build && npm test
```

`index.html` is a build artifact but is committed, since the server serves it
directly.

See `CLAUDE.md` for architecture and the sharp edges.
