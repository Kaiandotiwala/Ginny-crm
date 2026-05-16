import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, fetchLeads, upsertLead, updateLeadStage, signOut } from '../lib/supabase'
import InviteManager from './InviteManager'

// ── Constants ─────────────────────────────────────────────────

const STAGES = [
  { id: 'lead',        label: 'Lead',            color: '#6366f1', bg: '#eef2ff' },
  { id: 'prospect',   label: 'Prospect',         color: '#f59e0b', bg: '#fffbeb' },
  { id: 'quotation',  label: 'Quotation Sent',   color: '#3b82f6', bg: '#eff6ff' },
  { id: 'negotiation',label: 'Negotiation',      color: '#8b5cf6', bg: '#f5f3ff' },
  { id: 'sow_pending',label: 'SOW/SLA Pending',  color: '#ec4899', bg: '#fdf2f8' },
  { id: 'onboarding', label: 'Onboarding',       color: '#10b981', bg: '#ecfdf5' },
  { id: 'closed_won', label: 'Closed Won',       color: '#059669', bg: '#d1fae5' },
  { id: 'closed_lost',label: 'Closed Lost',      color: '#ef4444', bg: '#fee2e2' },
]

const TEAM = [
  { id: 'you',      name: 'You (Head of Sales)', initials: 'YO' },
  { id: 'founder2', name: 'Co-founder 2',        initials: 'CF' },
  { id: 'founder3', name: 'Co-founder 3',        initials: 'C3' },
]

const INDUSTRIES = ['Technology','Finance','Healthcare','Retail','Manufacturing','Real Estate','Education','Media','Consulting','Other']
const SOURCES = ['LinkedIn','Referral','Conference','Cold Outreach','Website','WhatsApp','Other']

// ── Helpers ───────────────────────────────────────────────────

const fmtINR = v => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v || 0)
const getStage = id => STAGES.find(s => s.id === id) || STAGES[0]
const today = () => new Date().toISOString().split('T')[0]

// ── Claude API helper ─────────────────────────────────────────

async function callClaude(messages, systemPrompt, maxTokens = 1000) {
  const body = { model: 'claude-sonnet-4-20250514', max_tokens: maxTokens, messages }
  if (systemPrompt) body.system = systemPrompt
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

// ── Small UI components ───────────────────────────────────────

const Avatar = ({ name = '?', size = 32 }) => {
  const initials = String(name).split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
  const colors = ['#6366f1','#f59e0b','#10b981','#ec4899','#3b82f6','#8b5cf6','#ef4444']
  const bg = colors[(initials.charCodeAt(0) || 0) % colors.length]
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: size * 0.36, fontWeight: 700, flexShrink: 0 }}>
      {initials}
    </div>
  )
}

const Badge = ({ label, color, bg }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: bg, color, border: `1px solid ${color}30`, whiteSpace: 'nowrap' }}>
    {label}
  </span>
)

const Overlay = ({ children, onClose }) => (
  <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    onClick={e => e.target === e.currentTarget && onClose()}>
    <div style={{ background: '#fff', borderRadius: 18, width: '100%', maxWidth: 660, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 24px 80px rgba(0,0,0,0.18)' }}>
      {children}
    </div>
  </div>
)

const Tabs = ({ tabs, active, onChange }) => (
  <div style={{ display: 'flex', gap: 2, borderBottom: '1.5px solid #e5e7eb', marginBottom: 20 }}>
    {tabs.map(t => (
      <button key={t.id} onClick={() => onChange(t.id)}
        style={{ padding: '10px 16px', fontSize: 13, fontWeight: active === t.id ? 600 : 400, color: active === t.id ? '#6366f1' : '#6b7280', borderBottom: active === t.id ? '2.5px solid #6366f1' : '2.5px solid transparent', background: 'none', border: 'none', borderBottomWidth: 2.5, borderBottomStyle: 'solid', cursor: 'pointer' }}>
        {t.label}
      </button>
    ))}
  </div>
)

// ── AI Panel ──────────────────────────────────────────────────

function AIPanel({ leads, user, onClose }) {
  const [activeTab, setActiveTab] = useState('ask')
  const [msgs, setMsgs] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [reportBusy, setReportBusy] = useState(null) // report id being generated
  const [reports, setReports] = useState({})
  const initialAsked = useRef(false)

  const systemPrompt = `You are a senior sales strategy advisor for Ginny. The user is Head of Sales & Strategy and one of 3 co-founders. Give sharp, actionable advice. Be direct and concise.

Live pipeline:
- Leads: ${leads.length} total
- Pipeline value: ${fmtINR(leads.filter(l => l.stage !== 'closed_lost').reduce((s, l) => s + (l.value || 0), 0))}
- By stage: ${STAGES.map(s => `${s.label}: ${leads.filter(l => l.stage === s.id).length}`).join(', ')}
- Hot deals: ${leads.filter(l => ['negotiation','sow_pending'].includes(l.stage)).map(l => `${l.company} (${fmtINR(l.value)})`).join(', ') || 'none'}
- Overdue reminders: ${leads.filter(l => l.reminder_date && l.reminder_date < today()).length}`

  const pipelineContext = `Live pipeline as of ${today()}:
Total leads: ${leads.length}
Active pipeline: ${fmtINR(leads.filter(l => l.stage !== 'closed_lost').reduce((s, l) => s + (l.value || 0), 0))}
Closed Won: ${fmtINR(leads.filter(l => l.stage === 'closed_won').reduce((s, l) => s + (l.value || 0), 0))}

Stage breakdown:
${STAGES.map(s => `  ${s.label}: ${leads.filter(l => l.stage === s.id).length} deal(s) — ${fmtINR(leads.filter(l => l.stage === s.id).reduce((a, l) => a + (l.value || 0), 0))}`).join('\n')}

All deals:
${leads.map(l => `  • ${l.company} | ${l.contact} | Stage: ${getStage(l.stage).label} | Value: ${fmtINR(l.value)} | Priority: ${l.priority} | Source: ${l.source || '—'} | Industry: ${l.industry || '—'}${l.reminder_date ? ` | Reminder: ${l.reminder_date}` : ''}${l.notes ? ` | Notes: ${l.notes}` : ''}`).join('\n')}`

  const REPORTS = [
    {
      id: 'weekly',
      label: '📊 Weekly Sales Report',
      prompt: `Generate a comprehensive Weekly Sales Report for Ginny (a digital marketing agency). Include: Executive Summary, Pipeline Snapshot, Stage-by-stage breakdown with values, Top 3 opportunities to prioritise, Deals at risk, Key actions for next week. Use clear headings and bullet points with specific INR numbers.\n\n${pipelineContext}`,
    },
    {
      id: 'conversion',
      label: '🔁 Conversion Analysis',
      prompt: `Generate a detailed Conversion Analysis for Ginny's sales pipeline. Include: Stage-by-stage conversion rates, Biggest drop-off points, Average deal value per stage, Lead source effectiveness, Win/loss patterns based on available data, Top 5 specific recommendations to improve conversion. Be data-driven.\n\n${pipelineContext}`,
    },
    {
      id: 'forecast',
      label: '📈 Revenue Forecast',
      prompt: `Generate a Revenue Forecast for Ginny. Include: 30/60/90-day revenue projections, Probability-weighted forecast (use: Quotation Sent=40%, Negotiation=65%, SOW Pending=80%, Onboarding=90%, Closed Won=100%), Best-case and conservative scenarios with INR totals, Top 3 deals most likely to close this month, Actions needed to hit best-case scenario.\n\n${pipelineContext}`,
    },
    {
      id: 'coaching',
      label: '🎯 Sales Coaching',
      prompt: `Generate a Sales Coaching Report for Ginny's sales team. For each active deal provide: specific next action, recommended talk track or message, potential objection and how to handle it. Also include: Overall pipeline health assessment, Follow-up prioritisation order, Quick wins available right now, Deals to consider deprioritising. Be specific and actionable.\n\n${pipelineContext}`,
    },
  ]

  // Fire the initial pipeline briefing once on mount
  useEffect(() => {
    if (initialAsked.current) return
    initialAsked.current = true
    const initPrompt = 'Give me a sharp 3-point pipeline briefing: what needs immediate attention, what is at risk, and the #1 action I should take today to close more revenue.'
    setMsgs([{ role: 'user', content: initPrompt }])
    setBusy(true)
    callClaude([{ role: 'user', content: initPrompt }], systemPrompt)
      .then(reply => setMsgs([{ role: 'user', content: initPrompt }, { role: 'assistant', content: reply }]))
      .catch(() => setMsgs([{ role: 'user', content: initPrompt }, { role: 'assistant', content: 'Connection error — check your Anthropic API key in Vercel.' }]))
      .finally(() => setBusy(false))
  }, []) // intentionally runs once; systemPrompt captured at mount is correct for initial brief

  const ask = useCallback(async (prompt) => {
    if (!prompt.trim() || busy) return
    setBusy(true)
    const newMsgs = [...msgs, { role: 'user', content: prompt }]
    setMsgs(newMsgs)
    setInput('')
    try {
      const reply = await callClaude(newMsgs, systemPrompt)
      setMsgs(prev => [...prev, { role: 'assistant', content: reply }])
    } catch {
      setMsgs(prev => [...prev, { role: 'assistant', content: 'Connection error — check your Anthropic API key.' }])
    }
    setBusy(false)
  }, [msgs, systemPrompt, busy])

  const generateReport = async (report) => {
    setReportBusy(report.id)
    try {
      const text = await callClaude(
        [{ role: 'user', content: report.prompt }],
        'You are a senior sales analyst for Ginny, a digital marketing agency. Generate professional, structured reports with clear headings, specific numbers, and actionable recommendations.',
        2000
      )
      setReports(prev => ({ ...prev, [report.id]: text }))
    } catch {
      setReports(prev => ({ ...prev, [report.id]: 'Error generating report — check your Anthropic API key in Vercel.' }))
    }
    setReportBusy(null)
  }

  const quickPrompts = ['Draft follow-up for my hottest deal', 'Which leads are at risk of going cold?', 'Tips to shorten my SOW cycle']

  return (
    <Overlay onClose={onClose}>
      <div style={{ padding: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 20 }}>✦</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>Claude Sales Advisor</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>Reads your live pipeline · Powered by Claude Sonnet</div>
          </div>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#9ca3af' }}>✕</button>
        </div>

        <Tabs tabs={[{ id: 'ask', label: '✦ Ask AI' }, { id: 'reports', label: '📊 Reports' }]} active={activeTab} onChange={setActiveTab} />

        {/* ── Ask AI tab ── */}
        {activeTab === 'ask' && (
          <>
            <div style={{ background: '#f8f9ff', borderRadius: 12, padding: 16, minHeight: 200, maxHeight: 380, overflowY: 'auto', marginBottom: 14 }}>
              {msgs.length === 0 && busy && <div style={{ color: '#6366f1', fontSize: 13 }}>Analyzing your pipeline...</div>}
              {msgs.map((m, i) => (
                <div key={i} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: m.role === 'user' ? '#6366f1' : '#6b7280', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>
                    {m.role === 'user' ? 'You' : '✦ Claude Advisor'}
                  </div>
                  <div style={{ fontSize: 13, color: '#1f2937', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{m.content}</div>
                </div>
              ))}
              {busy && msgs.length > 0 && <div style={{ fontSize: 13, color: '#6366f1' }}>Thinking...</div>}
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && ask(input)}
                placeholder="Ask for advice, email drafts, deal tactics..."
                style={{ flex: 1, padding: '10px 14px', border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 13 }} />
              <button onClick={() => ask(input)} disabled={busy || !input.trim()}
                style={{ padding: '10px 18px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
                Send
              </button>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {quickPrompts.map(q => (
                <button key={q} onClick={() => ask(q)} style={{ padding: '5px 10px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 11, background: '#fff', cursor: 'pointer', color: '#6b7280' }}>{q}</button>
              ))}
            </div>
          </>
        )}

        {/* ── Reports tab ── */}
        {activeTab === 'reports' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 500, overflowY: 'auto' }}>
            {REPORTS.map(report => (
              <div key={report.id} style={{ border: '1.5px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', padding: '13px 16px', gap: 10, background: '#fafafa' }}>
                  <span style={{ flex: 1, fontWeight: 600, fontSize: 14, color: '#1f2937' }}>{report.label}</span>
                  <button
                    onClick={() => generateReport(report)}
                    disabled={!!reportBusy}
                    style={{ padding: '7px 14px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: reportBusy ? 'not-allowed' : 'pointer', opacity: reportBusy === report.id ? 0.6 : 1, whiteSpace: 'nowrap' }}
                  >
                    {reportBusy === report.id ? 'Generating...' : reports[report.id] ? '↺ Regenerate' : 'Generate'}
                  </button>
                </div>
                {reports[report.id] && (
                  <div style={{ padding: '14px 16px', borderTop: '1px solid #f3f4f6' }}>
                    <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.75, whiteSpace: 'pre-wrap', maxHeight: 260, overflowY: 'auto', marginBottom: 12 }}>
                      {reports[report.id]}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <a
                        href={`mailto:${user?.email || ''}?subject=${encodeURIComponent(`Ginny CRM — ${report.label} — ${today()}`)}&body=${encodeURIComponent(reports[report.id])}`}
                        style={{ padding: '7px 14px', background: '#059669', color: '#fff', borderRadius: 8, fontSize: 12, fontWeight: 600, textDecoration: 'none', display: 'inline-block' }}
                      >
                        ✉ Email to Me
                      </a>
                      <button
                        onClick={() => navigator.clipboard.writeText(reports[report.id])}
                        style={{ padding: '7px 14px', border: '1.5px solid #e5e7eb', borderRadius: 8, fontSize: 12, background: '#fff', cursor: 'pointer', color: '#374151' }}
                      >
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
    </Overlay>
  )
}

// ── Email Composer ────────────────────────────────────────────

function EmailComposer({ lead, type, onClose }) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const labels = { quotation: 'Quotation Email', sow: 'SOW Signature Request', whatsapp: 'WhatsApp Follow-up', onboarding: 'Ops Team Introduction', followup: 'Follow-up Email' }

  const prompts = {
    quotation: `Write a professional sales quotation email for ${lead?.company}. Contact: ${lead?.contact}. Deal value: ${fmtINR(lead?.value)}. Sender is Ginny's Head of Sales. Warm but professional. Clear CTA to review call.`,
    sow: `Write an email to ${lead?.contact} at ${lead?.company} requesting digital signature on our Scope of Work / SLA. Deal: ${fmtINR(lead?.value)}. Mention the document will arrive via DocuSign. Professional, reassuring tone.`,
    whatsapp: `Write a WhatsApp message (under 120 words) to ${lead?.contact} from ${lead?.company}. Friendly follow-up on their quotation. Deal: ${fmtINR(lead?.value)}. Keep it human, not salesy.`,
    onboarding: `Write a warm intro email introducing Ginny's operations team (co-founders) to ${lead?.contact} at ${lead?.company}. Express excitement about the partnership. Deal value: ${fmtINR(lead?.value)}. Professional and welcoming.`,
    followup: `Write a follow-up email to ${lead?.contact} at ${lead?.company}. Stage: ${getStage(lead?.stage)?.label}. Value: ${fmtINR(lead?.value)}. Notes: ${lead?.notes || 'none'}. Warm, add gentle urgency.`,
  }

  useEffect(() => { generate() }, [])

  const generate = async () => {
    setBusy(true)
    try {
      const text = await callClaude([{ role: 'user', content: prompts[type] }], undefined, 800)
      setDraft(text)
    } catch { setDraft('Could not generate draft. Check your Anthropic API key in Vercel.') }
    setBusy(false)
  }

  return (
    <Overlay onClose={onClose}>
      <div style={{ padding: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div style={{ fontSize: 26 }}>{type === 'whatsapp' ? '💬' : '✉️'}</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{labels[type]}</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>{lead?.company} — {lead?.contact}</div>
          </div>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#9ca3af' }}>✕</button>
        </div>

        {busy
          ? <div style={{ textAlign: 'center', padding: '40px 0', color: '#6366f1', fontSize: 14 }}>Drafting your {labels[type]}...</div>
          : <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={13}
              style={{ width: '100%', padding: '12px', border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 13, lineHeight: 1.6, resize: 'vertical', boxSizing: 'border-box' }} />
        }

        {!busy && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button onClick={generate} style={{ padding: '9px 14px', border: '1.5px solid #e5e7eb', borderRadius: 10, background: '#fff', cursor: 'pointer', fontSize: 13 }}>↺ Regenerate</button>
            <button onClick={() => { navigator.clipboard.writeText(draft); alert('Copied!') }}
              style={{ padding: '9px 14px', border: '1.5px solid #e5e7eb', borderRadius: 10, background: '#fff', cursor: 'pointer', fontSize: 13 }}>⧉ Copy</button>
            {type !== 'whatsapp' && (
              <a href={`mailto:${lead?.email}?subject=${encodeURIComponent('Regarding our proposal — Ginny')}&body=${encodeURIComponent(draft)}`}
                style={{ padding: '9px 16px', background: '#6366f1', color: '#fff', borderRadius: 10, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
                Open in Mail App
              </a>
            )}
            {type === 'whatsapp' && (
              <a href={`https://wa.me/${(lead?.whatsapp || '').replace(/\D/g, '')}?text=${encodeURIComponent(draft)}`}
                target="_blank" rel="noreferrer"
                style={{ padding: '9px 16px', background: '#25d366', color: '#fff', borderRadius: 10, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
                Open in WhatsApp
              </a>
            )}
          </div>
        )}
      </div>
    </Overlay>
  )
}

// ── Lead Form ─────────────────────────────────────────────────

function LeadForm({ lead, onSave, onClose }) {
  const blank = { company: '', contact: '', email: '', phone: '', whatsapp: '', industry: 'Technology', value: '', currency: 'INR', stage: 'lead', priority: 'medium', source: '', notes: '', assigned_to: 'you', reminder_date: '', reminder_note: '', history: [] }
  const [form, setForm] = useState(lead ? { ...lead, value: lead.value || '', reminder_date: lead.reminder_date || '', reminder_note: lead.reminder_note || '' } : blank)
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const save = async () => {
    if (!form.company || !form.contact || !form.email) return alert('Company, contact and email are required.')
    setSaving(true)
    const payload = { ...form, value: Number(form.value) || 0 }
    if (!payload.id) {
      payload.history = [{ date: today(), action: 'Lead created' }]
    }
    const { data, error } = await upsertLead(payload)
    if (error) alert('Save failed: ' + error.message)
    else onSave(data)
    setSaving(false)
  }

  const F = ({ label, k, type = 'text', opts }) => (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 5 }}>{label}</label>
      {opts?.select ? (
        <select value={form[k]} onChange={e => set(k, e.target.value)} style={{ width: '100%', padding: '8px 12px', border: '1.5px solid #e5e7eb', borderRadius: 8, fontSize: 13 }}>
          {opts.options.map(o => <option key={o.value || o} value={o.value || o}>{o.label || o}</option>)}
        </select>
      ) : opts?.textarea ? (
        <textarea value={form[k]} onChange={e => set(k, e.target.value)} rows={3}
          style={{ width: '100%', padding: '8px 12px', border: '1.5px solid #e5e7eb', borderRadius: 8, fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
      ) : (
        <input type={type} value={form[k]} onChange={e => set(k, e.target.value)}
          style={{ width: '100%', padding: '8px 12px', border: '1.5px solid #e5e7eb', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
      )}
    </div>
  )

  return (
    <Overlay onClose={onClose}>
      <div style={{ padding: '28px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{lead ? 'Edit Lead' : 'Add New Lead'}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#9ca3af' }}>✕</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
          <F label="Company *" k="company" />
          <F label="Contact Name *" k="contact" />
          <F label="Email *" k="email" type="email" />
          <F label="Phone" k="phone" type="tel" />
          <F label="WhatsApp" k="whatsapp" type="tel" />
          <F label="Industry" k="industry" opts={{ select: true, options: INDUSTRIES }} />
          <F label="Deal Value (₹)" k="value" type="number" />
          <F label="Stage" k="stage" opts={{ select: true, options: STAGES.map(s => ({ value: s.id, label: s.label })) }} />
          <F label="Priority" k="priority" opts={{ select: true, options: ['critical','high','medium','low'] }} />
          <F label="Assigned To" k="assigned_to" opts={{ select: true, options: TEAM.map(t => ({ value: t.id, label: t.name })) }} />
          <F label="Lead Source" k="source" opts={{ select: true, options: ['', ...SOURCES] }} />
          <F label="Reminder Date" k="reminder_date" type="date" />
        </div>
        <F label="Reminder Note" k="reminder_note" opts={{ textarea: true }} />
        <F label="Notes" k="notes" opts={{ textarea: true }} />

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
          <button onClick={onClose} style={{ padding: '10px 20px', border: '1.5px solid #e5e7eb', borderRadius: 10, background: '#fff', cursor: 'pointer', fontSize: 14 }}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ padding: '10px 26px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Saving...' : 'Save Lead'}
          </button>
        </div>
      </div>
    </Overlay>
  )
}

// ── Lead Detail ───────────────────────────────────────────────

function LeadDetail({ lead: initialLead, leads, onClose, onEdit, onStageChange, onLogAction }) {
  const [tab, setTab] = useState('overview')
  const [emailModal, setEmailModal] = useState(null)
  const lead = leads.find(l => l.id === initialLead.id) || initialLead
  const stage = getStage(lead.stage)

  return (
    <Overlay onClose={onClose}>
      <div style={{ padding: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 22 }}>
          <Avatar name={lead.company} size={48} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 20 }}>{lead.company}</div>
            <div style={{ fontSize: 13, color: '#6b7280' }}>{lead.contact} · {lead.email}</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <Badge label={stage.label} color={stage.color} bg={stage.bg} />
              <Badge label={lead.priority} color={{ critical: '#ef4444', high: '#f59e0b', medium: '#3b82f6', low: '#6b7280' }[lead.priority]} bg={{ critical: '#fee2e2', high: '#fffbeb', medium: '#eff6ff', low: '#f9fafb' }[lead.priority]} />
              <span style={{ fontSize: 15, fontWeight: 700, color: '#059669' }}>{fmtINR(lead.value)}</span>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#9ca3af' }}>✕</button>
        </div>

        <Tabs tabs={[{ id: 'overview', label: 'Overview' }, { id: 'actions', label: 'Actions' }, { id: 'history', label: 'History' }]} active={tab} onChange={setTab} />

        {tab === 'overview' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
              {[['Phone', lead.phone], ['WhatsApp', lead.whatsapp], ['Industry', lead.industry], ['Source', lead.source], ['Assigned To', TEAM.find(t => t.id === lead.assigned_to)?.name]].map(([k, v]) => (
                <div key={k} style={{ background: '#f9fafb', borderRadius: 10, padding: '10px 14px' }}>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 2 }}>{k}</div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{v || '—'}</div>
                </div>
              ))}
              {lead.reminder_date && (
                <div style={{ background: '#fffbeb', borderRadius: 10, padding: '10px 14px', border: '1px solid #fcd34d' }}>
                  <div style={{ fontSize: 11, color: '#92400e', marginBottom: 2 }}>⏰ Reminder</div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{lead.reminder_date}</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>{lead.reminder_note}</div>
                </div>
              )}
            </div>
            {lead.notes && <div style={{ background: '#f9fafb', borderRadius: 10, padding: '12px 14px', fontSize: 13, color: '#374151', lineHeight: 1.65, marginBottom: 14 }}>{lead.notes}</div>}
            <button onClick={() => onEdit(lead)} style={{ padding: '9px 18px', border: '1.5px solid #6366f1', color: '#6366f1', borderRadius: 10, background: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>✎ Edit Lead</button>
          </div>
        )}

        {tab === 'actions' && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 10 }}>Move to Stage</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 22 }}>
              {STAGES.filter(s => s.id !== lead.stage).map(s => (
                <button key={s.id} onClick={() => { onStageChange(lead.id, s.id); onLogAction(lead.id, `Moved to ${s.label}`) }}
                  style={{ padding: '6px 14px', border: `1.5px solid ${s.color}`, color: s.color, borderRadius: 20, background: s.bg, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                  → {s.label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 10 }}>Communications</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[['quotation','✉️ Draft Quotation Email'], ['sow','📝 Request SOW Signature'], ['whatsapp','💬 WhatsApp Follow-up'], ['onboarding','🤝 Introduce Ops Team'], ['followup','↩ Draft Follow-up Email']].map(([type, label]) => (
                <button key={type} onClick={() => setEmailModal(type)}
                  style={{ padding: '12px 16px', border: '1.5px solid #e5e7eb', borderRadius: 10, background: '#fff', cursor: 'pointer', fontSize: 13, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'inherit' }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {tab === 'history' && (
          <div>
            {(lead.history || []).length === 0 && <div style={{ color: '#9ca3af', fontSize: 13 }}>No history yet.</div>}
            {(lead.history || []).slice().reverse().map((h, i, arr) => (
              <div key={i} style={{ display: 'flex', gap: 12, paddingBottom: 14 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#6366f1', marginTop: 5, flexShrink: 0 }} />
                  {i < arr.length - 1 && <div style={{ width: 1, flex: 1, background: '#e5e7eb', marginTop: 4 }} />}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{h.action}</div>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{h.date}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {emailModal && <EmailComposer lead={lead} type={emailModal} onClose={() => setEmailModal(null)} />}
      </div>
    </Overlay>
  )
}

// ── Funnel View ───────────────────────────────────────────────

function FunnelView({ leads }) {
  const active = leads.filter(l => l.stage !== 'closed_lost')
  const total = active.length || 1
  const metrics = [
    { label: 'Total Pipeline', value: fmtINR(active.reduce((s, l) => s + (l.value || 0), 0)), color: '#6366f1' },
    { label: 'Expected Close (75%)', value: fmtINR(leads.filter(l => ['negotiation','sow_pending','onboarding'].includes(l.stage)).reduce((s, l) => s + (l.value || 0) * 0.75, 0)), color: '#10b981' },
    { label: 'Closed Won', value: fmtINR(leads.filter(l => l.stage === 'closed_won').reduce((s, l) => s + (l.value || 0), 0)), color: '#059669' },
    { label: 'Active Deals', value: active.length, color: '#f59e0b', plain: true },
  ]

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 28 }}>
        {metrics.map(m => (
          <div key={m.label} style={{ background: '#f9fafb', borderRadius: 12, padding: '16px' }}>
            <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 6 }}>{m.label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: m.color }}>{m.value}</div>
          </div>
        ))}
      </div>

      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 14 }}>Sales Funnel</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {STAGES.filter(s => s.id !== 'closed_lost').map(s => {
          const count = leads.filter(l => l.stage === s.id).length
          const val = leads.filter(l => l.stage === s.id).reduce((a, l) => a + (l.value || 0), 0)
          const pct = Math.max(Math.round((count / total) * 100), count > 0 ? 3 : 0)
          return (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 130, fontSize: 12, color: '#374151', flexShrink: 0 }}>{s.label}</div>
              <div style={{ flex: 1, background: '#f3f4f6', borderRadius: 8, height: 28, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: s.color, borderRadius: 8, display: 'flex', alignItems: 'center', paddingLeft: 10, minWidth: count > 0 ? 32 : 0 }}>
                  {count > 0 && <span style={{ color: '#fff', fontSize: 12, fontWeight: 700 }}>{count}</span>}
                </div>
              </div>
              <div style={{ width: 100, fontSize: 12, color: '#6b7280', textAlign: 'right' }}>{val > 0 ? fmtINR(val) : '—'}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Daily Briefing ────────────────────────────────────────────

function DailyBriefing({ leads }) {
  const overdue = leads.filter(l => l.reminder_date && l.reminder_date < today())
  const todayItems = leads.filter(l => l.reminder_date === today())

  const mailBody = [
    `GINNY CRM — DAILY SALES BRIEFING`,
    `Date: ${today()}`,
    ``,
    `TODAY'S REMINDERS (${todayItems.length}):`,
    ...todayItems.map(l => `• ${l.company} (${l.contact}): ${l.reminder_note || 'No note'} | Stage: ${getStage(l.stage).label} | ${fmtINR(l.value)}`),
    ``,
    `OVERDUE (${overdue.length}):`,
    ...overdue.map(l => `• ${l.company}: ${l.reminder_note || 'No note'} (Due: ${l.reminder_date})`),
    ``,
    `PIPELINE SNAPSHOT:`,
    ...STAGES.map(s => `• ${s.label}: ${leads.filter(l => l.stage === s.id).length} deal(s) — ${fmtINR(leads.filter(l => l.stage === s.id).reduce((a, l) => a + (l.value || 0), 0))}`),
    ``,
    `TOTAL ACTIVE PIPELINE: ${fmtINR(leads.filter(l => l.stage !== 'closed_lost').reduce((s, l) => s + (l.value || 0), 0))}`,
  ].join('\n')

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
        <div style={{ background: todayItems.length > 0 ? '#fffbeb' : '#f9fafb', borderRadius: 12, padding: '16px', border: todayItems.length > 0 ? '1px solid #fcd34d' : 'none' }}>
          <div style={{ fontSize: 11, color: '#92400e', marginBottom: 4 }}>⏰ Due Today</div>
          <div style={{ fontSize: 30, fontWeight: 700, color: '#f59e0b' }}>{todayItems.length}</div>
        </div>
        <div style={{ background: overdue.length > 0 ? '#fee2e2' : '#f9fafb', borderRadius: 12, padding: '16px', border: overdue.length > 0 ? '1px solid #fca5a5' : 'none' }}>
          <div style={{ fontSize: 11, color: '#991b1b', marginBottom: 4 }}>🔴 Overdue</div>
          <div style={{ fontSize: 30, fontWeight: 700, color: '#ef4444' }}>{overdue.length}</div>
        </div>
      </div>

      {[...overdue, ...todayItems].length === 0
        ? <div style={{ textAlign: 'center', padding: '30px', color: '#9ca3af', fontSize: 14 }}>No reminders due today — you're all caught up!</div>
        : <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
          {[...overdue, ...todayItems].map(l => (
            <div key={l.id} style={{ background: l.reminder_date < today() ? '#fff5f5' : '#fffbeb', borderRadius: 10, padding: '12px 16px', border: `1px solid ${l.reminder_date < today() ? '#fca5a5' : '#fcd34d'}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Avatar name={l.company} size={30} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{l.company} <span style={{ fontWeight: 400, color: '#6b7280' }}>— {l.contact}</span></div>
                  <div style={{ fontSize: 12, color: '#374151', marginTop: 2 }}>{l.reminder_note || 'No note'}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <Badge label={getStage(l.stage).label} color={getStage(l.stage).color} bg={getStage(l.stage).bg} />
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>{l.reminder_date}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      }

      <a href={`mailto:?subject=${encodeURIComponent(`Ginny CRM — Daily Briefing ${today()}`)}&body=${encodeURIComponent(mailBody)}`}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 22px', background: '#6366f1', color: '#fff', borderRadius: 10, textDecoration: 'none', fontSize: 14, fontWeight: 600 }}>
        ✉ Send Daily Briefing Email
      </a>
    </div>
  )
}

// ── Root App ──────────────────────────────────────────────────

export default function App() {
  const [leads, setLeads] = useState([])
  const [view, setView] = useState('pipeline')
  const [showForm, setShowForm] = useState(false)
  const [editLead, setEditLead] = useState(null)
  const [detailLead, setDetailLead] = useState(null)
  const [showAI, setShowAI] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [search, setSearch] = useState('')
  const [filterStage, setFilterStage] = useState('all')
  const [user, setUser] = useState(null)
  const [userRole, setUserRole] = useState('viewer')

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user))
    loadLeads()
    // Real-time sync
    const channel = supabase.channel('leads-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, loadLeads)
      .subscribe()
    return () => supabase.removeChannel(channel)
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

  const saveLead = async (lead) => {
    setLeads(prev => prev.find(l => l.id === lead.id) ? prev.map(l => l.id === lead.id ? lead : l) : [lead, ...prev])
    setShowForm(false)
    setEditLead(null)
  }

  const stageChange = async (id, stage) => {
    await updateLeadStage(id, stage)
    setLeads(prev => prev.map(l => l.id === id ? { ...l, stage } : l))
  }

  const logAction = async (id, action) => {
    const lead = leads.find(l => l.id === id)
    if (!lead) return
    const history = [...(lead.history || []), { date: today(), action }]
    await upsertLead({ ...lead, history })
    setLeads(prev => prev.map(l => l.id === id ? { ...l, history } : l))
  }

  const filtered = leads.filter(l => {
    const q = search.toLowerCase()
    return (!q || [l.company, l.contact, l.email].some(v => (v || '').toLowerCase().includes(q)))
      && (filterStage === 'all' || l.stage === filterStage)
  })

  const todayReminders = leads.filter(l => l.reminder_date === today()).length
  const canEdit = ['admin','editor'].includes(userRole)
  const isAdmin = userRole === 'admin'

  return (
    <div style={{ minHeight: '100vh', background: '#f8f8fc', fontFamily: "'DM Sans', 'Segoe UI', sans-serif" }}>

      {/* Topbar */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '0 24px', display: 'flex', alignItems: 'center', gap: 12, height: 58, position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16, fontWeight: 700 }}>G</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: -0.3 }}>Ginny CRM</div>
            <div style={{ fontSize: 10, color: '#9ca3af', lineHeight: 1 }}>Sales & Strategy</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 2, marginLeft: 12 }}>
          {[['pipeline','Pipeline'], ['funnel','Funnel'], ['briefing','Briefing']].map(([id, label]) => (
            <button key={id} onClick={() => setView(id)}
              style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: view === id ? '#eef2ff' : 'transparent', color: view === id ? '#6366f1' : '#6b7280', fontWeight: view === id ? 600 : 400, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', position: 'relative' }}>
              {label}
              {id === 'briefing' && todayReminders > 0 && (
                <span style={{ position: 'absolute', top: 2, right: 2, background: '#ef4444', color: '#fff', borderRadius: 10, fontSize: 9, padding: '1px 4px', lineHeight: 1.4 }}>{todayReminders}</span>
              )}
            </button>
          ))}
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => setShowAI(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', border: '1.5px solid #e5e7eb', borderRadius: 10, background: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 500, color: '#6366f1', fontFamily: 'inherit' }}>
            ✦ AI Advisor
          </button>
          {isAdmin && (
            <button onClick={() => setShowInvite(true)} style={{ padding: '7px 14px', border: '1.5px solid #e5e7eb', borderRadius: 10, background: '#fff', cursor: 'pointer', fontSize: 13, color: '#374151', fontFamily: 'inherit' }}>
              👥 Manage Access
            </button>
          )}
          {canEdit && (
            <button onClick={() => setShowForm(true)} style={{ padding: '7px 18px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit' }}>
              + Add Lead
            </button>
          )}
          <button onClick={() => signOut()} title="Sign out" style={{ width: 34, height: 34, borderRadius: '50%', border: 'none', background: '#f3f4f6', cursor: 'pointer', fontSize: 16 }}>⎋</button>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '24px', maxWidth: 1120, margin: '0 auto' }}>

        {view === 'pipeline' && (
          <>
            <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search leads, contacts..."
                style={{ flex: 1, minWidth: 200, padding: '9px 14px', border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 13, fontFamily: 'inherit' }} />
              <select value={filterStage} onChange={e => setFilterStage(e.target.value)}
                style={{ padding: '9px 14px', border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 13, fontFamily: 'inherit' }}>
                <option value="all">All Stages</option>
                {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 14 }}>
              {STAGES.map(stage => {
                const stageLeads = filtered.filter(l => l.stage === stage.id)
                return (
                  <div key={stage.id} style={{ background: '#fff', borderRadius: 14, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                    <div style={{ padding: '11px 16px', background: stage.bg, display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #f3f4f6' }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: stage.color }} />
                      <div style={{ fontWeight: 600, fontSize: 13, color: stage.color, flex: 1 }}>{stage.label}</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: stage.color }}>{stageLeads.length}</div>
                    </div>
                    <div style={{ padding: '8px 8px', display: 'flex', flexDirection: 'column', gap: 7, minHeight: 50 }}>
                      {stageLeads.length === 0 && <div style={{ fontSize: 12, color: '#e5e7eb', textAlign: 'center', padding: '10px 0' }}>Empty</div>}
                      {stageLeads.map(l => (
                        <div key={l.id} onClick={() => setDetailLead(l)}
                          style={{ background: '#f9fafb', borderRadius: 10, padding: '11px 13px', cursor: 'pointer', border: '1px solid #f3f4f6', transition: 'box-shadow 0.15s' }}
                          onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 14px rgba(99,102,241,0.13)'}
                          onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                            <Avatar name={l.company} size={26} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.company}</div>
                              <div style={{ fontSize: 11, color: '#9ca3af' }}>{l.contact}</div>
                            </div>
                            <div style={{ width: 8, height: 8, borderRadius: '50%', background: { critical: '#ef4444', high: '#f59e0b', medium: '#3b82f6', low: '#d1d5db' }[l.priority], flexShrink: 0 }} />
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: '#059669' }}>{fmtINR(l.value)}</span>
                            {l.reminder_date && <span style={{ fontSize: 10, color: l.reminder_date <= today() ? '#ef4444' : '#9ca3af' }}>⏰ {l.reminder_date}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {view === 'funnel' && <FunnelView leads={leads} />}
        {view === 'briefing' && <DailyBriefing leads={leads} />}
      </div>

      {showForm && <LeadForm onSave={saveLead} onClose={() => setShowForm(false)} />}
      {editLead && <LeadForm lead={editLead} onSave={saveLead} onClose={() => setEditLead(null)} />}
      {detailLead && (
        <LeadDetail
          lead={detailLead}
          leads={leads}
          onClose={() => setDetailLead(null)}
          onEdit={l => { setDetailLead(null); setEditLead(l) }}
          onStageChange={stageChange}
          onLogAction={logAction}
        />
      )}
      {showAI && <AIPanel leads={leads} user={user} onClose={() => setShowAI(false)} />}
      {showInvite && <InviteManager onClose={() => setShowInvite(false)} />}
    </div>
  )
}
