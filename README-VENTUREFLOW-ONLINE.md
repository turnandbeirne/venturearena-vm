# VentureFlow online tables (VentureArena) — drop-in changes

Copy every file in this folder into the VentureFlow repo at the same path (they replace the originals), commit, push.
Vercel rebuilds; nothing else to configure (no env vars, no server on the VentureFlow side).

## What changes for players who open VentureFlow directly
Only one thing: a banner on the landing page inviting them to play online in VentureArena. Quick Play, Customize,
Kids version, saves, leaderboard, recap emails all behave exactly as before. The online code paths run only when the
page was opened from the arena with `?arena=<token>`.

## What an arena table looks like
1. In VentureArena a host opens a VentureFlow table (up to 4 chairs; robots fill any empty chairs), people join or watch,
   the host presses **Start the race** (this locks the seats and fixes the shared seed).
2. Everyone presses **Open VentureFlow**. The host's browser creates the game (`START_GAME` with the seat list and seed);
   every other browser receives it and shows the same board. Each player's own seat is live only on their own screen;
   on other seats the banner reads "Waiting for <name>…".
3. Every action (buy, sell, business, learn, upgrade, end turn, chat, timer, fortune-card acks, buyout decisions) is
   appended to the table's move list in the arena and replayed in order by all browsers through the unmodified
   `gameReducer`, so all boards stay identical. Robot turns are played by the host's browser and reach everyone the same way.
4. If a human seat goes quiet for 3 minutes on its turn, the host sees **Hand this seat to a robot**; the seat keeps its
   cash, holdings and businesses and a robot finishes the game for it.
5. At game over the host's browser posts the standings to the arena; everyone's rating and reputation update and the
   arena Debrief opens.

## Files
- `src/arena/arenaConfig.js` — arena URL and public key (safe in a browser).
- `src/arena/arenaBridge.js` — token parsing, seat list, results posting.
- `src/arena/useArenaSync.js` — the move-list sync (poll every 1.5 s, append through the `vf-move` function).
- `src/arena/ArenaBanner.jsx` — the in-game ribbon and the landing-page invitation.
- `src/game/players.js` — adds a `mode.type === 'online'` roster (explicit seat list: humans + robots), exports `resolveBotConfig`.
- `src/game/reducer.js` — `START_GAME` accepts an explicit `seed`; new `CONVERT_SEAT_TO_AI` action.
- `src/hooks/useGame.js` — routes `dispatch` through the sync at a table; skips local saves and non-host robot play there.
- `src/components/GameBoard.jsx` — action buttons live only for this browser's seat; observers read-only; host takeover button.
- `src/App.jsx` — auto-start at a table, results posting, banner and invite.
- `scripts/test-arena-replay.mjs` — proves two cold replays of one move list produce identical state
  (`node --import ./scripts/register-loader.mjs scripts/test-arena-replay.mjs`).

## Arena side (already live)
`vf_moves` table + `vf-move` edge function (verifies the launch token, enforces seat ownership and move order),
`launch-game` token carries the seat list and settings, `report-result` accepts the host's standings.
