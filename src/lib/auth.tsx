import { createContext, useContext, useEffect, useState, type ReactNode, useCallback } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, TIER_RANK, FEATURES, type Tier } from './supabase'

export type Profile = {
  id: string; username: string; display_name: string | null; avatar_url: string | null; bio: string | null
  interests: string[]; tier: Tier; tier_expires_at: string | null; is_anonymous: boolean
  archetype: string | null; dna: { risk?: number; pace?: number; collab?: string; sophistication?: number }
  stage: string | null; intent: string[]; open_to_mentoring: number; investor_profile: unknown | null
  prompts: { q: string; a: string }[]; onboarded: boolean; created_at: string
}

type Ctx = {
  session: Session | null; profile: Profile | null; loading: boolean
  tier: Tier; allows: (feature: string) => boolean
  enterAsGuest: () => Promise<void>; refresh: () => Promise<void>; signOut: () => Promise<void>
  registerEmail: (email: string, password: string) => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
}

const AuthCtx = createContext<Ctx>(null as unknown as Ctx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (uid?: string) => {
    if (!uid) { setProfile(null); return }
    const { data } = await supabase.from('profiles').select('*').eq('id', uid).single()
    setProfile(data as Profile | null)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session); await loadProfile(data.session?.user.id); setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, s) => {
      setSession(s); await loadProfile(s?.user.id)
    })
    return () => sub.subscription.unsubscribe()
  }, [loadProfile])

  const tier: Tier = !session ? 'anonymous' : profile
    ? (profile.tier_expires_at && new Date(profile.tier_expires_at) < new Date() ? 'free' : profile.tier)
    : 'free'

  const allows = (feature: string) => TIER_RANK[tier] >= TIER_RANK[FEATURES[feature] ?? 'ceo']

  const enterAsGuest = async () => {
    if (session) return
    const { error } = await supabase.auth.signInAnonymously()
    if (error) throw error
  }
  const refresh = () => loadProfile(session?.user.id)
  const signOut = async () => { await supabase.auth.signOut(); setProfile(null) }
  const registerEmail = async (email: string, password: string) => {
    if (session?.user.is_anonymous) {
      const { error } = await supabase.auth.updateUser({ email, password })
      if (error) throw error
      await supabase.rpc('mark_registered'); await refresh()
    } else {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) throw error
    }
  }
  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  return <AuthCtx.Provider value={{ session, profile, loading, tier, allows, enterAsGuest, refresh, signOut, registerEmail, signIn }}>{children}</AuthCtx.Provider>
}

export const useAuth = () => useContext(AuthCtx)
export const useTier = () => { const { tier, allows } = useAuth(); return { tier, allows } }
