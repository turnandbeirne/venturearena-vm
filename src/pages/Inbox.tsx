import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { ArchetypeBadge } from '../components/PlayerCard'

type P = { id: string; username: string; display_name: string | null; archetype: string | null }
type Conn = { requester_id: string; addressee_id: string; status: string; source: string; requester: P; addressee: P }
type Intro = { id: string; kind: string; from_id: string; to_id: string; reason: string; status: string; from: P; to: P }
type Msg = { id: number; from_id: string; to_id: string; body: string; created_at: string }
const ARENA_ID = '00000000-0000-0000-0000-00000000b0b0'   // the arena's own voice (feedback replies, notices)

export default function Inbox() {
  const { profile, allows } = useAuth()
  const [conns, setConns] = useState<Conn[]>([])
  const [intros, setIntros] = useState<Intro[]>([])
  const [active, setActive] = useState<P | null>(null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [err, setErr] = useState('')

  const load = async () => {
    if (!profile) return
    const { data: c } = await supabase.from('connections').select('*, requester:profiles!connections_requester_id_fkey(id, username, display_name, archetype), addressee:profiles!connections_addressee_id_fkey(id, username, display_name, archetype)').or(`requester_id.eq.${profile.id},addressee_id.eq.${profile.id}`)
    setConns((c ?? []) as unknown as Conn[])
    const { data: i } = await supabase.from('introductions').select('*, from:profiles!introductions_from_id_fkey(id, username, display_name, archetype), to:profiles!introductions_to_id_fkey(id, username, display_name, archetype)').or(`from_id.eq.${profile.id},to_id.eq.${profile.id}`).order('created_at', { ascending: false })
    setIntros((i ?? []) as unknown as Intro[])
  }
  useEffect(() => { load() }, [profile]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!active || !profile) return
    supabase.from('messages').select('*').is('table_id', null).or(`and(from_id.eq.${profile.id},to_id.eq.${active.id}),and(from_id.eq.${active.id},to_id.eq.${profile.id})`).order('created_at').then(({ data }) => setMsgs((data ?? []) as Msg[]))
    const ch = supabase.channel(`dm-${profile.id}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `to_id=eq.${profile.id}` }, p => { const m = p.new as Msg; if (m.from_id === active.id) setMsgs(ms => [...ms, m]) }).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [active, profile])

  const answer = async (c: Conn, status: string) => { await supabase.from('connections').update({ status }).eq('requester_id', c.requester_id).eq('addressee_id', c.addressee_id); load() }
  const answerIntro = async (i: Intro, status: string) => { await supabase.from('introductions').update({ status, answered_at: new Date().toISOString() }).eq('id', i.id); load() }
  const send = async () => {
    if (!text.trim() || !active) return
    setErr('')
    const { data, error } = await supabase.from('messages').insert({ from_id: profile!.id, to_id: active.id, body: text.trim() }).select().single()
    if (error) { setErr(error.message.includes('policy') ? 'You can message accepted connections. Messaging anyone is a Member feature.' : error.message); return }
    setMsgs(ms => [...ms, data as Msg]); setText('')
  }

  const other = (c: Conn) => c.requester_id === profile?.id ? c.addressee : c.requester
  const pending = conns.filter(c => c.status === 'pending' && c.addressee_id === profile?.id)
  const accepted = conns.filter(c => c.status === 'accepted')
  const pendingIntros = intros.filter(i => i.status === 'pending' && i.to_id === profile?.id)
  const [notes, setNotes] = useState<Msg[]>([])
  useEffect(() => {
    if (!profile) return
    const load = () => supabase.from('messages').select('*').is('table_id', null).eq('to_id', profile.id).eq('from_id', ARENA_ID).order('created_at', { ascending: false }).limit(20).then(({ data }) => setNotes((data ?? []) as Msg[]))
    load()
    const ch = supabase.channel(`notes-${profile.id}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `to_id=eq.${profile.id}` }, load).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [profile])

  return (
    <div className="grid md:grid-cols-[320px_1fr] gap-6">
      <div className="space-y-5">
        <h1 className="display text-3xl font-extrabold">Inbox</h1>
        {notes.length > 0 && <section><div className="text-xs uppercase tracking-wide opacity-60 mb-2">From the arena</div>{notes.map(n => (
          <div key={n.id} className="card p-3 mb-2 text-sm"><div className="opacity-85">{n.body}</div><div className="text-[11px] opacity-50 mt-1">{new Date(n.created_at).toLocaleString()}</div></div>
        ))}</section>}
        {pendingIntros.length > 0 && <section><div className="text-xs uppercase tracking-wide opacity-60 mb-2">Introductions</div>{pendingIntros.map(i => (
          <div key={i.id} className="card p-3 mb-2 text-sm"><div className="flex items-center gap-2"><ArchetypeBadge archetype={i.from.archetype} size="sm" /><Link to={`/p/${i.from.username}`} className="font-semibold">{i.from.display_name || i.from.username}</Link><span className="chip capitalize">{i.kind}</span></div><div className="opacity-75 mt-1">{i.reason}</div><div className="flex gap-2 mt-2"><button className="btn btn-gold text-xs" onClick={() => answerIntro(i, 'accepted')}>Accept</button><button className="btn btn-ghost text-xs" onClick={() => answerIntro(i, 'declined')}>Not now</button></div></div>
        ))}</section>}
        {pending.length > 0 && <section><div className="text-xs uppercase tracking-wide opacity-60 mb-2">Connection requests</div>{pending.map(c => (
          <div key={c.requester_id} className="card p-3 mb-2 flex items-center gap-2 text-sm"><ArchetypeBadge archetype={c.requester.archetype} size="sm" /><span className="flex-1 font-semibold">{c.requester.display_name || c.requester.username}</span><button className="btn btn-gold text-xs" onClick={() => answer(c, 'accepted')}>Accept</button><button className="btn btn-ghost text-xs" onClick={() => answer(c, 'blocked')}>Decline</button></div>
        ))}</section>}
        <section><div className="text-xs uppercase tracking-wide opacity-60 mb-2">Connections</div>
          {accepted.length === 0 && <div className="text-sm opacity-60">Connect with someone after a game and they'll appear here.</div>}
          {accepted.map(c => { const o = other(c); return <button key={o.id} onClick={() => setActive(o)} className={`card p-3 mb-2 w-full flex items-center gap-2 text-left text-sm ${active?.id === o.id ? 'border-gold' : ''}`}><ArchetypeBadge archetype={o.archetype} size="sm" /><span className="font-semibold">{o.display_name || o.username}</span></button> })}
        </section>
        {intros.filter(i => i.from_id === profile?.id).length > 0 && <section><div className="text-xs uppercase tracking-wide opacity-60 mb-2">Sent</div>{intros.filter(i => i.from_id === profile?.id).map(i => <div key={i.id} className="text-sm opacity-75 mb-1">{i.kind} intro to {i.to.username}: <span className="capitalize">{i.status === 'declined' ? 'not now' : i.status}</span></div>)}</section>}
      </div>
      <div className="card p-4 flex flex-col min-h-[420px]">
        {!active ? <div className="m-auto text-sm opacity-60 text-center">Pick a connection to chat.<br />{allows('dm_anyone') ? 'As a Member you can also message anyone from their profile.' : ''}</div> : (
          <>
            <div className="flex items-center gap-2 mb-3"><ArchetypeBadge archetype={active.archetype} size="sm" /><Link to={`/p/${active.username}`} className="font-semibold">{active.display_name || active.username}</Link></div>
            <div className="flex-1 overflow-y-auto space-y-2 text-sm">
              {msgs.length === 0 && <div className="opacity-50 text-xs">Starter: ask what their last game taught them about cash.</div>}
              {msgs.map(m => <div key={m.id} className={`max-w-[80%] px-3 py-2 rounded-xl ${m.from_id === profile?.id ? 'ml-auto bg-gold text-navy' : 'bg-white/10'}`}>{m.body}</div>)}
            </div>
            {err && <div className="text-red-300 text-xs mt-2">{err}</div>}
            <div className="flex gap-2 mt-3"><input className="input" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} placeholder="Message" /><button className="btn btn-gold" onClick={send}>Send</button></div>
          </>
        )}
      </div>
    </div>
  )
}
