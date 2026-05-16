import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function InviteManager({ onClose }) {
  const [users, setUsers] = useState([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('editor')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')

  const load = async () => {
    const { data } = await supabase.from('allowed_users').select('*').order('created_at')
    setUsers(data || [])
  }

  useEffect(() => { load() }, [])

  const invite = async () => {
    if (!email.trim()) return
    setLoading(true)
    setMsg('')
    const { error } = await supabase.from('allowed_users').upsert(
      { email: email.trim().toLowerCase(), role },
      { onConflict: 'email' }
    )
    if (error) setMsg('Error: ' + error.message)
    else { setMsg(`✓ ${email} added as ${role}`); setEmail(''); await load() }
    setLoading(false)
  }

  const remove = async (em) => {
    if (!confirm(`Remove ${em}?`)) return
    await supabase.from('allowed_users').delete().eq('email', em)
    await load()
  }

  const roleColor = { admin: '#ef4444', editor: '#6366f1', viewer: '#6b7280' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: '#fff', borderRadius: 16, padding: '28px', width: '100%', maxWidth: 520 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Manage Access</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>Invite-only. Add emails to grant access.</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#9ca3af' }}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && invite()}
            placeholder="email@example.com" style={{ flex: 1, padding: '9px 12px', border: '1.5px solid #e5e7eb', borderRadius: 8, fontSize: 13 }} />
          <select value={role} onChange={e => setRole(e.target.value)} style={{ padding: '9px 10px', border: '1.5px solid #e5e7eb', borderRadius: 8, fontSize: 13 }}>
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
          <button onClick={invite} disabled={loading} style={{ padding: '9px 16px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Invite
          </button>
        </div>

        {msg && <p style={{ fontSize: 13, color: msg.startsWith('✓') ? '#059669' : '#ef4444', marginBottom: 12 }}>{msg}</p>}

        <div style={{ borderRadius: 10, border: '1px solid #f3f4f6', overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 0 }}>
            {['Email', 'Role', ''].map(h => (
              <div key={h} style={{ padding: '8px 14px', fontSize: 11, fontWeight: 600, color: '#9ca3af', background: '#f9fafb', borderBottom: '1px solid #f3f4f6' }}>{h}</div>
            ))}
          </div>
          {users.map(u => (
            <div key={u.email} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', borderBottom: '1px solid #f9fafb', alignItems: 'center' }}>
              <div style={{ padding: '10px 14px', fontSize: 13 }}>{u.email}</div>
              <div style={{ padding: '10px 14px' }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: roleColor[u.role] || '#6b7280', background: '#f3f4f6', padding: '2px 8px', borderRadius: 10 }}>{u.role}</span>
              </div>
              <div style={{ padding: '10px 14px' }}>
                <button onClick={() => remove(u.email)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 12, padding: '2px 6px' }}>Remove</button>
              </div>
            </div>
          ))}
          {users.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>No users yet</div>}
        </div>

        <p style={{ fontSize: 11, color: '#d1d5db', marginTop: 16 }}>
          Editors can add/edit leads. Viewers read-only. Admins manage everything including this panel.
        </p>
      </div>
    </div>
  )
}
