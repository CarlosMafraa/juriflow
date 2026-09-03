-- =============================================================================
-- 0006 — audit_logs (append-only) + helper de escrita
-- =============================================================================

create type public.audit_actor_type as enum ('user', 'system', 'job');
create type public.audit_result as enum ('success', 'failure');

create table public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid references public.spaces (id) on delete set null,
  actor_id    uuid references public.profiles (id) on delete set null,
  actor_type  public.audit_actor_type not null default 'user',
  action      text not null,
  entity_type text,
  entity_id   text,
  result      public.audit_result not null default 'success',
  before      jsonb,
  after       jsonb,
  context     jsonb,
  created_at  timestamptz not null default now(),
  constraint audit_logs_action_not_blank_chk check (length(btrim(action)) > 0)
);

comment on table public.audit_logs is
  'Trilha de auditoria imutável (append-only). Escrita apenas via app.write_audit_log ou service_role.';

create index audit_logs_space_created_idx on public.audit_logs (space_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_logs_actor_created_idx on public.audit_logs (actor_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Append-only: bloqueia UPDATE/DELETE para qualquer papel.
-- ---------------------------------------------------------------------------
create or replace function app.audit_logs_block_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_logs é append-only: % não é permitido.', tg_op
    using errcode = 'restrict_violation';
end;
$$;

create trigger audit_logs_no_update
  before update on public.audit_logs
  for each row execute function app.audit_logs_block_mutation();

create trigger audit_logs_no_delete
  before delete on public.audit_logs
  for each row execute function app.audit_logs_block_mutation();

-- ---------------------------------------------------------------------------
-- Helper de escrita. Código de aplicação confiável chama esta função;
-- usuários não têm INSERT direto.
-- ---------------------------------------------------------------------------
create or replace function app.write_audit_log(
  p_action      text,
  p_space_id    uuid default null,
  p_entity_type text default null,
  p_entity_id   text default null,
  p_result      public.audit_result default 'success',
  p_actor_type  public.audit_actor_type default 'user',
  p_before      jsonb default null,
  p_after       jsonb default null,
  p_context     jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.audit_logs (
    space_id, actor_id, actor_type, action, entity_type, entity_id,
    result, before, after, context
  )
  values (
    p_space_id, (select auth.uid()), p_actor_type, p_action, p_entity_type, p_entity_id,
    p_result, p_before, p_after, p_context
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS: leitura por ADMIN do espaço (linhas do espaço) ou SUPER_ADMIN (todas,
-- inclusive globais com space_id nulo). Sem INSERT/UPDATE/DELETE para usuários.
-- ---------------------------------------------------------------------------
alter table public.audit_logs enable row level security;
alter table public.audit_logs force row level security;

create policy audit_logs_select
  on public.audit_logs for select
  to authenticated
  using (
    app.is_super_admin()
    or (space_id is not null and app.is_space_admin(space_id))
  );

grant select on public.audit_logs to authenticated;
revoke insert, update, delete on public.audit_logs from authenticated, anon;
