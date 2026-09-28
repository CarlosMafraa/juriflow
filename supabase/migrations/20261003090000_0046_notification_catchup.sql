-- =============================================================================
-- 0046 — Ajustes da validação com o cliente.
--
-- 1. Processo novo nasce SEM sincronização automática: o escritório escolhe
--    os poucos que quer acompanhar (processos existentes ficam como estão).
--
-- 2. Fila de "avisos pendentes" (N10/N11). O worker passou a enviar, por
--    destinatário, tudo o que ele ainda não recebeu — não só as movimentações
--    novas da consulta. Esta fila diz ao worker QUANDO rodar isso sem
--    consultar o tribunal de novo:
--      - a configuração de notificação mudou (espaço, processo ou tipos);
--      - entrou responsável ou cliente no processo, ou o cliente passou a
--        aceitar avisos / ganhou telefone;
--      - o WhatsApp do espaço conectou (o que ficou retido sai agora).
--    Só o worker (service_role) lê/apaga; a escrita vem destes triggers.
-- =============================================================================

alter table public.processes alter column tracking_enabled set default false;

comment on column public.processes.tracking_enabled is
  'Sincronização automática (coleta diária + "consultar agora"). Nasce desligada: o escritório liga só nos processos que quer acompanhar, dentro do limite do plano.';

-- ---------------------------------------------------------------------------
-- Fila
-- ---------------------------------------------------------------------------
create table public.notification_catchup_requests (
  process_id   uuid primary key references public.processes (id) on delete cascade,
  space_id     uuid not null references public.spaces (id) on delete cascade,
  requested_at timestamptz not null default now()
);

comment on table public.notification_catchup_requests is
  'Processos com avisos a conferir/enviar sem nova consulta ao tribunal. O worker apaga a linha ao processar (só se requested_at não mudou nesse meio-tempo).';

create index notification_catchup_requests_requested_idx
  on public.notification_catchup_requests (requested_at);

alter table public.notification_catchup_requests enable row level security;
alter table public.notification_catchup_requests force row level security;
-- Sem policy: nenhum usuário lê ou escreve direto. Só triggers (security
-- definer) e o worker.
revoke all on public.notification_catchup_requests from anon, authenticated;
grant select, insert, update, delete on public.notification_catchup_requests to service_role;

/** Enfileira os processos acompanhados (ativos, com sincronização) do filtro. */
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
     and p.tracking_enabled
  on conflict (process_id) do update set requested_at = excluded.requested_at;
$$;

create or replace function app.enqueue_space_notification_catchup(p_space_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select app.enqueue_notification_catchup(
    array(select id from public.processes where space_id = p_space_id)
  );
$$;

revoke execute on function app.enqueue_notification_catchup(uuid[]) from public;
revoke execute on function app.enqueue_space_notification_catchup(uuid) from public;

-- ---------------------------------------------------------------------------
-- Gatilhos: configuração de notificação
-- ---------------------------------------------------------------------------
create or replace function app.catchup_on_process_notification_config()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.enqueue_notification_catchup(
    array[coalesce(new.process_id, old.process_id)]
  );
  return null;
end;
$$;

create trigger zz_catchup_process_notification_configs
  after insert or update or delete on public.process_notification_configs
  for each row execute function app.catchup_on_process_notification_config();

create trigger zz_catchup_process_movement_type_prefs
  after insert or update or delete on public.process_movement_type_prefs
  for each row execute function app.catchup_on_process_notification_config();

create or replace function app.catchup_on_space_notification_config()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.enqueue_space_notification_catchup(new.space_id);
  return null;
end;
$$;

create trigger zz_catchup_space_notification_configs
  after insert or update on public.space_notification_configs
  for each row execute function app.catchup_on_space_notification_config();

-- Toggles da lista do escritório: um "ligar tudo" muda muitas linhas de uma
-- vez — por statement, para enfileirar o espaço uma vez só.
create or replace function app.catchup_on_space_movement_types()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space uuid;
begin
  for v_space in
    select distinct n.space_id
      from new_rows n
      join old_rows o on o.space_id = n.space_id and o.name = n.name
     where n.notify_responsible is distinct from o.notify_responsible
        or n.notify_client is distinct from o.notify_client
  loop
    perform app.enqueue_space_notification_catchup(v_space);
  end loop;
  return null;
end;
$$;

create trigger zz_catchup_space_movement_types
  after update on public.space_movement_types
  referencing new table as new_rows old table as old_rows
  for each statement execute function app.catchup_on_space_movement_types();

-- ---------------------------------------------------------------------------
-- Gatilhos: destinatários (6-b: quem entra depois recebe o histórico)
-- ---------------------------------------------------------------------------
create or replace function app.catchup_on_process_responsible()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.ended_at is null then
    perform app.enqueue_notification_catchup(array[new.process_id]);
  end if;
  return null;
end;
$$;

create trigger zz_catchup_process_responsible_history
  after insert on public.process_responsible_history
  for each row execute function app.catchup_on_process_responsible();

create or replace function app.catchup_on_process_client()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is null
     and (tg_op = 'INSERT' or old.deleted_at is not null) then
    perform app.enqueue_notification_catchup(array[new.process_id]);
  end if;
  return null;
end;
$$;

create trigger zz_catchup_process_clients
  after insert or update of deleted_at on public.process_clients
  for each row execute function app.catchup_on_process_client();

create or replace function app.catchup_on_client_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.notification_opt_in and new.phone is not null and new.deleted_at is null
     and (new.phone is distinct from old.phone
          or new.notification_opt_in is distinct from old.notification_opt_in) then
    perform app.enqueue_notification_catchup(array(
      select pc.process_id from public.process_clients pc
       where pc.client_id = new.id and pc.deleted_at is null
    ));
  end if;
  return null;
end;
$$;

create trigger zz_catchup_clients
  after update of phone, notification_opt_in on public.clients
  for each row execute function app.catchup_on_client_contact();

create or replace function app.catchup_on_profile_phone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.phone is not null and new.phone is distinct from old.phone then
    perform app.enqueue_notification_catchup(array(
      select h.process_id from public.process_responsible_history h
       where h.responsible_id = new.id and h.ended_at is null
    ));
  end if;
  return null;
end;
$$;

create trigger zz_catchup_profiles
  after update of phone on public.profiles
  for each row execute function app.catchup_on_profile_phone();

-- ---------------------------------------------------------------------------
-- Gatilho: WhatsApp conectou (3: o que ficou retido sai agora)
-- ---------------------------------------------------------------------------
create or replace function app.catchup_on_whatsapp_connected()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'connected' and old.status is distinct from 'connected' then
    perform app.enqueue_space_notification_catchup(new.space_id);
  end if;
  return null;
end;
$$;

create trigger zz_catchup_whatsapp_sessions
  after update of status on public.whatsapp_sessions
  for each row execute function app.catchup_on_whatsapp_connected();
