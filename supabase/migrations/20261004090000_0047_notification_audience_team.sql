-- =============================================================================
-- 0047 — Valores novos de enum: público "team" (equipe do escritório) dos
-- templates de aniversário e status "skipped" de envio. Em migration própria:
-- valor novo de enum só pode ser usado depois do commit da transação que o
-- criou (a 0048 usa).
-- =============================================================================
alter type public.notification_audience add value if not exists 'team';

-- Envio "já informado": na 1ª sincronização de processo que tinha
-- movimentações manuais, o histórico do tribunal é registrado sem aviso (0048).
alter type public.notification_delivery_status add value if not exists 'skipped';
