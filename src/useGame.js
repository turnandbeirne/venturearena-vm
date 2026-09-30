import { useEffect, useReducer, useRef, useCallback, useState } from 'react';
import { gameReducer } from '../game/reducer';
import {
  saveGame,
  loadGame,
  clearSavedGame,
  hasSavedGame,
  savedGameSummary,
} from '../game/persistence';
import { usePlaySpeed } from './usePlaySpeed';
import { useArenaSync } from '../arena/useArenaSync';
import { getArena } from '../arena/arenaBridge';

// A robot with a big cash pile can legitimately take a lot of moves in one
// turn (a shark's cap is 32). Pacing every one of them at the full step
// delay would make a rich late-game turn interminable, so each successive
// move in the SAME turn comes a little faster than the last, floored so it
// never becomes the instant burst this replaced. A typical 4-6 move turn
// barely notices; a 20-move turn stays watchable without being a wait.
const STEP_ACCELERATION = 0.82;
const STEP_FLOOR_FACTOR = 0.3;
const ABSOLUTE_STEP_FLOOR_MS = 110;

function stepDelayFor(baseMs, stepsTaken) {
  const floor = Math.max(ABSOLUTE_STEP_FLOOR_MS, baseMs * STEP_FLOOR_FACTOR);
  return Math.max(floor, Math.round(baseMs * STEP_ACCELERATION ** stepsTaken));
}

/**
 * React glue around the pure gameReducer: persists to localStorage on every
 * change, and plays robot turns out one decision at a time so their moves
 * are readable instead of instant.
 *
 * The pacing comes from the player's chosen play speed (game/playSpeed.js),
 * read live — change the slider mid-turn and the very next beat uses the new
 * timing, because this effect re-runs on every state change and reads the
 * current speed each time. Nothing about speed is stored in game state, so
 * it's never baked into a save.
 */
export function useGame() {
  // Read ONCE, before anything can overwrite it. A save written by a
  // different build is deliberately NOT auto-resumed: a game in progress
  // carries its own settings — seat count, turn timer, weather severity,
  // card deck — so dropping the player back into it after an update looks
  // exactly like the update undid its own features. Instead the landing
  // page offers the choice, and the save is left untouched until they make
  // it (the persist effect below only writes when a game is actually open).
  const [staleSave, setStaleSave] = useState(() => {
    const summary = savedGameSummary();
    return summary && summary.stale ? summary : null;
  });

  const [state, localDispatch] = useReducer(gameReducer, null, () => {
    // A VentureArena table never resumes a local save: its state is rebuilt
    // from the table's shared move list — see src/arena/useArenaSync.js.
    if (getArena()) return null;
    const summary = savedGameSummary();
    return summary && summary.stale ? null : loadGame();
  });
  // At an arena table, actions go to the table first and come back in order;
  // otherwise this is exactly the reducer's own dispatch.
  const arena = useArenaSync(localDispatch, state);
  const dispatch = arena.dispatch;
  const aiTimeoutRef = useRef(null);
  const { speed } = usePlaySpeed();

  // Persist whenever state changes (and there's an active game).
  useEffect(() => {
    if (state && !arena.active) saveGame(state);
  }, [state, arena.active]);

  // Drive the active robot's turn: one decision per beat, then hand off.
  useEffect(() => {
    if (!state || state.status !== 'playing') return;
    // At an arena table only the host's browser plays the robots' turns
    // (their moves reach everyone through the shared move list).
    if (arena.active && !arena.isHost) return;
    const activePlayer = state.players[state.activePlayerIndex];
    if (!activePlayer || activePlayer.type !== 'ai') return;

    const stepsTaken = state.aiTurnSteps || 0;
    const finished = !!state.aiTurnDone;
    const delay = finished ? speed.turnHandoffMs : stepDelayFor(speed.aiStepMs, stepsTaken);

    aiTimeoutRef.current = setTimeout(() => {
      dispatch(
        finished
          ? { type: 'END_TURN', playerId: activePlayer.id }
          : { type: 'RUN_AI_STEP', playerId: activePlayer.id }
      );
    }, delay);

    return () => clearTimeout(aiTimeoutRef.current);
  }, [state, speed, arena.active, arena.isHost, dispatch]);

  // The 'gameEnding' pause (the final month's "that's a wrap" recap, between
  // the last fortune card and the actual Game Over screen — see
  // turnEngine.js's acknowledgeFortuneCard/finalizeGameOver) no longer
  // auto-advances: it's a full recap dashboard now (GameEndingRecap.jsx),
  // not a beat to sit through, so the player leaves it with the "Continue to
  // Leaderboard" button whenever they're done browsing — no timer to race.

  const startGame = useCallback((mode, humanNames, difficultyId, botConfigs, options = {}) => {
    dispatch({
      type: 'START_GAME',
      mode,
      humanNames,
      difficultyId,
      botConfigs,
      scenarioId: options.scenarioId,
      humanAvatars: options.humanAvatars,
      dailyChallengeDate: options.dailyChallengeDate,
      turnTimer: !!options.turnTimer,
      weatherSeverityId: options.weatherSeverityId,
    });
  }, [dispatch]);

  const newGame = useCallback(() => {
    if (arena.active) { window.location.href = arena.arena.tableUrl; return; }
    clearSavedGame();
    dispatch({ type: 'NEW_GAME' });
  }, [dispatch, arena]);

  const buyAsset = useCallback((playerId, assetId, qty = 1) => {
    dispatch({ type: 'BUY_ASSET', playerId, assetId, qty });
  }, [dispatch]);

  const sellAsset = useCallback((playerId, assetId, qty = 1) => {
    dispatch({ type: 'SELL_ASSET', playerId, assetId, qty });
  }, [dispatch]);

  const startBusiness = useCallback((playerId, name) => {
    dispatch({ type: 'START_BUSINESS', playerId, name });
  }, [dispatch]);

  const learnSkill = useCallback((playerId) => {
    dispatch({ type: 'LEARN_SKILL', playerId });
  }, [dispatch]);

  const upgradeBusiness = useCallback((playerId, businessId, trackId) => {
    dispatch({ type: 'UPGRADE_BUSINESS', playerId, businessId, trackId });
  }, [dispatch]);

  const endTurn = useCallback((playerId) => {
    dispatch({ type: 'END_TURN', playerId });
  }, [dispatch]);

  const startTurnTimer = useCallback((deadlineAt) => {
    dispatch({ type: 'START_TURN_TIMER', deadlineAt });
  }, [dispatch]);

  const extendTurn = useCallback((playerId) => {
    // Date.now() is read HERE, in the UI layer, and passed in — the reducer
    // stays a pure function of (state, action). See reducer.js's timer cases.
    dispatch({ type: 'EXTEND_TURN', playerId, now: Date.now() });
  }, [dispatch]);

  const ackStartupLaunch = useCallback(() => {
    dispatch({ type: 'ACK_STARTUP_LAUNCH' });
  }, [dispatch]);

  const ackFortuneCard = useCallback(() => {
    dispatch({ type: 'ACK_FORTUNE_CARD' });
  }, [dispatch]);

  const finalizeGameOver = useCallback(() => {
    dispatch({ type: 'FINALIZE_GAME_OVER' });
  }, [dispatch]);

  const resolveExitOffer = useCallback((playerId, accept) => {
    dispatch({ type: 'RESOLVE_EXIT_OFFER', playerId, accept });
  }, [dispatch]);

  const sendChat = useCallback((playerId, message, targetPlayerId) => {
    dispatch({ type: 'SEND_CHAT', playerId, message, targetPlayerId });
  }, [dispatch]);

  const clearError = useCallback(() => {
    dispatch({ type: 'CLEAR_ERROR' });
  }, [dispatch]);

  // Pick the older game back up, knowing it keeps its original settings.
  const resumeSavedGame = useCallback(() => {
    const loaded = loadGame();
    setStaleSave(null);
    if (loaded) dispatch({ type: 'LOAD_GAME', state: loaded });
  }, [dispatch]);

  // Throw the older game away and stay on the front door.
  const discardSavedGame = useCallback(() => {
    clearSavedGame();
    setStaleSave(null);
  }, [dispatch]);

  const convertSeatToAi = useCallback((playerId) => {
    dispatch({ type: 'CONVERT_SEAT_TO_AI', playerId });
  }, [dispatch]);

  return {
    state,
    arena,
    localPlayerId: arena.localPlayerId,
    convertSeatToAi,
    hasSavedGame: hasSavedGame(),
    staleSave,
    resumeSavedGame,
    discardSavedGame,
    startGame,
    newGame,
    buyAsset,
    sellAsset,
    startBusiness,
    learnSkill,
    upgradeBusiness,
    endTurn,
    startTurnTimer,
    extendTurn,
    ackStartupLaunch,
    ackFortuneCard,
    finalizeGameOver,
    resolveExitOffer,
    sendChat,
    clearError,
  };
}
