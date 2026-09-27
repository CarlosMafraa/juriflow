-- =============================================================================
-- 0048 — Segunda rodada da validação com o cliente.
--
-- 1. LGPD: o cliente não informa mais CPF/CNPJ. A coluna sai e os valores
--    gravados são apagados junto (minimização de dados).
--
-- 2. Movimentações manuais (PR9). Processo sem sincronização automática é
--    "manual": ADMIN ou responsável cadastram as movimentações; ADMIN ou quem
--    cadastrou o processo corrigem/excluem. Tudo auditado. O processo mostra
--    UMA fonte só (nunca as duas misturadas, então nunca há repetição):
--      - sincronização ligada  → só as do tribunal;
--      - sincronização desligada → só as manuais. As do tribunal SOMEM
--        (garantido pela RLS) — senão bastaria ligar, copiar o histórico e
--        desligar para burlar o limite do plano.
--
-- 3. Anti-rodízio (P11). Desligar a sincronização (ou arquivar/encerrar/
--    excluir o processo sincronizado) segura a vaga do plano por 30 dias.
--
-- 4. 1ª sincronização de processo que já tinha movimentações manuais não
--    avisa o histórico do tribunal (N13): o cliente já foi informado à mão.
--    `sync_baseline_pending` diz ao worker para só registrar essa leva.
--
-- 5. Aniversário (N14): data de nascimento opcional também na equipe;
--    templates de aniversário por público (equipe / clientes), escolhidos
--    pelo ADMIN na configuração do escritório; registro do que foi enviado.
--
-- 6. A auditoria de movimentação coletada deixa de guardar o TEXTO: o ADMIN
--    lê a auditoria, e ela não pode virar um atalho para o histórico do
--    tribunal de processo sem sincronização.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Sem CPF/CNPJ
-- ---------------------------------------------------------------------------
drop trigger if exists clients_normalize_document on public.clients;
drop function if exists app.clients_normalize_document();
drop index if exists public.clients_document_uniq;
alter table public.clients drop column document;

create or replace function public.soft_delete_client(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space      uuid;
  v_created_by uuid;
  v_deleted    timestamptz;
begin
  select space_id, created_by, deleted_at
    into v_space, v_created_by, v_deleted
    from public.clients
    where id = p_client_id
    for update;

  if v_space is null or v_deleted is not null then
    raise exception 'Cliente não encontrado.' using errcode = 'no_data_found';
  end if;
  if not (app.is_space_admin(v_space) or v_created_by = (select auth.uid())) then
    raise exception 'Sem permissão para excluir este cliente.'
      using errcode = 'insufficient_privilege';
  end if;

  set local app.skip_row_audit = 'on';

  update public.clients
    set deleted_at = now(),
        name = 'Cliente removido',
        email = null,
        phone = null,
        birth_date = null,
        notification_opt_in = false,
        opt_in_at = null
    where id = p_client_id;

  perform app.write_audit_log(
    'client.soft_delete', v_space, 'client', p_client_id::text, 'success', 'user',
    jsonb_build_object('anonymized', true), null, null
  );

  perform set_config('app.skip_row_audit', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Movimentações manuais
-- ---------------------------------------------------------------------------
alter table public.process_movements
  add column created_by uuid references public.profiles (id) on delete set null,
  add column updated_at timestamptz,
  add column deleted_at timestamptz;

comment on column public.process_movements.source_kind is
  'Origem: fonte de coleta (ex.: projudi_tjam) ou ''manual'' (cadastrada no app).';

/** Sincronização valendo agora: define qual fonte de movimentações o processo mostra. */
create or replace function app.process_sync_active(p_process uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.processes
     where id = p_process and tracking_enabled and status = 'active' and deleted_at is null
  );
$$;

drop policy process_movements_select on public.process_movements;
create policy process_movements_select
  on public.process_movements for select
  to authenticated
  using (
    app.can_read_process(process_id)
    and deleted_at is null
    and (source_kind = 'manual') is distinct from app.process_sync_active(process_id)
  );

/** ADMIN ou quem cadastrou o processo: quem corrige/exclui movimentação manual. */
create or replace function app.can_manage_manual_movement(p_process uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.processes p
     where p.id = p_process
       and (app.is_space_admin(p.space_id) or p.created_by = (select auth.uid()))
  );
$$;

create or replace function app.manual_movement_occurred_at(p_day date)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  -- Meio-dia em Manaus: a data aparece igual em qualquer fuso usado nas telas/mensagens.
  select (p_day + time '12:00') at time zone 'America/Manaus';
$$;

create or replace function app.manual_movement_description(p_title text, p_detail text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when nullif(btrim(p_detail), '') is null then btrim(p_title)
    else btrim(p_title) || E'\n' || btrim(p_detail)
  end;
$$;

create or replace function app.check_manual_movement_input(p_day date, p_title text)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_day is null then
    raise exception 'Informe a data da movimentação.' using errcode = 'check_violation';
  end if;
  if p_day > (now() at time zone 'America/Manaus')::date then
    raise exception 'A data da movimentação não pode ser no futuro.' using errcode = 'check_violation';
  end if;
  if nullif(btrim(p_title), '') is null then
    raise exception 'Informe o que aconteceu (título da movimentação).' using errcode = 'check_violation';
  end if;
end;
$$;

create or replace function public.create_manual_movement(
  p_process_id uuid,
  p_occurred_on date,
  p_title text,
  p_detail text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proc public.processes;
  v_id   uuid;
begin
  select * into v_proc from public.processes where id = p_process_id for update;
  if v_proc.id is null or v_proc.deleted_at is not null then
    raise exception 'Processo não encontrado.' using errcode = 'no_data_found';
  end if;
  if not app.can_edit_process(p_process_id) then
    raise exception 'Só o ADMIN ou um responsável pelo processo cadastra movimentações.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_proc.status <> 'active' then
    raise exception 'Só processos ativos recebem movimentações.' using errcode = 'check_violation';
  end if;
  if v_proc.tracking_enabled then
    raise exception 'Com a sincronização automática ligada, as movimentações vêm do tribunal.'
      using errcode = 'check_violation';
  end if;
  perform app.check_manual_movement_input(p_occurred_on, p_title);

  insert into public.process_movements (
    space_id, process_id, source_kind, description, occurred_at, content_hash, created_by
  ) values (
    v_proc.space_id, p_process_id, 'manual',
    app.manual_movement_description(p_title, p_detail),
    app.manual_movement_occurred_at(p_occurred_on),
    'manual:' || gen_random_uuid()::text,
    (select auth.uid())
  )
  returning id into v_id;

  perform app.write_audit_log(
    'process.movement.manual.create', v_proc.space_id, 'process_movement', v_id::text,
    'success', 'user', null,
    jsonb_build_object('occurred_on', p_occurred_on, 'title', btrim(p_title), 'detail', p_detail),
    jsonb_build_object('process_id', p_process_id)
  );
  -- Avisa (N10/N11): sai em segundos pela fila, ou fica pendente sem WhatsApp.
  perform app.enqueue_notification_catchup(array[p_process_id]);
  return v_id;
end;
$$;

create or replace function app.lock_manual_movement(p_movement_id uuid)
returns public.process_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mov public.process_movements;
begin
  select * into v_mov from public.process_movements
   where id = p_movement_id and source_kind = 'manual' and deleted_at is null
   for update;
  if v_mov.id is null then
    raise exception 'Movimentação não encontrada.' using errcode = 'no_data_found';
  end if;
  if not app.can_manage_manual_movement(v_mov.process_id) then
    raise exception 'Só o ADMIN ou quem cadastrou o processo altera movimentações.'
      using errcode = 'insufficient_privilege';
  end if;
  if app.process_sync_active(v_mov.process_id) then
    raise exception 'Com a sincronização automática ligada, as movimentações manuais ficam guardadas.'
      using errcode = 'check_violation';
  end if;
  return v_mov;
end;
$$;

create or replace function public.update_manual_movement(
  p_movement_id uuid,
  p_occurred_on date,
  p_title text,
  p_detail text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mov public.process_movements;
begin
  v_mov := app.lock_manual_movement(p_movement_id);
  perform app.check_manual_movement_input(p_occurred_on, p_title);

  update public.process_movements
     set description = app.manual_movement_description(p_title, p_detail),
         occurred_at = app.manual_movement_occurred_at(p_occurred_on),
         updated_at = now()
   where id = p_movement_id;

  perform app.write_audit_log(
    'process.movement.manual.update', v_mov.space_id, 'process_movement', p_movement_id::text,
    'success', 'user',
    jsonb_build_object('occurred_at', v_mov.occurred_at, 'description', v_mov.description),
    jsonb_build_object('occurred_on', p_occurred_on, 'title', btrim(p_title), 'detail', p_detail),
    jsonb_build_object('process_id', v_mov.process_id)
  );
end;
$$;

create or replace function public.delete_manual_movement(p_movement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mov public.process_movements;
begin
  v_mov := app.lock_manual_movement(p_movement_id);

  update public.process_movements
     set deleted_at = now(), updated_at = now()
   where id = p_movement_id;

  perform app.write_audit_log(
    'process.movement.manual.delete', v_mov.space_id, 'process_movement', p_movement_id::text,
    'success', 'user',
    jsonb_build_object('occurred_at', v_mov.occurred_at, 'description', v_mov.description),
    null,
    jsonb_build_object('process_id', v_mov.process_id)
  );
end;
$$;

revoke execute on function public.create_manual_movement(uuid, date, text, text) from public;
revoke execute on function public.update_manual_movement(uuid, date, text, text) from public;
revoke execute on function public.delete_manual_movement(uuid) from public;
grant execute on function public.create_manual_movement(uuid, date, text, text) to authenticated;
grant execute on function public.update_manual_movement(uuid, date, text, text) to authenticated;
grant execute on function public.delete_manual_movement(uuid) to authenticated;

-- Fila de avisos pendentes (0046): processo manual também avisa, então vale
-- para todo processo ativo — o worker decide qual fonte está valendo.
create or replace function app.enqueue_notification_catchup(p_process_ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notification_catchup_requests (process_id, space_id, requested_at)
  select p.id, p.space_id, now()
    from public.processes p
   where p.id = any (p_process_ids)
     and p.deleted_at is null
     and p.status = 'active'
  on conflict (process_id) do update set requested_at = excluded.requested_at;
$$;

-- ---------------------------------------------------------------------------
-- 6. Auditoria da coleta: só metadados (a manual já é auditada pela RPC).
-- ---------------------------------------------------------------------------
create or replace function app.audit_process_movements()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source_kind = 'manual' then return null; end if;
  perform app.write_audit_log('process.movement.collected', new.space_id, 'process_movement',
    new.id::text, 'success', app._audit_actor(), null,
    jsonb_build_object('occurred_at', new.occurred_at, 'source_kind', new.source_kind),
    jsonb_build_object('process_id', new.process_id, 'source_kind', new.source_kind));
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3/4. Vaga presa por 30 dias + 1ª sincronização sem histórico
-- ---------------------------------------------------------------------------
alter table public.processes
  add column tracking_released_at timestamptz,
  add column sync_baseline_pending boolean not null default false;

comment on column public.processes.tracking_released_at is
  'Quando o processo deixou de ocupar vaga de sincronização (desligou, arquivou, encerrou, excluiu). A vaga só fica livre 30 dias depois (anti-rodízio).';
comment on column public.processes.sync_baseline_pending is
  'A próxima coleta só registra o histórico do tribunal, sem avisar: o processo tinha movimentações manuais (já informadas).';

/** Processo que ocupa vaga de sincronização agora. */
create or replace function app.process_counts_as_tracked(p public.processes)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p.deleted_at is null and p.status = 'active' and p.tracking_enabled
     and p.cnj_number is not null and app.court_is_tracked(p.court_id);
$$;

create or replace function app.space_tracked_count(p_space uuid, p_exclude uuid default null)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.processes p
   where p.space_id = p_space
     and p.id is distinct from p_exclude
     and (
       app.process_counts_as_tracked(p)
       or p.tracking_released_at > now() - interval '30 days'
     );
$$;

create or replace function app.processes_tracking_slot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_counts boolean := app.process_counts_as_tracked(old);
  v_new_counts boolean := app.process_counts_as_tracked(new);
  v_old_sync   boolean := old.tracking_enabled and old.status = 'active' and old.deleted_at is null;
  v_new_sync   boolean := new.tracking_enabled and new.status = 'active' and new.deleted_at is null;
begin
  if v_new_counts then
    new.tracking_released_at := null;
  elsif v_old_counts then
    new.tracking_released_at := now();
  end if;

  if v_new_sync and not v_old_sync then
    new.sync_baseline_pending := exists (
      select 1 from public.process_movements m
       where m.process_id = new.id and m.source_kind = 'manual' and m.deleted_at is null
    );
  elsif not v_new_sync then
    new.sync_baseline_pending := false;
  end if;
  return new;
end;
$$;

-- "zz_": roda depois de processes_enforce_plan (que pode desligar a sincronização).
create trigger zz_processes_tracking_slot
  before update on public.processes
  for each row execute function app.processes_tracking_slot();

-- O worker limpa sync_baseline_pending: não é edição do usuário.
create or replace function app.audit_processes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
  d record;
  v_tracking_cols constant text[] := array[
    'last_state_hash', 'last_checked_at', 'last_check_error',
    'check_requested_at', 'check_requested_by', 'updated_at', 'sync_baseline_pending'
  ];
begin
  if app._audit_skip() then return null; end if;

  if tg_op = 'INSERT' then
    perform app.write_audit_log('process.create', new.space_id, 'process', new.id::text,
      'success', app._audit_actor(), null, to_jsonb(new), null);
    return null;
  end if;

  if (to_jsonb(old) - v_tracking_cols) = (to_jsonb(new) - v_tracking_cols) then
    return null;
  end if;

  if old.deleted_at is null and new.deleted_at is not null then
    v_action := 'process.soft_delete';
  elsif old.deleted_at is not null and new.deleted_at is null then
    v_action := 'process.restore';
  elsif new.status is distinct from old.status then
    v_action := case
      when new.status = 'archived' then 'process.archive'
      when new.status = 'active' and old.status in ('archived', 'closed') then 'process.reactivate'
      when new.status = 'closed' then 'process.close'
      else 'process.update'
    end;
  else
    v_action := 'process.update';
  end if;

  select * into d from app.audit_diff(to_jsonb(old), to_jsonb(new));
  perform app.write_audit_log(v_action, new.space_id, 'process', new.id::text,
    'success', app._audit_actor(), d.before, d.after, null);
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Aniversário
-- ---------------------------------------------------------------------------
alter table public.profiles add column birth_date date;
alter table public.profiles add constraint profiles_birth_date_past_chk
  check (birth_date is null or birth_date <= current_date);

comment on column public.profiles.birth_date is
  'Opcional. Quem tiver recebe a mensagem de aniversário do escritório (N14).';

alter table public.message_templates
  add column kind text not null default 'movement';
alter table public.message_templates
  add constraint message_templates_kind_audience_chk check (
    (kind = 'movement' and audience in ('responsible', 'client'))
    or (kind = 'birthday' and audience in ('team', 'client'))
  );

comment on column public.message_templates.kind is
  'movement: aviso de movimentação ({{numero_processo}}, {{movimentacao}}, {{data}}). birthday: aniversário ({{nome}}, {{escritorio}}), público team ou client.';

-- Movimentação: o template escolhido precisa ser de movimentação.
create or replace function app.validate_notification_templates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.responsible_template_id is not null and not exists (
    select 1 from public.message_templates t
    where t.id = new.responsible_template_id and t.space_id = new.space_id
      and t.kind = 'movement' and t.audience = 'responsible'
  ) then
    raise exception 'Template de responsável inválido para este espaço.' using errcode = 'check_violation';
  end if;

  if new.client_template_id is not null and not exists (
    select 1 from public.message_templates t
    where t.id = new.client_template_id and t.space_id = new.space_id
      and t.kind = 'movement' and t.audience = 'client'
  ) then
    raise exception 'Template de cliente inválido para este espaço.' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

alter table public.space_notification_configs
  add column team_birthday_template_id uuid references public.message_templates (id) on delete set null,
  add column client_birthday_template_id uuid references public.message_templates (id) on delete set null;

create or replace function app.validate_birthday_templates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.team_birthday_template_id is not null and not exists (
    select 1 from public.message_templates t
    where t.id = new.team_birthday_template_id and t.space_id = new.space_id
      and t.kind = 'birthday' and t.audience = 'team'
  ) then
    raise exception 'Template de aniversário da equipe inválido para este espaço.'
      using errcode = 'check_violation';
  end if;

  if new.client_birthday_template_id is not null and not exists (
    select 1 from public.message_templates t
    where t.id = new.client_birthday_template_id and t.space_id = new.space_id
      and t.kind = 'birthday' and t.audience = 'client'
  ) then
    raise exception 'Template de aniversário de clientes inválido para este espaço.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger space_notification_configs_validate_birthday_templates
  before insert or update on public.space_notification_configs
  for each row execute function app.validate_birthday_templates();

-- Registro dos parabéns: um por pessoa por dia (o job roda de hora em hora
-- até o fim da tarde, e nunca manda duas vezes).
create table public.birthday_greetings (
  id                   uuid primary key default gen_random_uuid(),
  space_id             uuid not null references public.spaces (id) on delete cascade,
  recipient_type       text not null,
  recipient_profile_id uuid references public.profiles (id) on delete cascade,
  recipient_client_id  uuid references public.clients (id) on delete cascade,
  greeting_date        date not null,
  phone                text not null,
  status               public.notification_delivery_status not null,
  error                text,
  attempts             integer not null default 1,
  sent_at              timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz,
  constraint birthday_greetings_recipient_chk check (
    (recipient_type = 'team' and recipient_profile_id is not null and recipient_client_id is null)
    or (recipient_type = 'client' and recipient_client_id is not null and recipient_profile_id is null)
  )
);

comment on table public.birthday_greetings is
  'Mensagens de aniversário enviadas (ou com falha) por pessoa e dia. Só o worker (service_role) lê e escreve.';

create unique index birthday_greetings_team_uniq
  on public.birthday_greetings (space_id, recipient_profile_id, greeting_date)
  where recipient_type = 'team';
create unique index birthday_greetings_client_uniq
  on public.birthday_greetings (space_id, recipient_client_id, greeting_date)
  where recipient_type = 'client';

create trigger birthday_greetings_set_updated_at
  before update on public.birthday_greetings
  for each row execute function app.set_updated_at();

alter table public.birthday_greetings enable row level security;
alter table public.birthday_greetings force row level security;
revoke all on public.birthday_greetings from anon, authenticated;
grant select, insert, update, delete on public.birthday_greetings to service_role;

-- Aniversariantes do dia para o worker (service_role). 29/02 comemora em
-- 28/02 nos anos não bissextos. Só espaços ativos; equipe com vínculo ativo
-- e telefone; cliente com aceite de avisos e telefone. `done` = já recebeu
-- hoje (ou já falhou 3 vezes).
create or replace function public.worker_birthdays_on(p_day date)
returns table (
  space_id       uuid,
  space_name     text,
  recipient_type text,
  recipient_id   uuid,
  full_name      text,
  phone          text,
  done           boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select extract(month from p_day)::int as m,
           extract(day from p_day)::int as d,
           -- 28/02 de ano não bissexto também comemora quem nasceu em 29/02.
           (extract(month from p_day) = 2 and extract(day from p_day) = 28
            and not (extract(day from (date_trunc('year', p_day) + interval '1 month 28 days')) = 29)) as feb28_catchup
  ),
  people as (
    select sm.space_id, 'team'::text as recipient_type, pr.id as recipient_id,
           pr.full_name, pr.phone, pr.birth_date
      from public.space_members sm
      join public.profiles pr on pr.id = sm.profile_id
     where sm.status = 'active' and pr.phone is not null and pr.birth_date is not null
    union all
    select c.space_id, 'client', c.id, c.name, c.phone, c.birth_date
      from public.clients c
     where c.deleted_at is null and c.notification_opt_in
       and c.phone is not null and c.birth_date is not null
  )
  select p.space_id, s.name, p.recipient_type, p.recipient_id, p.full_name, p.phone,
         exists (
           select 1 from public.birthday_greetings g
            where g.space_id = p.space_id
              and g.greeting_date = p_day
              and g.recipient_type = p.recipient_type
              and coalesce(g.recipient_profile_id, g.recipient_client_id) = p.recipient_id
              and (g.status = 'sent' or g.attempts >= 3)
         ) as done
    from people p
    join public.spaces s on s.id = p.space_id and s.status = 'active'
    cross join target t
   where (extract(month from p.birth_date) = t.m and extract(day from p.birth_date) = t.d)
      or (t.feb28_catchup and extract(month from p.birth_date) = 2 and extract(day from p.birth_date) = 29);
$$;

revoke execute on function public.worker_birthdays_on(date) from public, anon, authenticated;
grant execute on function public.worker_birthdays_on(date) to service_role;

-- Auditoria de envio: "skipped" (histórico registrado sem aviso) tem ação própria.
create or replace function app.audit_notification_deliveries()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
  d record;
begin
  v_action := case new.status
                when 'sent' then 'notification.delivery.sent'
                when 'skipped' then 'notification.delivery.skipped'
                else 'notification.delivery.failed'
              end;

  if tg_op = 'INSERT' then
    perform app.write_audit_log(v_action, new.space_id, 'notification_delivery', new.id::text,
      'success', app._audit_actor(), null, to_jsonb(new),
      jsonb_build_object('process_id', new.process_id, 'movement_id', new.movement_id));
    return null;
  end if;

  select * into d from app.audit_diff(to_jsonb(old), to_jsonb(new));
  perform app.write_audit_log(v_action, new.space_id, 'notification_delivery', new.id::text,
    'success', app._audit_actor(), d.before, d.after,
    jsonb_build_object('process_id', new.process_id, 'movement_id', new.movement_id));
  return null;
end;
$$;
