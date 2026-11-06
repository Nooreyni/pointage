-- Reproduit le minimum de Supabase pour tester en local (rôles + auth.uid()).
-- NE PAS appliquer sur un vrai projet Supabase.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema extensions;
create table auth.users (id uuid primary key default gen_random_uuid(), email text unique,
                         email_confirmed_at timestamptz, raw_app_meta_data jsonb not null default '{}',
                         created_at timestamptz default now(), last_sign_in_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
                         current_setting('request.jwt.claims', true)::jsonb ->> 'sub'), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
