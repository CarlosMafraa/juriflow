-- =============================================================================
-- 0029 — segunda cor do espaço. Junto com `color` (migração 0027), agora
-- dirige de verdade o tema (cor primária/secundária de botões etc via
-- updatePrimaryPalette no frontend) — não é mais só decorativo.
-- =============================================================================

alter table public.spaces
  add column secondary_color text not null default '#64748b',
  add constraint spaces_secondary_color_format_chk check (secondary_color ~ '^#[0-9a-fA-F]{6}$');

comment on column public.spaces.secondary_color is
  'Cor secundária (hex) — acentos de UI (ex.: item ativo da sidebar). Junto com color, define o tema do espaço.';
