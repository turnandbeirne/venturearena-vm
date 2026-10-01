import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { rpc } from '../lib/supabase'

const KINDS = [
  { id: 'suggestion', label: 'Make a suggestion' },
  { id: 'problem', label: 'Report a problem' },
  { id: 'general', label: 'General feedback' },
]
const SCOPES = [
  { id: 'arena', label: 'VentureArena (site, tables, lobby)' },
  { id: 'ventureflow', label: 'VentureFlow game' },
  { id: 'connect4', label: 'Connect 4' },
  { id: 'ventureboom', label: 'VentureBoom' },
  { id: 'matching', label: 'People & matching' },
  { id: 'membership', label: 'Membership & billing' },
  { id: 'other', label: 'Something else' },
]

// Floating "Feedback" control on every arena page. Sends through send_feedback
// (tied to the signed-in member), confirms in place, and the thank-you plus
// any later response land in the member's Inbox.
export function FeedbackButton() {
  const loc = useLocation()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState('suggestion')
  const [scope, setScope] = useState(loc.pathname.startsWith('/t/') || loc.pathname.startsWith('/debrief') ? 'ventureflow' : 'arena')
  const [body, setBody] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [err, setErr] = useState('')

  const send = async () => {
    setState('sending'); setErr('')
    try {
      await rpc('send_feedback', { p_kind: kind, p_scope: scope, p_body: body.trim(), p_page: loc.pathname })
      setState('sent'); setBody('')
    } catch (e) { setState('error'); setErr((e as Error).message) }
  }

  return (
    <>
      <button onClick={() => { setOpen(v => !v); setState('idle') }} className="fixed bottom-28 md:bottom-4 left-4 btn btn-ghost text-xs shadow-lg z-30 bg-navy-2/90" title="Suggest something or report a problem">💬 Feedback</button>
      {open && (
        <div className="fixed inset-0 z-40 flex items-end md:items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div className="card p-5 w-full max-w-md space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between"><div className="display font-bold text-lg">Tell the arena</div><button className="btn btn-ghost text-xs" onClick={() => setOpen(false)}>Close</button></div>
            {state === 'sent' ? (
              <div className="space-y-2 text-sm">
                <div className="text-gold font-semibold">Sent. Thank you.</div>
                <p className="opacity-80">It's logged under your name with the page you were on. You'll get a note in your Inbox when it's been acted on, so you can see how you helped the arena get better.</p>
                <button className="btn btn-gold w-full" onClick={() => setOpen(false)}>Done</button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-2 text-sm">
                  <label className="space-y-1"><span className="text-xs opacity-60">What is this?</span>
                    <select className="input" value={kind} onChange={e => setKind(e.target.value)}>{KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}</select></label>
                  <label className="space-y-1"><span className="text-xs opacity-60">About</span>
                    <select className="input" value={scope} onChange={e => setScope(e.target.value)}>{SCOPES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
                  <label className="space-y-1"><span className="text-xs opacity-60">{kind === 'problem' ? 'What happened, and what did you expect?' : 'Your idea'}</span>
                    <textarea className="input min-h-28" maxLength={4000} value={body} onChange={e => setBody(e.target.value)} placeholder={kind === 'problem' ? 'Steps to reproduce help a lot.' : 'What would make this better?'} /></label>
                </div>
                {err && <div className="text-red-300 text-sm">{err}</div>}
                <button className="btn btn-gold w-full" disabled={body.trim().length < 3 || state === 'sending'} onClick={send}>{state === 'sending' ? 'Sending…' : 'Send feedback'}</button>
                <div className="text-[11px] opacity-50">Sent as you, with the page you're on ({loc.pathname}).</div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
