import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase, rpc } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { ArchetypeBadge } from '../components/PlayerCard'
import { CHIPS } from '../lib/archetypes'

type Res = { player_id: string; placement: number; rating_before: number; rating_after: number; profile: { username: string; display_name: string | null; archetype: string | null } | null; is_bot?: boolean }
type Answer = { player_id: string; answer: string; profile: { username: string } | null }

export default function Debrief() {
  const { id } = useParams(); const nav = useNavigate(); const { profile, allows } = useAuth()
  const [game, setGame] = useState<{ id: string; name: string; lesson_md: string | null; reflection_questions: string[] } | null>(null)
  const [results, setResults] = useState<Res[]>([])
  const [answers, setAnswers] = useState<Answer[]>([])
  const [mine, setMine] = useState('')
  const [given, setGiven] = useState<Record<string, { chip: string; kudos: boolean }>>({})
  const [connected, setConnected] = useState<Record<string, boolean>>({})
  const [err, setErr] = useState('')

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
  const myAnswer = answers.find(a => a.player_id === profile?.id)

  if (!game) return <div className="opacity-60">Loading debrief…</div>

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="card p-5">
        <div className="text-xs uppercase tracking-wide opacity-60">Result · {game.name}</div>
        <div className="display text-3xl font-extrabold mt-1">{me ? (me.placement === 1 && others.every(o => o.placement > 1) ? 'You won' : me.placement === 1 ? 'Draw' : 'Good game') : 'Game over'}</div>
        <div className="mt-3 space-y-1">
          {results.map(r => (
            <div key={r.player_id} className="flex items-center gap-2 text-sm">
              <span className="w-5 opacity-60">{r.placement}.</span><ArchetypeBadge archetype={r.profile?.archetype} size="sm" />
              <span className="font-medium flex-1">{r.profile?.display_name || r.profile?.username}{r.is_bot ? ' 🤖' : ''}</span>
              {!r.is_bot && <span className={r.rating_after >= r.rating_before ? 'text-backer' : 'text-red-300'}>{r.rating_after - r.rating_before >= 0 ? '+' : ''}{r.rating_after - r.rating_before} → {r.rating_after}</span>}
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
