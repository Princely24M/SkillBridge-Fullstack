create table if not exists public.opportunities (
  id text primary key,
  title text not null,
  organisation text not null,
  category text not null,
  location text not null,
  closing_date date,
  experience_level text not null default 'Varies',
  description text not null,
  eligibility jsonb not null default '[]'::jsonb,
  required_documents jsonb not null default '[]'::jsonb,
  application_instructions text not null default '',
  official_application_url text not null default '',
  source_url text not null default '',
  source_name text not null default '',
  last_verified_at timestamptz,
  verification_status text not null default 'pending' check (verification_status in ('verified', 'pending', 'needs_review')),
  verification_level text not null default 'manual',
  status text not null default 'draft' check (status in ('draft', 'active', 'expired', 'pending')),
  is_verified boolean not null default false,
  is_sample boolean not null default false,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.opportunities enable row level security;

revoke all on public.opportunities from anon, authenticated;
grant select on public.opportunities to anon, authenticated;
grant insert, update, delete on public.opportunities to authenticated;

create policy if not exists "Public can read eligible opportunities"
  on public.opportunities for select to anon, authenticated
  using (
    status = 'active'
    and is_verified = true
    and is_sample = false
    and verification_status = 'verified'
  );

create policy if not exists "Authenticated users can manage opportunities"
  on public.opportunities for all to authenticated
  using (true)
  with check (true);

create index if not exists opportunities_status_idx on public.opportunities (status);
create index if not exists opportunities_verification_idx on public.opportunities (verification_status, is_verified, is_sample);
create index if not exists opportunities_category_idx on public.opportunities (category);
create index if not exists opportunities_location_idx on public.opportunities (location);
create index if not exists opportunities_closing_date_idx on public.opportunities (closing_date);
