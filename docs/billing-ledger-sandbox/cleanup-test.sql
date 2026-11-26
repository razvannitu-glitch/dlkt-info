-- Synthetic closure cases only; no actual provider calls.
insert into auth.users(id) values('00000000-0000-4000-8000-000000000013'),('00000000-0000-4000-8000-000000000014');
insert into auth.sessions(id,user_id,not_after) values
 ('10000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000013',null),
 ('10000000-0000-4000-8000-000000000014','00000000-0000-4000-8000-000000000014',null);
set role dlkt_connection_vault_api;
do $$
declare o uuid:='00000000-0000-4000-8000-000000000013';s uuid:='10000000-0000-4000-8000-000000000013';
 v text:='v1.'||repeat('A',16)||'.'||repeat('B',22)||'.'||repeat('C',24);
begin
 if not dlkt_info_connection_vault.save_connection(o,s,'gmail','40000000-0000-4000-8000-000000000013','Fixture','connected',v,
 clock_timestamp()-interval '1 minute',null,null,'50000000-0000-4000-8000-000000000013',null) then raise exception 'Fixture Gmail save';end if;
 if not dlkt_info_connection_vault.save_connection(o,s,'outlook','40000000-0000-4000-8000-000000000023','Fixture','connected',v,
 clock_timestamp()-interval '1 minute',null,null,'50000000-0000-4000-8000-000000000023',null) then raise exception 'Fixture Outlook save';end if;
 if not dlkt_info_connection_vault.save_connection(o,s,'instagram','40000000-0000-4000-8000-000000000033','Fixture','connected',v,
 clock_timestamp()-interval '1 minute',null,clock_timestamp()+interval '120 seconds','50000000-0000-4000-8000-000000000033',null) then raise exception 'Fixture inflight save';end if;
 if not dlkt_info_connection_vault.save_connection('00000000-0000-4000-8000-000000000014','10000000-0000-4000-8000-000000000014','gmail','40000000-0000-4000-8000-000000000014','Fixture','connected',v,
 clock_timestamp()-interval '1 minute',null,null,'50000000-0000-4000-8000-000000000014',null) then raise exception 'Fixture race save';end if;
end;
$$;
reset role;
set role dlkt_account_lifecycle_api;
select * from dlkt_info_account_lifecycle.request_closure('00000000-0000-4000-8000-000000000013','10000000-0000-4000-8000-000000000013','30000000-0000-4000-8000-000000000013');
select * from dlkt_info_account_lifecycle.request_closure('00000000-0000-4000-8000-000000000014','10000000-0000-4000-8000-000000000014','30000000-0000-4000-8000-000000000014');
reset role;
do $$
declare r text;
begin
 if exists(select 1 from pg_roles where rolname='dlkt_account_cleanup_owner' and (rolsuper or rolbypassrls or rolcanlogin)) then raise exception 'Broad cleanup owner';end if;
 if has_schema_privilege('dlkt_account_cleanup_owner','dlkt_info_account_lifecycle','CREATE') then raise exception 'Cleanup owner CREATE retained';end if;
 foreach r in array array['anon','authenticated','service_role','dlkt_account_lifecycle_api','dlkt_account_lifecycle_review','dlkt_account_cleanup_worker'] loop
   if has_table_privilege(r,'dlkt_info_account_lifecycle.grant_cleanup_jobs','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   or has_any_column_privilege(r,'dlkt_info_account_lifecycle.grant_cleanup_jobs','SELECT,INSERT,UPDATE,REFERENCES') then raise exception 'Raw job access';end if;
   if r<>'dlkt_account_cleanup_worker' and has_function_privilege(r,'dlkt_info_account_lifecycle.claim_grant_cleanup(uuid)','EXECUTE') then raise exception 'Untrusted cleanup claim';end if;
   if has_any_column_privilege(r,'dlkt_info_connection_vault.connections','SELECT,INSERT,UPDATE,REFERENCES') then raise exception 'Raw vault grant';end if;
 end loop;
 if has_table_privilege('dlkt_account_cleanup_owner','dlkt_info_connection_vault.connections','INSERT,UPDATE,DELETE,TRUNCATE') then raise exception 'Cleanup can erase vault';end if;
end;
$$;
set role dlkt_account_cleanup_worker;
do $$
declare req uuid:='30000000-0000-4000-8000-000000000010';x record;
begin
 if dlkt_info_account_lifecycle.prepare_grant_cleanup(req)<>1 then raise exception 'Missing grant inventory';end if;
 if dlkt_info_account_lifecycle.prepare_grant_cleanup(req)<>0 then raise exception 'Duplicate jobs';end if;
 select * into strict x from dlkt_info_account_lifecycle.claim_grant_cleanup(req);
 if x.provider_id<>'gmail' or x.fence<>1 or x.sealed_grant is null then raise exception 'Invalid claim';end if;
 if dlkt_info_account_lifecycle.finish_grant_cleanup(req,x.connection_id,x.fence,'provider_acknowledged') then raise exception 'Undispatched operation acknowledged';end if;
 if dlkt_info_account_lifecycle.mark_grant_dispatched(req,x.connection_id,x.fence+1) then raise exception 'Wrong fence dispatch';end if;
 if not dlkt_info_account_lifecycle.mark_grant_dispatched(req,x.connection_id,x.fence) then raise exception 'Dispatch not recorded';end if;
 if dlkt_info_account_lifecycle.mark_grant_dispatched(req,x.connection_id,x.fence) then raise exception 'Dispatch replay';end if;
 if not dlkt_info_account_lifecycle.finish_grant_cleanup(req,x.connection_id,x.fence,'provider_acknowledged') then raise exception 'Fixture acknowledgement not recorded';end if;
 if dlkt_info_account_lifecycle.finish_grant_cleanup(req,x.connection_id,x.fence,'provider_acknowledged') then raise exception 'Terminal replay accepted';end if;
 if exists(select 1 from dlkt_info_account_lifecycle.claim_grant_cleanup(req)) then raise exception 'Acknowledged job reclaimed';end if;
end;
$$;
do $$
declare req uuid:='30000000-0000-4000-8000-000000000013';x record;
begin
 if dlkt_info_account_lifecycle.prepare_grant_cleanup(req)<>3 then raise exception 'Wrong cleanup inventory';end if;
 select * into strict x from dlkt_info_account_lifecycle.claim_grant_cleanup(req);
 if x.provider_id<>'gmail' then raise exception 'Wrong first job';end if;
 if not dlkt_info_account_lifecycle.mark_grant_dispatched(req,x.connection_id,x.fence) then raise exception 'Ambiguous dispatch fixture failed';end if;
 select * into strict x from dlkt_info_account_lifecycle.claim_grant_cleanup(req);
 if x.provider_id<>'outlook' or x.sealed_grant is not null then raise exception 'Unsupported provider credential disclosed';end if;
 if dlkt_info_account_lifecycle.mark_grant_dispatched(req,x.connection_id,x.fence) then raise exception 'Unsupported provider dispatched';end if;
 if not dlkt_info_account_lifecycle.finish_grant_cleanup(req,x.connection_id,x.fence,'manual_revocation_required') then raise exception 'Manual review missing';end if;
end;
$$;
reset role;
update dlkt_info_account_lifecycle.grant_cleanup_jobs set lease_until=clock_timestamp()-interval '1 second'
 where request_id='30000000-0000-4000-8000-000000000013' and provider_id='gmail';
set role dlkt_account_cleanup_worker;
do $$
declare req uuid:='30000000-0000-4000-8000-000000000013';
begin
 if exists(select 1 from dlkt_info_account_lifecycle.claim_grant_cleanup(req)) then raise exception 'Ambiguous dispatched job retried';end if;
 if dlkt_info_account_lifecycle.finish_grant_cleanup(req,'40000000-0000-4000-8000-000000000013',1,'provider_acknowledged') then raise exception 'Late acknowledgement accepted';end if;
 if dlkt_info_account_lifecycle.prepare_grant_cleanup('30000000-0000-4000-8000-000000000014')<>1 then raise exception 'Parallel fixture missing';end if;
end;
$$;
reset role;
set role dlkt_account_lifecycle_review;
do $$
declare req uuid:='30000000-0000-4000-8000-000000000013';
begin
 if not exists(select 1 from dlkt_info_account_lifecycle.read_grant_cleanup(req) where provider_id='gmail' and state='manual_review' and outcome='provider_outcome_unknown') then raise exception 'Ambiguous outcome lost';end if;
 if not exists(select 1 from dlkt_info_account_lifecycle.read_grant_cleanup(req) where provider_id='instagram' and state='manual_review' and outcome='inflight_state_unknown') then raise exception 'Inflight grant dispatched';end if;
 if not exists(select 1 from dlkt_info_account_lifecycle.read_grant_cleanup(req) where provider_id='outlook' and outcome='manual_revocation_required') then raise exception 'Manual outcome lost';end if;
end;
$$;
reset role;
do $$
begin
 if (select count(*) from dlkt_info_connection_vault.connections where owner_id in ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000013'))<>4 then raise exception 'Credentials erased without final review';end if;
 if exists(select 1 from dlkt_info_account_lifecycle.closure_requests where state<>'pending_cleanup') then raise exception 'Closure finalized by receipt';end if;
end;
$$;
select 'EXTERNAL_CLEANUP_SQL_OK' as result;
