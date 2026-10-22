import React, { createContext, useContext } from 'react'
import { get } from './api'

// The gym (tenant) this browser is looking at. Loads once from the backend
// (host resolves it) and is shared with every screen through useGym().
const DEFAULTS = { slug: '', name: 'Our Gym', logo: '', primary_color: '', address: '', phone: '', hours: '', map_url: '' }
const TenantCtx = createContext(DEFAULTS)

export function TenantProvider({ children }) {
  const [gym, setGym] = React.useState(DEFAULTS)
  React.useEffect(() => {
    get('/gym')
      .then(g => {
        const merged = { ...DEFAULTS, ...(g || {}), name: (g && g.name) || DEFAULTS.name }
        setGym(merged)
        if (merged.primary_color) {
          document.documentElement.style.setProperty('--primary', merged.primary_color)
        }
      })
      .catch(() => {}) // platform pages / errors keep the defaults
  }, [])
  const logoText = (gym.name || 'G').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()
  return <TenantCtx.Provider value={{ ...gym, logoText }}>{children}</TenantCtx.Provider>
}

export const useGym = () => useContext(TenantCtx)