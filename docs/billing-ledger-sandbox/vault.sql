-- Private Connection Vault candidate. DO NOT APPLY TO PRODUCTION.
begin;
create role dlkt_connection_vault_owner nologin noinherit nobypassrls;
create role dlkt_connection_vault_api nologin noinherit nobypassrls;
create schema dlkt_info_connection_vault;
revoke all on schema dlkt_info_connection_vault from public,anon,authenticated,service_role;
grant usage on schema dlkt_info_connection_vault to dlkt_connection_vault_owner,dlkt_connection_vault_api;

-- Exact live schema column names verified by read-only metadata. No browser
-- role or runtime caller receives auth schema access. Lab-only policy; review
-- Supabase-managed schema compatibility and session lifetime configuration
-- before generating any production migration.
grant usage on schema auth to dlkt_connection_vault_owner;
grant select(id,user_id,not_after) on auth.sessions to dlkt_connection_vault_owner;
create policy dlkt_vault_session_read on auth.sessions
  for select to dlkt_connection_vault_owner using(true);

create table dlkt_info_connection_vault.connections (
  owner_id uuid not null references auth.users(id) on delete cascade,
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
  if p_owner is null or p_session is null or not exists(
    select 1 from auth.sessions s where s.id=p_session and s.user_id=p_owner
      and (s.not_after is null or s.not_after>clock_timestamp())
  ) then raise exception using errcode='28000',message='VAULT_SESSION_INVALID'; end if;
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
commit;
