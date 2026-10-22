create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 160),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;

drop policy if exists "Candidates can read their own profile" on public.profiles;
create policy "Candidates can read their own profile"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists "Candidates can update their own profile" on public.profiles;
create policy "Candidates can update their own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create table if not exists public.saved_opportunities (
  user_id uuid not null references auth.users (id) on delete cascade,
  opportunity_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, opportunity_id)
);

alter table public.saved_opportunities enable row level security;
revoke all on public.saved_opportunities from anon, authenticated;
grant select, insert, delete on public.saved_opportunities to authenticated;

drop policy if exists "Candidates can read their own saved opportunities" on public.saved_opportunities;
create policy "Candidates can read their own saved opportunities"
  on public.saved_opportunities for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Candidates can save opportunities for themselves" on public.saved_opportunities;
create policy "Candidates can save opportunities for themselves"
  on public.saved_opportunities for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "Candidates can unsave their own opportunities" on public.saved_opportunities;
create policy "Candidates can unsave their own opportunities"
  on public.saved_opportunities for delete to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.handle_new_candidate_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  candidate_name text;
begin
  candidate_name := left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 160);
  if candidate_name = '' then
    candidate_name := left(coalesce(nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Candidate'), 160);
  end if;

  insert into public.profiles (id, full_name)
  values (new.id, candidate_name)
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_candidate_profile() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_candidate_profile on auth.users;
create trigger on_auth_user_created_candidate_profile
  after insert on auth.users
  for each row execute function public.handle_new_candidate_profile();