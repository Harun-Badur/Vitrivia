-- Run against a migrated LOCAL test database with psql -v ON_ERROR_STOP=1.
-- All fixtures are rolled back; this verifies actual PostgreSQL grants/RLS.
begin;
insert into auth.users (id, email) values
 ('a1000000-0000-0000-0000-000000000001', 'cache-rls-1@example.invalid'),
 ('a1000000-0000-0000-0000-000000000002', 'cache-rls-2@example.invalid');
insert into public.discover_recommendation_cache
 (scope, owner_id, kind, cache_key_hash, engine_version, catalog_version, anchor_product_id, catalog_fingerprint, context_fingerprint, payload)
values
 ('public', null, 'final', repeat('a',64), 'test', '', '__rls_test', '', '', 'shared'),
 ('a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'final', repeat('b',64), 'test', '', '__rls_test', '', '', 'own'),
 ('a1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002', 'final', repeat('c',64), 'test', '', '__rls_test', '', '', 'other');
set local role anon;
do $$ begin
 if (select count(*) from public.discover_recommendation_cache where anchor_product_id='__rls_test') <> 1 then raise exception 'anon isolation failed'; end if;
 if has_table_privilege(current_user,'public.discover_recommendation_cache','INSERT') then raise exception 'client write allowed'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$ begin
 if (select count(*) from public.discover_recommendation_cache where anchor_product_id='__rls_test') <> 2 then raise exception 'owner isolation failed'; end if;
 if has_column_privilege(current_user,'public.discover_recommendation_jobs','status','INSERT') then raise exception 'client status override allowed'; end if;
 if has_function_privilege(current_user,'public.claim_discover_recommendation_job()','EXECUTE') then raise exception 'client claim allowed'; end if;
 begin
  perform public.request_discover_recommendation_job('a1000000-0000-0000-0000-000000000002','test');
  raise exception 'cross-owner job allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
