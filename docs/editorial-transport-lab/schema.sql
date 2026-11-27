-- DISPOSABLE LAB ONLY. Not a Supabase migration or a production storage contract.
-- Dedicated PostgreSQL 17 database and fixture principals; no application credentials.
begin;
do $guard$
begin
 if current_database() <> 'editorial_transport_test'
  or current_setting('server_version_num')::integer not between 170000 and 179999
 then raise exception 'DISPOSABLE_EDITORIAL_TRANSPORT_DATABASE_REQUIRED'; end if;
end
$guard$;
create role dlkt_et_owner nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
create role dlkt_et_issuer login password 'fixture-et-issuer-only' noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
create role dlkt_et_writer login password 'fixture-et-writer-only' noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
create role dlkt_et_observer login password 'fixture-et-observer-only' noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
create role dlkt_et_reaper login password 'fixture-et-reaper-only' noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
create role dlkt_et_untrusted login password 'fixture-et-untrusted-only' noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
revoke all on schema public from public;
create schema dlkt_editorial_transport_lab authorization dlkt_et_owner;
revoke all on schema dlkt_editorial_transport_lab from public;
set role dlkt_et_owner;

-- Fixed ordinal vector: Education, Environment, Science & technology, Sport, Weather.
-- SQL validates the vector independently of the unmounted TypeScript wire parser.
create function dlkt_editorial_transport_lab.valid_counts(p_counts integer[]) returns boolean
language sql immutable set search_path = pg_catalog as $fn$
 select case when coalesce(array_ndims(p_counts)=1 and array_lower(p_counts,1)=1 and cardinality(p_counts)=5,false)
 then coalesce((select count(*)=5 and count(value)=5 and min(value)>=0 and max(value)<=500
  and sum(value) between 1 and 500 from unnest(p_counts) as item(value)),false)
 else false end
$fn$;
create table dlkt_editorial_transport_lab.window_state (
 singleton boolean primary key default true check(singleton),
 utc_day date not null,
 last_seen timestamptz not null,
 held boolean not null default false,
 issued integer not null default 0 check(issued between 0 and 256),
 accepted integer not null default 0 check(accepted between 0 and 128 and accepted<=issued)
);
insert into dlkt_editorial_transport_lab.window_state(utc_day,last_seen)
select (t at time zone 'UTC')::date,t from (select clock_timestamp() as t) as clock;
create table dlkt_editorial_transport_lab.grants (
 grant_digest text primary key check(grant_digest ~ '^[0-9a-f]{64}$'),
 issued_at timestamptz not null,
 expires_at timestamptz not null check(expires_at>issued_at and expires_at<=issued_at+interval '15 minutes'),
 state text not null default 'active' check(state in ('active','revoked','expired','held')),
 counts integer[],
 constraint grant_counts_valid check(counts is null or (state='active' and dlkt_editorial_transport_lab.valid_counts(counts)))
);
alter table dlkt_editorial_transport_lab.window_state enable row level security;
alter table dlkt_editorial_transport_lab.grants enable row level security;

-- A single row lock is intentionally conservative: all operations serialize in one
-- disposable UTC-day window. No operation accepts a client-supplied clock.
-- Locks live until the caller's transaction commits or rolls back.
create function dlkt_editorial_transport_lab.advance() returns timestamptz
language plpgsql security definer set search_path = pg_catalog as $fn$
declare
 v_window dlkt_editorial_transport_lab.window_state%rowtype;
 v_now timestamptz;
begin
 select * into strict v_window from dlkt_editorial_transport_lab.window_state where singleton for update;
 if v_window.held then return null; end if;
 v_now:=clock_timestamp();
 if v_now<v_window.last_seen then
  update dlkt_editorial_transport_lab.window_state set held=true where singleton;
  update dlkt_editorial_transport_lab.grants set state='held',counts=null where state='active';
  return null;
 end if;
 update dlkt_editorial_transport_lab.window_state set last_seen=v_now where singleton;
 update dlkt_editorial_transport_lab.grants set state='expired',counts=null
  where state='active' and expires_at<=v_now;
 return v_now;
end
$fn$;

-- Only the fixture issuer may create a digest. The issuer is a trusted synthetic
-- principal, NOT a proof of real consent or authorization to mount this function.
create function dlkt_editorial_transport_lab.issue(p_digest text,p_day date,p_purpose text,p_notice text) returns text
language plpgsql security definer set search_path = pg_catalog as $fn$
declare
 v_now timestamptz;
 v_window dlkt_editorial_transport_lab.window_state%rowtype;
 v_state text;
 v_end timestamptz;
begin
 if p_digest is null or length(p_digest)<>64 or p_digest !~ '^[0-9a-f]{64}$'
  or p_day is null or p_purpose is distinct from 'editorial-interactions'
  or p_notice is distinct from 'dlkt-editorial-notice-lab-1' then return 'invalid'; end if;
 v_now:=dlkt_editorial_transport_lab.advance();
 if v_now is null then return 'held'; end if;
 select * into strict v_window from dlkt_editorial_transport_lab.window_state where singleton;
 select state into v_state from dlkt_editorial_transport_lab.grants where grant_digest=p_digest;
 if found then
  if p_day is distinct from v_window.utc_day then return 'invalid'; end if;
  return case when v_state='active' then 'duplicate' else v_state end;
 end if;
 if p_day is distinct from v_window.utc_day or (v_now at time zone 'UTC')::date<>v_window.utc_day then return 'outside-window'; end if;
 if v_window.issued>=256 then return 'capacity'; end if;
 v_end:=((v_window.utc_day+1)::timestamp at time zone 'UTC');
 insert into dlkt_editorial_transport_lab.grants(grant_digest,issued_at,expires_at)
  values(p_digest,v_now,least(v_now+interval '15 minutes',v_end));
 update dlkt_editorial_transport_lab.window_state set issued=issued+1 where singleton;
 return 'created';
end
$fn$;

-- The real canonical-byte parser remains outside this SQL reference. The vector
-- and all fixed contract fields are checked again inside the locked transaction.
create function dlkt_editorial_transport_lab.ingest(
 p_digest text,p_day date,p_version text,p_scope text,p_taxonomy text,p_coverage text,p_counts integer[]
) returns text
language plpgsql security definer set search_path = pg_catalog as $fn$
declare
 v_now timestamptz;
 v_window dlkt_editorial_transport_lab.window_state%rowtype;
 v_grant dlkt_editorial_transport_lab.grants%rowtype;
begin
 if p_digest is null or length(p_digest)<>64 or p_digest !~ '^[0-9a-f]{64}$' then return 'unknown-grant'; end if;
 v_now:=dlkt_editorial_transport_lab.advance();
 if v_now is null then return 'held'; end if;
 select * into strict v_window from dlkt_editorial_transport_lab.window_state where singleton;
 select * into v_grant from dlkt_editorial_transport_lab.grants where grant_digest=p_digest;
 if not found then return 'unknown-grant'; end if;
 if v_grant.state<>'active' then return v_grant.state; end if;
 if p_day is distinct from v_window.utc_day or (v_now at time zone 'UTC')::date<>v_window.utc_day
  or p_version is distinct from 'dlkt-editorial-exposure-batch-lab-1'
  or p_scope is distinct from 'public-home-global-news-opt-in-lab'
  or p_taxonomy is distinct from 'iptc-media-topics-top-level-2026-10-16-dlkt-6'
  or p_coverage is distinct from 'document-only'
  or not dlkt_editorial_transport_lab.valid_counts(p_counts) then return 'invalid-batch'; end if;
 if v_grant.counts is not null then
  return case when v_grant.counts=p_counts then 'duplicate' else 'conflicting-replay' end;
 end if;
 if v_window.accepted>=128 then return 'capacity'; end if;
 update dlkt_editorial_transport_lab.grants set counts=p_counts where grant_digest=p_digest;
 update dlkt_editorial_transport_lab.window_state set accepted=accepted+1 where singleton;
 return 'accepted';
end
$fn$;

-- Withdrawal uses the same lock as ingestion. It is not blocked by a held
-- measurement clock; the known digest remains a bounded closed tombstone.
create function dlkt_editorial_transport_lab.withdraw(p_digest text) returns text
language plpgsql security definer set search_path = pg_catalog as $fn$
declare
 v_state text;
begin
 if p_digest is null or length(p_digest)<>64 or p_digest !~ '^[0-9a-f]{64}$' then return 'unknown-grant'; end if;
 perform dlkt_editorial_transport_lab.advance();
 select state into v_state from dlkt_editorial_transport_lab.grants where grant_digest=p_digest;
 if not found then return 'unknown-grant'; end if;
 if v_state='expired' then return 'expired'; end if;
 if v_state='active' then
  update dlkt_editorial_transport_lab.grants set state='revoked',counts=null where grant_digest=p_digest;
 end if;
 return 'withdrawn';
end
$fn$;

create function dlkt_editorial_transport_lab.sweep() returns text
language plpgsql security definer set search_path = pg_catalog as $fn$
begin
 return case when dlkt_editorial_transport_lab.advance() is null then 'held' else 'swept' end;
end
$fn$;

-- Test observer only. Not a reportable or sealed aggregate, privacy threshold,
-- distinct-browser count, or read-only production RPC. advance also expires rows.
create function dlkt_editorial_transport_lab.inspect() returns jsonb
language plpgsql security definer set search_path = pg_catalog as $fn$
declare
 v_now timestamptz;
 v_window dlkt_editorial_transport_lab.window_state%rowtype;
 v_status text;
 v_pending integer:=0;
 v_counts jsonb:='[]'::jsonb;
begin
 v_now:=dlkt_editorial_transport_lab.advance();
 select * into strict v_window from dlkt_editorial_transport_lab.window_state where singleton;
 v_status:=case when v_now is null then 'held'
  when (v_now at time zone 'UTC')::date<>v_window.utc_day then 'outside-window' else 'pending-only' end;
 if v_status='pending-only' then
  select count(*)::integer,jsonb_build_array(
   coalesce(sum(counts[1]),0),coalesce(sum(counts[2]),0),coalesce(sum(counts[3]),0),coalesce(sum(counts[4]),0),coalesce(sum(counts[5]),0))
   into v_pending,v_counts from dlkt_editorial_transport_lab.grants where state='active' and counts is not null;
 end if;
 return jsonb_build_object('status',v_status,'day',v_window.utc_day,'coverage','unsealed',
  'pendingContributions',v_pending,'acceptedInLifetime',v_window.accepted,'counts',v_counts,
  'productionActivationAllowed',false,'automationAllowed',false);
end
$fn$;

-- The definer owner is non-login. All runtime fixture principals have only the
-- exact functions below; no direct rows, role membership, or helper execution.
revoke all on all tables in schema dlkt_editorial_transport_lab from public;
revoke all on all functions in schema dlkt_editorial_transport_lab from public;
grant usage on schema dlkt_editorial_transport_lab to dlkt_et_issuer,dlkt_et_writer,dlkt_et_observer,dlkt_et_reaper;
grant execute on function dlkt_editorial_transport_lab.issue(text,date,text,text) to dlkt_et_issuer;
grant execute on function dlkt_editorial_transport_lab.ingest(text,date,text,text,text,text,integer[]) to dlkt_et_writer;
grant execute on function dlkt_editorial_transport_lab.withdraw(text) to dlkt_et_writer;
grant execute on function dlkt_editorial_transport_lab.inspect() to dlkt_et_observer;
grant execute on function dlkt_editorial_transport_lab.sweep() to dlkt_et_reaper;
reset role;
commit;
