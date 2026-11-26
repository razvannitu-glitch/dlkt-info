-- Disposable lab only. No live provider credentials or remote calls.
begin;
create role dlkt_account_cleanup_owner nologin noinherit nobypassrls;
create role dlkt_account_cleanup_worker nologin noinherit nobypassrls;
grant usage on schema dlkt_info_account_lifecycle to dlkt_account_cleanup_owner,dlkt_account_cleanup_worker;
grant select(owner_id,request_id) on dlkt_info_account_lifecycle.closure_requests to dlkt_account_cleanup_owner;
create policy cleanup_request_read on dlkt_info_account_lifecycle.closure_requests for select to dlkt_account_cleanup_owner using(true);
grant execute on function dlkt_info_account_lifecycle.lock_owner(uuid) to dlkt_account_cleanup_owner;
grant usage on schema dlkt_info_connection_vault to dlkt_account_cleanup_owner;
grant select(owner_id,provider_id,connection_id,sealed_grant,revision,operation_expires_at)
 on dlkt_info_connection_vault.connections to dlkt_account_cleanup_owner;
create policy cleanup_grant_read on dlkt_info_connection_vault.connections for select to dlkt_account_cleanup_owner using(true);

-- Store a revocation receipt, not a copy of the credential. A dispatched
-- operation whose outcome was lost is never automatically repeated.
create table dlkt_info_account_lifecycle.grant_cleanup_jobs(
 request_id uuid not null references dlkt_info_account_lifecycle.closure_requests(request_id),
 connection_id uuid not null,
 provider_id text not null check(provider_id in ('gmail','outlook','instagram','facebook-pages')),
 vault_revision uuid not null,
 state text not null check(state in ('ready','leased','dispatched','acknowledged','manual_review')),
 fence bigint not null default 0 check(fence between 0 and 5),
 lease_until timestamptz,
 outcome text check(outcome in ('inflight_state_unknown','claim_exhausted','provider_acknowledged','manual_revocation_required','provider_outcome_unknown','credential_unavailable','binding_changed')),
 updated_at timestamptz not null default clock_timestamp(),
 primary key(request_id,connection_id),
 unique(request_id,provider_id),
 check(
  (state='ready' and fence=0 and lease_until is null and outcome is null)
  or (state in ('leased','dispatched') and fence>0 and lease_until is not null and outcome is null)
  or (state='acknowledged' and fence>0 and lease_until is null and outcome is not null and outcome='provider_acknowledged')
  or (state='manual_review' and lease_until is null and outcome is not null and outcome<>'provider_acknowledged')
 )
);
alter table dlkt_info_account_lifecycle.grant_cleanup_jobs enable row level security;
revoke all on dlkt_info_account_lifecycle.grant_cleanup_jobs from public,anon,authenticated,service_role,dlkt_account_lifecycle_api,dlkt_account_lifecycle_review,dlkt_account_cleanup_worker;
grant select,insert,update on dlkt_info_account_lifecycle.grant_cleanup_jobs to dlkt_account_cleanup_owner;
create policy cleanup_job_machine on dlkt_info_account_lifecycle.grant_cleanup_jobs for all to dlkt_account_cleanup_owner using(true) with check(true);

create function dlkt_info_account_lifecycle.prepare_grant_cleanup(p_request uuid)
returns integer language plpgsql security definer set search_path=pg_catalog as $$
declare v_owner uuid; n integer;
begin
 select c.owner_id into v_owner from dlkt_info_account_lifecycle.closure_requests c where c.request_id=p_request;
 if not found then return 0; end if;
 perform dlkt_info_account_lifecycle.lock_owner(v_owner);
 insert into dlkt_info_account_lifecycle.grant_cleanup_jobs(request_id,connection_id,provider_id,vault_revision,state,outcome)
 select p_request,v.connection_id,v.provider_id,v.revision,
 case when v.operation_expires_at is not null then 'manual_review' else 'ready' end,
 case when v.operation_expires_at is not null then 'inflight_state_unknown' else null end
 from dlkt_info_connection_vault.connections v where v.owner_id=v_owner
 on conflict(request_id,connection_id) do nothing;
 get diagnostics n=row_count;
 return n;
end;
$$;

create function dlkt_info_account_lifecycle.claim_grant_cleanup(p_request uuid)
returns table(request_id uuid,owner_id uuid,connection_id uuid,provider_id text,vault_revision uuid,sealed_grant text,fence bigint,lease_until timestamptz)
language plpgsql security definer set search_path=pg_catalog as $$
declare v_owner uuid; v_job dlkt_info_account_lifecycle.grant_cleanup_jobs%rowtype; v_sealed text; v_now timestamptz;
begin
 select c.owner_id into v_owner from dlkt_info_account_lifecycle.closure_requests c where c.request_id=p_request;
 if not found then return; end if;
 perform dlkt_info_account_lifecycle.lock_owner(v_owner);
 v_now:=clock_timestamp();
 update dlkt_info_account_lifecycle.grant_cleanup_jobs j
 set state='manual_review',lease_until=null,
 outcome=case when j.state='dispatched' then 'provider_outcome_unknown' else 'claim_exhausted' end,updated_at=v_now
 where j.request_id=p_request and j.lease_until<=v_now and (j.state='dispatched' or (j.state='leased' and j.fence=5));
 select j.* into v_job from dlkt_info_account_lifecycle.grant_cleanup_jobs j
 where j.request_id=p_request and (j.state='ready' or (j.state='leased' and j.lease_until<=v_now and j.fence<5))
 order by j.provider_id limit 1 for update skip locked;
 if not found then return; end if;
 select v.sealed_grant into v_sealed from dlkt_info_connection_vault.connections v
 where v.owner_id=v_owner and v.connection_id=v_job.connection_id and v.provider_id=v_job.provider_id
 and v.revision=v_job.vault_revision and v.operation_expires_at is null;
 if not found then
   update dlkt_info_account_lifecycle.grant_cleanup_jobs j set state='manual_review',lease_until=null,outcome='binding_changed',updated_at=v_now
   where j.request_id=p_request and j.connection_id=v_job.connection_id;
   return;
 end if;
 update dlkt_info_account_lifecycle.grant_cleanup_jobs j set state='leased',fence=j.fence+1,
 lease_until=clock_timestamp()+interval '60 seconds',updated_at=clock_timestamp()
 where j.request_id=p_request and j.connection_id=v_job.connection_id returning j.* into v_job;
 -- Unsupported remote revocation methods need no credential disclosure.
 return query select p_request,v_owner,v_job.connection_id,v_job.provider_id,v_job.vault_revision,
 case when v_job.provider_id in ('gmail','facebook-pages') then v_sealed else null end,v_job.fence,v_job.lease_until;
end;
$$;

create function dlkt_info_account_lifecycle.mark_grant_dispatched(p_request uuid,p_connection uuid,p_fence bigint)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare v_owner uuid; n integer;
begin
 select c.owner_id into v_owner from dlkt_info_account_lifecycle.closure_requests c where c.request_id=p_request;
 if not found then return false; end if;
 perform dlkt_info_account_lifecycle.lock_owner(v_owner);
 update dlkt_info_account_lifecycle.grant_cleanup_jobs j set state='dispatched',updated_at=clock_timestamp()
 where j.request_id=p_request and j.connection_id=p_connection and j.fence=p_fence and j.state='leased'
 and j.lease_until>clock_timestamp() and j.provider_id in ('gmail','facebook-pages')
 and exists(select 1 from dlkt_info_connection_vault.connections v where v.owner_id=v_owner and v.connection_id=j.connection_id
 and v.provider_id=j.provider_id and v.revision=j.vault_revision and v.operation_expires_at is null);
 get diagnostics n=row_count;
 return n=1;
end;
$$;

create function dlkt_info_account_lifecycle.finish_grant_cleanup(p_request uuid,p_connection uuid,p_fence bigint,p_outcome text)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare v_owner uuid; n integer;
begin
 if p_outcome is null or p_outcome not in ('provider_acknowledged','manual_revocation_required','provider_outcome_unknown','credential_unavailable') then return false; end if;
 select c.owner_id into v_owner from dlkt_info_account_lifecycle.closure_requests c where c.request_id=p_request;
 if not found then return false; end if;
 perform dlkt_info_account_lifecycle.lock_owner(v_owner);
 update dlkt_info_account_lifecycle.grant_cleanup_jobs j
 set state=case when p_outcome='provider_acknowledged' then 'acknowledged' else 'manual_review' end,
 outcome=p_outcome,lease_until=null,updated_at=clock_timestamp()
 where j.request_id=p_request and j.connection_id=p_connection and j.fence=p_fence and j.lease_until>clock_timestamp()
 and (
   (j.state='dispatched' and j.provider_id in ('gmail','facebook-pages') and p_outcome in ('provider_acknowledged','provider_outcome_unknown'))
   or (j.state='leased' and p_outcome='credential_unavailable')
   or (j.state='leased' and j.provider_id in ('outlook','instagram') and p_outcome='manual_revocation_required')
 )
 and exists(select 1 from dlkt_info_connection_vault.connections v where v.owner_id=v_owner and v.connection_id=j.connection_id
 and v.provider_id=j.provider_id and v.revision=j.vault_revision and v.operation_expires_at is null);
 get diagnostics n=row_count;
 return n=1;
end;
$$;

-- Reviewer sees outcome metadata only; cannot read or remove credentials.
create function dlkt_info_account_lifecycle.read_grant_cleanup(p_request uuid)
returns table(connection_id uuid,provider_id text,state text,fence bigint,outcome text,updated_at timestamptz)
language sql security definer set search_path=pg_catalog as $$
 select j.connection_id,j.provider_id,j.state,j.fence,j.outcome,j.updated_at
 from dlkt_info_account_lifecycle.grant_cleanup_jobs j where j.request_id=p_request order by j.provider_id;
$$;
grant create on schema dlkt_info_account_lifecycle to dlkt_account_cleanup_owner;
alter function dlkt_info_account_lifecycle.prepare_grant_cleanup(uuid) owner to dlkt_account_cleanup_owner;
alter function dlkt_info_account_lifecycle.claim_grant_cleanup(uuid) owner to dlkt_account_cleanup_owner;
alter function dlkt_info_account_lifecycle.mark_grant_dispatched(uuid,uuid,bigint) owner to dlkt_account_cleanup_owner;
alter function dlkt_info_account_lifecycle.finish_grant_cleanup(uuid,uuid,bigint,text) owner to dlkt_account_cleanup_owner;
alter function dlkt_info_account_lifecycle.read_grant_cleanup(uuid) owner to dlkt_account_cleanup_owner;
revoke create on schema dlkt_info_account_lifecycle from dlkt_account_cleanup_owner;
revoke all on function dlkt_info_account_lifecycle.prepare_grant_cleanup(uuid),
 dlkt_info_account_lifecycle.claim_grant_cleanup(uuid),dlkt_info_account_lifecycle.mark_grant_dispatched(uuid,uuid,bigint),
 dlkt_info_account_lifecycle.finish_grant_cleanup(uuid,uuid,bigint,text),dlkt_info_account_lifecycle.read_grant_cleanup(uuid)
 from public,anon,authenticated,service_role,dlkt_account_lifecycle_api,dlkt_account_lifecycle_review,dlkt_account_cleanup_worker;
grant execute on function dlkt_info_account_lifecycle.prepare_grant_cleanup(uuid),dlkt_info_account_lifecycle.claim_grant_cleanup(uuid),
 dlkt_info_account_lifecycle.mark_grant_dispatched(uuid,uuid,bigint),dlkt_info_account_lifecycle.finish_grant_cleanup(uuid,uuid,bigint,text)
 to dlkt_account_cleanup_worker;
grant execute on function dlkt_info_account_lifecycle.read_grant_cleanup(uuid) to dlkt_account_lifecycle_review;
commit;
