// VentureFlow table settings: the catalog the host picks from (mirrors the
// game's own data/gameConfig.js) and the presets. Validated server-side by
// vf_normalize_settings; keep the ids in sync with the migration.

export type BotConfig = { personalityId: string; skillLevelId: string }
export type VfSettings = {
  preset: 'casual' | 'classic' | 'shark' | 'custom'
  scenarioId: string
  difficultyId: string
  weatherSeverityId: string
  turnTimer: boolean
  bots: BotConfig[]
  fillWithRobots: boolean
  seed?: number
  aiCount?: number
}

export const SCENARIOS = [
  { id: 'classic', icon: '🏆', name: 'Classic Growth', tagline: 'Highest net worth after 24 months wins.' },
  { id: 'passiveIncomeRace', icon: '🏁', name: 'Passive Income Race', tagline: 'First to the monthly passive-income goal.' },
  { id: 'survivalCrash', icon: '⛈️', name: 'Survive the Crash', tagline: 'Start mid-storm. Recover if you can.' },
  { id: 'businessSprint', icon: '🚀', name: 'Business Sprint', tagline: 'Three businesses running by month 12.' },
]
export const DIFFICULTIES = [
  { id: 'easy', icon: '🌈', name: 'KidStuff', tagline: '$800 to start, $220 a month. Stress-free.' },
  { id: 'medium', icon: '⚖️', name: 'Middle of the Pack', tagline: '$500 to start, $150 a month. The classic.' },
  { id: 'hard', icon: '🥊', name: 'Hard Knocks', tagline: '$300 to start, $90 a month. Every choice counts.' },
]
export const WEATHER = [
  { id: 'gentle', icon: '🌤️', name: 'Gentle', tagline: 'The economy nudges.' },
  { id: 'normal', icon: '🌦️', name: 'Normal', tagline: 'Booms and busts you can ride out.' },
  { id: 'rough', icon: '🌧️', name: 'Rough', tagline: 'Storms really bite.' },
  { id: 'severe', icon: '⛈️', name: 'Severe', tagline: 'Brutal swings. Diversify or get wiped out.' },
]
export const PERSONALITIES = [
  { id: 'random', avatar: '🎲', name: 'Surprise me', style: 'random' },
  { id: 'leeroy', avatar: '🐔', name: 'Leeroy Jenkins', style: 'reckless' },
  { id: 'bossemby', avatar: '🕶️', name: 'BossEmby', style: 'flipper' },
  { id: 'mrb', avatar: '🎩', name: 'MrB', style: 'balanced' },
  { id: 'mrgrinch', avatar: '🎄', name: 'MrGrinch', style: 'hoarder' },
  { id: 'daddybigbux', avatar: '💼', name: 'DaddyBigBux', style: 'tycoon' },
  { id: 'moneymama', avatar: '👛', name: 'MoneyMama', style: 'saver' },
  { id: 'grumpymommy', avatar: '😤', name: 'GrumpyMommy', style: 'contrarian' },
]
export const SKILLS = [
  { id: 'random', icon: '🎲', name: 'Any' },
  { id: 'rookie', icon: '🐣', name: 'Rookie' },
  { id: 'sharp', icon: '🧠', name: 'Sharp' },
  { id: 'shark', icon: '🦈', name: 'Shark' },
]

export const DEFAULT_SETTINGS: VfSettings = { preset: 'classic', scenarioId: 'classic', difficultyId: 'medium', weatherSeverityId: 'normal', turnTimer: true, bots: [], fillWithRobots: true }

export const PRESETS: Record<'casual' | 'classic' | 'shark', { name: string; blurb: string; settings: Omit<VfSettings, 'preset'> }> = {
  casual: { name: 'Casual', blurb: 'Roomy budget, gentle weather, rookie robots, no clock.',
    settings: { scenarioId: 'classic', difficultyId: 'easy', weatherSeverityId: 'gentle', turnTimer: false, fillWithRobots: true,
      bots: [{ personalityId: 'random', skillLevelId: 'rookie' }, { personalityId: 'random', skillLevelId: 'rookie' }, { personalityId: 'random', skillLevelId: 'rookie' }] } },
  classic: { name: 'Classic', blurb: 'The standard VentureFlow challenge. Robots fill empty chairs.',
    settings: { ...DEFAULT_SETTINGS } },
  shark: { name: 'Shark tank', blurb: 'Tight budget, rough weather, shark robots, 30-second turns.',
    settings: { scenarioId: 'classic', difficultyId: 'hard', weatherSeverityId: 'rough', turnTimer: true, fillWithRobots: true,
      bots: [{ personalityId: 'mrgrinch', skillLevelId: 'shark' }, { personalityId: 'daddybigbux', skillLevelId: 'shark' }, { personalityId: 'bossemby', skillLevelId: 'shark' }] } },
}

export function normalize(s: Partial<VfSettings> | null | undefined): VfSettings {
  return { ...DEFAULT_SETTINGS, ...(s ?? {}), bots: Array.isArray(s?.bots) ? s!.bots.map(b => ({ personalityId: b.personalityId ?? 'random', skillLevelId: b.skillLevelId ?? 'random' })) : [] }
}

export function describeBot(b: BotConfig) {
  const p = PERSONALITIES.find(x => x.id === b.personalityId) ?? PERSONALITIES[0]
  const k = SKILLS.find(x => x.id === b.skillLevelId) ?? SKILLS[0]
  return { avatar: p.avatar, name: p.id === 'random' ? 'Mystery robot' : p.name, skill: k.id === 'random' ? 'any skill' : k.name, skillIcon: k.icon }
}

const LAST_KEY = 'va_vf_last_settings'
export function rememberSettings(s: VfSettings) { try { localStorage.setItem(LAST_KEY, JSON.stringify(s)) } catch { /* private mode */ } }
export function lastSettings(): VfSettings | null { try { const raw = localStorage.getItem(LAST_KEY); return raw ? normalize(JSON.parse(raw)) : null } catch { return null } }
