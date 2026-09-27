-- =============================================================================
-- 0044 — Saúde do worker de coleta (regra P10).
--
-- O worker grava um "batimento" por minuto e o resultado da última consulta
-- ao tribunal. A plataforma (SUPER_ADMIN) vê se ele está no ar — é dado de
-- infraestrutura, sem nada de dentro dos escritórios (sem processo, sem
-- escritório, sem pessoa). O ALERTA quando ele para vem de um monitor externo
-- (Healthchecks.io ou similar) que o worker "pinga": parado, ele não conseguiria
-- avisar ninguém (docs/DEPLOY.md).
-- =============================================================================
create table public.worker_status (
  worker               text primary key,
  started_at           timestamptz not null default now(),
  last_seen_at         timestamptz not null default now(),
  last_source_ok_at    timestamptz,
  last_source_error    text,
  last_source_error_at timestamptz
);

comment on table public.worker_status is
  'Batimento do worker de coleta e resultado da última consulta ao tribunal. Só service_role escreve; a plataforma lê por platform_worker_status().';

alter table public.worker_status enable row level security;
alter table public.worker_status force row level security;
-- Sem policies: ninguém do app lê ou escreve direto (service_role ignora RLS).
revoke all on public.worker_status from anon, authenticated;

create or replace function public.platform_worker_status()
returns table (
  worker               text,
  online               boolean,
  started_at           timestamptz,
  last_seen_at         timestamptz,
  last_source_ok_at    timestamptz,
  last_source_error    text,
  last_source_error_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_super_admin() then
    raise exception 'Apenas a plataforma vê a saúde do worker.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select w.worker,
           w.last_seen_at > now() - interval '3 minutes',
           w.started_at, w.last_seen_at,
           w.last_source_ok_at, w.last_source_error, w.last_source_error_at
    from public.worker_status w
    order by w.worker;
end;
$$;

revoke all on function public.platform_worker_status() from public, anon;
grant execute on function public.platform_worker_status() to authenticated;
