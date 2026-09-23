-- =============================================================================
-- 0021 — auditoria de space_members (papel/status). Faltava desde a Fase 2:
-- `member.role.update` / `member.deactivate` / `member.reactivate` já existiam
-- no catálogo (packages/domain) mas nenhum gatilho os disparava.
-- accept_space_invite usa skip_row_audit e loga 'member.accept' explicitamente
-- (0020) — este gatilho não deve duplicar aquele evento.
-- =============================================================================

create or replace function app.audit_space_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
  d record;
begin
  if app._audit_skip() then return null; end if;

  if new.role is distinct from old.role then
    v_action := 'member.role.update';
  elsif new.status is distinct from old.status then
    v_action := case
      when new.status = 'disabled' then 'member.deactivate'
      when new.status = 'active' and old.status = 'disabled' then 'member.reactivate'
      else null
    end;
  end if;

  if v_action is null then
    return null;
  end if;

  select * into d from app.audit_diff(to_jsonb(old), to_jsonb(new));
  perform app.write_audit_log(v_action, new.space_id, 'space_member', new.id::text,
    'success', app._audit_actor(), d.before, d.after, null);
  return null;
end;
$$;

create trigger zz_audit_space_members
  after update on public.space_members
  for each row execute function app.audit_space_members();
