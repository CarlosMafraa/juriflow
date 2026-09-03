# JuriFlow — Fase 2.1: Resolução das Decisões Pendentes

> **Escopo desta etapa:** apenas análise. Nenhum código foi alterado, nenhuma migration
> criada, nenhuma RLS modificada, nenhuma decisão de produto tomada. A Fase 3 não foi
> iniciada.
> **Data:** 2026-09-02
> **Objetivo:** fechar as decisões que precisam estar definidas antes de modelar
> `processes`, `clients`, `process_clients` (e o mínimo de `courts`) na Fase 3.

---

## Como ler este documento

Cada decisão segue o formato pedido. No fim há:

- a **lista de decisões críticas** (bloqueiam a Fase 3),
- as **decisões adiáveis** (com o motivo),
- o **alerta de retrabalho** (o que, se adiado, gera migration destrutiva ou reescrita de
  RLS/relacionamento),
- o **checklist final** de perguntas a responder.

Marcação de risco em cada decisão crítica:

| Marca | Significado |
|---|---|
| 🔴 **Retrabalho alto** | adiar gera migration destrutiva, backfill obrigatório ou reescrita de RLS já testada |
| 🟠 **Retrabalho médio** | adiar gera limpeza manual de dados ou revisão de várias políticas/telas |
| 🟢 **Sem retrabalho** | adiar é só trocar uma política/allowlist; decidir agora é só para não travar a Fase 3 |

---

# PARTE 1 — DECISÕES CRÍTICAS (antes da Fase 3)

---

## PP-01 — SUPER_ADMIN é sempre global, nunca membro de um espaço? · 🟢

**O que precisa ser decidido:**
O SUPER_ADMIN é exclusivamente um papel de plataforma (atributo da conta) e **nunca**
aparece como membro de um espaço? Ou pode existir a situação de um SUPER_ADMIN também ser
ADMIN/COLABORADOR de um espaço específico (uma linha em `space_members`)?

**Por que isso importa:**
Define o padrão de RLS de **todas** as tabelas operacionais que a Fase 3 vai criar. Se o
SUPER_ADMIN nunca é membro, as políticas dessas tabelas simplesmente não concedem acesso a
ele (RN7 — sem conteúdo operacional). Se ele pudesse ser membro, cada política precisaria
distinguir "SUPER_ADMIN agindo como membro daquele espaço" de "SUPER_ADMIN global".

**Impacto técnico:**
RLS (padrão de processos, clientes, movimentações, regras, deliveries…), backend, frontend
(seletor de espaço, badge de papel). **Não** altera schema.

**Opção A — SUPER_ADMIN estritamente global, nunca em `space_members`** (é o que a Fase 2
implementou).
**Prós:** políticas operacionais uniformes e simples; RN7 fica à prova de erro (nenhuma
policy operacional menciona SUPER_ADMIN); impossível vazar conteúdo por engano.
**Contras:** quem for dono da plataforma **e** advogado atuante em um escritório precisa de
uma segunda conta (perfil separado) para operar nesse espaço.

**Opção B — SUPER_ADMIN pode adicionalmente ser membro de espaços.**
**Prós:** uma conta só para quem acumula os dois papéis.
**Contras:** toda política operacional ganha lógica extra; risco alto de RN7 ser violado por
engano; auditoria e "agir como" ficam ambíguos; mais superfície de teste.

**Sua recomendação técnica:**
Opção A. É o que já está construído e testado, mantém RN7 à prova de erro, e o caso
"dono da plataforma que também advoga" é raro e resolvido com uma conta operacional
separada. Custo de reverter para B no futuro é baixo (é só padrão de policy), então não há
pressa em considerar B.

**Decisão do produto:** `AGUARDANDO DECISÃO DO USUÁRIO`

---

## PP-02 — Acesso do ex-responsável após transferência + tabela de histórico de responsabilidade · 🔴

**O que precisa ser decidido:**
Quando um processo é transferido de um COLABORADOR para outro responsável, o COLABORADOR
anterior:
1. **perde todo o acesso** ao processo imediatamente; ou
2. mantém acesso **somente-leitura** ao processo e às movimentações **até a data da
   transferência**; ou
3. mantém acesso **somente-leitura total** enquanto o processo existir.

E, decorrente disso: o sistema deve manter uma tabela de **histórico de responsáveis**
(`process_responsible_history`) desde a Fase 3?

**Por que isso importa:**
RN3 diz que a transferência "preserva histórico" e RN5 diz que o COLABORADOR só vê processos
onde é o **responsável atual**. O que "preserva histórico" significa em termos de *acesso*
muda a modelagem: se o ex-responsável puder ver o que já foi dele, a RLS de `processes` e
(na Fase 8) de `process_movements` deixa de ser `responsible_id = auth.uid()` e passa a
consultar uma tabela de períodos de responsabilidade.

**Impacto técnico:**
Banco (tabela `process_responsible_history`), RLS (`processes` agora, `process_movements`
na Fase 8), backend (RPC de transferência grava o período), frontend (badge "ex-responsável",
somente-leitura). **É a decisão de maior risco desta lista:** adicionar a tabela e a lógica
de janela temporal depois obriga a **backfill** (a partir dos `audit_logs` de transferência)
e a **reescrever a RLS de movimentações já testada**.

**Opção A — Transferência = perda total de acesso. RLS permanece `responsible_id = auth.uid()`.
O "histórico" vive apenas em `audit_logs`; sem tabela dedicada.**
**Prós:** RLS mínima e mais segura; Fase 3 mais enxuta; `audit_logs` já registra de quem
para quem e quando.
**Contras:** um COLABORADOR que precise consultar o que fez antes da transferência não
consegue pela aplicação (só via ADMIN ou trilha de auditoria).

**Opção B — Criar `process_responsible_history` desde a Fase 3 e conceder ao ex-responsável
acesso somente-leitura às movimentações até a data em que deixou de ser responsável
(comportamento 2).**
**Prós:** atende a continuidade real do trabalho do advogado; "preserva histórico" no
sentido forte; a tabela também é a base para relatório de produtividade por responsável.
**Contras:** RLS de `process_movements` com janela temporal por período; mais superfície de
teste; risco de isolamento se a janela for mal implementada; a UI precisa explicar o
"somente-leitura".

**Sua recomendação técnica:**
**Criar a tabela `process_responsible_history` já na Fase 3** (custo baixo agora, retrabalho
alto depois), mas adotar o **comportamento da Opção A** por ora (transferência = perda de
acesso; período apenas registrado). Com a tabela existente, migrar para o comportamento 2
depois é **só uma policy nova**, sem migration destrutiva. Ou seja: **modelar para o futuro,
restringir o comportamento agora.**

**Decisão do produto:** `AGUARDANDO DECISÃO DO USUÁRIO`
_(preciso de duas respostas: (a) comportamento de acesso do ex-responsável — 1, 2 ou 3;
(b) aprovar criar `process_responsible_history` na Fase 3.)_

---

## PP-03 — O COLABORADOR enxerga quais clientes? · 🟢 (mas trava a tela de cadastro de processo)

**O que precisa ser decidido:**
O COLABORADOR vê **(a)** apenas os clientes vinculados a processos onde ele é o responsável
atual, ou **(b)** todos os clientes do espaço (ao menos para leitura/busca)?

**Por que isso importa:**
Define a RLS de `clients`. O brief só define visibilidade de *processos*; clientes são dados
pessoais de terceiros (LGPD), então "quem vê quem" é decisão de produto. Também define se o
COLABORADOR consegue reaproveitar um cliente já cadastrado ao criar um processo (ou acaba
duplicando o cadastro).

**Impacto técnico:**
RLS (`clients`, leitura via `process_clients`), frontend (busca de cliente no cadastro de
processo), LGPD. **Não** altera schema — trocar (a)↔(b) depois é só política, mas muda
comportamento visível.

**Opção A — COLABORADOR vê só os clientes dos seus processos.**
**Prós:** coerente com RN5; minimização de dados pessoais (LGPD).
**Contras:** ao cadastrar um processo, o COLABORADOR não encontra um cliente já existente
que ainda não está vinculado a nenhum processo dele → tende a recadastrar (duplicidade),
a menos que a criação de vínculo permita buscar por documento fora da RLS.

**Opção B — COLABORADOR vê todos os clientes do espaço (leitura); escrita restrita.**
**Prós:** evita duplicação de clientes; cadastro de processo mais simples.
**Contras:** expõe a carteira inteira do escritório a todo colaborador.

**Sua recomendação técnica:**
**Opção B para leitura** (lista/busca de clientes visível a todo membro ativo do espaço),
com **escrita restrita a ADMIN e a quem cadastrou**. A duplicação de cliente é um problema
operacional caro de corrigir; a exposição de "nome + documento" dentro do mesmo escritório é
risco baixo e gerenciável. Se o produto priorizar minimização, a Opção A usa a mesma
modelagem — é só a policy.

**Decisão do produto:** `AGUARDANDO DECISÃO DO USUÁRIO`

---

## DP-35 — SUPER_ADMIN pode listar/gerir `space_members` e ver `profiles`? · 🟢

**O que precisa ser decidido:**
O SUPER_ADMIN pode listar e gerir membros dos espaços e ver perfis de usuários (para
provisionar um espaço novo e designar o 1º ADMIN)? Ou o provisionamento é feito por um fluxo
de convite que o próprio destinatário aceita, sem o SUPER_ADMIN ver a lista de membros?

**Por que isso importa:**
É o único ponto em que o SUPER_ADMIN toca dados que não são "só metadados do espaço". A
Fase 2 assumiu **SIM** e já implementou as políticas. Confirmar ou vetar antes de replicar
o padrão nas tabelas da Fase 3.

**Impacto técnico:**
RLS (`space_members`, `profiles`), fluxo de onboarding. **Não** altera schema. Vetar depois
= remover 2 políticas.

**Opção A — SIM (estado atual).** SUPER_ADMIN vê/gerencia `space_members` e vê `profiles`
para bootstrap.
**Prós:** onboarding simples (uma tela: criar espaço + apontar o 1º ADMIN); não exige o
fluxo de convite pronto para o caso mais comum.
**Contras:** SUPER_ADMIN vê nome/e-mail de todos os usuários da plataforma; a lista de
membros de um espaço é "quase" conteúdo operacional.

**Opção B — NÃO.** SUPER_ADMIN cria o espaço "vazio" e envia convite ao futuro ADMIN, que
aceita e passa a gerir os próprios membros. SUPER_ADMIN nunca lista membros nem perfis.
**Prós:** separação mais limpa (RN7 no sentido forte).
**Contras:** exige `user_invitations` + envio de e-mail prontos para o onboarding funcionar.

**Sua recomendação técnica:**
**Opção A agora**, com auditoria de toda ação do SUPER_ADMIN sobre `space_members`/`profiles`.
Desbloqueia o onboarding sem depender do fluxo de convite; migrar para B depois é barato
(remover políticas + ligar o convite). Registrar como "revisável na fase de onboarding".

**Decisão do produto:** `AGUARDANDO DECISÃO DO USUÁRIO`

---

## NEW-1 — `processes.cnj_number` é obrigatório? · 🟠 (era DP-24)

**O que precisa ser decidido:**
É possível cadastrar um processo **sem número CNJ** (processo físico, sigiloso,
pré-distribuição, numeração antiga)?

**Por que isso importa:**
Define se `cnj_number` é `NOT NULL`, se a deduplicação de processo no espaço é feita pelo
CNJ, e se o acompanhamento automático (Fase 7) fica desabilitado quando não há CNJ.

**Impacto técnico:**
Banco (nullability + `unique (space_id, cnj_number)`), backend (validação de máscara CNJ),
frontend, acompanhamento. **Se adiado:** tornar a coluna `NOT NULL` depois exige backfill;
adicionar `unique` depois **falha** se já houver duplicatas.

**Opção A — CNJ obrigatório.**
**Prós:** dedupe trivial; integração DataJud direta; dados limpos.
**Contras:** bloqueia processo físico/sigiloso; força o usuário a inventar um número.

**Opção B — CNJ opcional, único quando presente; processo sem CNJ é válido, com
acompanhamento automático desabilitado; identificação alternativa por `internal_ref`.**
**Prós:** cobre todos os casos reais de um escritório.
**Contras:** dedupe manual para processos sem CNJ; a UI precisa deixar claro que não haverá
coleta automática.

**Sua recomendação técnica:**
Opção B. `cnj_number citext null` + `unique (space_id, cnj_number) where cnj_number is not
null` + `internal_ref text null`. É a modelagem que cobre a realidade e não gera retrabalho.

**Decisão do produto:** `AGUARDANDO DECISÃO DO USUÁRIO`

---

## NEW-2 — `processes.responsible_id` é obrigatório? E quem pode atribuir no cadastro? · 🟠 (PP-11)

**O que precisa ser decidido:**
1. Todo processo tem **sempre** um responsável atual, ou pode existir processo "sem
   responsável" (fila de distribuição)?
2. No cadastro, o COLABORADOR pode apontar **outra pessoa** como responsável, ou o
   responsável inicial é sempre ele mesmo e só o ADMIN atribui a terceiros?

**Por que isso importa:**
(1) define a nullability de `responsible_id` e o comportamento da RLS do COLABORADOR
(processo sem responsável fica invisível a todo COLABORADOR). (2) define o `WITH CHECK` da
política de INSERT de `processes`.

**Impacto técnico:**
Banco (nullability), RLS (INSERT e SELECT de `processes`), backend, frontend. **Se adiado:**
`nullable → NOT NULL` exige backfill.

**Opção A — `responsible_id NOT NULL`. COLABORADOR só cadastra com ele mesmo como
responsável; ADMIN cadastra/atribui a qualquer membro; transferência posterior só ADMIN
(RN4).**
**Prós:** todo processo sempre tem dono; RLS simples; alinhado a RN4.
**Contras:** escritório com "caixa de entrada" de processos não atribuídos precisa de um
usuário genérico como responsável temporário.

**Opção B — `responsible_id` nullable. Processo pode nascer sem responsável (visível só a
ADMIN até ser atribuído); COLABORADOR pode cadastrar já apontando um colega.**
**Prós:** suporta fila de distribuição nativamente.
**Contras:** mais um caso na RLS; risco de processos "órfãos" esquecidos.

**Sua recomendação técnica:**
Opção A, com `responsible_id NOT NULL`. Se o produto quiser fila de distribuição depois,
modela-se com um status `unassigned` + coluna nullable — mas começar `NOT NULL` evita o
backfill e o caso órfão. COLABORADOR cadastra como responsável ele mesmo; ADMIN atribui a
qualquer membro.

**Decisão do produto:** `AGUARDANDO DECISÃO DO USUÁRIO`

---

## NEW-3 — Estados possíveis do processo (`processes.status`) · 🟢 (era DP-22)

**O que precisa ser decidido:**
Quais estados um processo pode ter? Proposta mínima: `active`, `archived`, `closed`. Precisa
de mais? "Arquivar" é reversível? Processo arquivado continua sendo acompanhado?

**Por que isso importa:**
É um `enum` no banco; define os filtros padrão das listagens e se um processo arquivado
gera coleta (Fase 7).

**Impacto técnico:**
Banco (`enum`), frontend (filtros/ações), acompanhamento. **Se adiado:** adicionar **valores**
a um enum é aditivo (não destrutivo); **renomear/remover** valor é destrutivo — então
começar enxuto é seguro.

**Opção A — `active` / `archived` / `closed` apenas.**
**Prós:** simples; cobre o essencial; fácil de estender.
**Contras:** pode faltar um estado que o escritório use.

**Opção B — enum mais rico já (`suspended`, `pre_registration`, …).**
**Prós:** menos migrations aditivas depois.
**Contras:** estados sem uso viram lixo; é decidir sem demanda concreta.

**Sua recomendação técnica:**
Opção A. Enum mínimo, extensível com valores aditivos conforme necessidade real. Definir
agora só: **arquivar é reversível?** (recomendo sim) e **processo arquivado é acompanhado?**
(recomendo não).

**Decisão do produto:** `AGUARDANDO DECISÃO DO USUÁRIO`

---

## NEW-4 — `clients`: documento obrigatório, unicidade e PF/PJ · 🟠 (era DP-25)

**O que precisa ser decidido:**
1. CPF/CNPJ é obrigatório no cadastro de cliente?
2. Dentro de um espaço, dois clientes podem ter o mesmo documento (unicidade)?
3. Um cliente é sempre PF **ou** PJ (`type`), com `birth_date` só para PF?

**Por que isso importa:**
Define constraints de `clients` (unique parcial em `document`, checks de `type`), a
deduplicação da carteira, e o job de aniversário (Fase 13), que depende de `birth_date`
só-PF.

**Impacto técnico:**
Banco (constraints), backend (validação CPF/CNPJ), frontend, job de aniversário. **Se
adiado:** adicionar `unique(document)` depois **falha** se já houver duplicatas → limpeza
manual.

**Opção A — documento opcional; único por espaço quando presente; `type` PF/PJ obrigatório;
`birth_date` só PF.**
**Prós:** cobre cliente sem documento (estrangeiro, espólio) e ainda deduplica quem tem
documento.
**Contras:** dedupe não cobre 100% dos casos.

**Opção B — documento obrigatório e único por espaço.**
**Prós:** dedupe forte; dados limpos.
**Contras:** bloqueia casos legítimos sem CPF/CNPJ.

**Sua recomendação técnica:**
Opção A. `document citext null`, `unique (space_id, document) where document is not null`,
`type` enum `('PF','PJ')`, `check (birth_date is null or type = 'PF')`. Nota multi-tenant: o
mesmo CPF em espaços diferentes são linhas diferentes (isolamento por `space_id`) — isso
está correto e **não** é duplicação.

**Decisão do produto:** `AGUARDANDO DECISÃO DO USUÁRIO`

---

## NEW-5 — `process_clients`: vocabulário de papéis do cliente no processo · 🟢 (era DP-27)

**O que precisa ser decidido:**
Que papéis um cliente pode ter num processo (`autor`, `réu`, `reclamante`, `reclamado`,
`terceiro_interessado`, `exequente`, `executado`, …)? Lista fechada (enum), lista
configurável por espaço (tabela de lookup) ou texto livre?

**Por que isso importa:**
Aparece na tela do processo, em filtros e (depois) em variáveis de template
(`{{cliente.papel}}`).

**Impacto técnico:**
Banco (`enum` vs tabela `process_client_roles`), frontend. **Se adiado:** adicionar valores
a um enum é aditivo; migrar de enum para tabela de lookup depois é retrabalho médio.

**Opção A — `enum` fixo com os papéis processuais mais comuns (cível + trabalhista) + valor
`outro` com campo texto livre opcional `role_note`.**
**Prós:** simples, consistente, bom para relatório.
**Contras:** pode faltar um papel de área específica (penal, família) — mitigado pelo `outro`.

**Opção B — tabela de lookup `process_client_roles`, semeada com padrões, editável.**
**Prós:** flexível por escritório.
**Contras:** mais complexidade; papéis divergentes entre espaços atrapalham relatórios
globais.

**Sua recomendação técnica:**
Opção A (enum + `outro` + `role_note`). Cobre a grande maioria sem introduzir tabela de
configuração agora; migração para B, se necessária, é decisão futura com dados reais.

**Decisão do produto:** `AGUARDANDO DECISÃO DO USUÁRIO`

---

## NEW-6 — Exclusão lógica (soft delete) em `processes` / `clients` / `process_clients` · 🟠

**O que precisa ser decidido:**
Excluir um processo ou cliente é **exclusão lógica** (`deleted_at`; some das telas, fica no
banco) ou **exclusão física**? Quem pode excluir? Um cliente vinculado a processos pode ser
excluído?

**Por que isso importa:**
RN3 e a auditoria implicam preservação de histórico. Exclusão física de um processo apaga
movimentações e trilha por cascata; exclusão física de cliente quebra `process_clients`.

**Impacto técnico:**
Banco (`deleted_at` em várias tabelas), **todas as políticas e queries** (filtrar
`deleted_at is null`), frontend, LGPD (anonimização × exclusão). **Se adiado:** adicionar
soft delete depois obriga a revisar cada política e cada consulta já escrita — retrabalho
médio e fácil de esquecer um ponto.

**Opção A — soft delete desde a Fase 3 (`deleted_at`); exclusão física reservada a rotina
administrativa/LGPD; só ADMIN "exclui" (na prática, arquiva); cliente com processos ativos
não é excluído, só arquivado.**
**Prós:** histórico e auditoria intactos; reversível; base para "lixeira".
**Contras:** toda query carrega o filtro; expurgo LGPD exige rotina separada (anonimização).

**Opção B — exclusão física, sem `deleted_at`.**
**Prós:** modelo mais simples.
**Contras:** conflita com preservação de histórico; perigoso com cascata; sem "desfazer".

**Sua recomendação técnica:**
Opção A, decidida **agora**, aplicada a `processes`, `clients`, `process_clients` (e às
tabelas futuras). Para LGPD, prever desde já que "excluir cliente" **anonimiza** os campos
pessoais e mantém os vínculos — a definição jurídica fina é PP-04 (adiável); a **capacidade
técnica** entra na Fase 3.

**Decisão do produto:** `AGUARDANDO DECISÃO DO USUÁRIO`

---

## NEW-7 — Escopo de `courts` na Fase 3 (sequenciamento) + PP-05 · 🟠

**O que precisa ser decidido:**
`processes` referencia um tribunal. O catálogo `courts` estava planejado para a Fase 4. Ao
juntar "Processos + Clientes" na Fase 3:
- **(a)** trazer uma versão mínima de `courts` já na Fase 3 (`court_id` FK NOT NULL); ou
- **(b)** guardar o tribunal como texto livre por enquanto, sem FK; ou
- **(c)** `court_id` nullable, vinculação real só na Fase 4.

E **PP-05:** quem cadastra um tribunal ausente do catálogo — só SUPER_ADMIN (catálogo
global) ou o ADMIN pode criar um "tribunal local" do espaço?

**Por que isso importa:**
Sem decisão, o cadastro de processo na Fase 3 fica incompleto ou preso à Fase 4.

**Impacto técnico:**
Banco (existência/forma de `courts`, FK), sequência de fases, frontend. **Se adiado com
texto livre (b):** migrar texto livre → FK depois exige normalização/matching manual dos
valores digitados.

**Opção A — incluir `courts` mínima na Fase 3** (`id`, `name`, `type`, `jurisdiction`,
`active`), semeada com um subconjunto; `processes.court_id` FK **NOT NULL**; o `datajud_sync`
completo e os aliases ficam na Fase 4.
**Prós:** `processes` nasce com relacionamento correto; sem retrabalho de normalização.
**Contras:** amplia um pouco o escopo da Fase 3.

**Opção B — `processes.court_id` nullable, tribunal como texto livre; FK e migração na
Fase 4.**
**Prós:** Fase 3 menor.
**Contras:** normalização manual depois; relatórios por tribunal inúteis até lá.

**Sua recomendação técnica:**
Opção A — incluir `courts` mínima na Fase 3 (tabela pequena e estável) com `court_id`
**NOT NULL**. PP-05: catálogo **global**, escrita **só SUPER_ADMIN**; se faltar um tribunal,
o ADMIN abre uma "solicitação de tribunal" (fila simples) em vez de criar um tribunal local
(evita catálogo fragmentado e alias ambíguo).

**Decisão do produto:** `AGUARDANDO DECISÃO DO USUÁRIO`

---

## NEW-8 — Campos de contato e consentimento em `clients` já na Fase 3 · 🟢

**O que precisa ser decidido:**
A Fase 3 já cria `clients` com `phone` (E.164), `email` e `notification_opt_in`
(consentimento para WhatsApp) + `opt_in_at`, mesmo que a lógica de notificação só entre nas
Fases 10/13?

**Por que isso importa:**
Evita uma migration futura adicionando colunas a uma tabela já populada e evita refazer o
formulário de cliente. A base legal LGPD detalhada (PP-04) pode ser confirmada depois; a
**estrutura** para registrar consentimento precisa nascer com a tabela.

**Impacto técnico:**
Banco (colunas em `clients`), frontend (formulário já coleta telefone/opt-in), LGPD. Risco
baixo.

**Opção A — incluir `phone`, `email`, `notification_opt_in` (default `false`) e `opt_in_at`
já na Fase 3.**
**Prós:** sem migration futura; formulário estável; consentimento rastreável desde o início.
**Contras:** campos "parados" até a fase de notificações.

**Opção B — adicionar na fase de notificações.**
**Prós:** Fase 3 mais enxuta.
**Contras:** migration em tabela populada + retrabalho no formulário + possível recontato de
clientes para coletar consentimento.

**Sua recomendação técnica:**
Opção A. Custo marginal agora, evita retrabalho e recontato depois.

**Decisão do produto:** `AGUARDANDO DECISÃO DO USUÁRIO`

---

# PARTE 2 — DECISÕES QUE PODEM SER ADIADAS

Para cada uma: **por que pode esperar** e **qual é o prazo real** (a fase antes da qual
precisa estar decidida).

## DP-36 — Self-signup cria espaço automaticamente? · pode adiar → fase de onboarding
A Fase 3 não constrói onboarding. Hoje a política de INSERT de `spaces` é "só SUPER_ADMIN" e
`spaces.created_by` já existe. Qualquer que seja a decisão, ela só **adiciona** uma
política/fluxo depois — sem mudança de schema e sem tocar `processes`/`clients`.
_Recomendação preliminar:_ manter "só SUPER_ADMIN provisiona" e revisar junto com planos/
billing (DP-08).
_Prazo:_ antes da fase de onboarding/planos.

## DP-01 — Hospedagem/topologia do WAHA · pode adiar → Fase 11
Zero impacto no modelo de dados da Fase 3. É decisão de infraestrutura. O `WAHA Gateway` já
está previsto para abstrair a topologia.
_Prazo:_ antes da Fase 11 (WAHA).

## DP-02 — Runtime dos coletores pesados / scraping · pode adiar → Fases 7–8
Zero impacto em `processes`/`clients`. Afeta o design de `process_tracking_configs` (Fase 7)
e do worker (Fase 8/12), não das tabelas da Fase 3.
_Prazo:_ antes da Fase 7 (Acompanhamento).

## DP-09 — Fluxo de convite + "≥1 ADMIN ativo" + o que COLABORADOR vê em /usuários · majoritariamente adiável
O invariante "≥ 1 ADMIN ativo por espaço" **já está implementado e testado** (gatilho
`app.prevent_last_space_admin_loss`). O fluxo de convite (`user_invitations` + e-mail) é da
fase de onboarding. O único pedaço que toca a Fase 3 de leve: **"o COLABORADOR pode ver a
lista de membros do espaço?"** — hoje a política permite, porque é necessário para exibir o
nome do responsável de um processo. Basta confirmar que isso está OK; o resto adia.
_Prazo:_ confirmar o item da lista de membros agora; o convite, antes da fase de onboarding.

## DP-13 — Mecânica TJAM/Projudi + de quem são as credenciais · pode adiar → Fases 7 e 12
Não afeta `processes`/`clients`. **Ressalva:** se as credenciais forem **por advogado** (não
institucionais), pode ser necessária uma tabela `tribunal_credentials` ligada a `profiles` +
`courts` — mas isso é modelagem da **Fase 7** (`process_tracking_configs`), não da Fase 3.
PP-12 (aval jurídico do scraping) precisa vir antes da **Fase 12**.
_Prazo:_ decisão de credenciais antes da Fase 7; mecânica e aval jurídico antes da Fase 12.

## PP-10 — Aprovar as tabelas de apoio (`job_runs`, `collection_runs`, `waha_sessions`, `notification_events`, `plans`, `user_invitations`) · parcialmente adiável
**Nenhuma** dessas tabelas é da Fase 3. O que precisa de "ok" agora é só a **abordagem**:
"o modelo pode ganhar tabelas de apoio além das 14 nomeadas quando o pipeline exigir, cada
uma detalhada na sua fase". O desenho de cada tabela é decidido quando a fase correspondente
chegar.
_Prazo:_ aprovar a abordagem agora; cada tabela na sua fase.

## PP-13 / DP-03 — Critério de "mudança relevante" · pode adiar → Fase 9
Não afeta `processes`/`clients`. Afeta `process_movements` (regra do `content_hash`) e
`notification_rules.filter`. **Ressalva de design:** se a Fase 3 incluir um
`processes.state_hash`, mantê-lo como coluna **opaca e nullable**, sem semântica embutida,
até a Fase 9.
_Prazo:_ antes da Fase 9 (Motor de mudanças).

## PP-04 — Base legal LGPD para notificar clientes · capacidade agora, definição jurídica depois
A **capacidade técnica** (opt-in, `opt_in_at`, anonimização em vez de exclusão física) entra
na Fase 3 via NEW-6 e NEW-8. A **base legal formal** (consentimento × legítimo interesse ×
execução de contrato) e a política de retenção precisam ser fechadas com o jurídico **antes
de ligar notificações a clientes de verdade** (Fase 10).
_Prazo:_ antes da Fase 10 (Notificações).

## PP-12 — Aval jurídico para automação de coleta no TJAM/Projudi · pode adiar → antes da Fase 12
Decisão jurídica/negocial, sem impacto de schema.
_Prazo:_ antes da Fase 12 (adapter TJAM/Projudi).

## PP-14 / DP-08 — Planos e limites comerciais fazem parte do escopo? · pode adiar → Fase 14
`spaces.plan_id` pode entrar como coluna nullable sem consequência. As tabelas `plans` /
`plan_limits` e o enforcement são da Fase 14.
_Prazo:_ antes da Fase 14.

---

# PARTE 3 — ALERTA DE RETRABALHO SE ADIADO

Decisões que, se deixadas para depois da Fase 3, geram **migration destrutiva, alteração de
relacionamento ou reescrita de RLS já testada**:

| Decisão | O que acontece se adiar | Gravidade |
|---|---|---|
| **PP-02 / histórico de responsabilidade** | Criar `process_responsible_history` depois exige backfill a partir de `audit_logs` **e reescrever a RLS de `process_movements`** (Fase 8) já testada. Mudança de relacionamento. | 🔴 Alta |
| **NEW-1 — CNJ obrigatório?** | `NOT NULL → NULL` é fácil; `NULL → NOT NULL` exige backfill. Adicionar `unique(space_id, cnj_number)` depois **falha com duplicatas** → limpeza manual. | 🟠 Média |
| **NEW-2 — `responsible_id` obrigatório?** | `nullable → NOT NULL` exige backfill de todos os processos sem responsável. | 🟠 Média |
| **NEW-4 — unicidade do documento do cliente** | Adicionar `unique(space_id, document)` depois **falha** se a carteira já tiver duplicatas → merge manual de clientes (e de seus vínculos com processos). | 🟠 Média |
| **NEW-6 — soft delete** | Adicionar `deleted_at` depois obriga a **revisar todas as políticas e queries** de `processes`/`clients`/`process_clients` já escritas; alto risco de esquecer um ponto e vazar registro "excluído". | 🟠 Média |
| **NEW-7 — `courts` como texto livre** | Migrar `text` → FK `court_id` depois exige normalizar/casar manualmente todos os nomes digitados. Alteração de relacionamento. | 🟠 Média |
| **NEW-5 — papéis do cliente** | Adicionar **valores** ao enum é aditivo (barato). Migrar de enum para **tabela de lookup** depois é retrabalho médio. Começar com enum + `outro` mitiga. | 🟢/🟠 Baixa-média |
| PP-01, PP-03, DP-35, NEW-3, NEW-8 | Só troca de política / allowlist / valor de enum aditivo. Decidir agora é para **não travar a Fase 3**, não por risco de retrabalho. | 🟢 Baixa |

---

# PARTE 4 — SÍNTESE

### 1. Lista de decisões críticas (antes da Fase 3)

| ID | Decisão | Tipo | Risco se adiada |
|---|---|---|---|
| PP-01 | SUPER_ADMIN é sempre global (nunca membro)? | confirmação de padrão RLS | 🟢 |
| PP-02 | Acesso do ex-responsável + criar `process_responsible_history` na Fase 3? | comportamento + modelagem | 🔴 |
| PP-03 | COLABORADOR vê todos os clientes do espaço ou só os seus? | RLS de `clients` | 🟢 (trava a tela de cadastro) |
| DP-35 | SUPER_ADMIN lista/gerencia `space_members` e vê `profiles`? | confirmação de RLS | 🟢 |
| NEW-1 | `processes.cnj_number` é obrigatório? | constraint + comportamento | 🟠 |
| NEW-2 | `processes.responsible_id` é obrigatório? Quem atribui no cadastro? | nullability + RLS de INSERT | 🟠 |
| NEW-3 | Estados do processo (`status`) — enum mínimo? Arquivar é reversível? Arquivado é acompanhado? | enum + comportamento | 🟢 |
| NEW-4 | `clients`: documento obrigatório? único por espaço? PF/PJ + `birth_date` só PF? | constraints | 🟠 |
| NEW-5 | Vocabulário de papéis em `process_clients` (enum + `outro`)? | enum | 🟢/🟠 |
| NEW-6 | Soft delete (`deleted_at`) em `processes`/`clients`/`process_clients`? | modelagem transversal + RLS | 🟠 |
| NEW-7 | Incluir `courts` mínima na Fase 3 (FK `NOT NULL`)? Só SUPER_ADMIN cadastra tribunal (PP-05)? | sequência + relacionamento | 🟠 |
| NEW-8 | `clients` já nasce com `phone`/`email`/`notification_opt_in`/`opt_in_at`? | colunas | 🟢 |

### 2. Explicação de cada decisão
Ver Parte 1.

### 3. Opções disponíveis
Ver Parte 1 (A/B por decisão).

### 4. Recomendação técnica (resumo)

| ID | Recomendação |
|---|---|
| PP-01 | **A** — SUPER_ADMIN estritamente global. |
| PP-02 | Criar `process_responsible_history` **agora**; comportamento = **A** (transferência remove acesso; período apenas registrado). Migrar para "acesso somente-leitura até a data" depois, sem migration destrutiva. |
| PP-03 | **B para leitura** (todo membro vê a carteira), escrita restrita a ADMIN + criador. |
| DP-35 | **A** — SUPER_ADMIN provisiona, com auditoria; revisável na fase de onboarding. |
| NEW-1 | **B** — CNJ opcional, único quando presente, `internal_ref` alternativo, sem CNJ ⇒ sem coleta automática. |
| NEW-2 | **A** — `responsible_id NOT NULL`; COLABORADOR = ele mesmo; ADMIN atribui a terceiros. |
| NEW-3 | **A** — enum `active/archived/closed`; arquivar reversível; arquivado não é acompanhado. |
| NEW-4 | **A** — documento opcional, único quando presente; `type` PF/PJ; `birth_date` só PF. |
| NEW-5 | **A** — enum de papéis + `outro` + `role_note` texto livre. |
| NEW-6 | **A** — soft delete desde a Fase 3 em processes/clients/process_clients; "excluir cliente" = anonimizar. |
| NEW-7 | **A** — `courts` mínima na Fase 3, `court_id NOT NULL`; PP-05: catálogo global, escrita só SUPER_ADMIN, "solicitação de tribunal" para o resto. |
| NEW-8 | **A** — incluir `phone`/`email`/`notification_opt_in`/`opt_in_at` já na Fase 3. |

### 5. Impacto técnico (resumo)

| Camada | Decisões que a afetam |
|---|---|
| **Banco (schema/constraints)** | PP-02, NEW-1, NEW-2, NEW-3, NEW-4, NEW-5, NEW-6, NEW-7, NEW-8 |
| **RLS** | PP-01, PP-02, PP-03, DP-35, NEW-2, NEW-6, NEW-7 |
| **Backend / RPC** | PP-02 (RPC de transferência), NEW-2 (INSERT), NEW-6 (anonimização) |
| **Frontend** | PP-03, NEW-1, NEW-2, NEW-3, NEW-5, NEW-7, NEW-8 |
| **Integrações** | NEW-1 (sem CNJ ⇒ sem coleta), NEW-7 (DataJud ⇒ courts) — efeito só nas Fases 7–8 |
| **Jobs** | NEW-4/NEW-8 (aniversário depende de `birth_date`/opt-in) — efeito na Fase 13 |
| **Arquitetura** | PP-02 (tabela de histórico muda a base da RLS de movimentações) |

### 6. Decisões que podemos adiar
DP-36 (onboarding) · DP-01 (Fase 11) · DP-02 (Fase 7) · DP-09 — convite (onboarding) · DP-13
(Fases 7 e 12) · PP-10 — só aprovar a abordagem agora · PP-13/DP-03 (Fase 9) · PP-04 —
definição jurídica (Fase 10) · PP-12 (Fase 12) · PP-14/DP-08 (Fase 14). Ver Parte 2.

### 7. Checklist final — o que preciso que você responda antes da Fase 3

1. **PP-01:** SUPER_ADMIN é sempre global e **nunca** aparece em `space_members`? (recomendado: sim)
2. **PP-02 (a):** ao transferir um processo, o COLABORADOR anterior — (1) perde todo o acesso, (2) mantém leitura das movimentações até a data da transferência, ou (3) mantém leitura total? (recomendado: 1 agora)
3. **PP-02 (b):** aprova **criar `process_responsible_history` já na Fase 3** (mesmo com o comportamento 1)? (recomendado: sim)
4. **PP-03:** o COLABORADOR vê **todos** os clientes do espaço (leitura) ou **só os dos seus processos**? (recomendado: todos, leitura)
5. **DP-35:** o SUPER_ADMIN pode listar/gerir `space_members` e ver `profiles` para provisionar? (recomendado: sim, com auditoria)
6. **NEW-1:** é permitido cadastrar processo **sem CNJ**? (recomendado: sim — opcional, único quando presente)
7. **NEW-2 (a):** todo processo tem **sempre** um responsável (`responsible_id NOT NULL`)? (recomendado: sim)
8. **NEW-2 (b):** no cadastro, o COLABORADOR pode apontar **outra pessoa** como responsável, ou só ele mesmo? (recomendado: só ele mesmo; ADMIN atribui a terceiros)
9. **NEW-3:** estados do processo = `active/archived/closed`? Arquivar é reversível? Processo arquivado **não** é acompanhado? (recomendado: sim / sim / não)
10. **NEW-4:** CPF/CNPJ do cliente é **opcional** e **único quando presente**? Confirma `type` PF/PJ e `birth_date` só PF? (recomendado: sim)
11. **NEW-5:** papéis do cliente no processo = **enum fixo + `outro` + nota livre**? (recomendado: sim) — e qual o conjunto inicial de papéis?
12. **NEW-6:** adotamos **soft delete** (`deleted_at`) em processes/clients/process_clients desde a Fase 3, e "excluir cliente" = **anonimizar**? (recomendado: sim)
13. **NEW-7 (a):** incluir uma **`courts` mínima** na Fase 3 com `processes.court_id` **NOT NULL**? (recomendado: sim)
14. **NEW-7 (b) / PP-05:** cadastro de tribunal é **só SUPER_ADMIN** (catálogo global), com "solicitação de tribunal" para o resto? (recomendado: sim)
15. **NEW-8:** `clients` já nasce com `phone`, `email`, `notification_opt_in`, `opt_in_at`? (recomendado: sim)
16. **PP-10:** aprova a **abordagem** de criar tabelas de apoio além das 14 nomeadas, cada uma detalhada na sua fase? (recomendado: sim)
17. **DP-09 (item da Fase 3):** confirma que o **COLABORADOR pode ver a lista de membros** do espaço (necessário para exibir o nome do responsável)? (recomendado: sim)

As demais decisões (DP-36, DP-01, DP-02, DP-13, PP-04, PP-12, PP-13/DP-03, PP-14/DP-08 e o
fluxo de convite do DP-09) **não precisam ser respondidas agora** — ver Parte 2 para o prazo
de cada uma.

---

_Aguardando suas decisões. Nada será implementado até então._
