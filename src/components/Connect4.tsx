export type C4State = { board: number[][]; turn: number; winner: number | null; moves: number; last_col?: number }

export function Connect4Board({ state, mySeat, seatColors, onMove, disabled }: { state: C4State; mySeat: number | null; seatColors: string[]; onMove: (col: number) => void; disabled: boolean }) {
  const myTurn = mySeat !== null && state.turn === mySeat && state.winner === null
  return (
    <div className="inline-block p-3 rounded-2xl" style={{ background: 'var(--color-navy-3)' }}>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {Array.from({ length: 7 }).map((_, c) => (
          <button key={c} disabled={disabled || !myTurn || state.board[0][c] !== 0} onClick={() => onMove(c)}
            className="h-7 rounded-md text-xs opacity-70 hover:opacity-100 hover:bg-white/10 disabled:opacity-20" aria-label={`Drop in column ${c + 1}`}>▼</button>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {state.board.map((row, r) => row.map((cell, c) => (
          <div key={`${r}-${c}`} className="w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center" style={{ background: 'rgba(0,0,0,.35)' }}>
            {cell !== 0 && <div className={`w-8 h-8 md:w-10 md:h-10 rounded-full ${state.last_col === c ? 'drop' : ''}`} style={{ background: seatColors[cell - 1] ?? '#999', boxShadow: 'inset 0 -3px 0 rgba(0,0,0,.3)' }} />}
          </div>
        )))}
      </div>
    </div>
  )
}

// Simple bot: win > block > center preference
export function botMove(board: number[][], me: number): number {
  const opp = me === 1 ? 2 : 1
  const drop = (b: number[][], col: number, p: number) => { for (let r = 5; r >= 0; r--) if (b[r][col] === 0) { const nb = b.map(x => [...x]); nb[r][col] = p; return nb } return null }
  const wins = (b: number[][], p: number) => {
    for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++) {
      if (b[r][c] !== p) continue
      if (c <= 3 && b[r][c + 1] === p && b[r][c + 2] === p && b[r][c + 3] === p) return true
      if (r <= 2 && b[r + 1][c] === p && b[r + 2][c] === p && b[r + 3][c] === p) return true
      if (r <= 2 && c <= 3 && b[r + 1][c + 1] === p && b[r + 2][c + 2] === p && b[r + 3][c + 3] === p) return true
      if (r >= 3 && c <= 3 && b[r - 1][c + 1] === p && b[r - 2][c + 2] === p && b[r - 3][c + 3] === p) return true
    }
    return false
  }
  const legal = [3, 2, 4, 1, 5, 0, 6].filter(c => board[0][c] === 0)
  for (const c of legal) { const nb = drop(board, c, me); if (nb && wins(nb, me)) return c }
  for (const c of legal) { const nb = drop(board, c, opp); if (nb && wins(nb, opp)) return c }
  // avoid giving the opponent a win on top
  for (const c of legal) { const nb = drop(board, c, me); if (!nb) continue; const nb2 = drop(nb, c, opp); if (nb2 && wins(nb2, opp)) continue; return c }
  return legal[0] ?? 0
}
