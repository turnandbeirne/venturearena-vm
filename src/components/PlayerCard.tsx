import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ARCHETYPES, type Archetype, describeDna } from '../lib/archetypes'

export type CardData = {
  id: string; username: string; display_name?: string | null; archetype?: string | null; stage?: string | null
  intent?: string[]; interests?: string[]; tier?: string; reputation?: number; kudos?: number; games_played?: number
  rating?: number; chips?: Record<string, number>; dna?: { risk?: number; pace?: number; collab?: string }
  prompts?: { q: string; a: string }[]; open_to_mentoring?: number; is_investor?: boolean; is_anonymous?: boolean; bio?: string | null; playing_style?: string | null
}

export function ArchetypeBadge({ archetype, size = 'md' }: { archetype?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const a = ARCHETYPES[(archetype ?? '') as Archetype]
  const dim = size === 'lg' ? 'w-16 h-16 text-3xl' : size === 'sm' ? 'w-7 h-7 text-sm' : 'w-10 h-10 text-lg'
  return (
    <span className={`${dim} rounded-xl inline-flex items-center justify-center font-bold shrink-0`}
      style={{ background: a ? a.color : 'rgba(255,255,255,.1)', color: '#0b1530' }} title={a?.name ?? 'Unsorted'}>
      {a?.glyph ?? '?'}
    </span>
  )
}

export function RepShield({ score = 100 }: { score?: number }) {
  const band = score >= 150 ? { label: 'Trusted', color: 'var(--color-backer)' } : score >= 50 ? { label: 'Good standing', color: 'var(--color-gold)' } : { label: 'New', color: 'var(--color-operator)' }
  return <span className="chip" style={{ borderLeft: `3px solid ${band.color}` }} title={`Reputation ${score}: ${band.label}. Moves on finished games, kept appointments and kudos.`}>⛨ {score}</span>
}

export function TierBadge({ tier }: { tier?: string }) {
  if (!tier || tier === 'free' || tier === 'anonymous') return null
  const label = tier === 'ceo' ? 'CEO' : tier === 'vip' ? 'VIP' : 'Member'
  return <span className="chip" style={{ background: 'var(--color-gold)', color: '#1a1200', fontWeight: 700 }}>{label}</span>
}

export function PlayerCard({ p, flip = true, compact = false }: { p: CardData; flip?: boolean; compact?: boolean }) {
  const [back, setBack] = useState(false)
  const a = ARCHETYPES[(p.archetype ?? '') as Archetype]
  const chips = Object.entries(p.chips ?? {}).sort((x, y) => y[1] - x[1]).slice(0, 3)
  const dna = p.dna && Object.keys(p.dna).length ? describeDna(p.dna) : null
  const stage = p.stage?.replace('_', ' ')

  if (compact) return (
    <Link to={`/p/${p.username}`} className="card p-3 flex items-center gap-3 hover:border-white/20">
      <ArchetypeBadge archetype={p.archetype} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold truncate">{p.display_name || p.username} <TierBadge tier={p.tier} /></div>
        <div className="text-xs opacity-70 truncate">{a?.name ?? 'Unsorted'}{stage ? ` · ${stage}` : ''} · {p.rating ?? 1200}</div>
      </div>
      <RepShield score={p.reputation} />
    </Link>
  )

  return (
    <div className="relative select-none" style={{ perspective: 1000 }} onClick={() => flip && setBack(b => !b)}>
      <div className="card p-5 transition-transform duration-500" style={{ transformStyle: 'preserve-3d', transform: back ? 'rotateY(180deg)' : 'none', minHeight: 300, cursor: flip ? 'pointer' : 'default' }}>
        {/* front */}
        <div style={{ backfaceVisibility: 'hidden' }} className={back ? 'invisible' : ''}>
          <div className="flex items-start gap-4">
            <ArchetypeBadge archetype={p.archetype} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="display text-xl font-bold truncate">{p.display_name || p.username}</div>
              <div className="text-sm opacity-80">{a ? `${a.name} · ${a.tagline}` : 'Not yet sorted'}{stage ? ` · ${stage} stage` : ''}</div>
              <div className="mt-2 flex flex-wrap gap-1.5"><TierBadge tier={p.tier} /><RepShield score={p.reputation} />{p.open_to_mentoring ? <span className="chip">Mentor</span> : null}{p.is_investor ? <span className="chip">Investor</span> : null}</div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-5 text-center">
            <Stat label="Rating" value={p.rating ?? 1200} hint="1,200 is the starting rating. You gain more for beating stronger players." />
            <Stat label="Games" value={p.games_played ?? 0} hint="Completed games across the arena." />
            <Stat label="Kudos" value={p.kudos ?? 0} hint="Given by opponents after a game." />
          </div>
          {chips.length > 0 && (
            <div className="mt-4"><div className="text-xs uppercase tracking-wide opacity-60 mb-1">How others see you</div>
              <div className="flex gap-1.5 flex-wrap">{chips.map(([c, n]) => <span key={c} className="chip capitalize">{c} ×{n}</span>)}</div></div>
          )}
          {a && <p className="mt-4 text-sm opacity-80 leading-snug">{a.blurb}</p>}
          {flip && <div className="mt-3 text-xs opacity-50">Tap to flip</div>}
        </div>
        {/* back */}
        <div className={`absolute inset-0 p-5 ${back ? '' : 'invisible'}`} style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
          <div className="display font-bold text-lg mb-2">Looking for</div>
          <div className="flex flex-wrap gap-1.5 mb-4">{(p.intent ?? []).length ? p.intent!.map(i => <span key={i} className="chip capitalize">{i}</span>) : <span className="opacity-60 text-sm">Not set yet</span>}</div>
          {dna && (
            <div className="space-y-1 text-sm opacity-90 mb-4">
              <div>{dna.risk}</div><div>{dna.pace}</div><div>{dna.collab}</div>
            </div>
          )}
          {(p.interests ?? []).length > 0 && <div className="flex flex-wrap gap-1.5 mb-3">{p.interests!.map(i => <span key={i} className="chip">{i}</span>)}</div>}
          {(p.prompts ?? []).filter(x => x.a).slice(0, 2).map((x, i) => (
            <div key={i} className="text-sm mb-2"><span className="opacity-60">{x.q}</span> <span className="font-medium">{x.a}</span></div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: number | string; hint: string }) {
  return <div className="rounded-xl bg-white/5 py-2" title={hint}><div className="display text-lg font-bold">{value}</div><div className="text-[11px] uppercase tracking-wide opacity-60">{label}</div></div>
}
