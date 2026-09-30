// Game -> arena. Verifies the launch token (HMAC, ARENA_GAME_SECRET) and records results.
// Two shapes:
//   Arena race (each player plays their own game against a shared seed):
//     { token, score, skill_tags?, telemetry? }            -> stored for the launching player; finalized when all reported
//   Full table result (a true multiplayer game):
//     { token, external_match_id?, results: [{ player_id, placement, score?, skill_tags?, telemetry? }] }
import { createClient } from 'npm:@supabase/supabase-js@2'
import { cors, json } from './cors.ts'
import { verify } from './jwt.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const body = await req.json()
    const { token, external_match_id, results } = body
    const secret = Deno.env.get('ARENA_GAME_SECRET')
    if (!secret) return json({ error: 'ARENA_GAME_SECRET not set' }, 500)
    const claims = await verify<{ table_id: string; players: { id: string }[]; launched_by: string }>(token, secret)
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: t } = await admin.from('tables').select('status').eq('id', claims.table_id).single()
    if (!t) return json({ error: 'no such table' }, 404)
    const arena = Deno.env.get('ARENA_URL') ?? ''
    const debrief_url = `${arena}/debrief/${claims.table_id}`
    const table_url = `${arena}/t/${claims.table_id}`
    if (t.status === 'finished') return json({ ok: true, already: true, finalized: true, debrief_url, next_url: debrief_url })

    if (!Array.isArray(results) && typeof body.score === 'number') {
      const { data: finalized, error } = await admin.rpc('submit_external_score', {
        p_table: claims.table_id, p_player: claims.launched_by, p_score: body.score,
        p_tags: body.skill_tags ?? [], p_telemetry: body.telemetry ?? null,
      })
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true, finalized: !!finalized, debrief_url, table_url, next_url: finalized ? debrief_url : table_url })
    }

    if (!Array.isArray(results) || results.length < 1) return json({ error: 'results or score required' }, 400)
    const allowed = new Set(claims.players.map(p => p.id))
    for (const r of results) if (!allowed.has(r.player_id)) return json({ error: `player ${r.player_id} not at table` }, 400)
    if (external_match_id) await admin.from('tables').update({ external_match_id }).eq('id', claims.table_id)
    const { error } = await admin.rpc('record_result', { p_table: claims.table_id, p_results: results })
    if (error) return json({ error: error.message }, 500)
    return json({ ok: true, finalized: true, debrief_url, next_url: debrief_url })
  } catch (e) { return json({ error: (e as Error).message }, 401) }
})
