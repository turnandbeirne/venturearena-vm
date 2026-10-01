import { useEffect, useRef, useState } from 'react'
import { DIFFICULTIES, PERSONALITIES, PRESETS, SCENARIOS, SKILLS, WEATHER, describeBot, type BotConfig, type VfSettings } from '../lib/vfSettings'

// Membership gating for the fine-grained picks. Off until Stripe is live so
// nobody hits a paywall during testing; flip to true and the "Customize"
// controls ask free hosts to join.
const GATE_CUSTOM = false

type Props = {
  settings: VfSettings
  isHost: boolean
  locked: boolean            // table already started
  humans: number             // people in player seats
  maxPlayers: number         // chairs in the game (4)
  canCustomize: boolean      // tier check from the caller
  onChange: (s: VfSettings) => Promise<void>
  onSuggest?: (text: string) => void   // non-hosts: post a suggestion to table chat
}

function Pick<T extends { id: string; name: string; icon?: string; avatar?: string; tagline?: string }>({ label, options, value, onPick, disabled }: { label: string; options: T[]; value: string; onPick: (id: string) => void; disabled?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide opacity-60 mb-1">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map(o => (
          <button key={o.id} type="button" disabled={disabled} onClick={() => onPick(o.id)} title={o.tagline}
            className={`chip cursor-pointer transition ${value === o.id ? 'ring-2 ring-[var(--color-gold)] opacity-100' : 'opacity-70 hover:opacity-100'} ${disabled ? 'cursor-default' : ''}`}>
            {o.icon ?? o.avatar} {o.name}
          </button>
        ))}
      </div>
    </div>
  )
}

export function TableSettings({ settings, isHost, locked, humans, maxPlayers, canCustomize, onChange, onSuggest }: Props) {
  const [draft, setDraft] = useState<VfSettings>(settings)
  const [open, setOpen] = useState(isHost && !locked)   // the host lands on the full form; everyone else sees the summary
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [msg, setMsg] = useState('')
  const timer = useRef<number | null>(null)
  const pending = useRef(0)          // saves in flight; while > 0 the host's draft wins over the table copy
  const latest = useRef(settings)    // what the host has clicked most recently (never stale, unlike closure state)
  const editable = isHost && !locked
  const customOk = !GATE_CUSTOM || canCustomize

  // Follow the table when someone else (or the server) changes it. Keyed on
  // the content, not the object: the room re-renders every few seconds and a
  // fresh object each time must not wipe the host's half-made edits.
  const settingsKey = JSON.stringify(settings)
  useEffect(() => {
    if (pending.current > 0) return
    latest.current = settings; setDraft(settings)
  }, [settingsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (next: VfSettings) => {
    latest.current = next
    setDraft(next)
    if (timer.current) window.clearTimeout(timer.current)
    setSaving('saving'); pending.current += 1
    timer.current = window.setTimeout(async () => {
      const toSave = latest.current
      try { await onChange(toSave); setSaving('saved'); setMsg(''); window.setTimeout(() => setSaving(v => v === 'saved' ? 'idle' : v), 1500) }
      catch (e) { setSaving('error'); setMsg((e as Error).message) }
      finally { pending.current = Math.max(0, pending.current - 1) }
    }, 350)
  }
  const patch = (p: Partial<VfSettings>) => commit({ ...latest.current, ...p, preset: 'custom' })
  const applyPreset = (k: keyof typeof PRESETS) => commit({ ...PRESETS[k].settings, preset: k })
  const setBot = (i: number, b: Partial<BotConfig>) => patch({ bots: latest.current.bots.map((x, j) => j === i ? { ...x, ...b } : x) })
  const addBot = () => patch({ bots: [...latest.current.bots, { personalityId: 'random', skillLevelId: 'random' }] })
  const removeBot = (i: number) => patch({ bots: latest.current.bots.filter((_, j) => j !== i) })

  const emptyChairs = Math.max(0, maxPlayers - humans)
  const robotsAtStart = draft.fillWithRobots ? emptyChairs : Math.min(emptyChairs, draft.bots.length)
  const scenario = SCENARIOS.find(s => s.id === draft.scenarioId); const diff = DIFFICULTIES.find(d => d.id === draft.difficultyId); const wx = WEATHER.find(w => w.id === draft.weatherSeverityId)

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="display font-bold">{editable ? 'Set up your game' : 'Game settings'} {locked && <span className="text-xs font-normal opacity-60">· locked at start</span>}</div>
        <div className="text-xs opacity-60">
          {saving === 'saving' && 'Saving…'}{saving === 'saved' && 'Saved · everyone sees this'}{saving === 'error' && <span className="text-red-300">{msg}</span>}
          {saving === 'idle' && !isHost && !locked && 'The host sets these. Talk it over in table chat.'}
        </div>
      </div>

      {editable && (
        <div className="grid sm:grid-cols-3 gap-2">
          {(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map(k => (
            <button key={k} type="button" onClick={() => applyPreset(k)}
              className={`text-left rounded-xl border p-3 transition ${draft.preset === k ? 'border-[var(--color-gold)] bg-white/5' : 'border-white/10 hover:border-white/30'}`}>
              <div className="font-semibold text-sm">{PRESETS[k].name}</div>
              <div className="text-xs opacity-70 mt-0.5">{PRESETS[k].blurb}</div>
            </button>
          ))}
        </div>
      )}

      {!editable && !locked && onSuggest && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="opacity-60">Suggest to the host:</span>
          {(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map(k => <button key={k} type="button" className="chip cursor-pointer hover:opacity-100 opacity-80" onClick={() => onSuggest(`How about ${PRESETS[k].name}? ${PRESETS[k].blurb}`)}>{PRESETS[k].name}</button>)}
          <button type="button" className="chip cursor-pointer hover:opacity-100 opacity-80" onClick={() => onSuggest('Can we turn the turn clock off?')}>No clock</button>
          <button type="button" className="chip cursor-pointer hover:opacity-100 opacity-80" onClick={() => onSuggest('Fewer robots please, let people fill the chairs.')}>Fewer robots</button>
        </div>
      )}

      {/* one-line summary everyone can read */}
      <div className="text-sm flex flex-wrap gap-x-3 gap-y-1">
        <span>{scenario?.icon} {scenario?.name}</span>
        <span>{diff?.icon} {diff?.name}</span>
        <span>{wx?.icon} {wx?.name} weather</span>
        <span>{draft.turnTimer ? '⏱️ 30s turns' : '🕰️ No clock'}</span>
        <span>🤖 {robotsAtStart} robot{robotsAtStart === 1 ? '' : 's'} if the table started now{draft.fillWithRobots ? '' : ' (empty chairs stay empty)'}</span>
      </div>

      {editable && (
        <button type="button" className="btn btn-ghost text-sm" onClick={() => setOpen(v => !v)}>{open ? 'Hide details' : 'Customize'}</button>
      )}

      {(open || (!editable && draft.preset === 'custom')) && (
        <div className="space-y-3 pt-1">
          {GATE_CUSTOM && !canCustomize && editable && <div className="text-xs text-gold">Picking the scenario, weather and individual robots is a Member feature. Presets are free.</div>}
          <Pick label="Scenario · how you win" options={SCENARIOS} value={draft.scenarioId} onPick={id => patch({ scenarioId: id })} disabled={!editable || !customOk} />
          <Pick label="Starting conditions" options={DIFFICULTIES} value={draft.difficultyId} onPick={id => patch({ difficultyId: id })} disabled={!editable} />
          <Pick label="Economic weather" options={WEATHER} value={draft.weatherSeverityId} onPick={id => patch({ weatherSeverityId: id })} disabled={!editable || !customOk} />
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={draft.turnTimer} disabled={!editable} onChange={e => patch({ turnTimer: e.target.checked })} /> Turn clock (30s, with extensions)</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={draft.fillWithRobots} disabled={!editable} onChange={e => patch({ fillWithRobots: e.target.checked })} /> Fill every empty chair with a robot at start</label>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide opacity-60 mb-1">Robot line-up · fills chairs people leave empty, in this order</div>
            <div className="text-xs opacity-70 mb-2">{maxPlayers} chairs at the table, {humans} taken by people. A person who joins always gets the chair; the robot steps aside.</div>
            <div className="space-y-2">
              {draft.bots.map((b, i) => {
                const d = describeBot(b)
                return (
                  <div key={i} className="rounded-xl border border-white/10 p-2 space-y-2">
                    <div className="flex items-center gap-2 text-sm"><span className="text-lg">{d.avatar}</span><span className="font-semibold flex-1">{d.name} <span className="opacity-60 font-normal">· {d.skillIcon} {d.skill}</span></span>
                      {editable && <button type="button" className="btn btn-ghost text-xs" onClick={() => removeBot(i)}>Remove</button>}</div>
                    {editable && <>
                      <div className="flex flex-wrap gap-1">{PERSONALITIES.map(p => <button key={p.id} type="button" disabled={!customOk} title={p.style} onClick={() => setBot(i, { personalityId: p.id })} className={`chip cursor-pointer ${b.personalityId === p.id ? 'ring-2 ring-[var(--color-gold)]' : 'opacity-70 hover:opacity-100'}`}>{p.avatar} {p.name}</button>)}</div>
                      <div className="flex flex-wrap gap-1">{SKILLS.map(s => <button key={s.id} type="button" onClick={() => setBot(i, { skillLevelId: s.id })} className={`chip cursor-pointer ${b.skillLevelId === s.id ? 'ring-2 ring-[var(--color-gold)]' : 'opacity-70 hover:opacity-100'}`}>{s.icon} {s.name}</button>)}</div>
                    </>}
                  </div>
                )
              })}
              {editable && draft.bots.length < maxPlayers - 1 && <button type="button" className="btn btn-ghost text-sm" onClick={addBot}>+ Add a robot to the line-up</button>}
              {draft.fillWithRobots && draft.bots.length < maxPlayers - 1 && <div className="text-xs opacity-60">Chairs beyond the line-up get a surprise robot of any skill.</div>}
            </div>
          </div>
          <div className="text-xs opacity-60">Play speed, sound and hints stay personal in the game. Robot turns are paced by the host's speed setting.</div>
        </div>
      )}
    </div>
  )
}
