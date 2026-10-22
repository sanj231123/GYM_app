// Admin Analytics tab — gym-scoped charts, plain inline SVG (no chart library)
import { useEffect, useState } from 'react'
import { get } from './api'

// round a max value up to a clean gridline (1/2/5 × 10^k)
function niceMax(v) {
  if (v <= 0) return 10
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  for (const m of [1, 2, 5, 10]) if (v <= m * p) return m * p
  return 10 * p
}

function useSeries() {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    get('/analytics').then(setD).catch(e => setErr(e.message))
    return undefined
  }, [])
  return [d, err]
}

// vertical bar chart — single hue, rounded data-ends, hover tooltip,
// direct labels only on the max value and the latest point
export function BarSeries({ data, title, subtitle, fmt = v => v, valueFmt }) {
  const [tip, setTip] = useState(null)
  const W = 560, H = 240, padL = 52, padR = 14, padT = 16, padB = 30
  const n = data.length || 1
  const max = niceMax(Math.max(...data.map(d => d.value)))
  const plotW = W - padL - padR, plotH = H - padT - padB
  const y = v => padT + plotH - (v / max) * plotH
  const band = plotW / n, barW = Math.min(44, band * 0.58)
  const maxI = data.reduce((b, d, i) => (d.value > data[b].value ? i : b), 0)
  const fmtV = valueFmt || (v => fmt(v))
  return (
    <div className="chart-card">
      <h3>{title}</h3>
      {subtitle && <p className="chart-sub">{subtitle}</p>}
      <div className="chart-wrap">
        <svg viewBox={'0 0 ' + W + ' ' + H} role="img" aria-label={title} width="100%">
          {[0, 0.25, 0.5, 0.75, 1].map(f => (
            <g key={f}>
              <line x1={padL} x2={W - padR} y1={y(max * f)} y2={y(max * f)}
                stroke="var(--border)" strokeWidth="1" />
              <text x={padL - 8} y={y(max * f) + 4} textAnchor="end" className="chart-tick">
                {fmtV(Math.round(max * f))}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const bx = padL + i * band + (band - barW) / 2
            const by = y(d.value)
            const h = Math.max(2, y(0) - by)
            const show = d.value > 0 && (i === maxI || i === n - 1)
            return (
              <g key={i}>
                <path d={`M${bx},${y(0)} L${bx},${by + 4} Q${bx},${by} ${bx + 4},${by} L${bx + barW - 4},${by} Q${bx + barW},${by} ${bx + barW},${by + 4} L${bx + barW},${y(0)} Z`}
                  fill="var(--primary)" />
                {show && (
                  <text x={bx + barW / 2} y={by - 7} textAnchor="middle" className="chart-val">
                    {fmtV(d.value)}
                  </text>
                )}
                <text x={padL + i * band + band / 2} y={H - 10} textAnchor="middle" className="chart-tick">
                  {d.label}
                </text>
                <rect x={padL + i * band} y={padT} width={band} height={plotH} fill="transparent"
                  onMouseEnter={() => setTip({ x: padL + i * band + band / 2, y: by, text: d.label + ': ' + fmtV(d.value) })}
                  onMouseLeave={() => setTip(null)} />
              </g>
            )
          })}
        </svg>
        {tip && (
          <div className="chart-tip" style={{ left: Math.min(tip.x, W - 70) + 'px', top: tip.y + 'px' }}>
            {tip.text}
          </div>
        )}
      </div>
    </div>
  )
}

// line chart with 8px dot markers and a hover crosshair
export function LineSeries({ data, title, subtitle }) {
  const [tip, setTip] = useState(null)
  const W = 560, H = 240, padL = 36, padR = 16, padT = 16, padB = 30
  const n = data.length || 1
  const maxV = Math.max(...data.map(d => d.value))
  const max = niceMax(maxV < 3 ? 3 : maxV)
  const plotW = W - padL - padR, plotH = H - padT - padB
  const x = i => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const y = v => padT + plotH - (v / max) * plotH
  const path = data.map((d, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(d.value).toFixed(1)).join(' ')
  const maxI = data.reduce((b, d, i) => (d.value > data[b].value ? i : b), 0)
  const ticks = [0, Math.round(n / 2), n - 1]
  return (
    <div className="chart-card">
      <h3>{title}</h3>
      {subtitle && <p className="chart-sub">{subtitle}</p>}
      <div className="chart-wrap">
        <svg viewBox={'0 0 ' + W + ' ' + H} role="img" aria-label={title} width="100%">
          {[0, 0.5, 1].map(f => (
            <g key={f}>
              <line x1={padL} x2={W - padR} y1={y(max * f)} y2={y(max * f)} stroke="var(--border)" strokeWidth="1" />
              <text x={padL - 8} y={y(max * f) + 4} textAnchor="end" className="chart-tick">{Math.round(max * f)}</text>
            </g>
          ))}
          {tip && <line x1={tip.x} x2={tip.x} y1={padT} y2={y(0)} stroke="var(--primary)" strokeWidth="1" opacity="0.35" />}
          <path d={path} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" />
          {data.map((d, i) => (
            <circle key={i} cx={x(i)} cy={y(d.value)} r="4" fill="var(--panel)"
              stroke="var(--primary)" strokeWidth="2" />
          ))}
          {data.map((d, i) => (
            <text key={'lbl' + i} x={x(i)} y={y(d.value) - 10} textAnchor="middle"
              className="chart-val" style={{ visibility: i === maxI || i === n - 1 ? 'visible' : 'hidden' }}>
              {d.value}
            </text>
          ))}
          {ticks.map(i => (
            <text key={'ax' + i} x={x(i)} y={H - 10} textAnchor="middle" className="chart-tick">{data[i]?.label}</text>
          ))}
          {data.map((d, i) => (
            <rect key={'hit' + i} x={x(i) - plotW / n / 2} y={padT} width={plotW / n} height={plotH}
              fill="transparent"
              onMouseEnter={() => setTip({ x: x(i), text: d.label + ': ' + d.value + ' check-ins' })}
              onMouseLeave={() => setTip(null)} />
          ))}
        </svg>
        {tip && <div className="chart-tip" style={{ left: Math.min(tip.x, W - 70) + 'px', top: padT + 'px' }}>{tip.text}</div>}
      </div>
    </div>
  )
}

// horizontal bars for the plan distribution
export function PlanBars({ data, title, subtitle }) {
  const max = niceMax(Math.max(...data.map(d => d.value)))
  return (
    <div className="chart-card">
      <h3>{title}</h3>
      {subtitle && <p className="chart-sub">{subtitle}</p>}
      <div className="plan-bars">
        {data.length === 0 && <p className="muted">No member is enrolled in a plan yet.</p>}
        {data.map(d => (
          <div className="plan-bar-row" key={d.label}>
            <span className="plan-bar-name">{d.label}</span>
            <span className="plan-bar-track">
              <span className="plan-bar-fill" style={{ width: Math.max(2, (d.value / max) * 100) + '%' }} />
            </span>
            <span className="plan-bar-val">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Analytics() {
  const [d, err] = useSeries()
  if (err) return <p className="error">Could not load analytics: {err}</p>
  if (!d) return <p className="muted">Loading…</p>
  return (
    <div>
      <div className="chart-grid">
        <BarSeries data={d.revenue_by_month} title="Revenue (last 6 months)"
          subtitle="Payments recorded per month" fmt={v => '₹' + Number(v).toLocaleString('en-IN')}
          valueFmt={v => (v >= 1000 ? '₹' + Math.round(v / 100) / 10 + 'k' : '₹' + v)} />
        <BarSeries data={d.members_by_month} title="New members (last 6 months)"
          subtitle="Members added per month (by join date)" />
        <LineSeries data={d.checkins} title="Check-ins (last 14 days)"
          subtitle="Daily attendance count" />
        <PlanBars data={d.plans} title="Members per plan"
          subtitle="Members currently enrolled in each plan" />
      </div>
    </div>
  )
}