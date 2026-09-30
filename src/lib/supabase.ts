import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string

export const configured = Boolean(url && key)

export const supabase = createClient(url || 'https://placeholder.supabase.co', key || 'placeholder', {
  auth: { persistSession: true, autoRefreshToken: true },
})

export type Tier = 'anonymous' | 'free' | 'member' | 'vip' | 'ceo'
export const TIER_RANK: Record<Tier, number> = { anonymous: 0, free: 1, member: 2, vip: 3, ceo: 4 }

export const FEATURES: Record<string, Tier> = {
  create_table: 'free',
  private_table: 'member',
  full_history: 'member',
  view_style: 'member',
  view_vip_fields: 'vip',
  dm_anyone: 'member',
  mentor_match: 'member',
  cofounder_match: 'member',
  investor_match: 'vip',
  vouch: 'ceo',
}

export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}
