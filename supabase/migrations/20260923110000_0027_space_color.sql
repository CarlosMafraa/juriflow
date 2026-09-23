-- =============================================================================
-- 0027 — cor decorativa do espaço (identificação visual no seletor/topbar).
-- Não é tema (não muda cores do PrimeNG) — só uma bolinha/etiqueta.
-- =============================================================================

alter table public.spaces
  add column color text not null default '#2563eb',
  add constraint spaces_color_format_chk check (color ~ '^#[0-9a-fA-F]{6}$');

comment on column public.spaces.color is
  'Cor decorativa (hex) para identificar o espaço na UI — seletor de espaço, topbar. Não afeta o tema do app.';
