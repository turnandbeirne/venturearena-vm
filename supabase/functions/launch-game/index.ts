// Arena -> game. Signs a token describing the table and returns the game's launch URL.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { cors, json } from './cors.ts'
import { sign } from './jwt.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const auth = req.headers.get('Authorization') ?? ''
    const user = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
    const { data: { user: me } } = await user.auth.getUser()
    if (!me) return json({ error: 'not signed in' }, 401)
    const { table_id } = await req.json()
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: t } = await admin.from('tables').select('id, game_id, mode, status, host_id, settings').eq('id', table_id).single()
    if (!t) return json({ error: 'no such table' }, 404)
    if (t.status === 'open') return json({ error: 'the host has not started this table yet' }, 409)
    if (t.status !== 'playing') return json({ error: 'this table is over' }, 409)
    const { data: seats } = await admin.from('table_seats').select('seat, player_id, role, profiles(username, tier, archetype), is_bot').eq('table_id', table_id).order('seat')
    if (!seats?.some(s => s.player_id === me.id)) return json({ error: 'not at this table' }, 403)
    const { data: g } = await admin.from('games').select('launch_url, kind').eq('id', t.game_id).single()
    if (!g?.launch_url) return json({ error: 'game has no launch url' }, 400)
    const { data: ratings } = await admin.from('ratings').select('player_id, rating').eq('game_id', t.game_id).in('player_id', seats.map(s => s.player_id))
    const observers = seats.filter(s => s.role === 'observer').map(s => ({ id: s.player_id, username: (s.profiles as any)?.username }))
    const players = seats.filter(s => s.role !== 'observer').map(s => ({ id: s.player_id, seat: s.seat, is_bot: s.is_bot, username: (s.profiles as any)?.username, tier: (s.profiles as any)?.tier, archetype: (s.profiles as any)?.archetype, rating: ratings?.find(r => r.player_id === s.player_id)?.rating ?? 1200 }))
    const meRow = players.find(p => p.id === me.id)
    const secret = Deno.env.get('ARENA_GAME_SECRET')
    if (!secret) return json({ error: 'ARENA_GAME_SECRET not set' }, 500)
    const token = await sign({
      table_id: t.id, game_id: t.game_id, mode: t.mode, settings: t.settings, players, observers, launched_by: me.id,
      me: meRow ? { id: me.id, username: meRow.username, seat: meRow.seat } : null,
      report_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/report-result`,
      arena_url: Deno.env.get('ARENA_URL') ?? '',
    }, secret)
    const url = new URL(g.launch_url); url.searchParams.set('arena', token)
    return json({ launch_url: url.toString(), token })
  } catch (e) { return json({ error: (e as Error).message }, 500) }
})
