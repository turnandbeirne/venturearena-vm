import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { rpc } from '../lib/supabase'

// /join/:code — works logged out: creates a guest session, seats the visitor, drops them in the table room
export default function Join() {
  const { code, mode } = useParams(); const nav = useNavigate(); const { session, loading, enterAsGuest, profile } = useAuth()
  const [err, setErr] = useState('')
  useEffect(() => {
    if (loading) return
    (async () => {
      try {
        if (!session) { await enterAsGuest(); return } // auth change re-runs this effect
        if (profile && !profile.onboarded) { sessionStorage.setItem('after_onboarding', `/join/${code}${mode ? '/' + mode : ''}`); nav('/onboarding', { replace: true }); return }
        const id = await rpc<string>('join_by_code', { p_code: code, p_role: mode === 'watch' ? 'observer' : 'player' })
        nav(`/t/${id}`, { replace: true })
      } catch (e) { setErr((e as Error).message) }
    })()
  }, [session, loading, profile, code, mode, nav, enterAsGuest])
  return <div className="p-8 text-center opacity-70">{err ? err : 'Finding your seat…'}</div>
}
