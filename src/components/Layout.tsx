import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { FeedbackButton } from './FeedbackButton'
import { useAuth } from '../lib/auth'
import { useEffect } from 'react'
import { ArchetypeBadge } from './PlayerCard'
import { rpc } from '../lib/supabase'

const tabs = [
  { to: '/play', label: 'Play', icon: '▶' },
  { to: '/people', label: 'People', icon: '⚇' },
  { to: '/me', label: 'Me', icon: '◉' },
  { to: '/inbox', label: 'Inbox', icon: '✉' },
]

export default function Layout() {
  const { session, profile, loading, tier } = useAuth()
  const nav = useNavigate(); const loc = useLocation()

  useEffect(() => {
    if (loading) return
    if (!session) { nav('/', { replace: true }); return }
    if (profile && !profile.onboarded && loc.pathname !== '/onboarding') nav('/onboarding', { replace: true })
  }, [session, profile, loading, nav, loc.pathname])

  if (loading) return <div className="p-8 opacity-60">Entering the arena…</div>

  const quick = async () => {
    try { const id = await rpc<string>('quick_match', { p_game: 'connect4' }); nav(`/t/${id}`) } catch (e) { alert((e as Error).message) }
  }

  return (
    <div className="min-h-full flex flex-col md:flex-row">
      <aside className="hidden md:flex md:flex-col w-56 border-r border-white/10 p-4 gap-1 sticky top-0 h-screen">
        <NavLink to="/play" className="display font-extrabold text-xl mb-4 text-gold">VentureArena</NavLink>
        {tabs.map(t => <NavLink key={t.to} to={t.to} className={({ isActive }) => `px-3 py-2 rounded-lg ${isActive ? 'bg-white/10 font-semibold' : 'hover:bg-white/5'}`}>{t.icon} {t.label}</NavLink>)}
        <button onClick={quick} className="btn btn-gold mt-4">Find me a game</button>
        <div className="mt-auto flex items-center gap-2 text-sm">
          <ArchetypeBadge archetype={profile?.archetype} size="sm" />
          <div className="min-w-0"><div className="truncate font-medium">{profile?.display_name || profile?.username}</div><div className="text-xs opacity-60 capitalize">{tier === 'free' && profile?.is_anonymous ? 'Guest' : tier}</div></div>
        </div>
        <NavLink to="/membership" className="text-xs opacity-70 hover:opacity-100 mt-1">Membership</NavLink>
      </aside>
      <main className="flex-1 pb-24 md:pb-8"><div className="max-w-5xl mx-auto p-4 md:p-8"><Outlet /></div></main>
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-navy-2 border-t border-white/10 flex justify-around py-2 z-20">
        {tabs.map(t => <NavLink key={t.to} to={t.to} className={({ isActive }) => `flex flex-col items-center text-xs px-3 ${isActive ? 'text-gold' : 'opacity-70'}`}><span className="text-lg">{t.icon}</span>{t.label}</NavLink>)}
      </nav>
      <button onClick={quick} className="md:hidden fixed bottom-16 right-4 btn btn-gold shadow-lg z-20">Find me a game</button>
      <FeedbackButton />
    </div>
  )
}
