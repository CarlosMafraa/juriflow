-- =============================================================================
-- 0038 — Séries dos gráficos do dashboard, agregadas no banco (o navegador
-- recebe 30 linhas, não milhares de movimentações). Dias e meses no fuso de
-- Manaus, o mesmo da rotina diária.
-- =============================================================================

-- Movimentações coletadas por dia. SECURITY INVOKER de propósito: a RLS de
-- process_movements vale para quem chama — o ADMIN conta o espaço inteiro, o
-- colaborador só os processos em que é responsável.
create or replace function public.space_movements_per_day(p_space_id uuid, p_days integer default 30)
returns table (day date, total integer)
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select least(greatest(coalesce(p_days, 30), 1), 90) as n,
           (now() at time zone 'America/Manaus')::date as today
  ),
  days as (
    select b.today - g as day
    from bounds b, generate_series(0, (select n from bounds) - 1) g
  )
  select d.day, count(m.id)::int
  from days d
  left join public.process_movements m
    on m.space_id = p_space_id
   and m.collected_at >= now() - make_interval(days => (select n from bounds) + 1)
   and (m.collected_at at time zone 'America/Manaus')::date = d.day
  group by d.day
  order by d.day;
$$;

revoke execute on function public.space_movements_per_day(uuid, integer) from public;
grant execute on function public.space_movements_per_day(uuid, integer) to authenticated;

-- Crescimento da plataforma por mês: só contagens de espaços e contas — nada
-- de dentro dos espaços. Só SUPER_ADMIN.
create or replace function public.platform_growth(p_months integer default 6)
returns table (month date, new_spaces integer, new_users integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_n integer := least(greatest(coalesce(p_months, 6), 1), 24);
begin
  if not app.is_super_admin() then
    raise exception 'Somente a administração da plataforma vê o crescimento da plataforma.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    with months as (
      select (date_trunc('month', now() at time zone 'America/Manaus')
              - make_interval(months => g))::date as month
      from generate_series(0, v_n - 1) g
    )
    select m.month,
           (select count(*)::int from public.spaces s
             where date_trunc('month', s.created_at at time zone 'America/Manaus')::date = m.month),
           (select count(*)::int from public.profiles p
             where date_trunc('month', p.created_at at time zone 'America/Manaus')::date = m.month)
    from months m
    order by m.month;
end;
$$;

revoke execute on function public.platform_growth(integer) from public;
grant execute on function public.platform_growth(integer) to authenticated;
