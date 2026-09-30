// Two "browsers" replay the same move list from the same seed and must land on identical state.
import { gameReducer } from '../src/game/reducer.js';
import { netWorth } from '../src/game/players.js';

const seats = [
  { type: 'human', name: 'alice', arenaId: 'a', avatar: '🦊' },
  { type: 'human', name: 'bob', arenaId: 'b', avatar: '🦉' },
  { type: 'ai', personalityId: 'random', skillLevelId: 'random' },
  { type: 'ai', personalityId: 'random', skillLevelId: 'random' },
];
const start = { type: 'START_GAME', mode: { type: 'online', seats }, humanNames: ['alice', 'bob'], difficultyId: 'medium', botConfigs: [], scenarioId: 'classic', humanAvatars: ['🦊', '🦉'], turnTimer: false, weatherSeverityId: 'normal', seed: 269330550 };

// Build a plausible log by playing one "authoritative" run: humans buy something and end turn; AI steps until done.
function play(log, months) {
  let s = null;
  const apply = (a) => { s = gameReducer(s, a); log.push(a); };
  apply(start);
  let guard = 0;
  while (s.status !== 'gameover' && s.month <= months && guard++ < 5000) {
    if (s.status === 'monthRecap') { apply({ type: 'ACK_FORTUNE_CARD' }); continue; }
    if (s.status === 'exitOffer') { const pid = s.players.find(p => p.pendingExitOffer)?.id || s.players[0].id; apply({ type: 'RESOLVE_EXIT_OFFER', playerId: pid, accept: false }); continue; }
    if (s.status === 'gameEnding') { apply({ type: 'FINALIZE_GAME_OVER' }); continue; }
    if (s.pendingLaunch) { apply({ type: 'ACK_STARTUP_LAUNCH' }); continue; }
    const ap = s.players[s.activePlayerIndex];
    if (ap.type === 'ai') { apply(s.aiTurnDone ? { type: 'END_TURN', playerId: ap.id } : { type: 'RUN_AI_STEP', playerId: ap.id }); continue; }
    if (ap.cash >= 100 && s.month % 2 === 1) apply({ type: 'BUY_ASSET', playerId: ap.id, assetId: 'piggy', qty: 1 });
    if (s.month === 3 && ap.id === 'p1') apply({ type: 'CONVERT_SEAT_TO_AI', playerId: 'p2' });
    apply({ type: 'END_TURN', playerId: ap.id });
  }
  return s;
}
const log = [];
const a = play(log, 6);
// second browser: cold replay of the same log
let b = null; for (const act of log) b = gameReducer(b, act);
const strip = (st) => JSON.stringify(st, (k, v) => (k === 'id' && typeof v === 'string' && /^(log|chat)-/.test(v)) ? undefined : v);
const same = strip(a) === strip(b);
console.log('moves:', log.length, '| month', a.month, '| status', a.status, '| identical replay:', same);
console.log(a.players.map(p => `${p.id}:${p.type}:${p.name}:$${netWorth(p, a.assetPrices)}`).join('  '));
if (!same) process.exit(1);
