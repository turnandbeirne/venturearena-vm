// VentureArena bridge: reads the arena token, describes the table, and posts
// results. Inert unless the page was opened with ?arena=<token>.
import { ARENA_SITE_URL } from './arenaConfig';

const STORAGE_KEY = 'vf_arena_session';
let cached;

function decodeToken(token) {
  const part = token.split('.')[1];
  if (!part) return null;
  const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(part.length + ((4 - (part.length % 4)) % 4), '='));
  return JSON.parse(json);
}

/** The arena session for this page, or null when VentureFlow was opened normally. */
export function getArena() {
  if (cached !== undefined) return cached;
  try {
    const params = new URLSearchParams(window.location.search);
    let token = params.get('arena');
    if (token) {
      sessionStorage.setItem(STORAGE_KEY, token);
      const url = new URL(window.location.href);
      url.searchParams.delete('arena');
      window.history.replaceState({}, '', url.toString());
    } else {
      token = sessionStorage.getItem(STORAGE_KEY);
    }
    if (!token) return (cached = null);
    const claims = decodeToken(token);
    if (!claims || !claims.table_id || (claims.exp && claims.exp * 1000 < Date.now())) return (cached = null);
    const players = (claims.players || []).slice().sort((a, b) => a.seat - b.seat);
    const humans = players.filter((p) => !p.is_bot);
    const host = humans[0] || null;
    const me = claims.me || null;
    cached = {
      token,
      tableId: claims.table_id,
      me, // { id, username, seat } — null for an observer
      isHost: !!me && !!host && me.id === host.id,
      isObserver: !me,
      players,
      humans,
      observers: claims.observers || [],
      settings: claims.settings || {},
      reportUrl: claims.report_url,
      arenaUrl: claims.arena_url || ARENA_SITE_URL,
      tableUrl: `${claims.arena_url || ARENA_SITE_URL}/t/${claims.table_id}`,
      debriefUrl: `${claims.arena_url || ARENA_SITE_URL}/debrief/${claims.table_id}`,
    };
    return cached;
  } catch {
    return (cached = null);
  }
}

export function clearArena() {
  sessionStorage.removeItem(STORAGE_KEY);
  cached = undefined;
}

/** The seat list the online roster is built from: arena humans first (by seat), then robots to fill 4 chairs. */
export function arenaSeats(arena) {
  const total = 4;
  const seats = arena.humans.map((p, i) => ({ type: 'human', name: p.username, arenaId: p.id, avatar: ['🦊', '🦉', '🐸', '🐙'][i] }));
  const aiCount = Math.max(0, Math.min(total - seats.length, Number(arena.settings.aiCount ?? total - seats.length)));
  for (let i = 0; i < aiCount; i++) seats.push({ type: 'ai', personalityId: 'random', skillLevelId: 'random' });
  return seats;
}

/** Engine player id ('p1', 'p2', …) for an arena user id, given the seat list used at START_GAME. */
export function playerIdForArenaUser(seats, arenaUserId) {
  let n = 0;
  for (const seat of seats) {
    if (seat.type !== 'human') continue;
    n += 1;
    if (seat.arenaId === arenaUserId) return `p${n}`;
  }
  return null;
}

let reported = false;
/**
 * Host only: post everyone's final standings to the arena when the game is over.
 * Returns { ok, nextUrl }.
 */
export async function reportArenaResults(state, seats, netWorthOf) {
  const arena = getArena();
  if (!arena || reported) return null;
  reported = true;
  const humansById = new Map();
  let n = 0;
  for (const seat of seats) if (seat.type === 'human') humansById.set(`p${++n}`, seat.arenaId);
  const ranked = [...state.players].filter((p) => humansById.has(p.id)).sort((a, b) => netWorthOf(b) - netWorthOf(a));
  const results = ranked.map((p, i) => ({
    player_id: humansById.get(p.id),
    placement: i + 1,
    score: netWorthOf(p),
    skill_tags: ['cash flow', ...(p.businesses?.length ? ['business building'] : [])],
    telemetry: { cash: p.cash, businesses: (p.businesses || []).length, badges: (p.badges || []).length, tookOver: p.type === 'ai' },
  }));
  try {
    const res = await fetch(arena.reportUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: arena.token, results }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    return { ok: true, nextUrl: data.next_url || arena.debriefUrl };
  } catch (e) {
    reported = false;
    return { ok: false, error: e.message, nextUrl: arena.tableUrl };
  }
}
