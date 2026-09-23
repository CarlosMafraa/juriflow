-- =============================================================================
-- 0025 — cobre DELETE em process_notification_configs (0024 só tinha
-- insert/update). "Voltar ao padrão do espaço" remove a linha e isso também é
-- uma alteração de configuração de acompanhamento que deve ficar na auditoria
-- (RN seção 19).
-- =============================================================================

create or replace function app.audit_process_notification_configs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  d record;
begin
  if tg_op = 'DELETE' then
    perform app.write_audit_log('notification_config.process.delete', old.space_id,
      'process_notification_config', old.process_id::text, 'success', app._audit_actor(),
      to_jsonb(old), null, jsonb_build_object('process_id', old.process_id));
    return null;
  end if;

  if tg_op = 'INSERT' then
    perform app.write_audit_log('notification_config.process.create', new.space_id,
      'process_notification_config', new.process_id::text, 'success', app._audit_actor(),
      null, to_jsonb(new), jsonb_build_object('process_id', new.process_id));
    return null;
  end if;

  select * into d from app.audit_diff(to_jsonb(old), to_jsonb(new));
  perform app.write_audit_log('notification_config.process.update', new.space_id,
    'process_notification_config', new.process_id::text, 'success', app._audit_actor(),
    d.before, d.after, jsonb_build_object('process_id', new.process_id));
  return null;
end;
$$;

drop trigger if exists zz_audit_process_notification_configs on public.process_notification_configs;
create trigger zz_audit_process_notification_configs
  after insert or update or delete on public.process_notification_configs
  for each row execute function app.audit_process_notification_configs();
