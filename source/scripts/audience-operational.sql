-- Staged operational add-on. Apply only in the approved isolated analytics project.
begin;
create table dlkt_audience.maintenance (
 singleton boolean primary key default true check(singleton),
 last_success_at timestamptz not null
);
create table dlkt_audience.usage_windows (
 action text not null check(action in ('enable','event')),
 period text not null check(period in ('minute','day')),
 bucket timestamptz not null,
 used integer not null check(used>0),
 primary key(action,period,bucket)
);
alter table dlkt_audience.maintenance enable row level security;
alter table dlkt_audience.usage_windows enable row level security;
revoke all on dlkt_audience.maintenance,dlkt_audience.usage_windows from public,anon,authenticated;
grant select,insert,update,delete on dlkt_audience.maintenance,dlkt_audience.usage_windows to service_role;
create function dlkt_audience.operational_ready()
returns boolean language sql stable security invoker set search_path=pg_catalog,dlkt_audience as $$
 select exists(select 1 from dlkt_audience.maintenance where singleton and last_success_at between statement_timestamp()-interval '2 hours' and statement_timestamp());
$$;
-- Conservative shared pilot ceilings. No IP, account or browser identifier enters this limiter.
-- These bound admitted requests, not provider charges. Edge protection remains mandatory.
create function dlkt_audience.admit_request(p_action text)
returns boolean language plpgsql volatile security invoker set search_path=pg_catalog,dlkt_audience as $$
declare
 t timestamptz;
 minute_cap integer;
 day_cap integer;
begin
 if p_action not in ('enable','event') or p_action is null then return false;end if;
 if not dlkt_audience.operational_ready() then return false;end if;
 minute_cap:=case when p_action='enable' then 60 else 1000 end;
 day_cap:=case when p_action='enable' then 3000 else 50000 end;
 perform pg_advisory_xact_lock(hashtextextended('dlkt-audience-budget:'||p_action,0));
 t:=clock_timestamp();
 insert into dlkt_audience.usage_windows as w(action,period,bucket,used)
 values(p_action,'minute',date_trunc('minute',t),1)
 on conflict(action,period,bucket) do update set used=w.used+1 where w.used<minute_cap;
 if not found then return false;end if;
 insert into dlkt_audience.usage_windows as w(action,period,bucket,used)
 values(p_action,'day',date_trunc('day',t,'UTC'),1)
 on conflict(action,period,bucket) do update set used=w.used+1 where w.used<day_cap;
 return found;
end;
$$;
create function dlkt_audience.run_maintenance()
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog,dlkt_audience as $$
declare
 result jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('dlkt-audience-maintenance',0));
 result:=dlkt_audience.purge_expired();
 delete from dlkt_audience.usage_windows where bucket<statement_timestamp()-interval '2 days';
 insert into dlkt_audience.maintenance(singleton,last_success_at) values(true,clock_timestamp())
 on conflict(singleton) do update set last_success_at=excluded.last_success_at;
 return result;
end;
$$;
revoke all on function dlkt_audience.operational_ready(),dlkt_audience.admit_request(text),dlkt_audience.run_maintenance() from public,anon,authenticated;
grant execute on function dlkt_audience.operational_ready(),dlkt_audience.admit_request(text),dlkt_audience.run_maintenance() to service_role;
commit;
