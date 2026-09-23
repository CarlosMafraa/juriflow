-- =============================================================================
-- 0020 — RPCs de convite (public, SECURITY DEFINER) — mesmo estilo da 0015.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- create_space_invite — ADMIN convida um e-mail para o espaço.
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
  v_email extensions.citext := trim(p_email);
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

  if exists (
    select 1 from public.space_invites
    where space_id = p_space_id and email = v_email and status = 'pending'
  ) then
    raise exception 'Já existe um convite pendente para este e-mail.' using errcode = 'unique_violation';
  end if;

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

-- ---------------------------------------------------------------------------
-- my_pending_invites — convites pendentes para o e-mail do usuário autenticado.
-- ---------------------------------------------------------------------------
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
  join public.profiles me on me.id = (select auth.uid())
  where si.status = 'pending'
    and si.expires_at > now()
    and si.email = me.email;
$$;

-- ---------------------------------------------------------------------------
-- accept_space_invite — o convidado aceita e passa a ser space_members ativo.
-- ---------------------------------------------------------------------------
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

  select email into v_my_email from public.profiles where id = (select auth.uid());
  if v_my_email is distinct from v_invite.email then
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

-- ---------------------------------------------------------------------------
-- cancel_space_invite — ADMIN cancela um convite ainda pendente.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_space_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space  uuid;
  v_status public.space_invite_status;
begin
  select space_id, status into v_space, v_status
    from public.space_invites where id = p_invite_id for update;

  if v_space is null then
    raise exception 'Convite não encontrado.' using errcode = 'no_data_found';
  end if;
  if not app.is_space_admin(v_space) then
    raise exception 'Apenas ADMIN do espaço pode cancelar convites.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_status <> 'pending' then
    raise exception 'Este convite não está mais pendente.' using errcode = 'check_violation';
  end if;

  update public.space_invites set status = 'cancelled' where id = p_invite_id;

  perform app.write_audit_log(
    'member.invite.cancel', v_space, 'space_invite', p_invite_id::text, 'success', 'user',
    null, null, null
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------------
revoke execute on function public.create_space_invite(uuid, extensions.citext, public.space_role) from public;
revoke execute on function public.my_pending_invites() from public;
revoke execute on function public.accept_space_invite(uuid) from public;
revoke execute on function public.cancel_space_invite(uuid) from public;
grant execute on function public.create_space_invite(uuid, extensions.citext, public.space_role) to authenticated;
grant execute on function public.my_pending_invites() to authenticated;
grant execute on function public.accept_space_invite(uuid) to authenticated;
grant execute on function public.cancel_space_invite(uuid) to authenticated;
