# ADR-0008 — Rate limit de tentativas de login

**Status:** Planejado (implementação pendente) · **Data:** 2026-09-23 · **Fase:** Hardening (`DP-15`)

## Contexto

`RN18` (PLANO-FASE-1 §2.9): segurança não pode depender apenas da interface. Hoje
não há limite de tentativas de autenticação — um ataque de força bruta contra
`/login` pode tentar credenciais indefinidamente. Faltava decidir o parâmetro
concreto (`DP-15`).

## Decisão

- **Limite:** 5 tentativas de login com falha para o mesmo identificador
  (email, e também por IP para cobrir enumeração de contas).
- **Bloqueio:** ao atingir o limite, novas tentativas são recusadas por
  **~15 minutos** (janela deslizante), independente de a credencial estar
  certa ou errada a partir daí.
- **Armazenamento do contador: Redis.** Motivo — o contador precisa de TTL
  automático (expira sozinho após a janela, sem job de limpeza) e de operações
  atômicas de incremento sob concorrência (`INCR` + `EXPIRE`), o que o Postgres
  faria com mais fricção (linha por tentativa, job de limpeza, lock). Chave
  sugerida: `login_attempts:{email}` e `login_attempts:ip:{ip}`, valor =
  contador, TTL = 15min, resetado no login bem-sucedido.
- **Onde aplica:** antes de chamar `supabase.auth.signInWithPassword` — em uma
  camada de API própria (Edge Function ou middleware), nunca só no Angular
  (RN18). O Supabase Auth já tem alguma proteção própria, mas o limite de
  negócio (5/15min, mensagem ao usuário) é responsabilidade nossa.
- **Resposta ao usuário:** mensagem genérica ("muitas tentativas, aguarde
  alguns minutos") sem revelar se o e-mail existe ou não (evita enumeração).
- **Auditoria:** tentativas bloqueadas por rate limit geram `audit_logs` com
  `action='auth.login'`, `result='failure'`, `context` indicando
  `reason: 'rate_limited'`.

## Consequências

- Precisa de uma instância Redis acessível pelo backend (Edge
  Function/worker) — decisão de hospedagem (gerenciado vs. container na
  mesma VPS do WAHA/scraper-worker) fica para a implementação, não faz parte
  desta ADR.
- Login legítimo após 5 erros de digitação passa a esperar até 15 minutos;
  aceitável para o caso de uso (RN18 > conveniência).
- **Não implementado ainda** — este ADR registra a decisão de parâmetros e
  mecanismo para quando a fase de hardening (`item 16` do roadmap) for
  executada.
