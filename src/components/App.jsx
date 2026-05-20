import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, fetchLeads, upsertLead, deleteLead, updateLeadStage, updateLeadHistory, signOut } from '../lib/supabase'
import InviteManager from './InviteManager'

// ── Brand ─────────────────────────────────────────────────────
const BK = '#1e1e1e'
const LIME = '#cbd952'
const BG = '#f7f7f5'
const WHITE = '#ffffff'
const BORDER = '#e8e8e4'
const MUTED = '#9ca3af'
const TEXT = '#1f2937'

// ── Constants ─────────────────────────────────────────────────
const STAGES = [
  { id: 'lead',        label: 'Lead',           color: '#6366f1', bg: '#eef2ff', emoji: '🌱' },
  { id: 'prospect',   label: 'Prospect',        color: '#f59e0b', bg: '#fffbeb', emoji: '👀' },
  { id: 'quotation',  label: 'Quotation Sent',  color: '#3b82f6', bg: '#eff6ff', emoji: '📄' },
  { id: 'negotiation',label: 'Negotiation',     color: '#8b5cf6', bg: '#f5f3ff', emoji: '🤝' },
  { id: 'sow_pending',label: 'SOW/SLA Pending', color: '#ec4899', bg: '#fdf2f8', emoji: '✍️' },
  { id: 'onboarding', label: 'Onboarding',      color: '#10b981', bg: '#ecfdf5', emoji: '🚀' },
  { id: 'closed_won', label: 'Closed Won',      color: '#059669', bg: '#d1fae5', emoji: '🏆' },
  { id: 'closed_lost',label: 'Closed Lost',     color: '#ef4444', bg: '#fee2e2', emoji: '❌' },
]

const SERVICES = [
  { id: 'social',   label: 'Social Media Management', emoji: '📱' },
  { id: 'content',  label: 'Content Creation',        emoji: '✍️' },
  { id: 'ads',      label: 'Paid Ads',                emoji: '📢' },
  { id: 'seo',      label: 'SEO & Website',           emoji: '🔍' },
  { id: 'branding', label: 'Branding & Design',       emoji: '🎨' },
  { id: 'strategy', label: 'Strategy & Consulting',   emoji: '🎯' },
  { id: 'pr',       label: 'PR & Communications',     emoji: '📣' },
]

const TEAM = [
  { id: 'you',      name: 'You (Head of Sales)' },
  { id: 'founder2', name: 'Co-founder 2' },
  { id: 'founder3', name: 'Co-founder 3' },
]

const INDUSTRIES = ['Technology','Finance','Healthcare','Retail','Manufacturing','Real Estate','Education','Media','Consulting','Other']
const SOURCES    = ['LinkedIn','Referral','Conference','Cold Outreach','Website','WhatsApp','Other']

// ── Helpers ───────────────────────────────────────────────────
const fmtINR  = v => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v || 0)
const getStage = id => STAGES.find(s => s.id === id) || STAGES[0]
const today   = () => new Date().toISOString().split('T')[0]

// Strip any fields that don't exist in the Supabase leads table before upsert.
// This prevents "column does not exist" errors from crashing saves silently.
const LEAD_COLS = new Set(['id','company','contact','email','phone','whatsapp','industry','value','stage','priority','source','notes','assigned_to','reminder_date','reminder_note','history','services'])
const cleanLead = raw => Object.fromEntries(Object.entries(raw).filter(([k]) => LEAD_COLS.has(k)))

// ── Claude API ────────────────────────────────────────────────
async function callClaude(messages, system, maxTokens = 1000) {
  const body = { model: 'claude-sonnet-4-20250514', max_tokens: maxTokens, messages }
  if (system) body.system = system
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error.message)
  return data.content?.find(b => b.type === 'text')?.text || 'No response.'
}

// ── Logo ──────────────────────────────────────────────────────
const GinnyLogo = ({ size = 34 }) => (
  <div style={{ width: size, height: size, background: LIME, borderRadius: Math.round(size * 0.24), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
    <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 22 20" fill="none">
      <path d="M2 3C2 1.9 2.9 1 4 1H18C19.1 1 20 1.9 20 3V13C20 14.1 19.1 15 18 15H12L8 19V15H4C2.9 15 2 14.1 2 13V3Z" fill={BK} />
    </svg>
  </div>
)

// ── Toast ─────────────────────────────────────────────────────
function useToast() {
  const [toasts, setToasts] = useState([])
  const toast = useCallback((msg, type = 'info') => {
    const id = Date.now()
    setToasts(p => [...p, { id, msg, type }])
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3000)
  }, [])
  return { toasts, toast }
}

function ToastContainer({ toasts }) {
  if (!toasts.length) return null
  return (
    <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', pointerEvents: 'none' }}>
      {toasts.map(t => (
        <div key={t.id} style={{ background: t.type === 'error' ? '#ef4444' : BK, color: WHITE, padding: '10px 22px', borderRadius: 30, fontSize: 13, fontWeight: 500, boxShadow: '0 4px 24px rgba(0,0,0,0.25)', whiteSpace: 'nowrap', animation: 'toastIn 0.2s ease' }}>
          {t.msg}
        </div>
      ))}
    </div>
  )
}

// ── Confetti ──────────────────────────────────────────────────
function Confetti({ onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 2600); return () => clearTimeout(t) }, [onDone])
  const pieces = useRef(Array.from({ length: 64 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    color: [LIME, WHITE, '#6366f1', '#f59e0b', '#10b981', '#ec4899'][i % 6],
    size: 6 + Math.random() * 9,
    delay: Math.random() * 0.6,
    dur: 1.2 + Math.random() * 1,
    rotate: Math.random() > 0.5,
  }))).current
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9998, overflow: 'hidden' }}>
      {pieces.map(p => (
        <div key={p.id} style={{
          position: 'absolute', top: 0, left: `${p.x}%`,
          width: p.size, height: p.size,
          background: p.color,
          borderRadius: p.rotate ? '50%' : 2,
          animation: `confettiFall ${p.dur}s ${p.delay}s ease-in forwards`,
        }} />
      ))}
    </div>
  )
}

// ── Bottom Sheet ──────────────────────────────────────────────
function Sheet({ children, onClose, title, maxWidth = 740 }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.42)' }} onClick={onClose} />
      <div style={{ position: 'relative', background: WHITE, borderRadius: '22px 22px 0 0', width: '100%', maxWidth, margin: '0 auto', maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 -8px 48px rgba(0,0,0,0.2)', animation: 'sheetUp 0.26s cubic-bezier(0.32,0.72,0,1)' }}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '14px 0 6px' }}>
          <div style={{ width: 42, height: 4, background: '#ddd', borderRadius: 4 }} />
        </div>
        {title && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 24px 0' }}>
            <div style={{ fontWeight: 700, fontSize: 18, color: TEXT }}>{title}</div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: MUTED, padding: 4 }}>✕</button>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}

// ── Shared UI ─────────────────────────────────────────────────
const Avatar = ({ name = '?', size = 32 }) => {
  const init = String(name).split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
  const cols = ['#6366f1','#f59e0b','#10b981','#ec4899','#3b82f6','#8b5cf6','#ef4444']
  const bg = cols[(init.charCodeAt(0) || 0) % cols.length]
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: WHITE, fontSize: size * 0.36, fontWeight: 700, flexShrink: 0 }}>
      {init}
    </div>
  )
}

const Badge = ({ label, color, bg }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: bg, color, border: `1px solid ${color}30`, whiteSpace: 'nowrap' }}>
    {label}
  </span>
)

const SheetTabs = ({ tabs, active, onChange }) => (
  <div style={{ display: 'flex', overflowX: 'auto', borderBottom: `1.5px solid ${BORDER}`, margin: '10px 0 0', padding: '0 24px' }}>
    {tabs.map(t => (
      <button key={t.id} onClick={() => onChange(t.id)}
        style={{ padding: '10px 14px', fontSize: 13, fontWeight: active === t.id ? 600 : 400, color: active === t.id ? BK : MUTED, borderBottom: `2.5px solid ${active === t.id ? LIME : 'transparent'}`, background: 'none', border: 'none', borderBottomWidth: 2.5, borderBottomStyle: 'solid', cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'Poppins, sans-serif' }}>
        {t.label}
      </button>
    ))}
  </div>
)

// ── AI Panel (full-screen) ────────────────────────────────────
function AIPanel({ leads, user, onClose }) {
  const [tab, setTab] = useState('ask')
  const [msgs, setMsgs] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [rBusy, setRBusy] = useState(null)
  const [reports, setReports] = useState({})
  const did = useRef(false)

  const sys = `You are a senior sales advisor for Ginny. User is Head of Sales & Strategy. Be sharp, direct, concise.
Pipeline: ${leads.length} leads, active value ${fmtINR(leads.filter(l=>l.stage!=='closed_lost').reduce((s,l)=>s+(l.value||0),0))}
Stages: ${STAGES.map(s=>`${s.label}:${leads.filter(l=>l.stage===s.id).length}`).join(', ')}
Hot: ${leads.filter(l=>['negotiation','sow_pending'].includes(l.stage)).map(l=>`${l.company}(${fmtINR(l.value)})`).join(', ')||'none'}`

  const ctx = `Pipeline ${today()}:\n${STAGES.map(s=>`${s.label}: ${leads.filter(l=>l.stage===s.id).length} deals — ${fmtINR(leads.filter(l=>l.stage===s.id).reduce((a,l)=>a+(l.value||0),0))}`).join('\n')}\n\nDeals:\n${leads.map(l=>`• ${l.company} | ${l.contact} | ${getStage(l.stage).label} | ${fmtINR(l.value)} | ${l.priority}`).join('\n')}`

  const RPTS = [
    { id:'weekly',     label:'📊 Weekly Sales Report',  prompt:`Write a comprehensive Weekly Sales Report for Ginny (digital marketing agency). Sections: Executive Summary, Pipeline Snapshot, Stage breakdown with values, Top 3 opportunities, Deals at risk, Actions for next week.\n\n${ctx}` },
    { id:'conversion', label:'🔁 Conversion Analysis',  prompt:`Write a Conversion Analysis for Ginny. Include stage conversion rates, drop-off points, avg deal value by stage, source effectiveness, 5 recommendations.\n\n${ctx}` },
    { id:'forecast',   label:'📈 Revenue Forecast',     prompt:`Write a Revenue Forecast for Ginny. Include 30/60/90-day projections, probability-weighted forecast (Quotation=40%, Negotiation=65%, SOW=80%, Onboarding=90%, Won=100%), best-case and conservative scenarios in INR.\n\n${ctx}` },
    { id:'coaching',   label:'🎯 Sales Coaching',       prompt:`Write a Sales Coaching Report for Ginny. Per deal: next action, talk track, objection handling. Also: quick wins, deals to drop, process improvements.\n\n${ctx}` },
  ]

  useEffect(() => {
    if (did.current) return
    did.current = true
    const p = 'Give me a sharp 3-point pipeline briefing: what needs immediate attention, what is at risk, and the #1 action I should take today.'
    setMsgs([{ role: 'user', content: p }])
    setBusy(true)
    callClaude([{ role: 'user', content: p }], sys)
      .then(r => setMsgs([{ role: 'user', content: p }, { role: 'assistant', content: r }]))
      .catch(() => setMsgs([{ role: 'user', content: p }, { role: 'assistant', content: 'API error — check your Anthropic key in Vercel.' }]))
      .finally(() => setBusy(false))
  }, [])

  const ask = useCallback(async (prompt) => {
    if (!prompt.trim() || busy) return
    setBusy(true)
    const nm = [...msgs, { role: 'user', content: prompt }]
    setMsgs(nm); setInput('')
    try {
      const r = await callClaude(nm, sys)
      setMsgs(p => [...p, { role: 'assistant', content: r }])
    } catch { setMsgs(p => [...p, { role: 'assistant', content: 'Connection error.' }]) }
    setBusy(false)
  }, [msgs, sys, busy])

  const genReport = async (r) => {
    setRBusy(r.id)
    try {
      const text = await callClaude([{ role: 'user', content: r.prompt }], 'You are a senior sales analyst for Ginny. Write professional structured reports.', 2000)
      setReports(p => ({ ...p, [r.id]: text }))
    } catch { setReports(p => ({ ...p, [r.id]: 'Error — check API key.' })) }
    setRBusy(null)
  }

  const QP = ['Draft follow-up for hottest deal', 'Which leads are going cold?', 'Tips to shorten SOW cycle']

  return (
    <div style={{ position: 'fixed', inset: 0, background: BK, zIndex: 2000, display: 'flex', flexDirection: 'column', fontFamily: 'Poppins, sans-serif' }}>
      {/* Header */}
      <div style={{ padding: '0 24px', height: 60, display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid #2a2a2a', flexShrink: 0 }}>
        <GinnyLogo size={34} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: WHITE }}>Claude Sales Advisor</div>
          <div style={{ fontSize: 11, color: '#666' }}>Live pipeline · Claude Sonnet</div>
        </div>
        <button onClick={onClose} style={{ width: 36, height: 36, borderRadius: '50%', background: '#2a2a2a', border: 'none', color: WHITE, fontSize: 18, cursor: 'pointer' }}>✕</button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #2a2a2a', flexShrink: 0 }}>
        {[{ id: 'ask', label: '✦ Ask AI' }, { id: 'reports', label: '📊 Reports' }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '12px 24px', fontSize: 13, fontWeight: tab === t.id ? 600 : 400, color: tab === t.id ? LIME : '#666', borderBottom: `2px solid ${tab === t.id ? LIME : 'transparent'}`, background: 'none', border: 'none', borderBottomWidth: 2, borderBottomStyle: 'solid', cursor: 'pointer', fontFamily: 'Poppins, sans-serif' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        {tab === 'ask' && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: 200, marginBottom: 20 }}>
              {msgs.map((m, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, flexDirection: m.role === 'user' ? 'row-reverse' : 'row', alignItems: 'flex-start' }}>
                  <div style={{ width: 30, height: 30, borderRadius: '50%', background: m.role === 'user' ? LIME : '#222', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 }}>
                    {m.role === 'user' ? '👤' : '✦'}
                  </div>
                  <div style={{ maxWidth: '76%', background: m.role === 'user' ? LIME : '#1a1a1a', color: m.role === 'user' ? BK : WHITE, padding: '12px 16px', borderRadius: m.role === 'user' ? '14px 4px 14px 14px' : '4px 14px 14px 14px', fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                    {m.content}
                  </div>
                </div>
              ))}
              {busy && <div style={{ color: '#555', fontSize: 13, paddingLeft: 40 }}>✦ Thinking...</div>}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              {QP.map(q => (
                <button key={q} onClick={() => ask(q)} style={{ padding: '6px 14px', border: '1px solid #333', borderRadius: 20, fontSize: 12, background: 'transparent', cursor: 'pointer', color: '#888', fontFamily: 'Poppins, sans-serif' }}>{q}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && ask(input)}
                placeholder="Ask anything about your pipeline..."
                style={{ flex: 1, padding: '12px 16px', background: '#111', border: '1px solid #333', borderRadius: 12, fontSize: 13, color: WHITE, fontFamily: 'Poppins, sans-serif', outline: 'none' }} />
              <button onClick={() => ask(input)} disabled={busy || !input.trim()}
                style={{ padding: '12px 22px', background: LIME, color: BK, border: 'none', borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: busy ? 0.6 : 1, fontFamily: 'Poppins, sans-serif' }}>
                Send
              </button>
            </div>
          </>
        )}

        {tab === 'reports' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {RPTS.map(r => (
              <div key={r.id} style={{ border: '1px solid #2a2a2a', borderRadius: 14, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', gap: 12, background: '#111' }}>
                  <span style={{ flex: 1, fontWeight: 600, fontSize: 14, color: WHITE }}>{r.label}</span>
                  <button onClick={() => genReport(r)} disabled={!!rBusy}
                    style={{ padding: '8px 16px', background: LIME, color: BK, border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: rBusy ? 'not-allowed' : 'pointer', opacity: rBusy === r.id ? 0.6 : 1, fontFamily: 'Poppins, sans-serif', whiteSpace: 'nowrap' }}>
                    {rBusy === r.id ? 'Generating...' : reports[r.id] ? '↺ Redo' : 'Generate'}
                  </button>
                </div>
                {reports[r.id] && (
                  <div style={{ padding: '16px 18px', background: '#0d0d0d' }}>
                    <div style={{ fontSize: 12, color: '#bbb', lineHeight: 1.75, whiteSpace: 'pre-wrap', maxHeight: 260, overflowY: 'auto', marginBottom: 12 }}>{reports[r.id]}</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <a href={`mailto:${user?.email || ''}?subject=${encodeURIComponent(`Ginny — ${r.label} — ${today()}`)}&body=${encodeURIComponent(reports[r.id])}`}
                        style={{ padding: '7px 16px', background: '#059669', color: WHITE, borderRadius: 8, fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>
                        ✉ Email to Me
                      </a>
                      <button onClick={() => navigator.clipboard.writeText(reports[r.id])}
                        style={{ padding: '7px 14px', border: '1px solid #333', borderRadius: 8, fontSize: 12, background: 'transparent', cursor: 'pointer', color: '#bbb', fontFamily: 'Poppins, sans-serif' }}>
                        ⧉ Copy
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Gmail helpers ─────────────────────────────────────────────
function getHeader(headers = [], name) {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || ''
}

function decodeGmailBody(part) {
  if (!part) return ''
  if (part.body?.data) {
    try { return atob(part.body.data.replace(/-/g, '+').replace(/_/g, '/')) } catch { return '' }
  }
  if (part.parts) {
    const plain = part.parts.find(p => p.mimeType === 'text/plain') || part.parts[0]
    return decodeGmailBody(plain)
  }
  return ''
}

function stripHtml(html) {
  return html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
             .replace(/<[^>]+>/g, ' ')
             .replace(/\s{2,}/g, ' ')
             .trim()
}

function gmailThreadSubject(thread) {
  return getHeader(thread?.messages?.[0]?.payload?.headers || [], 'Subject') || '(no subject)'
}

function fmtEmailDate(internalDate) {
  if (!internalDate) return ''
  const d = new Date(Number(internalDate))
  const now = new Date()
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  })
}

function buildDraftReply(lead, thread, svc) {
  const firstName = (lead.contact || '').split(' ')[0] || lead.contact
  const subject   = gmailThreadSubject(thread)
  const activeServices = svc
    ? SERVICES.filter(s => svc[s.id]?.enabled).map(s => s.label)
    : []
  const servicesLine = activeServices.length
    ? `\n\nAs a quick note — we've been discussing the following for ${lead.company}: ${activeServices.join(', ')}.`
    : ''

  const stageLines = {
    sow_pending:   `I wanted to follow up on the Scope of Work / SLA we sent across. Please let me know if you have any questions — we're ready to get started as soon as you're able to sign off.`,
    negotiation:   `I'm following up to see if you have any further thoughts on our proposal. Happy to jump on a quick call to address any concerns — we want to make sure this feels right for ${lead.company}.`,
    quotation:     `I wanted to check in on the quotation we sent over. Do let me know if you'd like to walk through any part of it — we'd love to move this forward.`,
    onboarding:    `I'm reaching out to make sure everything is going smoothly with the onboarding. Please flag anything at all and we'll sort it straight away.`,
    prospect:      `I'd love to explore how Ginny can support ${lead.company}. Would you be open to a brief call this week?`,
    closed_won:    `It's been great working with ${lead.company}! I wanted to touch base — please don't hesitate to reach out if there's anything we can do better.`,
    closed_lost:   `I wanted to check in and see if circumstances have changed. We'd love the opportunity to work together when the time is right.`,
  }
  const body = stageLines[lead.stage] || `I'm following up on our recent conversation. Please let me know if there's anything I can help clarify or move forward.`

  return `Hi ${firstName},\n\nHope you're doing well!\n\n${body}${servicesLine}\n\nRe: ${subject}\n\nLooking forward to hearing from you.\n\nBest regards,\nGinny Sales Team`
}

// ── Gmail Tab ──────────────────────────────────────────────────
function GmailTab({ lead, svc, toast }) {
  const [token, setToken] = useState(() => {
    const t = localStorage.getItem('gmail_token')
    const exp = Number(localStorage.getItem('gmail_token_expiry') || 0)
    return t && Date.now() < exp ? t : null
  })
  const [threads,        setThreads]        = useState([])
  const [loading,        setLoading]        = useState(false)
  const [selectedThread, setSelectedThread] = useState(null)
  const [threadLoading,  setThreadLoading]  = useState(false)
  const [draft,          setDraft]          = useState('')
  const [showDraft,      setShowDraft]      = useState(false)
  const [gisReady,       setGisReady]       = useState(!!window.google?.accounts?.oauth2)
  const clientRef = useRef(null)

  // Load Google Identity Services script once
  useEffect(() => {
    if (window.google?.accounts?.oauth2) return
    const existing = document.querySelector('script[src*="accounts.google.com/gsi"]')
    if (existing) {
      const id = setInterval(() => {
        if (window.google?.accounts?.oauth2) { clearInterval(id); setGisReady(true) }
      }, 100)
      return () => clearInterval(id)
    }
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => setGisReady(true)
    document.head.appendChild(s)
  }, [])

  // Init OAuth token client once GIS is ready
  useEffect(() => {
    if (!gisReady || !import.meta.env.VITE_GOOGLE_CLIENT_ID) return
    clientRef.current = window.google.accounts.oauth2.initTokenClient({
      client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
      callback: resp => {
        if (resp.error) { toast('Google auth error: ' + resp.error, 'error'); return }
        const expiry = Date.now() + (resp.expires_in || 3600) * 1000
        localStorage.setItem('gmail_token', resp.access_token)
        localStorage.setItem('gmail_token_expiry', String(expiry))
        setToken(resp.access_token)
      },
    })
  }, [gisReady])

  // Auto-fetch threads when token is available
  useEffect(() => { if (token) doFetch(token) }, [token])

  const doFetch = async (t) => {
    if (!lead.email) return
    setLoading(true); setSelectedThread(null)
    try {
      const q = `from:${lead.email} OR to:${lead.email}`
      const res = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads?q=${encodeURIComponent(q)}&maxResults=25`,
        { headers: { Authorization: `Bearer ${t}` } }
      )
      if (res.status === 401) { doSignOut(); setLoading(false); return }
      const list = await res.json()
      if (list.error) throw new Error(list.error.message)

      const details = await Promise.all((list.threads || []).map(th =>
        fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/threads/${th.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
          { headers: { Authorization: `Bearer ${t}` } }
        ).then(r => r.json())
      ))
      setThreads(details.filter(d => !d.error))
    } catch (e) { toast('Gmail: ' + e.message, 'error') }
    setLoading(false)
  }

  const openThread = async (id) => {
    setThreadLoading(true); setShowDraft(false); setDraft('')
    try {
      const res = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${id}?format=full`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      const data = await res.json()
      if (data.error) throw new Error(data.error.message)
      setSelectedThread(data)
    } catch (e) { toast('Could not load thread: ' + e.message, 'error') }
    setThreadLoading(false)
  }

  const doSignOut = () => {
    if (token) window.google?.accounts?.oauth2?.revoke(token, () => {})
    localStorage.removeItem('gmail_token')
    localStorage.removeItem('gmail_token_expiry')
    setToken(null); setThreads([]); setSelectedThread(null)
  }

  // Missing Client ID
  if (!import.meta.env.VITE_GOOGLE_CLIENT_ID) return (
    <div style={{ textAlign: 'center', padding: '36px 16px', color: MUTED, fontSize: 13, lineHeight: 1.7 }}>
      Add <code style={{ background: BG, padding: '2px 6px', borderRadius: 4 }}>VITE_GOOGLE_CLIENT_ID</code> to your Vercel environment variables to enable Gmail integration.
    </div>
  )

  // No email on lead
  if (!lead.email) return (
    <div style={{ textAlign: 'center', padding: '36px 16px', color: MUTED, fontSize: 13 }}>
      No email address on this lead — add one to search Gmail.
    </div>
  )

  // Not authenticated
  if (!token) return (
    <div style={{ textAlign: 'center', padding: '48px 20px' }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>📧</div>
      <div style={{ fontWeight: 700, fontSize: 16, color: TEXT, marginBottom: 6 }}>Connect Gmail</div>
      <div style={{ fontSize: 13, color: MUTED, marginBottom: 28 }}>
        Find all emails with <strong>{lead.email}</strong>
      </div>
      <button
        onClick={() => clientRef.current?.requestAccessToken()}
        style={{ padding: '12px 30px', background: BK, color: WHITE, border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'Poppins, sans-serif' }}>
        Sign in with Google
      </button>
    </div>
  )

  // Full thread view
  if (threadLoading) return (
    <div style={{ textAlign: 'center', padding: '48px 0', color: MUTED, fontSize: 13 }}>Loading thread…</div>
  )

  if (selectedThread) {
    const subject = gmailThreadSubject(selectedThread)
    return (
      <div>
        <button onClick={() => { setSelectedThread(null); setShowDraft(false); setDraft('') }}
          style={{ background: 'none', border: 'none', color: LIME, cursor: 'pointer', fontSize: 13, fontWeight: 600, marginBottom: 16, padding: 0, fontFamily: 'Poppins, sans-serif' }}>
          ← Back to threads
        </button>
        <div style={{ fontWeight: 700, fontSize: 15, color: TEXT, marginBottom: 18 }}>{subject}</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
          {selectedThread.messages?.map(msg => {
            const h    = msg.payload?.headers || []
            const from = getHeader(h, 'From')
            const date = fmtEmailDate(msg.internalDate)
            const raw  = decodeGmailBody(msg.payload)
            const body = raw.includes('<') ? stripHtml(raw) : raw
            return (
              <div key={msg.id} style={{ border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ padding: '10px 14px', background: BG, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>{from}</span>
                  <span style={{ fontSize: 11, color: MUTED, flexShrink: 0 }}>{date}</span>
                </div>
                <div style={{ padding: '12px 14px', fontSize: 12, color: TEXT, lineHeight: 1.75, whiteSpace: 'pre-wrap', maxHeight: 220, overflowY: 'auto', wordBreak: 'break-word' }}>
                  {body.trim() || '(No readable content)'}
                </div>
              </div>
            )
          })}
        </div>

        {!showDraft && (
          <button
            onClick={() => { setDraft(buildDraftReply(lead, selectedThread, svc)); setShowDraft(true) }}
            style={{ padding: '10px 22px', background: BK, color: WHITE, border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Poppins, sans-serif' }}>
            ✦ Draft Reply
          </button>
        )}

        {showDraft && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: TEXT, marginBottom: 8 }}>Suggested Reply</div>
            <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={10}
              style={{ width: '100%', padding: 12, border: `1.5px solid ${BORDER}`, borderRadius: 12, fontSize: 13, lineHeight: 1.65, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'Poppins, sans-serif', color: TEXT }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <button onClick={() => navigator.clipboard.writeText(draft)}
                style={{ padding: '9px 16px', border: `1.5px solid ${BORDER}`, borderRadius: 10, background: WHITE, cursor: 'pointer', fontSize: 13, fontFamily: 'Poppins, sans-serif' }}>
                ⧉ Copy
              </button>
              <a href={`https://mail.google.com/mail/u/0/#inbox/${selectedThread.id}`}
                target="_blank" rel="noreferrer"
                style={{ padding: '9px 16px', background: '#ea4335', color: WHITE, borderRadius: 10, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
                Open in Gmail
              </a>
              <button onClick={() => setDraft(buildDraftReply(lead, selectedThread, svc))}
                style={{ padding: '9px 14px', border: `1.5px solid ${BORDER}`, borderRadius: 10, background: WHITE, cursor: 'pointer', fontSize: 13, fontFamily: 'Poppins, sans-serif' }}>
                ↺ Reset
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // Thread list view
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: MUTED }}>
          {loading ? 'Searching Gmail…' : `${threads.length} thread${threads.length !== 1 ? 's' : ''} with ${lead.email}`}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => doFetch(token)} disabled={loading}
            style={{ padding: '6px 12px', border: `1px solid ${BORDER}`, borderRadius: 8, background: WHITE, cursor: loading ? 'not-allowed' : 'pointer', fontSize: 12, fontFamily: 'Poppins, sans-serif', opacity: loading ? 0.5 : 1 }}>
            ↺ Refresh
          </button>
          <button onClick={doSignOut}
            style={{ padding: '6px 12px', border: `1px solid ${BORDER}`, borderRadius: 8, background: WHITE, cursor: 'pointer', fontSize: 12, color: MUTED, fontFamily: 'Poppins, sans-serif' }}>
            Sign out
          </button>
        </div>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: '40px 0', color: MUTED, fontSize: 13 }}>Searching Gmail…</div>}

      {!loading && threads.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: MUTED, fontSize: 13 }}>No emails found with {lead.email}</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {threads.map(thread => {
          const lastMsg = thread.messages?.[thread.messages.length - 1]
          const subject = getHeader(thread.messages?.[0]?.payload?.headers || [], 'Subject') || '(no subject)'
          const from    = getHeader(lastMsg?.payload?.headers || [], 'From')
          const date    = fmtEmailDate(lastMsg?.internalDate)
          const count   = thread.messages?.length || 0
          return (
            <div key={thread.id} onClick={() => openThread(thread.id)}
              style={{ border: `1px solid ${BORDER}`, borderRadius: 12, padding: '12px 16px', cursor: 'pointer', background: WHITE, transition: 'border-color 0.15s, box-shadow 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = LIME; e.currentTarget.style.boxShadow = `0 2px 12px ${LIME}22` }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.boxShadow = 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: TEXT, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subject}</div>
                <div style={{ fontSize: 11, color: MUTED, flexShrink: 0 }}>{date}</div>
              </div>
              <div style={{ fontSize: 12, color: MUTED }}>
                {from}
                {count > 1 && <span style={{ marginLeft: 8, background: BG, borderRadius: 8, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>{count}</span>}
              </div>
              {thread.snippet && (
                <div style={{ fontSize: 11, color: '#bbb', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{thread.snippet}</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Lead Detail (bottom sheet, 6 tabs) ────────────────────────
function LeadDetail({ lead: init, leads, onClose, onEdit, onDelete, onStageChange, onLogAction, toast }) {
  const [tab, setTab] = useState('info')
  const lead = leads.find(l => l.id === init.id) || init
  const stage = getStage(lead.stage)

  // Services local state
  const [svc, setSvc] = useState(() => Object.fromEntries(
    SERVICES.map(s => [s.id, {
      enabled:   (lead.services || {})[s.id]?.enabled   || false,
      price:     (lead.services || {})[s.id]?.price     || '',
      frequency: (lead.services || {})[s.id]?.frequency || 'monthly',
      notes:     (lead.services || {})[s.id]?.notes     || '',
    }])
  ))
  const [savingSvc, setSavingSvc] = useState(false)
  const svcTotal = SERVICES.reduce((sum, s) => sum + (svc[s.id]?.enabled ? (Number(svc[s.id]?.price) || 0) : 0), 0)

  // Send tab
  const [sendType, setSendType] = useState(null)
  const [draft, setDraft] = useState('')
  const [draftBusy, setDraftBusy] = useState(false)

  const SEND_OPTS = [
    { type: 'quotation', label: '✉️ Draft Quotation Email' },
    { type: 'sow',       label: '📝 Request SOW Signature' },
    { type: 'whatsapp',  label: '💬 WhatsApp Follow-up' },
    { type: 'onboarding',label: '🤝 Introduce Ops Team' },
    { type: 'followup',  label: '↩ Draft Follow-up' },
  ]

  const SEND_PROMPTS = {
    quotation:  `Write a professional sales quotation email for ${lead.company}. Contact: ${lead.contact}. Deal value: ${fmtINR(lead.value)}. From Ginny's Head of Sales. Warm but professional. Clear CTA.`,
    sow:        `Write an email to ${lead.contact} at ${lead.company} requesting signature on our Scope of Work / SLA. Deal: ${fmtINR(lead.value)}. Mention DocuSign. Professional, reassuring tone.`,
    whatsapp:   `Write a WhatsApp message under 120 words to ${lead.contact} from ${lead.company}. Friendly follow-up on quotation. Deal: ${fmtINR(lead.value)}. Human, not salesy.`,
    onboarding: `Write a warm intro email introducing Ginny's ops team to ${lead.contact} at ${lead.company}. Excited about the partnership. Deal: ${fmtINR(lead.value)}.`,
    followup:   `Write a follow-up email to ${lead.contact} at ${lead.company}. Stage: ${stage.label}. Value: ${fmtINR(lead.value)}. Notes: ${lead.notes || 'none'}. Warm, gentle urgency.`,
  }

  const generateDraft = async (type) => {
    setSendType(type); setDraft(''); setDraftBusy(true)
    try { setDraft(await callClaude([{ role: 'user', content: SEND_PROMPTS[type] }], undefined, 800)) }
    catch { setDraft('Could not generate — check API key.') }
    setDraftBusy(false)
  }

  const saveServices = async () => {
    setSavingSvc(true)
    const { error } = await upsertLead(cleanLead({ ...lead, services: svc }))
    if (error) toast('Save failed: ' + error.message, 'error')
    else toast('Services saved ✓')
    setSavingSvc(false)
  }

  const TABS = [
    { id: 'info',     label: 'Info' },
    { id: 'services', label: '💼 Services' },
    { id: 'move',     label: '→ Stage' },
    { id: 'send',     label: '✉ Send' },
    { id: 'emails',   label: '📧 Emails' },
    { id: 'history',  label: 'History' },
  ]

  const priColor = { critical: '#ef4444', high: '#f59e0b', medium: '#3b82f6', low: MUTED }
  const priBg    = { critical: '#fee2e2', high: '#fffbeb', medium: '#eff6ff', low: '#f9fafb' }

  return (
    <Sheet onClose={onClose}>
      {/* Lead header */}
      <div style={{ padding: '12px 24px 0', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <Avatar name={lead.company} size={48} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 19, color: TEXT }}>{lead.company}</div>
          <div style={{ fontSize: 13, color: MUTED }}>{lead.contact} · {lead.email}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Badge label={stage.label} color={stage.color} bg={stage.bg} />
            <Badge label={lead.priority} color={priColor[lead.priority] || MUTED} bg={priBg[lead.priority] || '#f9fafb'} />
            <span style={{ fontSize: 15, fontWeight: 700, color: '#059669' }}>{fmtINR(lead.value)}</span>
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: MUTED, padding: 4, flexShrink: 0 }}>✕</button>
      </div>

      <SheetTabs tabs={TABS} active={tab} onChange={t => { setTab(t); setSendType(null) }} />

      <div style={{ padding: '20px 24px 36px' }}>

        {/* Info */}
        {tab === 'info' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
              {[['Phone', lead.phone], ['WhatsApp', lead.whatsapp], ['Industry', lead.industry], ['Source', lead.source], ['Assigned To', TEAM.find(t => t.id === lead.assigned_to)?.name]].map(([k, v]) => (
                <div key={k} style={{ background: BG, borderRadius: 10, padding: '10px 14px' }}>
                  <div style={{ fontSize: 11, color: MUTED, marginBottom: 2 }}>{k}</div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{v || '—'}</div>
                </div>
              ))}
              {lead.reminder_date && (
                <div style={{ background: '#fffbeb', borderRadius: 10, padding: '10px 14px', border: '1px solid #fcd34d' }}>
                  <div style={{ fontSize: 11, color: '#92400e', marginBottom: 2 }}>⏰ Reminder</div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{lead.reminder_date}</div>
                  <div style={{ fontSize: 12, color: MUTED }}>{lead.reminder_note}</div>
                </div>
              )}
            </div>
            {lead.notes && <div style={{ background: BG, borderRadius: 10, padding: '12px 14px', fontSize: 13, color: TEXT, lineHeight: 1.65, marginBottom: 16 }}>{lead.notes}</div>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => onEdit(lead)} style={{ padding: '10px 22px', border: `1.5px solid ${LIME}`, color: BK, borderRadius: 10, background: WHITE, cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'Poppins, sans-serif' }}>✎ Edit Lead</button>
              <button onClick={() => { if (window.confirm(`Delete ${lead.company}? This cannot be undone.`)) onDelete(lead.id) }} style={{ padding: '10px 18px', border: '1.5px solid #ef4444', color: '#ef4444', borderRadius: 10, background: WHITE, cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'Poppins, sans-serif' }}>🗑 Delete</button>
            </div>
          </div>
        )}

        {/* Services */}
        {tab === 'services' && (
          <div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
              {SERVICES.map(s => {
                const sv = svc[s.id]
                return (
                  <div key={s.id} style={{ border: `1.5px solid ${sv.enabled ? LIME : BORDER}`, borderRadius: 12, overflow: 'hidden', background: sv.enabled ? '#fafff0' : WHITE, transition: 'border 0.15s, background 0.15s' }}>
                    <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', gap: 10, cursor: 'pointer' }}
                      onClick={() => setSvc(p => ({ ...p, [s.id]: { ...p[s.id], enabled: !p[s.id].enabled } }))}>
                      <span style={{ fontSize: 18 }}>{s.emoji}</span>
                      <span style={{ flex: 1, fontWeight: 500, fontSize: 14, color: TEXT }}>{s.label}</span>
                      <div style={{ width: 22, height: 22, borderRadius: '50%', background: sv.enabled ? LIME : BORDER, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: sv.enabled ? BK : WHITE, fontWeight: 700, transition: 'all 0.15s', flexShrink: 0 }}>
                        {sv.enabled ? '✓' : ''}
                      </div>
                    </div>
                    {sv.enabled && (
                      <div style={{ padding: '0 16px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <div>
                          <div style={{ fontSize: 11, color: MUTED, marginBottom: 4 }}>Price / month (₹)</div>
                          <input type="number" value={sv.price} placeholder="0"
                            onChange={e => setSvc(p => ({ ...p, [s.id]: { ...p[s.id], price: e.target.value } }))}
                            style={{ width: '100%', padding: '8px 10px', border: `1.5px solid ${BORDER}`, borderRadius: 8, fontSize: 13, boxSizing: 'border-box', fontFamily: 'Poppins, sans-serif' }} />
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: MUTED, marginBottom: 4 }}>Frequency</div>
                          <select value={sv.frequency} onChange={e => setSvc(p => ({ ...p, [s.id]: { ...p[s.id], frequency: e.target.value } }))}
                            style={{ width: '100%', padding: '8px 10px', border: `1.5px solid ${BORDER}`, borderRadius: 8, fontSize: 13, fontFamily: 'Poppins, sans-serif' }}>
                            <option value="monthly">Monthly</option>
                            <option value="quarterly">Quarterly</option>
                            <option value="one-time">One-time</option>
                          </select>
                        </div>
                        <div style={{ gridColumn: '1/-1' }}>
                          <div style={{ fontSize: 11, color: MUTED, marginBottom: 4 }}>Notes</div>
                          <input value={sv.notes} placeholder="Specifics..."
                            onChange={e => setSvc(p => ({ ...p, [s.id]: { ...p[s.id], notes: e.target.value } }))}
                            style={{ width: '100%', padding: '8px 10px', border: `1.5px solid ${BORDER}`, borderRadius: 8, fontSize: 13, boxSizing: 'border-box', fontFamily: 'Poppins, sans-serif' }} />
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <div style={{ background: BK, borderRadius: 14, padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ color: WHITE, fontSize: 14, fontWeight: 600 }}>Suite Total / Month</div>
              <div style={{ color: LIME, fontSize: 24, fontWeight: 700 }}>{fmtINR(svcTotal)}</div>
            </div>
            <button onClick={saveServices} disabled={savingSvc}
              style={{ padding: '11px 26px', background: LIME, color: BK, border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Poppins, sans-serif', opacity: savingSvc ? 0.6 : 1 }}>
              {savingSvc ? 'Saving...' : 'Save Services'}
            </button>
          </div>
        )}

        {/* Move Stage */}
        {tab === 'move' && (
          <div>
            <div style={{ fontSize: 13, color: MUTED, marginBottom: 16 }}>Currently: <strong style={{ color: TEXT }}>{stage.emoji} {stage.label}</strong></div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {STAGES.filter(s => s.id !== lead.stage).map(s => (
                <button key={s.id} onClick={async () => {
                  await onStageChange(lead.id, s.id)
                  onLogAction(lead.id, `Moved to ${s.label}`)
                  if (s.id !== 'closed_won') toast(`${s.emoji} Moved to ${s.label}`)
                  onClose()
                }}
                  style={{ padding: '10px 18px', border: `1.5px solid ${s.color}`, color: s.color, borderRadius: 22, background: s.bg, cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'Poppins, sans-serif' }}>
                  {s.emoji} {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Send */}
        {tab === 'send' && (
          <div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
              {SEND_OPTS.map(o => (
                <button key={o.type} onClick={() => generateDraft(o.type)}
                  style={{ padding: '10px 16px', border: `1.5px solid ${sendType === o.type ? LIME : BORDER}`, borderRadius: 10, background: sendType === o.type ? '#fafff0' : WHITE, cursor: 'pointer', fontSize: 13, fontFamily: 'Poppins, sans-serif', fontWeight: sendType === o.type ? 600 : 400 }}>
                  {o.label}
                </button>
              ))}
            </div>
            {sendType && (
              <div>
                {draftBusy
                  ? <div style={{ textAlign: 'center', padding: '32px 0', color: '#6366f1', fontSize: 14 }}>Drafting with Claude...</div>
                  : <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={10}
                      style={{ width: '100%', padding: '12px', border: `1.5px solid ${BORDER}`, borderRadius: 12, fontSize: 13, lineHeight: 1.65, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'Poppins, sans-serif' }} />
                }
                {!draftBusy && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    <button onClick={() => generateDraft(sendType)} style={{ padding: '9px 14px', border: `1.5px solid ${BORDER}`, borderRadius: 10, background: WHITE, cursor: 'pointer', fontSize: 13, fontFamily: 'Poppins, sans-serif' }}>↺ Regenerate</button>
                    <button onClick={() => navigator.clipboard.writeText(draft)} style={{ padding: '9px 14px', border: `1.5px solid ${BORDER}`, borderRadius: 10, background: WHITE, cursor: 'pointer', fontSize: 13, fontFamily: 'Poppins, sans-serif' }}>⧉ Copy</button>
                    {sendType !== 'whatsapp' && (
                      <a href={`mailto:${lead.email}?subject=${encodeURIComponent('Regarding our proposal — Ginny')}&body=${encodeURIComponent(draft)}`}
                        style={{ padding: '9px 16px', background: BK, color: WHITE, borderRadius: 10, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
                        Open in Mail
                      </a>
                    )}
                    {sendType === 'whatsapp' && (
                      <a href={`https://wa.me/${(lead.whatsapp || '').replace(/\D/g, '')}?text=${encodeURIComponent(draft)}`}
                        target="_blank" rel="noreferrer"
                        style={{ padding: '9px 16px', background: '#25d366', color: WHITE, borderRadius: 10, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
                        Open in WhatsApp
                      </a>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Emails */}
        {tab === 'emails' && <GmailTab lead={lead} svc={svc} toast={toast} />}

        {/* History */}
        {tab === 'history' && (
          <div>
            {!(lead.history || []).length && <div style={{ color: MUTED, fontSize: 13 }}>No history yet.</div>}
            {(lead.history || []).slice().reverse().map((h, i, arr) => (
              <div key={i} style={{ display: 'flex', gap: 12, paddingBottom: 14 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: LIME, marginTop: 5, flexShrink: 0 }} />
                  {i < arr.length - 1 && <div style={{ width: 1, flex: 1, background: BORDER, marginTop: 4 }} />}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: TEXT }}>{h.action}</div>
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{h.date}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  )
}

// ── Form Field (module-level — must not be defined inside any component) ──
const FIELD_ST = { width: '100%', padding: '9px 12px', border: `1.5px solid ${BORDER}`, borderRadius: 8, fontSize: 13, color: TEXT, boxSizing: 'border-box', fontFamily: 'Poppins, sans-serif', outline: 'none' }

function FormField({ label, value, onChange, type = 'text', opts }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: TEXT, marginBottom: 5 }}>{label}</label>
      {opts?.select
        ? <select value={value} onChange={onChange} style={FIELD_ST}>{opts.options.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}</select>
        : opts?.textarea
          ? <textarea value={value} onChange={onChange} rows={3} style={{ ...FIELD_ST, resize: 'vertical' }} />
          : <input type={type} value={value} onChange={onChange} style={FIELD_ST} />
      }
    </div>
  )
}

// ── Lead Form (bottom sheet) ───────────────────────────────────
function LeadForm({ lead, onSave, onClose, toast }) {
  const blank = { company: '', contact: '', email: '', phone: '', whatsapp: '', industry: 'Technology', value: '', stage: 'lead', priority: 'medium', source: '', notes: '', assigned_to: 'you', reminder_date: '', reminder_note: '', history: [] }
  const [form, setForm] = useState(lead ? { ...lead, value: lead.value || '', reminder_date: lead.reminder_date || '', reminder_note: lead.reminder_note || '' } : blank)
  const [saving, setSaving] = useState(false)
  const set = useCallback((k, v) => setForm(f => ({ ...f, [k]: v })), [])

  const save = async () => {
    if (!form.company.trim()) return alert('Company name is required.')
    if (!form.contact.trim()) return alert('Contact name is required.')
    if (!form.email.trim() && !form.phone.trim()) return alert('Please enter at least an email or phone number.')
    setSaving(true)
    const raw = { ...form, value: Number(form.value) || 0 }
    if (!raw.id) raw.history = [{ date: today(), action: 'Lead created' }]
    const { data, error } = await upsertLead(cleanLead(raw))
    if (error) { alert('Save failed: ' + error.message); setSaving(false); return }
    toast(lead ? 'Lead updated ✓' : 'Lead added ✓')
    onSave(data)
    setSaving(false)
  }

  return (
    <Sheet onClose={onClose} title={lead ? 'Edit Lead' : 'Add New Lead'}>
      <div style={{ padding: '20px 24px 36px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
          <FormField label="Company *"      value={form.company}       onChange={e => set('company', e.target.value)} />
          <FormField label="Contact Name *" value={form.contact}       onChange={e => set('contact', e.target.value)} />
          <FormField label="Email *"        value={form.email}         onChange={e => set('email', e.target.value)}        type="email" />
          <FormField label="Phone"          value={form.phone}         onChange={e => set('phone', e.target.value)}         type="tel" />
          <FormField label="WhatsApp"       value={form.whatsapp}      onChange={e => set('whatsapp', e.target.value)}      type="tel" />
          <FormField label="Industry"       value={form.industry}      onChange={e => set('industry', e.target.value)}      opts={{ select: true, options: INDUSTRIES }} />
          <FormField label="Deal Value (₹)" value={form.value}         onChange={e => set('value', e.target.value)}         type="number" />
          <FormField label="Stage"          value={form.stage}         onChange={e => set('stage', e.target.value)}         opts={{ select: true, options: STAGES.map(s => ({ value: s.id, label: s.label })) }} />
          <FormField label="Priority"       value={form.priority}      onChange={e => set('priority', e.target.value)}      opts={{ select: true, options: ['critical', 'high', 'medium', 'low'] }} />
          <FormField label="Assigned To"    value={form.assigned_to}   onChange={e => set('assigned_to', e.target.value)}   opts={{ select: true, options: TEAM.map(t => ({ value: t.id, label: t.name })) }} />
          <FormField label="Lead Source"    value={form.source}        onChange={e => set('source', e.target.value)}        opts={{ select: true, options: ['', ...SOURCES] }} />
          <FormField label="Reminder Date"  value={form.reminder_date} onChange={e => set('reminder_date', e.target.value)} type="date" />
        </div>
        <FormField label="Reminder Note" value={form.reminder_note} onChange={e => set('reminder_note', e.target.value)} opts={{ textarea: true }} />
        <FormField label="Notes"         value={form.notes}         onChange={e => set('notes', e.target.value)}         opts={{ textarea: true }} />
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '11px 22px', border: `1.5px solid ${BORDER}`, borderRadius: 10, background: WHITE, cursor: 'pointer', fontSize: 14, fontFamily: 'Poppins, sans-serif' }}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ padding: '11px 28px', background: LIME, color: BK, border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 700, fontFamily: 'Poppins, sans-serif', opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Saving...' : 'Save Lead'}
          </button>
        </div>
      </div>
    </Sheet>
  )
}

// ── Funnel View ───────────────────────────────────────────────
function FunnelView({ leads }) {
  const active = leads.filter(l => l.stage !== 'closed_lost')
  const total = active.length || 1
  return (
    <div>
      <div style={{ background: BK, borderRadius: 18, padding: '22px 28px', marginBottom: 22 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 20 }}>
          {[
            { label: 'Active Pipeline',  value: fmtINR(active.reduce((s,l)=>s+(l.value||0),0)), color: LIME },
            { label: 'Closed Won',       value: fmtINR(leads.filter(l=>l.stage==='closed_won').reduce((s,l)=>s+(l.value||0),0)), color: '#10b981' },
            { label: 'Expected (75%)',   value: fmtINR(leads.filter(l=>['negotiation','sow_pending','onboarding'].includes(l.stage)).reduce((s,l)=>s+(l.value||0)*0.75,0)), color: '#f59e0b' },
          ].map(m => (
            <div key={m.label} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: '#666', marginBottom: 6 }}>{m.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: m.color }}>{m.value}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ background: WHITE, borderRadius: 16, padding: '22px 24px', border: `1px solid ${BORDER}` }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: TEXT, marginBottom: 18 }}>Sales Funnel</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {STAGES.filter(s => s.id !== 'closed_lost').map(s => {
            const count = leads.filter(l => l.stage === s.id).length
            const val   = leads.filter(l => l.stage === s.id).reduce((a,l) => a+(l.value||0), 0)
            const pct   = Math.max(Math.round((count/total)*100), count > 0 ? 4 : 0)
            return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 148, fontSize: 12, color: TEXT, flexShrink: 0 }}>{s.emoji} {s.label}</div>
                <div style={{ flex: 1, background: BG, borderRadius: 8, height: 30, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: s.color, borderRadius: 8, display: 'flex', alignItems: 'center', paddingLeft: 10, minWidth: count > 0 ? 32 : 0, transition: 'width 0.5s ease' }}>
                    {count > 0 && <span style={{ color: WHITE, fontSize: 12, fontWeight: 700 }}>{count}</span>}
                  </div>
                </div>
                <div style={{ width: 112, fontSize: 12, color: MUTED, textAlign: 'right', flexShrink: 0 }}>{val > 0 ? fmtINR(val) : '—'}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Briefing View ─────────────────────────────────────────────
function BriefingView({ leads }) {
  const overdue = leads.filter(l => l.reminder_date && l.reminder_date < today())
  const due     = leads.filter(l => l.reminder_date === today())
  const won     = leads.filter(l => l.stage === 'closed_won').reduce((s,l) => s+(l.value||0), 0)
  const mailBody = [
    'GINNY CRM — DAILY BRIEFING', `Date: ${today()}`, '',
    `TODAY (${due.length}):`, ...due.map(l => `• ${l.company} (${l.contact}): ${l.reminder_note||'No note'} | ${getStage(l.stage).label} | ${fmtINR(l.value)}`),
    '', `OVERDUE (${overdue.length}):`, ...overdue.map(l => `• ${l.company}: ${l.reminder_note||'No note'} (Due: ${l.reminder_date})`),
    '', 'PIPELINE:', ...STAGES.map(s => `• ${s.label}: ${leads.filter(l=>l.stage===s.id).length} — ${fmtINR(leads.filter(l=>l.stage===s.id).reduce((a,l)=>a+(l.value||0),0))}`),
    '', `ACTIVE TOTAL: ${fmtINR(leads.filter(l=>l.stage!=='closed_lost').reduce((s,l)=>s+(l.value||0),0))}`,
  ].join('\n')

  return (
    <div>
      <div style={{ background: BK, borderRadius: 20, padding: '26px 28px', marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: '#666', letterSpacing: 1, marginBottom: 4 }}>DAILY BRIEFING</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: WHITE, marginBottom: 22 }}>
          {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
          {[
            { label: '⏰ Due Today', value: due.length,  color: due.length > 0 ? '#f59e0b' : MUTED },
            { label: '🔴 Overdue',   value: overdue.length, color: overdue.length > 0 ? '#ef4444' : MUTED },
            { label: '🏆 Won',       value: fmtINR(won), color: LIME, small: true },
          ].map(m => (
            <div key={m.label} style={{ background: '#ffffff0f', borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ fontSize: 11, color: '#777', marginBottom: 6 }}>{m.label}</div>
              <div style={{ fontSize: m.small ? 16 : 30, fontWeight: 700, color: m.color }}>{m.value}</div>
            </div>
          ))}
        </div>
      </div>

      {[...overdue, ...due].length === 0
        ? <div style={{ textAlign: 'center', padding: '40px', color: MUTED, background: WHITE, borderRadius: 16, border: `1px solid ${BORDER}`, fontSize: 14 }}>🎉 No reminders today — you're all caught up!</div>
        : <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
            {[...overdue, ...due].map(l => (
              <div key={l.id} style={{ background: WHITE, borderRadius: 14, padding: '14px 18px', border: `1px solid ${l.reminder_date < today() ? '#fca5a5' : '#fcd34d'}`, display: 'flex', alignItems: 'center', gap: 12 }}>
                <Avatar name={l.company} size={38} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: TEXT }}>{l.company} <span style={{ fontWeight: 400, color: MUTED }}>— {l.contact}</span></div>
                  <div style={{ fontSize: 12, color: TEXT, marginTop: 2 }}>{l.reminder_note || 'No note'}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <Badge label={getStage(l.stage).label} color={getStage(l.stage).color} bg={getStage(l.stage).bg} />
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>{l.reminder_date}</div>
                </div>
              </div>
            ))}
          </div>
      }

      <a href={`mailto:?subject=${encodeURIComponent(`Ginny CRM — Daily Briefing ${today()}`)}&body=${encodeURIComponent(mailBody)}`}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 26px', background: BK, color: WHITE, borderRadius: 12, textDecoration: 'none', fontSize: 14, fontWeight: 600, fontFamily: 'Poppins, sans-serif' }}>
        ✉ Send Daily Briefing Email
      </a>
    </div>
  )
}

// ── Root App ──────────────────────────────────────────────────
export default function App() {
  const [leads,       setLeads]       = useState([])
  const [view,        setView]        = useState('board')
  const [showForm,    setShowForm]    = useState(false)
  const [editLead,    setEditLead]    = useState(null)
  const [detailLead,  setDetailLead]  = useState(null)
  const [showAI,      setShowAI]      = useState(false)
  const [showInvite,  setShowInvite]  = useState(false)
  const [search,      setSearch]      = useState('')
  const [filterStage, setFilterStage] = useState('all')
  const [user,        setUser]        = useState(null)
  const [userRole,    setUserRole]    = useState('viewer')
  const [dragging,    setDragging]    = useState(null)
  const [dragOver,    setDragOver]    = useState(null)
  const [confetti,    setConfetti]    = useState(false)
  const { toasts, toast } = useToast()

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user))
    loadLeads()
    const ch = supabase.channel('leads-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, loadLeads)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [])

  useEffect(() => {
    if (!user) return
    supabase.from('allowed_users').select('role').eq('email', user.email).maybeSingle()
      .then(({ data }) => data && setUserRole(data.role))
  }, [user])

  const loadLeads = async () => {
    const { data } = await fetchLeads()
    if (data) setLeads(data)
  }

  const saveLead = (lead) => {
    setLeads(prev => prev.find(l => l.id === lead.id) ? prev.map(l => l.id === lead.id ? lead : l) : [lead, ...prev])
    setShowForm(false)
    setEditLead(null)
  }

  const handleDeleteLead = async (id) => {
    const { error } = await deleteLead(id)
    if (error) { toast('Delete failed: ' + error.message, 'error'); return }
    setLeads(prev => prev.filter(l => l.id !== id))
    setDetailLead(null)
    toast('Lead deleted')
  }

  const stageChange = async (id, stage) => {
    await updateLeadStage(id, stage)
    setLeads(prev => prev.map(l => l.id === id ? { ...l, stage } : l))
    if (stage === 'closed_won') { setConfetti(true); toast('🏆 Deal closed! Congratulations!') }
  }

  const logAction = async (id, action) => {
    const lead = leads.find(l => l.id === id)
    if (!lead) return
    const history = [...(lead.history || []), { date: today(), action }]
    await updateLeadHistory(id, history)
    setLeads(prev => prev.map(l => l.id === id ? { ...l, history } : l))
  }

  const filtered = leads.filter(l => {
    const q = search.toLowerCase()
    return (!q || [l.company, l.contact, l.email].some(v => (v || '').toLowerCase().includes(q)))
      && (filterStage === 'all' || l.stage === filterStage)
  })

  const pipelineVal  = leads.filter(l => l.stage !== 'closed_lost').reduce((s,l) => s+(l.value||0), 0)
  const hotVal       = leads.filter(l => ['negotiation','sow_pending'].includes(l.stage)).reduce((s,l) => s+(l.value||0), 0)
  const todayCount   = leads.filter(l => l.reminder_date === today()).length
  const overdueCount = leads.filter(l => l.reminder_date && l.reminder_date < today()).length
  const canEdit      = ['admin','editor'].includes(userRole)
  const isAdmin      = userRole === 'admin'

  const onDragStart = (e, id) => { setDragging(id); e.dataTransfer.effectAllowed = 'move' }
  const onDragOver  = (e, sid) => { e.preventDefault(); setDragOver(sid) }
  const onDragEnd   = () => { setDragging(null); setDragOver(null) }
  const onDrop = async (e, sid) => {
    e.preventDefault()
    if (dragging) {
      const lead = leads.find(l => l.id === dragging)
      if (lead && lead.stage !== sid) {
        await stageChange(dragging, sid)
        await logAction(dragging, `Moved to ${getStage(sid).label}`)
        if (sid !== 'closed_won') toast(`Moved to ${getStage(sid).label}`)
      }
    }
    setDragging(null); setDragOver(null)
  }

  return (
    <div style={{ minHeight: '100vh', background: BG, fontFamily: 'Poppins, sans-serif' }}>
      <style>{`
        @keyframes sheetUp    { from { transform: translateY(60px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
        @keyframes toastIn    { from { opacity: 0; transform: translateX(-50%) translateY(12px) } to { opacity: 1; transform: translateX(-50%) translateY(0) } }
        @keyframes confettiFall { 0% { transform: translateY(-10px) rotate(0deg); opacity: 1 } 100% { transform: translateY(105vh) rotate(720deg); opacity: 0 } }
        * { box-sizing: border-box }
        ::-webkit-scrollbar { width: 5px; height: 5px }
        ::-webkit-scrollbar-thumb { background: #ddd; border-radius: 4px }
        input:focus, select:focus, textarea:focus { outline: none; border-color: ${LIME} !important; box-shadow: 0 0 0 3px ${LIME}22 }
      `}</style>

      {/* ── Topbar ── */}
      <div style={{ background: BK, height: 62, padding: '0 24px', display: 'flex', alignItems: 'center', gap: 14, position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginRight: 6 }}>
          <GinnyLogo size={34} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: WHITE, letterSpacing: -0.3 }}>Ginny</div>
            <div style={{ fontSize: 10, color: '#666', lineHeight: 1 }}>Sales CRM</div>
          </div>
        </div>

        {/* Pill nav */}
        <div style={{ display: 'flex', background: '#2a2a2a', borderRadius: 30, padding: 3, gap: 2 }}>
          {[['board','Board'],['funnel','Funnel'],['briefing','Briefing']].map(([id, label]) => (
            <button key={id} onClick={() => setView(id)}
              style={{ padding: '6px 18px', borderRadius: 26, border: 'none', background: view === id ? LIME : 'transparent', color: view === id ? BK : '#777', fontWeight: view === id ? 700 : 400, cursor: 'pointer', fontSize: 13, fontFamily: 'Poppins, sans-serif', position: 'relative', transition: 'all 0.15s' }}>
              {label}
              {id === 'briefing' && (todayCount + overdueCount) > 0 && (
                <span style={{ position: 'absolute', top: 0, right: 2, background: '#ef4444', color: WHITE, borderRadius: 10, fontSize: 8, padding: '1px 5px', lineHeight: 1.5, fontWeight: 700 }}>{todayCount + overdueCount}</span>
              )}
            </button>
          ))}
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => setShowAI(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 18px', border: `1.5px solid ${LIME}`, borderRadius: 22, background: 'transparent', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: LIME, fontFamily: 'Poppins, sans-serif' }}>
            ✦ Ask AI
          </button>
          {isAdmin && (
            <button onClick={() => setShowInvite(true)}
              style={{ padding: '7px 14px', border: '1px solid #333', borderRadius: 22, background: 'transparent', cursor: 'pointer', fontSize: 13, color: '#aaa', fontFamily: 'Poppins, sans-serif' }}>
              👥 Access
            </button>
          )}
          {canEdit && (
            <button onClick={() => setShowForm(true)}
              style={{ padding: '7px 20px', background: LIME, color: BK, border: 'none', borderRadius: 22, cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'Poppins, sans-serif' }}>
              + Add Lead
            </button>
          )}
          <button onClick={() => signOut()} title="Sign out"
            style={{ width: 36, height: 36, borderRadius: '50%', border: '1px solid #333', background: 'transparent', cursor: 'pointer', fontSize: 16, color: '#777' }}>
            ⎋
          </button>
        </div>
      </div>

      {/* ── Board View ── */}
      {view === 'board' && (
        <div style={{ padding: 24 }}>
          {/* Metric cards */}
          <div style={{ background: BK, borderRadius: 20, padding: '22px 28px', marginBottom: 24 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 20 }}>
              {[
                { label: 'Total Pipeline', value: fmtINR(pipelineVal),  color: LIME },
                { label: '🔥 Hot Deals',   value: fmtINR(hotVal),        color: '#f59e0b' },
                { label: '⏰ Due Today',   value: todayCount,            color: todayCount > 0 ? '#f59e0b' : MUTED },
                { label: '🔴 Overdue',     value: overdueCount,          color: overdueCount > 0 ? '#ef4444' : MUTED },
              ].map(m => (
                <div key={m.label} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#666', marginBottom: 6 }}>{m.label}</div>
                  <div style={{ fontSize: typeof m.value === 'string' ? 20 : 32, fontWeight: 700, color: m.color }}>{m.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Search + filter */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search leads, contacts..."
              style={{ flex: 1, minWidth: 200, padding: '10px 18px', border: `1.5px solid ${BORDER}`, borderRadius: 22, fontSize: 13, fontFamily: 'Poppins, sans-serif', background: WHITE }} />
            <select value={filterStage} onChange={e => setFilterStage(e.target.value)}
              style={{ padding: '10px 16px', border: `1.5px solid ${BORDER}`, borderRadius: 22, fontSize: 13, fontFamily: 'Poppins, sans-serif', background: WHITE }}>
              <option value="all">All Stages</option>
              {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>

          {/* Kanban columns */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(258px, 1fr))', gap: 14 }}>
            {STAGES.map(stage => {
              const cols   = filtered.filter(l => l.stage === stage.id)
              const isOver = dragOver === stage.id
              return (
                <div key={stage.id}
                  onDragOver={e => onDragOver(e, stage.id)}
                  onDrop={e => onDrop(e, stage.id)}
                  style={{ background: WHITE, borderRadius: 16, border: `1.5px solid ${isOver ? LIME : BORDER}`, overflow: 'hidden', transition: 'border 0.15s, box-shadow 0.15s', boxShadow: isOver ? `0 0 0 3px ${LIME}28` : 'none' }}>
                  {/* Column header */}
                  <div style={{ padding: '12px 16px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: stage.color }} />
                    <div style={{ fontWeight: 600, fontSize: 13, color: TEXT, flex: 1 }}>{stage.label}</div>
                    {cols.length > 0 && <span style={{ background: LIME, color: BK, borderRadius: 10, fontSize: 10, fontWeight: 700, padding: '1px 8px', lineHeight: 1.6 }}>{cols.length}</span>}
                  </div>
                  {/* Lead cards */}
                  <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 7, minHeight: 64 }}>
                    {cols.length === 0 && <div style={{ fontSize: 12, color: isOver ? LIME : '#ddd', textAlign: 'center', padding: '14px 0', transition: 'color 0.15s' }}>Drop here</div>}
                    {cols.map(l => {
                      const svcOn = l.services ? Object.entries(l.services).filter(([,v]) => v?.enabled) : []
                      return (
                        <div key={l.id}
                          draggable={canEdit}
                          onDragStart={e => onDragStart(e, l.id)}
                          onDragEnd={onDragEnd}
                          onClick={() => setDetailLead(l)}
                          style={{ background: dragging === l.id ? '#fafff0' : BG, borderRadius: 12, padding: '12px 13px', cursor: 'pointer', border: `1px solid ${dragging === l.id ? LIME : BORDER}`, opacity: dragging === l.id ? 0.45 : 1, transition: 'all 0.15s' }}
                          onMouseEnter={e => { e.currentTarget.style.boxShadow = `0 4px 18px ${LIME}28`; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.borderColor = LIME }}
                          onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.borderColor = dragging === l.id ? LIME : BORDER }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <Avatar name={l.company} size={28} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.company}</div>
                              <div style={{ fontSize: 11, color: MUTED }}>{l.contact}</div>
                            </div>
                            <div style={{ width: 8, height: 8, borderRadius: '50%', background: { critical: '#ef4444', high: '#f59e0b', medium: '#3b82f6', low: '#d1d5db' }[l.priority] || '#d1d5db', flexShrink: 0 }} />
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: svcOn.length ? 8 : 0 }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: '#059669' }}>{fmtINR(l.value)}</span>
                            {l.reminder_date && <span style={{ fontSize: 10, color: l.reminder_date <= today() ? '#ef4444' : MUTED }}>⏰ {l.reminder_date}</span>}
                          </div>
                          {svcOn.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                              {svcOn.slice(0, 3).map(([id]) => {
                                const s = SERVICES.find(sv => sv.id === id)
                                return s ? <span key={id} style={{ fontSize: 9, background: BK, color: LIME, borderRadius: 6, padding: '2px 7px', fontWeight: 600 }}>{s.emoji} {s.label.split(' ')[0]}</span> : null
                              })}
                              {svcOn.length > 3 && <span style={{ fontSize: 9, background: BG, color: MUTED, borderRadius: 6, padding: '2px 7px' }}>+{svcOn.length - 3}</span>}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {view === 'funnel'   && <div style={{ padding: 24 }}><FunnelView leads={leads} /></div>}
      {view === 'briefing' && <div style={{ padding: 24 }}><BriefingView leads={leads} /></div>}

      {/* Overlays */}
      {showForm    && <LeadForm onSave={saveLead} onClose={() => setShowForm(false)} toast={toast} />}
      {editLead    && <LeadForm lead={editLead} onSave={saveLead} onClose={() => setEditLead(null)} toast={toast} />}
      {detailLead  && (
        <LeadDetail
          lead={detailLead}
          leads={leads}
          onClose={() => setDetailLead(null)}
          onEdit={l => { setDetailLead(null); setEditLead(l) }}
          onDelete={handleDeleteLead}
          onStageChange={stageChange}
          onLogAction={logAction}
          toast={toast}
        />
      )}
      {showAI      && <AIPanel leads={leads} user={user} onClose={() => setShowAI(false)} />}
      {showInvite  && <InviteManager onClose={() => setShowInvite(false)} />}
      {confetti    && <Confetti onDone={() => setConfetti(false)} />}
      <ToastContainer toasts={toasts} />
    </div>
  )
}
