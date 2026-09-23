-- =============================================================================
-- 0026 — whatsapp_sessions (RN seção 22 / F12 / docs/PLANO-FASE-1.md seção 10):
-- uma sessão WAHA por espaço. O ADMIN pede conexão/desconexão pela própria
-- tela do app; quem de fato fala HTTP com o WAHA e grava status/QR aqui é o
-- scraper-worker (service_role, roda o polling job), nunca o navegador.
-- =============================================================================

create table public.whatsapp_sessions (
  space_id        uuid primary key references public.spaces (id) on delete cascade,
  session_name    text not null,
  status          text not null default 'disconnected',
  pending_action  text,
  qr_code         text,
  last_error      text,
  requested_by    uuid references public.profiles (id) on delete set null,
  requested_at    timestamptz,
  connected_at    timestamptz,
  last_checked_at timestamptz,
  updated_at      timestamptz,
  constraint whatsapp_sessions_status_chk
    check (status in ('disconnected', 'connecting', 'qr_ready', 'connected', 'failed')),
  constraint whatsapp_sessions_pending_action_chk
    check (pending_action is null or pending_action in ('connect', 'disconnect')),
  constraint whatsapp_sessions_session_name_not_blank_chk check (length(btrim(session_name)) > 0)
);

comment on table public.whatsapp_sessions is
  'Status da sessão WhatsApp (WAHA) de cada espaço. QR code é a imagem em base64 devolvida pelo WAHA enquanto status=qr_ready — nunca a credencial/token de sessão em si.';

create trigger whatsapp_sessions_set_updated_at
  before update on public.whatsapp_sessions
  for each row execute function app.set_updated_at();

alter table public.whatsapp_sessions enable row level security;
alter table public.whatsapp_sessions force row level security;

-- Leitura: ADMIN do próprio espaço ou SUPER_ADMIN (RN7: SUPER_ADMIN só vê, não
-- gerencia — pedir conexão/desconexão é só via as RPCs abaixo, que exigem
-- is_space_admin, nunca is_super_admin).
create policy whatsapp_sessions_select
  on public.whatsapp_sessions for select
  to authenticated
  using (app.is_super_admin() or app.is_space_admin(space_id));

grant select on public.whatsapp_sessions to authenticated;
revoke insert, update, delete on public.whatsapp_sessions from authenticated, anon;

-- ---------------------------------------------------------------------------
-- RPCs: único jeito de um usuário autenticado sinalizar intenção de
-- conectar/desconectar. Quem executa de fato é o polling job do
-- scraper-worker (service_role, bypassa RLS). SECURITY DEFINER só para poder
-- fazer upsert em uma tabela sem policy de INSERT/UPDATE para authenticated.
-- ---------------------------------------------------------------------------
create or replace function public.request_whatsapp_connect(p_space_id uuid)
returns public.whatsapp_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.whatsapp_sessions;
  v_session_name text;
begin
  if not app.is_space_admin(p_space_id) then
    raise exception 'Acesso negado: apenas ADMIN do espaço pode conectar o WhatsApp.'
      using errcode = '42501';
  end if;

  v_session_name := 'space_' || replace(p_space_id::text, '-', '');

  insert into public.whatsapp_sessions (
    space_id, session_name, status, pending_action, requested_by, requested_at, last_error
  )
  values (p_space_id, v_session_name, 'disconnected', 'connect', auth.uid(), now(), null)
  on conflict (space_id) do update set
    pending_action = 'connect',
    requested_by = auth.uid(),
    requested_at = now(),
    last_error = null
  returning * into v_row;

  perform app.write_audit_log(
    'waha.session.connect',
    p_space_id,
    'whatsapp_session',
    p_space_id::text,
    'success',
    'user',
    null,
    jsonb_build_object('status', v_row.status)
  );

  return v_row;
end;
$$;

create or replace function public.request_whatsapp_disconnect(p_space_id uuid)
returns public.whatsapp_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.whatsapp_sessions;
begin
  if not app.is_space_admin(p_space_id) then
    raise exception 'Acesso negado: apenas ADMIN do espaço pode desconectar o WhatsApp.'
      using errcode = '42501';
  end if;

  update public.whatsapp_sessions
  set pending_action = 'disconnect',
      requested_by = auth.uid(),
      requested_at = now(),
      last_error = null
  where space_id = p_space_id
  returning * into v_row;

  if v_row is null then
    raise exception 'Nenhuma sessão de WhatsApp encontrada para este espaço.'
      using errcode = 'P0002';
  end if;

  perform app.write_audit_log(
    'waha.session.disconnect',
    p_space_id,
    'whatsapp_session',
    p_space_id::text,
    'success',
    'user',
    null,
    jsonb_build_object('status', v_row.status)
  );

  return v_row;
end;
$$;

revoke execute on function public.request_whatsapp_connect(uuid) from public;
revoke execute on function public.request_whatsapp_disconnect(uuid) from public;
grant execute on function public.request_whatsapp_connect(uuid) to authenticated;
grant execute on function public.request_whatsapp_disconnect(uuid) to authenticated;
