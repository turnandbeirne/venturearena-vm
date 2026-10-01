import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { PlayerCard, type CardData } from '../components/PlayerCard'

const SEGMENTS = [
  { id: 'playmate', label: 'Play with', feature: null, cta: 'Invite to a game' },
  { id: 'peer', label: 'Peers', feature: null, cta: 'Say hello' },
  { id: 'mentor', label: 'Learn from', feature: 'mentor_match', cta: 'Ask for a debrief' },
  { id: 'cofounder', label: 'Cofounders', feature: 'cofounder_match', cta: 'Play a founding round' },
  { id: 'investor', label: 'Investors', feature: 'investor_match', cta: 'Request an intro' },
]

type Rec = { suggested_id: string; match_type: string; reason: string; score: number }

export default function People() {
  const { profile, allows } = useAuth()
  const [seg, setSeg] = useState('playmate')
  const [recs, setRecs] = useState<Rec[]>([])
  const [cards, setCards] = useState<Record<string, CardData>>({})
  const [all, setAll] = useState<CardData[]>([])
  const [q, setQ] = useState('')
  const [sent, setSent] = useState<Record<string, string>>({})
  const [mix, setMix] = useState<{ card: CardData; reason: string; match_type: string } | null>(null)
  const [mixing, setMixing] = useState(false)
  const mixer = async (mode: string) => {
    setMixing(true)
    try {
      const { data, error } = await supabase.rpc('mixer_next', { p_mode: mode })
      if (error) throw error
      const row = (data ?? [])[0] as { suggested_id: string; reason: string; match_type: string } | undefined
      if (!row) { setMix(null); return }
      const { data: c } = await supabase.from('player_cards').select('*').eq('id', row.suggested_id).single()
      if (c) setMix({ card: c as CardData, reason: row.reason, match_type: row.match_type })
    } finally { setMixing(false) }
  }

  useEffect(() => {
    supabase.rpc('my_recommendations').then(async ({ data }) => {
      const rows = (data ?? []) as Rec[]; setRecs(rows)
      const ids = [...new Set(rows.map(r => r.suggested_id))]
      if (ids.length) { const { data: c } = await supabase.from('player_cards').select('*').in('id', ids); setCards(Object.fromEntries(((c ?? []) as CardData[]).map(x => [x.id, x]))) }
    })
    supabase.from('player_cards').select('*').eq('onboarded', true).order('created_at', { ascending: false }).limit(60).then(({ data }) => setAll((data ?? []) as CardData[]))
  }, [])

  const segment = SEGMENTS.find(s => s.id === seg)!
  const locked = segment.feature ? !allows(segment.feature) : false
  const list = recs.filter(r => r.match_type === seg).map(r => ({ r, c: cards[r.suggested_id] })).filter(x => x.c)
  const filtered = all.filter(c => c.id !== profile?.id && (!q || [c.username, c.display_name, c.archetype, c.stage, ...(c.interests ?? [])].join(' ').toLowerCase().includes(q.toLowerCase())))

  const firstMove = async (c: CardData, type: string) => {
    if (type === 'mentor' || type === 'investor' || type === 'cofounder') {
      await supabase.from('introductions').insert({ kind: type, from_id: profile!.id, to_id: c.id, reason: recs.find(r => r.suggested_id === c.id && r.match_type === type)?.reason })
      setSent(s => ({ ...s, [c.id]: 'Intro requested' }))
    } else {
      await supabase.from('connections').upsert({ requester_id: profile!.id, addressee_id: c.id, source: 'recommendation' })
      setSent(s => ({ ...s, [c.id]: 'Connection sent' }))
    }
    await supabase.from('recommendations').update({ acted_on: true }).eq('player_id', profile!.id).eq('suggested_id', c.id)
  }

  return (
    <div className="space-y-6">
      <div><h1 className="display text-3xl font-extrabold">People</h1><p className="opacity-70 text-sm">Matched on how you play, what stage you're at, and what you said you're looking for.</p></div>
      <div className="card p-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div><div className="display font-bold">Mixer</div><div className="text-xs opacity-70">One person at a time, with the reason: matched on how you play, your stage and what you're looking for; random when the arena doesn't know you yet.</div></div>
          <div className="flex gap-2 flex-wrap">
            <button className="btn btn-gold text-sm" disabled={mixing} onClick={() => mixer('any')}>{mixing ? 'Shuffling…' : mix ? 'Next person' : 'Introduce me to someone'}</button>
            <button className="btn btn-ghost text-sm" disabled={mixing} onClick={() => mixer('peer')}>A peer</button>
            <button className="btn btn-ghost text-sm" disabled={mixing || !allows('mentor_match')} onClick={() => mixer('mentor')}>A mentor</button>
            <button className="btn btn-ghost text-sm" disabled={mixing || !allows('cofounder_match')} onClick={() => mixer('cofounder')}>A cofounder</button>
          </div>
        </div>
        {mix && (
          <div className="mt-3 grid md:grid-cols-[280px_1fr] gap-3 items-start">
            <PlayerCard p={mix.card} flip={false} />
            <div className="space-y-2 text-sm">
              <div><span className="opacity-60">Why:</span> {mix.reason}</div>
              {mix.card.playing_style && <div><span className="opacity-60">How the arena sees them:</span> {mix.card.playing_style}</div>}
              <div className="flex gap-2 flex-wrap">
                <button className="btn btn-gold text-sm" disabled={!!sent[mix.card.id]} onClick={() => firstMove(mix.card, mix.match_type === 'playmate' || mix.match_type === 'peer' ? 'playmate' : mix.match_type)}>{sent[mix.card.id] ?? (mix.match_type === 'mentor' || mix.match_type === 'investor' || mix.match_type === 'cofounder' ? 'Request an intro' : '+ Connect')}</button>
                <Link to={`/p/${mix.card.username}`} className="btn btn-ghost text-sm">See profile</Link>
                <button className="btn btn-ghost text-sm" onClick={() => mixer('any')}>Skip</button>
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="flex gap-2 flex-wrap">{SEGMENTS.map(s => <button key={s.id} onClick={() => setSeg(s.id)} className={`chip py-1.5 px-3 ${seg === s.id ? 'bg-gold text-navy font-semibold' : ''}`}>{s.label}</button>)}</div>

      {locked ? (
        <div className="card p-6 text-center"><div className="display font-bold text-lg">{segment.label} matches are a {segment.feature === 'investor_match' ? 'VIP' : 'Member'} feature</div><p className="text-sm opacity-70 mt-1">Matches for mentors, cofounders and investors only happen when both sides opted in.</p><Link to="/membership" className="btn btn-gold mt-4">See memberships</Link></div>
      ) : list.length === 0 ? (
        <div className="card p-6 text-center opacity-70 text-sm">{seg === 'playmate' ? 'Play a few games and finish your profile; matches appear as the arena learns you.' : `No ${segment.label.toLowerCase()} matches yet. Make sure "${segment.label}" is in your Looking for list, and check back after Arena Night.`}</div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {list.map(({ r, c }) => (
            <div key={c.id} className="space-y-2">
              <PlayerCard p={c} />
              <div className="card p-3 flex items-center gap-3"><div className="text-sm flex-1 opacity-85">{r.reason}</div><button className="btn btn-gold text-sm" disabled={!!sent[c.id]} onClick={() => firstMove(c, seg)}>{sent[c.id] ?? segment.cta}</button></div>
            </div>
          ))}
        </div>
      )}

      <section>
        <div className="flex items-center justify-between mb-2"><h2 className="display font-bold text-lg">Everyone</h2><input className="input w-56" placeholder="operator, revenue, SaaS…" value={q} onChange={e => setQ(e.target.value)} /></div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-2">{filtered.map(c => <PlayerCard key={c.id} p={c} compact />)}</div>
      </section>
    </div>
  )
}
