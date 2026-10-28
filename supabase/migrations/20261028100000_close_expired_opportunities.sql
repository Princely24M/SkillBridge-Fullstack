alter table public.opportunities
  drop constraint if exists opportunities_status_check;

alter table public.opportunities
  add constraint opportunities_status_check
  check (status in ('draft', 'active', 'expired', 'closed', 'pending'));

update public.opportunities
set status = 'closed',
    updated_at = now()
where closing_date < current_date
  and status <> 'closed';

drop policy if exists "Public can read eligible opportunities" on public.opportunities;

create policy "Public can read eligible opportunities"
  on public.opportunities for select to anon, authenticated
  using (
    is_verified = true
    and is_sample = false
    and verification_status = 'verified'
    and (status = 'active' or closing_date < current_date)
  );

create index if not exists opportunities_closing_date_idx
  on public.opportunities (closing_date);
