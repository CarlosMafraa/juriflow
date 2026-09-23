-- =============================================================================
-- 0019 — space_invites: convite por e-mail a um espaço (Equipe).
-- Independente de `space_members.status = 'invited'` (Fase 2): aquele valor
-- pressupõe um profile_id já conhecido. Convite por e-mail precisa funcionar
-- mesmo quando a pessoa convidada ainda não tem conta — por isso vive numa
-- tabela própria e só se torna `space_members` no aceite (0020).
-- =============================================================================

create type public.space_invite_status as enum ('pending', 'accepted', 'cancelled', 'expired');

create table public.space_invites (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references public.spaces (id) on delete cascade,
  email       extensions.citext not null,
  role        public.space_role not null,
  status      public.space_invite_status not null default 'pending',
  token       uuid not null default gen_random_uuid(),
  invited_by  uuid not null references public.profiles (id) on delete restrict,
  expires_at  timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  constraint space_invites_email_not_blank_chk check (length(btrim(email::text)) > 0)
);

comment on table public.space_invites is
  'Convite por e-mail a um espaço. Escrita só via RPCs (app.create_space_invite/accept_space_invite/cancel_space_invite) — nunca INSERT/UPDATE direto.';

create unique index space_invites_token_uniq on public.space_invites (token);
-- Só 1 convite pendente por (espaço, e-mail) — nova tentativa deve cancelar o anterior.
create unique index space_invites_pending_uniq
  on public.space_invites (space_id, email)
  where status = 'pending';
create index space_invites_pending_email_idx on public.space_invites (email) where status = 'pending';
create index space_invites_space_status_idx on public.space_invites (space_id, status);

create trigger space_invites_set_updated_at
  before update on public.space_invites
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: ADMIN do espaço (ou SUPER_ADMIN) lê os convites do próprio espaço.
-- O convidado (ainda sem vínculo) usa app.my_pending_invites() — security
-- definer — em vez de SELECT direto nesta tabela.
-- ---------------------------------------------------------------------------
alter table public.space_invites enable row level security;
alter table public.space_invites force row level security;

create policy space_invites_select
  on public.space_invites for select
  to authenticated
  using (app.is_super_admin() or app.is_space_admin(space_id));

grant select on public.space_invites to authenticated;
revoke insert, update, delete on public.space_invites from authenticated, anon;
