-- DISPOSABLE LAB ONLY. Run AFTER the 05A/05B tests in the same disposable database.
-- A variant experiment with synthetic retention, NOT a production migration.
begin;
do $guard$
begin
 if current_database() <> 'editorial_transport_test'
  or current_setting('server_version_num')::integer not between 170000 and 179999
 then raise exception 'DISPOSABLE_EDITORIAL_TRANSPORT_DATABASE_REQUIRED'; end if;
end
$guard$;
create role dlkt_et_sealer login password 'fixture-et-sealer-only' noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
set role dlkt_et_owner;
-- Discard earlier synthetic test inputs. Do not copy pending 05A data into a new policy.
truncate dlkt_editorial_transport_lab.grants;
update dlkt_editorial_transport_lab.window_state set utc_day=(clock_timestamp() at time zone 'UTC')::date,
 last_seen=clock_timestamp(),held=false,issued=0,accepted=0 where singleton;
alter table dlkt_editorial_transport_lab.window_state
 add column daily_phase text not null default 'open' check(daily_phase in ('open','sealed-lab','suppressed','expired','held')),
 add column sealed_at timestamptz,
 add column sealed_counts integer[],
 -- Only the disposable test administrator can set this clock. No caller-supplied time.
 add column fixture_clock timestamptz,
 add constraint daily_hold_consistency check(held=(daily_phase='held')),
 add constraint daily_counts_presence check((daily_phase='sealed-lab')=(sealed_counts is not null)),
 add constraint daily_seal_presence check((daily_phase in ('sealed-lab','suppressed'))=(sealed_at is not null)),
 add constraint daily_counts_shape check(sealed_counts is null or
  (array_ndims(sealed_counts)=1 and array_lower(sealed_counts,1)=1 and cardinality(sealed_counts)=5 and
   sealed_counts[1] between 100 and 64000 and sealed_counts[2] between 100 and 64000 and
   sealed_counts[3] between 100 and 64000 and sealed_counts[4] between 100 and 64000 and
   sealed_counts[5] between 100 and 64000 and
   sealed_counts[1]+sealed_counts[2]+sealed_counts[3]+sealed_counts[4]+sealed_counts[5]<=64000)),
 add constraint daily_seal_window check(sealed_at is null or
  (sealed_at>=((utc_day+1)::timestamp at time zone 'UTC')+interval '15 minutes' and
   sealed_at<((utc_day+1)::timestamp at time zone 'UTC')+interval '20 minutes'));
alter table dlkt_editorial_transport_lab.grants drop constraint grant_counts_valid,
 add constraint grant_counts_valid check(counts is null or
  (state in ('active','expired') and dlkt_editorial_transport_lab.valid_counts(counts)));

-- Shared transaction lock. Expiry closes authorization but no longer erases
-- the reversible synthetic contribution. Absolute discard deadline is separate.
create or replace function dlkt_editorial_transport_lab.advance() returns timestamptz
language plpgsql security definer set search_path = pg_catalog as $fn$
declare
 v_window dlkt_editorial_transport_lab.window_state%rowtype;
 v_now timestamptz;
 v_end timestamptz;
begin
 select * into strict v_window from dlkt_editorial_transport_lab.window_state where singleton for update;
 if v_window.held then return null; end if;
 v_now:=coalesce(v_window.fixture_clock,clock_timestamp());
 v_end:=((v_window.utc_day+1)::timestamp at time zone 'UTC');
 if v_now<v_window.last_seen or v_now<((v_window.utc_day)::timestamp at time zone 'UTC') then
  delete from dlkt_editorial_transport_lab.grants;
  update dlkt_editorial_transport_lab.window_state set held=true,daily_phase='held',
   sealed_at=null,sealed_counts=null,issued=0,accepted=0 where singleton;
  return null;
 end if;
 update dlkt_editorial_transport_lab.window_state set last_seen=v_now where singleton;
 if (v_window.daily_phase='open' and v_now>=v_end+interval '20 minutes')
  or (v_window.daily_phase in ('sealed-lab','suppressed') and v_now>=v_end+interval '24 hours') then
  delete from dlkt_editorial_transport_lab.grants;
  update dlkt_editorial_transport_lab.window_state set daily_phase='expired',
   sealed_at=null,sealed_counts=null,issued=0,accepted=0 where singleton;
 elsif v_window.daily_phase='open' then
  update dlkt_editorial_transport_lab.grants set state='expired'
   where state='active' and expires_at<=v_now;
 end if;
 return v_now;
end
$fn$;

-- Same lock as seal. Even an expired grant may withdraw its retained vector.
-- Once the window closes, a generic response reveals no digest membership.
create or replace function dlkt_editorial_transport_lab.withdraw(p_digest text) returns text
language plpgsql security definer set search_path = pg_catalog as $fn$
declare
 v_phase text;
 v_state text;
begin
 if p_digest is null or length(p_digest)<>64 or p_digest !~ '^[0-9a-f]{64}$' then return 'unknown-grant'; end if;
 perform dlkt_editorial_transport_lab.advance();
 select daily_phase into strict v_phase from dlkt_editorial_transport_lab.window_state where singleton;
 if v_phase<>'open' then return 'window-closed'; end if;
 select state into v_state from dlkt_editorial_transport_lab.grants where grant_digest=p_digest;
 if not found then return 'unknown-grant'; end if;
 if v_state in ('active','expired') then
  update dlkt_editorial_transport_lab.grants set state='revoked',counts=null where grant_digest=p_digest;
 end if;
 return 'withdrawn';
end
$fn$;

-- One release per fixed day; no partial query, recalculation, segmentation,
-- per-cell suppression, or disclosure of contributor/grant counts.
create function dlkt_editorial_transport_lab.seal_daily() returns text
language plpgsql security definer set search_path = pg_catalog as $fn$
declare
 v_now timestamptz;
 v_window dlkt_editorial_transport_lab.window_state%rowtype;
 v_end timestamptz;
 v_start timestamptz;
 v_support integer;
 v_sum bigint;
 v_max integer;
 v_counts integer[]:=array[]::integer[];
 v_status text:='sealed-lab';
begin
 v_now:=dlkt_editorial_transport_lab.advance();
 if v_now is null then return 'held'; end if;
 select * into strict v_window from dlkt_editorial_transport_lab.window_state where singleton;
 if v_window.daily_phase<>'open' then return v_window.daily_phase; end if;
 v_start:=(v_window.utc_day::timestamp at time zone 'UTC');
 v_end:=((v_window.utc_day+1)::timestamp at time zone 'UTC');
 if v_now<v_end+interval '15 minutes' then return 'not-eligible'; end if;
 -- advance has already enforced the hard discard deadline.
 if (select count(*) from dlkt_editorial_transport_lab.grants)<>v_window.issued
  or (select count(*) from dlkt_editorial_transport_lab.grants where counts is not null)>v_window.accepted
  or exists(select 1 from dlkt_editorial_transport_lab.grants
   where state not in ('expired','revoked') or issued_at<v_start or issued_at>=v_end or expires_at>v_end) then
  delete from dlkt_editorial_transport_lab.grants;
  update dlkt_editorial_transport_lab.window_state set held=true,daily_phase='held',
   sealed_counts=null,sealed_at=null,issued=0,accepted=0 where singleton;
  return 'held';
 end if;
 for i in 1..5 loop
  select count(*) filter(where counts[i]>0)::integer,coalesce(sum(counts[i]),0),coalesce(max(counts[i]),0)
   into v_support,v_sum,v_max from dlkt_editorial_transport_lab.grants where state='expired' and counts is not null;
  -- Synthetic policy heuristics only: grants are NOT unique people or devices.
  if v_support<20 or v_sum<100 or v_max::bigint*10>v_sum then v_status:='suppressed'; end if;
  v_counts:=array_append(v_counts,v_sum::integer);
 end loop;
 -- Erase all linked vectors AND digest tombstones atomically with the release.
 -- No revision, rollover or recovery of an individual contribution after seal.
 delete from dlkt_editorial_transport_lab.grants;
 update dlkt_editorial_transport_lab.window_state set daily_phase=v_status,sealed_at=v_now,
  sealed_counts=case when v_status='sealed-lab' then v_counts else null end,issued=0,accepted=0 where singleton;
 return v_status;
end
$fn$;

create function dlkt_editorial_transport_lab.read_daily() returns jsonb
language plpgsql security definer set search_path = pg_catalog as $fn$
declare
 v_window dlkt_editorial_transport_lab.window_state%rowtype;
 v_rows jsonb:='[]'::jsonb;
begin
 perform dlkt_editorial_transport_lab.advance();
 select * into strict v_window from dlkt_editorial_transport_lab.window_state where singleton;
 if v_window.daily_phase='sealed-lab' then
  select jsonb_agg(jsonb_build_object('category',category,'qualifiedImpressions',v_window.sealed_counts[ordinal]) order by ordinal)
   into v_rows
   from unnest(array['05000000','06000000','13000000','15000000','17000000']) with ordinality as item(category,ordinal);
 end if;
 return jsonb_build_object('version','dlkt-editorial-daily-lab-1','scope','public-home-global-news-opt-in-lab',
  'taxonomyVersion','iptc-media-topics-top-level-2026-10-16-dlkt-6','day',v_window.utc_day,
  'status',case when v_window.daily_phase='open' then 'pending' else v_window.daily_phase end,
  'coverage','observed-documents-only','rows',v_rows,
  'sealedAt',case when v_window.sealed_at is null then null else
   to_char(v_window.sealed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
  'productionActivationAllowed',false,'automationAllowed',false);
end
$fn$;
-- Disable the earlier diagnostic observer. No role sees mutable pending sums
-- in this variant; only the sealer can initiate a terminal release.
revoke execute on function dlkt_editorial_transport_lab.inspect() from dlkt_et_observer;
revoke all on function dlkt_editorial_transport_lab.seal_daily() from public;
revoke all on function dlkt_editorial_transport_lab.read_daily() from public;
grant usage on schema dlkt_editorial_transport_lab to dlkt_et_sealer;
grant execute on function dlkt_editorial_transport_lab.seal_daily() to dlkt_et_sealer;
grant execute on function dlkt_editorial_transport_lab.read_daily() to dlkt_et_observer;
reset role;
commit;
