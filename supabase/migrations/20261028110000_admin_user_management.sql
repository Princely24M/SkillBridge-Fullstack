alter table public.profiles
  add column if not exists account_status text not null default 'active';

alter table public.profiles
  drop constraint if exists profiles_account_status_check;

alter table public.profiles
  add constraint profiles_account_status_check
  check (account_status in ('active', 'awaiting', 'inactive'));

update auth.users
set raw_app_meta_data = jsonb_set(
  coalesce(raw_app_meta_data, '{}'::jsonb),
  '{account_status}',
  to_jsonb('active'::text),
  true
)
where coalesce(raw_app_meta_data ->> 'account_status', '') not in ('active', 'awaiting', 'inactive');

insert into public.profiles (id, full_name, account_status)
select
  users.id,
  left(
    coalesce(
      nullif(btrim(users.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(users.email, ''), '@', 1), ''),
      'Candidate'
    ),
    160
  ),
  case
    when users.raw_app_meta_data ->> 'account_status' in ('active', 'awaiting', 'inactive')
      then users.raw_app_meta_data ->> 'account_status'
    else 'active'
  end
from auth.users as users
on conflict (id) do update
set account_status = excluded.account_status;

create or replace function public.current_account_status()
returns text
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select coalesce(
    (select profiles.account_status from public.profiles where profiles.id = (select auth.uid())),
    'inactive'
  );
$$;

revoke all on function public.current_account_status() from public, anon;
grant execute on function public.current_account_status() to authenticated;

drop policy if exists "Candidates can read their own profile" on public.profiles;
create policy "Candidates can read their own profile"
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    and public.current_account_status() in ('active', 'awaiting')
  );

drop policy if exists "Candidates can update their own profile" on public.profiles;
create policy "Candidates can update their own profile"
  on public.profiles for update to authenticated
  using (
    id = (select auth.uid())
    and public.current_account_status() in ('active', 'awaiting')
  )
  with check (
    id = (select auth.uid())
    and public.current_account_status() in ('active', 'awaiting')
  );

drop policy if exists "Candidates can read their own saved opportunities" on public.saved_opportunities;
create policy "Candidates can read their own saved opportunities"
  on public.saved_opportunities for select to authenticated
  using (
    user_id = (select auth.uid())
    and public.current_account_status() = 'active'
  );

drop policy if exists "Candidates can save opportunities for themselves" on public.saved_opportunities;
create policy "Candidates can save opportunities for themselves"
  on public.saved_opportunities for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.current_account_status() = 'active'
  );

drop policy if exists "Candidates can unsave their own opportunities" on public.saved_opportunities;
create policy "Candidates can unsave their own opportunities"
  on public.saved_opportunities for delete to authenticated
  using (
    user_id = (select auth.uid())
    and public.current_account_status() = 'active'
  );

create or replace function public.handle_new_candidate_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  candidate_name text;
  next_status text;
begin
  candidate_name := left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 160);
  if candidate_name = '' then
    candidate_name := left(coalesce(nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Candidate'), 160);
  end if;

  next_status := new.raw_app_meta_data ->> 'account_status';
  if next_status is null or next_status not in ('active', 'awaiting', 'inactive') then
    next_status := 'active';
  end if;

  insert into public.profiles (id, full_name, account_status)
  values (new.id, candidate_name, next_status)
  on conflict (id) do nothing;

  return new;
end;
$$;
