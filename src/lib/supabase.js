import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// ── Auth helpers ──────────────────────────────────────────────

export async function signInWithPassword(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  return { data, error }
}

export async function signUpWithPassword(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password })
  return { data, error }
}

export async function resetPassword(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  })
  return { error }
}

export async function updatePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  return { error }
}

export async function signOut() {
  await supabase.auth.signOut()
}

export async function getSession() {
  const { data } = await supabase.auth.getSession()
  return data.session
}

// ── Invite-only gate ──────────────────────────────────────────
// Only emails in the `allowed_users` table can access the app.
export async function isInvited(email) {
  const { data, error } = await supabase
    .from('allowed_users')
    .select('email')
    .eq('email', email.toLowerCase())
    .maybeSingle()
  return !!data && !error
}

// ── Leads ─────────────────────────────────────────────────────

export async function fetchLeads() {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .order('created_at', { ascending: false })
  return { data, error }
}

export async function upsertLead(lead) {
  const { data, error } = await supabase
    .from('leads')
    .upsert(lead, { onConflict: 'id' })
    .select()
    .single()
  return { data, error }
}

export async function deleteLead(id) {
  const { error } = await supabase.from('leads').delete().eq('id', id)
  return { error }
}

export async function updateLeadStage(id, stage) {
  const { data, error } = await supabase
    .from('leads')
    .update({ stage, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  return { data, error }
}

// ── Reminders ─────────────────────────────────────────────────

export async function fetchTodayReminders() {
  const today = new Date().toISOString().split('T')[0]
  const { data, error } = await supabase
    .from('leads')
    .select('id, company, contact, stage, value, reminder_date, reminder_note')
    .lte('reminder_date', today)
    .not('reminder_date', 'is', null)
    .order('reminder_date', { ascending: true })
  return { data, error }
}
