const API = '/api'

// Auth lives in an HttpOnly cookie set by the backend (login/register/reset).
// The browser sends it automatically with every same-origin /api request.

async function req(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Something went wrong')
  return data
}

export const login = (email, password) => req('/auth/login', { method: 'POST', body: { email, password } })
export const register = (body) => req('/auth/register', { method: 'POST', body })
export const logout = () => req('/auth/logout', { method: 'POST' })
export const me = () => req('/auth/me')
export const changePassword = (p) => req('/auth/change-password', { method: 'POST', body: { new_password: p } })
export const forgotPassword = (email) => req('/auth/forgot', { method: 'POST', body: { email } })
export const resetPassword = (token, password) => req('/auth/reset', { method: 'POST', body: { token, password } })

export const get = (p) => req(p)
export const post = (p, body) => req(p, { method: 'POST', body })
export const put = (p, body) => req(p, { method: 'PUT', body })
export const del = (p) => req(p, { method: 'DELETE' })