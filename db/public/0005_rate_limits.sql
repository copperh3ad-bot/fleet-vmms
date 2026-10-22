-- Shared rate limiting for the few open pages (sign-in, odometer link). Idempotent.
-- Fixed windows: one row per key and window, counted with a single atomic upsert, so concurrent requests on any
-- number of servers share one count. Keys are hashes (never an email address or token in clear).
create table if not exists public.rate_limits (
  key    text not null,
  bucket timestamptz not null,
  hits   int not null default 0,
  primary key (key, bucket)
);
alter table public.rate_limits enable row level security;

-- Counts this attempt and says whether it is within the limit. Old windows are cleaned up now and then.
create or replace function public.rate_limit_hit(p_key text, p_limit int, p_window_seconds int) returns boolean
language plpgsql as $$
declare b timestamptz; h int;
begin
  if p_limit < 1 or p_window_seconds < 1 then raise exception 'invalid rate limit'; end if;
  b := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limits as r (key, bucket, hits) values (p_key, b, 1)
  on conflict (key, bucket) do update set hits = r.hits + 1
  returning r.hits into h;
  if random() < 0.01 then delete from public.rate_limits where bucket < now() - interval '1 day'; end if;
  return h <= p_limit;
end $$;

-- Functions in public can be called through Supabase's public API by default. This one must only be called by the
-- server's own connection, otherwise anyone could use up other people's allowance.
revoke all on function public.rate_limit_hit(text, int, int) from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.rate_limit_hit(text, int, int) from %I', r);
    end if;
  end loop;
end $$;
