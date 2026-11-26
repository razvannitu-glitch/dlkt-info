-- Hosted integration ONLY. Base 1a971c8070dd3ad7e5b7e38e31a259238c570500; never apply to production.
-- The two narrowly scoped read-only helpers deliberately run under the
-- existing administrator because managed Auth tables use RLS without a
-- policy for machine roles. No managed Auth grants/policies or DDL changed.
-- Their callers are constrained NOLOGIN function owners, not browser roles.
-- p_owner/p_session come from a freshly Auth-verified server identity;
-- the bridge is not an authentication or JWT verification API.
do $$
begin
 if current_user<>'postgres' or not exists(select 1 from pg_roles where rolname=current_user and rolbypassrls) then raise exception 'ADMIN_CONTEXT_INVALID';end if;
 if exists(select 1 from auth.users) or exists(select 1 from auth.sessions)
 or exists(select 1 from dlkt_info_billing.customer_bindings)
 or exists(select 1 from dlkt_info_billing.checkout_intents)
 or exists(select 1 from pg_namespace where nspname in ('dlkt_info_auth_boundary','dlkt_info_connection_vault','dlkt_info_account_lifecycle')) then raise exception 'INTEGRATION_NOT_EMPTY';end if;
end;
$$;
create schema dlkt_info_auth_boundary;
revoke all on schema dlkt_info_auth_boundary from public,anon,authenticated,authenticator,service_role;
create function dlkt_info_auth_boundary.session_is_current(p_owner uuid,p_session uuid)
returns boolean language sql security definer set search_path=pg_catalog as $$
 select p_owner is not null and p_session is not null
 and (auth.uid() is null or auth.uid()=p_owner)
 and exists(select 1 from auth.sessions s where s.id=p_session and s.user_id=p_owner
 and (s.not_after is null or s.not_after>clock_timestamp()));
$$;
create function dlkt_info_auth_boundary.owner_session_count(p_owner uuid)
returns bigint language sql security definer set search_path=pg_catalog as $$
 select count(*) from auth.sessions s where s.user_id=p_owner and (auth.uid() is null or auth.uid()=p_owner);
$$;
revoke all on all functions in schema dlkt_info_auth_boundary from public,anon,authenticated,authenticator,service_role;
-- Own-table FK protection, not an auth.users trigger. Financial data and
-- encrypted grants cannot vanish due to an uncoordinated Auth deletion.
alter table dlkt_info_billing.customer_bindings drop constraint customer_bindings_owner_id_fkey;
alter table dlkt_info_billing.customer_bindings add constraint customer_bindings_owner_id_fkey foreign key(owner_id) references auth.users(id) on delete restrict;
grant dlkt_billing_checkout_owner to postgres with set true, inherit true;
-- Private Connection Vault candidate. DO NOT APPLY TO PRODUCTION.

create role dlkt_connection_vault_owner nologin noinherit nobypassrls;
grant dlkt_connection_vault_owner to postgres with set true, inherit true;
create role dlkt_connection_vault_api nologin noinherit nobypassrls;
grant dlkt_connection_vault_api to postgres with set true, inherit true;
create schema dlkt_info_connection_vault;
revoke all on schema dlkt_info_connection_vault from public,anon,authenticated,service_role;
grant usage on schema dlkt_info_connection_vault to dlkt_connection_vault_owner,dlkt_connection_vault_api;

-- Exact live schema column names verified by read-only metadata. No browser
-- role or runtime caller receives auth schema access. Lab-only policy; review
-- Supabase-managed schema compatibility and session lifetime configuration
-- before generating any production migration.
grant usage on schema dlkt_info_auth_boundary to dlkt_connection_vault_owner;
grant execute on function dlkt_info_auth_boundary.session_is_current(uuid,uuid) to dlkt_connection_vault_owner;

create table dlkt_info_connection_vault.connections (
  owner_id uuid not null references auth.users(id) on delete restrict,
  provider_id text not null check(provider_id in ('gmail','outlook','instagram','facebook-pages')),
  connection_id uuid not null unique,
  account_label text not null check(length(account_label) between 1 and 200 and account_label !~ '[[:cntrl:]]'),
  status text not null check(status in ('connected','reconnect-required')),
  sealed_grant text not null check(length(sealed_grant) between 44 and 65536 and sealed_grant ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'),
  connected_at timestamptz not null,
  last_sync_at timestamptz,
  operation_expires_at timestamptz,
  revision uuid not null,
  primary key(owner_id,provider_id),
  check(last_sync_at is null or last_sync_at>=connected_at)
);
create table dlkt_info_connection_vault.pending_authorizations (
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider_id text not null check(provider_id in ('gmail','outlook','instagram','facebook-pages')),
  session_id uuid not null references auth.sessions(id) on delete cascade,
  state_hash text not null unique check(state_hash ~ '^[A-Za-z0-9_-]{43}$'),
  session_hash text not null check(session_hash ~ '^[A-Za-z0-9_-]{43}$'),
  sealed_verifier text not null check(length(sealed_verifier) between 44 and 4096 and sealed_verifier ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'),
  expires_at timestamptz not null,
  primary key(owner_id,provider_id)
);
alter table dlkt_info_connection_vault.connections enable row level security;
alter table dlkt_info_connection_vault.pending_authorizations enable row level security;
revoke all on all tables in schema dlkt_info_connection_vault from public,anon,authenticated,service_role,dlkt_connection_vault_api;
grant select,insert,update,delete on dlkt_info_connection_vault.connections,dlkt_info_connection_vault.pending_authorizations to dlkt_connection_vault_owner;
create policy vault_connection_machine on dlkt_info_connection_vault.connections for all to dlkt_connection_vault_owner using(true) with check(true);
create policy vault_authorization_machine on dlkt_info_connection_vault.pending_authorizations for all to dlkt_connection_vault_owner using(true) with check(true);

-- Called exclusively under the constrained definer. The machine caller must
-- derive p_owner and p_session from a freshly provider-verified access token.
-- Presence plus not_after is not the entire Supabase JWT/inactivity policy.
create function dlkt_info_connection_vault.require_session(p_owner uuid,p_session uuid)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if p_owner is null or p_session is null or not dlkt_info_auth_boundary.session_is_current(p_owner,p_session) then raise exception using errcode='28000',message='VAULT_SESSION_INVALID'; end if;
end;
$$;

create function dlkt_info_connection_vault.list_connections(p_owner uuid,p_session uuid)
returns setof dlkt_info_connection_vault.connections
language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform dlkt_info_connection_vault.require_session(p_owner,p_session);
  return query select c.* from dlkt_info_connection_vault.connections c where c.owner_id=p_owner order by c.provider_id;
end;
$$;
create function dlkt_info_connection_vault.read_connection(p_owner uuid,p_session uuid,p_provider text)
returns setof dlkt_info_connection_vault.connections
language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform dlkt_info_connection_vault.require_session(p_owner,p_session);
  return query select c.* from dlkt_info_connection_vault.connections c where c.owner_id=p_owner and c.provider_id=p_provider;
end;
$$;

-- CAS protects an immutable owner/provider/connection identity and rejects
-- stale updates, including races between refresh, OAuth and disconnect.
create function dlkt_info_connection_vault.save_connection(
 p_owner uuid,p_session uuid,p_provider text,p_connection uuid,p_label text,p_status text,p_sealed text,
 p_connected timestamptz,p_last_sync timestamptz,p_operation_expires timestamptz,p_revision uuid,p_expected uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare v_count integer; v_now timestamptz;
begin
  perform dlkt_info_connection_vault.require_session(p_owner,p_session);
  v_now:=clock_timestamp();
  if p_revision is null or p_revision is not distinct from p_expected or p_connected is null or p_connected>v_now
    or (p_last_sync is not null and (p_last_sync<p_connected or p_last_sync>v_now))
    or (p_operation_expires is not null and (p_operation_expires<=v_now or p_operation_expires>v_now+interval '125 seconds')) then return false; end if;
  if p_expected is null then
    insert into dlkt_info_connection_vault.connections(owner_id,provider_id,connection_id,account_label,status,sealed_grant,
      connected_at,last_sync_at,operation_expires_at,revision)
    values(p_owner,p_provider,p_connection,p_label,p_status,p_sealed,p_connected,p_last_sync,p_operation_expires,p_revision)
    on conflict do nothing;
  else
    update dlkt_info_connection_vault.connections c set account_label=p_label,status=p_status,sealed_grant=p_sealed,
      last_sync_at=p_last_sync,operation_expires_at=p_operation_expires,revision=p_revision
    where c.owner_id=p_owner and c.provider_id=p_provider and c.connection_id=p_connection
      and c.connected_at=p_connected and c.revision=p_expected;
  end if;
  get diagnostics v_count=row_count;
  perform dlkt_info_connection_vault.require_session(p_owner,p_session);
  return v_count=1;
end;
$$;
create function dlkt_info_connection_vault.remove_connection(p_owner uuid,p_session uuid,p_provider text,p_expected uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare v_count integer;
begin
  perform dlkt_info_connection_vault.require_session(p_owner,p_session);
  delete from dlkt_info_connection_vault.connections c where c.owner_id=p_owner and c.provider_id=p_provider and c.revision=p_expected;
  get diagnostics v_count=row_count;
  perform dlkt_info_connection_vault.require_session(p_owner,p_session);
  return v_count=1;
end;
$$;

create function dlkt_info_connection_vault.put_authorization(p_owner uuid,p_session uuid,p_provider text,p_state_hash text,p_session_hash text,p_sealed text,p_expiry timestamptz)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare v_now timestamptz;
begin
  perform dlkt_info_connection_vault.require_session(p_owner,p_session);
  v_now:=clock_timestamp();
  if p_expiry is null or p_expiry<=v_now or p_expiry>v_now+interval '600 seconds' then return false; end if;
  insert into dlkt_info_connection_vault.pending_authorizations(owner_id,provider_id,session_id,state_hash,session_hash,sealed_verifier,expires_at)
  values(p_owner,p_provider,p_session,p_state_hash,p_session_hash,p_sealed,p_expiry)
  on conflict(owner_id,provider_id) do update set session_id=excluded.session_id,state_hash=excluded.state_hash,
    session_hash=excluded.session_hash,sealed_verifier=excluded.sealed_verifier,expires_at=excluded.expires_at;
  perform dlkt_info_connection_vault.require_session(p_owner,p_session);
  return true;
end;
$$;

-- An incorrect session/provider must not consume another authorization.
-- DELETE RETURNING provides one-time state even across independent processes.
create function dlkt_info_connection_vault.consume_authorization(p_owner uuid,p_session uuid,p_provider text,p_state_hash text,p_session_hash text)
returns setof dlkt_info_connection_vault.pending_authorizations
language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform dlkt_info_connection_vault.require_session(p_owner,p_session);
  return query delete from dlkt_info_connection_vault.pending_authorizations p
    where p.owner_id=p_owner and p.session_id=p_session and p.provider_id=p_provider
      and p.state_hash=p_state_hash and p.session_hash=p_session_hash and p.expires_at>clock_timestamp()
    returning p.*;
  perform dlkt_info_connection_vault.require_session(p_owner,p_session);
end;
$$;

grant create on schema dlkt_info_connection_vault to dlkt_connection_vault_owner;
alter function dlkt_info_connection_vault.require_session(uuid,uuid) owner to dlkt_connection_vault_owner;
alter function dlkt_info_connection_vault.list_connections(uuid,uuid) owner to dlkt_connection_vault_owner;
alter function dlkt_info_connection_vault.read_connection(uuid,uuid,text) owner to dlkt_connection_vault_owner;
alter function dlkt_info_connection_vault.save_connection(uuid,uuid,text,uuid,text,text,text,timestamptz,timestamptz,timestamptz,uuid,uuid) owner to dlkt_connection_vault_owner;
alter function dlkt_info_connection_vault.remove_connection(uuid,uuid,text,uuid) owner to dlkt_connection_vault_owner;
alter function dlkt_info_connection_vault.put_authorization(uuid,uuid,text,text,text,text,timestamptz) owner to dlkt_connection_vault_owner;
alter function dlkt_info_connection_vault.consume_authorization(uuid,uuid,text,text,text) owner to dlkt_connection_vault_owner;
revoke create on schema dlkt_info_connection_vault from dlkt_connection_vault_owner;
revoke all on all functions in schema dlkt_info_connection_vault from public,anon,authenticated,service_role,dlkt_connection_vault_api;
grant execute on function dlkt_info_connection_vault.list_connections(uuid,uuid),dlkt_info_connection_vault.read_connection(uuid,uuid,text),
dlkt_info_connection_vault.save_connection(uuid,uuid,text,uuid,text,text,text,timestamptz,timestamptz,timestamptz,uuid,uuid),
dlkt_info_connection_vault.remove_connection(uuid,uuid,text,uuid),
dlkt_info_connection_vault.put_authorization(uuid,uuid,text,text,text,text,timestamptz),
dlkt_info_connection_vault.consume_authorization(uuid,uuid,text,text,text) to dlkt_connection_vault_api;


-- Disposable laboratory only. No real user deletion or provider revocation.

create role dlkt_account_lifecycle_owner nologin noinherit nobypassrls;
grant dlkt_account_lifecycle_owner to postgres with set true, inherit true;
create role dlkt_account_lifecycle_api nologin noinherit nobypassrls;
grant dlkt_account_lifecycle_api to postgres with set true, inherit true;
create role dlkt_account_lifecycle_review nologin noinherit nobypassrls;
grant dlkt_account_lifecycle_review to postgres with set true, inherit true;
create schema dlkt_info_account_lifecycle;
revoke all on schema dlkt_info_account_lifecycle from public,anon,authenticated,service_role;
grant usage on schema dlkt_info_account_lifecycle to dlkt_account_lifecycle_owner,dlkt_account_lifecycle_api,dlkt_account_lifecycle_review;

-- Restrict deletion while the case exists. No function to erase the case or
-- declare completion is supplied: remote obligations require real verification.
create table dlkt_info_account_lifecycle.closure_requests(
 owner_id uuid primary key references auth.users(id) on delete restrict,
 request_id uuid not null unique,
 requested_session_id uuid not null,
 requested_at timestamptz not null default clock_timestamp(),
 state text generated always as ('pending_cleanup'::text) stored
);
create table dlkt_info_account_lifecycle.closure_tasks(
 request_id uuid not null references dlkt_info_account_lifecycle.closure_requests(request_id),
 kind text not null check(kind in ('revoke_sessions','revoke_external_grants','resolve_checkout','resolve_subscriptions','review_retention','reconcile_inflight')),
 state text not null default 'pending' check(state in ('pending','manual_review','retry')),
 revision bigint not null default 0 check(revision>=0),
 blocker text check(blocker in ('provider_unavailable','manual_revocation_required','payment_state_unknown','fiscal_review_required','inflight_state_unknown','identity_revocation_unconfirmed')),
 updated_at timestamptz not null default clock_timestamp(),
 primary key(request_id,kind),
 check((state='pending' and blocker is null and revision=0) or (state in ('manual_review','retry') and blocker is not null and revision>0))
);
alter table dlkt_info_account_lifecycle.closure_requests enable row level security;
alter table dlkt_info_account_lifecycle.closure_tasks enable row level security;
revoke all on all tables in schema dlkt_info_account_lifecycle from public,anon,authenticated,service_role,dlkt_account_lifecycle_api,dlkt_account_lifecycle_review;
grant select,insert on dlkt_info_account_lifecycle.closure_requests,dlkt_info_account_lifecycle.closure_tasks to dlkt_account_lifecycle_owner;
grant update(state,blocker,revision,updated_at) on dlkt_info_account_lifecycle.closure_tasks to dlkt_account_lifecycle_owner;
create policy lifecycle_request_read on dlkt_info_account_lifecycle.closure_requests for select to dlkt_account_lifecycle_owner using(true);
create policy lifecycle_request_insert on dlkt_info_account_lifecycle.closure_requests for insert to dlkt_account_lifecycle_owner with check(true);
create policy lifecycle_task_read on dlkt_info_account_lifecycle.closure_tasks for select to dlkt_account_lifecycle_owner using(true);
create policy lifecycle_task_insert on dlkt_info_account_lifecycle.closure_tasks for insert to dlkt_account_lifecycle_owner with check(true);
create policy lifecycle_task_update on dlkt_info_account_lifecycle.closure_tasks for update to dlkt_account_lifecycle_owner using(true) with check(true);

grant usage on schema dlkt_info_auth_boundary,dlkt_info_billing,dlkt_info_connection_vault to dlkt_account_lifecycle_owner;
grant execute on function dlkt_info_auth_boundary.session_is_current(uuid,uuid),dlkt_info_auth_boundary.owner_session_count(uuid) to dlkt_account_lifecycle_owner;
grant select on dlkt_info_billing.customer_bindings,dlkt_info_billing.checkout_intents,dlkt_info_billing.subscription_bindings to dlkt_account_lifecycle_owner;
grant select(owner_id) on dlkt_info_connection_vault.connections,dlkt_info_connection_vault.pending_authorizations to dlkt_account_lifecycle_owner;
create policy lifecycle_customer_read on dlkt_info_billing.customer_bindings for select to dlkt_account_lifecycle_owner using(true);
create policy lifecycle_checkout_read on dlkt_info_billing.checkout_intents for select to dlkt_account_lifecycle_owner using(true);
create policy lifecycle_subscription_read on dlkt_info_billing.subscription_bindings for select to dlkt_account_lifecycle_owner using(true);
create policy lifecycle_vault_read on dlkt_info_connection_vault.connections for select to dlkt_account_lifecycle_owner using(true);
create policy lifecycle_pending_read on dlkt_info_connection_vault.pending_authorizations for select to dlkt_account_lifecycle_owner using(true);

-- All cooperating mutations take this owner-scoped transaction lock first.
-- This lab requires READ COMMITTED: a stale repeatable-read snapshot must
-- not allow a write after a different transaction has committed a hold.
create function dlkt_info_account_lifecycle.lock_owner(p_owner uuid) returns void
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if p_owner is null or current_setting('transaction_isolation')<>'read committed' then
   raise exception using errcode='55000',message='ACCOUNT_LIFECYCLE_CONTEXT_INVALID';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('dlkt-account-closure:'||p_owner::text,0));
end;
$$;
create function dlkt_info_account_lifecycle.require_open_account(p_owner uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform dlkt_info_account_lifecycle.lock_owner(p_owner);
 if exists(select 1 from dlkt_info_account_lifecycle.closure_requests c where c.owner_id=p_owner) then
   raise exception using errcode='55000',message='ACCOUNT_CLOSING';
 end if;
end;
$$;
create function dlkt_info_account_lifecycle.require_identity(p_owner uuid,p_session uuid) returns void
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if p_owner is null or p_session is null or not dlkt_info_auth_boundary.session_is_current(p_owner,p_session) then
   raise exception using errcode='28000',message='ACCOUNT_SESSION_INVALID';
 end if;
end;
$$;

-- Trusted server supplies fresh verified identity and explicit confirmed intent.
-- SQL verifies a current session but is not a JWT verifier or reauthentication UI.
create function dlkt_info_account_lifecycle.request_closure(p_owner uuid,p_session uuid,p_request uuid)
returns table(request_id uuid,requested_at timestamptz,state text)
language plpgsql security definer set search_path=pg_catalog as $$
declare v_row dlkt_info_account_lifecycle.closure_requests%rowtype;
begin
 if p_request is null then raise exception using errcode='22023',message='ACCOUNT_REQUEST_INVALID'; end if;
 perform dlkt_info_account_lifecycle.require_identity(p_owner,p_session);
 perform dlkt_info_account_lifecycle.lock_owner(p_owner);
 perform dlkt_info_account_lifecycle.require_identity(p_owner,p_session);
 select c.* into v_row from dlkt_info_account_lifecycle.closure_requests c where c.owner_id=p_owner;
 if not found then
   insert into dlkt_info_account_lifecycle.closure_requests(owner_id,request_id,requested_session_id)
   values(p_owner,p_request,p_session) returning * into v_row;
   insert into dlkt_info_account_lifecycle.closure_tasks(request_id,kind)
   select v_row.request_id,k from unnest(array['revoke_sessions','revoke_external_grants','resolve_checkout','resolve_subscriptions','review_retention','reconcile_inflight']) as k;
 end if;
 return query select v_row.request_id,v_row.requested_at,v_row.state;
end;
$$;
create function dlkt_info_account_lifecycle.read_closure(p_owner uuid,p_session uuid)
returns table(request_id uuid,requested_at timestamptz,state text)
language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform dlkt_info_account_lifecycle.require_identity(p_owner,p_session);
 return query select c.request_id,c.requested_at,c.state from dlkt_info_account_lifecycle.closure_requests c where c.owner_id=p_owner;
end;
$$;

-- Operator sees counts, not credentials or raw billing objects. A count of
-- zero is never proof that remote revocation or fiscal retention is resolved.
create function dlkt_info_account_lifecycle.inspect_closure(p_request uuid)
returns table(request_id uuid,owner_id uuid,state text,sessions bigint,connections bigint,pending_oauth bigint,open_checkout bigint,subscriptions bigint,billing_customers bigint)
language sql security definer set search_path=pg_catalog as $$
 select c.request_id,c.owner_id,c.state,
 dlkt_info_auth_boundary.owner_session_count(c.owner_id),
 (select count(*) from dlkt_info_connection_vault.connections v where v.owner_id=c.owner_id),
 (select count(*) from dlkt_info_connection_vault.pending_authorizations p where p.owner_id=c.owner_id),
 (select count(*) from dlkt_info_billing.checkout_intents i join dlkt_info_billing.customer_bindings b on b.account_id=i.account_id and b.customer_id=i.customer_id where b.owner_id=c.owner_id and i.state in ('reserved','attached')),
 (select count(*) from dlkt_info_billing.subscription_bindings s join dlkt_info_billing.customer_bindings b on b.account_id=s.account_id and b.customer_id=s.customer_id where b.owner_id=c.owner_id),
 (select count(*) from dlkt_info_billing.customer_bindings b where b.owner_id=c.owner_id)
 from dlkt_info_account_lifecycle.closure_requests c where c.request_id=p_request;
$$;
create function dlkt_info_account_lifecycle.read_tasks(p_request uuid)
returns table(kind text,state text,revision bigint,blocker text,updated_at timestamptz)
language sql security definer set search_path=pg_catalog as $$
 select t.kind,t.state,t.revision,t.blocker,t.updated_at from dlkt_info_account_lifecycle.closure_tasks t where t.request_id=p_request order by t.kind;
$$;
-- Record unresolved work only. No synthetic proof can mark a task complete.
create function dlkt_info_account_lifecycle.note_blocker(p_request uuid,p_kind text,p_expected bigint,p_state text,p_blocker text)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare n integer;
begin
 if p_expected is null or p_expected<0 or p_state is null or p_state not in ('retry','manual_review')
   or p_blocker is null or p_blocker not in ('provider_unavailable','manual_revocation_required','payment_state_unknown','fiscal_review_required','inflight_state_unknown','identity_revocation_unconfirmed') then return false; end if;
 update dlkt_info_account_lifecycle.closure_tasks t set state=p_state,blocker=p_blocker,revision=t.revision+1,updated_at=clock_timestamp()
 where t.request_id=p_request and t.kind=p_kind and t.revision=p_expected;
 get diagnostics n=row_count;
 return n=1;
end;
$$;

create function dlkt_info_account_lifecycle.guard_owner_write() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if tg_op='DELETE' then
   perform dlkt_info_account_lifecycle.require_open_account(old.owner_id);
   return old;
 end if;
 perform dlkt_info_account_lifecycle.require_open_account(new.owner_id);
 return new;
end;
$$;
create function dlkt_info_account_lifecycle.guard_new_checkout() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare v_owner uuid;
begin
 select c.owner_id into v_owner from dlkt_info_billing.customer_bindings c where c.account_id=new.account_id and c.customer_id=new.customer_id;
 perform dlkt_info_account_lifecycle.require_open_account(v_owner);
 return new;
end;
$$;


grant create on schema dlkt_info_account_lifecycle to dlkt_account_lifecycle_owner;
alter function dlkt_info_account_lifecycle.lock_owner(uuid) owner to dlkt_account_lifecycle_owner;
alter function dlkt_info_account_lifecycle.require_open_account(uuid) owner to dlkt_account_lifecycle_owner;
alter function dlkt_info_account_lifecycle.require_identity(uuid,uuid) owner to dlkt_account_lifecycle_owner;
alter function dlkt_info_account_lifecycle.request_closure(uuid,uuid,uuid) owner to dlkt_account_lifecycle_owner;
alter function dlkt_info_account_lifecycle.read_closure(uuid,uuid) owner to dlkt_account_lifecycle_owner;
alter function dlkt_info_account_lifecycle.inspect_closure(uuid) owner to dlkt_account_lifecycle_owner;
alter function dlkt_info_account_lifecycle.read_tasks(uuid) owner to dlkt_account_lifecycle_owner;
alter function dlkt_info_account_lifecycle.note_blocker(uuid,text,bigint,text,text) owner to dlkt_account_lifecycle_owner;
alter function dlkt_info_account_lifecycle.guard_owner_write() owner to dlkt_account_lifecycle_owner;
alter function dlkt_info_account_lifecycle.guard_new_checkout() owner to dlkt_account_lifecycle_owner;
revoke create on schema dlkt_info_account_lifecycle from dlkt_account_lifecycle_owner;
revoke all on all functions in schema dlkt_info_account_lifecycle from public,anon,authenticated,service_role,dlkt_account_lifecycle_api,dlkt_account_lifecycle_review;
grant execute on function dlkt_info_account_lifecycle.request_closure(uuid,uuid,uuid),dlkt_info_account_lifecycle.read_closure(uuid,uuid) to dlkt_account_lifecycle_api;
grant execute on function dlkt_info_account_lifecycle.inspect_closure(uuid),dlkt_info_account_lifecycle.read_tasks(uuid),
dlkt_info_account_lifecycle.note_blocker(uuid,text,bigint,text,text) to dlkt_account_lifecycle_review;
grant usage on schema dlkt_info_account_lifecycle to dlkt_connection_vault_owner,dlkt_billing_checkout_owner;
grant execute on function dlkt_info_account_lifecycle.require_open_account(uuid) to dlkt_connection_vault_owner,dlkt_billing_checkout_owner;


-- Database-side closure gate. Existing checkout terminal processing is still
-- permitted, because a delayed provider completion is a financial obligation.
-- Ordinary vault access is frozen; do not deploy before dedicated cleanup
-- access is available and all legacy connection records are migrated/reviewed.
create or replace function dlkt_info_connection_vault.require_session(p_owner uuid,p_session uuid)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if p_owner is null or p_session is null or not dlkt_info_auth_boundary.session_is_current(p_owner,p_session) then raise exception using errcode='28000',message='VAULT_SESSION_INVALID'; end if;
  perform dlkt_info_account_lifecycle.require_open_account(p_owner);
end;
$$;
create or replace function dlkt_info_billing.reserve_checkout(p_account text,p_owner uuid,p_plan text,p_intent uuid)
returns table(intent_id uuid,account_id text,customer_id text,owner_id uuid,price_id text,created_at bigint,expires_at bigint,session_id text,state text)
language plpgsql security definer set search_path=pg_catalog as $$
declare v_customer text; v_price text; v_created timestamptz; v_row dlkt_info_billing.checkout_intents%rowtype;
begin
  if p_owner is null or p_intent is null or p_plan is null or p_plan not in ('monthly','annual') then return; end if;
  perform dlkt_info_account_lifecycle.require_open_account(p_owner);
  select c.customer_id,p.price_id into v_customer,v_price from dlkt_info_billing.customer_bindings c
    join dlkt_info_billing.catalog_prices p on p.account_id=c.account_id
    where c.account_id=p_account and c.owner_id=p_owner and p.plan=p_plan;
  if not found then return; end if;
  -- Serialize the reservation for one immutable customer; a hash collision
  -- only causes benign contention. Uniqueness remains enforced by PostgreSQL.
  perform pg_advisory_xact_lock(hashtextextended(p_account||':'||v_customer,0));
  if not exists(select 1 from dlkt_info_billing.customer_bindings c where c.account_id=p_account and c.customer_id=v_customer and c.owner_id=p_owner) then return; end if;
  if exists(select 1 from dlkt_info_billing.subscription_bindings s where s.account_id=p_account and s.customer_id=v_customer) then return; end if;
  select q.* into v_row from dlkt_info_billing.checkout_intents q where q.account_id=p_account and q.customer_id=v_customer for update;
  if not found then
    v_created:=date_trunc('second',clock_timestamp());
    insert into dlkt_info_billing.checkout_intents(intent_id,account_id,customer_id,price_id,created_at,expires_at)
    values(p_intent,p_account,v_customer,v_price,v_created,extract(epoch from v_created)::bigint+3600)
    returning * into v_row;
  end if;
  if v_row.price_id<>v_price or v_row.state not in ('reserved','attached') then return; end if;
  return query select v_row.intent_id,v_row.account_id,v_row.customer_id,p_owner,v_row.price_id,
    extract(epoch from v_row.created_at)::bigint,v_row.expires_at,v_row.session_id,v_row.state;
end;
$$;
create or replace function dlkt_info_billing.attach_checkout(p_account text,p_intent uuid,p_owner uuid,p_customer text,p_price text,p_session text,p_expiry bigint)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare v_row dlkt_info_billing.checkout_intents%rowtype;
begin
  if p_session is null or p_session !~ '^cs_test_[A-Za-z0-9]{1,247}$' then return false; end if;
  perform dlkt_info_account_lifecycle.require_open_account(p_owner);
  select q.* into v_row from dlkt_info_billing.checkout_intents q where q.account_id=p_account and q.intent_id=p_intent for update;
  if not found or v_row.customer_id is distinct from p_customer or v_row.price_id is distinct from p_price
    or v_row.expires_at is distinct from p_expiry or v_row.state not in ('reserved','attached')
    or v_row.expires_at<=extract(epoch from clock_timestamp())
    or (v_row.session_id is not null and v_row.session_id<>p_session) then return false; end if;
  if not exists(select 1 from dlkt_info_billing.customer_bindings c where c.account_id=p_account and c.customer_id=p_customer and c.owner_id=p_owner) then return false; end if;
  update dlkt_info_billing.checkout_intents q set state='attached',session_id=p_session where q.intent_id=p_intent;
  return true;
exception when unique_violation then return false;
end;
$$;

create trigger lifecycle_customer_insert before insert on dlkt_info_billing.customer_bindings
for each row execute function dlkt_info_account_lifecycle.guard_owner_write();
create trigger lifecycle_checkout_insert before insert on dlkt_info_billing.checkout_intents
for each row execute function dlkt_info_account_lifecycle.guard_new_checkout();
create trigger lifecycle_vault_write before insert or update or delete on dlkt_info_connection_vault.connections
for each row execute function dlkt_info_account_lifecycle.guard_owner_write();
-- Pending OAuth deletion is intentionally allowed for auth-session cascades.
create trigger lifecycle_pending_write before insert or update on dlkt_info_connection_vault.pending_authorizations
for each row execute function dlkt_info_account_lifecycle.guard_owner_write();
-- No managed Auth trigger. The billing customer, vault credential and closure request FKs restrict direct deletion until a reviewed cleanup flow is available.


-- Disposable lab only. No live provider credentials or remote calls.

create role dlkt_account_cleanup_owner nologin noinherit nobypassrls;
grant dlkt_account_cleanup_owner to postgres with set true, inherit true;
create role dlkt_account_cleanup_worker nologin noinherit nobypassrls;
grant dlkt_account_cleanup_worker to postgres with set true, inherit true;
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


-- Remove broad defaults and administrative temporary inheritance.
revoke all on all functions in schema dlkt_info_connection_vault,dlkt_info_account_lifecycle from public,anon,authenticated,authenticator,service_role;
revoke all on all tables in schema dlkt_info_connection_vault,dlkt_info_account_lifecycle from public,anon,authenticated,authenticator,service_role;
revoke all on schema dlkt_info_connection_vault,dlkt_info_account_lifecycle from public,anon,authenticated,authenticator,service_role;
grant dlkt_connection_vault_owner to postgres with set true, inherit false;
grant dlkt_connection_vault_api to postgres with set true, inherit false;
grant dlkt_account_lifecycle_owner to postgres with set true, inherit false;
grant dlkt_account_lifecycle_api to postgres with set true, inherit false;
grant dlkt_account_lifecycle_review to postgres with set true, inherit false;
grant dlkt_account_cleanup_owner to postgres with set true, inherit false;
grant dlkt_account_cleanup_worker to postgres with set true, inherit false;
grant dlkt_billing_checkout_owner to postgres with set true, inherit false;
do $$
declare r text; t record; f record; s text;
begin
 foreach r in array array['anon','authenticated','service_role','authenticator'] loop
  foreach s in array array['dlkt_info_auth_boundary','dlkt_info_connection_vault','dlkt_info_account_lifecycle','dlkt_info_billing'] loop
   if has_schema_privilege(r,s,'USAGE') then raise exception 'Broad schema access: %/%',r,s;end if;
   for t in select c.oid,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=s and c.relkind='r' loop
    if not t.relrowsecurity or has_table_privilege(r,t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or has_any_column_privilege(r,t.oid,'SELECT,INSERT,UPDATE,REFERENCES') then raise exception 'Broad table access: %/%',r,s;end if;
   end loop;
   for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=s loop
    if has_function_privilege(r,f.oid,'EXECUTE') then raise exception 'Broad function access: %/%',r,f.proname;end if;
   end loop;
  end loop;
 end loop;
 if exists(select 1 from pg_roles where rolname like 'dlkt_%' and (rolcanlogin or rolsuper or rolbypassrls or rolcreatedb or rolcreaterole)) then raise exception 'Broad machine role';end if;
 if exists(select 1 from pg_auth_members m join pg_roles r on r.oid=m.roleid join pg_roles u on u.oid=m.member where r.rolname like 'dlkt_%' and u.rolname='postgres' and m.inherit_option) then raise exception 'Administrative inheritance retained';end if;
 if exists(select 1 from pg_roles where rolname like 'dlkt_%' and (pg_has_role('anon',oid,'MEMBER') or pg_has_role('authenticated',oid,'MEMBER') or pg_has_role('authenticator',oid,'MEMBER') or pg_has_role('service_role',oid,'MEMBER'))) then raise exception 'Broad machine membership';end if;
 if has_any_column_privilege('dlkt_connection_vault_owner','auth.sessions','SELECT,INSERT,UPDATE,REFERENCES') or has_any_column_privilege('dlkt_account_lifecycle_owner','auth.sessions','SELECT,INSERT,UPDATE,REFERENCES') then raise exception 'Direct managed session grant';end if;
 if has_function_privilege('dlkt_connection_vault_api','dlkt_info_auth_boundary.session_is_current(uuid,uuid)','EXECUTE') or has_function_privilege('dlkt_account_lifecycle_api','dlkt_info_auth_boundary.session_is_current(uuid,uuid)','EXECUTE') or has_function_privilege('dlkt_connection_vault_owner','dlkt_info_auth_boundary.owner_session_count(uuid)','EXECUTE') then raise exception 'Bridge privilege too broad';end if;
 if not has_function_privilege('dlkt_connection_vault_api','dlkt_info_connection_vault.list_connections(uuid,uuid)','EXECUTE')
 or not has_function_privilege('dlkt_account_lifecycle_api','dlkt_info_account_lifecycle.request_closure(uuid,uuid,uuid)','EXECUTE')
 or not has_function_privilege('dlkt_account_cleanup_worker','dlkt_info_account_lifecycle.claim_grant_cleanup(uuid)','EXECUTE')
 or not has_function_privilege('dlkt_billing_checkout_owner','dlkt_info_account_lifecycle.require_open_account(uuid)','EXECUTE') then raise exception 'Machine capability missing';end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname in ('dlkt_info_billing','dlkt_info_connection_vault','dlkt_info_account_lifecycle') and p.prosecdef and r.rolbypassrls) then raise exception 'Broad non-bridge definer';end if;
end;
$$;
