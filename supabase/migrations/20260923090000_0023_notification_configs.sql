-- =============================================================================
-- 0023 — Motor de notificações configurável (RN seções 10/11/40):
-- templates por espaço + configuração geral (espaço) + personalizada (processo).
-- A config do processo prevalece sobre a do espaço quando o campo não é nulo;
-- nulo = herda. Sem regra por tipo de movimentação ainda (scraping devolve
-- texto livre, sem taxonomia de evento) — só por destinatário, que é o que a
-- RN pede sem inventar classificação que não existe.
-- =============================================================================

create type public.notification_audience as enum ('responsible', 'client');

-- ---------------------------------------------------------------------------
-- message_templates — texto não fica hard-coded no worker (RN seção 11).
-- ---------------------------------------------------------------------------
create table public.message_templates (
  id         uuid primary key default gen_random_uuid(),
  space_id   uuid not null references public.spaces (id) on delete cascade,
  name       text not null,
  audience   public.notification_audience not null,
  body       text not null,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint message_templates_name_not_blank_chk check (length(btrim(name)) > 0),
  constraint message_templates_body_not_blank_chk check (length(btrim(body)) > 0)
);

comment on table public.message_templates is
  'Templates de mensagem WhatsApp por espaço/audiência. Placeholders: {{numero_processo}}, {{movimentacao}}, {{data}}.';

create index message_templates_space_audience_idx on public.message_templates (space_id, audience);

create trigger message_templates_set_updated_at
  before update on public.message_templates
  for each row execute function app.set_updated_at();

alter table public.message_templates enable row level security;
alter table public.message_templates force row level security;

create policy message_templates_select
  on public.message_templates for select
  to authenticated
  using (app.is_super_admin() or app.is_active_member(space_id));

create policy message_templates_insert
  on public.message_templates for insert
  to authenticated
  with check (app.is_space_admin(space_id) and created_by = (select auth.uid()));

create policy message_templates_update
  on public.message_templates for update
  to authenticated
  using (app.is_space_admin(space_id))
  with check (app.is_space_admin(space_id));

create policy message_templates_delete
  on public.message_templates for delete
  to authenticated
  using (app.is_space_admin(space_id));

grant select, insert, update, delete on public.message_templates to authenticated;

-- ---------------------------------------------------------------------------
-- Helper: valida que um template referenciado pertence ao espaço certo e tem
-- a audiência certa. Reusado pelas duas tabelas de config abaixo.
-- ---------------------------------------------------------------------------
create or replace function app.validate_notification_templates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space uuid;
begin
  v_space := new.space_id;

  if new.responsible_template_id is not null and not exists (
    select 1 from public.message_templates t
    where t.id = new.responsible_template_id and t.space_id = v_space and t.audience = 'responsible'
  ) then
    raise exception 'Template de responsável inválido para este espaço.' using errcode = 'check_violation';
  end if;

  if new.client_template_id is not null and not exists (
    select 1 from public.message_templates t
    where t.id = new.client_template_id and t.space_id = v_space and t.audience = 'client'
  ) then
    raise exception 'Template de cliente inválido para este espaço.' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- space_notification_configs — configuração geral do espaço (1:1, RN seção 40).
-- ---------------------------------------------------------------------------
create table public.space_notification_configs (
  space_id                 uuid primary key references public.spaces (id) on delete cascade,
  notify_responsible       boolean not null default true,
  notify_clients           boolean not null default true,
  responsible_template_id  uuid references public.message_templates (id) on delete set null,
  client_template_id       uuid references public.message_templates (id) on delete set null,
  updated_by               uuid references public.profiles (id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz
);

comment on table public.space_notification_configs is
  'Padrão de notificação do espaço. Um processo sem config própria herda daqui; sem linha aqui, o worker usa true/true + template genérico embutido.';

create trigger space_notification_configs_set_updated_at
  before update on public.space_notification_configs
  for each row execute function app.set_updated_at();

create trigger space_notification_configs_validate_templates
  before insert or update on public.space_notification_configs
  for each row execute function app.validate_notification_templates();

alter table public.space_notification_configs enable row level security;
alter table public.space_notification_configs force row level security;

create policy space_notification_configs_select
  on public.space_notification_configs for select
  to authenticated
  using (app.is_super_admin() or app.is_active_member(space_id));

create policy space_notification_configs_insert
  on public.space_notification_configs for insert
  to authenticated
  with check (app.is_space_admin(space_id));

create policy space_notification_configs_update
  on public.space_notification_configs for update
  to authenticated
  using (app.is_space_admin(space_id))
  with check (app.is_space_admin(space_id));

grant select, insert, update on public.space_notification_configs to authenticated;

-- ---------------------------------------------------------------------------
-- process_notification_configs — override por processo (1:1, nulo = herda).
-- Escrita de quem edita o processo (ADMIN ou responsável atual, app.can_edit_process
-- — 0011), não só ADMIN: é o mesmo público que já configura o processo em si.
-- ---------------------------------------------------------------------------
create table public.process_notification_configs (
  process_id               uuid primary key references public.processes (id) on delete cascade,
  space_id                 uuid not null references public.spaces (id) on delete cascade,
  notify_responsible       boolean,
  notify_clients           boolean,
  responsible_template_id  uuid references public.message_templates (id) on delete set null,
  client_template_id       uuid references public.message_templates (id) on delete set null,
  updated_by               uuid references public.profiles (id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz
);

comment on column public.process_notification_configs.notify_responsible is
  'NULL = herda de space_notification_configs (ou true, se o espaço também não tiver config).';

create trigger process_notification_configs_set_updated_at
  before update on public.process_notification_configs
  for each row execute function app.set_updated_at();

create trigger process_notification_configs_validate_templates
  before insert or update on public.process_notification_configs
  for each row execute function app.validate_notification_templates();

alter table public.process_notification_configs enable row level security;
alter table public.process_notification_configs force row level security;

create policy process_notification_configs_select
  on public.process_notification_configs for select
  to authenticated
  using (app.can_read_process(process_id));

create policy process_notification_configs_insert
  on public.process_notification_configs for insert
  to authenticated
  with check (app.can_edit_process(process_id));

create policy process_notification_configs_update
  on public.process_notification_configs for update
  to authenticated
  using (app.can_edit_process(process_id))
  with check (app.can_edit_process(process_id));

create policy process_notification_configs_delete
  on public.process_notification_configs for delete
  to authenticated
  using (app.can_edit_process(process_id));

grant select, insert, update, delete on public.process_notification_configs to authenticated;
