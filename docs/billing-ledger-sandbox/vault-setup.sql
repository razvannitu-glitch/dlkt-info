-- Disposable lab only. Minimal auth.sessions model, not a Supabase replacement.
create table auth.sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  not_after timestamptz
);
alter table auth.sessions enable row level security;
revoke all on auth.sessions from public,anon,authenticated,service_role;
