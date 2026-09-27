# Planos dos espaços

Cada espaço (escritório) tem dois limites, definidos pela administração da
plataforma em **/admin → Espaços**:

| Limite                   | O que conta                                                                        | Padrão (Free) |
| ------------------------ | ---------------------------------------------------------------------------------- | ------------- |
| Processos                | Todo processo não excluído: ativo, encerrado ou arquivado                          | 10            |
| Sincronização automática | Processos ativos, com CNJ, tribunal com coleta e "Sincronização automática" ligada | 3             |

## Como funciona hoje (v1)

- **Cadastro acima do limite de processos** é recusado com a mensagem
  "Limite do plano atingido". Excluir um processo arquivado libera a vaga;
  arquivar **não** libera.
- **Sincronização**: um processo novo entra sincronizando enquanto houver vaga;
  quando o limite está cheio, entra com a sincronização desligada. Ligar
  manualmente acima do limite é recusado com o motivo. Reativar um arquivado
  com o limite cheio também o traz sem sincronização.
- "Consultar agora" só vale para processos com sincronização ligada — senão a
  consulta manual contornaria o limite.
- As regras ficam no banco (`app.processes_enforce_plan`, migração 0036). A
  tela só antecipa o aviso.
- O ADMIN do espaço vê o uso ("7 de 10") no dashboard e na lista de processos.
  A administração da plataforma vê **só os limites**, nunca o uso nem os
  processos (regra: a plataforma sabe que o espaço existe, não o que tem dentro).

## Futuro: mitigação ao mudar os valores

Hoje, alterar um limite **não mexe em nada que já existe** — só vale para os
próximos cadastros/ativações. Casos a tratar:

1. **Reduzir o limite de processos abaixo do uso** (ex.: 40 processos, plano cai
   para 10): definir a política — bloquear só novos cadastros (comportamento
   atual), prazo para o escritório arquivar/excluir, ou modo somente leitura
   acima do limite.
2. **Reduzir o limite de sincronização abaixo do uso** (ex.: 8 sincronizando,
   plano cai para 3): a coleta diária continuaria nos 8. Precisa escolher quais
   5 param — por critério automático (mais antigos, sem movimentação recente) ou
   pedindo ao ADMIN que escolha, com aviso no dashboard.
3. **Aumentar os limites**: processos que entraram sem sincronização por falta de
   vaga não ligam sozinhos. Avaliar ligar automaticamente até o novo limite, ou
   só avisar o ADMIN de que há vagas.
4. **Planos nomeados** (Free, Pro...): hoje os valores são por espaço. Um
   catálogo de planos com preço e troca de plano pelo próprio escritório é um
   passo seguinte.
5. **Avisos de proximidade** do limite (ex.: 80%) para o ADMIN.
