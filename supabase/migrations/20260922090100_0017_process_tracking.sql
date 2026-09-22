-- =============================================================================
-- 0017 — MVP Acompanhamento: estado de tracking em processes/courts +
-- notification_deliveries (idempotência de envio — sem fila/retry sofisticado
-- nesta fase, ver ADR-0004 e docs do MVP).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- courts.tracking_source_kind — qual SourceKind (packages/collectors-core) o
-- worker deve usar para este tribunal. NULL = tribunal sem coleta automática
-- ainda suportada. Dado, não código — extensível sem alterar o worker (ADR-0004).
-- ---------------------------------------------------------------------------
alter table public.courts
  add column tracking_source_kind text;

comment on column public.courts.tracking_source_kind is
  'SourceKind do @juriflow/collectors-core usado para coletar este tribunal (ex.: projudi_tjam). NULL = sem coleta automática.';

-- Garante o TJAM com a fonte MVP, criando o registro se o seed local não rodou.
insert into public.courts (name, type, jurisdiction, tracking_source_kind)
select 'Tribunal de Justiça do Amazonas', 'TJ', 'AM', 'projudi_tjam'
where not exists (
  select 1 from public.courts where type = 'TJ' and jurisdiction = 'AM'
);

update public.courts
  set tracking_source_kind = 'projudi_tjam'
  where type = 'TJ' and jurisdiction = 'AM' and tracking_source_kind is null;

-- ---------------------------------------------------------------------------
-- processes — estado do último ciclo de coleta.
-- ---------------------------------------------------------------------------
alter table public.processes
  add column tracking_enabled boolean not null default true,
  add column last_state_hash text,
  add column last_checked_at timestamptz,
  add column last_check_error text;

comment on column public.processes.tracking_enabled is
  'Se falso (ex.: arquivado), o worker ignora o processo na rotina automática (RN seção 41).';
comment on column public.processes.last_state_hash is
  'Hash do conjunto de movimentações na última coleta. NULL = ainda não houve 1ª coleta (RN11).';

create index processes_trackable_idx
  on public.processes (court_id)
  where deleted_at is null and status = 'active' and tracking_enabled;

-- ---------------------------------------------------------------------------
-- notification_deliveries — 1 linha por (movimentação, destinatário). Upsert
-- pelo worker: garante no máximo 1 envio bem-sucedido por destinatário/movimentação.
-- ---------------------------------------------------------------------------
create type public.notification_recipient_type as enum ('responsible', 'client');
create type public.notification_delivery_status as enum ('sent', 'failed');

create table public.notification_deliveries (
  id                   uuid primary key default gen_random_uuid(),
  space_id             uuid not null references public.spaces (id) on delete cascade,
  process_id           uuid not null references public.processes (id) on delete cascade,
  movement_id          uuid not null references public.process_movements (id) on delete cascade,
  recipient_type        public.notification_recipient_type not null,
  recipient_client_id  uuid references public.clients (id) on delete cascade,
  phone                text not null,
  status               public.notification_delivery_status not null,
  error                text,
  sent_at              timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz,
  constraint notification_deliveries_client_id_chk check (
    (recipient_type = 'client' and recipient_client_id is not null)
    or (recipient_type = 'responsible' and recipient_client_id is null)
  ),
  constraint notification_deliveries_phone_e164_chk check (phone ~ '^\+[1-9]\d{6,14}$')
);

comment on table public.notification_deliveries is
  'Idempotência de envio WhatsApp: 1 linha por (movement, destinatário). Retry = update da mesma linha, nunca insert duplicado.';

-- Um envio bem-sucedido por (movimentação, responsável) e por (movimentação, cliente).
create unique index notification_deliveries_responsible_uniq
  on public.notification_deliveries (movement_id)
  where recipient_type = 'responsible';
create unique index notification_deliveries_client_uniq
  on public.notification_deliveries (movement_id, recipient_client_id)
  where recipient_type = 'client';
create index notification_deliveries_space_idx on public.notification_deliveries (space_id);
create index notification_deliveries_process_idx on public.notification_deliveries (process_id);

create trigger notification_deliveries_set_updated_at
  before update on public.notification_deliveries
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: mesma visibilidade de processes. Escrita só pelo worker (service_role).
-- ---------------------------------------------------------------------------
alter table public.notification_deliveries enable row level security;
alter table public.notification_deliveries force row level security;

create policy notification_deliveries_select
  on public.notification_deliveries for select
  to authenticated
  using (app.can_read_process(process_id));

grant select on public.notification_deliveries to authenticated;
revoke insert, update, delete on public.notification_deliveries from authenticated, anon;
