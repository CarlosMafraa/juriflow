-- =============================================================================
-- 0034 — Novo motivo de período de responsabilidade: 'added' (ADMIN acrescenta
-- um responsável a um processo que já existe). Em arquivo próprio porque um
-- valor novo de enum só pode ser usado depois que a transação que o cria faz
-- commit (usado pela 0037).
-- =============================================================================

alter type public.responsibility_reason add value if not exists 'added';
