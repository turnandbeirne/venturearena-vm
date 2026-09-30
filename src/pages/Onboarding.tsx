import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SCENARIOS, scoreCardSort, ARCHETYPES, STAGES, INTENTS, INTEREST_TAGS, PROMPTS, type Archetype } from '../lib/archetypes'
import { rpc } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { PlayerCard } from '../components/PlayerCard'

export default function Onboarding() {
  const { profile, refresh } = useAuth(); const nav = useNavigate()
  const [step, setStep] = useState(0)             // 0..SCENARIOS.length-1 cards, then stage, intent, prompts, reveal
  const [picks, setPicks] = useState<number[]>([])
  const [stage, setStage] = useState('idea')
  const [intent, setIntent] = useState<string[]>(['play'])
  const [interests, setInterests] = useState<string[]>([])
  const [username, setUsername] = useState(profile?.username?.startsWith('guest_') ? '' : profile?.username ?? '')
  const [answers, setAnswers] = useState<string[]>(['', ''])
  const [saving, setSaving] = useState(false); const [err, setErr] = useState('')
  const n = SCENARIOS.length
  const phase = step < n ? 'cards' : step === n ? 'stage' : step === n + 1 ? 'intent' : step === n + 2 ? 'prompts' : 'reveal'
  const result = picks.length === n ? scoreCardSort(picks) : null

  const pick = (i: number) => { setPicks(p => [...p, i]); setStep(s => s + 1) }
  const toggle = (arr: string[], set: (v: string[]) => void, v: string, max = 99) => set(arr.includes(v) ? arr.filter(x => x !== v) : arr.length < max ? [...arr, v] : arr)

  const finish = async () => {
    if (!result) return
    setSaving(true); setErr('')
    try {
      await rpc('complete_onboarding', {
        p_archetype: result.archetype, p_risk: result.risk, p_pace: result.pace, p_collab: result.collab,
        p_stage: stage, p_intent: intent, p_interests: interests,
        p_prompts: PROMPTS.slice(0, 2).map((q, i) => ({ q, a: answers[i] })), p_username: username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '') || null,
      })
      await refresh(); const next = sessionStorage.getItem('after_onboarding'); sessionStorage.removeItem('after_onboarding'); nav(next || '/play')
    } catch (e) { setErr((e as Error).message) } finally { setSaving(false) }
  }

  return (
    <div className="max-w-xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="display font-extrabold text-gold">VentureArena</div>
        <div className="text-xs opacity-60">{phase === 'cards' ? `Card ${step + 1} of ${n}` : phase === 'reveal' ? 'Your card' : 'Almost there'}</div>
      </div>
      <div className="h-1 bg-white/10 rounded mb-8"><div className="h-1 bg-gold rounded transition-all" style={{ width: `${Math.min(100, (step / (n + 3)) * 100)}%` }} /></div>

      {phase === 'cards' && (
        <div className="pop" key={step}>
          <div className="text-xs uppercase tracking-wide opacity-60 mb-2">Scenario</div>
          <h2 className="display text-2xl font-bold mb-6">{SCENARIOS[step].prompt}</h2>
          <div className="space-y-3">
            {SCENARIOS[step].answers.map((a, i) => (
              <button key={i} onClick={() => pick(i)} className="card w-full text-left p-4 hover:border-gold/60 hover:bg-white/5 transition">{a.text}</button>
            ))}
          </div>
          {step > 0 && <button className="mt-4 text-sm opacity-60" onClick={() => { setPicks(p => p.slice(0, -1)); setStep(s => s - 1) }}>← Back</button>}
        </div>
      )}

      {phase === 'stage' && (
        <div className="pop">
          <h2 className="display text-2xl font-bold mb-1">Where are you right now?</h2>
          <p className="opacity-70 mb-5 text-sm">You can change this anytime. It decides who counts as a peer and who counts as a mentor.</p>
          <div className="space-y-2">{STAGES.map(s => <button key={s.id} onClick={() => setStage(s.id)} className={`card w-full text-left p-4 ${stage === s.id ? 'border-gold' : ''}`}><div className="font-semibold">{s.name}</div><div className="text-sm opacity-70">{s.hint}</div></button>)}</div>
          <div className="mt-5"><label className="text-sm opacity-70">Pick a username</label><input className="input mt-1" placeholder="e.g. kc_operator" value={username} onChange={e => setUsername(e.target.value)} /></div>
          <button className="btn btn-gold w-full mt-5" onClick={() => setStep(s => s + 1)}>Next</button>
        </div>
      )}

      {phase === 'intent' && (
        <div className="pop">
          <h2 className="display text-2xl font-bold mb-1">Right now I'm mostly looking for…</h2>
          <p className="opacity-70 mb-5 text-sm">Pick up to three. Nobody gets matched into something they didn't ask for.</p>
          <div className="space-y-2">{INTENTS.map(i => <button key={i.id} onClick={() => toggle(intent, setIntent, i.id, 3)} className={`card w-full text-left p-4 ${intent.includes(i.id) ? 'border-gold' : ''}`}><div className="font-semibold">{i.name}</div><div className="text-sm opacity-70">{i.hint}</div></button>)}</div>
          <div className="mt-6 text-sm opacity-70 mb-2">Interests (pick a few)</div>
          <div className="flex flex-wrap gap-2">{INTEREST_TAGS.map(t => <button key={t} onClick={() => toggle(interests, setInterests, t, 6)} className={`chip ${interests.includes(t) ? 'bg-gold text-navy font-semibold' : ''}`}>{t}</button>)}</div>
          <button className="btn btn-gold w-full mt-6" onClick={() => setStep(s => s + 1)} disabled={!intent.length}>Next</button>
        </div>
      )}

      {phase === 'prompts' && (
        <div className="pop">
          <h2 className="display text-2xl font-bold mb-1">Two conversation starters</h2>
          <p className="opacity-70 mb-5 text-sm">Short answers. These appear on the back of your card and open every chat.</p>
          {PROMPTS.slice(0, 2).map((q, i) => <div key={q} className="mb-4"><label className="text-sm">{q}</label><input className="input mt-1" maxLength={140} value={answers[i]} onChange={e => setAnswers(a => a.map((x, j) => j === i ? e.target.value : x))} /></div>)}
          <button className="btn btn-gold w-full mt-2" onClick={() => setStep(s => s + 1)}>Reveal my card</button>
        </div>
      )}

      {phase === 'reveal' && result && (
        <div className="pop">
          <div className="text-center mb-4"><div className="text-xs uppercase tracking-wide opacity-60">You are a</div><h2 className="display text-4xl font-extrabold" style={{ color: ARCHETYPES[result.archetype as Archetype].color }}>{ARCHETYPES[result.archetype as Archetype].name}</h2></div>
          <PlayerCard flip={false} p={{ id: 'me', username: username || profile?.username || 'you', display_name: username || profile?.username, archetype: result.archetype, stage, intent, interests, rating: 1200, reputation: 100, games_played: 0, kudos: 0, dna: { risk: result.risk, pace: result.pace, collab: result.collab }, prompts: PROMPTS.slice(0, 2).map((q, i) => ({ q, a: answers[i] })) }} />
          <p className="text-sm opacity-70 mt-4 text-center">Your play will refine this. After five games the arena may suggest a different archetype; you always get the final say.</p>
          {err && <p className="text-red-300 text-sm mt-2">{err}</p>}
          <button className="btn btn-gold w-full mt-4" onClick={finish} disabled={saving}>{saving ? 'Saving…' : 'Into the arena'}</button>
        </div>
      )}
    </div>
  )
}
