-- 0022 · Acompanhamento-B · Subconjunto curado da taxonomia de movimentos (TPU/CNJ)
--
-- ADITIVO. Apenas `insert ... on conflict do nothing` em `public.movement_categories`.
-- Não altera estrutura de tabela, RLS, `processes` nem `courts`.
--
-- DJ-4: este é um subconjunto PROVISÓRIO de códigos recorrentes da Tabela
-- Processual Unificada. A carga completa da TPU (com hierarquia `parent_code`)
-- fica para a Fase 4, a partir do export oficial do SGT/CNJ. Um código do
-- DataJud fora desta lista degrada de forma graciosa: a movimentação é
-- persistida com `needs_review = true` (nunca é descartada nem "inventada").

insert into public.movement_categories (code, label) values
  ('22',    'Redistribuição'),
  ('970',   'Concentração de atos processuais (audiência una)'),
  ('861',   'Expedição de carta'),
  ('12252', 'Decurso de prazo')
on conflict (code) do nothing;

comment on table public.movement_categories is
  'Categorias de movimentação (TPU/CNJ). Subconjunto curado provisório (Acompanhamento-A/B); carga completa da TPU na Fase 4.';
