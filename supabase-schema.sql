-- ============================================================================
-- ESQUEMA PARA SUPABASE · CUENTA CONJUNTA
-- Copia y pega estas líneas en el "SQL Editor" de Supabase y pulsa "Run"
-- ============================================================================

create table if not exists public.couple_state (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Dar permisos a la API de Supabase (necesario si "Automatically expose new tables" estaba desmarcado)
grant usage on schema public to anon, authenticated;
grant all on table public.couple_state to anon, authenticated;

-- Activar seguridad y permitir lectura/escritura a la app
alter table public.couple_state enable row level security;

drop policy if exists "Acceso completo pareja" on public.couple_state;
create policy "Acceso completo pareja"
  on public.couple_state
  for all
  to anon, authenticated
  using (true)
  with check (true);
