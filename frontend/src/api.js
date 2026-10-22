const API = '/api'
const COOKIE = 'jfc_token'

// testing domains: member = jainifitness.test, admin = admin.jainifitness.test
const ADMIN_SUB = 'admin.jainifitness.test'
export const ADMIN_URL = 'http://admin.jainifitness.test'
export const MEMBER_URL = 'http://jainifitness.test'

export const isTestDomain = () => typeof location !== 'undefined' && location.hostname.endsWith('.jainifitness.test')

function getCookie() {
  try {
    const c = (document.cookie.split('; ').find(x => x.startsWith(COOKIE + '=')) || '')
    return c ? decodeURIComponent(c.split('=').slice(1).join('=')) : ''
  } catch { return '' }
}

let token = ''
try { token = getCookie() || localStorage.getItem('jfc_token') || '' } catch {}

export const getToken = () => token
export const setToken = (t) => {
  token = t || ''
  try {
    if (token) {
      document.cookie = COOKIE + '=' + encodeURIComponent(token)
        + '; path=/; max-age=604800; SameSite=Lax'
        + (isTestDomain() ? '; Domain=.jainifitness.test' : '')
      try { localStorage.setItem('jfc_token', token) } catch {}
    } else {
      document.cookie = COOKIE + '=; path=/; max-age=0'
      document.cookie = COOKIE + '=; path=/; Domain=.jainifitness.test; max-age=0'
      try { localStorage.removeItem('jfc_token') } catch {}
    }
  } catch {}
}

// login ke baad admin ko admin site, member ko member site bhejna
export function routeByRole(user) {
  if (!isTestDomain()) return false
  if (user.role === 'admin') {
    if (location.hostname !== ADMIN_SUB) { location.href = ADMIN_URL; return true }
  } else if (location.hostname === ADMIN_SUB) {
    location.href = MEMBER_URL; return true
  }
  return false
}

async function req(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: 'Bearer ' + token }),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Something went wrong')
  return data
}

export const login = (email, password) => req('/auth/login', { method: 'POST', body: { email, password } })
export const register = (body) => req('/auth/register', { method: 'POST', body })
export const me = () => req('/auth/me')
export const changePassword = (p) => req('/auth/change-password', { method: 'POST', body: { new_password: p } })

export const get = (p) => req(p)
export const post = (p, body) => req(p, { method: 'POST', body })
export const put = (p, body) => req(p, { method: 'PUT', body })
export const del = (p) => req(p, { method: 'DELETE' })