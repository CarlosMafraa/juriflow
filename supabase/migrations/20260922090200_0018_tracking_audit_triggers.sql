-- =============================================================================
-- 0018 — MVP Acompanhamento: auditoria de process_movements e notification_deliveries
-- (reusa app.write_audit_log/app._audit_actor/app.audit_diff — infra da Fase 2/3).
-- O worker roda com service_role (sem auth.uid()) ⇒ app._audit_actor() = 'system'.
-- =============================================================================

create or replace function app.audit_process_movements()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.write_audit_log('process.movement.collected', new.space_id, 'process_movement',
    new.id::text, 'success', app._audit_actor(), null, to_jsonb(new),
    jsonb_build_object('process_id', new.process_id, 'source_kind', new.source_kind));
  return null;
end;
$$;

create trigger zz_audit_process_movements
  after insert on public.process_movements
  for each row execute function app.audit_process_movements();

create or replace function app.audit_notification_deliveries()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
  d record;
begin
  v_action := case when new.status = 'sent' then 'notification.delivery.sent'
                   else 'notification.delivery.failed' end;

  if tg_op = 'INSERT' then
    perform app.write_audit_log(v_action, new.space_id, 'notification_delivery', new.id::text,
      'success', app._audit_actor(), null, to_jsonb(new),
      jsonb_build_object('process_id', new.process_id, 'movement_id', new.movement_id));
    return null;
  end if;

  select * into d from app.audit_diff(to_jsonb(old), to_jsonb(new));
  perform app.write_audit_log(v_action, new.space_id, 'notification_delivery', new.id::text,
    'success', app._audit_actor(), d.before, d.after,
    jsonb_build_object('process_id', new.process_id, 'movement_id', new.movement_id));
  return null;
end;
$$;

create trigger zz_audit_notification_deliveries
  after insert or update on public.notification_deliveries
  for each row execute function app.audit_notification_deliveries();
