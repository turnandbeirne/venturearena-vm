// ============================================================================
// Top-level game reducer
// ----------------------------------------------------------------------------
// The single place that turns an action into a new game state. Delegates
// the actual rules to actions.js / turnEngine.js / aiEngine.js and just
// handles wiring + the shared event log (and, on top of that, the bot chat
// feed — see chatEngine.js).
// ============================================================================
import { createNewGame } from './newGame';
import { buyAsset, sellAsset, startBusiness, learnSkill, upgradeBusiness } from './actions';
import { endTurn, acknowledgeFortuneCard, resolveExitOfferDecision, finalizeGameOver } from './turnEngine';
import { runAiTurn, runAiStep, aiMaxSteps } from './aiEngine';
import {
  reactToLogEntries,
  generateGreeting,
  generateBotTurnFlavor,
  createHumanChatEntry,
  reactToHumanChat,
} from './chatEngine';
import { isOffensiveName } from './nameFilter';
import { seedRng } from './rng';
import { resolveBotConfig } from './players';
import { maybeAttachLesson } from './lessons';
import { seedForDate } from './dailyChallenge';
import { getAssetConfig } from './market';
import { turnOrdinal } from './turnClock';
import { TURN_EXTENSION_SECONDS } from '../data/gameConfig';

const CHAT_MAX_LENGTH = 140;

let logCounter = 0;
function nextLogId() {
  logCounter += 1;
  return `log-${logCounter}-${Date.now()}`;
}

let chatCounter = 0;
function nextChatId() {
  chatCounter += 1;
  return `chat-${chatCounter}-${Date.now()}`;
}

function appendChat(state, entries) {
  if (!entries || entries.length === 0) return state;
  const stamped = entries.map((e) => ({ id: nextChatId(), month: state.month, ...e }));
  return { ...state, chat: [...(state.chat || []), ...stamped].slice(-60) };
}

// Every log entry that gets appended is also offered to the robots as a
// chance to react in character — this is the single choke point both human
// actions (dispatched one at a time below) and a whole robot turn's worth
// of actions (RUN_AI_TURN, which appends several log entries at once) flow
// through, so bot chat "just works" for both without extra wiring per case.
/** "bought 14 Piggy Banks" / "sold a Tree House". */
function tradeMessage(verb, qty, assetId) {
  const asset = getAssetConfig(assetId);
  const name = asset?.name || assetId;
  const plural = asset?.plural || name;
  return qty === 1 ? `${verb} ${name}` : `${verb} ${qty} ${plural}`;
}

/**
 * Fold a repeated trade into an existing line for the same player, asset and
 * turn instead of adding another one.
 *
 * Buying with press-and-hold could produce eighty consecutive "bought a
 * Piggy Bank" entries, which buried everything actually worth reading — the
 * fortune cards, the badges, what the robots were doing. Now the first
 * purchase creates the line and each subsequent one edits it in place, so a
 * turn reads "bought 14 Piggy Banks · bought 2 Lemonade Stands · sold 24
 * Treasure Chests" however the buys were interleaved.
 *
 * Deliberately merges across the whole turn rather than only consecutive
 * entries, so alternating between two assets still collapses to two lines.
 * And deliberately NOT applied to anything else: a robot's stepped turn is
 * supposed to show one readable line per decision (see game/playSpeed.js),
 * and merging distinct actions would undo that.
 *
 * Returns null when there's nothing to merge into.
 */
function mergeTrade(log, entry, turnNo) {
  if (!entry.qty || !entry.assetId) return null;
  for (let i = log.length - 1; i >= 0; i--) {
    const existing = log[i];
    // Stop scanning once we're out of this turn — the log is chronological,
    // so there's nothing mergeable further back.
    if (existing.turnNo !== turnNo) return null;
    if (existing.playerId === entry.playerId && existing.kind === entry.kind) {
      const qty = (existing.qty || 1) + entry.qty;
      const merged = { ...existing, qty, message: tradeMessage(entry.verb, qty, entry.assetId) };
      const next = log.slice();
      next[i] = merged;
      return next;
    }
  }
  return null;
}

function appendLog(state, entries) {
  if (!entries || entries.length === 0) return state;
  const turnNo = turnOrdinal(state);

  // Fold any repeated trades into existing lines first; whatever's left is
  // genuinely new and gets stamped and appended below.
  let mergedLog = state.log;
  const fresh = [];
  for (const entry of entries) {
    const afterMerge = mergeTrade(mergedLog, entry, turnNo);
    if (afterMerge) mergedLog = afterMerge;
    else fresh.push(entry);
  }
  if (fresh.length === 0) {
    // Nothing new to say — but the merged text still has to reach the UI.
    return { ...state, log: mergedLog };
  }
  entries = fresh;
  const stamped = entries.map((e) => ({ id: nextLogId(), month: state.month, turnNo, ...e }));

  // At most one financial-concept lesson per appendLog call (see
  // game/lessons.js) — attaching one to every qualifying entry in a batch
  // would turn a nice, occasional touch into clutter. seenLessons tracks
  // which concepts have already been shown this game so each one only
  // surfaces once.
  //
  // WHO gets that one slot isn't just plain array order, though: a badge
  // ('badge' kind) only ever logs once, ever — evaluateBadges never
  // re-earns one — so if its lesson loses the race to something else in
  // the same batch, it's gone for good this game. A recurring kind
  // (fortuneGood, weather, ...) gets another shot the next time it
  // happens, so it's the one that should yield. Concretely: a month-end
  // batch logs fortune cards BEFORE badges (see turnEngine.js), and
  // 'opportunity'/'emergencyFund' are almost always still unseen on month
  // 1 — without this priority, a badge earned that same first month (e.g.
  // Balanced Investor, easily hit on turn one) would nearly always lose
  // its one-shot lesson to whichever fortune card got drawn first.
  const seenLessons = state.seenLessons || [];
  const priorityOrder = [...stamped.filter((e) => e.kind === 'badge'), ...stamped.filter((e) => e.kind !== 'badge')];
  let winner = null;
  let nextSeenLessons = seenLessons;
  for (const entry of priorityOrder) {
    const found = maybeAttachLesson(nextSeenLessons, entry);
    if (found) {
      winner = { id: entry.id, lesson: found.lesson };
      nextSeenLessons = [...seenLessons, found.conceptId];
      break;
    }
  }
  // Original array order is preserved for display — only WHICH entry wins
  // the lesson slot was decided by the priority scan above.
  const withLessons = stamped.map((entry) => (winner && entry.id === winner.id ? { ...entry, lesson: winner.lesson } : entry));

  const withLog = { ...state, log: [...mergedLog, ...withLessons].slice(-200), seenLessons: nextSeenLessons };
  return appendChat(withLog, reactToLogEntries(withLog, stamped));
}

function withResult(result) {
  // actions.js helpers return { state, ok, error, logEntry }
  if (!result.ok) {
    return { ...result.state, lastError: result.error };
  }
  const entries = result.logEntry ? [result.logEntry] : [];
  return appendLog({ ...result.state, lastError: null }, entries);
}

export function gameReducer(state, action) {
  switch (action.type) {
    case 'START_GAME': {
      // A Daily Challenge run reseeds the shared RNG (game/rng.js) from
      // today's date BEFORE the new game is built, so every random roll
      // that happens while building it (the starting weather's duration)
      // and every roll for the rest of the game (fortune cards, price
      // drift, business names) is identical for every player who plays
      // today's challenge — see game/dailyChallenge.js.
      if (action.dailyChallengeDate) {
        seedRng(seedForDate(action.dailyChallengeDate));
      } else if (action.seed != null) {
        // A VentureArena online table: every browser reseeds from the same
        // number before building the same roster, so weather, prices and
        // cards match across the table — see src/arena/useArenaSync.js.
        seedRng(action.seed);
      }
      const built = createNewGame(
        action.mode,
        action.humanNames,
        action.difficultyId,
        action.botConfigs,
        action.scenarioId,
        action.humanAvatars,
        { turnTimer: action.turnTimer, weatherSeverityId: action.weatherSeverityId }
      );
      const newState = action.dailyChallengeDate ? { ...built, dailyChallengeDate: action.dailyChallengeDate } : built;
      return appendChat(newState, generateGreeting(newState));
    }

    case 'LOAD_GAME':
      return action.state;

    case 'NEW_GAME':
      return null;

    case 'BUY_ASSET':
      return withResult(buyAsset(state, action.playerId, action.assetId, action.qty));

    case 'SELL_ASSET':
      return withResult(sellAsset(state, action.playerId, action.assetId, action.qty));

    case 'START_BUSINESS': {
      const result = startBusiness(state, action.playerId, action.name);
      const next = withResult(result);
      if (!result.ok) return next;
      // A HUMAN player's new business gets a launch celebration (see
      // components/StartupLaunchModal.jsx) — the reducer just records what
      // to celebrate; the UI decides how. Deliberately human-only: a robot
      // starting its fourth business shouldn't stop the table with a
      // fireworks popup. The business is read back out of the RESULT state
      // (rather than rebuilt here) so the name/income shown are exactly the
      // ones actions.js rolled, with no second source of truth.
      const player = next.players.find((p) => p.id === action.playerId);
      if (player?.type !== 'human') return next;
      const business = player.businesses[player.businesses.length - 1];
      if (!business) return next;
      return {
        ...next,
        pendingLaunch: {
          playerId: player.id,
          playerName: player.name,
          avatar: player.avatar,
          businessId: business.id,
          businessName: business.name,
          income: business.income,
        },
      };
    }

    case 'ACK_STARTUP_LAUNCH':
      return state?.pendingLaunch ? { ...state, pendingLaunch: null } : state;

    case 'LEARN_SKILL':
      return withResult(learnSkill(state, action.playerId));

    case 'UPGRADE_BUSINESS':
      return withResult(upgradeBusiness(state, action.playerId, action.businessId, action.trackId));

    case 'END_TURN': {
      const { state: nextState, logEntries } = endTurn(state, action.playerId);
      // Clear the stepped-robot-turn bookkeeping on every hand-off, so the
      // next robot starts from a clean step count no matter how its
      // predecessor's turn ended (ran out of moves, hit its cap, or was a
      // human turn that never used these fields at all).
      return appendLog({ ...nextState, aiTurnSteps: 0, aiTurnDone: false, turnDeadlineAt: null }, logEntries);
    }

    // One robot decision, then stop — the watchable path. hooks/useGame.js
    // dispatches this repeatedly, waiting the player's chosen beat between
    // each (see game/playSpeed.js), and ends the turn once `aiTurnDone`
    // comes back true. Everything the old all-at-once RUN_AI_TURN did still
    // happens, just spread across several dispatches instead of one:
    // per-action log entries (and so per-action sounds and bot chat
    // reactions, via appendLog) land one at a time, and the once-per-turn
    // goof-off flavor fires on the final step.
    case 'RUN_AI_STEP': {
      const player = state.players.find((p) => p.id === action.playerId);
      if (!player || player.type !== 'ai') return state;

      const stepsTaken = state.aiTurnSteps || 0;
      const outOfSteps = stepsTaken >= aiMaxSteps(player);
      const { state: afterStep, logEntry, acted } = outOfSteps
        ? { state, logEntry: null, acted: false }
        : runAiStep(state, action.playerId);

      if (!acted) {
        // Nothing left worth doing. Mark the turn finished and give the bot
        // its one shot at a goof-off sound / hype quote, exactly as
        // RUN_AI_TURN does at the same point in the turn.
        const done = { ...afterStep, aiTurnDone: true };
        return appendChat(done, generateBotTurnFlavor(done, action.playerId));
      }

      return appendLog({ ...afterStep, aiTurnSteps: stepsTaken + 1, aiTurnDone: false }, logEntry ? [logEntry] : []);
    }

    // The whole robot turn in one dispatch. Interactive play uses
    // RUN_AI_STEP above instead; this remains for the VentureMaker Arena's
    // server-side replay (no UI to pace) and for tests.
    case 'RUN_AI_TURN': {
      const { state: afterAi, logEntries } = runAiTurn(state, action.playerId);
      // Clear the stepped-turn bookkeeping the same way END_TURN does.
      // Without this, a state that still carried `aiTurnSteps` from a
      // stepped turn would make the NEXT RUN_AI_STEP think the robot was
      // already out of moves and skip its whole turn — a real hazard once
      // a server replaying whole turns and a client stepping them share
      // the same save.
      let logged = appendLog({ ...afterAi, aiTurnSteps: 0, aiTurnDone: false }, logEntries);
      // Independent of whatever the bot actually did this turn, it gets a
      // separate small chance at a goof-off sound effect and/or a hype
      // quote — see chatEngine.js's generateBotTurnFlavor().
      logged = appendChat(logged, generateBotTurnFlavor(logged, action.playerId));
      const { state: nextState, logEntries: turnLog } = endTurn(logged, action.playerId);
      return appendLog(nextState, turnLog);
    }

    case 'RESOLVE_EXIT_OFFER': {
      const { state: nextState, logEntries } = resolveExitOfferDecision(state, action.playerId, action.accept);
      return appendLog(nextState, logEntries);
    }

    case 'ACK_FORTUNE_CARD': {
      const nextState = acknowledgeFortuneCard(state);
      // The transition from the month's fortune-card recap back to normal
      // play doesn't produce its own "passed the turn" log entry (that only
      // happens for a plain within-month hand-off — see turnEngine.js), so
      // give the new month's first player the same ambient chat chance by
      // hand — reusing the 'endTurn' reaction rather than duplicating it.
      if (nextState.status === 'playing' && state.status !== 'playing') {
        const firstPlayer = nextState.players[nextState.activePlayerIndex];
        const chat = firstPlayer
          ? reactToLogEntries(nextState, [{ kind: 'endTurn', playerId: firstPlayer.id }])
          : [];
        return appendChat(nextState, chat);
      }
      return nextState;
    }

    // Ends the 'gameEnding' pause and shows the actual Game Over screen —
    // dispatched automatically a few seconds in by useGame.js, or
    // immediately by GameBoard.jsx's "See Final Results Now" button. See
    // turnEngine.js's finalizeGameOver.
    case 'FINALIZE_GAME_OVER':
      return finalizeGameOver(state);

    case 'SEND_CHAT': {
      // The composer (ChatPanel.jsx) already validates before dispatching,
      // but the reducer re-checks too — never trust the UI as the only
      // guard against an empty or offensive message slipping into
      // localStorage/the shared log.
      const sender = state.players.find((p) => p.id === action.playerId);
      const trimmed = (action.message || '').trim().slice(0, CHAT_MAX_LENGTH);
      if (!sender || !trimmed || isOffensiveName(trimmed)) return state;
      const humanEntry = createHumanChatEntry(sender, trimmed, action.targetPlayerId);
      let next = appendChat(state, [humanEntry]);
      // A targeted (or random) bot has a chance to chime back — see
      // chatEngine.js's reactToHumanChat for why this is a canned line, not
      // an actual understanding of what was typed.
      next = appendChat(next, reactToHumanChat(next, humanEntry));
      return next;
    }

    // --- Turn timer -------------------------------------------------------
    // The deadline is a wall-clock timestamp COMPUTED BY THE CALLER and
    // passed in, never read from Date.now() inside the reducer. That keeps
    // the reducer a pure function of (state, action) — the property the
    // whole online-multiplayer plan rests on — and means a broadcast action
    // carries the same deadline to every client instead of each one
    // inventing its own.
    case 'START_TURN_TIMER': {
      if (!state.turnTimer || state.status !== 'playing') return state;
      // Already running: never restart a clock mid-turn, or a stray
      // re-render would silently hand the player extra time.
      if (state.turnDeadlineAt) return state;
      return { ...state, turnDeadlineAt: action.deadlineAt };
    }

    case 'EXTEND_TURN': {
      if (!state.turnTimer || state.status !== 'playing') return state;
      const index = state.players.findIndex((p) => p.id === action.playerId);
      // Only the seat actually on the clock can spend its own extension.
      if (index === -1 || index !== state.activePlayerIndex) return state;
      const player = state.players[index];
      if ((player.turnExtensionsLeft || 0) <= 0) {
        return { ...state, lastError: 'No time extensions left this game.' };
      }
      // Extend from whichever is later — the current deadline or now — so
      // asking early adds a full block rather than partly overlapping the
      // time still on the clock, and asking late doesn't extend into the
      // past.
      const from = Math.max(state.turnDeadlineAt || 0, action.now || 0);
      return {
        ...state,
        lastError: null,
        turnDeadlineAt: from + TURN_EXTENSION_SECONDS * 1000,
        players: state.players.map((p, i) =>
          i === index ? { ...p, turnExtensionsLeft: p.turnExtensionsLeft - 1 } : p
        ),
      };
    }

    case 'CONVERT_SEAT_TO_AI': {
      // An absent human at an online table hands their seat to a robot:
      // cash, holdings, businesses and badges are untouched, only who plays
      // the seat changes. Deterministic (goes through the seeded stream) so
      // every browser at the table picks the same robot.
      const idx = state.players.findIndex((p) => p.id === action.playerId);
      if (idx < 0 || state.players[idx].type !== 'human') return state;
      const used = new Set(state.players.filter((p) => p.type === 'ai').map((p) => p.personalityId));
      const { personality, skillLevelId } = resolveBotConfig({ personalityId: 'random', skillLevelId: 'random' }, used);
      const players = state.players.map((p, i) =>
        i === idx
          ? { ...p, type: 'ai', personalityId: personality.id, strategyId: personality.strategyId, skillLevelId, name: `${p.name} (${personality.name})` }
          : p
      );
      const next = { ...state, players, aiTurnSteps: 0, aiTurnDone: false, turnDeadlineAt: null };
      return appendLog(next, [{ icon: '🤖', message: `${state.players[idx].name} stepped away — ${personality.name} is playing the seat now.`, kind: 'takeover' }]);
    }

    case 'CLEAR_ERROR':
      return { ...state, lastError: null };

    default:
      return state;
  }
}
