alter table if exists public.app_users
  add column if not exists email_verified_at timestamptz null;

alter table if exists public.app_users
  add column if not exists disabled_at timestamptz null;

alter table if exists public.app_users
  add column if not exists last_login_at timestamptz null;

create table if not exists public.app_auth_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  token_hash text not null unique,
  type text not null check (type in ('email_verification', 'password_reset')),
  expires_at timestamptz not null,
  used_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists app_auth_tokens_user_id_idx
  on public.app_auth_tokens (user_id);

create index if not exists app_auth_tokens_lookup_idx
  on public.app_auth_tokens (type, token_hash, used_at, expires_at);

create table if not exists public.app_auth_rate_limits (
  key text primary key,
  action text not null,
  count integer not null default 0,
  window_start timestamptz not null default now(),
  blocked_until timestamptz null,
  updated_at timestamptz not null default now()
);

create index if not exists app_auth_rate_limits_action_idx
  on public.app_auth_rate_limits (action);
