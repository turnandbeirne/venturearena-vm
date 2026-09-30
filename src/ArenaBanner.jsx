// Thin ribbon shown only at an arena table; also the "play online" invitation
// on the landing page for players who opened VentureFlow on their own.
import { ARENA_SITE_URL } from './arenaConfig';

export function ArenaInvite() {
  return (
    <a
      className="vf-arena-invite"
      href={`${ARENA_SITE_URL}/?from=ventureflow`}
      style={{ display: 'block', margin: '12px auto', maxWidth: 720, padding: '12px 16px', borderRadius: 14, background: '#0b1530', color: '#f6f1e7', textDecoration: 'none', textAlign: 'center', fontWeight: 600 }}
    >
      🏟️ Play VentureFlow online with real people in VentureArena — live tables, a debrief after every game, and founders, mentors and investors to meet. →
    </a>
  );
}

export default function ArenaBanner({ sync, result }) {
  if (!sync?.active) return null;
  const { arena, status, isHost, isObserver, localPlayerId } = sync;
  const style = { background: '#0b1530', color: '#f6f1e7', padding: '8px 14px', display: 'flex', gap: 12, alignItems: 'center', fontSize: 14, flexWrap: 'wrap' };
  const link = { marginLeft: 'auto', color: '#e8b64a', fontWeight: 600 };
  if (result) {
    return (
      <div style={style}>
        <span>🏟️ {result.ok ? 'Results sent to the arena.' : `Could not send results (${result.error}).`}</span>
        <a href={result.nextUrl} style={link}>Go to the Debrief →</a>
      </div>
    );
  }
  return (
    <div style={style}>
      <span>🏟️ VentureArena table · {arena.humans.length} {arena.humans.length === 1 ? 'player' : 'players'}{isObserver ? ' · you are watching' : localPlayerId ? ` · you are ${localPlayerId.toUpperCase()}` : ''}{isHost ? ' · host' : ''}</span>
      <span style={{ opacity: 0.7 }}>{status === 'synced' ? 'live' : status === 'waiting' ? 'waiting for the host to start' : status === 'offline' ? 'reconnecting…' : 'connecting…'}</span>
      <a href={arena.tableUrl} style={link}>Arena table</a>
    </div>
  );
}
