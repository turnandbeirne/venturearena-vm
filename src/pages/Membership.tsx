import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

const TIERS = [
  { id: 'free', name: 'Play', price: 'Free', human: 'Play, keep a card, add up to 25 friends.', perks: ['Join any public table', 'Host one open table', '30 days of history', 'Lesson card after every game', '3 suggested players a week'] },
  { id: 'member', name: 'Connect', price: '$9.99/mo', human: 'Meet the people you play with.', perks: ['Private and unlimited tables', 'Full history and play-style profiles', 'Message anyone', 'Mentor and cofounder matches daily', 'Full lesson library', 'No ads'] },
  { id: 'vip', name: 'Be introduced', price: '$49.99/mo', human: 'Warm introductions to mentors and investors.', perks: ['Everything in Connect', 'Investor matches (opt-in on both sides)', 'Head-to-head records', 'Scheduled tables and VIP lounge', 'Quarterly skills report', 'Verified badge'] },
  { id: 'ceo', name: 'Be sought out', price: '$249/mo', human: 'For exited founders and investors who want curated peers.', perks: ['Everything in VIP', 'Hosted events with a facilitator', 'Vouch for players', 'Featured placement', 'Curated matches by the VentureArena team', 'Monthly coaching session'] },
]

export default function Membership() {
  const { tier, profile } = useAuth()
  const [busy, setBusy] = useState<string | null>(null); const [msg, setMsg] = useState('')

  const upgrade = async (t: string) => {
    setBusy(t); setMsg('')
    const { data, error } = await supabase.functions.invoke('create-checkout', { body: { tier: t } })
    setBusy(null)
    if (error || !data?.url) { setMsg('Billing is not live yet. Memberships open at launch; your card and history carry over.'); return }
    window.location.href = data.url
  }

  return (
    <div className="space-y-6">
      <div><h1 className="display text-3xl font-extrabold">Membership</h1><p className="opacity-70 text-sm">Playing and making friends is always free. Pay for depth, introductions and status.</p></div>
      {profile?.is_anonymous && <div className="card p-3 text-sm">You're a guest. Add an email on your profile first so a membership has somewhere to live.</div>}
      {msg && <div className="card p-3 text-sm border-gold/40">{msg}</div>}
      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
        {TIERS.map(t => (
          <div key={t.id} className={`card p-5 flex flex-col ${tier === t.id ? 'border-gold' : ''}`}>
            <div className="display font-extrabold text-xl">{t.name}</div>
            <div className="text-gold font-semibold">{t.price}</div>
            <p className="text-sm opacity-80 mt-2">{t.human}</p>
            <ul className="text-sm mt-4 space-y-1 flex-1">{t.perks.map(p => <li key={p} className="flex gap-2"><span className="text-gold">✓</span>{p}</li>)}</ul>
            <button className={`btn mt-5 ${tier === t.id ? 'btn-ghost' : 'btn-gold'}`} disabled={tier === t.id || t.id === 'free' || !!busy} onClick={() => upgrade(t.id)}>{tier === t.id ? 'Current plan' : t.id === 'free' ? 'Included' : busy === t.id ? '…' : 'Upgrade'}</button>
          </div>
        ))}
      </div>
    </div>
  )
}
