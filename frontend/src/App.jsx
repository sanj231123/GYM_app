import React, { useEffect, useState } from 'react'
import { setToken, getToken, login, register, me, changePassword, get, post, put, del } from './api'

// ---------- chhote help ----------
const today = () => {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}
const fmt = (d) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN') : '—')
const rupee = (n) => '₹' + Number(n).toLocaleString('en-IN')

function statusOf(exp) {
  if (!exp) return ['off', 'Plan nahi']
  const t = new Date(exp + 'T00:00:00')
  const now = new Date(today() + 'T00:00:00')
  const days = Math.round((t - now) / 86400000)
  if (days < 0) return ['bad', `Expired (-${-days} din)`]
  if (days <= 7) return ['warn', `${days} din bache`]
  return ['ok', 'Active']
}

// ---------- App ----------
export default function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(!!getToken())

  useEffect(() => {
    if (!getToken()) return setLoading(false)
    me().then(setUser).catch(() => setToken('')).finally(() => setLoading(false))
  }, [])

  const onLogout = () => { setToken(''); setUser(null) }
  const changePwd = async () => {
    const p = window.prompt('Naya password (kam se kam 6 letter)')
    if (!p) return
    try { await changePassword(p); alert('Password badal diya ✅') } catch (e) { alert(e.message) }
  }

  if (loading) return <div className="center">Loading…</div>
  if (!user) return <Auth onLogin={setUser} />
  return user.role === 'admin'
    ? <AdminPanel user={user} onLogout={onLogout} onChangePwd={changePwd} />
    : <MemberHome user={user} onLogout={onLogout} onChangePwd={changePwd} />
}

// ---------- Login / Register ----------
function Auth({ onLogin }) {
  const [mode, setMode] = useState('login')
  const [f, setF] = useState({ name: '', email: '', phone: '', password: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setErr(''); setBusy(true)
    try {
      const r = mode === 'login'
        ? await login(f.email, f.password)
        : await register({ name: f.name, email: f.email, phone: f.phone, password: f.password })
      setToken(r.token); onLogin(r.user)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1 className="logo">🏋️ Jaini Fitness Center</h1>
        <p className="muted">Gym Management System</p>
        <div className="auth-tabs">
          <button className={mode === 'login' ? 'tab active' : 'tab'} onClick={() => setMode('login')}>Login</button>
          <button className={mode === 'register' ? 'tab active' : 'tab'} onClick={() => setMode('register')}>Naya Member</button>
        </div>
        {err && <p className="error">{err}</p>}
        <form onSubmit={submit} className="form">
          {mode === 'register' && (
            <>
              <input className="inp" placeholder="Poora naam" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
              <input className="inp" placeholder="Phone (optional)" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} />
            </>
          )}
          <input className="inp" type="email" placeholder="Email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />
          <input className="inp" type="password" placeholder="Password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} />
          <button className="btn primary" disabled={busy}>{mode === 'login' ? 'Login karo' : 'Account banao'}</button>
        </form>
        <p className="hint">Admin demo: admin@gym.com / admin123</p>
      </div>
    </div>
  )
}

// ---------- Admin panel ----------
const TABS = ['Dashboard', 'Members', 'Payments', 'Plans', 'Trainers']

function AdminPanel({ user, onLogout, onChangePwd }) {
  const [tab, setTab] = useState('Dashboard')
  return (
    <div>
      <header className="topbar">
        <h1 className="logo-sm">💪 Jaini Fitness Center — Admin</h1>
        <div className="grow" />
        <span className="muted">{user.name}</span>
        <button className="btn ghost" onClick={onChangePwd}>Password</button>
        <button className="btn ghost" onClick={onLogout}>Logout</button>
      </header>
      <nav className="tabs">
        {TABS.map(t => (
          <button key={t} className={t === tab ? 'tab active' : 'tab'} onClick={() => setTab(t)}>{t}</button>
        ))}
      </nav>
      <main className="content">
        {tab === 'Dashboard' && <Dashboard />}
        {tab === 'Members' && <Members />}
        {tab === 'Payments' && <Payments />}
        {tab === 'Plans' && <Plans />}
        {tab === 'Trainers' && <Trainers />}
      </main>
    </div>
  )
}

function Dashboard() {
  const [r, setR] = useState(null)
  useEffect(() => { get('/reports/summary').then(setR).catch(e => alert(e.message)) }, [])
  if (!r) return <p className="muted">Loading…</p>
  const cards = [
    ['Total Members', r.total, 'blue'], ['Active', r.active, 'ok'],
    ['Expiring (7 din)', r.expiring, 'warn'], ['Expired', r.expired, 'bad'],
    ['Is Month ki Income', rupee(r.month_income), 'blue'], ['Aaj ke Check-in', r.today_attendance, 'ok'],
  ]
  return (
    <div className="cards">
      {cards.map(([label, val, cls], i) => (
        <div key={i} className={'card ' + cls}><div className="card-val">{val}</div><div className="card-label">{label}</div></div>
      ))}
    </div>
  )
}

function Members() {
  const blank = { name: '', email: '', phone: '', password: '', plan_id: '', trainer_id: '', expiry_date: '' }
  const [list, setList] = useState([])
  const [f, setF] = useState(blank)
  const [editId, setEditId] = useState(null)
  const [search, setSearch] = useState('')
  const [plans, setPlans] = useState([])
  const [trainers, setTrainers] = useState([])
  const [showForm, setShowForm] = useState(false)

  const load = () => get('/members?search=' + encodeURIComponent(search)).then(setList).catch(e => alert(e.message))
  useEffect(() => { load(); get('/plans').then(setPlans); get('/trainers').then(setTrainers) }, [])
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t) }, [search])

  const save = async (e) => {
    e.preventDefault()
    try {
      const body = {
        name: f.name, email: f.email || '', phone: f.phone || '',
        plan_id: f.plan_id || null, trainer_id: f.trainer_id || null,
        expiry_date: f.expiry_date || '',
      }
      if (editId) {
        await put('/members/' + editId, body)
        if (f.password) await put('/members/' + editId + '/password', { password: f.password })
      } else {
        body.password = f.password || 'gym123'
        await post('/members', body)
      }
      setF(blank); setEditId(null); setShowForm(false); load()
    } catch (e) { alert(e.message) }
  }

  const edit = (m) => {
    setEditId(m.id)
    setF({
      name: m.name || '', email: m.email || '', phone: m.phone || '', password: '',
      plan_id: m.plan_id || '', trainer_id: m.trainer_id || '', expiry_date: m.expiry_date || '',
    })
    setShowForm(true)
    window.scrollTo(0, 0)
  }

  const remove = async (m) => {
    if (!window.confirm(`${m.name} ko delete karein?`)) return
    try { await del('/members/' + m.id); load() } catch (e) { alert(e.message) }
  }

  return (
    <div>
      <div className="row">
        <input className="inp w-search" placeholder="Naam / phone / email se dhoondo…" value={search} onChange={e => setSearch(e.target.value)} />
        <button className="btn primary" onClick={() => { setF(blank); setEditId(null); setShowForm(!showForm) }}>
          {showForm && !editId ? 'Band karo' : '+ Naya Member'}
        </button>
      </div>

      {showForm && (
        <form className="panel form" onSubmit={save}>
          <h3>{editId ? 'Member edit karo' : 'Naya Member'}</h3>
          <div className="grid2">
            <input className="inp" placeholder="Naam *" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required />
            <input className="inp" placeholder="Phone" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} />
            <input className="inp" placeholder="Email (login ke liye)" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />
            <input className="inp" placeholder={editId ? 'Naya password (khaali rahe to change nahi)' : 'Password (default: gym123)'} value={f.password} onChange={e => setF({ ...f, password: e.target.value })} />
            <select className="inp" value={f.plan_id} onChange={e => setF({ ...f, plan_id: e.target.value })}>
              <option value="">Plan choose karo</option>
              {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select className="inp" value={f.trainer_id} onChange={e => setF({ ...f, trainer_id: e.target.value })}>
              <option value="">Trainer (optional)</option>
              {trainers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <input className="inp" type="date" value={f.expiry_date || ''} onChange={e => setF({ ...f, expiry_date: e.target.value })} title="Expiry (khali rahe to plan ke hisaab se auto)" />
          </div>
          <div className="row">
            <button className="btn primary" type="submit">{editId ? 'Update karo' : 'Add karo'}</button>
            <button className="btn ghost" type="button" onClick={() => { setF(blank); setEditId(null); setShowForm(false) }}>Cancel</button>
          </div>
        </form>
      )}

      <table className="tbl">
        <thead><tr><th>Naam</th><th>Phone</th><th>Plan</th><th>Trainer</th><th>Expiry</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          {list.map(m => {
            const [cls, label] = statusOf(m.expiry_date)
            return (
              <tr key={m.id}>
                <td>{m.name}<div className="muted small">{m.email || ''}</div></td>
                <td>{m.phone || '—'}</td>
                <td>{m.plan_name || '—'}</td>
                <td>{m.trainer_name || '—'}</td>
                <td>{fmt(m.expiry_date)}</td>
                <td><span className={'chip ' + cls}>{label}</span></td>
                <td>
                  <button className="btn sm" onClick={() => edit(m)}>Edit</button>{' '}
                  <button className="btn sm danger" onClick={() => remove(m)}>Delete</button>
                </td>
              </tr>
            )
          })}
          {!list.length && <tr><td colSpan="7" className="muted">Koi member nahi. Pehla add karo.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

function Payments() {
  const [list, setList] = useState([])
  const [members, setMembers] = useState([])
  const [f, setF] = useState({ user_id: '', amount: '', method: 'cash', note: '', extend: true })

  const load = () => { get('/payments').then(setList).catch(e => alert(e.message)); get('/members').then(setMembers) }
  useEffect(load, [])

  const save = async (e) => {
    e.preventDefault()
    try { await post('/payments', { ...f, user_id: Number(f.user_id), amount: Number(f.amount) }); setF({ ...f, amount: '', note: '' }); load() }
    catch (e2) { alert(e2.message) }
  }
  const remove = async (id) => { if (window.confirm('Delete?')) { try { await del('/payments/' + id); load() } catch (e) { alert(e.message) } } }

  return (
    <div>
      <form className="panel form" onSubmit={save}>
        <h3>Payment add karo</h3>
        <div className="grid2">
          <select className="inp" value={f.user_id} onChange={e => {
            const m = members.find(x => x.id == e.target.value)
            setF({ ...f, user_id: e.target.value, amount: m && m.plan_id ? (m.amount || f.amount) : f.amount })
          }} required>
            <option value="">Member choose karo</option>
            {members.map(m => <option key={m.id} value={m.id}>{m.name} {m.phone ? '(' + m.phone + ')' : ''}</option>)}
          </select>
          <input className="inp" type="number" placeholder="Amount ₹" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} required />
          <select className="inp" value={f.method} onChange={e => setF({ ...f, method: e.target.value })}>
            <option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option>
          </select>
          <input className="inp" placeholder="Note (optional)" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} />
        </div>
        <label className="check"><input type="checkbox" checked={f.extend} onChange={e => setF({ ...f, extend: e.target.checked })} /> Plan renew karein (expiry extend hogi)</label>
        <button className="btn primary" type="submit">Add karo</button>
      </form>

      <table className="tbl">
        <thead><tr><th>Member</th><th>Amount</th><th>Method</th><th>Note</th><th>Date</th><th></th></tr></thead>
        <tbody>
          {list.map((p) => (
            <tr key={p.id}>
              <td>{p.member_name}</td>
              <td>{rupee(p.amount)}</td>
              <td>{p.method}</td>
              <td>{p.note || '—'}</td>
              <td>{fmt(p.paid_on)}</td>
              <td><button className="btn sm danger" onClick={() => remove(p.id)}>✕</button></td>
            </tr>
          ))}
          {!list.length && <tr><td colSpan="6" className="muted">Koi payment nahi.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

function Plans() {
  const [list, setList] = useState([])
  const [f, setF] = useState({ name: '', duration_days: '', price: '' })
  const load = () => get('/plans').then(setList).catch(e => alert(e.message))
  useEffect(load, [])
  const save = async (e) => {
    e.preventDefault()
    try { await post('/plans', { ...f, duration_days: Number(f.duration_days), price: Number(f.price) }); setF({ name: '', duration_days: '', price: '' }); load() }
    catch (e2) { alert(e2.message) }
  }
  const remove = async (id) => { if (window.confirm('Plan delete?')) { try { await del('/plans/' + id); load() } catch (e) { alert(e.message) } } }
  return (
    <div>
      <form className="panel form" onSubmit={save}>
        <h3>Naya plan</h3>
        <div className="grid3">
          <input className="inp" placeholder="Plan ka naam" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required />
          <input className="inp" type="number" placeholder="Kitne din ke liye (jaise 30)" value={f.duration_days} onChange={e => setF({ ...f, duration_days: e.target.value })} required />
          <input className="inp" type="number" placeholder="Price ₹" value={f.price} onChange={e => setF({ ...f, price: e.target.value })} required />
        </div>
        <button className="btn primary" type="submit">Add karo</button>
      </form>
      <table className="tbl">
        <thead><tr><th>Naam</th><th>Din</th><th>Price</th><th></th></tr></thead>
        <tbody>
          {list.map(p => <tr key={p.id}><td>{p.name}</td><td>{p.duration_days}</td><td>{rupee(p.price)}</td><td><button className="btn sm danger" onClick={() => remove(p.id)}>✕</button></td></tr>)}
          {!list.length && <tr><td colSpan="4" className="muted">Koi plan nahi.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

function Trainers() {
  const [list, setList] = useState([])
  const [f, setF] = useState({ name: '', phone: '', specialty: '' })
  const load = () => get('/trainers').then(setList).catch(e => alert(e.message))
  useEffect(load, [])
  const save = async (e) => {
    e.preventDefault()
    try { await post('/trainers', f); setF({ name: '', phone: '', specialty: '' }); load() }
    catch (e2) { alert(e2.message) }
  }
  const remove = async (id) => { if (window.confirm('Trainer delete?')) { try { await del('/trainers/' + id); load() } catch (e) { alert(e.message) } } }
  return (
    <div>
      <form className="panel form" onSubmit={save}>
        <h3>Naya trainer</h3>
        <div className="grid2">
          <input className="inp" placeholder="Naam" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required />
          <input className="inp" placeholder="Phone" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} />
          <input className="inp" placeholder="Khaas baat (jaise weight, yoga)" value={f.specialty} onChange={e => setF({ ...f, specialty: e.target.value })} />
        </div>
        <button className="btn primary" type="submit">Add karo</button>
      </form>
      <table className="tbl">
        <thead><tr><th>Naam</th><th>Phone</th><th>Khaas baat</th><th></th></tr></thead>
        <tbody>
          {list.map(t => <tr key={t.id}><td>{t.name}</td><td>{t.phone || '—'}</td><td>{t.specialty || '—'}</td><td><button className="btn sm danger" onClick={() => remove(t.id)}>✕</button></td></tr>)}
          {!list.length && <tr><td colSpan="4" className="muted">Koi trainer nahi.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

// ---------- Member home ----------
function MemberHome({ user, onLogout, onChangePwd }) {
  const [d, setD] = useState(null)
  const load = () => get('/me/detail').then(setD).catch(e => alert(e.message))
  useEffect(load, [])

  if (!d) return <p className="muted">Loading…</p>
  const [cls, label] = statusOf(d.expiry_date)

  const checkin = async () => {
    try { await post('/attendance', {}); load() } catch (e) { alert(e.message) }
  }

  return (
    <div>
      <header className="topbar">
        <h1 className="logo-sm">💪 Jaini Fitness Center</h1>
        <div className="grow" />
        <span className="muted">Hi {d.name}</span>
        <button className="btn ghost" onClick={onChangePwd}>Password</button>
        <button className="btn ghost" onClick={onLogout}>Logout</button>
      </header>
      <main className="content">
        <div className="panel">
          <div className="row space">
            <div>
              <h2>{d.name}</h2>
              <p className="muted">{d.email || '—'} · {d.phone || '—'}</p>
              <p>Plan: <b>{d.plan_name || 'Nahi hai'}</b> · Trainer: <b>{d.trainer_name || '—'}</b></p>
              <p>Join: <b>{fmt(d.join_date)}</b> · Expiry: <b>{fmt(d.expiry_date)}</b> <span className={'chip ' + cls}>{label}</span></p>
            </div>
            <div className="checkin">
              <button className="btn primary big" onClick={checkin} disabled={d.checked_today > 0}>
                {d.checked_today ? '✓ Aaj check-in ho gaya' : 'Aaj ka Check-in'}
              </button>
            </div>
          </div>
        </div>

        <div className="col2">
          <div className="panel">
            <h3>Mere Payments</h3>
            <table className="tbl">
              <thead><tr><th>Amount</th><th>Method</th><th>Date</th></tr></thead>
              <tbody>
                {d.payments.map(p => <tr key={p.id}><td>{rupee(p.amount)}</td><td>{p.method}</td><td>{fmt(p.paid_on)}</td></tr>)}
                {!d.payments.length && <tr><td colSpan="3" className="muted">Kuch nahi.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="panel">
            <h3>Last 10 Check-in</h3>
            <ul className="list">
              {d.attendance.map(a => <li key={a.id}>{new Date(a.checkin_at).toLocaleString('en-IN')}</li>)}
              {!d.attendance.length && <li className="muted">Kuch nahi.</li>}
            </ul>
          </div>
        </div>
      </main>
    </div>
  )
}