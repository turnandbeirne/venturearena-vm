// ============================================================================
// Player model — factory + selectors
// ============================================================================
import {
  STARTING_CASH,
  STARTING_SKILL_TOKENS,
  ASSETS,
  PLAYER_AVATARS,
  BOT_PERSONALITIES,
  SKILL_LEVELS,
  getBotPersonality,
  BUSINESS_COST,
  getDifficulty,
  DEFAULT_DIFFICULTY_ID,
  TURN_EXTENSIONS_PER_PLAYER,
  RENT_OVERSUPPLY_FREE_UNITS,
  RENT_OVERSUPPLY_RATE,
  RENT_MIN_YIELD_FACTOR,
  PIGGY_INTEREST_PCT_MIN,
  PIGGY_INTEREST_PCT_MAX,
  PIGGY_BONUS_CHANCE,
  PIGGY_BONUS_PCT_MIN,
  PIGGY_BONUS_PCT_MAX,
  WEATHER_STAGES,
  severityScaled,
} from '../data/gameConfig';
// pickRandom — the default (player-choice) stream — for picking a robot's
// personality, exactly like before. envRandomInt/envRandomFloat/envChance —
// the ENVIRONMENT stream — are used ONLY by rollMonthlyIncomeAmounts below,
// which is driven by shared world state (this month's weather, this month's
// bank interest rate), not any player's own choices; see game/rng.js's
// module comment for why that boundary matters (Daily Challenge fairness).
import { pickRandom, envRandomInt, envRandomFloat, envChance } from './rng';
import { activeMarketingBoostTotal } from './businessUpgrades';

export function createPlayer({
  id,
  name,
  avatar,
  type,
  startingCash = STARTING_CASH,
  startingSkillTokens = STARTING_SKILL_TOKENS,
  personalityId = null,
  strategyId = null,
  skillLevelId = null,
}) {
  const holdings = {};
  const purchaseStats = {};
  for (const asset of ASSETS) {
    holdings[asset.id] = 0;
    purchaseStats[asset.id] = { qty: 0, spent: 0 };
  }

  return {
    id,
    name,
    avatar,
    type, // 'human' | 'ai'
    // Robot-only identity: which named personality this bot is playing as
    // and the strategy/skill that drives its turns (game/aiEngine.js).
    // null for human players. See createPlayerRoster below for how these
    // get assigned at game start.
    personalityId,
    strategyId,
    skillLevelId,
    cash: startingCash,
    holdings, // { assetId: quantity currently owned }
    purchaseStats, // { assetId: { qty, spent } } — lifetime buys, for avg purchase price
    businesses: [], // [{ id, income }]
    // Monotonically-increasing counter feeding each new business's id (see
    // actions.js's startBusiness) — NOT the same as businesses.length,
    // which can now shrink (a business exit — see game/businessExits.js —
    // removes one from the array). Deriving the id from array length alone
    // would let a business started AFTER a sale reuse an id that's still
    // referenced elsewhere (a stale React key, an old soldBusinesses/
    // badgeEvents record, ...), so this only ever counts up, never down.
    businessSeq: 0,
    // A permanent record of every business exit this player has cashed in
    // on (see game/businessExits.js) — { id, name, income, multiplier,
    // payout, month }. Never cleared; used for the "sold a business"
    // badge and (eventually) a game-over recap of exits, same spirit as
    // badgeEvents below.
    soldBusinesses: [],
    skillTokens: startingSkillTokens,
    passiveBonus: 0, // permanent $/mo from fortune cards
    // Temporary shocks from fortune cards (see game/decks.js's
    // applyCardEffect and turnEngine.js's payday step):
    //   allowanceMods — [{ percent, expiresMonth }], stacking, pruned once
    //     expired. A lost side job, a new shared cost.
    //   businessPauseUntilMonth — the LAST month in which this player's
    //     businesses earn nothing. 0 means "not paused".
    allowanceMods: [],
    businessPauseUntilMonth: 0,
    // Turn-timer extensions this player has left for the whole game (see
    // gameConfig.js's TURN_EXTENSIONS_PER_PLAYER). Per player rather than
    // per table, so one slow player can't spend everybody else's.
    turnExtensionsLeft: TURN_EXTENSIONS_PER_PLAYER,
    badges: [], // [badgeId]
    badgeEvents: [], // [{ badgeId, month }] — feeds future VentureScouts export
    turnComplete: false,
    scenarioGoalMonth: null, // month this player hit the scenario's objective, if any — see game/scenarios.js
    netWorthHistory: [], // [{ month, netWorth }] — one snapshot per completed month, see game/turnEngine.js
    // Same one-snapshot-per-completed-month convention as netWorthHistory
    // above, for the end-of-game recap's per-player timelines (see
    // components/GameEndingRecap.jsx) — appended in turnEngine.js's
    // finishMonthEnd right alongside the payday/fortune-card steps that
    // already compute these numbers, so there's no second source of truth.
    passiveIncomeHistory: [], // [{ month, passiveIncome }] — passiveIncomeBreakdown's total (business + asset income + card bonus), NOT allowance
    totalIncomeHistory: [], // [{ month, income }] — that month's full Payday total (allowance + passiveIncomeHistory's figure)
    // Every fortune card this player has EVER drawn, in order — unlike
    // state.fortuneRecap (cleared every month once its cards are viewed),
    // this is permanent, for the same end-of-game recap.
    fortuneCardHistory: [], // [{ month, deckId, card, description }]
    // Every cash movement this player has ever had, day 1 through game end
    // — [{ month, type: 'in'|'out', amount, source, detail? }]. Appended to
    // (never rewritten) at every site that actually changes `cash`: buying/
    // selling an asset and starting a business/learning a skill/upgrading a
    // business (actions.js), payday and fortune-card cash effects and an
    // accepted buyout (turnEngine.js). Powers the portfolio's Cash Ledger
    // (components/LedgerModal.jsx). Starts with the player's starting
    // capital already as the first entry, so the ledger genuinely covers
    // "day 1" and not just what happens after it.
    ledger: startingCash > 0 ? [{ month: 1, type: 'in', amount: startingCash, source: 'Starting capital' }] : [],
  };
}

/**
 * Resolve one robot's personality + skill level for roster creation.
 * `config` is `{ personalityId, skillLevelId }` from SetupScreen's bot
 * picker, where either field can be the literal 'random' (or simply
 * missing) to mean "roll it". `usedPersonalityIds` avoids handing two
 * robots at the same table the same named personality when rolling
 * randomly — a human-picked duplicate is left alone, since that's a
 * deliberate choice.
 */
export function resolveBotConfig(config, usedPersonalityIds) {
  const requestedPersonalityId = config?.personalityId;
  let personality;
  if (requestedPersonalityId && requestedPersonalityId !== 'random') {
    personality = getBotPersonality(requestedPersonalityId);
  } else {
    const pool = BOT_PERSONALITIES.filter((p) => !usedPersonalityIds.has(p.id));
    personality = pickRandom(pool.length > 0 ? pool : BOT_PERSONALITIES);
  }
  usedPersonalityIds.add(personality.id);

  const requestedSkillLevelId = config?.skillLevelId;
  const skillLevelId =
    requestedSkillLevelId && requestedSkillLevelId !== 'random'
      ? requestedSkillLevelId
      : pickRandom(SKILL_LEVELS).id;

  return { personality, skillLevelId };
}

/**
 * Build the player roster for a given mode config. Every player — human or
 * robot — starts from the same `difficulty` preset (see gameConfig.js
 * DIFFICULTIES), so the challenge level is consistent across the table.
 * Defaults to the standard difficulty if none is passed (e.g. any direct
 * caller/test that predates difficulty presets).
 *
 * `botConfigs` is an optional array (one entry per robot, from
 * SetupScreen's bot picker) of `{ personalityId, skillLevelId }`, where
 * either field can be 'random'/missing to roll it — see resolveBotConfig
 * above. Omitting it entirely (e.g. an older direct caller) rolls every
 * robot at random, so nothing breaks for callers that predate this feature.
 */
export function createPlayerRoster(
  mode,
  humanNames = [],
  difficulty = getDifficulty(DEFAULT_DIFFICULTY_ID),
  botConfigs = [],
  humanAvatars = []
) {
  const startingCash = difficulty.startingCash;
  const startingSkillTokens = difficulty.startingSkillTokens;

  const players = [];
  if (mode.type === 'solo') {
    players.push(
      createPlayer({
        id: 'p1',
        name: humanNames[0] || 'You',
        avatar: humanAvatars[0] || PLAYER_AVATARS[0],
        type: 'human',
        startingCash,
        startingSkillTokens,
      })
    );
    const usedPersonalityIds = new Set();
    for (let i = 0; i < mode.aiCount; i++) {
      const { personality, skillLevelId } = resolveBotConfig(botConfigs[i], usedPersonalityIds);
      players.push(
        createPlayer({
          id: `ai${i + 1}`,
          name: personality.name,
          avatar: personality.avatar,
          type: 'ai',
          startingCash,
          startingSkillTokens,
          personalityId: personality.id,
          strategyId: personality.strategyId,
          skillLevelId,
        })
      );
    }
  } else if (mode.type === 'online') {
    // VentureArena table: an explicit seat list, humans and robots in one
    // order, so players[i] always corresponds to mode.seats[i] and every
    // browser at the table builds the identical roster — see src/arena/.
    const usedPersonalityIds = new Set();
    let humanIndex = 0;
    let aiIndex = 0;
    for (const seat of mode.seats || []) {
      if (seat.type === 'ai') {
        aiIndex += 1;
        const { personality, skillLevelId } = resolveBotConfig(seat, usedPersonalityIds);
        players.push(
          createPlayer({
            id: `ai${aiIndex}`,
            name: personality.name,
            avatar: personality.avatar,
            type: 'ai',
            startingCash,
            startingSkillTokens,
            personalityId: personality.id,
            strategyId: personality.strategyId,
            skillLevelId,
          })
        );
      } else {
        humanIndex += 1;
        players.push(
          createPlayer({
            id: `p${humanIndex}`,
            name: seat.name || `Player ${humanIndex}`,
            avatar: seat.avatar || PLAYER_AVATARS[humanIndex - 1] || '🙂',
            type: 'human',
            startingCash,
            startingSkillTokens,
          })
        );
      }
    }
  } else if (mode.type === 'hotseat') {
    for (let i = 0; i < mode.humanCount; i++) {
      players.push(
        createPlayer({
          id: `p${i + 1}`,
          name: humanNames[i] || `Player ${i + 1}`,
          avatar: humanAvatars[i] || PLAYER_AVATARS[i] || '🙂',
          type: 'human',
          startingCash,
          startingSkillTokens,
        })
      );
    }
  }
  return players;
}

export function assetValue(player, prices) {
  return ASSETS.reduce((sum, asset) => sum + (player.holdings[asset.id] || 0) * prices[asset.id], 0);
}

export function businessValue(player) {
  // A business is "worth" what's actually been put into it — the original
  // BUSINESS_COST plus every upgrade purchased since (see
  // game/businessUpgrades.js). `totalInvested` tracks that running total;
  // a business loaded from a save made before upgrades existed won't have
  // it, so falls back to just BUSINESS_COST.
  return player.businesses.reduce((sum, b) => sum + (b.totalInvested ?? BUSINESS_COST), 0);
}

export function netWorth(player, prices) {
  return Math.round(player.cash + assetValue(player, prices) + businessValue(player));
}

/** How many units of a rent-bearing asset are owned across EVERY player at
 * the table right now — the denominator effectiveRentPerUnit needs to know
 * how crowded the rental market currently is. */
export function totalUnitsOwned(allPlayers, assetId) {
  return (allPlayers || []).reduce((sum, p) => sum + (p.holdings[assetId] || 0), 0);
}

// A rent-bearing asset's baseline yield, derived from its own configured
// rentPerMonth/basePrice (Tree House: 40/250 = 16%) rather than a separate
// config field — see gameConfig.js's "Tree House rent dynamics" comment.
function baseYield(asset) {
  return asset.basePrice > 0 ? asset.rentPerMonth / asset.basePrice : 0;
}

/** What one unit of a rent-bearing asset currently pays, given its live
 * price and how many units are owned across the whole table right now. The
 * first couple of units anyone owns pay the full baseline yield; every unit
 * beyond that crowds the rental market a bit more and pulls the per-unit
 * yield down, floored so it never goes to nothing. Every asset that isn't
 * rent-bearing (including Lemonade Stand, whose income comes from
 * perUnitIncome/rollMonthlyIncomeAmounts below, and Piggy Bank, whose
 * monthly interest does too) always returns 0 here — only Treasure Chest is
 * genuinely price-only, with no monthly income at all. */
export function effectiveRentPerUnit(asset, price, totalOwned) {
  if (!asset || asset.rentPerMonth <= 0) return 0;
  const excess = Math.max(0, (totalOwned || 0) - RENT_OVERSUPPLY_FREE_UNITS);
  const yieldFactor = Math.max(RENT_MIN_YIELD_FACTOR, 1 / (1 + RENT_OVERSUPPLY_RATE * excess));
  return price * baseYield(asset) * yieldFactor;
}

/**
 * Roll everything about THIS month's per-unit asset income that has to be
 * decided once and then stay put:
 *
 * - every asset with a `weatherIncomeRange` (currently just Lemonade Stand
 *   — see gameConfig.js) gets a flat per-unit dollar amount for the current
 *   weather stage, stored under its own asset id;
 * - every asset flagged `interestBearing` (currently just Piggy Bank) gets
 *   an interest RATE rather than a dollar amount — its payout depends on
 *   the asset's live price, which drifts, so the rate is what's stable —
 *   stored under `interestRates[assetId]`, with `interestBonus[assetId]`
 *   flagging the occasional better-than-usual month so the UI/log can call
 *   it out.
 *
 * Both are rolled on the ENVIRONMENT stream (see game/rng.js's module
 * comment): they're properties of the shared world — the weather, the bank's
 * rate this month — not of any player's own choices, so every Daily
 * Challenge player must see the identical sequence regardless of what they
 * buy or sell.
 *
 * Called once per month at month-end (for the month that's ending — see
 * game/turnEngine.js) plus once at game creation for month 1 (see
 * game/newGame.js). The result is stored on state.weatherIncomeAmounts —
 * a name kept from when this only covered weather-driven income, since
 * renaming it would strand every game already saved in localStorage — so
 * the UI can show a stable, already-rolled figure instead of re-rolling on
 * every render.
 */
export function rollMonthlyIncomeAmounts(weather, weatherSeverityId) {
  const stageId = weather?.stageId;
  // The weather's effect on BUSINESS revenue for this month, folded into the
  // same per-month object everything already receives — so every screen that
  // shows business income picks it up with no new plumbing, exactly like the
  // interest rate above. Businesses used to ignore the weather completely,
  // which made a recession something that happened only to other people.
  const stageFactor = WEATHER_STAGES[stageId]?.businessIncomeFactor ?? 1;
  const amounts = {
    interestRates: {},
    interestBonus: {},
    businessFactor: severityScaled(stageFactor, weatherSeverityId, 1),
  };
  for (const asset of ASSETS) {
    if (asset.weatherIncomeRange) {
      const range = asset.weatherIncomeRange[stageId] || Object.values(asset.weatherIncomeRange)[0];
      const [min, max] = range;
      // TWO draws, always, and take the lower — a triangular distribution
      // whose mode sits at the bottom of the range while the top stays
      // reachable (both draws have to come in high). That's the shape the
      // asset wants: a stand usually earns modestly and occasionally has a
      // brilliant month, rather than reliably earning near the middle.
      // Exactly two draws every time, unconditionally, so the environment
      // stream's position never depends on the weather or on anything a
      // player did — see game/rng.js's module comment.
      const first = envRandomInt(min, max);
      const second = envRandomInt(min, max);
      amounts[asset.id] = Math.min(first, second);
    }
    if (asset.interestBearing) {
      // Draw the bonus coin flip FIRST and unconditionally, then the rate —
      // a fixed number of draws in a fixed order every month, so the
      // environment stream's position can never depend on which branch was
      // taken (same discipline as game/businessExits.js).
      const bonus = envChance(PIGGY_BONUS_CHANCE);
      const normalRate = envRandomFloat(PIGGY_INTEREST_PCT_MIN, PIGGY_INTEREST_PCT_MAX);
      const bonusRate = envRandomFloat(PIGGY_BONUS_PCT_MIN, PIGGY_BONUS_PCT_MAX);
      amounts.interestRates[asset.id] = bonus ? bonusRate : normalRate;
      amounts.interestBonus[asset.id] = bonus;
    }
  }
  return amounts;
}

/** This month's interest rate for an interest-bearing asset, as a fraction
 * (0.003 = 0.3%). Falls back to the middle of the normal range when no roll
 * is available yet (a game saved before interest existed, or a render
 * before the first roll) rather than reading as 0% — see
 * rollMonthlyIncomeAmounts above. */
export function interestRateFor(asset, weatherIncomeAmounts) {
  if (!asset?.interestBearing) return 0;
  const rolled = weatherIncomeAmounts?.interestRates?.[asset.id];
  if (typeof rolled === 'number') return rolled;
  return (PIGGY_INTEREST_PCT_MIN + PIGGY_INTEREST_PCT_MAX) / 2;
}

/** Whether this month's roll was one of the occasional better-than-usual
 * interest months for `asset` (see PIGGY_BONUS_CHANCE in gameConfig.js). */
export function isInterestBonusMonth(asset, weatherIncomeAmounts) {
  return !!(asset?.interestBearing && weatherIncomeAmounts?.interestBonus?.[asset.id]);
}

/** What one unit of ANY asset currently earns per month, dispatching to the
 * right model: a rent-bearing asset (Tree House) uses the live-price cap
 * rate above; a weather-driven asset (Lemonade Stand) uses this period's
 * already-rolled amount from `weatherIncomeAmounts` (see
 * rollMonthlyIncomeAmounts); an interest-bearing asset (Piggy Bank) pays
 * this month's rolled rate against its own live price — deliberately a tiny
 * number, cents per unit, which is exactly the point: saving is safe and
 * slow, and only adds up in volume or over time. Everything else (Treasure
 * Chest) is genuinely price-only and earns 0. Returns a FLOAT — callers sum
 * across assets/units and round once at the end (see
 * passiveIncomeBreakdown), so fractional cents per unit are never lost to
 * premature rounding. */
export function perUnitIncome(asset, { price, totalOwned, weatherIncomeAmounts } = {}) {
  if (asset.rentPerMonth > 0) return effectiveRentPerUnit(asset, price, totalOwned);
  if (asset.weatherIncomeRange) return weatherIncomeAmounts?.[asset.id] ?? 0;
  if (asset.interestBearing) return (price ?? asset.basePrice) * interestRateFor(asset, weatherIncomeAmounts);
  return 0;
}

/** A business's current effective monthly income: its permanent base
 * (original random amount + any Sales/R&D bumps folded in — see
 * game/businessUpgrades.js's applyUpgrade/resolvePendingRnd) plus whatever
 * Marketing boosts are still active this month. Pass `month == null` to get
 * just the permanent figure (used where "current month" isn't known/
 * relevant). */
export function businessMonthlyIncome(business, month) {
  if (month == null) return business.income;
  return business.income + activeMarketingBoostTotal(business, month);
}

/**
 * Same inputs/math as passiveIncome() below, but returns the three
 * components separately (each individually rounded) alongside the exact
 * same `total` passiveIncome() itself returns — used by turnEngine.js's
 * payday step to build the Cash Ledger's human-readable "$X allowance +
 * $Y business income + ..." breakdown without duplicating this formula.
 * `total` is computed from the UNROUNDED parts (summed once, then
 * rounded), exactly like the original single-number passiveIncome() always
 * has, so splitting this out changes no player's actual income by even a
 * penny — only the individually-rounded parts are new, and those are for
 * display only (they can differ from `total` by a dollar or so, since
 * rounding three numbers separately isn't the same as rounding their sum).
 */
export function passiveIncomeBreakdown(player, context = {}) {
  const allPlayers = context.allPlayers || [player];
  const prices = context.prices || {};
  const month = context.month;
  const weatherIncomeAmounts = context.weatherIncomeAmounts || {};

  const assetIncome = ASSETS.reduce((sum, a) => {
    const qty = player.holdings[a.id] || 0;
    if (qty === 0) return sum;
    const total = totalUnitsOwned(allPlayers, a.id);
    const price = prices[a.id] ?? a.basePrice;
    return sum + qty * perUnitIncome(a, { price, totalOwned: total, weatherIncomeAmounts });
  }, 0);
  // A fortune card can suspend this player's business income for a month or
  // two (equipment failure, being short-handed — see game/decks.js's
  // `businessPause`). `month == null` means the caller doesn't know what
  // month it is, in which case the pause can't be evaluated and the honest
  // answer is the un-paused figure rather than a guess.
  const paused = month != null && month <= (player.businessPauseUntilMonth || 0);
  // The weather scales business revenue for the month (see
  // rollMonthlyIncomeAmounts). Defaults to 1 for any caller without a
  // rolled month — an old save, or a context that genuinely has no weather.
  const weatherFactor = weatherIncomeAmounts?.businessFactor ?? 1;
  const businessIncome = paused
    ? 0
    : player.businesses.reduce((sum, b) => sum + businessMonthlyIncome(b, month), 0) * weatherFactor;
  const passiveBonus = player.passiveBonus || 0;
  return {
    assetIncome: Math.round(assetIncome),
    businessIncome: Math.round(businessIncome),
    passiveBonus: Math.round(passiveBonus),
    total: Math.round(assetIncome + businessIncome + passiveBonus),
  };
}

/**
 * A player's total passive (no-extra-effort) monthly income: per-unit
 * income from every asset that has any (dynamic rent from Tree House, this
 * period's rolled weather income from Lemonade Stand — see perUnitIncome
 * above, which is why `allPlayers`/`prices`/`weatherIncomeAmounts` are
 * needed now, not just this one player), every business's current
 * effective income, and any permanent fortune-card passiveBonus. `context`
 * is optional so a caller that only has this one player can still get a
 * (less precise, single-player-only) answer rather than crashing; `month`
 * defaults to "unknown," which safely excludes any temporary Marketing
 * boosts rather than guessing they're active.
 */
/** Whether this player's businesses are currently earning nothing because
 * of a fortune-card shock, and until when. Used by the UI to explain a
 * sudden drop rather than leaving the player to work it out. */
export function businessPauseStatus(player, month) {
  const until = player.businessPauseUntilMonth || 0;
  if (month == null || month > until) return null;
  return { until, monthsLeft: until - month + 1 };
}

/** How much the current weather is helping or hurting business revenue this
 * month, as a percentage delta (+12, -22). Returns 0 when there's nothing
 * rolled yet. Used by the UI to explain why business income moved. */
export function businessWeatherPercent(weatherIncomeAmounts) {
  const factor = weatherIncomeAmounts?.businessFactor;
  if (typeof factor !== 'number') return 0;
  return Math.round((factor - 1) * 100);
}

/** This player's active allowance modifiers for `month`, as a combined
 * percentage (two overlapping cards stack). Returns 0 when nothing applies. */
export function allowanceModifierPercent(player, month) {
  if (month == null) return 0;
  return (player.allowanceMods || []).reduce((sum, m) => (month <= m.expiresMonth ? sum + m.percent : sum), 0);
}

export function passiveIncome(player, context = {}) {
  return passiveIncomeBreakdown(player, context).total;
}

/**
 * Average price per unit a player has paid for an asset, across every
 * purchase made so far this game (not adjusted for later sales — this is a
 * "what have I typically paid" stat, not a remaining cost basis). Returns
 * null if they've never bought that asset.
 */
export function avgPurchasePrice(player, assetId) {
  const stats = player.purchaseStats?.[assetId];
  if (!stats || stats.qty === 0) return null;
  return stats.spent / stats.qty;
}

/**
 * A frozen "hard copy" of a player's portfolio at this exact moment: how
 * much of each asset they own and their lifetime average purchase price for
 * it, plus every business and its individual cash flow. Used to attach a
 * permanent snapshot to a leaderboard entry when a score is saved (see
 * game/leaderboard.js + GameOverScreen) — once saved it never changes
 * again, even if the player goes on to play (and sell everything in)
 * another game.
 */
export function snapshotPortfolio(player, prices) {
  return {
    cash: Math.round(player.cash),
    netWorth: netWorth(player, prices),
    assets: ASSETS.map((asset) => ({
      id: asset.id,
      name: asset.name,
      icon: asset.icon,
      qty: player.holdings[asset.id] || 0,
      avgPurchasePrice: avgPurchasePrice(player, asset.id),
      priceAtSave: prices[asset.id],
    })),
    businesses: player.businesses.map((b, i) => ({ id: b.id, index: i + 1, name: b.name || null, income: b.income })),
  };
}
