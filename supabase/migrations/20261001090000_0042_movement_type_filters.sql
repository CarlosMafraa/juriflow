-- =============================================================================
-- 0042 — Filtro de notificação por TIPO de movimentação.
--
-- Regras do produto (docs/REGRAS-DE-NEGOCIO.md, N4–N6):
--   - Cada escritório tem uma lista geral de tipos de movimentação, cada um
--     com dois toggles: avisar responsáveis / avisar clientes. É o padrão.
--   - Cada processo pode personalizar os toggles; o que ele não personalizou
--     segue o padrão do escritório. Quem personaliza: ADMIN ou responsável
--     do processo (mesma regra da configuração por processo, 0023).
--   - O tipo é o título da movimentação na fonte, normalizado sem nome de
--     parte ("DECORRIDO PRAZO DE FULANO" → "DECORRIDO PRAZO"), para a lista
--     não guardar dado pessoal e um toggle valer para todas as partes.
--   - Tipo novo que a coleta encontrar entra na lista com os dois toggles
--     ligados (nada deixa de ser avisado sem alguém escolher).
-- =============================================================================

alter table public.process_movements add column movement_type text;
comment on column public.process_movements.movement_type is
  'Tipo normalizado da movimentação (título sem nome de parte). Base do filtro de notificação.';

-- ---------------------------------------------------------------------------
-- 1. Lista geral do escritório (padrão)
-- ---------------------------------------------------------------------------
create table public.space_movement_types (
  space_id            uuid not null references public.spaces (id) on delete cascade,
  name                text not null,
  notify_responsible  boolean not null default true,
  notify_client       boolean not null default true,
  updated_by          uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz,
  primary key (space_id, name),
  constraint space_movement_types_name_not_blank_chk check (length(btrim(name)) > 0)
);

comment on table public.space_movement_types is
  'Tipos de movimentação do escritório com o padrão de aviso (responsáveis/clientes).';

create trigger space_movement_types_set_updated_at
  before update on public.space_movement_types
  for each row execute function app.set_updated_at();

alter table public.space_movement_types enable row level security;
alter table public.space_movement_types force row level security;

create policy space_movement_types_select
  on public.space_movement_types for select
  to authenticated
  using (app.is_active_member(space_id));

-- Só os toggles mudam pelo app; a lista cresce pela coleta (service_role).
create policy space_movement_types_update
  on public.space_movement_types for update
  to authenticated
  using (app.is_space_admin(space_id))
  with check (app.is_space_admin(space_id));

grant select on public.space_movement_types to authenticated;
grant update (notify_responsible, notify_client, updated_by) on public.space_movement_types to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Personalização por processo
-- ---------------------------------------------------------------------------
create table public.process_movement_type_prefs (
  process_id          uuid not null references public.processes (id) on delete cascade,
  space_id            uuid not null,
  name                text not null,
  notify_responsible  boolean not null,
  notify_client       boolean not null,
  updated_by          uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz,
  primary key (process_id, name),
  foreign key (space_id, name)
    references public.space_movement_types (space_id, name) on delete cascade
);

comment on table public.process_movement_type_prefs is
  'Toggles por tipo que o processo personalizou; tipo sem linha aqui segue o padrão do escritório.';

create trigger process_movement_type_prefs_set_updated_at
  before update on public.process_movement_type_prefs
  for each row execute function app.set_updated_at();

-- O space_id vem do processo (não confia no cliente).
create or replace function app.process_movement_type_prefs_fill_space()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select p.space_id into new.space_id from public.processes p where p.id = new.process_id;
  if new.space_id is null then
    raise exception 'Processo não encontrado.' using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

create trigger process_movement_type_prefs_fill_space
  before insert or update on public.process_movement_type_prefs
  for each row execute function app.process_movement_type_prefs_fill_space();

alter table public.process_movement_type_prefs enable row level security;
alter table public.process_movement_type_prefs force row level security;

create policy process_movement_type_prefs_select
  on public.process_movement_type_prefs for select
  to authenticated
  using (app.can_read_process(process_id));

create policy process_movement_type_prefs_insert
  on public.process_movement_type_prefs for insert
  to authenticated
  with check (app.can_edit_process(process_id));

create policy process_movement_type_prefs_update
  on public.process_movement_type_prefs for update
  to authenticated
  using (app.can_edit_process(process_id))
  with check (app.can_edit_process(process_id));

create policy process_movement_type_prefs_delete
  on public.process_movement_type_prefs for delete
  to authenticated
  using (app.can_edit_process(process_id));

grant select, insert, update, delete on public.process_movement_type_prefs to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Auditoria (quem mudou o que o escritório/processo recebe)
-- ---------------------------------------------------------------------------
create or replace function app.audit_space_movement_types()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  d record;
begin
  -- Tipos novos entram pela coleta (sistema); só a mudança de toggle é ação de gente.
  if tg_op <> 'UPDATE' then
    return null;
  end if;
  select * into d from app.audit_diff(to_jsonb(old), to_jsonb(new));
  perform app.write_audit_log('notification_config.movement_type.update', new.space_id,
    'space_movement_type', new.name, 'success', app._audit_actor(), d.before, d.after, null);
  return null;
end;
$$;

create trigger zz_audit_space_movement_types
  after update on public.space_movement_types
  for each row execute function app.audit_space_movement_types();

create or replace function app.audit_process_movement_type_prefs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  d record;
  r public.process_movement_type_prefs%rowtype;
begin
  r := coalesce(new, old);
  if tg_op = 'INSERT' then
    perform app.write_audit_log('notification_config.process_movement_type.set', r.space_id,
      'process', r.process_id::text, 'success', app._audit_actor(), null,
      jsonb_build_object('tipo', r.name, 'responsaveis', r.notify_responsible, 'clientes', r.notify_client), null);
  elsif tg_op = 'DELETE' then
    perform app.write_audit_log('notification_config.process_movement_type.reset', r.space_id,
      'process', r.process_id::text, 'success', app._audit_actor(),
      jsonb_build_object('tipo', r.name, 'responsaveis', r.notify_responsible, 'clientes', r.notify_client), null, null);
  else
    select * into d from app.audit_diff(to_jsonb(old), to_jsonb(new));
    perform app.write_audit_log('notification_config.process_movement_type.set', r.space_id,
      'process', r.process_id::text, 'success', app._audit_actor(),
      d.before || jsonb_build_object('tipo', r.name), d.after || jsonb_build_object('tipo', r.name), null);
  end if;
  return null;
end;
$$;

create trigger zz_audit_process_movement_type_prefs
  after insert or update or delete on public.process_movement_type_prefs
  for each row execute function app.audit_process_movement_type_prefs();

-- ---------------------------------------------------------------------------
-- 4. Lista inicial (tipos da consulta pública do TJAM) em todo escritório
-- ---------------------------------------------------------------------------
create or replace function app.seed_space_movement_types(p_space_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.space_movement_types (space_id, name)
  select p_space_id, t.name
  from unnest(array[
    'ALVARÁ ENVIADO',
    'CONCLUSOS PARA DECISÃO - ANÁLISE DE ALVARÁ',
    'CONCLUSOS PARA DECISÃO - DECISÃO INICIAL',
    'CONCLUSOS PARA DECISÃO - DECISÃO SANEADORA',
    'CONCLUSOS PARA SENTENÇA',
    'DECISÃO INTERLOCUTÓRIA',
    'DECORRIDO PRAZO',
    'DISPONIBILIZAÇÃO NO DIÁRIO DA JUSTIÇA ELETRÔNICO',
    'DISTRIBUÍDO POR SORTEIO',
    'EXPEDIÇÃO DE CITAÇÃO',
    'EXPEDIÇÃO DE INTIMAÇÃO',
    'JULGADA PROCEDENTE A AÇÃO',
    'JUNTADA DE ANÁLISE DE DECURSO DE PRAZO',
    'JUNTADA DE INFORMAÇÃO',
    'JUNTADA DE PETIÇÃO DE CONTESTAÇÃO',
    'JUNTADA DE PETIÇÃO DE EMENDA À PETIÇÃO INICIAL',
    'JUNTADA DE PETIÇÃO DE IMPUGNAÇÃO À CONTESTAÇÃO',
    'JUNTADA DE PETIÇÃO DE INICIAL',
    'JUNTADA DE PETIÇÃO DE MANIFESTAÇÃO DA PARTE',
    'JUNTADA DE PETIÇÃO DE MANIFESTAÇÃO DO AUTOR',
    'JUNTADA DE PETIÇÃO DE MANIFESTAÇÃO DO RÉU',
    'LEITURA DE CITAÇÃO REALIZADA',
    'PROCESSO ENCAMINHADO',
    'RECEBIDOS OS AUTOS',
    'REDISTRIBUÍDO - PREVENÇÃO DE REPETIÇÃO DESCARTADA',
    'REMETIDOS OS AUTOS PARA DISTRIBUIDOR',
    'RENÚNCIA DE PRAZO'
  ]) as t(name)
  on conflict do nothing;
$$;

revoke all on function app.seed_space_movement_types(uuid) from public, anon, authenticated;

create or replace function app.spaces_seed_movement_types()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.seed_space_movement_types(new.id);
  return null;
end;
$$;

create trigger spaces_seed_movement_types
  after insert on public.spaces
  for each row execute function app.spaces_seed_movement_types();

select app.seed_space_movement_types(s.id) from public.spaces s;
