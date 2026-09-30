import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase, rpc } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { PlayerCard, type CardData } from '../components/PlayerCard'
import { INTENTS, STAGES, INTEREST_TAGS } from '../lib/archetypes'

type Hist = { id: number; game_id: string; placement: number; rating_before: number; rating_after: number; recorded_at: string; table_id: string }

export default function Profile() {
  const { username } = useParams(); const { profile, refresh, registerEmail, signOut, allows, tier } = useAuth()
  const isMe = !username || username === profile?.username
  const [card, setCard] = useState<CardData | null>(null)
  const [hist, setHist] = useState<Hist[]>([])
  const [h2h, setH2h] = useState<{ games: number; a_wins: number; b_wins: number } | null>(null)
  const [edit, setEdit] = useState(false)
  const [form, setForm] = useState({ display_name: '', bio: '', stage: '', intent: [] as string[], interests: [] as string[], open_to_mentoring: 0 })
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [msg, setMsg] = useState('')

  useEffect(() => {
    const uname = username ?? profile?.username
    if (!uname) return
    supabase.from('player_cards').select('*').eq('username', uname).single().then(async ({ data }) => {
      setCard(data as CardData)
      if (data) {
        const { data: h } = await supabase.from('results').select('id, game_id, placement, rating_before, rating_after, recorded_at, table_id').eq('player_id', data.id).order('recorded_at', { ascending: false }).limit(20)
        setHist((h ?? []) as Hist[])
        if (!isMe && profile && allows('view_vip_fields')) { const r = await rpc<{ games: number; a_wins: number; b_wins: number }>('head_to_head', { a: profile.id, b: data.id }); setH2h(r) }
      }
    })
  }, [username, profile, isMe, allows])

  useEffect(() => { if (profile) setForm({ display_name: profile.display_name ?? '', bio: profile.bio ?? '', stage: profile.stage ?? 'idea', intent: profile.intent ?? [], interests: profile.interests ?? [], open_to_mentoring: profile.open_to_mentoring ?? 0 }) }, [profile])

  const save = async () => {
    await supabase.from('profiles').update(form).eq('id', profile!.id)
    await refresh(); setEdit(false)
    const { data } = await supabase.from('player_cards').select('*').eq('id', profile!.id).single(); setCard(data as CardData)
  }
  const register = async () => { setMsg(''); try { await registerEmail(email, pw); setMsg('Account saved. Your history and card stay with you.') } catch (e) { setMsg((e as Error).message) } }
  const toggle = (k: 'intent' | 'interests', v: string) => setForm(f => ({ ...f, [k]: f[k].includes(v) ? f[k].filter(x => x !== v) : [...f[k], v] }))

  if (!card) return <div className="opacity-60">Loading…</div>

  return (
    <div className="grid md:grid-cols-[380px_1fr] gap-6">
      <div className="space-y-3">
        <PlayerCard p={card} />
        {isMe && <button className="btn btn-ghost w-full" onClick={() => setEdit(e => !e)}>{edit ? 'Cancel' : 'Edit profile'}</button>}
        {isMe && profile?.is_anonymous && (
          <div className="card p-4 space-y-2">
            <div className="font-semibold">Keep this card</div>
            <p className="text-xs opacity-70">You're playing as a guest. Add an email to keep your history, host tables and add friends.</p>
            <input className="input" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
            <input className="input" type="password" placeholder="Password (8+)" value={pw} onChange={e => setPw(e.target.value)} />
            <button className="btn btn-gold w-full" onClick={register} disabled={!email || pw.length < 8}>Create my account</button>
            {msg && <div className="text-xs opacity-80">{msg}</div>}
          </div>
        )}
        {isMe && !profile?.is_anonymous && <button className="text-xs opacity-50 hover:opacity-100" onClick={signOut}>Sign out</button>}
        {!isMe && h2h && h2h.games > 0 && <div className="card p-3 text-sm"><span className="opacity-60">Head to head:</span> {h2h.games} games, you {h2h.a_wins} – {h2h.b_wins} them</div>}
      </div>

      <div className="space-y-5">
        {edit && isMe && (
          <div className="card p-4 space-y-3">
            <input className="input" placeholder="Display name" value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} />
            <textarea className="input" rows={3} placeholder="Bio" value={form.bio} onChange={e => setForm(f => ({ ...f, bio: e.target.value }))} />
            <div><div className="text-xs opacity-60 mb-1">Stage</div><div className="flex flex-wrap gap-1.5">{STAGES.map(s => <button key={s.id} className={`chip ${form.stage === s.id ? 'bg-gold text-navy font-semibold' : ''}`} onClick={() => setForm(f => ({ ...f, stage: s.id }))}>{s.name}</button>)}</div></div>
            <div><div className="text-xs opacity-60 mb-1">Looking for</div><div className="flex flex-wrap gap-1.5">{INTENTS.map(i => <button key={i.id} className={`chip ${form.intent.includes(i.id) ? 'bg-gold text-navy font-semibold' : ''}`} onClick={() => toggle('intent', i.id)}>{i.name}</button>)}</div></div>
            <div><div className="text-xs opacity-60 mb-1">Interests</div><div className="flex flex-wrap gap-1.5">{INTEREST_TAGS.map(t => <button key={t} className={`chip ${form.interests.includes(t) ? 'bg-gold text-navy font-semibold' : ''}`} onClick={() => toggle('interests', t)}>{t}</button>)}</div></div>
            <div className="flex items-center gap-2 text-sm"><label>Open to mentoring</label><select className="input w-auto" value={form.open_to_mentoring} onChange={e => setForm(f => ({ ...f, open_to_mentoring: Number(e.target.value) }))}>{[0, 1, 2, 3, 5].map(n => <option key={n} value={n}>{n === 0 ? 'No' : `${n} people this quarter`}</option>)}</select></div>
            <button className="btn btn-gold" onClick={save}>Save</button>
          </div>
        )}

        <div className="card p-4">
          <div className="flex items-center justify-between"><div className="display font-bold">Play history</div>{tier === 'free' && !isMe && <span className="text-xs opacity-60">Last 30 days · <Link to="/membership" className="underline">full history for Members</Link></span>}</div>
          {hist.length === 0 ? <div className="text-sm opacity-60 mt-2">No finished games yet.</div> : (
            <div className="mt-2 space-y-1 text-sm">{hist.map(h => (
              <div key={h.id} className="flex items-center gap-3"><span className="opacity-60 w-20">{new Date(h.recorded_at).toLocaleDateString()}</span><span className="flex-1 capitalize">{h.game_id}</span><span>{h.placement === 1 ? 'Won' : `#${h.placement}`}</span><span className={h.rating_after >= h.rating_before ? 'text-backer' : 'text-red-300'}>{h.rating_after - h.rating_before >= 0 ? '+' : ''}{h.rating_after - h.rating_before}</span><Link to={`/debrief/${h.table_id}`} className="text-xs opacity-60 underline">debrief</Link></div>
            ))}</div>
          )}
        </div>
        {card.bio && <div className="card p-4 text-sm"><div className="display font-bold mb-1">About</div>{card.bio}</div>}
      </div>
    </div>
  )
}
