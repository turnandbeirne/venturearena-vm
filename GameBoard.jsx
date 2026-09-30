import { useEffect, useState } from 'react';
import '../styles/game.css';
import { getDifficulty, ASSETS } from '../data/gameConfig';
import { usePlaySpeed } from '../hooks/usePlaySpeed';
import { useTeachMode } from '../hooks/useTeachMode';
import { turnOrdinal, currentTurnTally } from '../game/turnClock';
import { totalUnitsOwned } from '../game/players';
import { playSound } from '../audio/soundEngine';
import { playMusicTrack, setMusicLevel } from '../audio/musicEngine';
import WeatherBadge from './WeatherBadge';
import WeatherCard from './WeatherCard';
import MonthProgress from './MonthProgress';
import PlayerPanel from './PlayerPanel';
import AssetShop from './AssetShop';
import ActionBar from './ActionBar';
import EventLog from './EventLog';
import ChatPanel from './ChatPanel';
import FortuneCardModal from './FortuneCardModal';
import BusinessExitOfferModal from './BusinessExitOfferModal';
import VolumeControl from './VolumeControl';
import MusicControl from './MusicControl';
import AudioStatus from './AudioStatus';
import Brand from './Brand';
import LeaderboardModal from './LeaderboardModal';
import RulebookModal from './RulebookModal';
import MarketHistoryModal from './MarketHistoryModal';
import SpeedControl from './SpeedControl';
import TurnTimer from './TurnTimer';
import StartupLaunchModal from './StartupLaunchModal';
import StartBusinessModal from './StartBusinessModal';
import PlayerDetailModal from './PlayerDetailModal';
import StatsHUD from './StatsHUD';
import AssetHistoryModal from './AssetHistoryModal';
import GameEndingRecap from './GameEndingRecap';

export default function GameBoard({ game, readOnly = false, onExitReadOnly }) {
  const { state } = game;
  const {
    players,
    activePlayerIndex,
    weather,
    assetPrices,
    previousAssetPrices,
    month,
    totalMonths,
    log,
    chat,
    status,
    weatherIncomeAmounts,
  } = state;
  const difficulty = getDifficulty(state.difficultyId);
  // Read live so a mid-game change to the slider takes effect on the very
  // next beat — including the robot-recap auto-advance below.
  const { speed } = usePlaySpeed();
  const { teachMode, toggle: toggleTeachMode } = useTeachMode();
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showRulebook, setShowRulebook] = useState(false);
  const [showMarket, setShowMarket] = useState(false);
  const [selectedPlayerId, setSelectedPlayerId] = useState(null);
  // Which asset (if any) has its price/cashflow history chart open — see
  // AssetHistoryModal.jsx, opened from a "📊 History" button on each
  // AssetShop card.
  const [selectedAssetId, setSelectedAssetId] = useState(null);
  // Naming step between tapping "Start Business" and the launch
  // celebration — see StartBusinessModal.jsx.
  const [showStartBusiness, setShowStartBusiness] = useState(false);
  const activePlayer = players[activePlayerIndex];
  // What the active player has bought during THIS turn — the shop uses it to
  // warn that selling those units back carries the same-turn resale fee,
  // rather than letting the player discover it from the receipt. Declared
  // after `activePlayer`, which it reads.
  const sameTurnBuys = currentTurnTally(activePlayer?.turnBuys, turnOrdinal(state));
  // "You," for the persistent stats strip below: the active player when
  // it's a human's turn (so hotseat pass-and-play always shows whoever's
  // actually holding the device), otherwise the first human in the roster
  // (so solo mode still shows YOUR numbers while a robot plays, instead of
  // the robot's) — see StatsHUD.jsx.
  const hudPlayer = activePlayer?.type === 'human' ? activePlayer : players.find((p) => p.type === 'human') || null;

  // The soft instrumental plays for the whole time the board is up —
  // through every month, every turn, fortune-card recaps included — since
  // this component stays mounted for all of that; only game-over (a
  // different screen) swaps back to the theme song.
  useEffect(() => {
    playMusicTrack('background');
  }, []);
  // Month 1 is the "settle in" month, so the music stays at medium; from
  // month 2 on it steps back to mid-low for the rest of the game (the
  // game-over screen brings it back up). setMusicLevel is a no-op when the
  // level is already right, so re-running it on every month change is free.
  useEffect(() => {
    setMusicLevel(month <= 1 ? 'medium' : 'midLow');
  }, [month]);
  const selectedPlayer = selectedPlayerId ? players.find((p) => p.id === selectedPlayerId) : null;
  const selectedAsset = selectedAssetId ? ASSETS.find((a) => a.id === selectedAssetId) : null;
  // At a VentureArena table each browser controls one seat: the action
  // buttons are live only when the active player IS this browser's player.
  const localPlayerId = game.localPlayerId || null;
  // An arena observer (no seat) watches the table read-only.
  const spectator = !!game.arena?.active && !localPlayerId;
  const isHumanTurn =
    !readOnly && !spectator && status === 'playing' && activePlayer?.type === 'human' && (!localPlayerId || activePlayer.id === localPlayerId);
  const isRemoteHumanTurn =
    !readOnly && status === 'playing' && activePlayer?.type === 'human' && (spectator || (!!localPlayerId && activePlayer.id !== localPlayerId));
  const currentFortuneEntry = status === 'monthRecap' ? state.fortuneRecap[state.fortuneRecapIndex] : null;
  const currentFortunePlayer = currentFortuneEntry
    ? players.find((p) => p.id === currentFortuneEntry.playerId)
    : null;
  const showModalForHuman = currentFortuneEntry && currentFortunePlayer?.type === 'human';
  const pendingExitOffer = status === 'exitOffer' ? state.pendingExitOffer : null;
  const exitOfferPlayer = pendingExitOffer ? players.find((p) => p.id === pendingExitOffer.playerId) : null;

  // Robots don't need to see their own fortune-card recap — auto-advance
  // past their entries so only human players' cards pause the game.
  useEffect(() => {
    if (status !== 'monthRecap') return;
    if (!currentFortuneEntry) return;
    if (currentFortunePlayer?.type === 'ai') {
      const t = setTimeout(() => game.ackFortuneCard(), speed.recapAdvanceMs);
      return () => clearTimeout(t);
    }
    // Depends on the STABLE useCallback, not the whole `game` object: App
    // rebuilds that object on every one of its renders, so listing it here
    // cleared and restarted this timer each time. Harmless only because
    // nothing currently re-renders App during a recap — but at the fastest
    // speed (200ms) any future ticking state in App would restart the timer
    // faster than it could fire and hang the game on the recap screen.
  }, [status, currentFortuneEntry, currentFortunePlayer, game.ackFortuneCard, speed]);

  // Auto-dismiss error toasts.
  useEffect(() => {
    if (!state.lastError) return;
    const t = setTimeout(() => game.clearError(), 2400);
    return () => clearTimeout(t);
  }, [state.lastError, game.clearError]);

  return (
    <div className="vf-page">
      <div className="vf-board-layout">
        <div className="vf-card vf-board">
          <StatsHUD
            player={hudPlayer}
            prices={assetPrices}
            allPlayers={players}
            month={month}
            weatherIncomeAmounts={weatherIncomeAmounts}
            onOpenPortfolio={(playerId) => {
              setSelectedPlayerId(playerId);
            }}
          />

          <div className="vf-header">
            <Brand size="sm" align="left" />
            <div className="vf-header__right">
              <VolumeControl />
              <MusicControl />
              <AudioStatus />
              {/* Play speed lives in the board header, not just on setup,
                  because the whole point is being able to slow the table
                  down the moment it starts moving faster than you can
                  follow — mid-turn if need be. */}
              <SpeedControl />
              {/* Only renders when this game was started with the timer on
                  and it's a human's live turn — see TurnTimer.jsx. */}
              <TurnTimer
                enabled={!!state.turnTimer && isHumanTurn}
                deadlineAt={state.turnDeadlineAt}
                player={activePlayer}
                onStart={game.startTurnTimer}
                onExtend={() => game.extendTurn(activePlayer.id)}
                onExpire={() => game.endTurn(activePlayer.id)}
              />
              {/* Toggles the on-demand ❓ lesson tooltips scattered across
                  the board (asset cards, weather, fortune cards, business
                  actions/upgrades — see LessonTip.jsx). A device-level
                  preference (hooks/useTeachMode.js), not part of the game
                  itself, so it can be flipped on or off mid-game and stays
                  set for next time. */}
              <button
                type="button"
                className={`vf-btn vf-btn--sm ${teachMode ? 'vf-btn--go' : 'vf-btn--ghost'}`}
                title={
                  teachMode
                    ? 'Teach Me mode is ON — tap Teach Me to hide the ❓ lesson tips'
                    : 'Turn on Teach Me mode for ❓ lesson tips on cards, weather, and more'
                }
                onClick={() => {
                  playSound('click');
                  toggleTeachMode();
                }}
              >
                🎓 Teach Me
              </button>
              <button
                type="button"
                className="vf-btn vf-btn--sm vf-btn--ghost"
                title="Leaderboard"
                onClick={() => {
                  playSound('click');
                  setShowLeaderboard(true);
                }}
              >
                🏆
              </button>
              {/* Sits right next to the leaderboard so the rules are always
                  one tap away, on every screen size, at any point in a game
                  — see components/RulebookModal.jsx. */}
              <button
                type="button"
                className="vf-btn vf-btn--sm vf-btn--ghost"
                title="Rulebook — how everything works"
                onClick={() => {
                  playSound('click');
                  setShowRulebook(true);
                }}
              >
                📖
              </button>
              {/* Market history sits with the other reference tools: what
                  things have cost month by month, and what they paid out. */}
              <button
                type="button"
                className="vf-btn vf-btn--sm vf-btn--ghost"
                title="Market history — prices and payouts by month"
                onClick={() => {
                  playSound('click');
                  setShowMarket(true);
                }}
              >
                📈
              </button>
              <span className="vf-pill" title={difficulty.tagline}>
                {difficulty.icon} {difficulty.name}
              </span>
              <WeatherBadge weather={weather} />
              {readOnly ? (
                <button
                  type="button"
                  className="vf-btn vf-btn--sm vf-btn--ghost"
                  onClick={() => {
                    playSound('click');
                    onExitReadOnly?.();
                  }}
                >
                  ← Back to Recap
                </button>
              ) : (
                <button
                  type="button"
                  className="vf-btn vf-btn--sm vf-btn--ghost"
                  onClick={() => {
                    playSound('click');
                    game.newGame();
                  }}
                >
                  New Game
                </button>
              )}
            </div>
          </div>

          <MonthProgress month={month} totalMonths={totalMonths} />

          <PlayerPanel
            players={players}
            prices={assetPrices}
            month={month}
            weatherIncomeAmounts={weatherIncomeAmounts}
            activePlayerIndex={activePlayerIndex}
            spotlightMs={speed.spotlightMs}
            onSelectPlayer={(playerId) => {
              playSound('click');
              setSelectedPlayerId(playerId);
            }}
          />

          <div className={`vf-turn-banner ${isHumanTurn ? '' : 'vf-turn-banner--ai'}`}>
            <span className="vf-turn-banner__text">
              {readOnly
                ? '🏁 Final game board — here\'s how everything ended up'
                : status === 'gameEnding'
                ? '🏁 That\'s a wrap! Browse the recap, then head to the leaderboard.'
                : status === 'exitOffer'
                ? `💼 ${exitOfferPlayer?.name || 'Someone'} has a buyout offer to decide on...`
                : status === 'monthRecap'
                ? '📬 Reading this month\'s fortune cards...'
                : isRemoteHumanTurn
                ? `${activePlayer?.avatar} Waiting for ${activePlayer?.name}…`
                : isHumanTurn
                ? `${activePlayer.avatar} ${
                    activePlayer.name.toLowerCase() === 'you' ? 'Your' : `${activePlayer.name}'s`
                  } turn — what will you do?`
                : `🤖 ${activePlayer?.name} is thinking...`}
            </span>
            {/* A second "Done!" button, mirroring ActionBar's, so a human
                who's ready to pass can end their turn from up here without
                scrolling past the shop first — see ActionBar.jsx for the
                original at the bottom of the board, which stays in place
                for anyone who scrolls down anyway. Same enable condition,
                same handler; this is a duplicate control, not a new one. */}
            {isRemoteHumanTurn && game.arena?.isHost && Date.now() - (game.arena.lastMoveAt || 0) > 3 * 60 * 1000 && (
              <button
                type="button"
                className="vf-btn vf-btn--sm"
                title="No move for a while. Let a robot play this seat so the table keeps moving."
                onClick={() => game.convertSeatToAi(activePlayer.id)}
              >
                🤖 Hand this seat to a robot
              </button>
            )}
            {isHumanTurn && (
              <button
                type="button"
                className="vf-btn vf-btn--primary vf-btn--sm vf-turn-banner__end-btn"
                onClick={() => game.endTurn(activePlayer.id)}
              >
                Done! Roll the weather 🎲
              </button>
            )}
          </div>

          <AssetShop
            prices={assetPrices}
            previousPrices={previousAssetPrices}
            player={activePlayer}
            allPlayers={players}
            weather={weather}
            weatherIncomeAmounts={weatherIncomeAmounts}
            sameTurnBuys={sameTurnBuys}
            disabled={!isHumanTurn}
            onBuy={(assetId) => game.buyAsset(activePlayer.id, assetId, 1)}
            onSell={(assetId) => game.sellAsset(activePlayer.id, assetId, 1)}
            onViewHistory={(assetId) => setSelectedAssetId(assetId)}
          />

          <ActionBar
            player={activePlayer}
            disabled={!isHumanTurn}
            onStartBusiness={() => {
              playSound('click');
              setShowStartBusiness(true);
            }}
            onLearnSkill={() => game.learnSkill(activePlayer.id)}
            onDone={() => game.endTurn(activePlayer.id)}
          />
        </div>

        {/* Sidebar: weather detail, the event log, and chat all stay in view
            at once on wider screens (sticky) instead of requiring scrolling
            past the board below them — falls back to stacking under the
            board on narrow screens, see game.css's .vf-board-layout.
            EventLog sits above ChatPanel: what actually happened this
            month is the thing you want to catch up on first, with the
            robots' in-character banter as a lower-priority feed below it. */}
        <div className="vf-board-sidebar">
          <WeatherCard
            weather={weather}
            weatherIncomeAmounts={weatherIncomeAmounts}
            weatherSeverityId={state.weatherSeverityId}
          />
          <EventLog log={log} />
          <ChatPanel chat={chat} players={players} onSendChat={game.sendChat} />
        </div>
      </div>

      {showModalForHuman && (
        <FortuneCardModal entry={currentFortuneEntry} onContinue={game.ackFortuneCard} />
      )}

      {pendingExitOffer && (
        <BusinessExitOfferModal
          offer={pendingExitOffer}
          playerName={exitOfferPlayer?.name}
          playerAvatar={exitOfferPlayer?.avatar}
          onDecide={(accept) => game.resolveExitOffer(pendingExitOffer.playerId, accept)}
        />
      )}

      <LeaderboardModal open={showLeaderboard} onClose={() => setShowLeaderboard(false)} />

      <MarketHistoryModal
        open={showMarket}
        history={state.marketHistory}
        onClose={() => setShowMarket(false)}
      />

      <RulebookModal
        open={showRulebook}
        difficultyId={state.difficultyId}
        scenarioId={state.scenarioId}
        weatherSeverityId={state.weatherSeverityId}
        turnTimer={!!state.turnTimer}
        onClose={() => setShowRulebook(false)}
      />

      {/* Launch celebration for a business a human just started. Rendered
          last so it sits above the portfolio modal the player almost
          certainly has open behind it. */}
      {state.pendingLaunch && (
        <StartupLaunchModal launch={state.pendingLaunch} onContinue={game.ackStartupLaunch} />
      )}

      {/* Naming step, opened by ActionBar's Start Business button, above —
          confirming here is what actually dispatches START_BUSINESS; the
          launch celebration modal above then picks up from the resulting
          state.pendingLaunch. */}
      {showStartBusiness && activePlayer && (
        <StartBusinessModal
          existingNames={activePlayer.businesses.map((b) => b.name)}
          onConfirm={(name) => {
            game.startBusiness(activePlayer.id, name);
            setShowStartBusiness(false);
          }}
          onCancel={() => setShowStartBusiness(false)}
        />
      )}

      {selectedPlayer && (
        <PlayerDetailModal
          player={selectedPlayer}
          prices={assetPrices}
          allPlayers={players}
          month={month}
          weather={weather}
          weatherIncomeAmounts={weatherIncomeAmounts}
          // Upgrade buttons only appear when viewing YOUR OWN active turn —
          // opening any other player's card (including mid-turn, including
          // AI) stays read-only, same as it always has been.
          canUpgrade={isHumanTurn && selectedPlayer.id === activePlayer?.id}
          onUpgradeBusiness={(playerId, businessId, trackId) => game.upgradeBusiness(playerId, businessId, trackId)}
          onClose={() => setSelectedPlayerId(null)}
        />
      )}

      {selectedAsset && (
        <AssetHistoryModal
          asset={selectedAsset}
          history={state.assetHistory?.[selectedAsset.id]}
          currentMonth={month}
          currentPrice={assetPrices[selectedAsset.id]}
          totalOwned={totalUnitsOwned(players, selectedAsset.id)}
          weatherIncomeAmounts={weatherIncomeAmounts}
          onClose={() => setSelectedAssetId(null)}
        />
      )}

      {/* The full end-of-game recap — every fortune card each player drew
          all game, plus clickable per-player net worth / passive cash flow
          / earnings timelines. See turnEngine.js's acknowledgeFortuneCard
          (sets this status instead of jumping straight to 'gameover') and
          finalizeGameOver (what "Continue to Leaderboard" dispatches). No
          auto-advance — this is meant to be browsed, not raced through. */}
      {status === 'gameEnding' && (
        <GameEndingRecap
          players={players}
          defaultPlayerId={hudPlayer?.id}
          onContinue={() => game.finalizeGameOver()}
        />
      )}

      {state.lastError && <div className="vf-toast">{state.lastError}</div>}
    </div>
  );
}
