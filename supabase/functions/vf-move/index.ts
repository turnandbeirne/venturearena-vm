// VentureFlow online tables: append one move to the table's shared move list.
// Body: { token, seq, action }. The token is the arena launch token (HMAC, ARENA_GAME_SECRET).
// Rules: the caller must be a human player at the table; player actions must be for the caller's own
// seat; robot turns, timers, card acknowledgements and the game start may only come from the host
// (the lowest human seat); a seat takeover may come from the host or the seat's owner.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { cors, json } from './cors.ts'
import { verify } from './jwt.ts'

type Claims = { table_id: string; launched_by: string; me: { id: string; seat: number } | null; players: { id: string; seat: number; is_bot: boolean }[] }

const PLAYER_ACTIONS = new Set(['BUY_ASSET', 'SELL_ASSET', 'START_BUSINESS', 'LEARN_SKILL', 'UPGRADE_BUSINESS', 'END_TURN', 'EXTEND_TURN', 'RESOLVE_EXIT_OFFER', 'SEND_CHAT'])
const HOST_ACTIONS = new Set(['START_GAME', 'RUN_AI_STEP', 'RUN_AI_TURN', 'FINALIZE_GAME_OVER'])
const ANYONE_ACTIONS = new Set(['ACK_FORTUNE_CARD', 'ACK_STARTUP_LAUNCH', 'START_TURN_TIMER'])

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { token, seq, action } = await req.json()
    const secret = Deno.env.get('ARENA_GAME_SECRET')
    if (!secret) return json({ error: 'ARENA_GAME_SECRET not set' }, 500)
    const claims = await verify<Claims>(token, secret)
    if (!claims.me) return json({ error: 'observers cannot move' }, 403)
    if (!action || typeof action.type !== 'string' || !Number.isInteger(seq) || seq < 1) return json({ error: 'bad move' }, 400)
    const humans = claims.players.filter(p => !p.is_bot).sort((a, b) => a.seat - b.seat)
    const isHost = humans[0]?.id === claims.me.id
    // engine player id for the caller: humans in seat order are p1, p2, ...
    const myPid = `p${humans.findIndex(h => h.id === claims.me!.id) + 1}`
    const t = action.type
    if (HOST_ACTIONS.has(t)) { if (!isHost) return json({ error: 'only the host may do that' }, 403) }
    else if (PLAYER_ACTIONS.has(t)) {
      const pid = action.playerId
      const isAiSeat = typeof pid === 'string' && pid.startsWith('ai')
      if (t === 'END_TURN' && isAiSeat) { if (!isHost) return json({ error: 'only the host ends robot turns' }, 403) }
      else if (pid !== myPid && !(isHost && isAiSeat)) return json({ error: `that seat is not yours` }, 403)
    }
    else if (t === 'CONVERT_SEAT_TO_AI') { if (!isHost && action.playerId !== myPid) return json({ error: 'only the host can hand a seat to a robot' }, 403) }
    else if (!ANYONE_ACTIONS.has(t)) return json({ error: `action ${t} is not allowed at a table` }, 400)
    if (t === 'START_GAME' && seq !== 1) return json({ error: 'the game has already started' }, 409)
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: tbl } = await admin.from('tables').select('status').eq('id', claims.table_id).single()
    if (!tbl || tbl.status !== 'playing') return json({ error: 'table is not in play' }, 409)
    const { data, error } = await admin.rpc('vf_append_move', { p_table: claims.table_id, p_seq: seq, p_action: action, p_by: claims.me.id })
    if (error) return json({ error: error.message }, error.message.includes('SEQ_CONFLICT') ? 409 : 500)
    return json({ ok: true, seq: data })
  } catch (e) { return json({ error: (e as Error).message }, 401) }
})
