# Regras de negócio do JuriFlow

Este documento reúne as regras **definidas pelo dono do produto**. Toda mudança
no sistema deve ser conferida contra elas antes de subir. Regra nova ou
alterada entra aqui primeiro.

Para cada regra: **onde ela é garantida** (banco, função, tela) e **o teste que
a prova**. Garantia de verdade é no banco (RLS e funções); a tela só esconde.

Legenda dos testes: `pgTAP 000N` = `supabase/tests/000N_*.test.sql`;
`E2E` = roteiro de navegador rodado contra o build de produção.

---

## 1. Plataforma (SUPER_ADMIN)

| #   | Regra                                                                                                                                                                                                                                                                                    | Onde é garantida                                                                                                                                     | Teste                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| P1  | Existe **um único** SUPER_ADMIN.                                                                                                                                                                                                                                                         | Índice único `profiles_single_super_admin` (0040).                                                                                                   | pgTAP 0009                                      |
| P2  | **Nada é alterado manualmente no banco de produção** — nem para criar o SUPER_ADMIN. Mudança de estrutura = migration; o primeiro SUPER_ADMIN = `npm run bootstrap:super-admin`, que só roda se não existir nenhum e fica na auditoria.                                                  | `bootstrap_super_admin` só para `service_role` (0040); `scripts/bootstrap-super-admin.mjs`.                                                          | pgTAP 0009                                      |
| P3  | A plataforma **sabe que o escritório existe e nada sobre ele**, nem tem acesso: não vê processos, clientes, membros, perfis, auditoria do escritório, templates, regras, WhatsApp, convites da equipe, **nem contagem de usuários** ou qualquer número tirado de dentro dos escritórios. | RLS sem exceção para SUPER_ADMIN (0035, 0039, 0040); a plataforma lê escritórios só por `platform_spaces` / `platform_overview` / `platform_growth`. | pgTAP 0001, 0006, 0007, 0008, 0009 · E2E papéis |
| P4  | O que a plataforma vê de cada escritório: nome, status, plano, e-mail do ADMIN que ela convidou e a situação desse convite.                                                                                                                                                              | `platform_spaces` (0039).                                                                                                                            | pgTAP 0008 · E2E convites                       |
| P5  | Convite do SUPER_ADMIN é **sempre** para o ADMIN de um **escritório novo**. O escritório nasce "aguardando configuração"; o ADMIN, ao abrir o link, completa os dados dele e do escritório.                                                                                              | `create_space_for_admin` (0039).                                                                                                                     | pgTAP 0008 · E2E convites                       |
| P6  | A conta da plataforma não pode ser ADMIN de escritório.                                                                                                                                                                                                                                  | `create_space_for_admin` recusa o próprio e-mail.                                                                                                    | pgTAP 0001                                      |
| P7  | **Suspender** um escritório bloqueia todo o acesso dele (e a coleta automática); só a plataforma reativa, e nada se perde.                                                                                                                                                               | Helpers de papel só valem em espaço ativo (0035); `platform_set_space_status` (0040); worker ignora espaço suspenso.                                 | pgTAP 0006 · E2E papéis · integração do worker  |
| P8  | **Plano** por escritório: limite de processos e de processos com sincronização automática (padrão Free: 10 e 3). Só a plataforma define, por formulário.                                                                                                                                 | `platform_set_space_plan` (0040); gatilho `processes_enforce_plan` (0036).                                                                           | pgTAP 0006 · E2E papéis                         |
| P9  | Reduzir/aumentar o plano com uso acima do novo limite: **mitigação é trabalho futuro** (hoje não mexe no que existe).                                                                                                                                                                    | —                                                                                                                                                    | ver [PLANOS.md](PLANOS.md)                      |

## 2. Escritório (espaço)

| #   | Regra                                                                                                             | Onde é garantida                                              | Teste                          |
| --- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------ |
| E1  | Dentro do escritório só existem **ADMIN** e **colaborador**.                                                      | Enum `space_role`; papéis da matriz de permissões.            | pgTAP 0001                     |
| E2  | O ADMIN convida colaboradores ou outros ADMINs **só do próprio escritório**.                                      | `create_space_invite` (exige ADMIN do espaço).                | pgTAP 0001, 0006 (intruso)     |
| E3  | O ADMIN vê a **auditoria do próprio escritório**, legível (ações em português, quem fez, o que foi afetado).      | RLS `audit_logs_select` (0035); rótulos em `audit-labels.ts`. | E2E papéis                     |
| E4  | O colaborador **não acessa o módulo de Usuários**.                                                                | Matriz de permissões (sem `member.view`); `usersAreaGuard`.   | testes do domínio · E2E papéis |
| E5  | **Clientes são compartilhados** por todo o escritório.                                                            | RLS `clients_select` por membro ativo.                        | pgTAP 0003 · E2E papéis        |
| E6  | **Cliente não é usuário nem colaborador**: não faz login, é só cadastro do escritório.                            | Tabela `clients` separada de `profiles`/`space_members`.      | — (estrutural)                 |
| E7  | Cada papel tem o **seu dashboard** (plataforma, ADMIN, colaborador), com **3 gráficos** de suma importância cada. | `dashboard.component.ts`.                                     | E2E gráficos                   |

## 3. Processos

| #   | Regra                                                                                                                       | Onde é garantida                                                                      | Teste                   |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------- |
| PR1 | Todo processo tem **ao menos um responsável**; pode ter **vários**.                                                         | `create_process` exige ≥1; `remove_process_responsible` não remove o último (0037).   | pgTAP 0003 · E2E papéis |
| PR2 | O colaborador pode cadastrar processo; **ele vira o responsável**.                                                          | `create_process` (0037).                                                              | pgTAP 0003 · E2E papéis |
| PR3 | O ADMIN cadastra e aponta os responsáveis que quiser; **só o ADMIN** inclui/remove responsáveis.                            | `create_process`, `add/remove_process_responsible` (0037).                            | pgTAP 0003 · E2E papéis |
| PR4 | O colaborador **vê só os processos em que é responsável**.                                                                  | RLS `processes_select` (0037).                                                        | pgTAP 0003 · E2E papéis |
| PR5 | O colaborador responsável **edita, vincula clientes e arquiva**; não reativa, não encerra, não exclui.                      | `processes_guard_field_updates` (0037).                                               | pgTAP 0003 · E2E papéis |
| PR6 | **Nenhum processo é excluído direto.** Colaborador só arquiva; o ADMIN exclui **a partir dos arquivados**, com confirmação. | `soft_delete_process` só ADMIN e só arquivado (0037); diálogo de confirmação na tela. | pgTAP 0003 · E2E papéis |
| PR7 | Listas: ADMIN — meus, todos, arquivados, excluídos; colaborador — meus e arquivados.                                        | `process-list.component.ts`.                                                          | E2E papéis              |

## 4. Notificações (WhatsApp)

| #   | Regra                                                                                                                                     | Onde é garantida                        | Teste                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | -------------------- |
| N1  | Há templates para **responsáveis** e para **clientes**.                                                                                   | `message_templates.audience`.           | testes do worker     |
| N2  | A configuração **geral do escritório** e a **específica do processo** definem se a movimentação vai para responsáveis, clientes ou ambos. | `notification-config` do worker (0023). | testes do worker     |
| N3  | "Responsáveis" = **todos** os responsáveis atuais do processo (com vínculo ativo e telefone).                                             | `SupabaseRecipientResolver`.            | integração do worker |

## 5. Convites (link)

| #   | Regra                                                 | Onde é garantida                                                       | Teste                     |
| --- | ----------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------- |
| C1  | O sistema mostra se a pessoa **abriu ou não** o link. | `space_invites.opened_at`, marcado ao abrir (0039).                    | pgTAP 0008 · E2E convites |
| C2  | O link **vale 24 horas**.                             | `expires_at` (0039) + validade do link no Auth (`otp_expiry = 86400`). | pgTAP 0008 · E2E convites |
| C3  | Se um novo link é enviado, **só o último funciona**.  | Convite anterior fica "substituído" (0039); o Auth troca o token.      | pgTAP 0008 · E2E convites |

## 6. Forma de trabalho

| #   | Regra                                                                                     |
| --- | ----------------------------------------------------------------------------------------- |
| T1  | Toda tela nova é testada no navegador (E2E), não só com build/typecheck.                  |
| T2  | Nunca commitar direto na `master`: trabalhar em branch e dar push.                        |
| T3  | Commits e PRs sem menção a IA.                                                            |
| T4  | Preferir componentes de biblioteca (PrimeNG) quando facilitarem a manutenção.             |
| T5  | Topologia da v1: frontend na Vercel, worker + WAHA em container, banco no Supabase Cloud. |

---

## Decisões tomadas na implementação — a confirmar

Estas **não** foram ditas pelo dono do produto; foram escolhas técnicas para
fechar lacunas. Enquanto não confirmadas, valem como estão:

| #   | Decisão                                                                                                    | Por quê                                                        |
| --- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| D1  | Processo **arquivado continua contando** no limite do plano; só o excluído libera a vaga.                  | Arquivar não pode virar atalho para fugir do limite.           |
| D2  | "Consultar agora" só funciona com a **sincronização automática ligada**.                                   | Senão a consulta manual contornaria o limite de sincronização. |
| D3  | Excluir é **lógico e reversível** (aba Excluídos → Restaurar); o registro e a auditoria ficam.             | Prestação de contas; nada de apagar histórico.                 |
| D4  | Quem já tem conta e recebe convite de outro escritório entra por **link de acesso**, sem criar nova senha. | A conta é uma só, por e-mail.                                  |
| D5  | Um processo de tribunal **sem coleta automática** não ocupa vaga de sincronização.                         | Ele nunca seria consultado.                                    |
