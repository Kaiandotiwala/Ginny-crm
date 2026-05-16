# Ginny CRM — Deployment Guide
**Stack: React + Vite · Supabase (DB + Auth) · Vercel (hosting) · Claude AI**
Estimated setup time: 30–45 minutes. All free tiers.

---

## Step 1 — Create your Supabase project (free database + auth)

1. Go to **https://supabase.com** → Sign up (free)
2. Click **New Project** → give it a name like `ginny-crm`
3. Set a strong database password → **Create project** (takes ~2 min)
4. Once ready, go to **Settings → API** and copy:
   - **Project URL** → looks like `https://abcdefgh.supabase.co`
   - **anon / public key** → a long JWT string

---

## Step 2 — Run the database schema

1. In Supabase dashboard, go to **SQL Editor**
2. Click **New query**
3. Copy the entire contents of `supabase/schema.sql` and paste it in
4. **IMPORTANT**: on line 16, replace `YOUR_EMAIL@example.com` with your actual email
5. Click **Run** (green button)

You should see "Success. No rows returned."

---

## Step 3 — Configure email authentication

1. In Supabase → **Authentication → Providers**
2. **Email** is enabled by default — keep it on
3. Go to **Authentication → URL Configuration**:
   - **Site URL**: `https://your-vercel-app.vercel.app` (you'll update this after Step 5)
   - **Redirect URLs**: add `https://your-vercel-app.vercel.app`
4. Go to **Authentication → Email Templates** → customize the magic link email with Ginny branding if you want

---

## Step 4 — Push code to GitHub

```bash
# In your terminal, from the ginny-crm folder:
git init
git add .
git commit -m "Initial Ginny CRM"

# Create a new repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/ginny-crm.git
git push -u origin main
```

---

## Step 5 — Deploy to Vercel (free hosting)

1. Go to **https://vercel.com** → Sign up with GitHub (free)
2. Click **Add New → Project**
3. Import your `ginny-crm` GitHub repo
4. Vercel auto-detects Vite — no config needed
5. Before deploying, click **Environment Variables** and add:

| Key | Value |
|-----|-------|
| `VITE_SUPABASE_URL` | Your Supabase Project URL |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon key |
| `VITE_ANTHROPIC_API_KEY` | Your Anthropic API key (from console.anthropic.com) |

6. Click **Deploy** — takes ~1 minute
7. Copy your Vercel URL (e.g. `https://ginny-crm.vercel.app`)

---

## Step 6 — Update Supabase with your live URL

1. Back in Supabase → **Authentication → URL Configuration**
2. Update **Site URL** to your Vercel URL
3. Add it to **Redirect URLs** too

---

## Step 7 — Invite your co-founders

Once deployed:
1. Log in with your own email (you'll receive a magic link)
2. Click **👥 Manage Access** in the top bar (admin only)
3. Add co-founder emails with role `editor` or `viewer`
4. They'll be able to sign in via magic link — no password ever

---

## Step 8 — Get your Anthropic API key

1. Go to **https://console.anthropic.com**
2. **API Keys → Create Key**
3. Copy and paste into Vercel environment variable `VITE_ANTHROPIC_API_KEY`
4. Redeploy (Vercel → your project → Redeploy)

---

## Role system

| Role    | Can do |
|---------|--------|
| `admin` | Everything: add/edit/delete leads, manage invites, view all |
| `editor`| Add and edit leads, use AI advisor, send emails |
| `viewer`| Read-only: see pipeline, funnel, briefing |

---

## Local development

```bash
cd ginny-crm
cp .env.example .env.local
# Fill in your keys in .env.local
npm install
npm run dev
# Opens at http://localhost:5173
```

---

## Security notes

- **Invite-only**: only emails in the `allowed_users` table can sign in
- **Magic link auth**: no passwords — Supabase sends a secure email link
- **Row Level Security**: Supabase enforces permissions at the database level — even if someone gets the anon key, they cannot read data unless their email is invited
- **Encrypted in transit**: Supabase uses HTTPS/TLS for all connections
- **Data at rest**: Supabase encrypts data at rest in their managed Postgres

---

## Updating the app

```bash
# Make changes locally, then:
git add .
git commit -m "your change"
git push
# Vercel auto-deploys on every push
```

---

## Troubleshooting

**"Not invited" error**: Make sure you ran the SQL schema and replaced your email on line 16.

**Magic link not arriving**: Check spam. In Supabase → Authentication → Logs to debug.

**AI Advisor not working**: Check `VITE_ANTHROPIC_API_KEY` is set in Vercel environment variables and you've redeployed.

**Real-time not syncing**: Supabase real-time is enabled by default. If issues, check Supabase → Database → Replication.
