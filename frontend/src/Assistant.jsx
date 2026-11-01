import { useEffect, useRef, useState } from 'react'
import { post } from './api'

// Floating AI assistant for members — talks to POST /api/me/assistant.
// The backend injects the member's own data; the widget only ships
// the question + a few recent turns.
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
            <div className="bot-head-txt">
              <span className="bot-title">{gymName ? gymName + ' Assistant' : 'Gym Assistant'}</span>
              <span className="bot-sub">{busy ? 'typing…' : 'online'}</span>
            </div>
            <button className="bot-x" onClick={() => setOpen(false)} aria-label="Close">✕</button>
          </div>

          <div className="bot-msgs" ref={listRef}>
            {msgs.map((m, i) => (
              <div key={i} className={'bot-msg ' + (m.role === 'user' ? 'bot-me' : 'bot-ai')}>{m.content}</div>
            ))}
            {busy && <div className="bot-msg bot-ai bot-dots"><i></i><i></i><i></i></div>}
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
        {open ? '✕' : '🤖'}
      </button>
    </div>
  )
}