import React, { useState } from 'react'
import { get, post, login, put } from './api'

// ---------- Platform landing + gym self-signup ----------
export function PlatformPage() {
  const [trialDays, setTrialDays] = useState(14)
  const [f, setF] = useState({ gym_name: '', slug: '', owner_name: '', email: '', password: '' })
  const [slugState, setSlugState] = useState({ checked: '', available: null, reason: '' })
  const [done, setDone] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  React.useEffect(() => { get('/platform/config').then(c => setTrialDays(c.trial_days || 14)).catch(() => {}) }, [])

  const slugify = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30)
  const setGymName = (v) => {
    const s = slugify(v)
    setF({ ...f, gym_name: v, slug: f.slug && f.slug !== slugify(f.gym_name) ? f.slug : s })
    if (s.length >= 2) checkSlug(s)
  }
  const checkSlug = async (s) => {
    try {
      const r = await get('/platform/slug-available?slug=' + encodeURIComponent(s))
      setSlugState({ checked: s, available: r.available, reason: r.reason || '' })
    } catch { setSlugState({ checked: s, available: null, reason: '' }) }
  }
  const setSlug = (v) => {
    const s = v.toLowerCase().replace(/[^a-z0-9-]/g, '')
    setF({ ...f, slug: s })
    if (s.length >= 2) checkSlug(s); else setSlugState({ checked: s, available: null, reason: '' })
  }

  const submit = async (e) => {
    e.preventDefault()
    setErr(''); setBusy(true)
    try {
      const r = await post('/platform/register-gym', f)
      setDone(r)
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }

  const host = (typeof location !== 'undefined' && location.host) || 'localhost:2311'
  const slugOk = slugState.checked === f.slug && slugState.available === true

  return (
    <div className="af-site">
      <section id="top" className="sec">
        <span className="sec-kicker">GYMFIT PLATFORM</span>
        <h2 className="sec-title">Run your gym online — in minutes</h2>
        <p className="muted" style={{ maxWidth: 640 }}>
          Every gym gets its own private website and dashboard: members, payments,
          attendance, plans and notifications. Your gym's data is always separate
          from everyone else's.
        </p>
        <div className="grid3" style={{ marginTop: 22 }}>
          {[
            { t: 'Member management', d: 'Profiles, photos, plans, trainers and expiry tracking — searchable in one place.' },
            { t: 'Payments & income', d: 'Cash, UPI and online payments, monthly income reports and receipts.' },
            { t: 'Attendance & alerts', d: 'Daily check-ins, expiry alerts by email and WhatsApp, activity history.' },
          ].map((c, k) => (
            <div key={k} className="panel"><h3>{c.t}</h3><p className="muted">{c.d}</p></div>
          ))}
        </div>
        <div className="grid3" style={{ marginTop: 14 }}>
          <div className="panel plan-card"><h3 style={{ textAlign: 'center' }}>Free Trial</h3><div className="plan-price">{trialDays} days</div><p className="muted" style={{ textAlign: 'center' }}>No card needed</p></div>
          <div className="panel plan-card"><h3 style={{ textAlign: 'center' }}>After Trial</h3><div className="plan-price">Simple monthly fee</div><p className="muted" style={{ textAlign: 'center' }}>Pay by UPI / bank transfer — no lock-in</p></div>
          <div className="panel plan-card"><h3 style={{ textAlign: 'center' }}>Your Address</h3><div className="plan-price">yourgym.{(host.split(':')[0] || 'example.com')}</div><p className="muted" style={{ textAlign: 'center' }}>Choose it below and start instantly</p></div>
        </div>
      </section>

      <section className="sec" id="register">
        <h2 className="sec-title">Register your gym</h2>
        <div className="panel form" style={{ maxWidth: 560, margin: '0 auto' }}>
          {done ? (
            <div style={{ textAlign: 'center' }}>
              <h3>🎉 {done.gym.name} is ready!</h3>
              <p className="muted">
                Your trial runs for {done.trial_days} days.<br />
                Address: <b>/{done.gym.slug}</b> on this site (later: yourgym.{host.split(':')[0]})
              </p>
              <button className="btn primary" onClick={() => { location.href = '/g/' + done.gym.slug }}>Go to my gym →</button>
            </div>
          ) : (
            <>
              {err && <p className="error">{err}</p>}
              <form onSubmit={submit} className="form">
                <input className="inp" placeholder="Gym name *" value={f.gym_name} onChange={e => setGymName(e.target.value)} required />
                <div className="row" style={{ gap: 8 }}>
                  <input className="inp" placeholder="gym-address *" value={f.slug} onChange={e => setSlug(e.target.value)} required />
                  <span style={{ whiteSpace: 'nowrap', fontSize: 13 }}>
                    {slugState.checked === f.slug && f.slug.length >= 2 ? (
                      slugState.available === true ? <span style={{ color: '#1e8e3e' }}>available ✓</span>
                        : slugState.available === false ? <span style={{ color: '#d93025' }}>{slugState.reason || 'taken'}</span>
                        : <span className="muted">checking…</span>
                    ) : <span className="muted small">letters, numbers, dash</span>}
                  </span>
                </div>
                <input className="inp" placeholder="Owner name *" value={f.owner_name} onChange={e => setF({ ...f, owner_name: e.target.value })} required />
                <input className="inp" type="email" placeholder="Owner email * (login)" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} required />
                <input className="inp" type="password" placeholder="Password * (8+ characters)" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} required />
                <button className="btn primary" disabled={busy || (f.slug.length >= 2 && !slugOk)}>{busy ? 'Creating…' : 'Start free trial →'}</button>
              </form>
            </>
          )}
        </div>
      </section>
    </div>
  )
}

// ---------- Platform admin: all gyms ----------
export function PlatformPanel({ user }) {
  const [gyms, setGyms] = useState([])
  const [err, setErr] = useState('')
  const [busyId, setBusyId] = useState(null)

  const load = () => get('/platform/gyms').then(setGyms).catch(e => setErr(e.message))
  React.useEffect(() => { load() }, [])

  const setStatus = async (g, status) => {
    setBusyId(g.id)
    try { await put('/platform/gyms/' + g.id + '/status', { status }); load() }
    catch (e) { alert(e.message) } finally { setBusyId(null) }
  }
  const markPaid = async (g) => {
    const m = window.prompt('Paid for how many months? (e.g. 1, 3, 12)')
    const months = Number(m)
    if (!months || months < 1) return
    setBusyId(g.id)
    try { await post('/platform/gyms/' + g.id + '/mark-paid', { months }); load() }
    catch (e) { alert(e.message) } finally { setBusyId(null) }
  }
  // sends the gym owner a Razorpay subscription link for the platform fee;
  // every future charge automatically extends the gym's paid period
  const autoFee = async (g) => {
    const c = window.prompt('Create a platform-fee subscription (monthly, auto-collected).\nHow many monthly cycles? (e.g. 12)')
    const cycles = Number(c)
    if (!cycles || cycles < 1) return
    setBusyId(g.id)
    try {
      const r = await post('/platform/gyms/' + g.id + '/subscription', { cycles })
      const due = `Subscription ${r.subscription_id} created (${r.status}).\nRazorpay has been asked to email the owner the payment link.`
      window.alert(r.short_url ? due + '\n\nAlso open: ' + r.short_url : due)
      load()
    } catch (e) { alert(e.message) } finally { setBusyId(null) }
  }

  const stateOf = (g) => {
    if (g.status === 'suspended') return ['Suspended', '#d93025']
    if (g.status === 'trial') {
      const t = g.trial_ends_at ? new Date(g.trial_ends_at) : null
      return (t && t > new Date()) ? ['Trial', '#1e8e3e'] : ['Trial ended', '#f29900']
    }
    const p = g.paid_until ? new Date(g.paid_until) : null
    return (p && p > new Date()) ? ['Paid', '#1e8e3e'] : ['Payment due', '#f29900']
  }

  return (
    <div className="af-site" style={{ minHeight: '100vh' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 4%' }}>
        <b>GymFit Platform — Admin</b>
        <span className="muted small">{user.email}</span>
      </header>
      <div style={{ padding: '0 4% 40px' }}>
        {err && <p className="error">{err}</p>}
        <div className="panel">
          <h3>All gyms</h3>
          <table className="tbl">
            <thead><tr><th>Gym</th><th>Address</th><th>Members</th><th>Revenue</th><th>State</th><th>Trial / Paid till</th><th>Actions</th></tr></thead>
            <tbody>
              {gyms.map(g => {
                const [st, col] = stateOf(g)
                return (
                  <tr key={g.id}>
                    <td><b>{g.name}</b></td>
                    <td>{g.slug}</td>
                    <td>{g.members}</td>
                    <td>₹{Number(g.revenue || 0).toLocaleString('en-IN')}</td>
                    <td style={{ color: col, fontWeight: 600 }}>{st}</td>
                    <td className="small muted">
                      {g.status === 'trial' ? (g.trial_ends_at ? new Date(g.trial_ends_at).toLocaleDateString('en-IN') : '—')
                        : (g.paid_until ? new Date(g.paid_until).toLocaleDateString('en-IN') : '—')}
                      {g.subscription_status && <div>fee: {g.subscription_status}</div>}
                    </td>
                    <td>
                      <span className="row" style={{ gap: 6 }}>
                        {g.status !== 'suspended'
                          ? <button className="btn ghost sm" disabled={busyId === g.id} onClick={() => setStatus(g, 'suspended')}>Suspend</button>
                          : <button className="btn primary sm" disabled={busyId === g.id} onClick={() => setStatus(g, 'active')}>Activate</button>}
                        <button className="btn primary sm" disabled={busyId === g.id} onClick={() => markPaid(g)}>Mark paid</button>
                        <button className="btn ghost sm" title="Monthly platform fee via Razorpay" disabled={busyId === g.id} onClick={() => autoFee(g)}>Auto-fee</button>
                      </span>
                    </td>
                  </tr>
                )
              })}
              {!gyms.length && <tr><td colSpan="7" className="muted">Loading or no gyms yet…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}