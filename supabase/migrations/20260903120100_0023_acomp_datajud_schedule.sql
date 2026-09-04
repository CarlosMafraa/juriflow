-- 0023 · Acompanhamento-B · Agendamento do runtime DataJud (pg_cron + pg_net)
--
-- ADITIVO e GUARDADO. Não cria tabelas, não altera RLS, `processes`, `courts`,
-- as RPCs da Acompanhamento-A nem o comportamento do motor. O agendador apenas
-- ACIONA a Edge Function `collector-datajud` a cada ~5 min; toda a lógica de
-- coleta continua fora do banco (adapter + Edge Function).
--
-- A URL da função e o segredo de invocação NÃO ficam em migration/código/banco:
-- são lidos de GUCs de banco definidos pela operação (fora do controle de versão):
--
--   alter database postgres set app.collector_datajud_url = 'https://<ref>.supabase.co/functions/v1/collector-datajud';
--   alter database postgres set app.collector_invoke_secret = '<segredo forte>';
--
-- Enquanto a GUC `app.collector_datajud_url` estiver vazia (ex.: ambiente local
-- sem deploy, banco de testes), o job é um no-op — seguro para `db reset`/pgTAP.

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then

    create extension if not exists pg_cron;
    create extension if not exists pg_net;

    perform cron.unschedule('juriflow-collector-datajud')
    where exists (select 1 from cron.job where jobname = 'juriflow-collector-datajud');

    perform cron.schedule(
      'juriflow-collector-datajud',
      '*/5 * * * *',
      $cron$
      do $inner$
      declare
        v_url text := coalesce(current_setting('app.collector_datajud_url', true), '');
        v_secret text := coalesce(current_setting('app.collector_invoke_secret', true), '');
      begin
        if length(v_url) = 0 then
          return; -- sem destino configurado: no-op
        end if;
        perform net.http_post(
          url     := v_url,
          headers := jsonb_build_object(
                       'Content-Type', 'application/json',
                       'Authorization', 'Bearer ' || v_secret
                     ),
          body    := '{}'::jsonb,
          timeout_milliseconds := 60000
        );
      end
      $inner$;
      $cron$
    );
  else
    raise notice 'pg_cron/pg_net indisponível — acione a Edge Function collector-datajud manualmente.';
  end if;
exception when others then
  raise notice 'Não foi possível agendar o runtime DataJud: %', sqlerrm;
end;
$$;
