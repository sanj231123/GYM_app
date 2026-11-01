import { useEffect, useRef, useState } from 'react'
import { post } from './api'

// Floating AI assistant for members — talks to POST /api/me/assistant.
// The backend injects the member's own data; the widget only ships
// the question + a few recent turns.

// Girl assistant avatar (inline SVG — no network dependency)
export function GirlAvatar({ size = 34 }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true">
      {/* shoulders */}
      <path d="M8 48c0-8 7.4-13 16-13s16 5 16 13z" fill="#ffffff" />
      {/* neck */}
      <rect x="21" y="30" width="6" height="6" rx="2" fill="#f6c9b2" />
      {/* hair behind face */}
      <circle cx="24" cy="19" r="10.4" fill="#4a2f23" />
      {/* side locks */}
      <path d="M13.4 18q-1.2 8 1.8 10.5V18z" fill="#4a2f23" />
      <path d="M34.6 18q1.2 8-1.8 10.5V18z" fill="#4a2f23" />
      {/* bun */}
      <circle cx="34.5" cy="8.5" r="4" fill="#4a2f23" />
      {/* face */}
      <circle cx="24" cy="21" r="8.6" fill="#ffdcc8" />
      {/* bangs/finge over forehead */}
      <path d="M15.6 19.5q1-8.3 8.4-8.3t8.4 8.3q-3-4-8.4-4t-8.4 4z" fill="#4a2f23" />
      {/* eyes */}
      <circle cx="20.7" cy="21.5" r="1.35" fill="#2c1e15" />
      <circle cx="27.3" cy="21.5" r="1.35" fill="#2c1e15" />
      {/* blush */}
      <circle cx="18.7" cy="24.3" r="1.5" fill="#f7b2a0" opacity=".65" />
      <circle cx="29.3" cy="24.3" r="1.5" fill="#f7b2a0" opacity=".65" />
      {/* smile */}
      <path d="M21.2 26.6q2.8 2.4 5.6 0" stroke="#2c1e15" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      {/* headset band + mic */}
      <path d="M13.6 18.5a10.5 10.5 0 0 1 20.8 0" stroke="#e8ecff" strokeWidth="2" fill="none" strokeLinecap="round" />
      <rect x="33.2" y="17.5" width="3" height="6" rx="1.5" fill="#e8ecff" />
      <path d="M34.7 23.5q0 3.4-3.4 3.4" stroke="#e8ecff" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </svg>
  )
}

const HELLO = "Hi! Main aapka gym assistant hoon 😊 Plan, expiry, payments ya timings ke baare me kuch bhi poocho."
const SUGGESTIONS = ['When does my plan expire?', 'How many times did I come this month?', 'What are the gym timings?', 'How much have I paid so far?']

export default function Assistant({ gymName = '' }) {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState([{ role: 'assistant', content: HELLO }])
  const [busy, setBusy] = useState(false)
  const [showTips, setShowTips] = useState(true)
  const [input, setInput] = useState('')
  const listRef = useRef(null)

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [msgs, busy, open])

  const send = async (text) => {
    const q = (text ?? input).trim()
    if (!q || busy) return
    setShowTips(false)
    const history = msgs.slice(-6).map(m => ({ role: m.role, content: m.content }))
    setMsgs(m => [...m, { role: 'user', content: q }])
    setInput('')
    setBusy(true)
    try {
      const r = await post('/me/assistant', { message: q, history })
      setMsgs(m => [...m, { role: 'assistant', content: r.reply }])
    } catch (e) {
      setMsgs(m => [...m, { role: 'assistant', content: '⚠️ ' + e.message }])
    } finally { setBusy(false) }
  }

  return (
    <div className="bot-wrap">
      {open && (
        <div className="bot-panel" role="dialog" aria-label="Gym assistant">
          <div className="bot-head">
            <span className="bot-head-avatar"><GirlAvatar size={34} /></span>
            <div className="bot-head-txt">
              <span className="bot-title">{gymName ? gymName + ' Assistant' : 'Gym Assistant'}</span>
              <span className="bot-sub">{busy ? 'typing…' : 'online'}</span>
            </div>
            <button className="bot-x" onClick={() => setOpen(false)} aria-label="Close">✕</button>
          </div>

          <div className="bot-msgs" ref={listRef}>
            {msgs.map((m, i) => m.role === 'user'
              ? <div key={i} className="bot-msg bot-me">{m.content}</div>
              : (
                <div key={i} className="bot-row">
                  <span className="bot-bubble-avatar"><GirlAvatar size={24} /></span>
                  <div className="bot-msg bot-ai">{m.content}</div>
                </div>
              ))}
            {busy && (
              <div className="bot-row">
                <span className="bot-bubble-avatar"><GirlAvatar size={24} /></span>
                <div className="bot-msg bot-ai bot-dots"><i></i><i></i><i></i></div>
              </div>
            )}
          </div>

          {showTips && (
            <div className="bot-tips">
              {SUGGESTIONS.map(s => (
                <button key={s} className="bot-tip" onClick={() => send(s)}>{s}</button>
              ))}
            </div>
          )}

          <form className="bot-input" onSubmit={e => { e.preventDefault(); send() }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Type your question…"
              maxLength={500}
              disabled={busy}
            />
            <button type="submit" className="bot-send" disabled={busy || !input.trim()} aria-label="Send">➤</button>
          </form>
        </div>
      )}

      <button className={'bot-fab' + (open ? ' bot-fab-open' : '')} onClick={() => setOpen(o => !o)} aria-label="Open assistant" title="AI Assistant">
        {open ? '✕' : <GirlAvatar size={44} />}
      </button>
    </div>
  )
}