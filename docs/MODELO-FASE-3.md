# JuriFlow — Fase 3: Modelo de Dados + ERD + RLS + Índices + Auditoria

> **IMPLEMENTADO (Etapas G–K concluídas, 2026-09-02).** Migrations `0007`–`0015`,
> RPCs, gatilhos de auditoria, telas de processos/clientes/tribunais. Verificado:
> `npm test` (29), `npm run test:web` (20), `npm run db:test` (90, dos quais 57 da Fase 3),
> `npm run lint`, `npm run build` — todos verdes. Este documento (rev. 3) é a referência do
> modelo entregue.
> **Data:** 2026-09-02 · **Rev. 3 — APROVADO (Etapa F).** Implementação da Fase 3 autorizada.
>
> Mudanças da rev. 3:
> - **Nomenclatura:** `processes.responsible_id` → **`processes.assigned_user_id`** (usuário
>   atualmente responsável). Em `process_responsible_history` permanece `responsible_id`
>   (responsável naquele período) e `assigned_by` (quem atribuiu/transferiu — só histórico).
>   `processes.created_by` = quem cadastrou. **Sem `user_id` genérico.**
> - **Q7 = SIM:** `app.can_edit_process` expressa explicitamente
>   `is_space_admin(space) OR (created_by = auth.uid() AND can_read_process(process))` — o
>   criador só edita **enquanto também for o responsável atual**, sem depender da interação
>   implícita entre RLS de SELECT e UPDATE.
> - Renomeados: trigger `processes_validate_responsible` → `processes_validate_assignee`;
>   índice `processes_space_responsible_idx` → `processes_space_assignee_idx`.
>
> Rev. 2 (histórico): edição de processo depende de `created_by` (criador) ou ADMIN, não do
> responsável.
> **Decisões-base:** Fase 2.1 + prompt da Fase 3 + correção rev. 2 + regras/nomenclatura rev. 3.

## Premissas aprovadas aplicadas aqui

- `process_clients` **não** tem papel processual — só "este cliente está ligado a este processo".
- `SUPER_ADMIN` é global, nunca em `space_members`, **sem acesso operacional** a
  processes/clients/process_clients/history (só administra `courts`, que é catálogo de plataforma).
- COLABORADOR vê **todos os clientes** do próprio espaço; vê **só os processos onde é
  responsável atual**.
- **Edição de processo** (correção da revisão): `created_by = auth.uid()` **OU** ADMIN do
  espaço. O responsável atual que **não** criou o processo é **read-only** — `responsible_id`
  é o dono operacional do acompanhamento, **não** dá permissão de edição.
- `cnj_number` opcional, único no espaço quando presente; sem CNJ ⇒ sem acompanhamento (Fase 7).
- `responsible_id` **obrigatório**; COLABORADOR só cria para si (criador = responsável nesse
  momento); ADMIN atribui a qualquer membro ativo do espaço; troca posterior só via
  `transfer_process` (ADMIN). Alterar `court_id` e encerrar/reabrir (`close`) = só ADMIN.
- `status` = `active | archived | closed`; `archived` reversível; arquivado não é acompanhado.
- Soft delete (`deleted_at`) em `processes`, `clients`, `process_clients`.
- `courts` mínima, catálogo **global**, escrita só SUPER_ADMIN, `processes.court_id` **NOT NULL**.
- `clients`: `type PF|PJ`, CPF/CNPJ opcional e único no espaço quando presente, `birth_date`
  só PF, campos `phone`/`email`/`notification_opt_in`/`opt_in_at` (`opt_in` inicia `false`).

## Convenções (herdadas da Fase 2)

- PK: `id uuid not null default gen_random_uuid()`.
- Tabelas operacionais têm `space_id uuid not null references public.spaces(id) on delete cascade`.
  `courts` é global — **sem** `space_id`.
- `created_at timestamptz not null default now()`; `updated_at timestamptz` + trigger
  `app.set_updated_at`.
- `deleted_at timestamptz` onde há soft delete.
- RLS `enable` + `force` em todas as tabelas.
- Helpers de autorização vivem no schema `app` (não exposto pela API).

---

# ETAPA A — MODELO DE DADOS

## Novos tipos (enums)

| Tipo | Valores | Uso |
|---|---|---|
| `public.process_status` | `active`, `archived`, `closed` | `processes.status` |
| `public.client_type` | `PF`, `PJ` | `clients.type` |
| `public.court_type` | `STF`, `STJ`, `TST`, `TSE`, `STM`, `CNJ`, `TRF`, `TJ`, `TRT`, `TRE`, `TJM`, `turma_recursal`, `outro` | `courts.type` |
| `public.responsibility_reason` | `process_created`, `transfer` | `process_responsible_history.reason` |

Adicionar valor a um enum é aditivo (não destrutivo); começamos enxutos.

---

## Tabela `courts` — catálogo global de tribunais/órgãos

| Campo | Tipo | Null | Default | Observações |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `name` | `text` | NOT NULL | — | nome do órgão/tribunal/vara |
| `type` | `public.court_type` | NOT NULL | — | classificação |
| `jurisdiction` | `text` | NOT NULL | — | UF (`AM`, `SP`…) ou `federal` / `nacional` / `trabalhista` / `eleitoral` |
| `datajud_code` | `text` | NULL | — | forward-compat p/ a Fase 4 (sync DataJud); único quando presente |
| `active` | `boolean` | NOT NULL | `true` | catálogo usa `active`, **não** soft delete |
| `created_by` | `uuid` | NULL | — | `→ profiles(id) on delete set null` — qual SUPER_ADMIN cadastrou |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |
| `updated_at` | `timestamptz` | NULL | — | trigger `app.set_updated_at` |

**Constraints**

- `courts_pkey` — PRIMARY KEY (`id`)
- `courts_name_not_blank_chk` — CHECK (`length(btrim(name)) > 0`)
- `courts_jurisdiction_not_blank_chk` — CHECK (`length(btrim(jurisdiction)) > 0`)
- `courts_datajud_code_uniq` — UNIQUE (`datajud_code`) — índice parcial `where datajud_code is not null`
- FK `created_by → public.profiles(id)` ON DELETE SET NULL

**Índices**

- `courts_pkey` (id)
- `courts_datajud_code_uniq` — UNIQUE parcial (`datajud_code`) `where datajud_code is not null`
- `courts_type_jurisdiction_idx` (`type`, `jurisdiction`)
- `courts_active_name_idx` (`name`) `where active` — dropdown de seleção (ordena/filtra por ativos)

**Soft delete:** não. Desativar = `active = false`.
**Timestamps:** `created_at`, `updated_at`.
**Relacionamentos:** `1:N` com `processes` (`processes.court_id → courts.id` ON DELETE RESTRICT).

---

## Tabela `processes`

| Campo | Tipo | Null | Default | Observações |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `space_id` | `uuid` | NOT NULL | — | `→ spaces(id) on delete cascade` |
| `cnj_number` | `extensions.citext` | NULL | — | número CNJ **formatado** (`NNNNNNN-DD.AAAA.J.TR.OOOO`); único no espaço quando presente |
| `internal_ref` | `text` | NULL | — | referência interna do escritório |
| `court_id` | `uuid` | **NOT NULL** | — | `→ courts(id) on delete restrict` |
| `assigned_user_id` | `uuid` | **NOT NULL** | — | `→ profiles(id) on delete restrict` — usuário **atualmente responsável** pelo acompanhamento (RN1) |
| `created_by` | `uuid` | NOT NULL | — | `→ profiles(id) on delete restrict` — quem cadastrou o processo (RN2); **imutável** (trigger) |
| `status` | `public.process_status` | NOT NULL | `active` | |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |
| `updated_at` | `timestamptz` | NULL | — | trigger `app.set_updated_at` |
| `deleted_at` | `timestamptz` | NULL | — | soft delete |

> **Não incluídos de propósito** (entram na sua fase, sem migration destrutiva depois):
> `tracking_enabled` / janelas de coleta → Fase 7; `state_hash` → Fase 9. Os efeitos "sem
> CNJ ⇒ sem acompanhamento" e "arquivado ⇒ sem acompanhamento" são regras aplicadas na
> Fase 7, onde o acompanhamento é construído.

**Constraints**

- `processes_pkey` — PRIMARY KEY (`id`)
- FK `space_id → spaces(id)` ON DELETE CASCADE
- FK `court_id → courts(id)` ON DELETE RESTRICT
- FK `responsible_id → profiles(id)` ON DELETE RESTRICT
- FK `created_by → profiles(id)` ON DELETE RESTRICT
- `processes_cnj_uniq` — UNIQUE (`space_id`, `cnj_number`) — índice parcial
  `where cnj_number is not null and deleted_at is null`
  _(processo soft-deleted libera o CNJ para novo cadastro)_
- `processes_cnj_format_chk` — CHECK (`cnj_number is null or cnj_number ~
  '^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$'`) — **ver Q4**
- `processes_internal_ref_not_blank_chk` — CHECK (`internal_ref is null or
  length(btrim(internal_ref)) > 0`)

**Triggers (BEFORE)**

- `app.set_updated_at` — `updated_at := now()` em UPDATE.
- `app.processes_protect_immutable` — impede alterar `space_id` e `created_by`.
- `app.processes_validate_responsible` — em INSERT e em UPDATE de `responsible_id`: exige que
  `responsible_id` seja **membro ativo** de `space_id` (`space_members.status='active'`,
  papel `ADMIN` ou `COLABORADOR`). _(A regra "COLABORADOR só atribui a si" fica na RLS; esta
  garante que o alvo é um membro real do espaço.)_
- `app.processes_validate_court` — em INSERT (e em UPDATE quando `court_id` muda): exige
  `courts.active = true`. _(ver Q6)_
- `app.processes_guard_field_updates` — se o autor **não** for ADMIN do espaço (isto é, é o
  CRIADOR editando), rejeita UPDATE que:
  - altere `responsible_id` (transferência = RPC ADMIN, RN4);
  - altere `court_id` (exclusivo do ADMIN);
  - defina `status = 'closed'` **ou** parta de `status = 'closed'` (encerrar/reabrir = ADMIN — Q2).
  As transições `active ↔ archived` continuam permitidas ao CRIADOR.

**Triggers (AFTER)**

- `app.processes_open_first_period` — AFTER INSERT: cria a 1ª linha em
  `process_responsible_history` (`reason='process_created'`, `started_at=now()`,
  `ended_at=null`, `assigned_by=created_by`).
- `app.audit_processes` — AFTER INSERT/UPDATE → `app.write_audit_log` (ver Etapa E).

**Índices**

- `processes_pkey` (id)
- `processes_cnj_uniq` — UNIQUE parcial (`space_id`, `cnj_number`)
  `where cnj_number is not null and deleted_at is null`
- `processes_space_responsible_idx` (`space_id`, `responsible_id`)
  `where deleted_at is null` — **crítico p/ a RLS do COLABORADOR**
- `processes_space_status_idx` (`space_id`, `status`) `where deleted_at is null`
- `processes_space_created_idx` (`space_id`, `created_at desc`) `where deleted_at is null` — listagem
- `processes_court_idx` (`court_id`)
- `processes_internal_ref_trgm_idx` — GIN (`internal_ref` `extensions.gin_trgm_ops`)
  `where deleted_at is null` — busca parcial por referência interna _(requer `pg_trgm`)_

**Soft delete:** `deleted_at`. Toda policy de SELECT e toda query da aplicação filtram
`deleted_at is null`.

---

## Tabela `process_responsible_history` — períodos de responsabilidade

Ledger imutável. Cada linha = um período em que um usuário foi o responsável de um processo.
Início/fim representados por `started_at` / `ended_at` (`ended_at is null` = período atual).

| Campo | Tipo | Null | Default | Observações |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `space_id` | `uuid` | NOT NULL | — | `→ spaces(id) on delete cascade` — denormalizado (RLS + índice); derivado do processo por trigger |
| `process_id` | `uuid` | NOT NULL | — | `→ processes(id) on delete cascade` |
| `responsible_id` | `uuid` | NOT NULL | — | `→ profiles(id) on delete restrict` — responsável **neste período** |
| `assigned_by` | `uuid` | NULL | — | `→ profiles(id) on delete set null` — quem atribuiu (o `created_by` na criação; o ADMIN na transferência) |
| `reason` | `public.responsibility_reason` | NOT NULL | — | `process_created` \| `transfer` |
| `started_at` | `timestamptz` | NOT NULL | `now()` | início do período |
| `ended_at` | `timestamptz` | NULL | — | fim do período; `null` = aberto/atual |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |

Sem `updated_at` e sem `deleted_at` — a única mutação permitida é definir `ended_at` uma vez,
ao fechar o período. Nunca é apagada (nem por soft delete de processo).

**Constraints**

- `prh_pkey` — PRIMARY KEY (`id`)
- FK `space_id → spaces(id)` ON DELETE CASCADE
- FK `process_id → processes(id)` ON DELETE CASCADE
- FK `responsible_id → profiles(id)` ON DELETE RESTRICT
- FK `assigned_by → profiles(id)` ON DELETE SET NULL
- `prh_period_order_chk` — CHECK (`ended_at is null or ended_at >= started_at`)
- `prh_one_open_period_uq` — UNIQUE (`process_id`) — índice parcial `where ended_at is null`
  _(no máximo um período aberto por processo)_

**Triggers**

- `app.prh_set_space` — BEFORE INSERT: `space_id := (select space_id from processes where id = new.process_id)`.
- `app.prh_block_mutation` — BEFORE UPDATE: só permite a transição
  `old.ended_at is null → new.ended_at is not null` (fechar período); qualquer outra alteração
  é rejeitada. BEFORE DELETE: sempre rejeita.

**Índices**

- `prh_pkey` (id)
- `prh_one_open_period_uq` — UNIQUE parcial (`process_id`) `where ended_at is null`
- `prh_process_started_idx` (`process_id`, `started_at desc`)
- `prh_responsible_started_idx` (`responsible_id`, `started_at desc`) — relatórios futuros
- `prh_space_idx` (`space_id`)

**Regras de histórico**

1. **Criação do processo:** `app.processes_open_first_period` insere
   `{process_id, responsible_id = processes.responsible_id, assigned_by = created_by,
   reason='process_created', started_at = now(), ended_at = null}`.
2. **Transferência** (RPC `app.transfer_process`, atômica):
   a. `update process_responsible_history set ended_at = now() where process_id = X and ended_at is null;`
   b. `insert ... {responsible_id = <novo>, assigned_by = <admin>, reason='transfer', started_at = now(), ended_at = null};`
   c. `update processes set responsible_id = <novo> where id = X;`
   d. `app.write_audit_log('process.transfer', ...)`.
   Falha em qualquer passo ⇒ rollback total (nada persistido).
3. **Invariante:** a linha aberta reflete sempre `processes.responsible_id` (garantido pela
   RPC; coberto por teste pgTAP).
4. O histórico **não concede acesso** ao ex-responsável (ver RLS).

**Relacionamentos**

```
processes 1 ──< process_responsible_history >── 1 profiles (responsible_id)
                                            └── 0..1 profiles (assigned_by)
```

---

## Tabela `clients`

| Campo | Tipo | Null | Default | Observações |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `space_id` | `uuid` | NOT NULL | — | `→ spaces(id) on delete cascade` |
| `type` | `public.client_type` | NOT NULL | — | `PF` \| `PJ` |
| `name` | `text` | NOT NULL | — | nome (PF) ou razão social (PJ); não em branco |
| `document` | `extensions.citext` | NULL | — | CPF/CNPJ **normalizado (só dígitos)**; único no espaço quando presente |
| `email` | `extensions.citext` | NULL | — | formato básico validado |
| `phone` | `text` | NULL | — | E.164 (`^\+[1-9]\d{6,14}$`) quando presente |
| `birth_date` | `date` | NULL | — | **só PF** |
| `notification_opt_in` | `boolean` | NOT NULL | `false` | consentimento p/ WhatsApp; permanece `false` nesta fase |
| `opt_in_at` | `timestamptz` | NULL | — | quando o consentimento foi registrado |
| `created_by` | `uuid` | NOT NULL | — | `→ profiles(id) on delete restrict` |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |
| `updated_at` | `timestamptz` | NULL | — | trigger |
| `deleted_at` | `timestamptz` | NULL | — | soft delete (a exclusão pela app **anonimiza** os PII — ver Q3) |

**Constraints**

- `clients_pkey` — PRIMARY KEY (`id`)
- FK `space_id → spaces(id)` ON DELETE CASCADE
- FK `created_by → profiles(id)` ON DELETE RESTRICT
- `clients_name_not_blank_chk` — CHECK (`length(btrim(name)) > 0`)
- `clients_birth_date_pf_chk` — CHECK (`birth_date is null or type = 'PF'`)
- `clients_document_digits_chk` — CHECK (`document is null or document ~ '^\d+$'`)
- `clients_document_len_chk` — CHECK (`document is null
  or (type = 'PF' and length(document) = 11)
  or (type = 'PJ' and length(document) = 14)`) — **ver Q5**
- `clients_phone_e164_chk` — CHECK (`phone is null or phone ~ '^\+[1-9]\d{6,14}$'`)
- `clients_email_format_chk` — CHECK (`email is null or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'`)
- `clients_opt_in_requires_date_chk` — CHECK (`notification_opt_in = false or opt_in_at is not null`)
- `clients_document_uniq` — UNIQUE (`space_id`, `document`) — índice parcial
  `where document is not null and deleted_at is null`

**Triggers (BEFORE)**

- `app.set_updated_at`.
- `app.clients_normalize_document` — INSERT/UPDATE de `document`:
  `new.document := nullif(regexp_replace(coalesce(new.document,''), '\D', '', 'g'), '')`.
  Garante que a unicidade nunca dependa de o usuário ter digitado formatado.
- `app.clients_protect_immutable` — impede alterar `space_id` e `created_by`.

**Triggers (AFTER)**

- `app.audit_clients` — AFTER INSERT/UPDATE → `app.write_audit_log`.

**Índices**

- `clients_pkey` (id)
- `clients_document_uniq` — UNIQUE parcial (`space_id`, `document`)
  `where document is not null and deleted_at is null`
- `clients_space_idx` (`space_id`) `where deleted_at is null` — base da RLS/listagem
- `clients_space_type_idx` (`space_id`, `type`) `where deleted_at is null`
- `clients_name_trgm_idx` — GIN (`name` `extensions.gin_trgm_ops`) `where deleted_at is null`
  _(requer `pg_trgm`)_
- `clients_space_email_idx` (`space_id`, `email`) `where email is not null and deleted_at is null`
- `clients_space_phone_idx` (`space_id`, `phone`) `where phone is not null and deleted_at is null`
- `clients_space_birthdate_idx` (`space_id`, `birth_date`)
  `where type = 'PF' and deleted_at is null` — forward-compat p/ aniversário (Fase 13)

**Soft delete / unicidade:** `deleted_at`. A exclusão via aplicação (`app.soft_delete_client`)
seta `deleted_at` **e** anonimiza `name`, `document`, `email`, `phone`, `birth_date`
(mantém `id`, `space_id`, `type`, `created_at`, `created_by` e os vínculos em
`process_clients`). Como a unicidade parcial exclui `deleted_at is not null`, o documento
fica livre para novo cadastro. **Confirmar em Q3.**

---

## Tabela `process_clients` — vínculo N:N (sem papel processual)

| Campo | Tipo | Null | Default | Observações |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `space_id` | `uuid` | NOT NULL | — | `→ spaces(id) on delete cascade`; = `process.space_id` = `client.space_id` (trigger valida) |
| `process_id` | `uuid` | NOT NULL | — | `→ processes(id) on delete cascade` |
| `client_id` | `uuid` | NOT NULL | — | `→ clients(id) on delete restrict` |
| `created_by` | `uuid` | NOT NULL | — | `→ profiles(id) on delete restrict` |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |
| `updated_at` | `timestamptz` | NULL | — | trigger (registra quando o vínculo foi removido) |
| `deleted_at` | `timestamptz` | NULL | — | soft delete = "cliente removido do processo" |

**Sem** `role`, `role_note` ou equivalente — decisão de produto aprovada.

**Constraints**

- `process_clients_pkey` — PRIMARY KEY (`id`)
- FK `space_id → spaces(id)` ON DELETE CASCADE
- FK `process_id → processes(id)` ON DELETE CASCADE
- FK `client_id → clients(id)` ON DELETE RESTRICT
- FK `created_by → profiles(id)` ON DELETE RESTRICT
- `process_clients_active_uq` — UNIQUE (`process_id`, `client_id`) — índice parcial
  `where deleted_at is null` → **mesmo processo + mesmo cliente não gera dois vínculos ativos**.
  (Remover e re-vincular cria uma nova linha; o histórico de vínculos fica preservado.)

**Triggers (BEFORE)**

- `app.set_updated_at`.
- `app.pc_validate_tenant` — INSERT/UPDATE: carrega `process` e `client`; rejeita se
  `process.space_id <> client.space_id`, se qualquer um estiver com `deleted_at is not null`,
  e seta `new.space_id := process.space_id`. → bloqueia associação cross-tenant e associação
  a registros logicamente excluídos (item 16).
- `app.pc_protect_immutable` — impede alterar `space_id`, `process_id`, `client_id`,
  `created_by` (a única mutação normal é definir `deleted_at`).

**Triggers (AFTER)**

- `app.audit_process_clients` — AFTER INSERT/UPDATE → `app.write_audit_log`
  (`process.client.attach` / `process.client.detach`).

**Índices**

- `process_clients_pkey` (id)
- `process_clients_active_uq` — UNIQUE parcial (`process_id`, `client_id`) `where deleted_at is null`
- `process_clients_process_idx` (`process_id`) `where deleted_at is null` — "clientes de um processo"
- `process_clients_client_idx` (`client_id`) `where deleted_at is null` — "processos de um cliente"
- `process_clients_space_idx` (`space_id`)

**Soft delete:** `deleted_at`. Regra de duplicidade: a unique parcial acima.

---

# ETAPA B — ERD (textual)

```
                          ┌───────────────┐
                          │    spaces     │  (Fase 2)
                          └──────┬────────┘
             space_id (cascade)  │
        ┌───────────────┬────────┴───────────┬─────────────────────┐
        │               │                    │                     │
        ▼               ▼                    ▼                     ▼
 ┌────────────┐  ┌───────────────┐   ┌───────────────┐    ┌────────────────┐
 │  clients   │  │   processes   │   │ space_members │    │   profiles     │
 │            │  │               │   │   (Fase 2)    │    │   (Fase 2)     │
 │ type PF/PJ │  │ status enum   │   └───────────────┘    └───────┬────────┘
 │ document   │  │ cnj_number?   │                                │
 │ (uniq/esp) │  │ internal_ref? │        responsible_id ─────────┤ (restrict)
 │ phone      │  │ court_id  NN ─┼──────────────► courts ◄─────────┘ created_by
 │ email      │  │ responsible_id│                (catálogo GLOBAL, sem space_id;
 │ opt_in     │  │ created_by NN │                 SUPER_ADMIN gerencia; todos
 │ deleted_at │  │ deleted_at    │                 selecionam; usa `active`)
 └─────┬──────┘  └───┬───────┬───┘
       │ client_id   │       │ process_id
       │ (restrict)  │       │ (cascade)
       ▼             ▼       ▼
 ┌──────────────────────────────┐   ┌─────────────────────────────────┐
 │       process_clients        │   │  process_responsible_history    │
 │  N:N  clients ↔ processes     │   │  períodos: started_at/ended_at   │
 │  UNIQUE(process_id,client_id) │   │  reason: process_created|transfer│
 │    WHERE deleted_at IS NULL   │   │  UNIQUE(process_id)              │
 │  sem papel processual         │   │    WHERE ended_at IS NULL        │
 │  space_id = process = client  │   │  ledger imutável (sem soft del.) │
 │  deleted_at (soft delete)     │   │  responsible_id → profiles       │
 └──────────────────────────────┘   │  assigned_by    → profiles (0..1) │
                                    └─────────────────────────────────┘

Soft delete (deleted_at):  processes · clients · process_clients
Sem soft delete:           courts (usa active) · process_responsible_history (ledger)
Cascade de space:          clients, processes, process_clients, history  → ON DELETE CASCADE
Restrict (não órfão):      court_id, responsible_id, created_by, client_id → ON DELETE RESTRICT
```

Cardinalidades em linguagem de negócio:

- Um **usuário** é responsável por 0..N **processos** (e aparece em 0..N períodos do histórico).
- Um **processo** tem exatamente 1 responsável atual, 1 tribunal, 1 criador, 1..N períodos de histórico.
- Um **processo** tem 0..N **clientes**; um **cliente** tem 0..N **processos** (via `process_clients`).
- **Tribunal** é global; 1 tribunal é usado por 0..N processos de qualquer espaço.

---

# ETAPA C — ESTRATÉGIA DE RLS

## Separação de papéis sobre um processo (correção da revisão)

| Papel | Base | Pode LER | Pode EDITAR |
|---|---|---|---|
| **CRIADOR** | `processes.created_by = auth.uid()` | — (só se também for o responsável atual ou ADMIN) | **Sim, enquanto também for o responsável atual** (`assigned_user_id = auth.uid()`) — campos comuns, `active↔archived`, gerir clientes vinculados. **Não**: `assigned_user_id`, `court_id`, `close`. |
| **RESPONSÁVEL ATUAL** | `processes.assigned_user_id = auth.uid()` | **Sim** | **Não** (a menos que seja também o CRIADOR ou ADMIN). `assigned_user_id` é o dono operacional do acompanhamento, **não** dá permissão de edição. |
| **ADMIN do espaço** | `space_members.role = 'ADMIN'` no `space_id` | **Sim** (todos do espaço) | **Sim** (qualquer processo do espaço), inclusive `court_id`, `close`, e `assigned_user_id` via `transfer_process`. |
| **SUPER_ADMIN** | `profiles.is_super_admin` | **Não** | **Não** (sem acesso operacional). |

## Helpers novos (schema `app`, `SECURITY DEFINER`, `stable`, `search_path = ''`)

| Função | Retorna | Regra |
|---|---|---|
| `app.is_active_member_of(p_space uuid, p_profile uuid)` | `boolean` | existe `space_members` com esse `space_id`+`profile_id`, `status='active'`, papel `ADMIN`/`COLABORADOR`. Usado para validar o **alvo** de uma atribuição. |
| `app.can_read_process(p_process uuid)` | `boolean` | **LEITURA.** `false` se processo `deleted_at` ou inexistente; senão `app.is_space_admin(space)` **ou** (`app.is_active_member(space)` **e** `assigned_user_id = (select auth.uid())`). |
| `app.can_edit_process(p_process uuid)` | `boolean` | **EDIÇÃO (Q7 = SIM).** `false` se processo `deleted_at` ou inexistente; senão `app.is_space_admin(space)` **ou** (`created_by = (select auth.uid())` **e** `app.can_read_process(p_process)`) — o criador só edita **enquanto também for o responsável atual**. |

Reaproveitados da Fase 2: `app.is_super_admin()`, `app.is_active_member(space)`,
`app.is_space_admin(space)`, `app.role_in_space(space)`.

> **Renomeado** `app.can_manage_process` → `app.can_edit_process`: **ler** depende de
> `assigned_user_id`; **editar** depende de `created_by` **E** ainda ser o responsável atual.

## `courts`

| Operação | Política |
|---|---|
| SELECT | `to authenticated using (true)` — todos veem o catálogo (a UI filtra `active`). |
| INSERT | `with check (app.is_super_admin())` |
| UPDATE | `using (app.is_super_admin()) with check (app.is_super_admin())` |
| DELETE | **sem política** → negado a todos (desativar em vez de apagar). |

`grant select, insert, update on public.courts to authenticated;`

## `processes`

| Operação | `USING` | `WITH CHECK` |
|---|---|---|
| SELECT | `deleted_at is null and (app.is_space_admin(space_id) or (app.is_active_member(space_id) and assigned_user_id = (select auth.uid())))` | — |
| INSERT | — | `app.is_active_member(space_id) and created_by = (select auth.uid()) and ( app.is_space_admin(space_id) or assigned_user_id = (select auth.uid()) )` |
| UPDATE | `deleted_at is null and app.can_edit_process(id)` | `app.can_edit_process(id)` (campos sensíveis protegidos por trigger) |
| DELETE | **sem política** → soft delete via `update deleted_at` (coberto pela política de UPDATE) |

**Leitura** (`SELECT`) — inalterada:

- **ADMIN** — vê todos os processos **não excluídos** do próprio espaço.
- **COLABORADOR** — vê **somente** processos onde `responsible_id = auth.uid()`.
- **SUPER_ADMIN** — nenhuma política concede acesso (RN7).

**Edição** (`UPDATE`) — **corrigida**: depende de `created_by`, **não** de `responsible_id`:

- **ADMIN do espaço** — edita qualquer processo do espaço.
- **CRIADOR** (`created_by = auth.uid()`) — edita o processo que criou (campos comuns +
  `active↔archived` + clientes vinculados). Bloqueado por trigger: `responsible_id`,
  `court_id`, `status → closed` / `closed → *`.
- **RESPONSÁVEL atual que não é o criador** — **não edita** (é read-only). `responsible_id`
  é o dono operacional do acompanhamento, não dá permissão de edição.
- **Criação** — `WITH CHECK` do INSERT exige `created_by = auth.uid()` e, para não-ADMIN,
  `responsible_id = auth.uid()` (COLABORADOR só cria para si; nesse momento criador = responsável).
- **Transferência** — só via RPC `app.transfer_process` (ADMIN); o trigger
  `processes_guard_field_updates` bloqueia mudança de `responsible_id`/`court_id` e a
  transição de/para `closed` por não-ADMIN, mesmo em UPDATE direto.
- **Cross-tenant** — impossível: todo predicado ancora em `space_id` via helpers que exigem
  vínculo `active`.

> **Interação SELECT × UPDATE:** o Postgres também aplica as políticas de SELECT quando um
> `UPDATE` lê colunas existentes (ex.: `where id = …`). Combinando as duas, um COLABORADOR só
> edita, na prática, processos que **criou E dos quais ainda é o responsável atual**; um
> criador cujo processo foi **transferido** perde a edição porque a linha deixa de lhe ser
> visível. **Q7** trata de tornar essa negação explícita na política (não depender do Postgres).

`grant select, insert, update on public.processes to authenticated;`

## `process_responsible_history`

| Operação | Política |
|---|---|
| SELECT | `using (app.is_space_admin(space_id))` — só **ADMIN do espaço**. COLABORADOR e SUPER_ADMIN não leem. |
| INSERT / UPDATE / DELETE | **sem política** → negado a `authenticated`. Escrito apenas por `app.processes_open_first_period` e `app.transfer_process` (`SECURITY DEFINER`). |

`grant select on public.process_responsible_history to authenticated;`
`revoke insert, update, delete on public.process_responsible_history from authenticated, anon;`

> O histórico existe para auditoria/rastreabilidade/relatórios e **não concede acesso** ao
> ex-responsável ao processo em si.

## `clients`

| Operação | `USING` | `WITH CHECK` |
|---|---|---|
| SELECT | `deleted_at is null and app.is_active_member(space_id)` | — |
| INSERT | — | `app.is_active_member(space_id) and created_by = (select auth.uid())` |
| UPDATE | `deleted_at is null and (app.is_space_admin(space_id) or created_by = (select auth.uid()))` | `app.is_space_admin(space_id) or created_by = (select auth.uid())` (`space_id`/`created_by` imutáveis por trigger) |
| DELETE | **sem política** → soft delete/anonimização via RPC `app.soft_delete_client`. |

Leitura em linguagem de negócio:

- **COLABORADOR e ADMIN** — veem **todos** os clientes não excluídos do próprio espaço
  (permite reutilizar cliente ao criar processo). Qualquer membro ativo pode **criar** cliente.
- **Editar** — ADMIN do espaço **ou** quem criou o cliente.
- **SUPER_ADMIN** — sem acesso.
- **Cross-tenant** — impossível (predicado por `space_id`).

`grant select, insert, update on public.clients to authenticated;`

## `process_clients`

| Operação | Política |
|---|---|
| SELECT | `using (deleted_at is null and app.can_read_process(process_id))` — quem **lê** o processo (ADMIN ou responsável atual) vê os vínculos |
| INSERT | `with check (app.can_edit_process(process_id) and created_by = (select auth.uid()))` — quem **edita** o processo (ADMIN ou criador) vincula clientes; trigger `pc_validate_tenant` garante mesmo espaço e registros não excluídos |
| UPDATE | `using (deleted_at is null and app.can_edit_process(process_id)) with check (app.can_edit_process(process_id))` — na prática só define `deleted_at` (remover vínculo) |
| DELETE | **sem política** → soft delete via UPDATE |

- **Ler** os vínculos = ler o processo (ADMIN do espaço **ou** responsável atual).
- **Vincular / desvincular** cliente = editar o processo (ADMIN do espaço **ou** criador).
  Um responsável atual que não seja o criador **vê** os clientes do processo mas **não**
  adiciona nem remove.
- `pc_validate_tenant` recusa `process.space_id <> client.space_id` e recusa processo/cliente
  com `deleted_at is not null`.
- SUPER_ADMIN sem acesso (herda dos helpers).

`grant select, insert, update on public.process_clients to authenticated;`

## RPCs desta fase (implementação na Etapa H — listadas aqui)

| RPC | Papel | O que faz (atômico) |
|---|---|---|
| `app.transfer_process(p_process uuid, p_new_responsible uuid)` | ADMIN do espaço | valida ADMIN + novo responsável membro ativo; fecha período aberto; abre novo (`reason='transfer'`); atualiza `processes.responsible_id`; `write_audit_log('process.transfer', before/after)`. Falha ⇒ rollback total. |
| `app.soft_delete_client(p_client uuid)` | ADMIN do espaço ou criador | seta `deleted_at` + anonimiza PII; `write_audit_log('client.soft_delete')`. **Ver Q3.** |

Demais operações (criar/editar processo, criar/editar cliente, arquivar/reativar/encerrar,
soft delete de processo, vincular/desvincular cliente) usam **UPDATE/INSERT direto via
PostgREST**, com RLS + triggers garantindo regras e auditoria — sem RPC dedicada.

---

# ETAPA D — ÍNDICES E CONSTRAINTS (consolidado)

## Extensões necessárias

- `pg_trgm` (schema `extensions`) — busca parcial por `clients.name` e `processes.internal_ref`.
  _(É uma decisão técnica; se preferir evitar a extensão, a busca por nome/ref cai para
  `ILIKE` sem índice dedicado — ver "Decisões técnicas".)_

## Unicidade (todas parciais)

| Índice | Tabela | Colunas | Predicado |
|---|---|---|---|
| `processes_cnj_uniq` | `processes` | (`space_id`, `cnj_number`) | `cnj_number is not null and deleted_at is null` |
| `clients_document_uniq` | `clients` | (`space_id`, `document`) | `document is not null and deleted_at is null` |
| `process_clients_active_uq` | `process_clients` | (`process_id`, `client_id`) | `deleted_at is null` |
| `prh_one_open_period_uq` | `process_responsible_history` | (`process_id`) | `ended_at is null` |
| `courts_datajud_code_uniq` | `courts` | (`datajud_code`) | `datajud_code is not null` |

## CHECK constraints

| Constraint | Regra |
|---|---|
| `processes_cnj_format_chk` | máscara CNJ `NNNNNNN-DD.AAAA.J.TR.OOOO` quando presente (Q4) |
| `processes_internal_ref_not_blank_chk` | `internal_ref` não em branco quando presente |
| `clients_name_not_blank_chk` | `name` não em branco |
| `clients_birth_date_pf_chk` | `birth_date` só quando `type = 'PF'` |
| `clients_document_digits_chk` | `document` só dígitos |
| `clients_document_len_chk` | 11 (PF) / 14 (PJ) (Q5) |
| `clients_phone_e164_chk` | E.164 quando presente |
| `clients_email_format_chk` | formato de e-mail básico |
| `clients_opt_in_requires_date_chk` | `opt_in = true ⇒ opt_in_at not null` |
| `prh_period_order_chk` | `ended_at is null or ended_at >= started_at` |
| `courts_name_not_blank_chk` / `courts_jurisdiction_not_blank_chk` | não em branco |

## Foreign keys e política de exclusão

| FK | ON DELETE | Motivo |
|---|---|---|
| `*.space_id → spaces(id)` | CASCADE | apagar um espaço remove seu conteúdo operacional |
| `processes.court_id → courts(id)` | RESTRICT | não apagar tribunal em uso |
| `processes.responsible_id → profiles(id)` | RESTRICT | não deixar processo sem responsável |
| `processes.created_by → profiles(id)` | RESTRICT | preservar autoria |
| `process_clients.process_id → processes(id)` | CASCADE | vínculo não sobrevive ao processo |
| `process_clients.client_id → clients(id)` | RESTRICT | usar soft delete no cliente, não apagar |
| `process_responsible_history.process_id → processes(id)` | CASCADE | ledger acompanha o processo |
| `process_responsible_history.responsible_id → profiles(id)` | RESTRICT | preservar rastreabilidade |
| `*.assigned_by / created_by (history, courts)` | SET NULL | manter a linha mesmo se o autor sair |

## Índices de desempenho (não-únicos)

`processes`: `(space_id, responsible_id) where deleted_at is null`,
`(space_id, status) where deleted_at is null`,
`(space_id, created_at desc) where deleted_at is null`, `(court_id)`,
GIN trgm `(internal_ref) where deleted_at is null`.

`clients`: `(space_id) where deleted_at is null`,
`(space_id, type) where deleted_at is null`,
GIN trgm `(name) where deleted_at is null`,
`(space_id, email) where email is not null and deleted_at is null`,
`(space_id, phone) where phone is not null and deleted_at is null`,
`(space_id, birth_date) where type = 'PF' and deleted_at is null`.

`process_clients`: `(process_id) where deleted_at is null`,
`(client_id) where deleted_at is null`, `(space_id)`.

`process_responsible_history`: `(process_id, started_at desc)`,
`(responsible_id, started_at desc)`, `(space_id)`.

`courts`: `(type, jurisdiction)`, `(name) where active`.

---

# ETAPA E — ESTRATÉGIA DE AUDITORIA

**Só a infraestrutura existente** (`public.audit_logs` + `app.write_audit_log(...)`). Nenhum
mecanismo novo.

## Mecanismo

Gatilhos `AFTER INSERT/UPDATE` por tabela chamam `app.write_audit_log`. Cada gatilho:

- deriva o **verbo** a partir da mudança (ver tabela abaixo);
- grava `before`/`after` **apenas com as chaves alteradas** (em UPDATE) ou o registro (em INSERT);
- usa `actor_id = auth.uid()` (nulo ⇒ `actor_type = 'system'`);
- `context` recebe o que estiver disponível (ex.: `request_id` via GUC quando a aplicação o define).

Operações multi-passo (transferência, anonimização de cliente) rodam em RPC `SECURITY
DEFINER` que, além do efeito, chamam `app.write_audit_log` com o verbo específico e um
`context` mais rico; a RPC sinaliza via GUC de sessão (`app.audit_verb`) para o gatilho
genérico **não** emitir um `process.update` redundante.

## Eventos por tabela

| Tabela | Verbo (`audit_logs.action`) | Quando |
|---|---|---|
| `processes` | `process.create` | AFTER INSERT |
| | `process.update` | AFTER UPDATE de campos "comuns" (`internal_ref`, `cnj_number`) |
| | `process.transfer` | RPC `transfer_process` (troca de `responsible_id`) |
| | `process.archive` | UPDATE `status: * → archived` |
| | `process.reactivate` | UPDATE `status: archived → active` |
| | `process.close` | UPDATE `status: * → closed` |
| | `process.soft_delete` | UPDATE `deleted_at: null → not null` |
| `clients` | `client.create` | AFTER INSERT |
| | `client.update` | AFTER UPDATE |
| | `client.soft_delete` | RPC `soft_delete_client` (`deleted_at` + anonimização) |
| `process_clients` | `process.client.attach` | AFTER INSERT |
| | `process.client.detach` | UPDATE `deleted_at: null → not null` |
| `courts` | `court.create` | AFTER INSERT |
| | `court.update` | AFTER UPDATE (exceto `active`) |
| | `court.activate` / `court.deactivate` | UPDATE `active: false→true` / `true→false` |

Esses verbos serão adicionados ao catálogo `AUDIT_ACTIONS` em `packages/domain` na Etapa H
(hoje o catálogo só tem os da fundação).

`audit_logs` continua **append-only** (gatilhos da Fase 2 bloqueiam UPDATE/DELETE) e a
leitura continua restrita a **ADMIN do espaço** / **SUPER_ADMIN global** (política existente).
Auditoria de `courts` grava `space_id = null` (ação de plataforma) → visível só ao SUPER_ADMIN.

---

# DECISÕES TÉCNICAS (não alteram comportamento de produto — tomadas e documentadas)

1. **CNJ armazenado formatado** (com máscara) em `citext`, com CHECK de formato; a unicidade
   parcial ignora processos com `deleted_at`.
2. **Documento do cliente armazenado só com dígitos** (trigger normaliza antes de qualquer
   comparação); CHECK de comprimento por tipo.
3. **`pg_trgm`** habilitado para busca parcial por `clients.name` e `processes.internal_ref`.
4. **Auditoria por gatilhos `AFTER`** que chamam `app.write_audit_log` (infra existente),
   com verbo derivado da mudança; RPCs usam GUC de contexto para evitar log redundante.
5. Helpers `app.can_read_process` (leitura = ADMIN do espaço **ou** responsável atual) e
   `app.can_edit_process` (edição = ADMIN do espaço **ou** criador) centralizam a regra;
   reaproveitados em `process_clients`. **Ler depende de `responsible_id`; editar depende de
   `created_by`** — correção da revisão.
6. `process_responsible_history` é **ledger** — sem `updated_at`, sem `deleted_at`; única
   mutação permitida é fechar `ended_at` (trigger).
7. FKs para `profiles`/`courts` com `ON DELETE RESTRICT` (sem órfãos, sem cascata acidental);
   `space_id` com `CASCADE`.
8. Índices dos caminhos quentes são **parciais** `where deleted_at is null`.
9. `courts.datajud_code` (nullable, único quando presente) entra já agora para a Fase 4 não
   precisar de migration de coluna.
10. Só **2 RPCs** nesta fase (`transfer_process`, `soft_delete_client`); o resto é
    INSERT/UPDATE direto sob RLS + triggers.

---

# PERGUNTAS DE PRODUTO — preciso da sua resposta antes da Etapa G

| # | Pergunta | Recomendação |
|---|---|---|
| ~~Q1~~ | **RESOLVIDA pela revisão.** Edição de processo = `created_by = auth.uid()` **OU** ADMIN do espaço — **não** `responsible_id`. O responsável atual que não criou o processo é read-only. `court_id`, `responsible_id` (transferência) e `close`/reabrir = exclusivos do ADMIN. Refletido nos helpers, na policy de `processes`/`process_clients` e no trigger `processes_guard_field_updates`. | — |
| **Q7** | Um COLABORADOR **criador** cujo processo foi **transferido** para outra pessoa: pela regra de leitura ele deixa de ver o processo e, na prática, não consegue editá-lo (a linha não lhe é visível). Quer que a **política de UPDATE também o negue explicitamente**, sem depender do Postgres aplicar SELECT durante UPDATE? | **Sim** — `app.can_edit_process` = ADMIN do espaço **OU** (`created_by = auth.uid()` **E** `app.can_read_process(id)`). Não contradiz a regra (edição segue sendo criador/ADMIN), só torna a negação pós-transferência explícita e independente do comportamento do Postgres. |
| **Q2** | `closed` é reversível? | `closed → active` só por ADMIN, auditado (`process.reactivate`). Encerrar (`close`) = só ADMIN. |
| **Q3** | O `soft_delete_client` **anonimiza** os PII (`name`, `document`, `email`, `phone`, `birth_date`) além de setar `deleted_at`? Ou só marca `deleted_at` e a anonimização vem depois? | Anonimizar já no soft delete (era a recomendação NEW-6 aprovada). Mantém `id`, `type`, `created_at`, vínculos. |
| **Q4** | O CHECK de formato do CNJ (`NNNNNNN-DD.AAAA.J.TR.OOOO`) rejeita números antigos/fora do padrão. Aceitável, ou o campo aceita texto livre (validação só no frontend)? | Manter o CHECK do padrão CNJ; número fora do padrão vai em `internal_ref`. |
| **Q5** | O CHECK de comprimento do documento (11 PF / 14 PJ) rejeita passaporte/documento estrangeiro; nesse caso o cliente PF fica sem `document`. Ok? | Ok — documento é opcional; estrangeiro sem CPF fica sem `document`. |
| **Q6** | Pode-se criar/manter um processo apontando para um `court` com `active = false`? | Não permitir **selecionar** tribunal inativo em processo novo (nem em troca de `court_id`); processos existentes mantêm o tribunal. |

---

# PRÓXIMO PASSO

**Aguardo sua aprovação deste modelo (Etapa F)** e as respostas de **Q2–Q7** (Q1 foi
resolvida pela sua correção da regra de edição). Só então crio as migrations (Etapa G) e
sigo para backend → frontend → testes → `npm test` / `test:web` / `db:test` / `lint` /
`build` (Etapas H–K). Não avanço para a Fase 4.
