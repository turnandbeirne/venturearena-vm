import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase, rpc } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { ArchetypeBadge, RepShield } from '../components/PlayerCard'
import { Connect4Board, botMove, type C4State } from '../components/Connect4'
import { TableSettings } from '../components/TableSettings'
import { describeBot, lastSettings, normalize, rememberSettings, summarizeSettings, type VfSettings } from '../lib/vfSettings'

type Seat = { player_id: string; seat: number; is_bot: boolean; role: 'player' | 'observer'; profile: { username: string; display_name: string | null; archetype: string | null; stage: string | null; bio: string | null } | null; rep?: number }
type TableRow = { id: string; game_id: string; host_id: string; visibility: string; mode: string; status: string; invite_code: string; state: C4State | null; external_match_id: string | null; settings: Partial<VfSettings> | null }
type Game = { id: string; name: string; kind: string; max_players: number; reflection_questions: string[]; launch_url: string | null; skills: string[] }
type Msg = { id: number; from_id: string; body: string; created_at: string; from?: { username: string } }

const SEAT_COLORS = ['#e8b64a', '#2fb7a6', '#a37cf0', '#5fc27a', '#f06c6c', '#8a97b5']
const TABLE_QUESTIONS = ['What is the riskiest bet you are making this quarter?', 'What would you build if you could not fail?', 'Which of your customers would you clone?', 'What did your last game teach you about cash?']

export default function TableRoom() {
  const { id } = useParams(); const nav = useNavigate()
  const { profile, tier, allows } = useAuth()
  const [table, setTable] = useState<TableRow | null>(null)
  const [game, setGame] = useState<Game | null>(null)
  const [seats, setSeats] = useState<Seat[]>([])
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)
  const [scores, setScores] = useState<{ player_id: string; score: number; reported_at: string }[]>([])
  const question = useRef(TABLE_QUESTIONS[Math.floor(Math.random() * TABLE_QUESTIONS.length)])

  const load = useCallback(async () => {
    if (!id) return
    const { data: t } = await supabase.from('tables').select('*').eq('id', id).single()
    if (!t) { setErr('Table not found or private.'); return }
    setTable(t as TableRow)
    const { data: s } = await supabase.from('table_seats').select('player_id, seat, is_bot, role, profile:profiles(username, display_name, archetype, stage, bio)').eq('table_id', id).order('seat')
    const seatRows = (s ?? []) as unknown as Seat[]
    const { data: reps } = await supabase.from('reputation').select('player_id, score').in('player_id', seatRows.map(x => x.player_id))
    setSeats(seatRows.map(x => ({ ...x, rep: (reps ?? []).find(r => r.player_id === x.player_id)?.score ?? 100 })))
    if (!game) { const { data: g } = await supabase.from('games').select('*').eq('id', (t as TableRow).game_id).single(); setGame(g as Game) }
    const { data: sc } = await supabase.from('external_scores').select('player_id, score, reported_at').eq('table_id', id)
    setScores((sc ?? []) as { player_id: string; score: number; reported_at: string }[])
  }, [id, game])

  useEffect(() => {
    load()
    supabase.from('messages').select('id, from_id, body, created_at, from:profiles!messages_from_id_fkey(username)').eq('table_id', id).order('created_at').limit(100)
      .then(({ data }) => setMsgs((data ?? []) as unknown as Msg[]))
    const ch = supabase.channel(`table-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tables', filter: `id=eq.${id}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_seats', filter: `table_id=eq.${id}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'external_scores', filter: `table_id=eq.${id}` }, load)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `table_id=eq.${id}` }, async p => {
        const m = p.new as Msg
        const { data } = await supabase.from('profiles').select('username').eq('id', m.from_id).single()
        setMsgs(ms => [...ms, { ...m, from: data ?? undefined }])
      }).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [id, load])

  // finished -> debrief
  useEffect(() => { if (table?.status === 'finished') nav(`/debrief/${table.id}`, { replace: true }) }, [table, nav])

  const me = seats.find(s => s.player_id === profile?.id) ?? null
  const players = seats.filter(s => s.role !== 'observer'); const observers = seats.filter(s => s.role === 'observer')
  const mySeat = me && me.role === 'player' ? me.seat : null
  const isHost = table?.host_id === profile?.id
  const isSeated = me !== null
  const isObserver = me?.role === 'observer'
  const state = table?.state ?? null

  // Host drives the bot: one move per board position. A pending timer is
  // never cancelled by a re-render (seats/table reload constantly via
  // realtime), and a failed call resets the key so the next tick retries.
  const botTimer = useRef<{ key: string; id: number } | null>(null)
  const botDone = useRef<Set<string>>(new Set())
  const [botTick, setBotTick] = useState(0)
  useEffect(() => { const t = setInterval(() => setBotTick(n => n + 1), 2500); return () => clearInterval(t) }, [])
  useEffect(() => {
    if (!table || table.status !== 'playing' || !state || state.winner !== null || !isHost || table.game_id !== 'connect4') return
    const botSeat = seats.find(s => s.is_bot && s.role === 'player' && s.seat === state.turn)
    if (!botSeat) return
    const key = `${table.id}:${state.moves}`
    if (botTimer.current?.key === key || botDone.current.has(key)) return
    const id = window.setTimeout(async () => {
      try { await rpc('make_move', { p_table: table.id, p_col: botMove(state.board, state.turn + 1) }); botDone.current.add(key) }
      catch { /* retried on the next tick */ }
      finally { if (botTimer.current?.id === id) botTimer.current = null }
    }, 700)
    botTimer.current = { key, id }
  }, [table, state, seats, isHost, botTick])

  const act = async (fn: () => Promise<unknown>) => { setErr(''); try { await fn() } catch (e) { setErr((e as Error).message) } }
  const sit = () => act(() => rpc('join_table', { p_table: id, p_role: 'player' }))
  const watch = () => act(() => rpc('join_table', { p_table: id, p_role: 'observer' }))
  const switchRole = (role: 'player' | 'observer') => act(() => rpc('set_role', { p_table: id, p_role: role }))
  const addBot = () => act(() => rpc('add_bot', { p_table: id }))
  const start = () => act(() => rpc(game?.kind === 'external' ? 'start_external' : 'start_table', { p_table: id }))
  const finalize = () => act(() => rpc('finalize_external', { p_table: id }))
  const leave = () => act(async () => { await rpc('abandon_table', { p_table: id }); nav('/play') })
  const move = (col: number) => act(() => rpc('make_move', { p_table: id, p_col: col }))
  const send = () => { if (!text.trim()) return; act(async () => { await supabase.from('messages').insert({ table_id: id, from_id: profile!.id, body: text.trim() }).throwOnError(); setText('') }) }
  const launch = () => act(async () => {
    const { data, error } = await supabase.functions.invoke('launch-game', { body: { table_id: id } })
    if (error) throw new Error(error.message)
    window.open(data.launch_url, '_blank')
  })
  const vfSettings = table?.game_id === 'ventureflow' ? normalize(table.settings) : null
  // Settings changes are announced in chat so partners can react, but a host
  // clicking through options gets one trailing note (per 5s), not a flood.
  const noteTimer = useRef<number | null>(null); const lastNote = useRef('')
  const announce = (s: VfSettings) => {
    if (noteTimer.current) window.clearTimeout(noteTimer.current)
    noteTimer.current = window.setTimeout(async () => {
      const note = `⚙️ ${summarizeSettings(s)}`
      if (note === lastNote.current) return
      lastNote.current = note
      await supabase.from('messages').insert({ table_id: id, from_id: profile!.id, body: note })
    }, 5000)
  }
  const saveSettings = async (s: VfSettings) => {
    await rpc('set_table_settings', { p_table: id, p_settings: s }); rememberSettings(s)
    if (seats.length > 1) announce(s)
  }
  const suggest = (text: string) => act(async () => { await supabase.from('messages').insert({ table_id: id, from_id: profile!.id, body: `💡 ${text}` }).throwOnError() })
  const copy = (mode?: 'watch') => { navigator.clipboard.writeText(`${location.origin}/join/${table?.invite_code}${mode ? '/watch' : ''}`); setCopied(true); setTimeout(() => setCopied(false), 1500) }

  if (err && !table) return <div className="card p-6">{err} <button className="btn btn-ghost mt-3" onClick={() => nav('/play')}>Back to lobby</button></div>
  if (!table || !game) return <div className="opacity-60">Loading table…</div>

  const seatColors = players.map(s => SEAT_COLORS[s.seat])
  const seatsFull = players.length >= game.max_players; const tableFull = seats.length >= 7
  const last = isHost && table.status === 'open' && vfSettings ? lastSettings() : null

  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div><h1 className="display text-2xl font-extrabold">{game.name}</h1><div className="text-xs opacity-70 capitalize">{table.status} · {table.mode === 'turn_based' ? 'turn-based' : 'live'} · {table.visibility}</div></div>
          <div className="flex gap-2">
            <button className="btn btn-ghost text-sm" onClick={() => copy()}>{copied ? 'Copied!' : 'Copy invite link'}</button>
            <button className="btn btn-ghost text-sm" onClick={() => copy('watch')} title="A link that seats people as observers">Watch link</button>
            <button className="btn btn-ghost text-sm" onClick={leave}>{isObserver ? 'Stop watching' : table.status === 'playing' ? 'Forfeit' : 'Leave'}</button>
          </div>
        </div>
        {err && <div className="card p-3 border-red-400/40 text-red-200 text-sm">{err}</div>}

        {/* seats */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {players.map(s => (
            <div key={s.player_id} className={`card p-3 flex items-center gap-2 ${state && state.turn === s.seat && table.status === 'playing' ? 'border-gold' : ''}`}>
              <span className="w-3 h-3 rounded-full shrink-0" style={{ background: SEAT_COLORS[s.seat] }} />
              <ArchetypeBadge archetype={s.profile?.archetype} size="sm" />
              <div className="min-w-0 flex-1"><div className="font-semibold text-sm truncate">{s.profile?.display_name || s.profile?.username}{s.is_bot ? ' 🤖' : ''}</div><div className="text-[11px] opacity-60 capitalize">{s.is_bot ? 'robot' : s.profile?.stage?.replace('_', ' ') ?? 'new here'}</div></div>
              {!s.is_bot && <RepShield score={s.rep} />}
            </div>
          ))}
          {Array.from({ length: Math.max(0, game.max_players - players.length) }).map((_, i) => {
            const bot = vfSettings ? (vfSettings.bots[i] ?? (vfSettings.fillWithRobots ? { personalityId: 'random', skillLevelId: 'random' } : null)) : null
            const d = bot ? describeBot(bot) : null
            return (
              <div key={`open${i}`} className="card p-3 border-dashed flex items-center gap-2">
                {d ? <span className="text-xl leading-none opacity-70">{d.avatar}</span> : <span className="w-3 h-3 rounded-full shrink-0 opacity-30 bg-white" />}
                <div className="min-w-0 flex-1 text-sm"><div className="font-semibold opacity-80">Open seat</div>
                  <div className="text-[11px] opacity-60 truncate">{table.status === 'open' ? (d ? `${d.name} (${d.skill}) plays here if nobody sits` : 'stays empty unless someone sits') : ''}</div></div>
              </div>)
          })}
        </div>
        <div className="card p-3 flex items-center gap-2 flex-wrap text-sm">
          <span className="opacity-60">Watching ({observers.length}) · {7 - seats.length} spots left at this table</span>
          {observers.map(o => <span key={o.player_id} className="chip gap-1"><ArchetypeBadge archetype={o.profile?.archetype} size="sm" />{o.profile?.display_name || o.profile?.username}</span>)}
          {observers.length === 0 && <span className="opacity-40">Nobody yet. Observers chat, watch the board and join the debrief.</span>}
        </div>

        {vfSettings && (
          <>
            <TableSettings settings={vfSettings} isHost={isHost} locked={table.status !== 'open'} humans={players.filter(p => !p.is_bot).length} maxPlayers={game.max_players} canCustomize={allows('vf_custom_settings')} onChange={saveSettings} onSuggest={isSeated ? suggest : undefined} />
            {last && JSON.stringify(last) !== JSON.stringify(vfSettings) && <button className="btn btn-ghost text-sm -mt-2" onClick={() => act(() => saveSettings(last))}>Use the settings from my last table</button>}
          </>
        )}

        {/* actions */}
        {table.status === 'open' && (
          <div className="card p-4 flex flex-wrap gap-2 items-center">
            {!isSeated && <button className="btn btn-gold" onClick={sit} disabled={seatsFull || tableFull}>{seatsFull ? 'Seats full' : 'Take a seat'}</button>}
            {!isSeated && <button className="btn btn-ghost" onClick={watch} disabled={tableFull}>Watch</button>}
            {isObserver && <button className="btn btn-gold" onClick={() => switchRole('player')} disabled={seatsFull}>Take a seat instead</button>}
            {isSeated && !isObserver && !isHost && <button className="btn btn-ghost" onClick={() => switchRole('observer')}>Watch instead</button>}
            {isSeated && game.kind === 'builtin' && !seatsFull && <button className="btn btn-ghost" onClick={addBot}>Add a bot</button>}
            {isHost && <button className="btn btn-gold" onClick={start} disabled={game.kind === 'external' ? players.filter(p => !p.is_bot).length < 1 : players.length < 2}>{game.kind === 'external' ? 'Start the race' : 'Start game'}</button>}
            {!isHost && isSeated && <span className="text-sm opacity-70">{isObserver ? "You're watching. " : ''}Waiting for the host to start…</span>}
            <div className="w-full text-sm opacity-80 mt-2"><span className="opacity-60">Question of the table:</span> {question.current}</div>
          </div>
        )}

        {table.status === 'playing' && game.id === 'connect4' && state && (
          <div className="card p-4">
            <div className="text-sm mb-3">{state.winner !== null ? 'Game over' : state.turn === mySeat ? <span className="text-gold font-semibold">Your move</span> : `${isObserver ? 'Watching · ' : ''}Waiting for ${players.find(s => s.seat === state.turn)?.profile?.username ?? '…'}`}</div>
            <Connect4Board state={state} mySeat={mySeat} seatColors={seatColors} onMove={move} disabled={!isSeated || isObserver} />
            <div className="text-xs opacity-60 mt-3">What to watch for: control the center column; build threats in two directions at once.</div>
          </div>
        )}

        {table.status === 'playing' && game.kind === 'external' && (
          <div className="card p-5">
            <div className="display font-bold text-lg">{game.name} · live table</div>
            <p className="text-sm opacity-75 mt-1">{game.id === 'ventureflow'
              ? `One live game for everyone here: ${players.filter(p => !p.is_bot).length} of you plus ${vfSettings?.aiCount ?? 0} robot${(vfSettings?.aiCount ?? 0) === 1 ? '' : 's'}, turns taken from your own screens. The host's game opens first and deals everyone in; when the 24 months are up, the standings come back here and everyone lands in the Debrief.`
              : 'Play in the game\'s own tab. When it ends, the result comes back here and everyone lands in the Debrief.'}</p>
            <button className="btn btn-gold mt-3" onClick={launch}>{isObserver ? `Watch ${game.name}` : isHost ? `Open ${game.name} and deal everyone in` : `Open ${game.name}`}</button>
            {!isHost && !isObserver && <p className="text-xs opacity-60 mt-2">If the host hasn't opened the game yet, your game shows "Setting the table" until they do.</p>}
            {scores.length > 0 && <div className="mt-4 space-y-1 text-sm">
              {players.filter(p => !p.is_bot).map(p => { const sc = scores.find(x => x.player_id === p.player_id); return (
                <div key={p.player_id} className="flex items-center gap-2"><ArchetypeBadge archetype={p.profile?.archetype} size="sm" /><span className="flex-1">{p.profile?.display_name || p.profile?.username}</span>{sc ? <span className="text-backer">reported · ${Math.round(Number(sc.score)).toLocaleString()}</span> : <span className="opacity-50">still playing…</span>}</div>
              ) })}
            </div>}
            {isHost && scores.length > 0 && scores.length < players.filter(p => !p.is_bot).length && (
              <button className="btn btn-ghost text-sm mt-4" onClick={finalize} title="Rank the scores that are in; players who have not reported place last">Finalize now</button>
            )}
          </div>
        )}
      </div>

      {/* chat */}
      <div className="card p-3 flex flex-col h-[420px] lg:h-[calc(100vh-8rem)] lg:sticky lg:top-6">
        <div className="text-xs uppercase tracking-wide opacity-60 mb-2">Table talk</div>
        <div className="flex-1 overflow-y-auto space-y-2 text-sm pr-1">
          {msgs.length === 0 && <div className="opacity-50 text-xs">Say hello. Or answer the question of the table.</div>}
          {msgs.map(m => <div key={m.id}><span className="font-semibold opacity-80">{m.from?.username ?? '…'}</span> <span className="opacity-90">{m.body}</span></div>)}
        </div>
        <div className="flex gap-2 mt-2">
          <input className="input" placeholder={isSeated ? 'Message the table' : 'Take a seat to chat'} value={text} disabled={!isSeated} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} />
          <button className="btn btn-gold" onClick={send} disabled={!isSeated}>Send</button>
        </div>
        {tier === 'free' && !allows('dm_anyone') && <div className="text-[11px] opacity-50 mt-2">Table chat is open to everyone. Direct messages to anyone are a Member feature.</div>}
      </div>
    </div>
  )
}
