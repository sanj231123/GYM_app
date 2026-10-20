const API = '/api'

let token = ''
try { token = localStorage.getItem('jfc_token') || '' } catch {}

export const getToken = () => token
export const setToken = (t) => {
  token = t || ''
  try { token ? localStorage.setItem('jfc_token', token) : localStorage.removeItem('jfc_token') } catch {}
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