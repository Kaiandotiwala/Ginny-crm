import { useState, useEffect } from 'react'
import { supabase, signInWithPassword, signUpWithPassword, resetPassword, updatePassword, isInvited } from '../lib/supabase'

// ── Brand tokens ──────────────────────────────────────────────
const G = '#cbd952'   // lime green
const BG = '#1e1e1e'  // near-black background
const CARD = '#252525'
const BORDER = '#333'
const TEXT = '#f0f0f0'
const MUTED = '#888'
const ERR = '#f87171'

const inputSt = {
  width: '100%',
  padding: '12px 14px',
  background: '#1a1a1a',
  border: `1.5px solid ${BORDER}`,
  borderRadius: 10,
  fontSize: 14,
  color: TEXT,
  boxSizing: 'border-box',
  fontFamily: 'Poppins, sans-serif',
  outline: 'none',
}

// ── Ginny logomark (chat bubble) ──────────────────────────────
const Logo = () => (
  <svg width="52" height="52" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="52" height="52" rx="15" fill={G} />
    <path
      d="M12 17C12 14.8 13.8 13 16 13H36C38.2 13 40 14.8 40 17V29C40 31.2 38.2 33 36 33H28L22 40V33H16C13.8 33 12 31.2 12 29V17Z"
      fill={BG}
    />
  </svg>
)

// ── Password field with show/hide toggle ──────────────────────
function PwInput({ value, onChange, placeholder, onKeyDown }) {
  const [show, setShow] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        onKeyDown={onKeyDown}
        style={{ ...inputSt, paddingRight: 46 }}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow(s => !s)}
        style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: MUTED, padding: 0, lineHeight: 1, fontSize: 15 }}
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? '🙈' : '👁️'}
      </button>
    </div>
  )
}

// ── AuthGate ──────────────────────────────────────────────────
export default function AuthGate({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showReset, setShowReset] = useState(false) // password-recovery flow
  const [view, setView] = useState('login')          // 'login' | 'signup' | 'forgot'

  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') {
        // User clicked reset link — show set-new-password form
        setShowReset(true)
        setSession(null)
      } else if (event === 'USER_UPDATED') {
        // Password was updated — let them into the app
        setShowReset(false)
        setSession(s)
      } else {
        setSession(s)
      }
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  const clear = () => { setEmail(''); setPw(''); setPw2(''); setError(''); setInfo('') }
  const go = (v) => { setView(v); clear() }

  const login = async () => {
    if (!email.trim() || !pw) return setError('Enter your email and password.')
    setBusy(true); setError('')
    const { error: e } = await signInWithPassword(email.trim(), pw)
    if (e) setError(e.message === 'Invalid login credentials' ? 'Incorrect email or password.' : e.message)
    setBusy(false)
  }

  const signup = async () => {
    if (!email.trim() || !pw) return setError('Fill in all fields.')
    if (pw !== pw2) return setError('Passwords do not match.')
    if (pw.length < 6) return setError('Password must be at least 6 characters.')
    setBusy(true); setError('')
    const invited = await isInvited(email.trim())
    if (!invited) { setError("This email isn't on the invite list. Ask your admin for access."); setBusy(false); return }
    const { error: e } = await signUpWithPassword(email.trim(), pw)
    if (e) setError(e.message)
    else setInfo('Account created! Check your email to confirm, then sign in.')
    setBusy(false)
  }

  const forgot = async () => {
    if (!email.trim()) return setError('Enter your email address.')
    setBusy(true); setError('')
    const { error: e } = await resetPassword(email.trim())
    if (e) setError(e.message)
    else setInfo('Reset link sent — check your inbox.')
    setBusy(false)
  }

  const doReset = async () => {
    if (!pw) return setError('Enter a new password.')
    if (pw !== pw2) return setError('Passwords do not match.')
    if (pw.length < 6) return setError('Password must be at least 6 characters.')
    setBusy(true); setError('')
    const { error: e } = await updatePassword(pw)
    if (e) setError(e.message)
    else setInfo('Password updated — signing you in...')
    setBusy(false)
  }

  const btnSt = (primary = true) => ({
    width: '100%',
    padding: '13px',
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 600,
    cursor: busy ? 'not-allowed' : 'pointer',
    fontFamily: 'Poppins, sans-serif',
    background: primary ? G : 'transparent',
    color: primary ? BG : MUTED,
    border: primary ? 'none' : `1.5px solid ${BORDER}`,
    opacity: busy ? 0.65 : 1,
    marginTop: 4,
    transition: 'opacity 0.15s',
  })

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: BG }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ width: 36, height: 36, border: `3px solid ${BORDER}`, borderTopColor: G, borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
    </div>
  )

  if (!showReset && session) return children

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: BG, padding: 16, fontFamily: 'Poppins, sans-serif' }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        input::placeholder { color: #555 }
        input:focus { border-color: ${G} !important; box-shadow: 0 0 0 3px ${G}18 }
      `}</style>

      <div style={{ background: CARD, borderRadius: 22, padding: '44px 38px', width: '100%', maxWidth: 400, textAlign: 'center', border: `1px solid ${BORDER}`, boxShadow: '0 24px 60px rgba(0,0,0,0.5)' }}>

        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
          <Logo />
        </div>
        <h1 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 700, color: TEXT, letterSpacing: -0.3 }}>Ginny CRM</h1>

        {/* ── Reset password (from email link) ── */}
        {showReset && (
          <>
            <p style={{ margin: '0 0 26px', fontSize: 13, color: MUTED }}>Set your new password</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left' }}>
              <PwInput value={pw} onChange={e => setPw(e.target.value)} placeholder="New password" />
              <PwInput value={pw2} onChange={e => setPw2(e.target.value)} placeholder="Confirm new password" onKeyDown={e => e.key === 'Enter' && doReset()} />
            </div>
            {error && <p style={{ color: ERR, fontSize: 13, margin: '10px 0 0', textAlign: 'left' }}>{error}</p>}
            {info && <p style={{ color: G, fontSize: 13, margin: '10px 0 0', textAlign: 'left' }}>{info}</p>}
            <button onClick={doReset} disabled={busy} style={{ ...btnSt(), marginTop: 16 }}>
              {busy ? 'Updating...' : 'Update Password'}
            </button>
          </>
        )}

        {/* ── Sign in ── */}
        {!showReset && view === 'login' && (
          <>
            <p style={{ margin: '0 0 26px', fontSize: 13, color: MUTED }}>Sign in to your account</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left' }}>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Email address"
                style={inputSt}
                autoFocus
                onKeyDown={e => e.key === 'Enter' && login()}
              />
              <PwInput value={pw} onChange={e => setPw(e.target.value)} placeholder="Password" onKeyDown={e => e.key === 'Enter' && login()} />
            </div>
            <div style={{ textAlign: 'right', marginTop: 10 }}>
              <button
                onClick={() => go('forgot')}
                style={{ background: 'none', border: 'none', color: G, fontSize: 12, cursor: 'pointer', fontFamily: 'Poppins, sans-serif' }}
              >
                Forgot password?
              </button>
            </div>
            {error && <p style={{ color: ERR, fontSize: 13, margin: '8px 0 0', textAlign: 'left' }}>{error}</p>}
            <button onClick={login} disabled={busy} style={{ ...btnSt(), marginTop: 12 }}>
              {busy ? 'Signing in...' : 'Sign In'}
            </button>
            <button onClick={() => go('signup')} style={{ ...btnSt(false), marginTop: 10 }}>
              New user? Set password →
            </button>
          </>
        )}

        {/* ── Sign up ── */}
        {!showReset && view === 'signup' && (
          <>
            <p style={{ margin: '0 0 26px', fontSize: 13, color: MUTED }}>Create your account (invite-only)</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left' }}>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email address" style={inputSt} autoFocus />
              <PwInput value={pw} onChange={e => setPw(e.target.value)} placeholder="Choose a password" />
              <PwInput value={pw2} onChange={e => setPw2(e.target.value)} placeholder="Confirm password" />
            </div>
            {error && <p style={{ color: ERR, fontSize: 13, margin: '10px 0 0', textAlign: 'left' }}>{error}</p>}
            {info && <p style={{ color: G, fontSize: 13, margin: '10px 0 0', textAlign: 'left' }}>{info}</p>}
            <button onClick={signup} disabled={busy} style={{ ...btnSt(), marginTop: 16 }}>
              {busy ? 'Creating account...' : 'Set Password & Sign Up'}
            </button>
            <button onClick={() => go('login')} style={{ ...btnSt(false), marginTop: 10 }}>
              ← Back to sign in
            </button>
          </>
        )}

        {/* ── Forgot password ── */}
        {!showReset && view === 'forgot' && (
          <>
            <p style={{ margin: '0 0 26px', fontSize: 13, color: MUTED }}>We'll send you a reset link</p>
            <div style={{ textAlign: 'left' }}>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Email address"
                style={inputSt}
                autoFocus
                onKeyDown={e => e.key === 'Enter' && forgot()}
              />
            </div>
            {error && <p style={{ color: ERR, fontSize: 13, margin: '10px 0 0', textAlign: 'left' }}>{error}</p>}
            {info && <p style={{ color: G, fontSize: 13, margin: '10px 0 0', textAlign: 'left' }}>{info}</p>}
            <button onClick={forgot} disabled={busy} style={{ ...btnSt(), marginTop: 16 }}>
              {busy ? 'Sending...' : 'Send Reset Link'}
            </button>
            <button onClick={() => go('login')} style={{ ...btnSt(false), marginTop: 10 }}>
              ← Back to sign in
            </button>
          </>
        )}

        <p style={{ fontSize: 11, color: '#3a3a3a', marginTop: 28 }}>
          Secured by Supabase Auth · Invite-only access
        </p>
      </div>
    </div>
  )
}
