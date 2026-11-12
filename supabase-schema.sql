-- ============================================================================
-- ESQUEMA SEGURO CON ROLES Y CONTRASEÑAS CIFRADAS (CUENTA CONJUNTA)
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists public.couple_state (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.app_users (
  username text primary key,
  password_hash text not null,
  role text not null check (role in ('user1', 'user2', 'admin')),
  updated_at timestamptz not null default now()
);

alter table public.couple_state enable row level security;
alter table public.app_users enable row level security;

revoke all on table public.app_users from anon, authenticated;
revoke all on table public.couple_state from anon, authenticated;
