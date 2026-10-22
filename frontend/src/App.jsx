import React, { useEffect, useState } from 'react'
import { login, register, logout, me, changePassword, forgotPassword, resetPassword, get, post, put, del } from './api'
import { PlatformPage, PlatformPanel } from './Platform'
import { TenantProvider, useGym } from './tenant'

// shows a friendly page on any render crash instead of a blank white screen
class AppBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null } }
  static getDerivedStateFromError(e) { return { err: (e && e.message) || 'Unexpected error' } }
  render() {
    if (this.state.err) {
      return (
        <div className="af-site" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
          <div className="panel" style={{ maxWidth: 480, textAlign: 'center' }}>
            <h3>Something went wrong</h3>
            <p className="muted">{this.state.err}</p>
            <button className="btn primary" onClick={() => location.reload()}>Reload</button>
          </div>
        </div>
      )
    }
    return this.props.children || null
  }
}

// ---------- small helpers ----------
const today = () => {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}
const fmt = (d) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN') : '—')
const rupee = (n) => '₹' + Number(n).toLocaleString('en-IN')

function statusOf(exp) {
  if (!exp) return ['off', 'No plan']
  const t = new Date(exp + 'T00:00:00')
  const now = new Date(today() + 'T00:00:00')
  const days = Math.round((t - now) / 86400000)
  if (days < 0) return ['bad', `Expired (${Math.abs(days)} days ago)`]
  if (days <= 7) return ['warn', `Ends in ${days} days`]
  return ['ok', 'Active']
}

// ---------- App ----------
export default function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const joinNow = (() => {
    try { return new URLSearchParams(location.search).get('page') === 'join' } catch { return false }
  })()

  useEffect(() => {
    me().then(setUser).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const onLogout = () => { logout().catch(() => {}); setUser(null) }
  const changePwd = async () => {
    const p = window.prompt('New password (min 8 characters)')
    if (!p || p.length < 8) { if (p) alert('Password must be at least 8 characters'); return }
    try { await changePassword(p); alert('Password changed ✅') } catch (e) { alert(e.message) }
  }

  let view
  const path = typeof location !== 'undefined' ? location.pathname : '/'
  if (joinNow) view = <JoinPage />
  else if (path.startsWith('/register')) view = <PlatformPage />
  else if (path.startsWith('/platform-admin')) view = user
    ? (user.role === 'platform_admin' ? <PlatformPanel user={user} /> : <div className="center panel" style={{ margin: 60 }}>Only the platform owner can open this page.</div>)
    : <Auth onLogin={setUser} />
  else if (loading) view = <div className="center">Loading…</div>
  else if (!user) view = <Auth onLogin={setUser} />
  else view = user.role === 'platform_admin'
    ? <PlatformPanel user={user} />
    : user.role === 'admin'
    ? <AdminPanel user={user} onLogout={onLogout} onChangePwd={changePwd} />
    : <MemberHome user={user} onLogout={onLogout} onChangePwd={changePwd} />
  return <AppBoundary><TenantProvider>{view}</TenantProvider></AppBoundary>
}

// ---------- Site-wide navbar (shared by login page and member home) ----------

const BLOG = [
  { title: 'Beginner mistakes that slow down progress', date: '12 Oct', img: '/bg-members.jpg', text: 'Most new lifters skip warm-ups and chase heavy numbers too early. Here is what to fix in your first month.' },
  { title: '5 protein-rich Desi meals for gym days', date: '5 Oct', img: '/banner.jpg', text: 'Paneer, sprouts, curd and more — simple Indian meals that keep your protein up without boring you.' },
  { title: 'Why rest days build more muscle', date: '28 Sep', img: '/bg-trainers.jpg', text: 'Recovery is training too. Learn how sleep and rest days turn your hard work into real results.' },
]

const SLIDES = ['/girl-a.jpg', '/girl-b.jpg', '/hero.jpg', '/bg-trainers.jpg']

// brand logo — the gym's own image if uploaded, else the initials badge
function BrandMark() {
  const g = useGym()
  if (g.logo) return <img className="af-badge" src={g.logo} alt={g.name} style={{ objectFit: 'cover' }} />
  return <span className="af-badge">{g.logoText || 'G'}</span>
}

function SiteNav({ user, onLogout, onChangePwd }) {
  const g = useGym()
  const brand = (g.name || '').trim().split(/\s+/).slice(0, 2).join(' ').toUpperCase() || 'OUR GYM'
  const onJoin = (() => { try { return new URLSearchParams(location.search).get('page') === 'join' } catch { return false } })()
  const go = (id) => (e) => { e.preventDefault(); const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: 'smooth' }) }
  const home = (e) => { e.preventDefault(); if (onJoin) location.href = '/'; else document.getElementById('top').scrollIntoView({ behavior: 'smooth' }) }
  return (
    <header className="af-nav">
      <a className="af-brand" href="/" onClick={home}><BrandMark /> {brand}</a>
      <nav className="af-links">
        <a href="#top" onClick={home}>Home</a>
        <a href="#plans" onClick={go('plans')}>Membership</a>
        <a href="#trainers" onClick={go('trainers')}>Training</a>
        <a href="#blog" onClick={go('blog')}>Blog</a>
        <a href="#contact" onClick={go('contact')}>Contact</a>
      </nav>
      <div className="grow" />
      {user ? (
        <div className="af-user">
          <span>Hi {user.name}</span>
          <button className="btn ghost" onClick={onChangePwd}>Password</button>
          <button className="btn ghost" onClick={onLogout}>Logout</button>
        </div>
      ) : (
        <a className="af-cta" href={JOIN_URL} onClick={e => { e.preventDefault(); location.href = JOIN_URL }}>MEMBERSHIP INQUIRY</a>
      )}
    </header>
  )
}

function Slider({ images = SLIDES, ms = 4500, children }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (images.length < 2) return
    const t = setInterval(() => setI(v => (v + 1) % images.length), ms)
    return () => clearInterval(t)
  }, [images.length, ms])
  return (
    <div className="slider">
      {images.map((s, k) => <div key={k} className="slide" style={{ backgroundImage: 'url(' + s + ')', opacity: k === i ? 1 : 0 }} />)}
      {children}
    </div>
  )
}

function SectionWrap({ id, kicker, title, children }) {
  return (
    <section id={id} className="sec">
      <span className="sec-kicker">{kicker}</span>
      <h2 className="sec-title">{title}</h2>
      {children}
    </section>
  )
}

function PlansPublic({ hideCTA }) {
  const [list, setList] = useState([])
  useEffect(() => { get('/plans').then(setList).catch(() => {}) }, [])
  return (
    <SectionWrap id="plans" kicker="JUMP TO" title="Membership Plans">
      <div className="grid3">
        {list.map(p => (
          <div key={p.id} className="plan-card">
            <h3>{p.name}</h3>
            <div className="plan-price">{rupee(p.price)}</div>
            <p className="muted">{p.duration_days} days membership</p>
            <ul className="plan-feat"><li>Full gym access</li><li>Locker facility</li><li>Trainer support</li></ul>
            {!hideCTA && (
              <button className="btn primary plan-btn" onClick={() => { location.href = JOIN_URL + '&plan=' + p.id }}>Enroll Now</button>
            )}
          </div>
        ))}
      </div>
    </SectionWrap>
  )
}

// three blocks side by side: why join | trainers + join | blog + map
function ComboRow() {
  const g = useGym()
  const [list, setList] = useState([])
  const [post, setPost] = useState(null)
  useEffect(() => { get('/trainers').then(setList).catch(() => {}) }, [])
  return (
    <section className="combo-band">
      <div className="combo-grid">
        <div className="combo-col combo-photo-col">
          <img className="combo-photo" src="/why-join.jpg" alt="Member training at the gym" />
        </div>
        <div className="combo-col">
          <span className="sec-kicker light">WHY JOIN US</span>
          <h2 className="sec-title">Everything you need to get strong</h2>
          <ul className="why-mini-list">
            <li>Modern strength &amp; cardio equipment</li>
            <li>Personal trainers for every level</li>
            <li>Nutrition and routine guidance</li>
            <li>Open daily — flexible morning to night</li>
          </ul>
          <div className="combo-stats">
            <span><b>{g.logoText}</b><i>{(g.name || '').toUpperCase()}</i></span>
            <span><b>12+</b><i>PROFESSIONAL TRAINERS</i></span>
            <span><b>7 Days</b><i>OPEN EVERY WEEK</i></span>
          </div>
        </div>
        <div id="trainers" className="combo-col">
          <span className="sec-kicker light">OUR TEAM</span>
          <h2 className="sec-title">Meet the Trainers</h2>
          {list.length ? list.map(t => (
            <div key={t.id} className="trainer-mini">
              <div className="bfall-sm">{t.name ? t.name[0] : '?'}</div>
              <div><b>{t.name}</b>{t.specialty && <span className="muted small"> · {t.specialty}</span>}{t.phone && <div className="muted small">{t.phone}</div>}</div>
            </div>
          )) : <p className="muted">Trainers coming soon.</p>}
          <div className="combo-join">
            <h3>Ready to Start?</h3>
            <p className="muted small">Pick a plan, pay online or at the gym.</p>
            <button className="af-cta" onClick={() => { location.href = JOIN_URL }}>MEMBERSHIP INQUIRY</button>
          </div>
        </div>
        <div id="blog" className="combo-col">
          <span className="sec-kicker light">NEWS &amp; TIPS</span>
          <h2 className="sec-title">From the Blog</h2>
          {BLOG.map((b, k) => (
            <div key={k} className="blog-mini blog-click" role="button" onClick={() => setPost(b)}>
              <img src={b.img} alt="" />
              <div><span className="muted small">{b.date}</span><b>{b.title}</b><p className="muted small">{b.text.slice(0, 80)}…</p></div>
            </div>
          ))}
        </div>
        <div className="combo-col">
          <span className="sec-kicker light">MAP</span>
          <h2 className="sec-title">Find Us</h2>
          {(g.map_url || g.address) && (
            <div className="map-wrap" style={{ margin: 0, height: 380 }}>
              <iframe
                title={(g.name || 'Our gym') + ' map'}
                src={g.map_url || ('https://www.google.com/maps?q=' + encodeURIComponent((g.name ? g.name + ', ' : '') + g.address) + '&output=embed')}
                loading="lazy"
              />
            </div>
          )}
          {(g.address || g.phone) && (
            <p className="muted small" style={{ marginTop: 10 }}>{g.address}{g.address && g.phone ? <><br /></> : null}{g.phone}</p>
          )}
        </div>
      </div>
      {post && (
        <div className="blog-modal" onClick={() => setPost(null)}>
          <div className="blog-modal-card" onClick={e => e.stopPropagation()}>
            <button className="blog-modal-x" onClick={() => setPost(null)} aria-label="Close">×</button>
            <img src={post.img} alt="" />
            <span className="sec-kicker">{post.date}</span>
            <h2>{post.title}</h2>
            <p>{post.text}</p>
          </div>
        </div>
      )}
    </section>
  )
}

// social logos (Instagram / YouTube / X / Facebook)
const SOC_ICONS = {
  instagram: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="5.5" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.4" cy="6.6" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  ),
  youtube: (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor">
      <rect x="1.5" y="4.5" width="21" height="15" rx="4.5" />
      <path d="M10 8.75v6.5l6-3.25z" fill="#fff" stroke="none" />
    </svg>
  ),
  twitter: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.24 2.25h3.3l-7.22 8.26 8.5 11.24h-6.66l-5.21-6.82-5.97 6.82H1.67l7.73-8.84L1.25 2.25h6.83l4.71 6.23z" />
    </svg>
  ),
  facebook: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.77 7.46h-4.27v-1.9c0-.9.6-1.1 1-1.1h2.77V1.5h-4.33c-3.5 0-4.44 2.54-4.44 4.4v1.56H6.5v4h3v10.54h5V11.46h3.27l.5-4z" />
    </svg>
  ),
}
function Soc({ kind }) {
  const href = { instagram: 'https://www.instagram.com/', youtube: 'https://www.youtube.com/', twitter: 'https://x.com/', facebook: 'https://www.facebook.com/' }[kind]
  return <a className="soc" href={href} target="_blank" rel="noreferrer" aria-label={kind}>{SOC_ICONS[kind]}</a>
}

// ---------- join flow page (opens in its own tab, opened from inquiry/enroll) ----------
const JOIN_URL = '/?page=join'

function JoinPage() {
  const g = useGym()
  const [user, setUser] = useState(null)
  useEffect(() => {
    me().then(setUser).catch(() => {})
  }, [])
  const prePlan = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('plan') : null
  const [plans, setPlans] = useState([])
  const [step, setStep] = useState(1)
  const [inqId, setInqId] = useState(null)
  const [f, setF] = useState({ first_name: '', last_name: '', email: '', phone: '', pin_code: '' })
  const [planId, setPlanId] = useState(prePlan || '')
  const [payMode, setPayMode] = useState('gym')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { get('/plans').then(setPlans).catch(() => {}) }, [])

  const submitDetails = async (e) => {
    e.preventDefault()
    setErr(''); setBusy(true)
    try {
      const r = await post('/inquiries', f)
      setInqId(r.id); setStep(2)
    } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }

  const loadRazorpay = () => new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve()
    const s = document.createElement('script')
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'
    s.onload = resolve
    s.onerror = () => reject(new Error('Could not load Razorpay checkout'))
    document.body.appendChild(s)
  })

  const confirm = async () => {
    if (!inqId || !planId) return
    setErr(''); setBusy(true)
    try {
      if (payMode === 'online') {
        await put('/inquiries/' + inqId, { plan_id: Number(planId), pay_mode: 'online' })
        const o = await post('/razorpay/order', { plan_id: Number(planId), inquiry_id: inqId })
        await loadRazorpay()
        setBusy(false)
        new window.Razorpay({
          key: o.key_id,
          amount: o.amount,
          currency: 'INR',
          name: g.name || 'Our Gym',
          description: o.plan ? o.plan.name : 'Membership',
          order_id: o.order_id,
          prefill: { name: (f.first_name + ' ' + f.last_name).trim(), email: f.email, contact: f.phone },
          theme: { color: g.primary_color || '#7c3aed' },
          handler: (d) => {
            post('/razorpay/verify', { order_id: d.razorpay_order_id, payment_id: d.razorpay_payment_id, signature: d.razorpay_signature, inquiry_id: inqId })
              .then(() => setStep(3))
              .catch(e2 => setErr(e2.message))
          },
        }).open()
        return
      }
      await put('/inquiries/' + inqId, { plan_id: Number(planId), pay_mode: payMode })
      setStep(3)
    } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }

  const chosen = plans.find(p => String(p.id) === String(planId))

  return (
    <div className="af-site">
      <SiteNav user={user} onLogout={() => { logout().catch(() => {}); setUser(null) }} />
      <section id="top" className="sec join-top">
        <span className="sec-kicker">{g.name ? ('JOIN ' + g.name.toUpperCase()) : 'JOIN US'}</span>
        <h2 className="sec-title">Membership Inquiry</h2>
        <div className="join-steps" style={{ display: 'flex', gap: 10 }}>
          {['Your Details', 'Choose Plan', 'Payment'].map((s, k) => (
            <span key={k} className={k + 1 <= step ? 'jstep active' : 'jstep'}>{k + 1}. {s}</span>
          ))}
        </div>

        {err && <p className="error">{err}</p>}

        {step === 1 && (
          <form className="inq-card form inq-form" onSubmit={submitDetails}>
            <p className="af-addr">{g.address}<br />{g.phone}</p>
            <div className="grid2">
              <input className="inp" placeholder="First Name *" value={f.first_name} onChange={e => setF({ ...f, first_name: e.target.value })} required />
              <input className="inp" placeholder="Last Name" value={f.last_name} onChange={e => setF({ ...f, last_name: e.target.value })} />
            </div>
            <input className="inp" type="email" placeholder="Email *" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} required />
            <input className="inp" type="tel" placeholder="Mobile Phone *" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} required />
            <input className="inp" placeholder="PIN code" value={f.pin_code} onChange={e => setF({ ...f, pin_code: e.target.value })} />
            <p className="muted small inq-consent">By submitting your contact details, you consent to receive communication from {g.name} via phone calls, SMS, WhatsApp, and email regarding memberships and offers. You may opt out at any time.</p>
            <button className="af-cta" type="submit" disabled={busy}>{busy ? 'Submitting…' : 'VIEW MEMBERSHIP OPTIONS'}</button>
          </form>
        )}

        {step === 2 && (
          <div>
            <div className="grid3">
              {plans.map(p => (
                <div key={p.id} className={'plan-card' + (String(p.id) === String(planId) ? ' selected' : '')} onClick={() => setPlanId(p.id)} role="button">
                  <h3>{p.name}</h3>
                  <div className="plan-price">{rupee(p.price)}</div>
                  <p className="muted">{p.duration_days} days membership</p>
                  <ul className="plan-feat"><li>Full gym access</li><li>Locker facility</li><li>Trainer support</li></ul>
                  <span className="chip">{String(p.id) === String(planId) ? 'Selected ✓' : 'Tap to select'}</span>
                </div>
              ))}
            </div>
            <h3 className="pay-head">Payment</h3>
            <div className="pay-opts">
              <label className="pay-opt">
                <input type="radio" name="paymode" checked={payMode === 'online'} onChange={() => setPayMode('online')} />
                <span><b>Pay online (Razorpay)</b><span className="muted small">UPI / Cards / Netbanking — instant plan confirmation</span></span>
              </label>
              <label className="pay-opt">
                <input type="radio" name="paymode" checked={payMode === 'gym'} onChange={() => setPayMode('gym')} />
                <span><b>Pay at the gym</b><span className="muted small">Cash / UPI / Card at the reception counter</span></span>
              </label>
            </div>
            <div className="row" style={{ marginTop: 20 }}>
              <button className="btn primary" onClick={confirm} disabled={busy || !planId}>Finish Enrollment</button>
              <button className="btn ghost" onClick={() => setStep(1)}>Back</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="inq-card">
            <p className="inq-ok">Enrollment request received 🎉</p>
            <p><b>{f.first_name} {f.last_name}</b>, your journey at {g.name} starts now.</p>
            <ul className="plan-feat">
              <li>Plan: <b>{chosen ? chosen.name : '—'}</b> ({chosen ? rupee(chosen.price) : '—'})</li>
              <li>Payment: <b>{payMode === 'gym' ? 'Pay at the gym' : 'Online (Razorpay)'}</b></li>
              <li>Our team will contact you on {f.phone}</li>
            </ul>
            <p className="muted small">Your plan activates on the first visit. If SMS/WhatsApp is connected, a confirmation message will reach you automatically.</p>
            <button className="btn primary" onClick={() => { location.href = '/' }}>Back to Home</button>
          </div>
        )}
      </section>
      <ComboRow />
      <PlansPublic hideCTA />
      <ContactSec />
    </div>
  )
}

function ContactSec() {
  const g = useGym()
  return (
    <>
      <section id="contact" className="contact-banner">
        <h2>{(g.name || '').toUpperCase()}</h2>
        {g.address && <p>{g.address}</p>}
        {(g.phone || g.hours) && <p className="contact-phone">{[g.phone, g.hours].filter(Boolean).join(' · ')}</p>}
        <div className="social-row">
          <Soc kind="facebook" />
          <Soc kind="instagram" />
          <Soc kind="twitter" />
          <Soc kind="youtube" />
        </div>
        <div className="contact-links">
          <a href={JOIN_URL} onClick={e => { e.preventDefault(); location.href = JOIN_URL }}>Contact Us</a>
          <a href="#blog" onClick={e => { e.preventDefault(); document.getElementById('blog').scrollIntoView({ behavior: 'smooth' }) }}>Ask A Question</a>
        </div>
      </section>
      <footer className="site-footer">
        <div className="foot-grid">
          <div className="foot-brand">
            <div className="foot-logo"><BrandMark /><span>{(g.name || '').trim().split(/\s+/).slice(0, 2).join(' ').toUpperCase()}</span></div>
            <b>Download Our App</b>
            <p className="muted small">Android &amp; iOS apps — coming soon.</p>
          </div>
          <div className="foot-col">
            <b>COMPANY</b>
            <a href="#top" onClick={e => { e.preventDefault(); document.getElementById('top').scrollIntoView({ behavior: 'smooth' }) }}>About Us</a>
            <a href="#plans" onClick={e => { e.preventDefault(); document.getElementById('plans').scrollIntoView({ behavior: 'smooth' }) }}>Membership</a>
            <a href="#contact" onClick={e => { e.preventDefault(); document.getElementById('contact').scrollIntoView({ behavior: 'smooth' }) }}>Careers</a>
            <a href="#contact">Privacy Policy</a>
            <a href="#contact">Terms &amp; Conditions</a>
          </div>
          <div className="foot-col">
            <b>GYMS</b>
            <a href="#top" onClick={e => { e.preventDefault(); document.getElementById('top').scrollIntoView({ behavior: 'smooth' }) }}>Find a Gym</a>
            <a href="#trainers" onClick={e => { e.preventDefault(); document.getElementById('trainers').scrollIntoView({ behavior: 'smooth' }) }}>Training</a>
            <a href="#blog" onClick={e => { e.preventDefault(); document.getElementById('blog').scrollIntoView({ behavior: 'smooth' }) }}>Blog</a>
          </div>
          <div className="foot-col">
            <b>MEMBERS</b>
            <a href="#top" onClick={e => { e.preventDefault(); document.getElementById('top').scrollIntoView({ behavior: 'smooth' }) }}>Member Login</a>
            <a href="#contact">FAQs</a>
            <a href="#contact">Contact Us</a>
            <a href="#plans" onClick={e => { e.preventDefault(); document.getElementById('plans').scrollIntoView({ behavior: 'smooth' }) }}>Corporate Membership</a>
          </div>
        </div>
        <div className="foot-bottom">© {g.name || 'Our Gym'} {new Date().getFullYear()}. All rights reserved.</div>
      </footer>
    </>
  )
}

function JumpStrip() {
  const go = (id) => (e) => { e.preventDefault(); const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: 'smooth' }) }
  return (
    <div className="jump-strip">
      <b>JUMP TO</b>
      <a href="#plans" onClick={go('plans')}>Membership Plans</a>
      <a href="#trainers" onClick={go('trainers')}>Our Trainers</a>
      <a href="#blog" onClick={go('blog')}>Gym Announcements</a>
      <a href="#contact" onClick={go('contact')}>Why Join Us</a>
    </div>
  )
}

// ---------- Login / Register / Forgot / Reset (marketing site + card) ----------
function Auth({ onLogin }) {
  const g = useGym()
  const [open, setOpen] = useState(() => {
    try {
      const sp = new URLSearchParams(location.search)
      return !!(sp.get('reset') || sp.get('forgot') != null)
    } catch { return false }
  })
  const [mode, setMode] = useState(() => {
    try {
      const sp = new URLSearchParams(location.search)
      if (sp.get('reset')) return 'reset'
      if (sp.get('forgot') != null) return 'forgot'
    } catch {}
    return 'login'
  })
  const [f, setF] = useState({ name: '', email: '', phone: '', password: '' })
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)
  const resetToken = (() => {
    try { return new URLSearchParams(location.search).get('reset') } catch { return null }
  })()

  const submit = async (e) => {
    e.preventDefault()
    setErr(''); setOk(''); setBusy(true)
    try {
      if (mode === 'login') {
        const r = await login(f.email, f.password)
        onLogin(r.user)
      } else if (mode === 'register') {
        if (f.password && f.password.length < 8) throw new Error('Password must be at least 8 characters')
        const r = await register({ name: f.name, email: f.email, phone: f.phone, password: f.password })
        onLogin(r.user)
      } else if (mode === 'forgot') {
        await forgotPassword(f.email)
        setOk('If that email exists, a reset link has been sent. Please check your email / gym notices.')
        setMode('login')
      } else if (mode === 'reset') {
        if (f.password.length < 8) throw new Error('Password must be at least 8 characters')
        await resetPassword(resetToken, f.password)
        setOk('Password updated ✅ You can login now.')
        if (typeof location !== 'undefined' && location.search) history.replaceState(null, '', location.pathname)
        setMode('login')
      }
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="af-site">
      <SiteNav />
      <div id="top" className="af-hero">
        <div className="af-hero-left">
          <span className="af-kicker">{g.name}</span>
          <h2 className="af-title">Train Strong.<br />Track Smart.</h2>
          <p className="af-addr">Your membership, payments and attendance — all in one place.</p>
          <div className="af-card">
            {!open ? (
              <div className="gate">
                <h3 className="gate-title">MEMBER LOGIN</h3>
                <button className="af-cta w100" onClick={() => setOpen(true)}>LOGIN NOW</button>
              </div>
            ) : (
              <>
                <h3>{mode === 'forgot' ? 'Forgot Password' : mode === 'reset' ? 'Set New Password' : 'Member Area'}</h3>
                {(mode === 'login' || mode === 'register') && (
                  <div className="auth-tabs">
                    <button className={mode === 'login' ? 'tab active' : 'tab'} onClick={() => setMode('login')}>Login</button>
                    <button className={mode === 'register' ? 'tab active' : 'tab'} onClick={() => setMode('register')}>New Member</button>
                  </div>
                )}
                {err && <p className="error">{err}</p>}
                {ok && <p className="muted" style={{ color: '#1e8e3e' }}>{ok}</p>}
                <form onSubmit={submit} className="form">
                  {mode === 'register' && (
                    <>
                      <input className="inp" placeholder="Full name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
                      <input className="inp" placeholder="Phone (optional)" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} />
                    </>
                  )}
                  {(mode === 'login' || mode === 'register' || mode === 'forgot') && (
                    <input className="inp" type="email" placeholder="Email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} required />
                  )}
                  {mode !== 'forgot' && (
                    <input className="inp" type="password" placeholder={mode === 'reset' ? 'New password (min 8 characters)' : 'Password'} value={f.password} onChange={e => setF({ ...f, password: e.target.value })} required={mode !== 'login'} />
                  )}
                  <button className="btn primary" disabled={busy}>
                    {mode === 'login' ? 'Login' : mode === 'register' ? 'Create Account' : mode === 'forgot' ? 'Send Reset Link' : 'Update Password'}
                  </button>
                  <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                    {mode !== 'forgot' && mode !== 'reset' ? (
                      <button type="button" className="link-btn" onClick={() => { setMode('forgot'); setErr(''); setOk('') }}>Forgot password?</button>
                    ) : (
                      <button type="button" className="link-btn" onClick={() => { setMode('login'); setErr(''); setOk('') }}>Back to login</button>
                    )}
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
        <Slider>
          <div className="slide-cap"><b>{g.name}</b><span>Strength · Cardio · Yoga</span></div>
        </Slider>
      </div>
      <JumpStrip />
      <ComboRow />
      <PlansPublic />
      <ContactSec />
    </div>
  )
}

// ---------- Admin panel ----------
const TABS = ['Dashboard', 'Members', 'Payments', 'Plans', 'Trainers', 'Notifications', 'Settings']

// per-page background photo (behind the whole admin page)
const TAB_BG = {
  Dashboard: '/hero.jpg',
  Members: '/bg-members.jpg',
  Payments: '/bg-payments.jpg',
  Plans: '/bg-plans.jpg',
  Trainers: '/bg-trainers.jpg',
  Notifications: '/banner.jpg',
  Settings: '/bg-plans.jpg',
}

function TabBanner({ title, img }) {
  return <div className="tab-banner" style={{ backgroundImage: 'url(' + img + ')' }}><h2>{title}</h2></div>
}
// (TabBanner is not used right now — admin pages use the full-page background instead)

function AdminPanel({ user, onLogout, onChangePwd }) {
  const g = useGym()
  const [tab, setTab] = useState('Dashboard')
  const [sub, setSub] = useState(null)
  // subscription banner: the trial / paid period is over (writes are blocked, reads still work)
  useEffect(() => {
    get('/gym/settings').then(r => setSub(r)).catch(() => {})
  }, [])
  const subExpired = sub && (
    (sub.status === 'trial' && sub.trial_ends_at && new Date(sub.trial_ends_at) <= new Date())
    || (sub.status === 'active' && sub.paid_until && new Date(sub.paid_until) <= new Date())
  )
  return (
    <div>
      <header className="topbar">
        <h1 className="logo-sm">💪 {g.name || 'Our Gym'} — Admin</h1>
        <div className="grow" />
        <span className="muted">{user.name}</span>
        <button className="btn ghost" onClick={onChangePwd}>Password</button>
        <button className="btn ghost" onClick={onLogout}>Logout</button>
      </header>
      {subExpired && (
        <div className="panel" style={{ margin: '10px 16px', borderLeft: '4px solid #f29900' }}>
          <b>Subscription required</b>
          <p className="muted">
            Your gym's {sub.status === 'trial' ? 'trial' : 'paid period'} has ended.
            The site still works and members can view their data, but saving changes is disabled
            until the subscription is renewed — please contact the platform owner.
          </p>
        </div>
      )}
      <nav className="tabs">
        {TABS.map(t => (
          <button key={t} className={t === tab ? 'tab active' : 'tab'} onClick={() => setTab(t)}>{t}</button>
        ))}
      </nav>
      <main className="content pagebg" style={{ '--bgimg': 'url(' + TAB_BG[tab] + ')' }}>
        {tab === 'Dashboard' && <Dashboard />}
        {tab === 'Members' && <Members />}
        {tab === 'Payments' && <Payments />}
        {tab === 'Plans' && <Plans />}
        {tab === 'Trainers' && <Trainers />}
        {tab === 'Notifications' && <Notifications />}
        {tab === 'Settings' && <GymSettings />}
      </main>
    </div>
  )
}

// ---------- Settings tab: gym branding, contact info and Razorpay keys ----------
function GymSettings() {
  const g = useGym()
  const blank = {
    name: '', logo: '', primary_color: '', address: '', phone: '', hours: '', map_url: '',
    razorpay_key_id: '', razorpay_key_secret: '', has_razorpay_key: false, settings: {},
    templates: {},
  }
  const [f, setF] = useState(blank)
  const [tplDefaults, setTplDefaults] = useState({})
  const [maskedId, setMaskedId] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    get('/gym/settings').then(r => {
      setF({ ...blank, ...r, razorpay_key_id: '', razorpay_key_secret: '', templates: (r.settings && r.settings.templates) || {} })
      setTplDefaults(r.default_templates || {})
      setMaskedId(r.razorpay_key_id || '')
      setLoaded(true)
    }).catch(e => setErr(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pickLogo = (e) => {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) return alert('Logo must be under 2 MB')
    const r = new FileReader()
    r.onload = () => setF(fv => ({ ...fv, logo: r.result }))
    r.readAsDataURL(file)
  }

  const save = async (e) => {
    e.preventDefault()
    setErr(''); setOk(''); setBusy(true)
    try {
      const body = {
        name: f.name, logo: f.logo || null, primary_color: f.primary_color || null,
        address: f.address || null, phone: f.phone || null, hours: f.hours || null,
        map_url: f.map_url || null, settings: { ...(f.settings || {}), templates: f.templates || {} },
      }
      if (f.razorpay_key_id && f.razorpay_key_id.length < 12) { setBusy(false); setErr('Razorpay key id looks too short — paste the full key (starts with rzp_)') ; return }
      if (f.razorpay_key_id && !f.razorpay_key_secret) { setBusy(false); setErr('Enter the Razorpay key secret together with the key id'); return }
      if (f.razorpay_key_secret) { body.razorpay_key_id = f.razorpay_key_id; body.razorpay_key_secret = f.razorpay_key_secret }
      await put('/gym/settings', body)
      setOk('Saved ✅ Reload the site to see the new branding everywhere.')
      // live-apply branding without a full reload
      if (f.primary_color) document.documentElement.style.setProperty('--primary', f.primary_color)
      setF(fv => ({ ...fv, razorpay_key_secret: '' }))
      // the key may have just changed — refresh only its display, keep the form as typed
      get('/gym/settings').then(r2 => {
        setMaskedId(r2.razorpay_key_id || '')
        setF(fv => ({
          ...fv,
          has_razorpay_key: r2.has_razorpay_key,
          settings: r2.settings || {},
          templates: (r2.settings && r2.settings.templates) || {},
        }))
      }).catch(() => {})
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }

  if (!loaded && !err) return <p className="muted">Loading…</p>
  if (err && !loaded) return <p className="error">{err}</p>

  return (
    <div style={{ maxWidth: 720 }}>
      <div className="panel">
        <h3>Gym branding</h3>
        <p className="muted small">This appears across your website, member area and payment screen.</p>
        <form onSubmit={save} className="form" id="gy-brand">
          <div className="grid2">
            <div>
              <label className="muted small">Logo (optional, under 2 MB)</label>
              <input type="file" accept="image/*" onChange={pickLogo} className="inp" />
            </div>
            <div>
              <label className="muted small">Brand color</label>
              <div className="row" style={{ gap: 8 }}>
                <input
                  type="color" value={f.primary_color || '#7c3aed'} onChange={e => setF({ ...f, primary_color: e.target.value })}
                  style={{ width: 46, height: 40, border: 'none', background: 'none', padding: 0 }} aria-label="Pick brand color"
                />
                <input className="inp" value={f.primary_color} placeholder="#7c3aed" onChange={e => setF({ ...f, primary_color: e.target.value })} />
              </div>
            </div>
          </div>
          <label className="muted small">Gym name (shown on the website and receipts)</label>
          <input className="inp" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required />
        </form>
      </div>
      <div className="panel">
        <h3>Contact &amp; location</h3>
        <form className="form" onSubmit={e => e.preventDefault()}>
          <label className="muted small">Address</label>
          <input className="inp" value={f.address} onChange={e => setF({ ...f, address: e.target.value })} />
          <div className="grid2">
            <div>
              <label className="muted small">Phone</label>
              <input className="inp" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} />
            </div>
            <div>
              <label className="muted small">Timings</label>
              <input className="inp" value={f.hours} placeholder="Open daily · 6:00 AM – 10:00 PM" onChange={e => setF({ ...f, hours: e.target.value })} />
            </div>
          </div>
          <label className="muted small">Google Maps link or embed URL (optional)</label>
          <input className="inp" value={f.map_url} placeholder="https://www.google.com/maps?q=…" onChange={e => setF({ ...f, map_url: e.target.value })} />
        </form>
      </div>
      <div className="panel">
        <h3>Online payments (Razorpay)</h3>
        {f.has_razorpay_key
          ? <p className="muted small">Key on file: <code>{maskedId}</code></p>
          : <p className="muted small">No key saved — online payments fall back to the platform's shared key.</p>}
        <form className="form" onSubmit={e => e.preventDefault()}>
          <label className="muted small">Key id {f.has_razorpay_key ? '(type the full new key only if you want to replace the saved one)' : ''}</label>
          <input className="inp" value={f.razorpay_key_id} placeholder={f.has_razorpay_key ? maskedId : 'rzp_live_…'} onChange={e => setF({ ...f, razorpay_key_id: e.target.value })} />
          <label className="muted small">Key secret {f.has_razorpay_key ? '(enter again only to replace the saved one)' : ''}</label>
          <input className="inp" type="password" value={f.razorpay_key_secret} placeholder="••••••••" onChange={e => setF({ ...f, razorpay_key_secret: e.target.value })} />
        </form>
      </div>
      <div className="panel">
        <h3>Message templates</h3>
        <p className="muted small">
          Emails and WhatsApp messages sent to members. Leave a field empty to use the
          default text. Placeholders: <code>&#123;&#123;member&#125;&#125;</code>, <code>&#123;&#123;gym&#125;&#125;</code>, <code>&#123;&#123;plan&#125;&#125;</code>, <code>&#123;&#123;amount&#125;&#125;</code>, <code>&#123;&#123;method&#125;&#125;</code>, <code>&#123;&#123;expiry&#125;&#125;</code>, <code>&#123;&#123;email&#125;&#125;</code>, <code>&#123;&#123;phone&#125;&#125;</code>, <code>&#123;&#123;website&#125;&#125;</code>.
        </p>
        {['welcome', 'payment_received', 'payment_online', 'inquiry'].map(key => {
          const def = tplDefaults[key] || { subject: '', body: '' }
          const cur = f.templates[key] || {}
          const titles = {
            welcome: 'Welcome message (new member)',
            payment_received: 'Payment received (cash / gym payment)',
            payment_online: 'Online payment confirmation',
            inquiry: 'New inquiry alert (sent to you)',
          }
          return (
            <div key={key} style={{ marginTop: 14 }}>
              <b>{titles[key]}</b>
              <input
                className="inp" value={cur.subject || ''} placeholder={def.subject}
                onChange={e => { const v = e.target.value; setF(fv => ({ ...fv, templates: { ...fv.templates, [key]: { ...cur, subject: v } } })) }}
              />
              <textarea
                className="inp" rows={4} value={cur.body || ''} placeholder={def.body}
                onChange={e => { const v = e.target.value; setF(fv => ({ ...fv, templates: { ...fv.templates, [key]: { ...cur, body: v } } })) }}
                style={{ width: '100%' }}
              />
              {(cur.subject || cur.body) && (
                <button type="button" className="link-btn" onClick={() => setF(fv => {
                  const t = { ...fv.templates }; delete t[key]; return { ...fv, templates: t }
                })}>Reset this to default</button>
              )}
            </div>
          )
        })}
      </div>
      {err && <p className="error">{err}</p>}
      {ok && <p className="muted" style={{ color: '#1e8e3e' }}>{ok}</p>}
      <button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>
      <p className="muted small" style={{ marginTop: 6 }}>
        Tip: a fresh logo or color shows on the next page load (currently: {g.name || '…'}).
      </p>
    </div>
  )
}

function Dashboard() {
  const [r, setR] = useState(null)
  useEffect(() => { get('/reports/summary').then(setR).catch(e => alert(e.message)) }, [])
  if (!r) return <p className="muted">Loading…</p>
  const cards = [
    ['Total Members', r.total, 'blue'], ['Active', r.active, 'ok'],
    ['Expiring (7 days)', r.expiring, 'warn'], ['Expired', r.expired, 'bad'],
    ['This Month Income', rupee(r.month_income), 'blue'], ['Today Check-ins', r.today_attendance, 'ok'],
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
  const blank = { name: '', email: '', phone: '', password: '', plan_id: '', trainer_id: '', expiry_date: '', photo: '' }
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
        expiry_date: f.expiry_date || '', photo: f.photo,
      }
      if (editId) {
        await put('/members/' + editId, body)
        if (f.password) await put('/members/' + editId + '/password', { password: f.password })
      } else {
        if (!f.password || f.password.length < 6) { alert('Please set a login password for the member (min 6 characters).'); return }
        body.password = f.password
        await post('/members', body)
      }
      setF(blank); setEditId(null); setShowForm(false); load()
    } catch (e) { alert(e.message) }
  }

  const pickPhoto = (e) => {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) return alert('Photo must be under 2 MB')
    const r = new FileReader()
    r.onload = () => setF(fv => ({ ...fv, photo: r.result }))
    r.readAsDataURL(file)
  }

  const edit = (m) => {
    setEditId(m.id)
    setF({
      name: m.name || '', email: m.email || '', phone: m.phone || '', password: '',
      plan_id: m.plan_id || '', trainer_id: m.trainer_id || '', expiry_date: m.expiry_date || '',
      photo: m.photo || '',
    })
    setShowForm(true)
    window.scrollTo(0, 0)
  }

  const remove = async (m) => {
    if (!window.confirm(`Delete ${m.name}?`)) return
    try { await del('/members/' + m.id); load() } catch (e) { alert(e.message) }
  }

  return (
    <div>
      <div className="row">
        <input className="inp w-search" placeholder="Search name / phone / email…" value={search} onChange={e => setSearch(e.target.value)} />
        <button className="btn primary" onClick={() => { setF(blank); setEditId(null); setShowForm(!showForm) }}>
          {showForm && !editId ? 'Close' : '+ New Member'}
        </button>
      </div>

      {showForm && (
        <form className="panel form" onSubmit={save}>
          <h3>{editId ? 'Edit Member' : 'New Member'}</h3>
          <div className="row photo-row">
            {f.photo ? <img className="avatar-big" src={f.photo} alt="" /> : <div className="avatar-big avatar-fall">{f.name ? f.name[0] : '?'}</div>}
            <label className="btn">Choose photo
              <input type="file" accept="image/*" onChange={pickPhoto} style={{ display: 'none' }} />
            </label>
            {f.photo && <button type="button" className="btn ghost sm" onClick={() => setF({ ...f, photo: '' })}>Remove</button>}
          </div>
          <div className="grid2">
            <input className="inp" placeholder="Name *" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required />
            <input className="inp" placeholder="Phone" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} />
            <input className="inp" placeholder="Email (for login)" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />
            <input className="inp" type="password" placeholder={editId ? 'New password (leave empty to keep old)' : 'Login password * (min 6 chars)'} value={f.password} onChange={e => setF({ ...f, password: e.target.value })} />
            <select className="inp" value={f.plan_id} onChange={e => setF({ ...f, plan_id: e.target.value })}>
              <option value="">Select plan</option>
              {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select className="inp" value={f.trainer_id} onChange={e => setF({ ...f, trainer_id: e.target.value })}>
              <option value="">Trainer (optional)</option>
              {trainers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <input className="inp" type="date" value={f.expiry_date || ''} onChange={e => setF({ ...f, expiry_date: e.target.value })} title="Expiry (empty = auto from plan)" />
          </div>
          <div className="row">
            <button className="btn primary" type="submit">{editId ? 'Update' : 'Add'}</button>
            <button className="btn ghost" type="button" onClick={() => { setF(blank); setEditId(null); setShowForm(false) }}>Cancel</button>
          </div>
        </form>
      )}

      <table className="tbl">
        <thead><tr><th>Name</th><th>Phone</th><th>Plan</th><th>Trainer</th><th>Expiry</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          {list.map(m => {
            const [cls, label] = statusOf(m.expiry_date)
            return (
              <tr key={m.id}>
                <td>
                  <div className="who">
                    {m.photo ? <img className="avatar" src={m.photo} alt="" /> : <span className="avatar avatar-fall">{m.name[0]}</span>}
                    <span>{m.name}<div className="muted small">{m.email || ''}</div></span>
                  </div>
                </td>
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
          {!list.length && <tr><td colSpan="7" className="muted">No members yet. Add the first one.</td></tr>}
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
  useEffect(() => { load() }, [])

  const save = async (e) => {
    e.preventDefault()
    try { await post('/payments', { ...f, user_id: Number(f.user_id), amount: Number(f.amount) }); setF({ ...f, amount: '', note: '' }); load() }
    catch (e2) { alert(e2.message) }
  }
  const remove = async (id) => { if (window.confirm('Delete payment?')) { try { await del('/payments/' + id); load() } catch (e) { alert(e.message) } } }

  return (
    <div>
      <form className="panel form" onSubmit={save}>
        <h3>Add Payment</h3>
        <div className="grid2">
          <select className="inp" value={f.user_id} onChange={e => setF({ ...f, user_id: e.target.value })} required>
            <option value="">Select member</option>
            {members.map(m => <option key={m.id} value={m.id}>{m.name} {m.phone ? '(' + m.phone + ')' : ''}</option>)}
          </select>
          <input className="inp" type="number" placeholder="Amount ₹" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} required />
          <select className="inp" value={f.method} onChange={e => setF({ ...f, method: e.target.value })}>
            <option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option>
          </select>
          <input className="inp" placeholder="Note (optional)" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} />
        </div>
        <label className="check"><input type="checkbox" checked={f.extend} onChange={e => setF({ ...f, extend: e.target.checked })} /> Renew plan (extends expiry)</label>
        <button className="btn primary" type="submit">Add</button>
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
          {!list.length && <tr><td colSpan="6" className="muted">No payments yet.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

function Plans() {
  const [list, setList] = useState([])
  const [f, setF] = useState({ name: '', duration_days: '', price: '' })
  const load = () => get('/plans').then(setList).catch(e => alert(e.message))
  useEffect(() => { load() }, [])
  const save = async (e) => {
    e.preventDefault()
    try { await post('/plans', { ...f, duration_days: Number(f.duration_days), price: Number(f.price) }); setF({ name: '', duration_days: '', price: '' }); load() }
    catch (e2) { alert(e2.message) }
  }
  const remove = async (id) => { if (window.confirm('Delete plan?')) { try { await del('/plans/' + id); load() } catch (e) { alert(e.message) } } }
  return (
    <div>
      <form className="panel form" onSubmit={save}>
        <h3>New Plan</h3>
        <div className="grid3">
          <input className="inp" placeholder="Plan name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required />
          <input className="inp" type="number" placeholder="Duration (days, e.g. 30)" value={f.duration_days} onChange={e => setF({ ...f, duration_days: e.target.value })} required />
          <input className="inp" type="number" placeholder="Price ₹" value={f.price} onChange={e => setF({ ...f, price: e.target.value })} required />
        </div>
        <button className="btn primary" type="submit">Add</button>
      </form>
      <table className="tbl">
        <thead><tr><th>Name</th><th>Days</th><th>Price</th><th></th></tr></thead>
        <tbody>
          {list.map(p => <tr key={p.id}><td>{p.name}</td><td>{p.duration_days}</td><td>{rupee(p.price)}</td><td><button className="btn sm danger" onClick={() => remove(p.id)}>✕</button></td></tr>)}
          {!list.length && <tr><td colSpan="4" className="muted">No plans yet.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

function Trainers() {
  const [list, setList] = useState([])
  const [f, setF] = useState({ name: '', phone: '', specialty: '' })
  const load = () => get('/trainers').then(setList).catch(e => alert(e.message))
  useEffect(() => { load() }, [])
  const save = async (e) => {
    e.preventDefault()
    try { await post('/trainers', f); setF({ name: '', phone: '', specialty: '' }); load() }
    catch (e2) { alert(e2.message) }
  }
  const remove = async (id) => { if (window.confirm('Delete trainer?')) { try { await del('/trainers/' + id); load() } catch (e) { alert(e.message) } } }
  return (
    <div>
      <form className="panel form" onSubmit={save}>
        <h3>New Trainer</h3>
        <div className="grid2">
          <input className="inp" placeholder="Name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required />
          <input className="inp" placeholder="Phone" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} />
          <input className="inp" placeholder="Specialty (e.g. weight, yoga)" value={f.specialty} onChange={e => setF({ ...f, specialty: e.target.value })} />
        </div>
        <button className="btn primary" type="submit">Add</button>
      </form>
      <table className="tbl">
        <thead><tr><th>Name</th><th>Phone</th><th>Specialty</th><th></th></tr></thead>
        <tbody>
          {list.map(t => <tr key={t.id}><td>{t.name}</td><td>{t.phone || '—'}</td><td>{t.specialty || '—'}</td><td><button className="btn sm danger" onClick={() => remove(t.id)}>✕</button></td></tr>)}
          {!list.length && <tr><td colSpan="4" className="muted">No trainers yet.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

// ---------- Notifications ----------
function Notifications() {
  const [list, setList] = useState([])
  const [cfg, setCfg] = useState(null)
  const load = () => get('/notifications').then(setList).catch(e => alert(e.message))
  useEffect(() => { load(); get('/notifications/config').then(setCfg).catch(() => {}) }, [])

  const statusChip = (s) => s === 'sent' ? 'ok' : (s === 'ready' ? 'warn' : s === 'failed' ? 'bad' : 'off')
  const fullText = (n) => n.subject + '\n\n' + n.body
  const copyIt = (n) => navigator.clipboard && navigator.clipboard.writeText(fullText(n))
  const waLink = (n) => 'https://wa.me/' + String(n.dest).replace(/\D/g, '') + '?text=' + encodeURIComponent(fullText(n))
  const resend = async (n) => {
    try { await post('/notifications/' + n.id + '/resend', {}); load() } catch (e) { alert(e.message) }
  }

  return (
    <div>
      {cfg && (
        <div className="panel">
          <h3>Message channels</h3>
          <p>Email: <span className={'chip ' + (cfg.email ? 'ok' : 'off')}>{cfg.email ? 'Connected' : 'Not connected'}</span>{' '}
             WhatsApp: <span className={'chip ' + (cfg.whatsapp ? 'ok' : 'warn')}>{cfg.whatsapp ? 'Connected' : 'Not connected — open links below to send'}</span></p>
          <p className="muted small">Email/WhatsApp are not connected yet. Add SMTP and WHATSAPP_TOKEN keys to .env to auto-send (ask me, I will set it up). For now, use "Open WhatsApp" to send messages to members directly.</p>
        </div>
      )}
      <table className="tbl">
        <thead><tr><th>Member</th><th>Channel</th><th>Status</th><th>Sent to</th><th>Subject</th><th>Actions</th></tr></thead>
        <tbody>
          {list.map((n) => (
            <tr key={n.id}>
              <td>{n.member_name || '—'}</td>
              <td>{n.channel}</td>
              <td><span className={'chip ' + statusChip(n.status)}>{n.status}</span></td>
              <td>{n.dest || '—'}</td>
              <td className="small">{n.subject}</td>
              <td>
                <button className="btn sm" onClick={() => copyIt(n)}>Copy</button>{' '}
                {n.channel === 'whatsapp' && n.dest && <a className="btn sm" href={waLink(n)} target="_blank" rel="noreferrer">Open WhatsApp</a>}{' '}
                <button className="btn sm" onClick={() => resend(n)}>Resend</button>
              </td>
            </tr>
          ))}
          {!list.length && <tr><td colSpan="6" className="muted">No messages yet. A message is created automatically when you add a member or record a payment.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

// ---------- Member home ----------
function MemberHome({ user, onLogout, onChangePwd }) {
  const g = useGym()
  const [d, setD] = useState(null)
  const load = () => get('/me/detail').then(setD).catch(e => alert(e.message))
  useEffect(() => { load() }, [])

  if (!d) return <p className="muted">Loading…</p>
  const [cls, label] = statusOf(d.expiry_date)
  const daysLeft = d.expiry_date
    ? Math.round((new Date(d.expiry_date + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 86400000)
    : null

  const checkin = async () => {
    try { await post('/attendance', {}); load() } catch (e) { alert(e.message) }
  }

  const pickSelf = (e) => {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) return alert('Photo must be under 2 MB')
    const r = new FileReader()
    r.onload = async () => {
      try { await post('/me/photo', { photo: r.result }); load() } catch (e2) { alert(e2.message) }
    }
    r.readAsDataURL(file)
  }

  return (
    <div id="top" className="member-bg af-site">
      <SiteNav user={user} onLogout={onLogout} onChangePwd={onChangePwd} />

      <section className="hero-m">
        <div className="hero-inner">
          <h1>Welcome to {g.name || 'Our Gym'}</h1>
          <p className="hero-sub">The fitness facility for all of your needs</p>
          <div className="hero-chip-row">
            <span className={'chip ' + cls}>{label}</span>
            <span className="chip chip-dark">{d.plan_name || 'Plan not set'}</span>
            <span className="chip chip-dark">{d.trainer_name || 'No trainer'}</span>
            <span className="chip chip-dark">Expiry: {fmt(d.expiry_date)}</span>
          </div>
          {d.photo ? <img className="avatar-big hero-avatar" src={d.photo} alt="" /> : <div className="avatar-big avatar-fall light">{(d.name || '?')[0]}</div>}
          <div className="hero-cta">
            <button className={'hero-btn ' + (d.checked_today ? '' : 'pulse')} onClick={checkin} disabled={d.checked_today > 0}>
              {d.checked_today ? '✓ Checked in today — keep going!' : 'Check-in Now'}
            </button>
            <label className="hero-link">Change photo
              <input type="file" accept="image/*" onChange={pickSelf} style={{ display: 'none' }} />
            </label>
          </div>
        </div>
      </section>

      <main className="content">
        <div className="cards">
          <div className="card blue"><div className="card-val">{d.total_visits}</div><div className="card-label">Total Visits</div></div>
          <div className="card ok"><div className="card-val">{d.month_visits}</div><div className="card-label">This Month Visits</div></div>
          <div className={'card ' + (daysLeft === null ? 'blue' : daysLeft < 0 ? 'bad' : 'ok')}><div className="card-val">{daysLeft === null ? '—' : daysLeft < 0 ? 'Expired' : daysLeft}</div><div className="card-label">Days Left</div></div>
          <div className="card blue"><div className="card-val">{rupee(d.total_paid)}</div><div className="card-label">Total Paid</div></div>
        </div>

      </main>

      <section className="plans-pay-band">
        <div className="dash-split dash-split-band">
          <div className="dash-right dash-right-band">
            <PlansPublic />
          </div>
          <div className="dash-left">
            <div className="panel">
              <h3>My Payments</h3>
              <table className="tbl">
                <thead><tr><th>Amount</th><th>Method</th><th>Date</th></tr></thead>
                <tbody>
                  {d.payments.map(p => <tr key={p.id}><td>{rupee(p.amount)}</td><td>{p.method}</td><td>{fmt(p.paid_on)}</td></tr>)}
                  {!d.payments.length && <tr><td colSpan="3" className="muted">Nothing yet.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="panel">
              <h3>Last 10 Check-ins</h3>
              <ul className="list">
                {d.attendance.map(a => <li key={a.id}>{new Date(a.checkin_at).toLocaleString('en-IN')}</li>)}
                {!d.attendance.length && <li className="muted">Nothing yet.</li>}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <ComboRow />
      <ContactSec />
    </div>
  )
}