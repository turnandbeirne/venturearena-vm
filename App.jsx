import { useCallback, useEffect, useState } from 'react';
import { useGame } from './hooks/useGame';
import { useGameSounds } from './hooks/useGameSounds';
import { useChatSounds } from './hooks/useChatSounds';
import { useProfile } from './hooks/useProfile';
import { unlockAudio } from './audio/soundEngine';
import { unlockMusic } from './audio/musicEngine';
import LandingScreen from './components/LandingScreen';
import SetupScreen from './components/SetupScreen';
import GameBoard from './components/GameBoard';
import GameOverScreen from './components/GameOverScreen';
import ArenaBanner, { ArenaInvite } from './arena/ArenaBanner';
import { getArena, reportArenaResults } from './arena/arenaBridge';
import { netWorth } from './game/players';

export default function App() {
  const game = useGame();
  const { state } = game;
  // The unlockable board theme (see game/profile.js) is applied as a
  // data-theme attribute here at the root, so every screen picks it up
  // through theme.css's [data-theme='...'] overrides without each screen
  // needing to know cosmetics exist.
  const { profile, recordResult } = useProfile();

  // Which pre-game screen is showing. The landing page is the front door
  // (explains the game, shows the top 5, one-click Quick Play); "Customize"
  // steps forward to the full setup screen, and finishing or abandoning a
  // game comes back to the landing page. Deliberately local UI state rather
  // than anything in the game reducer — no game exists yet at this point.
  const [preGameScreen, setPreGameScreen] = useState('landing');
  // "🗺️ View Game Board" on the Game Over screen flips this on to show the
  // final board (read-only — see GameBoard.jsx's readOnly prop) instead of
  // the leaderboard/recap screen; "← Back to Recap" flips it back. Local UI
  // state, not game state — nothing about the finished game itself changes
  // while toggling between the two views.
  const [showBoardAfterGameOver, setShowBoardAfterGameOver] = useState(false);

  // VentureArena table: the host's browser creates the shared game once the
  // move feed is confirmed empty; everyone else just receives it. When the
  // game is over the host posts the standings back to the arena.
  const arena = game.arena;
  const [arenaResult, setArenaResult] = useState(null);
  useEffect(() => {
    if (arena?.active && arena.isHost && !state && arena.status === 'waiting') arena.startIfHost();
  }, [arena?.active, arena?.isHost, arena?.status, arena?.pollCount, state]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (arena?.active && arena.isHost && state?.status === 'gameover' && arena.seats) {
      reportArenaResults(state, arena.seats, (p) => netWorth(p, state.assetPrices)).then((r) => r && setArenaResult(r));
    }
  }, [arena?.active, arena?.isHost, state?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every path that ends a game returns to the front door rather than
  // dropping the player straight into a form.
  const newGame = useCallback(() => {
    setPreGameScreen('landing');
    setShowBoardAfterGameOver(false);
    game.newGame();
  }, [game]);

  // Browsers refuse audio until the page has had a real user gesture, so the
  // FIRST interaction anywhere — whatever it was for — is used to unlock both
  // engines. Without this, whether sound works depends on whether the first
  // thing you happened to click was something that plays a sound.
  //
  // `unmute: false` matters: this path must never override a player who
  // deliberately turned sound off. Only the explicit AudioStatus button
  // unmutes, because only that click means "I want sound".
  useEffect(() => {
    const unlock = () => {
      unlockAudio({ unmute: false, testSound: null });
      unlockMusic({ unmute: false });
    };
    document.addEventListener('pointerdown', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
    return () => {
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
    };
  }, []);

  // Mounted once at the top so they keep watching the event log and bot
  // chat feed (and stay in sync with the volume/mute setting) no matter
  // which screen shows.
  useGameSounds(state?.log);
  useChatSounds(state?.chat);

  function renderPreGame() {
    if (getArena()) {
      return (
        <div style={{ padding: 24, textAlign: 'center', color: '#f6f1e7' }}>
          <h2>Setting the table…</h2>
          <p>{arena?.status === 'offline' ? 'Reconnecting to the arena…' : arena?.isHost ? 'Dealing everyone in.' : 'Waiting for the host to start. This page updates on its own.'}</p>
          <p><a href={arena?.arena?.tableUrl} style={{ color: '#e8b64a' }}>Back to the arena table</a></p>
        </div>
      );
    }
    if (preGameScreen === 'setup') {
      return <SetupScreen onStart={game.startGame} onBack={() => setPreGameScreen('landing')} />;
    }
    return (
      <>
      <ArenaInvite />
      <LandingScreen
        onStart={game.startGame}
        onCustomize={() => setPreGameScreen('setup')}
        staleSave={game.staleSave}
        onResumeSave={game.resumeSavedGame}
        onDiscardSave={game.discardSavedGame}
      />
      </>
    );
  }

  return (
    <div data-theme={profile.selectedTheme}>
      <ArenaBanner sync={arena} result={arenaResult} />
      {!state ? (
        renderPreGame()
      ) : state.status === 'gameover' && !showBoardAfterGameOver ? (
        <GameOverScreen
          state={state}
          onPlayAgain={newGame}
          onRecordProfileResult={recordResult}
          onViewBoard={() => setShowBoardAfterGameOver(true)}
        />
      ) : state.status === 'gameover' ? (
        <GameBoard
          game={{ ...game, newGame }}
          readOnly
          onExitReadOnly={() => setShowBoardAfterGameOver(false)}
        />
      ) : (
        <GameBoard game={{ ...game, newGame }} />
      )}
    </div>
  );
}
