import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase, rpc } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { ArchetypeBadge } from '../components/PlayerCard'
import { CHIPS } from '../lib/archetypes'

type Res = { player_id: string; placement: number; rating_before: number; rating_after: number; profile: { username: string; display_name: string | null; archetype: string | null } | null; is_bot?: boolean }
type Answer = { player_id: string; answer: string; profile: { username: string } | null }
type Metrics = { netWorth?: number; cash?: number; passive?: number; businesses?: number; units?: number; spent?: number; goodCards?: number; badCards?: number; badges?: number; tookOver?: boolean; takeoverReason?: string | null; finishedBy?: string | null; goalMonth?: number | null; months?: number; scenarioId?: string }

// Elo brackets shown as a skill rank so a number means something at a glance.
export function skillRank(r: number) {
  if (r >= 1450) return { name: 'Mogul', icon: '👑' }
  if (r >= 1300) return { name: 'Shark', icon: '🦈' }
  if (r >= 1150) return { name: 'Operator', icon: '⚙️' }
  return { name: 'Apprentice', icon: '🌱' }
}

function observations(m: Metrics | undefined, placement: number | undefined, n: number): string[] {
  if (!m) return []
  const o: string[] = []
  if ((m.businesses ?? 0) >= 2) o.push(`Builder: started ${m.businesses} businesses`)
  else if ((m.businesses ?? 0) === 1) o.push('Started a business')
  if ((m.passive ?? 0) >= 150) o.push(`Cashflow engine: $${Math.round(m.passive!).toLocaleString()}/month passive at the end`)
  if ((m.units ?? 0) >= 30) o.push(`Accumulator: ${m.units} units held across assets`)
  if ((m.badCards ?? 0) > (m.goodCards ?? 0) && placement === 1) o.push('Resilient: won despite more bad fortune cards than good')
  if ((m.goodCards ?? 0) + (m.badCards ?? 0) > 0) o.push(`Fortune: ${m.goodCards ?? 0} good · ${m.badCards ?? 0} bad`)
  if (m.goalMonth) o.push(`Hit the scenario goal in month ${m.goalMonth}`)
  if (m.tookOver) o.push(`A robot (${m.finishedBy ?? 'bot'}) finished this game${m.takeoverReason === 'resigned' ? ' after a resignation' : m.takeoverReason === 'vote' ? ' after the table voted' : ''}`)
  if (placement === 1 && n > 1) o.push(`Won against ${n - 1} other${n - 1 === 1 ? '' : 's'}`)
  return o
}

export default function Debrief() {
  const { id } = useParams(); const nav = useNavigate(); const { profile, allows } = useAuth()
  const [game, setGame] = useState<{ id: string; name: string; lesson_md: string | null; reflection_questions: string[] } | null>(null)
  const [results, setResults] = useState<Res[]>([])
  const [answers, setAnswers] = useState<Answer[]>([])
  const [mine, setMine] = useState('')
  const [given, setGiven] = useState<Record<string, { chip: string; kudos: boolean }>>({})
  const [connected, setConnected] = useState<Record<string, boolean>>({})
  const [err, setErr] = useState('')
  const [metrics, setMetrics] = useState<Record<string, Metrics>>({})
  const [rank, setRank] = useState<{ rating: number; games: number; wins: number } | null>(null)

  const question = useMemo(() => {
    const qs = game?.reflection_questions ?? []
    if (!qs.length || !id) return 'What would you do differently next time?'
    let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
    return qs[h % qs.length]
  }, [game, id])

  useEffect(() => {
    (async () => {
      const { data: t } = await supabase.from('tables').select('game_id, status').eq('id', id).single()
      if (!t) return
      const { data: g } = await supabase.from('games').select('id, name, lesson_md, reflection_questions').eq('id', t.game_id).single()
      setGame(g)
      const { data: r } = await supabase.from('results').select('player_id, placement, rating_before, rating_after, profile:profiles(username, display_name, archetype)').eq('table_id', id).order('placement')
      const { data: s } = await supabase.from('table_seats').select('player_id, is_bot').eq('table_id', id)
      setResults(((r ?? []) as unknown as Res[]).map(x => ({ ...x, is_bot: (s ?? []).find(y => y.player_id === x.player_id)?.is_bot })))
      const { data: a } = await supabase.from('debriefs').select('player_id, answer, profile:profiles(username)').eq('table_id', id)
      setAnswers((a ?? []) as unknown as Answer[])
      const { data: tm } = await supabase.from('telemetry').select('player_id, metrics').eq('table_id', id)
      setMetrics(Object.fromEntries(((tm ?? []) as { player_id: string; metrics: Metrics }[]).map(x => [x.player_id, x.metrics])))
      if (profile?.id) { const { data: rt } = await supabase.from('ratings').select('rating, games_played, wins').eq('player_id', profile.id).eq('game_id', t.game_id).maybeSingle(); if (rt) setRank({ rating: rt.rating, games: rt.games_played, wins: rt.wins }) }
      const { data: c } = await supabase.from('connections').select('requester_id, addressee_id').eq('requester_id', profile?.id ?? '')
      setConnected(Object.fromEntries((c ?? []).map(x => [x.addressee_id, true])))
    })()
    const ch = supabase.channel(`debrief-${id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'debriefs', filter: `table_id=eq.${id}` }, async () => {
      const { data: a } = await supabase.from('debriefs').select('player_id, answer, profile:profiles(username)').eq('table_id', id)
      setAnswers((a ?? []) as unknown as Answer[])
    }).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [id, profile?.id])

  const act = async (fn: () => Promise<unknown>) => { setErr(''); try { await fn() } catch (e) { setErr((e as Error).message) } }
  const submit = () => act(() => rpc('answer_debrief', { p_table: id, p_question: question, p_answer: mine.trim() }))
  const feedback = (to: string, chip: string, kudos: boolean) => act(async () => { await rpc('give_feedback', { p_table: id, p_to: to, p_chip: chip, p_kudos: kudos }); setGiven(g => ({ ...g, [to]: { chip, kudos } })) })
  const connect = (to: string) => act(async () => { await supabase.from('connections').insert({ requester_id: profile!.id, addressee_id: to, source: 'table' }).throwOnError(); setConnected(c => ({ ...c, [to]: true })) })
  const rematch = () => act(async () => { const t = await rpc<string>('create_table', { p_game: game!.id }); nav(`/t/${t}`) })

  const me = results.find(r => r.player_id === profile?.id)
  const others = results.filter(r => r.player_id !== profile?.id && !r.is_bot)
  const iWatched = results.length > 0 && !results.some(r => r.player_id === profile?.id)
  const myAnswer = answers.find(a => a.player_id === profile?.id)
  const iWon = !!me && me.placement === 1 && others.every(o => o.placement > 1)
  const myObs = observations(metrics[profile?.id ?? ''], me?.placement, results.length)
  const myRank = rank ? skillRank(rank.rating) : null

  if (!game) return <div className="opacity-60">Loading debrief…</div>

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {iWon && <Confetti />}
      <div className={`card p-5 ${iWon ? 'border-gold shadow-[0_0_40px_rgba(232,182,74,0.25)]' : ''}`}>
        <div className="text-xs uppercase tracking-wide opacity-60">Result · {game.name}</div>
        <div className="display text-3xl font-extrabold mt-1">{me ? (iWon ? '🏆 You won!' : me.placement === 1 ? 'Draw' : me.placement === 2 ? 'Runner-up' : 'Good game') : iWatched ? 'You watched' : 'Game over'}</div>
        {iWon && <div className="text-gold text-sm mt-1">Winner's circle. Your rating, reputation and this result are now on your card and in your history.</div>}
        {me && (
          <div className="mt-3 grid sm:grid-cols-[auto_1fr] gap-3 items-start">
            {myRank && rank && <div className="chip text-sm px-3 py-2" title={`Rating ${rank.rating} · ${rank.wins} wins in ${rank.games} games`}>{myRank.icon} Skill rank: <b className="ml-1">{myRank.name}</b> <span className="opacity-60 ml-1">· {rank.rating}{me.rating_after - me.rating_before !== 0 && <span className={me.rating_after >= me.rating_before ? 'text-backer' : 'text-red-300'}> ({me.rating_after - me.rating_before >= 0 ? '+' : ''}{me.rating_after - me.rating_before})</span>}</span></div>}
            {myObs.length > 0 && <div className="text-sm"><div className="text-xs uppercase tracking-wide opacity-60">How you played</div><ul className="mt-1 space-y-0.5">{myObs.map(o => <li key={o}>· {o}</li>)}</ul></div>}
          </div>
        )}
        {iWatched && <div className="text-sm opacity-70 mt-1">Observers don't get a rating change, but your take on the game counts in the debrief.</div>}
        <div className="mt-3 space-y-1">
          {results.map(r => (
            <div key={r.player_id} className="flex items-center gap-2 text-sm">
              <span className="w-5 opacity-60">{r.placement}.</span><ArchetypeBadge archetype={r.profile?.archetype} size="sm" />
              <span className="font-medium flex-1">{r.profile?.display_name || r.profile?.username}{r.is_bot ? ' 🤖' : ''}</span>
              {metrics[r.player_id]?.netWorth != null && <span className="opacity-70">${Math.round(metrics[r.player_id].netWorth!).toLocaleString()}</span>}
              {!r.is_bot && <span className={r.rating_after >= r.rating_before ? 'text-backer' : 'text-red-300'}>{r.rating_after - r.rating_before >= 0 ? '+' : ''}{r.rating_after - r.rating_before} → {r.rating_after} {skillRank(r.rating_after).icon}</span>}
            </div>
          ))}
        </div>
        {err && <div className="text-red-300 text-sm mt-2">{err}</div>}
      </div>

      <div className="card p-5">
        <div className="text-xs uppercase tracking-wide opacity-60">Reflection</div>
        <div className="display text-xl font-bold mt-1">{question}</div>
        {myAnswer ? <div className="mt-3 text-sm"><span className="opacity-60">You:</span> {myAnswer.answer}</div> : (
          <div className="flex gap-2 mt-3"><input className="input" maxLength={500} placeholder="One or two sentences" value={mine} onChange={e => setMine(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} /><button className="btn btn-gold" onClick={submit} disabled={!mine.trim()}>Post</button></div>
        )}
        <div className="mt-3 space-y-2">{answers.filter(a => a.player_id !== profile?.id).map(a => <div key={a.player_id} className="text-sm pop"><span className="font-semibold opacity-80">{a.profile?.username}:</span> {a.answer}</div>)}</div>
        {game.lesson_md && allows('full_history') ? <details className="mt-4 text-sm"><summary className="cursor-pointer text-gold">The lesson</summary><p className="opacity-85 mt-2 leading-relaxed">{game.lesson_md}</p></details>
          : game.lesson_md ? <div className="mt-4 text-sm opacity-80"><span className="text-gold">Lesson card:</span> {game.lesson_md.split('. ')[0]}. <Link to="/membership" className="underline opacity-70">Full lessons for Members</Link></div> : null}
      </div>

      {others.length > 0 && (
        <div className="card p-5">
          <div className="text-xs uppercase tracking-wide opacity-60 mb-3">People</div>
          {others.map(o => (
            <div key={o.player_id} className="mb-4 last:mb-0">
              <div className="flex items-center gap-2"><ArchetypeBadge archetype={o.profile?.archetype} size="sm" /><Link to={`/p/${o.profile?.username}`} className="font-semibold hover:underline">{o.profile?.display_name || o.profile?.username}</Link></div>
              <div className="text-xs opacity-60 mt-2">One word for how they played</div>
              <div className="flex flex-wrap gap-1.5 mt-1">{CHIPS.map(c => <button key={c} onClick={() => feedback(o.player_id, c, given[o.player_id]?.kudos ?? false)} className={`chip capitalize ${given[o.player_id]?.chip === c ? 'bg-gold text-navy font-semibold' : ''}`}>{c}</button>)}</div>
              <div className="flex gap-2 mt-3">
                <button className="btn btn-ghost text-sm" onClick={() => feedback(o.player_id, given[o.player_id]?.chip ?? 'fun', true)} disabled={given[o.player_id]?.kudos}>{given[o.player_id]?.kudos ? 'Kudos sent' : '👏 Kudos'}</button>
                <button className="btn btn-ghost text-sm" onClick={() => connect(o.player_id)} disabled={connected[o.player_id]}>{connected[o.player_id] ? 'Requested' : '+ Connect'}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <button className="btn btn-gold" onClick={rematch} disabled={!allows('create_table')}>Play again</button>
        <Link to="/play" className="btn btn-ghost">Back to the arena</Link>
      </div>
    </div>
  )
}

function Confetti() {
  const pieces = Array.from({ length: 48 }, (_, i) => i)
  const colors = ['#e8b64a', '#2fb7a6', '#a37cf0', '#5fc27a', '#f06c6c', '#ffffff']
  return (
    <div className="pointer-events-none fixed inset-0 z-10 overflow-hidden" aria-hidden>
      {pieces.map(i => (
        <span key={i} className="confetti" style={{ left: `${(i * 37) % 100}%`, background: colors[i % colors.length], animationDelay: `${(i % 12) * 0.15}s`, animationDuration: `${2.6 + (i % 5) * 0.4}s`, transform: `rotate(${(i * 53) % 360}deg)` }} />
      ))}
    </div>
  )
}
