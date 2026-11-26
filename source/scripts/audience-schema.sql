-- Staged, isolated schema contract. NOT an application migration. Do not apply
-- to production or expose through PostgREST without a reviewed activation plan.
begin;
create schema dlkt_audience;
revoke all on schema dlkt_audience from public, anon, authenticated;
grant usage on schema dlkt_audience to service_role;

create table dlkt_audience.browsers (
 browser_key text primary key check (browser_key ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default statement_timestamp()
);
create table dlkt_audience.sessions (
 id uuid primary key default gen_random_uuid(),
 browser_key text not null references dlkt_audience.browsers(browser_key) on delete cascade,
 started_at timestamptz not null,
 last_seen timestamptz not null check (last_seen>=started_at),
 country text check (country is null or (country ~ '^[A-Z]{2}$' and country not in ('XX','ZZ'))),
 city text check (city is null or (country is not null and length(city) between 1 and 80 and octet_length(city)<=160 and city !~ '[[:cntrl:]]')),
 source text not null check (source in ('direct','search','social','referral','unknown')),
 unique(browser_key,id)
);
create index sessions_browser_last on dlkt_audience.sessions(browser_key,last_seen desc);
create index sessions_last_seen on dlkt_audience.sessions(last_seen);
create index sessions_start on dlkt_audience.sessions(started_at);
create table dlkt_audience.pageviews (
 browser_key text not null,
 event_id uuid not null,
 session_id uuid not null,
 observed_at timestamptz not null,
 primary key(browser_key,event_id),
 foreign key(browser_key,session_id) references dlkt_audience.sessions(browser_key,id) on delete cascade
);
create index pageviews_observed on dlkt_audience.pageviews(observed_at);
create index pageviews_browser_observed on dlkt_audience.pageviews(browser_key,observed_at desc);
create index pageviews_session on dlkt_audience.pageviews(browser_key,session_id);

alter table dlkt_audience.browsers enable row level security;
alter table dlkt_audience.sessions enable row level security;
alter table dlkt_audience.pageviews enable row level security;
revoke all on all tables in schema dlkt_audience from public, anon, authenticated;
grant select,insert,update,delete on all tables in schema dlkt_audience to service_role;

create function dlkt_audience.record_activity(p_browser text,p_kind text,p_event uuid,p_country text,p_city text,p_source text)
returns text language plpgsql security invoker set search_path=pg_catalog,dlkt_audience as $$
declare
 t timestamptz:=statement_timestamp();
 current_session dlkt_audience.sessions%rowtype;
 sid uuid;
begin
 if p_browser is null or p_browser !~ '^[0-9a-f]{64}$'
 or p_kind is null or p_kind not in ('pageview','presence')
 or (p_kind='pageview' and (p_event is null or p_source is null or p_source not in ('direct','search','social','referral','unknown')))
 or (p_kind='presence' and (p_event is not null or p_country is not null or p_city is not null or p_source is not null))
 or (p_country is not null and (p_country !~ '^[A-Z]{2}$' or p_country in ('XX','ZZ')))
 or (p_city is not null and (p_country is null or length(p_city) not between 1 and 80 or octet_length(p_city)>160 or p_city ~ '[[:cntrl:]]'))
 then raise exception 'INVALID_AUDIENCE_EVENT' using errcode='22023';end if;

 -- Presence cannot create a new browser identity. Serialize all writes per digest.
 if p_kind='pageview' then
  insert into dlkt_audience.browsers(browser_key,created_at) values(p_browser,t) on conflict do nothing;
 end if;
 perform 1 from dlkt_audience.browsers where browser_key=p_browser for update;
 if not found then return 'no-session';end if;
 -- Use a fresh server clock after the per-browser lock; never trust client time.
 t:=clock_timestamp();
 if p_kind='pageview' then
  if exists(select 1 from dlkt_audience.pageviews where browser_key=p_browser and event_id=p_event) then return 'duplicate';end if;
  if (select count(*) from (select 1 from dlkt_audience.pageviews where browser_key=p_browser and observed_at>t-interval '60 seconds' limit 30) bounded)>=30 then return 'throttled';end if;
 end if;
 select * into current_session from dlkt_audience.sessions where browser_key=p_browser order by last_seen desc,id limit 1;
 if found and t-current_session.last_seen<interval '30 minutes' then
  sid:=current_session.id;
  if t-current_session.last_seen>=interval '60 seconds' then
   update dlkt_audience.sessions set last_seen=t where id=sid;
  end if;
 elsif p_kind='presence' then
  -- A stale tab must not create sessions without a fresh, intentional reader entry.
  return 'no-session';
 else
  insert into dlkt_audience.sessions(browser_key,started_at,last_seen,country,city,source)
  values(p_browser,t,t,p_country,p_city,p_source) returning id into sid;
 end if;
 if p_kind='pageview' then
  insert into dlkt_audience.pageviews(browser_key,event_id,session_id,observed_at) values(p_browser,p_event,sid,t);
 end if;
 return 'accepted';
end;
$$;

create function dlkt_audience.snapshot(p_hours integer)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,dlkt_audience as $$
declare
 until_at timestamptz:=statement_timestamp();
 since_at timestamptz;
 unit text;
 result jsonb;
begin
 if p_hours is not null and p_hours not in (24,168,720,2160) then raise exception 'INVALID_AUDIENCE_RANGE' using errcode='22023';end if;
 since_at:=until_at-make_interval(hours=>coalesce(p_hours,2160));
 unit:=case when p_hours=24 then 'hour' else 'day' end;
 with relevant as materialized (
  select s.id,s.browser_key,s.started_at,s.last_seen,s.country,s.city,s.source
  from dlkt_audience.sessions s where s.last_seen>=since_at and s.started_at<=until_at
 ), views as materialized (
  select observed_at from dlkt_audience.pageviews where observed_at>=since_at and observed_at<=until_at
 ), repeated as (
  select browser_key from relevant group by browser_key having count(*)>=2
 ), countries as (
  select country,count(distinct browser_key) visitors,count(*) sessions
  from relevant where country is not null group by country
  having count(distinct browser_key)>=3 order by visitors desc,country limit 100
 ), cities as (
  select country,city,count(distinct browser_key) visitors,count(*) sessions
  from relevant where country is not null and city is not null group by country,city
  having count(distinct browser_key)>=3 order by visitors desc,country,city limit 100
 ), sources as (
  select source,count(distinct browser_key) visitors,count(*) sessions
  from relevant group by source order by visitors desc,source
 ), time_counts as (
  select date_trunc(unit,timezone('UTC',observed_at)) bucket,count(*) views,0::bigint sessions from views group by 1
  union all
  select date_trunc(unit,timezone('UTC',started_at)),0::bigint,count(*) from relevant where started_at>=since_at group by 1
 ), buckets as (
  select bucket,sum(views)::bigint pageviews,sum(sessions)::bigint session_starts from time_counts group by bucket order by bucket
 )
 select jsonb_build_object(
  'version','dlkt-audience-1','asOf',until_at,'since',since_at,'bucket',unit,'retentionDays',90,
  'visitors',(select count(distinct browser_key) from relevant),
  'sessionStarts',(select count(*) from relevant where started_at>=since_at),
  'pageviews',(select count(*) from views),
  'repeatBrowsers',(select count(*) from repeated),
  'active5m',(select count(distinct browser_key) from relevant where last_seen>=until_at-interval '5 minutes' and last_seen<=until_at),
  'countries',coalesce((select jsonb_agg(to_jsonb(c) order by c.visitors desc,c.country) from countries c),'[]'::jsonb),
  'cities',coalesce((select jsonb_agg(to_jsonb(c) order by c.visitors desc,c.country,c.city) from cities c),'[]'::jsonb),
  'sources',coalesce((select jsonb_agg(to_jsonb(s) order by s.visitors desc,s.source) from sources s),'[]'::jsonb),
  'series',coalesce((select jsonb_agg(jsonb_build_object('timestamp',to_char(b.bucket,'YYYY-MM-DD"T"HH24:MI:SS"Z"'),'pageviews',b.pageviews,'sessionStarts',b.session_starts) order by b.bucket) from buckets b),'[]'::jsonb)
 ) into result;
 return result;
end;
$$;

create function dlkt_audience.forget_browser(p_browser text)
returns void language sql volatile security invoker set search_path=pg_catalog,dlkt_audience as $$
 delete from dlkt_audience.browsers where browser_key=p_browser and p_browser ~ '^[0-9a-f]{64}$';
$$;

-- Schedule and verify this job BEFORE enabling collection. No automatic job is installed here.
create function dlkt_audience.purge_expired()
returns jsonb language plpgsql security invoker set search_path=pg_catalog,dlkt_audience as $$
declare
 cutoff timestamptz:=statement_timestamp()-interval '90 days';
 views_deleted bigint;
 sessions_deleted bigint;
 browsers_deleted bigint;
begin
 delete from dlkt_audience.pageviews where observed_at<cutoff;
 get diagnostics views_deleted=row_count;
 delete from dlkt_audience.sessions where last_seen<cutoff;
 get diagnostics sessions_deleted=row_count;
 delete from dlkt_audience.browsers b where b.created_at<cutoff and not exists(select 1 from dlkt_audience.sessions s where s.browser_key=b.browser_key);
 get diagnostics browsers_deleted=row_count;
 return jsonb_build_object('pageviews',views_deleted,'sessions',sessions_deleted,'browsers',browsers_deleted);
end;
$$;
revoke all on all functions in schema dlkt_audience from public,anon,authenticated;
grant execute on function dlkt_audience.record_activity(text,text,uuid,text,text,text),dlkt_audience.snapshot(integer),dlkt_audience.forget_browser(text),dlkt_audience.purge_expired() to service_role;
commit;
