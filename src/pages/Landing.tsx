import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase, configured } from '../lib/supabase'
import { ARCHETYPES } from '../lib/archetypes'
import { PlayerCard, type CardData } from '../components/PlayerCard'

export default function Landing() {
  const { session, enterAsGuest, loading, signIn } = useAuth()
  const nav = useNavigate()
  const [cards, setCards] = useState<CardData[]>([])
  const [busy, setBusy] = useState(false)
  const [login, setLogin] = useState(false)
  const params = new URLSearchParams(location.search)
  const fromGame = params.get('from')
  const autoGuest = params.get('go') === 'guest'   // venturemaker.org "Play now" button: straight in, no interview
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [err, setErr] = useState('')

  useEffect(() => { if (!loading && session) nav('/play', { replace: true }) }, [session, loading, nav])
  const autoRan = useRef(false)
  useEffect(() => {
    if (autoRan.current || loading || session || !autoGuest || !configured) return
    autoRan.current = true
    setBusy(true); enterAsGuest().then(() => nav('/play')).catch(e => setErr((e as Error).message)).finally(() => setBusy(false))
  }, [loading, session, autoGuest, enterAsGuest, nav])
  useEffect(() => {
    if (!configured) return
    supabase.from('player_cards').select('*').eq('onboarded', true).order('created_at', { ascending: false }).limit(6).then(({ data }) => setCards((data ?? []) as CardData[]))
  }, [])

  const enter = async () => {
    setBusy(true)
    try { await enterAsGuest(); nav('/play') } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const doLogin = async () => { setErr(''); try { await signIn(email, pw); nav('/play') } catch (e) { setErr((e as Error).message) } }

  return (
    <div className="min-h-full">
      <header className="max-w-5xl mx-auto px-6 py-6 flex items-center justify-between">
        <div className="display font-extrabold text-2xl text-gold">VentureArena</div>
        <button className="btn btn-ghost" onClick={() => setLogin(v => !v)}>Sign in</button>
      </header>
      {login && (
        <div className="max-w-sm mx-auto card p-4 mb-4 space-y-2">
          <input className="input" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
          <input className="input" type="password" placeholder="Password" value={pw} onChange={e => setPw(e.target.value)} />
          <button className="btn btn-gold w-full" onClick={doLogin}>Sign in</button>
        </div>
      )}
      <section className="max-w-5xl mx-auto px-6 pt-10 pb-16 grid md:grid-cols-2 gap-10 items-center">
        <div>
          {fromGame === 'ventureflow' && <div className="chip mb-3" style={{ background: 'var(--color-gold)', color: '#1a1200' }}>Coming from VentureFlow? Enter, pick a name, and open a VentureFlow table to play others live.</div>}
          {fromGame === 'venturemaker' && <div className="chip mb-3" style={{ background: 'var(--color-gold)', color: '#1a1200' }}>Welcome from VentureMaker. Play as a guest with no signup, or add an email later to keep your history and meet other founders.</div>}
          <h1 className="display text-4xl md:text-5xl font-extrabold leading-tight">Practice business.<br />Meet your people.</h1>
          <p className="mt-4 text-lg opacity-85 max-w-md">Strategy games where every round is a business decision, played against aspiring founders, mentors and investors. Learn something about each other, then keep talking.</p>
          <div className="mt-6 flex gap-3 flex-wrap">
            <button className="btn btn-gold text-lg px-6" onClick={enter} disabled={busy || !configured}>{busy ? 'Opening the doors…' : 'Enter the Arena'}</button>
            <span className="self-center text-sm opacity-60">No signup. Pick a name and play.</span>
          </div>
          {!configured && <p className="mt-3 text-sm text-red-300">Backend not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.</p>}
          {err && <p className="mt-3 text-sm text-red-300">{err}</p>}
          <div className="mt-8 flex gap-2 flex-wrap">
            {Object.entries(ARCHETYPES).map(([k, a]) => <span key={k} className="chip" style={{ borderLeft: `3px solid ${a.color}` }}>{a.glyph} {a.name}</span>)}
          </div>
          <p className="mt-2 text-xs opacity-60">Five archetypes. Find yours in three minutes, then find your complement.</p>
        </div>
        <div className="space-y-3">
          {cards.length ? (
            <>
              <div className="text-xs uppercase tracking-wide opacity-60">Recently in the arena</div>
              <PlayerCard p={cards[0]} flip={false} />
              <div className="grid grid-cols-1 gap-2">{cards.slice(1, 4).map(c => <PlayerCard key={c.id} p={c} compact />)}</div>
            </>
          ) : (
            <PlayerCard flip={false} p={{ id: 'demo', username: 'you', display_name: 'Your card here', archetype: 'trader', stage: 'revenue', rating: 1200, reputation: 100, games_played: 0, kudos: 0, chips: { sharp: 3, generous: 2 }, intent: ['peers', 'cofounder'] }} />
          )}
        </div>
      </section>
      <section className="max-w-5xl mx-auto px-6 pb-20 grid md:grid-cols-3 gap-4">
        {[
          ['Play', 'Connect 4 today; VentureFlow and VentureBoom tables launch from the arena. Every game ends with one business question.'],
          ['Debrief', 'Five minutes after every game to answer the question together, tag how each other played, and connect.'],
          ['Match', 'Playmates, mentors, peers, cofounders and investors, matched on how you actually play, not a form.'],
        ].map(([h, b]) => <div key={h} className="card p-5"><div className="display font-bold text-lg mb-1">{h}</div><p className="text-sm opacity-80">{b}</p></div>)}
      </section>
    </div>
  )
}
