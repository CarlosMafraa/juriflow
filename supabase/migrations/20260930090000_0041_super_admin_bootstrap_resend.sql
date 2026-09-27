-- =============================================================================
-- 0041 — Reenvio do link do SUPER_ADMIN pelo comando de bootstrap.
--
-- O link do convite vale 24 h. Se o SUPER_ADMIN ainda não concluiu o
-- primeiro acesso (profiles.onboarded_at nulo), rodar o comando de novo com o
-- MESMO e-mail envia um link novo (o anterior deixa de valer) e fica na
-- auditoria. Outro e-mail, ou depois do primeiro acesso: sempre recusado.
-- =============================================================================
create or replace function public.bootstrap_super_admin(p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_current public.profiles%rowtype;
  v_id uuid;
begin
  select * into v_current from public.profiles where is_super_admin;

  if found then
    if lower(v_current.email) = v_email and v_current.onboarded_at is null then
      perform app.write_audit_log(
        'platform.super_admin.invite_resent', null, 'profile', v_current.id::text, 'success',
        'system', null, jsonb_build_object('email', v_email), jsonb_build_object('via', 'bootstrap')
      );
      return v_current.id;
    end if;
    raise exception 'Já existe um SUPER_ADMIN. A plataforma tem um único administrador.'
      using errcode = 'check_violation';
  end if;

  select u.id into v_id from auth.users u where lower(u.email) = v_email;
  if v_id is null then
    raise exception 'Conta % não encontrada. Convide o e-mail antes de promovê-lo.', p_email
      using errcode = 'no_data_found';
  end if;

  update public.profiles set is_super_admin = true where id = v_id;

  perform app.write_audit_log(
    'platform.super_admin.grant', null, 'profile', v_id::text, 'success', 'system',
    null, jsonb_build_object('email', v_email), jsonb_build_object('via', 'bootstrap')
  );
  return v_id;
end;
$$;

revoke all on function public.bootstrap_super_admin(text) from public, anon, authenticated;
grant execute on function public.bootstrap_super_admin(text) to service_role;
