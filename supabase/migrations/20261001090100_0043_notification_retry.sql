-- =============================================================================
-- 0043 — Reenvio de avisos que falharam (regra N7).
--
-- Antes, um aviso que falhava (WhatsApp desconectado, número em formato que o
-- WhatsApp não reconhece...) nunca mais era tentado: a movimentação já estava
-- gravada e só movimentação NOVA disparava envio. Agora cada consulta do
-- processo tenta de novo os avisos com falha, até um limite de tentativas,
-- sem nunca reenviar o que já foi entregue.
-- =============================================================================
alter table public.notification_deliveries
  add column attempts integer not null default 1,
  add constraint notification_deliveries_attempts_chk check (attempts >= 1);

comment on column public.notification_deliveries.attempts is
  'Quantas vezes o envio foi tentado. Falha com attempts abaixo do limite do worker é reenviada na próxima consulta.';

create index notification_deliveries_failed_idx
  on public.notification_deliveries (process_id)
  where status = 'failed';
