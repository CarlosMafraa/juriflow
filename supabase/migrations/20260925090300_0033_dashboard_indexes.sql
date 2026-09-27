-- =============================================================================
-- 0033 — Índices das consultas do dashboard (contagens por espaço e janela de
-- tempo). Sem eles, cada abertura do dashboard varre as tabelas de coleta e
-- envio do espaço inteiro — que crescem todo dia.
-- =============================================================================

create index process_movements_space_collected_idx
  on public.process_movements (space_id, collected_at desc);

create index notification_deliveries_space_created_idx
  on public.notification_deliveries (space_id, created_at desc);

create index processes_space_check_error_idx
  on public.processes (space_id)
  where last_check_error is not null and deleted_at is null;
