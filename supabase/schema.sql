-- ============================================================
--  Ginny CRM — Supabase Schema
--  Run this entire file in: Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Allowed users (invite-only gate)
create table if not exists public.allowed_users (
  email      text primary key,
  role       text not null default 'viewer',  -- 'admin' | 'editor' | 'viewer'
  invited_by text,
  created_at timestamptz default now()
);

-- Seed: add yourself as admin (replace with your real email)
insert into public.allowed_users (email, role, invited_by)
values ('YOUR_EMAIL@example.com', 'admin', 'system')
on conflict (email) do nothing;

-- 2. Leads table
create table if not exists public.leads (
  id              text primary key default gen_random_uuid()::text,
  company         text not null,
  contact         text not null,
  email           text not null,
  phone           text,
  whatsapp        text,
  industry        text,
  value           numeric default 0,
  currency        text default 'INR',
  stage           text not null default 'lead',
  priority        text default 'medium',
  source          text,
  notes           text,
  assigned_to     text default 'you',
  reminder_date   date,
  reminder_note   text,
  history         jsonb default '[]'::jsonb,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- 3. Row Level Security — users must be authenticated AND invited
alter table public.leads enable row level security;
alter table public.allowed_users enable row level security;

-- Policy: read leads only if your email is in allowed_users
create policy "Invited users can read leads"
  on public.leads for select
  using (
    exists (
      select 1 from public.allowed_users
      where email = auth.jwt() ->> 'email'
    )
  );

-- Policy: editors + admins can insert
create policy "Editors can insert leads"
  on public.leads for insert
  with check (
    exists (
      select 1 from public.allowed_users
      where email = auth.jwt() ->> 'email'
        and role in ('admin', 'editor')
    )
  );

-- Policy: editors + admins can update
create policy "Editors can update leads"
  on public.leads for update
  using (
    exists (
      select 1 from public.allowed_users
      where email = auth.jwt() ->> 'email'
        and role in ('admin', 'editor')
    )
  );

-- Policy: only admins can delete
create policy "Admins can delete leads"
  on public.leads for delete
  using (
    exists (
      select 1 from public.allowed_users
      where email = auth.jwt() ->> 'email'
        and role = 'admin'
    )
  );

-- Policy: anyone authenticated can view allowed_users (to check own invite)
create policy "Users can check their own invite"
  on public.allowed_users for select
  using (email = auth.jwt() ->> 'email');

-- Policy: only admins can manage allowed_users
create policy "Admins manage invites"
  on public.allowed_users for all
  using (
    exists (
      select 1 from public.allowed_users
      where email = auth.jwt() ->> 'email'
        and role = 'admin'
    )
  );

-- 4. Auto-update updated_at
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger leads_updated_at
  before update on public.leads
  for each row execute procedure public.touch_updated_at();

-- 5. Sample leads (optional — delete in production)
insert into public.leads
  (id, company, contact, email, phone, whatsapp, industry, value, stage, priority, source, notes, assigned_to, reminder_date, reminder_note, history)
values
  ('L001','Stellar Dynamics','Arjun Mehta','arjun@stellar.co','+91 98765 43210','+91 98765 43210','Technology',450000,'quotation','high','LinkedIn','Demo done. Interested in full-stack solution.','you',current_date + 2,'Follow up on quotation','[{"date":"2026-05-01","action":"Lead created"},{"date":"2026-05-04","action":"Quotation sent via email"}]'),
  ('L002','NovaMed Health','Dr. Rajan Iyer','rajan@novamed.org','+91 99001 23456','+91 99001 23456','Healthcare',1200000,'sow_pending','critical','Conference','SOW drafted. Awaiting digital signature.','you',current_date,'Chase digital signature on SOW','[{"date":"2026-04-10","action":"Lead created"},{"date":"2026-04-25","action":"SOW shared for signature"}]')
on conflict (id) do nothing;
