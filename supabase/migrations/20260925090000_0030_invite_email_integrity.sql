-- =============================================================================
-- 0030 — Integridade do e-mail no fluxo de convite.
--
-- Falha corrigida: `profiles.email` era editável pelo próprio usuário (a policy
-- profiles_update_self libera a linha inteira; só `is_super_admin` tinha
-- gatilho de proteção). Como `my_pending_invites`/`accept_space_invite`
-- comparavam o convite com `profiles.email`, qualquer conta podia trocar o
-- próprio e-mail para o de um convidado, ler o token e entrar no espaço dele.
--
-- Correção em 3 partes:
--   1. `profiles.email` deixa de ser editável pela API (espelho de auth.users).
--   2. Mudança de e-mail no Auth (confirmada pelo GoTrue) é sincronizada para
--      `profiles` por gatilho em auth.users.
--   3. Convites passam a comparar com o e-mail CONFIRMADO de auth.users
--      (`app.verified_email()`), nunca com `profiles`.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. profiles.email imutável para usuários autenticados (inclui SUPER_ADMIN:
--    o e-mail é do Auth, não do perfil). Contextos sem JWT (GoTrue, service_role,
--    migrations) continuam podendo alterar — é por eles que a sincronização passa.
-- ---------------------------------------------------------------------------
create or replace function app.protect_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email and (select auth.uid()) is not null then
    raise exception 'O e-mail do perfil é gerenciado pela autenticação e não pode ser alterado aqui.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger profiles_protect_email
  before update on public.profiles
  for each row execute function app.protect_profile_email();

-- ---------------------------------------------------------------------------
-- 2. Sincroniza auth.users.email -> profiles.email.
-- ---------------------------------------------------------------------------
create or replace function app.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row
  when (new.email is distinct from old.email)
  execute function app.sync_profile_email();

-- Corrige qualquer divergência já existente (inclusive uma exploração prévia).
update public.profiles p
   set email = u.email
  from auth.users u
 where u.id = p.id
   and p.email is distinct from u.email;

-- ---------------------------------------------------------------------------
-- 3. E-mail confirmado do usuário autenticado, lido direto do Auth.
-- ---------------------------------------------------------------------------
create or replace function app.verified_email()
returns extensions.citext
language sql
stable
security definer
set search_path = ''
as $$
  select u.email::extensions.citext
  from auth.users u
  where u.id = (select auth.uid())
    and u.email_confirmed_at is not null;
$$;

revoke all on function app.verified_email() from public;
grant execute on function app.verified_email() to authenticated;

create or replace function public.my_pending_invites()
returns table (
  id         uuid,
  space_id   uuid,
  space_name text,
  role       public.space_role,
  token      uuid,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select si.id, si.space_id, sp.name, si.role, si.token, si.expires_at
  from public.space_invites si
  join public.spaces sp on sp.id = si.space_id
  where si.status = 'pending'
    and si.expires_at > now()
    and si.email = app.verified_email();
$$;

create or replace function public.accept_space_invite(p_token uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite       public.space_invites;
  v_my_email     extensions.citext;
  v_existing_id  uuid;
begin
  select * into v_invite from public.space_invites where token = p_token for update;
  if v_invite.id is null or v_invite.status <> 'pending' then
    raise exception 'Convite não encontrado ou já utilizado.' using errcode = 'no_data_found';
  end if;
  if v_invite.expires_at <= now() then
    update public.space_invites set status = 'expired' where id = v_invite.id;
    raise exception 'Este convite expirou. Peça um novo convite.' using errcode = 'data_exception';
  end if;

  v_my_email := app.verified_email();
  if v_my_email is null or v_my_email is distinct from v_invite.email then
    raise exception 'Este convite não pertence à conta com a qual você está autenticado.'
      using errcode = 'insufficient_privilege';
  end if;

  set local app.skip_row_audit = 'on';

  select id into v_existing_id
    from public.space_members
    where space_id = v_invite.space_id and profile_id = (select auth.uid());

  if v_existing_id is not null then
    update public.space_members
      set role = v_invite.role, status = 'active', accepted_at = now()
      where id = v_existing_id;
  else
    insert into public.space_members
      (space_id, profile_id, role, status, invited_by, invited_at, accepted_at)
    values
      (v_invite.space_id, (select auth.uid()), v_invite.role, 'active',
       v_invite.invited_by, v_invite.created_at, now());
  end if;

  update public.space_invites
    set status = 'accepted', accepted_at = now()
    where id = v_invite.id;

  perform app.write_audit_log(
    'member.accept', v_invite.space_id, 'space_member', (select auth.uid())::text,
    'success', 'user', null, jsonb_build_object('role', v_invite.role), null
  );

  perform set_config('app.skip_row_audit', 'off', true);
end;
$$;
