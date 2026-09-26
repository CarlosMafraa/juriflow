-- =============================================================================
-- 0039 — Convite de escritório e ciclo de vida do link de convite.
--
-- Responsabilidades:
--   - SUPER_ADMIN (único) convida sempre o ADMIN de um espaço NOVO. O espaço
--     nasce "aguardando configuração"; quem completa nome do escritório e os
--     próprios dados é o ADMIN, ao abrir o link.
--   - ADMIN convida colaboradores/ADMINs só do próprio espaço.
--
-- Regras de todo link de convite:
--   1. Saber se a pessoa ABRIU o link (space_invites.opened_at).
--   2. O link vale 24 horas (expires_at; no Auth, otp_expiry = 86400).
--   3. Reenviar invalida o anterior: o convite antigo fica "substituído"
--      (superseded_at) e só o mais recente é aceito. No Auth, o reenvio troca
--      o token do usuário, então o link antigo também falha lá.
--
-- O SUPER_ADMIN deixa de ler/alterar perfis alheios (a lista de usuários de
-- todos os escritórios era conteúdo de dentro dos espaços).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Estrutura
-- ---------------------------------------------------------------------------
-- Padrão = configurado: só o "Novo escritório" da plataforma cria pendente.
alter table public.spaces
  add column admin_email extensions.citext,
  add column setup_completed_at timestamptz default now();

comment on column public.spaces.admin_email is
  'E-mail do ADMIN convidado pela plataforma ao criar o espaço.';
comment on column public.spaces.setup_completed_at is
  'Quando o ADMIN completou os dados do escritório. NULL = aguardando configuração.';

-- Espaços que já existiam estão configurados.
update public.spaces set setup_completed_at = created_at where setup_completed_at is null;

-- Quem concluiu o primeiro acesso (criou senha e completou os dados). O Auth
-- grava uma senha aleatória em toda conta criada por convite, então "ter
-- senha" não diz nada: é este marcador que decide se a tela pede para criar.
alter table public.profiles add column onboarded_at timestamptz;
update public.profiles set onboarded_at = created_at where onboarded_at is null;

alter table public.space_invites
  add column opened_at timestamptz,
  add column superseded_at timestamptz,
  alter column expires_at set default (now() + interval '24 hours');

comment on column public.space_invites.opened_at is 'Primeira vez que a pessoa abriu o link do convite.';
comment on column public.space_invites.superseded_at is
  'Convite substituído por um reenvio: o link deste deixa de valer.';

-- ---------------------------------------------------------------------------
-- 2. Dados do espaço: e-mail do ADMIN é da plataforma
-- ---------------------------------------------------------------------------
create or replace function app.spaces_guard_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_platform_cols constant text[] := array['status', 'max_processes', 'max_tracked_processes', 'admin_email'];
  v_ignored_cols  constant text[] := array['updated_at'];
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  if (to_jsonb(new) - (v_ignored_cols)) is not distinct from (to_jsonb(old) - (v_ignored_cols)) then
    return new;
  end if;

  if exists (
    select 1 from unnest(v_platform_cols) c
    where (to_jsonb(new) -> c) is distinct from (to_jsonb(old) -> c)
  ) and not app.is_super_admin() then
    raise exception 'Status e plano do espaço são definidos pela administração da plataforma.'
      using errcode = 'insufficient_privilege';
  end if;

  if (to_jsonb(new) - (v_platform_cols || v_ignored_cols))
       is distinct from (to_jsonb(old) - (v_platform_cols || v_ignored_cols))
     and not app.is_space_admin(old.id) then
    raise exception 'Somente o ADMIN do espaço altera os dados do espaço.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------
-- Marca como substituídos os convites pendentes deste e-mail neste espaço.
create or replace function app.supersede_pending_invites(p_space uuid, p_email extensions.citext)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.space_invites
     set status = 'cancelled', superseded_at = now()
   where space_id = p_space and email = p_email and status = 'pending';
$$;

-- Quem pode reenviar/entregar um convite: ADMIN do espaço, ou a plataforma
-- para o convite do ADMIN de um espaço ainda não configurado.
create or replace function app.can_manage_invite(p_invite uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.space_invites i
    join public.spaces s on s.id = i.space_id
    where i.id = p_invite
      and (
        app.is_space_admin(i.space_id)
        or (app.is_super_admin() and i.role = 'ADMIN' and s.setup_completed_at is null
            and i.email = s.admin_email)
      )
  );
$$;

-- Situação de um convite como a tela mostra.
create or replace function app.invite_state(i public.space_invites)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when i.status = 'accepted' then 'accepted'
    when i.superseded_at is not null then 'superseded'
    when i.status = 'cancelled' then 'cancelled'
    when i.expires_at <= now() then 'expired'
    when i.opened_at is not null then 'opened'
    else 'sent'
  end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Plataforma: novo escritório = espaço + convite do ADMIN
-- ---------------------------------------------------------------------------
drop function public.create_space_with_admin(text, text, uuid);

create or replace function public.create_space_for_admin(p_email text)
returns table (space_id uuid, invite_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email extensions.citext := lower(btrim(p_email));
  v_space uuid;
  v_invite uuid;
begin
  if not app.is_super_admin() then
    raise exception 'Somente a administração da plataforma cria escritórios.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_email is null or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'Informe um e-mail válido.' using errcode = 'check_violation';
  end if;
  if v_email = app.verified_email() then
    raise exception 'A administração da plataforma não pode ser ADMIN de um escritório.'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.spaces (name, slug, created_by, admin_email, setup_completed_at)
  values ('Novo escritório', 'escritorio-' || substr(md5(random()::text || clock_timestamp()::text), 1, 10),
          (select auth.uid()), v_email, null)
  returning id into v_space;

  insert into public.space_invites (space_id, email, role, invited_by)
  values (v_space, v_email, 'ADMIN', (select auth.uid()))
  returning id into v_invite;

  perform app.write_audit_log(
    'space.create', null, 'space', v_space::text, 'success', 'user',
    null, jsonb_build_object('admin_email', v_email), null
  );
  return query select v_space, v_invite;
end;
$$;

-- Lista de escritórios da plataforma: só o que existe por fora + o convite do ADMIN.
create or replace function public.platform_spaces()
returns table (
  id                    uuid,
  name                  text,
  status                public.space_status,
  max_processes         integer,
  max_tracked_processes integer,
  created_at            timestamptz,
  setup_completed_at    timestamptz,
  admin_email           text,
  invite_id             uuid,
  invite_state          text,
  invite_sent_at        timestamptz,
  invite_expires_at     timestamptz,
  invite_opened_at      timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_super_admin() then
    raise exception 'Somente a administração da plataforma.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select s.id, s.name, s.status, s.max_processes, s.max_tracked_processes, s.created_at,
           s.setup_completed_at, s.admin_email::text,
           (l.inv).id,
           case when (l.inv).id is null then null else app.invite_state(l.inv) end,
           (l.inv).created_at, (l.inv).expires_at, (l.inv).opened_at
    from public.spaces s
    -- Só o convite mais recente do ADMIN (os anteriores foram substituídos).
    left join lateral (
      select x as inv from public.space_invites x
      where x.space_id = s.id and x.role = 'ADMIN' and x.email = s.admin_email
      -- O atual é o que não foi substituído (data empata na mesma transação).
      order by (x.superseded_at is null) desc, x.created_at desc
      limit 1
    ) l on true
    order by s.created_at desc;
end;
$$;

create or replace function public.platform_overview()
returns table (active_spaces integer, suspended_spaces integer, pending_setup integer, users integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_super_admin() then
    raise exception 'Somente a administração da plataforma.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select (select count(*)::int from public.spaces where status = 'active'),
           (select count(*)::int from public.spaces where status = 'suspended'),
           (select count(*)::int from public.spaces where setup_completed_at is null),
           (select count(*)::int from public.profiles);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Convite de espaço: reenviar substitui o anterior
-- ---------------------------------------------------------------------------
create or replace function public.create_space_invite(
  p_space_id uuid,
  p_email    extensions.citext,
  p_role     public.space_role
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email extensions.citext := lower(btrim(p_email));
  v_id    uuid;
begin
  if not app.is_space_admin(p_space_id) then
    raise exception 'Apenas ADMIN do espaço pode convidar usuários.'
      using errcode = 'insufficient_privilege';
  end if;
  if exists (
    select 1
    from public.space_members sm
    join public.profiles p on p.id = sm.profile_id
    where sm.space_id = p_space_id and sm.status = 'active' and p.email = v_email
  ) then
    raise exception 'Este e-mail já é membro ativo deste espaço.' using errcode = 'unique_violation';
  end if;

  -- Convidar de novo o mesmo e-mail = reenviar: só o link novo vale.
  perform app.supersede_pending_invites(p_space_id, v_email);

  insert into public.space_invites (space_id, email, role, invited_by)
  values (p_space_id, v_email, p_role, (select auth.uid()))
  returning id into v_id;

  perform app.write_audit_log(
    'member.invite', p_space_id, 'space_invite', v_id::text, 'success', 'user',
    null, jsonb_build_object('email', v_email, 'role', p_role), null
  );
  return v_id;
end;
$$;

create or replace function public.reissue_space_invite(p_invite_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v   public.space_invites;
  v_id uuid;
  v_platform boolean;
begin
  select * into v from public.space_invites where id = p_invite_id for update;
  if v.id is null or not app.can_manage_invite(p_invite_id) then
    raise exception 'Convite não encontrado.' using errcode = 'insufficient_privilege';
  end if;
  if v.status = 'accepted' then
    raise exception 'Este convite já foi aceito.' using errcode = 'check_violation';
  end if;
  v_platform := not app.is_space_admin(v.space_id);

  perform app.supersede_pending_invites(v.space_id, v.email);
  -- O convite reenviado pode estar vencido/cancelado e já fora de "pending".
  update public.space_invites
     set superseded_at = coalesce(superseded_at, now()),
         status = case when status = 'pending' then 'cancelled' else status end
   where id = v.id;

  insert into public.space_invites (space_id, email, role, invited_by)
  values (v.space_id, v.email, v.role, (select auth.uid()))
  returning id into v_id;

  perform app.write_audit_log(
    'member.invite', case when v_platform then null else v.space_id end,
    'space_invite', v_id::text, 'success', 'user',
    null, jsonb_build_object('email', v.email, 'role', v.role, 'reenvio', true), null
  );
  return v_id;
end;
$$;

-- Para a Edge Function montar o e-mail: só para quem pode gerir o convite, e
-- só com convite ainda válido. `account` decide o tipo de e-mail (convite do
-- Auth para conta não confirmada; link de acesso para conta confirmada) e
-- `has_password` decide se a tela pede para criar senha — quem abriu um link
-- anterior e fechou sem concluir tem a conta confirmada, mas nunca criou senha.
create or replace function public.invite_delivery_info(p_invite_id uuid)
returns table (email text, role public.space_role, account text, has_password boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.space_invites;
begin
  select * into v from public.space_invites where id = p_invite_id;
  if v.id is null or not app.can_manage_invite(p_invite_id) then
    raise exception 'Convite não encontrado.' using errcode = 'insufficient_privilege';
  end if;
  if app.invite_state(v) not in ('sent', 'opened') then
    raise exception 'Este convite não está mais válido. Reenvie o convite.' using errcode = 'check_violation';
  end if;
  return query
    select v.email::text, v.role,
           case
             when u.id is null then 'none'
             when u.email_confirmed_at is null then 'unconfirmed'
             else 'confirmed'
           end,
           coalesce(p.onboarded_at is not null, false)
    from (select 1) one
    left join auth.users u on lower(u.email) = lower(v.email::text)
    left join public.profiles p on p.id = u.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Quem recebeu o convite: abrir, aceitar, completar o escritório
-- ---------------------------------------------------------------------------
create or replace function public.open_space_invite(p_invite_id uuid)
returns table (state text, role public.space_role, space_id uuid, space_name text, setup_pending boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.space_invites;
  v_state text;
begin
  select * into v from public.space_invites where id = p_invite_id for update;
  if v.id is null or v.email is distinct from app.verified_email() then
    raise exception 'Este convite não é para a sua conta.' using errcode = 'insufficient_privilege';
  end if;

  v_state := app.invite_state(v);
  if v_state in ('sent', 'opened') then
    update public.space_invites set opened_at = coalesce(opened_at, now()) where id = v.id;
    v_state := 'opened';
  end if;

  return query
    select v_state, v.role, s.id, s.name, s.setup_completed_at is null
    from public.spaces s where s.id = v.space_id;
end;
$$;

create or replace function public.accept_space_invite_by_id(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token uuid;
begin
  select token into v_token from public.space_invites where id = p_invite_id;
  if v_token is null then
    raise exception 'Convite não encontrado ou já utilizado.' using errcode = 'no_data_found';
  end if;
  perform public.accept_space_invite(v_token);
end;
$$;

create or replace function public.complete_space_setup(p_space_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_space_admin(p_space_id) then
    raise exception 'Somente o ADMIN do espaço configura o escritório.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_name is null or length(btrim(p_name)) < 2 then
    raise exception 'Informe o nome do escritório.' using errcode = 'check_violation';
  end if;
  update public.spaces
     set name = btrim(p_name), setup_completed_at = coalesce(setup_completed_at, now())
   where id = p_space_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Plataforma sem acesso a perfis alheios
-- ---------------------------------------------------------------------------
drop policy profiles_select_super_admin on public.profiles;
drop policy profiles_update_super_admin on public.profiles;

-- ---------------------------------------------------------------------------
-- 8. Permissões
-- ---------------------------------------------------------------------------
revoke execute on function public.create_space_for_admin(text) from public;
revoke execute on function public.platform_spaces() from public;
revoke execute on function public.platform_overview() from public;
revoke execute on function public.reissue_space_invite(uuid) from public;
revoke execute on function public.invite_delivery_info(uuid) from public;
revoke execute on function public.open_space_invite(uuid) from public;
revoke execute on function public.accept_space_invite_by_id(uuid) from public;
revoke execute on function public.complete_space_setup(uuid, text) from public;
grant execute on function public.create_space_for_admin(text) to authenticated;
grant execute on function public.platform_spaces() to authenticated;
grant execute on function public.platform_overview() to authenticated;
grant execute on function public.reissue_space_invite(uuid) to authenticated;
grant execute on function public.invite_delivery_info(uuid) to authenticated;
grant execute on function public.open_space_invite(uuid) to authenticated;
grant execute on function public.accept_space_invite_by_id(uuid) to authenticated;
grant execute on function public.complete_space_setup(uuid, text) to authenticated;
