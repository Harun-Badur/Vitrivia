-- Cache records are written only by the existing engine in a trusted Node worker.
create table public.discover_recommendation_cache (
  scope text not null,
  owner_id uuid references auth.users(id) on delete cascade,
  kind text not null check (kind in ('ranking', 'final')),
  cache_key_hash text not null check (cache_key_hash ~ '^[0-9a-f]{64}$'),
  engine_version text not null,
  catalog_version text not null,
  anchor_product_id text,
  catalog_fingerprint text not null,
  context_fingerprint text not null,
  payload text not null,
  updated_at timestamptz not null default now(),
  primary key (scope, kind, cache_key_hash),
  check ((scope = 'public' and owner_id is null) or (owner_id is not null and scope = owner_id::text))
);
create index discover_recommendation_cache_anchor_idx
  on public.discover_recommendation_cache (engine_version, anchor_product_id) where kind = 'final';
alter table public.discover_recommendation_cache enable row level security;
create policy discover_recommendation_cache_read on public.discover_recommendation_cache
  for select to anon, authenticated using
  (kind = 'final' and (scope = 'public' or owner_id = (select auth.uid())));
revoke all on public.discover_recommendation_cache from anon, authenticated;
grant select on public.discover_recommendation_cache to anon, authenticated;
grant all on public.discover_recommendation_cache to service_role;

create table public.discover_recommendation_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'error')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);
alter table public.discover_recommendation_jobs enable row level security;
create policy discover_recommendation_jobs_read on public.discover_recommendation_jobs
  for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.discover_recommendation_jobs from anon, authenticated;
grant select on public.discover_recommendation_jobs to authenticated;
grant all on public.discover_recommendation_jobs to service_role;

-- Keep large codec data off Realtime status rows.
create table public.discover_recommendation_job_payloads (
  job_id uuid primary key,
  owner_id uuid not null,
  request_payload text not null check (octet_length(request_payload) <= 4000000),
  result_packet text,
  foreign key (job_id, owner_id) references public.discover_recommendation_jobs(id, owner_id) on delete cascade
);
alter table public.discover_recommendation_job_payloads enable row level security;
create policy discover_recommendation_payloads_read on public.discover_recommendation_job_payloads
  for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.discover_recommendation_job_payloads from anon, authenticated;
grant select on public.discover_recommendation_job_payloads to authenticated;
grant all on public.discover_recommendation_job_payloads to service_role;

create function public.request_discover_recommendation_job(requested_owner_id uuid, payload text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_job_id uuid;
begin
  if auth.uid() is null or requested_owner_id is distinct from auth.uid() then
    raise exception 'Recommendation job owner mismatch' using errcode = '42501';
  end if;
  insert into public.discover_recommendation_jobs(owner_id) values(auth.uid()) returning id into v_job_id;
  insert into public.discover_recommendation_job_payloads(job_id,owner_id,request_payload) values(v_job_id,auth.uid(),payload);
  return v_job_id;
end $$;
revoke all on function public.request_discover_recommendation_job(uuid,text) from public,anon;
grant execute on function public.request_discover_recommendation_job(uuid,text) to authenticated;

create function public.claim_discover_recommendation_job()
returns setof public.discover_recommendation_jobs
language sql security definer set search_path = public as $$
  update public.discover_recommendation_jobs j set status = 'running', updated_at = now()
  where j.id = (select id from public.discover_recommendation_jobs
    where status = 'queued' or (status = 'running' and updated_at < now() - interval '10 minutes')
    order by created_at, id for update skip locked limit 1)
  returning j.*;
$$;
revoke all on function public.claim_discover_recommendation_job() from public, anon, authenticated;
grant execute on function public.claim_discover_recommendation_job() to service_role;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') and not exists
    (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'discover_recommendation_jobs') then
    alter publication supabase_realtime add table public.discover_recommendation_jobs;
  end if;
end $$;
