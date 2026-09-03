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
