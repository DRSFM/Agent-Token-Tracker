-- Agent Token Tracker v1.3
-- Only normalized usage metadata is stored. Conversation content and credentials
-- are intentionally absent from this schema.

create table if not exists public.cloud_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  installation_id text not null check (char_length(installation_id) between 16 and 128),
  name text not null default 'Unnamed device' check (char_length(name) between 1 and 120),
  platform text not null default 'unknown' check (char_length(platform) between 1 and 40),
  app_version text not null default 'unknown' check (char_length(app_version) between 1 and 40),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (user_id, installation_id)
);

create table if not exists public.cloud_usage_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id text not null check (event_id ~ '^sha256:v1:[0-9a-f]{64}$'),
  device_id uuid not null references public.cloud_devices(id) on delete cascade,
  occurred_at timestamptz not null,
  source text not null check (source in ('claude-code', 'codex', 'opencode', 'antigravity', 'grok', 'unknown')),
  usage_channel text not null check (usage_channel in ('account', 'api')),
  upstream_id text check (upstream_id is null or char_length(upstream_id) between 1 and 200),
  model text not null check (char_length(model) between 1 and 200),
  input_tokens bigint not null check (input_tokens >= 0),
  output_tokens bigint not null check (output_tokens >= 0),
  cache_read_tokens bigint not null check (cache_read_tokens >= 0),
  cache_creation_tokens bigint not null check (cache_creation_tokens >= 0),
  cache_tokens bigint not null check (cache_tokens >= 0),
  raw_total_tokens bigint not null check (raw_total_tokens >= 0),
  weighted_total_tokens numeric(20, 3) not null check (weighted_total_tokens >= 0),
  request_count smallint not null default 1 check (request_count = 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

create index if not exists cloud_usage_events_user_time_idx
  on public.cloud_usage_events (user_id, occurred_at desc);
create index if not exists cloud_usage_events_user_model_idx
  on public.cloud_usage_events (user_id, model, occurred_at desc);
create index if not exists cloud_usage_events_user_source_idx
  on public.cloud_usage_events (user_id, source, occurred_at desc);

alter table public.cloud_devices enable row level security;
alter table public.cloud_usage_events enable row level security;

drop policy if exists cloud_devices_select_own on public.cloud_devices;
create policy cloud_devices_select_own on public.cloud_devices
  for select to authenticated using (user_id = auth.uid());

drop policy if exists cloud_devices_insert_own on public.cloud_devices;
create policy cloud_devices_insert_own on public.cloud_devices
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists cloud_devices_update_own on public.cloud_devices;
create policy cloud_devices_update_own on public.cloud_devices
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists cloud_devices_delete_own on public.cloud_devices;
create policy cloud_devices_delete_own on public.cloud_devices
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists cloud_usage_events_select_own on public.cloud_usage_events;
create policy cloud_usage_events_select_own on public.cloud_usage_events
  for select to authenticated using (user_id = auth.uid());

drop policy if exists cloud_usage_events_insert_own on public.cloud_usage_events;
create policy cloud_usage_events_insert_own on public.cloud_usage_events
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists cloud_usage_events_update_own on public.cloud_usage_events;
create policy cloud_usage_events_update_own on public.cloud_usage_events
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists cloud_usage_events_delete_own on public.cloud_usage_events;
create policy cloud_usage_events_delete_own on public.cloud_usage_events
  for delete to authenticated using (user_id = auth.uid());

-- Keep automatic table exposure disabled. Authenticated users receive only the
-- table privileges required by the RLS-protected RPCs and future device UI.
revoke all on table public.cloud_devices from anon;
revoke all on table public.cloud_usage_events from anon;
grant select, insert, update, delete on table public.cloud_devices to authenticated;
grant select, insert, update, delete on table public.cloud_usage_events to authenticated;

create or replace function public.sync_usage_events(
  p_installation_id text,
  p_device_name text,
  p_platform text,
  p_app_version text,
  p_events jsonb
)
returns table (accepted_count integer, duplicate_count integer)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_device_id uuid;
  v_event jsonb;
  v_event_id text;
  v_is_new boolean;
  v_accepted integer := 0;
  v_duplicates integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if coalesce(jsonb_typeof(p_events), '') <> 'array' or jsonb_array_length(coalesce(p_events, '[]'::jsonb)) > 500 then
    raise exception 'A sync batch must be an array containing at most 500 events';
  end if;
  if coalesce(length(trim(p_installation_id)), 0) not between 16 and 128 then
    raise exception 'Invalid installation id';
  end if;

  insert into public.cloud_devices (user_id, installation_id, name, platform, app_version, last_seen_at, revoked_at)
  values (
    v_user_id,
    trim(p_installation_id),
    left(coalesce(nullif(trim(p_device_name), ''), 'Unnamed device'), 120),
    left(coalesce(nullif(trim(p_platform), ''), 'unknown'), 40),
    left(coalesce(nullif(trim(p_app_version), ''), 'unknown'), 40),
    now(),
    null
  )
  on conflict (user_id, installation_id) do update set
    name = excluded.name,
    platform = excluded.platform,
    app_version = excluded.app_version,
    last_seen_at = now(),
    revoked_at = null
  returning id into v_device_id;

  for v_event in select value from jsonb_array_elements(p_events)
  loop
    v_event_id := v_event ->> 'eventId';
    if v_event ->> 'schemaVersion' <> '1'
      or v_event_id is null
      or v_event_id !~ '^sha256:v1:[0-9a-f]{64}$'
      or (v_event ->> 'source') not in ('claude-code', 'codex', 'opencode', 'antigravity', 'grok', 'unknown')
      or (v_event ->> 'usageChannel') not in ('account', 'api')
      or nullif(v_event ->> 'model', '') is null
      or (v_event ->> 'requestCount') <> '1'
    then
      raise exception 'Invalid usage event %', v_event_id;
    end if;

    insert into public.cloud_usage_events (
      user_id, event_id, device_id, occurred_at, source, usage_channel, upstream_id, model,
      input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cache_tokens,
      raw_total_tokens, weighted_total_tokens, request_count, updated_at
    )
    values (
      v_user_id,
      v_event_id,
      v_device_id,
      (v_event ->> 'occurredAt')::timestamptz,
      v_event ->> 'source',
      v_event ->> 'usageChannel',
      nullif(left(v_event ->> 'upstreamId', 200), ''),
      left(v_event ->> 'model', 200),
      greatest(0, (v_event ->> 'inputTokens')::bigint),
      greatest(0, (v_event ->> 'outputTokens')::bigint),
      greatest(0, (v_event ->> 'cacheReadTokens')::bigint),
      greatest(0, (v_event ->> 'cacheCreationTokens')::bigint),
      greatest(0, (v_event ->> 'cacheTokens')::bigint),
      greatest(0, (v_event ->> 'rawTotalTokens')::bigint),
      greatest(0, (v_event ->> 'weightedTotalTokens')::numeric),
      1,
      now()
    )
    on conflict (user_id, event_id) do update set
      occurred_at = excluded.occurred_at,
      source = excluded.source,
      usage_channel = excluded.usage_channel,
      upstream_id = excluded.upstream_id,
      model = excluded.model,
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      cache_read_tokens = excluded.cache_read_tokens,
      cache_creation_tokens = excluded.cache_creation_tokens,
      cache_tokens = excluded.cache_tokens,
      raw_total_tokens = excluded.raw_total_tokens,
      weighted_total_tokens = excluded.weighted_total_tokens,
      updated_at = now()
    returning (xmax = 0) into v_is_new;

    if v_is_new then
      v_accepted := v_accepted + 1;
    else
      v_duplicates := v_duplicates + 1;
    end if;
  end loop;

  return query select v_accepted, v_duplicates;
end;
$$;

create or replace function public.delete_my_cloud_data()
returns void
language sql
security invoker
set search_path = public
as $$
  delete from public.cloud_usage_events where user_id = auth.uid();
  delete from public.cloud_devices where user_id = auth.uid();
$$;

grant execute on function public.sync_usage_events(text, text, text, text, jsonb) to authenticated;
grant execute on function public.delete_my_cloud_data() to authenticated;

create or replace function public.get_my_cloud_usage_summary()
returns jsonb
language sql
security invoker
set search_path = public
as $$
  with own_events as (
    select *
    from public.cloud_usage_events
    where user_id = auth.uid()
  ),
  source_totals as (
    select source as key, source as label,
      count(*)::integer as request_count,
      coalesce(sum(raw_total_tokens), 0) as raw_total_tokens,
      coalesce(sum(weighted_total_tokens), 0) as weighted_total_tokens
    from own_events
    group by source
    order by weighted_total_tokens desc
  ),
  model_totals as (
    select model as key, model as label,
      count(*)::integer as request_count,
      coalesce(sum(raw_total_tokens), 0) as raw_total_tokens,
      coalesce(sum(weighted_total_tokens), 0) as weighted_total_tokens
    from own_events
    group by model
    order by weighted_total_tokens desc
    limit 100
  ),
  device_totals as (
    select d.installation_id as key, d.name as label,
      count(*)::integer as request_count,
      coalesce(sum(e.raw_total_tokens), 0) as raw_total_tokens,
      coalesce(sum(e.weighted_total_tokens), 0) as weighted_total_tokens
    from own_events e
    join public.cloud_devices d on d.id = e.device_id
    group by d.installation_id, d.name
    order by weighted_total_tokens desc
  )
  select jsonb_build_object(
    'requestCount', (select count(*)::integer from own_events),
    'rawTotalTokens', (select coalesce(sum(raw_total_tokens), 0) from own_events),
    'weightedTotalTokens', (select coalesce(sum(weighted_total_tokens), 0) from own_events),
    'bySource', coalesce((select jsonb_agg(jsonb_build_object(
      'key', key, 'label', label, 'requestCount', request_count,
      'rawTotalTokens', raw_total_tokens, 'weightedTotalTokens', weighted_total_tokens
    )) from source_totals), '[]'::jsonb),
    'byModel', coalesce((select jsonb_agg(jsonb_build_object(
      'key', key, 'label', label, 'requestCount', request_count,
      'rawTotalTokens', raw_total_tokens, 'weightedTotalTokens', weighted_total_tokens
    )) from model_totals), '[]'::jsonb),
    'byDevice', coalesce((select jsonb_agg(jsonb_build_object(
      'key', key, 'label', label, 'requestCount', request_count,
      'rawTotalTokens', raw_total_tokens, 'weightedTotalTokens', weighted_total_tokens
    )) from device_totals), '[]'::jsonb)
  );
$$;

grant execute on function public.get_my_cloud_usage_summary() to authenticated;
