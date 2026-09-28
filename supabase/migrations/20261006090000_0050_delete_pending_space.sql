-- =============================================================================
-- 0050 — Excluir escritório que ainda aguarda configuração (P12).
--
-- A plataforma pode apagar de vez um escritório cujo ADMIN nunca aceitou o
-- convite (setup_completed_at nulo): ninguém entrou e não há dado dele. O
-- convite deixa de valer junto. Escritório já configurado não é excluído —
-- só suspenso.
--
-- A auditoria é histórica e append-only: ela não pode depender da existência
-- do espaço. A chave estrangeira de audit_logs.space_id sai (o "on delete set
-- null" viraria um UPDATE, que a própria auditoria proíbe); os registros
-- guardam o id original.
-- =============================================================================

alter table public.audit_logs drop constraint if exists audit_logs_space_id_fkey;

comment on column public.audit_logs.space_id is
  'Espaço do evento (histórico: pode apontar para um espaço já excluído).';

create or replace function public.platform_delete_pending_space(p_space_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space public.spaces;
begin
  perform app.require_super_admin();

  select * into v_space from public.spaces where id = p_space_id for update;
  if v_space.id is null then
    raise exception 'Escritório não encontrado.' using errcode = 'no_data_found';
  end if;
  if v_space.setup_completed_at is not null then
    raise exception 'Só é possível excluir escritório aguardando configuração. Escritório configurado pode ser suspenso.'
      using errcode = 'check_violation';
  end if;

  -- Os registros em cascata (convite, listas padrão) não são ação de ninguém:
  -- a exclusão é auditada uma vez, como ação da plataforma.
  set local app.skip_row_audit = 'on';
  delete from public.spaces where id = p_space_id;
  perform set_config('app.skip_row_audit', 'off', true);

  perform app.write_audit_log(
    'space.delete', null, 'space', p_space_id::text, 'success', 'user',
    jsonb_build_object('name', v_space.name, 'admin_email', v_space.admin_email,
      'created_at', v_space.created_at),
    null, jsonb_build_object('reason', 'pending_setup')
  );
end;
$$;

revoke execute on function public.platform_delete_pending_space(uuid) from public;
grant execute on function public.platform_delete_pending_space(uuid) to authenticated;
