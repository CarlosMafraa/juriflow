-- =============================================================================
-- 0010 — process_responsible_history (ledger imutável de períodos de responsável)
-- =============================================================================

create table public.process_responsible_history (
  id             uuid primary key default gen_random_uuid(),
  space_id       uuid not null references public.spaces (id) on delete cascade,
  process_id     uuid not null references public.processes (id) on delete cascade,
  responsible_id uuid not null references public.profiles (id) on delete restrict,
  assigned_by    uuid references public.profiles (id) on delete set null,
  reason         public.responsibility_reason not null,
  started_at     timestamptz not null default now(),
  ended_at       timestamptz,
  created_at     timestamptz not null default now(),
  constraint prh_period_order_chk check (ended_at is null or ended_at >= started_at)
);

comment on table public.process_responsible_history is
  'Períodos de responsabilidade. responsible_id = responsável naquele período; assigned_by = quem atribuiu (só histórico). Ledger: sem update/delete além de fechar ended_at.';

create unique index prh_one_open_period_uq
  on public.process_responsible_history (process_id) where ended_at is null;
create index prh_process_started_idx
  on public.process_responsible_history (process_id, started_at desc);
create index prh_responsible_started_idx
  on public.process_responsible_history (responsible_id, started_at desc);
create index prh_space_idx on public.process_responsible_history (space_id);

-- space_id é derivado do processo.
create or replace function app.prh_set_space()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select space_id into new.space_id from public.processes where id = new.process_id;
  if new.space_id is null then
    raise exception 'Processo % inexistente para o histórico de responsabilidade.', new.process_id
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

create trigger prh_set_space
  before insert on public.process_responsible_history
  for each row execute function app.prh_set_space();

-- Ledger: só é permitido fechar um período aberto. Nada mais muda; nunca apaga.
create or replace function app.prh_block_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'process_responsible_history é imutável (DELETE não permitido).'
      using errcode = 'restrict_violation';
  end if;

  -- UPDATE: só a transição "abrir -> fechar" (definir ended_at) é aceita.
  if old.ended_at is not null then
    raise exception 'Período já encerrado; process_responsible_history é imutável.'
      using errcode = 'restrict_violation';
  end if;
  if new.id is distinct from old.id
     or new.space_id is distinct from old.space_id
     or new.process_id is distinct from old.process_id
     or new.responsible_id is distinct from old.responsible_id
     or new.assigned_by is distinct from old.assigned_by
     or new.reason is distinct from old.reason
     or new.started_at is distinct from old.started_at
     or new.created_at is distinct from old.created_at then
    raise exception 'Só é permitido definir ended_at em process_responsible_history.'
      using errcode = 'restrict_violation';
  end if;
  if new.ended_at is null then
    raise exception 'ended_at deve ser definido ao fechar o período.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger prh_no_delete
  before delete on public.process_responsible_history
  for each row execute function app.prh_block_mutation();
create trigger prh_guard_update
  before update on public.process_responsible_history
  for each row execute function app.prh_block_mutation();

-- ---------------------------------------------------------------------------
-- RLS: leitura só ADMIN do espaço. Escrita apenas via funções SECURITY DEFINER.
-- ---------------------------------------------------------------------------
alter table public.process_responsible_history enable row level security;
alter table public.process_responsible_history force row level security;

create policy prh_select
  on public.process_responsible_history for select
  to authenticated
  using (app.is_space_admin(space_id));

grant select on public.process_responsible_history to authenticated;
revoke insert, update, delete on public.process_responsible_history from authenticated, anon;
