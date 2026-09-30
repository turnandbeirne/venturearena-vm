import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, rpc } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { ArchetypeBadge, PlayerCard, type CardData } from '../components/PlayerCard'

type Game = { id: string; name: string; kind: string; tagline: string; skills: string[]; max_players: number; lesson_md: string | null }
type OpenTable = { id: string; game_id: string; visibility: string; mode: string; status: string; created_at: string; invite_code: string; host: { username: string; archetype: string | null } | null; seats: { player_id: string; is_bot: boolean; profile: { username: string; archetype: string | null } | null }[] }

export default function Lobby() {
  const { profile, tier, allows } = useAuth(); const nav = useNavigate()
  const [games, setGames] = useState<Game[]>([])
  const [tables, setTables] = useState<OpenTable[]>([])
  const [online, setOnline] = useState<{ username: string; archetype: string | null; id: string }[]>([])
  const [recs, setRecs] = useState<(CardData & { reason: string; match_type: string })[]>([])
  const [err, setErr] = useState('')
  const [creating, setCreating] = useState<string | null>(null)

  const load = async () => {
    const { data: t } = await supabase.from('tables')
      .select('id, game_id, visibility, mode, status, created_at, invite_code, host:profiles!tables_host_id_fkey(username, archetype), seats:table_seats(player_id, is_bot, profile:profiles(username, archetype))')
      .eq('status', 'open').eq('visibility', 'public').order('created_at', { ascending: false }).limit(30)
    setTables((t ?? []) as unknown as OpenTable[])
  }

  useEffect(() => {
    supabase.from('games').select('*').then(({ data }) => setGames((data ?? []) as Game[]))
    load()
    const ch = supabase.channel('lobby-tables').on('postgres_changes', { event: '*', schema: 'public', table: 'tables' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_seats' }, load).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  useEffect(() => {
    if (!profile) return
    const presence = supabase.channel('lobby', { config: { presence: { key: profile.id } } })
    presence.on('presence', { event: 'sync' }, () => {
      const state = presence.presenceState<{ username: string; archetype: string | null; id: string }>()
      setOnline(Object.values(state).map(v => v[0]).filter(Boolean))
    }).subscribe(async s => { if (s === 'SUBSCRIBED') await presence.track({ username: profile.username, archetype: profile.archetype, id: profile.id }) })
    supabase.rpc('my_recommendations').then(async ({ data }) => {
      const rows = (data ?? []) as { suggested_id: string; reason: string; match_type: string }[]
      const top = rows.filter(r => r.match_type === 'playmate').slice(0, 3)
      if (!top.length) return
      const { data: cards } = await supabase.from('player_cards').select('*').in('id', top.map(r => r.suggested_id))
      setRecs(top.map(r => ({ ...(cards ?? []).find((c: { id: string }) => c.id === r.suggested_id) as CardData, reason: r.reason, match_type: r.match_type })).filter(x => x.id))
    })
    return () => { supabase.removeChannel(presence) }
  }, [profile])

  const create = async (game: string) => {
    setErr(''); setCreating(game)
    try { const id = await rpc<string>('create_table', { p_game: game }); nav(`/t/${id}`) } catch (e) { setErr((e as Error).message) } finally { setCreating(null) }
  }
  const join = async (id: string) => { setErr(''); try { await rpc('join_table', { p_table: id }); nav(`/t/${id}`) } catch (e) { setErr((e as Error).message) } }
  const quick = async (game: string) => { setErr(''); try { const id = await rpc<string>('quick_match', { p_game: game }); nav(`/t/${id}`) } catch (e) { setErr((e as Error).message) } }

  const playable = games.filter(g => g.id === 'connect4' || g.kind === 'external')

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div><h1 className="display text-3xl font-extrabold">Play</h1><p className="opacity-70 text-sm">{online.length} in the arena right now</p></div>
        <div className="flex -space-x-2">{online.slice(0, 8).map(o => <span key={o.id} title={o.username}><ArchetypeBadge archetype={o.archetype} size="sm" /></span>)}</div>
      </div>
      {err && <div className="card p-3 border-red-400/40 text-red-200 text-sm">{err}</div>}

      {recs.length > 0 && (
        <section>
          <h2 className="display font-bold text-lg mb-2">People who fit you</h2>
          <div className="grid md:grid-cols-3 gap-3">{recs.map(r => <div key={r.id}><PlayerCard p={r} compact /><div className="text-xs opacity-70 mt-1 px-1">{r.reason}</div></div>)}</div>
        </section>
      )}

      <section>
        <h2 className="display font-bold text-lg mb-2">Games</h2>
        <div className="grid md:grid-cols-3 gap-3">
          {playable.map(g => (
            <div key={g.id} className="card p-4 flex flex-col">
              <div className="flex items-center justify-between"><div className="display font-bold text-lg">{g.name}</div>{g.kind === 'external' && <span className="chip">Opens in its own tab</span>}</div>
              <p className="text-sm opacity-75 mt-1 flex-1">{g.tagline}</p>
              <div className="flex flex-wrap gap-1 mt-3">{g.skills.map(s => <span key={s} className="chip">{s}</span>)}</div>
              <div className="flex gap-2 mt-4">
                <button className="btn btn-gold flex-1" onClick={() => quick(g.id)}>Quick match</button>
                <button className="btn btn-ghost" disabled={!allows('create_table') || creating === g.id} onClick={() => create(g.id)} title={allows('create_table') ? 'Host a table' : 'Create an account to host'}>Host</button>
              </div>
            </div>
          ))}
        </div>
        {tier === 'free' && profile?.is_anonymous && <p className="text-xs opacity-60 mt-2">Guests can join any public table. Add an email on your profile to host tables and keep your history.</p>}
      </section>

      <section>
        <h2 className="display font-bold text-lg mb-2">Open tables</h2>
        {tables.length === 0 ? <div className="card p-6 text-center opacity-70">No open tables yet. Quick match will seat you with a bot if nobody shows in two minutes.</div> : (
          <div className="grid md:grid-cols-2 gap-3">
            {tables.map(t => {
              const g = games.find(x => x.id === t.game_id)
              return (
                <div key={t.id} className="card p-4 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold">{g?.name ?? t.game_id} <span className="chip ml-1">{t.mode === 'turn_based' ? 'turn-based' : 'live'}</span></div>
                    <div className="text-xs opacity-70">Hosted by {t.host?.username} · {t.seats.length}/{g?.max_players ?? 2} seated</div>
                    <div className="flex -space-x-1 mt-2">{t.seats.map(s => <span key={s.player_id} title={s.is_bot ? 'Bot' : s.profile?.username}><ArchetypeBadge archetype={s.profile?.archetype} size="sm" /></span>)}</div>
                  </div>
                  <button className="btn btn-gold" onClick={() => join(t.id)} disabled={t.seats.length >= (g?.max_players ?? 2)}>Join</button>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
