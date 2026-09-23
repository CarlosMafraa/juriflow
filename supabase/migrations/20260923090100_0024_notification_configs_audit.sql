-- =============================================================================
-- 0024 — auditoria de message_templates, space_notification_configs e
-- process_notification_configs (mesmo padrão de app.audit_diff / write_audit_log
-- já usado em 0014/0018/0021).
-- =============================================================================

create or replace function app.audit_message_templates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  d record;
begin
  if tg_op = 'INSERT' then
    perform app.write_audit_log('template.create', new.space_id, 'message_template', new.id::text,
      'success', app._audit_actor(), null, to_jsonb(new), null);
    return null;
  end if;

  if tg_op = 'DELETE' then
    perform app.write_audit_log('template.delete', old.space_id, 'message_template', old.id::text,
      'success', app._audit_actor(), to_jsonb(old), null, null);
    return null;
  end if;

  select * into d from app.audit_diff(to_jsonb(old), to_jsonb(new));
  perform app.write_audit_log('template.update', new.space_id, 'message_template', new.id::text,
    'success', app._audit_actor(), d.before, d.after, null);
  return null;
end;
$$;

create trigger zz_audit_message_templates
  after insert or update or delete on public.message_templates
  for each row execute function app.audit_message_templates();

create or replace function app.audit_space_notification_configs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  d record;
begin
  if tg_op = 'INSERT' then
    perform app.write_audit_log('notification_config.space.create', new.space_id,
      'space_notification_config', new.space_id::text, 'success', app._audit_actor(),
      null, to_jsonb(new), null);
    return null;
  end if;

  select * into d from app.audit_diff(to_jsonb(old), to_jsonb(new));
  perform app.write_audit_log('notification_config.space.update', new.space_id,
    'space_notification_config', new.space_id::text, 'success', app._audit_actor(),
    d.before, d.after, null);
  return null;
end;
$$;

create trigger zz_audit_space_notification_configs
  after insert or update on public.space_notification_configs
  for each row execute function app.audit_space_notification_configs();

create or replace function app.audit_process_notification_configs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  d record;
begin
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

create trigger zz_audit_process_notification_configs
  after insert or update on public.process_notification_configs
  for each row execute function app.audit_process_notification_configs();
