-- Snapshot actor and entity identifiers without foreign keys so history survives deletion.
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  actor_name text not null,
  actor_email text not null,
  action text not null,
  entity_type text not null,
  entity_id text,
  entity_label text not null,
  description text not null,
  old_values jsonb not null default '{}'::jsonb,
  new_values jsonb not null default '{}'::jsonb,
  status text not null default 'success' check (status in ('success', 'failure')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_logs enable row level security;
revoke all on public.audit_logs from public, anon, authenticated;
grant select, insert on public.audit_logs to service_role;

drop policy if exists "Service role can manage audit logs" on public.audit_logs;
create policy "Service role can manage audit logs"
  on public.audit_logs for all to service_role
  using (true)
  with check (true);

create index if not exists audit_logs_created_at_idx on public.audit_logs (created_at desc, id desc);
create index if not exists audit_logs_actor_idx on public.audit_logs (actor_user_id, created_at desc);
create index if not exists audit_logs_action_idx on public.audit_logs (action, created_at desc);
create index if not exists audit_logs_entity_type_idx on public.audit_logs (entity_type, created_at desc);
create index if not exists audit_logs_status_idx on public.audit_logs (status, created_at desc);

create or replace function public.admin_search_audit_logs(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_actor uuid default null,
  p_action text default null,
  p_entity_type text default null,
  p_status text default null,
  p_search text default null,
  p_page integer default 1,
  p_limit integer default 25
)
returns table (
  id uuid,
  actor_user_id uuid,
  actor_name text,
  actor_email text,
  action text,
  entity_type text,
  entity_id text,
  entity_label text,
  description text,
  old_values jsonb,
  new_values jsonb,
  status text,
  metadata jsonb,
  created_at timestamptz,
  total_count bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    logs.id,
    logs.actor_user_id,
    logs.actor_name,
    logs.actor_email,
    logs.action,
    logs.entity_type,
    logs.entity_id,
    logs.entity_label,
    logs.description,
    logs.old_values,
    logs.new_values,
    logs.status,
    logs.metadata,
    logs.created_at,
    count(*) over () as total_count
  from public.audit_logs as logs
  where (p_from is null or logs.created_at >= p_from)
    and (p_to is null or logs.created_at < p_to)
    and (p_actor is null or logs.actor_user_id = p_actor)
    and (p_action is null or logs.action = p_action)
    and (p_entity_type is null or logs.entity_type = p_entity_type)
    and (p_status is null or logs.status = p_status)
    and (
      p_search is null
      or concat_ws(' ', logs.description, logs.entity_label, logs.entity_id, logs.actor_name, logs.actor_email, logs.action, logs.entity_type)
        ilike '%' || p_search || '%'
    )
  order by logs.created_at desc, logs.id desc
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset (greatest(coalesce(p_page, 1), 1)::bigint - 1)
    * least(greatest(coalesce(p_limit, 25), 1), 100)::bigint;
$$;

create or replace function public.admin_audit_actors()
returns table (actor_user_id uuid, actor_name text, actor_email text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct on (logs.actor_user_id)
    logs.actor_user_id,
    logs.actor_name,
    logs.actor_email
  from public.audit_logs as logs
  where logs.actor_user_id is not null
  order by logs.actor_user_id, logs.created_at desc;
$$;

create or replace function public.admin_manage_opportunity(
  p_operation text,
  p_id text,
  p_payload jsonb,
  p_actor_user_id uuid,
  p_actor_name text,
  p_actor_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  incoming public.opportunities;
  saved public.opportunities;
  previous public.opportunities;
  old_values jsonb := '{}'::jsonb;
  new_values jsonb := '{}'::jsonb;
  old_safe jsonb;
  new_safe jsonb;
  changed_field text;
  event_action text;
begin
  if p_operation not in ('create', 'update', 'delete') then
    raise exception 'Unsupported opportunity operation.';
  end if;

  if p_operation in ('update', 'delete') then
    select * into previous
    from public.opportunities
    where id = p_id
    for update;

    if not found then
      return jsonb_build_object('found', false, 'record', null);
    end if;
  end if;

  if p_operation = 'delete' then
    delete from public.opportunities where id = p_id returning * into saved;
    old_safe := jsonb_build_object(
      'title', saved.title,
      'organisation', saved.organisation,
      'category', saved.category,
      'location', saved.location,
      'closing_date', saved.closing_date,
      'experience_level', saved.experience_level,
      'description', left(saved.description, 500),
      'application_instructions', left(saved.application_instructions, 500),
      'source_name', saved.source_name,
      'verification_level', saved.verification_level,
      'opportunity_status', saved.status,
      'verification_status', saved.verification_status,
      'is_verified', saved.is_verified
    );
    insert into public.audit_logs (
      actor_user_id, actor_name, actor_email, action, entity_type, entity_id,
      entity_label, description, old_values, new_values, status
    ) values (
      p_actor_user_id, left(p_actor_name, 160), left(p_actor_email, 254),
      'opportunity.deleted', 'opportunity', saved.id, left(saved.title, 200),
      'Deleted opportunity "' || saved.title || '".', old_safe, '{}'::jsonb, 'success'
    );
    return jsonb_build_object('found', true, 'record', to_jsonb(saved));
  end if;

  incoming := jsonb_populate_record(null::public.opportunities, p_payload);
  if p_operation = 'create' then
    insert into public.opportunities (
      id, title, organisation, category, location, closing_date, experience_level,
      description, eligibility, required_documents, application_instructions,
      official_application_url, source_url, source_name, last_verified_at,
      verification_status, verification_level, status, is_verified, is_sample,
      imported_at, created_at, updated_at
    ) values (
      incoming.id, incoming.title, incoming.organisation, incoming.category, incoming.location,
      incoming.closing_date, incoming.experience_level, incoming.description, incoming.eligibility,
      incoming.required_documents, incoming.application_instructions, incoming.official_application_url,
      incoming.source_url, incoming.source_name, incoming.last_verified_at,
      incoming.verification_status, incoming.verification_level, incoming.status,
      incoming.is_verified, incoming.is_sample, incoming.imported_at, incoming.created_at, incoming.updated_at
    ) returning * into saved;

    new_safe := jsonb_build_object(
      'title', saved.title,
      'organisation', saved.organisation,
      'category', saved.category,
      'location', saved.location,
      'closing_date', saved.closing_date,
      'experience_level', saved.experience_level,
      'description', left(saved.description, 500),
      'application_instructions', left(saved.application_instructions, 500),
      'source_name', saved.source_name,
      'verification_level', saved.verification_level,
      'opportunity_status', saved.status,
      'verification_status', saved.verification_status,
      'is_verified', saved.is_verified
    );
    insert into public.audit_logs (
      actor_user_id, actor_name, actor_email, action, entity_type, entity_id,
      entity_label, description, old_values, new_values, status
    ) values (
      p_actor_user_id, left(p_actor_name, 160), left(p_actor_email, 254),
      'opportunity.created', 'opportunity', saved.id, left(saved.title, 200),
      'Created opportunity "' || saved.title || '" with status ' || saved.status || '.',
      '{}'::jsonb, new_safe, 'success'
    );
    return jsonb_build_object('found', true, 'record', to_jsonb(saved));
  end if;

  update public.opportunities
  set title = incoming.title,
      organisation = incoming.organisation,
      category = incoming.category,
      location = incoming.location,
      closing_date = incoming.closing_date,
      experience_level = incoming.experience_level,
      description = incoming.description,
      eligibility = incoming.eligibility,
      required_documents = incoming.required_documents,
      application_instructions = incoming.application_instructions,
      official_application_url = incoming.official_application_url,
      source_url = incoming.source_url,
      source_name = incoming.source_name,
      last_verified_at = incoming.last_verified_at,
      verification_status = incoming.verification_status,
      verification_level = incoming.verification_level,
      status = incoming.status,
      is_verified = incoming.is_verified,
      is_sample = incoming.is_sample,
      imported_at = incoming.imported_at,
      updated_at = incoming.updated_at
  where id = p_id
  returning * into saved;

  old_safe := jsonb_build_object(
    'title', previous.title,
    'organisation', previous.organisation,
    'category', previous.category,
    'location', previous.location,
    'closing_date', previous.closing_date,
    'experience_level', previous.experience_level,
    'description', left(previous.description, 500),
    'application_instructions', left(previous.application_instructions, 500),
    'source_name', previous.source_name,
    'verification_level', previous.verification_level,
    'opportunity_status', previous.status,
    'verification_status', previous.verification_status,
    'is_verified', previous.is_verified
  );
  new_safe := jsonb_build_object(
    'title', saved.title,
    'organisation', saved.organisation,
    'category', saved.category,
    'location', saved.location,
    'closing_date', saved.closing_date,
    'experience_level', saved.experience_level,
    'description', left(saved.description, 500),
    'application_instructions', left(saved.application_instructions, 500),
    'source_name', saved.source_name,
    'verification_level', saved.verification_level,
    'opportunity_status', saved.status,
    'verification_status', saved.verification_status,
    'is_verified', saved.is_verified
  );

  for changed_field in select jsonb_object_keys(new_safe)
  loop
    if (old_safe -> changed_field) is distinct from (new_safe -> changed_field) then
      old_values := old_values || jsonb_build_object(changed_field, old_safe -> changed_field);
      new_values := new_values || jsonb_build_object(changed_field, new_safe -> changed_field);
    end if;
  end loop;

  if old_values <> '{}'::jsonb then
    if old_values ? 'opportunity_status' then
      event_action := 'opportunity.status_changed';
      insert into public.audit_logs (
        actor_user_id, actor_name, actor_email, action, entity_type, entity_id,
        entity_label, description, old_values, new_values, status
      ) values (
        p_actor_user_id, left(p_actor_name, 160), left(p_actor_email, 254),
        event_action, 'opportunity', saved.id, left(saved.title, 200),
        'Changed opportunity "' || saved.title || '" status from '
          || previous.status || ' to ' || saved.status || '.',
        jsonb_build_object('opportunity_status', old_values -> 'opportunity_status'),
        jsonb_build_object('opportunity_status', new_values -> 'opportunity_status'),
        'success'
      );
      old_values := old_values - 'opportunity_status';
      new_values := new_values - 'opportunity_status';
    end if;

    if old_values <> '{}'::jsonb then
      insert into public.audit_logs (
        actor_user_id, actor_name, actor_email, action, entity_type, entity_id,
        entity_label, description, old_values, new_values, status
      ) values (
        p_actor_user_id, left(p_actor_name, 160), left(p_actor_email, 254),
        'opportunity.updated', 'opportunity', saved.id, left(saved.title, 200),
        'Updated opportunity "' || saved.title || '": '
          || array_to_string(array(select jsonb_object_keys(new_values)), ', ') || ' changed.',
        old_values, new_values, 'success'
      );
    end if;
  end if;
  return jsonb_build_object('found', true, 'record', to_jsonb(saved));
end;
$$;

revoke all on function public.admin_search_audit_logs(timestamptz, timestamptz, uuid, text, text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.admin_audit_actors() from public, anon, authenticated;
revoke all on function public.admin_manage_opportunity(text, text, jsonb, uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_search_audit_logs(timestamptz, timestamptz, uuid, text, text, text, text, integer, integer) to service_role;
grant execute on function public.admin_audit_actors() to service_role;
grant execute on function public.admin_manage_opportunity(text, text, jsonb, uuid, text, text) to service_role;

drop policy if exists "Authenticated users can manage opportunities" on public.opportunities;
revoke insert, update, delete on public.opportunities from anon, authenticated;
