// Game -> arena. Verifies the launch token and records placements, ratings, reputation and telemetry.
// Body: { token, external_match_id?, results: [{ player_id, placement, score?, skill_tags?, telemetry? }] }
import { createClient } from 'npm:@supabase/supabase-js@2'
import { cors, json } from './cors.ts'
import { verify } from './jwt.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { token, external_match_id, results } = await req.json()
    const claims = await verify<{ table_id: string; players: { id: string }[] }>(token, Deno.env.get('ARENA_GAME_SECRET')!)
    if (!Array.isArray(results) || results.length < 1) return json({ error: 'results required' }, 400)
    const allowed = new Set(claims.players.map(p => p.id))
    for (const r of results) if (!allowed.has(r.player_id)) return json({ error: `player ${r.player_id} not at table` }, 400)
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: t } = await admin.from('tables').select('status').eq('id', claims.table_id).single()
    if (!t) return json({ error: 'no such table' }, 404)
    if (t.status === 'finished') return json({ ok: true, already: true, debrief_url: `${Deno.env.get('ARENA_URL') ?? ''}/debrief/${claims.table_id}` })
    if (external_match_id) await admin.from('tables').update({ external_match_id }).eq('id', claims.table_id)
    const { error } = await admin.rpc('record_result', { p_table: claims.table_id, p_results: results })
    if (error) return json({ error: error.message }, 500)
    return json({ ok: true, debrief_url: `${Deno.env.get('ARENA_URL') ?? ''}/debrief/${claims.table_id}` })
  } catch (e) { return json({ error: (e as Error).message }, 401) }
})
