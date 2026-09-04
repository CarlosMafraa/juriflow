-- Seed local (opcional). Executado após as migrations em `supabase db reset`.
--
-- A fundação não tem dados de negócio para semear. Usuários exigem o serviço de
-- Auth (criados via signup/painel), portanto não são semeados aqui.

-- ---------------------------------------------------------------------------
-- Fase 3: catálogo mínimo de tribunais para desenvolvimento local.
-- NÃO é a sincronização com o DataJud (fase futura) — apenas alguns registros
-- para o app ser utilizável. Idempotente por (name, jurisdiction).
-- ---------------------------------------------------------------------------
insert into public.courts (name, type, jurisdiction) values
  ('Supremo Tribunal Federal', 'STF', 'nacional'),
  ('Superior Tribunal de Justiça', 'STJ', 'nacional'),
  ('Tribunal Superior do Trabalho', 'TST', 'trabalhista'),
  ('Tribunal de Justiça do Amazonas', 'TJ', 'AM'),
  ('Tribunal de Justiça de São Paulo', 'TJ', 'SP'),
  ('Tribunal de Justiça do Rio de Janeiro', 'TJ', 'RJ'),
  ('Tribunal Regional Federal da 1ª Região', 'TRF', 'federal'),
  ('Tribunal Regional do Trabalho da 11ª Região', 'TRT', 'AM')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Acompanhamento-B: estratégia de acompanhamento DataJud para o TJAM.
-- Somente o TJAM. `alias` = índice da API Pública do DataJud (CNJ).
-- NENHUM segredo aqui — a API key vai nos secrets da Edge Function.
-- Em produção o SUPER_ADMIN cadastra a estratégia pela administração.
-- ---------------------------------------------------------------------------
insert into public.court_tracking_strategies
  (court_id, source_kind, priority, params, requires_cnj, enabled)
select c.id,
       'datajud',
       10,
       jsonb_build_object('alias', 'api_publica_tjam', 'timeout_ms', 30000, 'max_movements', 5000),
       true,
       true
from public.courts c
where c.name = 'Tribunal de Justiça do Amazonas'
  and c.jurisdiction = 'AM'
on conflict (court_id, source_kind) do nothing;
