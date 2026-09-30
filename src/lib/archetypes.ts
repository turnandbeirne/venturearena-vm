export type Archetype = 'builder' | 'trader' | 'operator' | 'backer' | 'analyst'

export const ARCHETYPES: Record<Archetype, { name: string; tagline: string; color: string; glyph: string; blurb: string }> = {
  builder: { name: 'Builder', tagline: 'Makes the thing', color: 'var(--color-builder)', glyph: '⚒', blurb: 'You start with the product. Give you a weekend and a problem and something exists on Monday.' },
  trader: { name: 'Trader', tagline: 'Finds the deal', color: 'var(--color-trader)', glyph: '⇄', blurb: 'You see the market before the product. You know what people will pay and who will pay it first.' },
  operator: { name: 'Operator', tagline: 'Makes it run', color: 'var(--color-operator)', glyph: '⚙', blurb: 'You turn chaos into a system. Growth without you is a fire; with you it is a machine.' },
  backer: { name: 'Backer', tagline: 'Fuels the run', color: 'var(--color-backer)', glyph: '◆', blurb: 'You think in portfolios and people. You back founders early and open doors they cannot see.' },
  analyst: { name: 'Analyst', tagline: 'Sees the numbers', color: 'var(--color-analyst)', glyph: '∑', blurb: 'You find the truth in the spreadsheet. Your questions are the ones the room was avoiding.' },
}

export const STAGES: { id: string; name: string; hint: string }[] = [
  { id: 'idea', name: 'Idea', hint: 'Exploring, not yet building' },
  { id: 'pre_revenue', name: 'Pre-revenue', hint: 'Building, no paying customers yet' },
  { id: 'revenue', name: 'Revenue', hint: 'Customers are paying' },
  { id: 'scaling', name: 'Scaling', hint: 'Growing a team and a machine' },
  { id: 'exited', name: 'Exited', hint: 'Sold or stepped back; now investing or mentoring' },
]

export const INTENTS: { id: string; name: string; hint: string }[] = [
  { id: 'play', name: 'People to play with', hint: 'Fun, regular games' },
  { id: 'mentor', name: 'A mentor', hint: 'Someone a few steps ahead' },
  { id: 'peers', name: 'Peers at my stage', hint: 'People wrestling with the same problems' },
  { id: 'cofounder', name: 'A cofounder', hint: 'Someone whose strengths are not mine' },
  { id: 'investor', name: 'Investors or deals', hint: 'Capital, or founders to back' },
]

export const INTEREST_TAGS = ['SaaS', 'B2B services', 'Consumer', 'Marketplaces', 'Hardware', 'Health', 'Fintech', 'Education', 'Real estate', 'Food & ag', 'Games', 'AI', 'Local business', 'Community', 'Franchising', 'Manufacturing']

export const CHIPS = ['bold', 'careful', 'generous', 'sharp', 'patient', 'fun'] as const

// Card sort: each scenario has three answers, each answer nudges archetype scores and risk/pace
export type Scenario = { prompt: string; answers: { text: string; arch: Partial<Record<Archetype, number>>; risk?: number; pace?: number; collab?: 'solo' | 'dealmaker' | 'team' }[] }

export const SCENARIOS: Scenario[] = [
  { prompt: 'Your biggest customer asks for 40% off or they walk.', answers: [
    { text: 'Counter with a smaller discount tied to a longer contract', arch: { trader: 2 }, risk: 3, collab: 'dealmaker' },
    { text: 'Let them walk and fix the product so nobody asks again', arch: { builder: 2 }, risk: 4, collab: 'solo' },
    { text: 'Run the numbers on lifetime value before deciding', arch: { analyst: 2 }, risk: 2, pace: 2 },
  ]},
  { prompt: 'You have 6 months of cash left and growth is flat.', answers: [
    { text: 'Raise now while the story still holds', arch: { backer: 1, trader: 1 }, risk: 4, pace: 4 },
    { text: 'Cut costs to 12 months and find the one channel that works', arch: { operator: 2 }, risk: 2, pace: 3 },
    { text: 'Ship the feature customers keep asking for', arch: { builder: 2 }, risk: 3, pace: 4 },
  ]},
  { prompt: 'A friend pitches you their startup over dinner.', answers: [
    { text: 'Ask who else is in and what the terms are', arch: { backer: 2 }, collab: 'dealmaker' },
    { text: 'Ask to see the product and the retention numbers', arch: { analyst: 2 }, pace: 2 },
    { text: 'Offer to help build it for a weekend', arch: { builder: 1, operator: 1 }, collab: 'team' },
  ]},
  { prompt: 'Your best engineer wants to quit and start a competitor.', answers: [
    { text: 'Offer equity and a bigger problem to own', arch: { backer: 1, operator: 1 }, collab: 'team' },
    { text: 'Wish them well and hire two people', arch: { operator: 2 }, risk: 2 },
    { text: 'Propose partnering: they build, you sell', arch: { trader: 2 }, collab: 'dealmaker', risk: 4 },
  ]},
  { prompt: 'A new market opens overnight. Everyone is rushing in.', answers: [
    { text: 'Be first, fix it later', arch: { builder: 1, trader: 1 }, risk: 5, pace: 5 },
    { text: 'Wait a quarter and enter with the best product', arch: { builder: 1, analyst: 1 }, risk: 2, pace: 2 },
    { text: 'Sell shovels to the people rushing in', arch: { trader: 2 }, risk: 3, pace: 4 },
  ]},
  { prompt: 'You get to pick one meeting this week.', answers: [
    { text: 'Three customers who churned', arch: { analyst: 1, operator: 1 }, pace: 2 },
    { text: 'An investor who backed a rival', arch: { backer: 2 }, collab: 'dealmaker' },
    { text: 'Your team, to rebuild the roadmap', arch: { builder: 1, operator: 1 }, collab: 'team' },
  ]},
  { prompt: 'The board asks for a five-year plan.', answers: [
    { text: 'Give them three scenarios with the numbers', arch: { analyst: 2 }, pace: 2 },
    { text: 'Give them a one-page vision and next quarter in detail', arch: { builder: 1, backer: 1 }, risk: 3 },
    { text: 'Give them the operating model and hiring plan', arch: { operator: 2 }, pace: 3 },
  ]},
  { prompt: 'Two acquisition offers land the same day.', answers: [
    { text: 'Play them against each other', arch: { trader: 2 }, risk: 4, collab: 'dealmaker' },
    { text: 'Decline both; the run is not over', arch: { builder: 2 }, risk: 5 },
    { text: 'Model both against staying independent', arch: { analyst: 1, backer: 1 }, risk: 2, pace: 2 },
  ]},
]

export const PROMPTS = [
  'The best business decision I made this year was...',
  'The thing I wish someone had told me earlier...',
  'I could talk for an hour about...',
  'The industry I secretly want to get into...',
  'My unfair advantage is...',
]

export function scoreCardSort(picks: number[]) {
  const arch: Record<Archetype, number> = { builder: 0, trader: 0, operator: 0, backer: 0, analyst: 0 }
  const risks: number[] = []; const paces: number[] = []; const collabs: Record<string, number> = { solo: 0, dealmaker: 0, team: 0 }
  picks.forEach((ai, si) => {
    const a = SCENARIOS[si].answers[ai]
    Object.entries(a.arch).forEach(([k, v]) => { arch[k as Archetype] += v ?? 0 })
    if (a.risk) risks.push(a.risk); if (a.pace) paces.push(a.pace); if (a.collab) collabs[a.collab]++
  })
  const archetype = (Object.entries(arch).sort((x, y) => y[1] - x[1])[0][0]) as Archetype
  const avg = (xs: number[], d: number) => xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : d
  const collab = Object.entries(collabs).sort((x, y) => y[1] - x[1])[0][0]
  return { archetype, risk: avg(risks, 3), pace: avg(paces, 3), collab, scores: arch }
}

export function describeDna(dna: { risk?: number; pace?: number; collab?: string }) {
  const r = dna.risk ?? 3, p = dna.pace ?? 3
  return {
    risk: `Risk ${r} of 5: ${r >= 4 ? 'you raise early and spend into growth' : r <= 2 ? 'you keep a buffer and move when the numbers say so' : 'you take calculated swings'}`,
    pace: `Pace ${p} of 5: ${p >= 4 ? 'you decide fast and correct later' : p <= 2 ? 'you think first and move once' : 'you match the tempo of the room'}`,
    collab: dna.collab === 'dealmaker' ? 'Dealmaker: you win by making everyone a little better off' : dna.collab === 'team' ? 'Team-first: you build the people before the product' : 'Solo: you move alone until the path is clear',
  }
}
