import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

/**
 * Política de Privacidade e Termos de Uso (LGPD — Lei 13.709/2018).
 *
 * ATENÇÃO: texto-base, NÃO é parecer jurídico. Antes de publicar, preencher os
 * campos entre colchetes e revisar com o responsável jurídico/encarregado (DPO).
 * O JuriFlow atua como OPERADOR dos dados que os escritórios (CONTROLADORES)
 * cadastram sobre seus clientes; e como CONTROLADOR dos dados de conta dos
 * próprios usuários.
 */
@Component({
  selector: 'jf-legal-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <main class="legal">
      <a routerLink="/login" class="legal__back">← Voltar</a>

      @if (kind === 'privacy') {
        <h1>Política de Privacidade</h1>
        <p class="legal__meta">Última atualização: [DATA]</p>

        <h2>1. Quem somos</h2>
        <p>
          O JuriFlow é operado por [RAZÃO SOCIAL], inscrita no CNPJ [CNPJ], com sede em [ENDEREÇO].
          Encarregado pelo tratamento de dados (DPO): [NOME] — [E-MAIL DO ENCARREGADO].
        </p>

        <h2>2. Papéis no tratamento</h2>
        <p>
          Os escritórios que contratam o JuriFlow são <strong>controladores</strong> dos dados que
          cadastram sobre seus clientes e processos; o JuriFlow atua como <strong>operador</strong>,
          tratando esses dados apenas conforme as instruções do escritório. Para os dados de conta
          dos usuários (nome, e-mail, telefone, foto), o JuriFlow é controlador.
        </p>

        <h2>3. Dados tratados</h2>
        <ul>
          <li>Conta: nome, e-mail, telefone, foto de perfil, registros de acesso.</li>
          <li>
            Cadastrados pelo escritório: dados de clientes (nome, CPF/CNPJ, telefone, e-mail, data
            de nascimento) e de processos (número CNJ, tribunal, movimentações públicas).
          </li>
          <li>
            Notificações: telefone de destino, conteúdo e status de envio das mensagens de WhatsApp.
          </li>
          <li>
            Auditoria: registro de quem fez o quê e quando, para segurança e prestação de contas.
          </li>
        </ul>

        <h2>4. Finalidades e bases legais</h2>
        <ul>
          <li>Prestar o serviço contratado — execução de contrato (art. 7º, V).</li>
          <li>
            Consultar movimentações processuais públicas e avisar clientes e responsáveis — execução
            de contrato e legítimo interesse do escritório (art. 7º, V e IX).
          </li>
          <li>
            Segurança, prevenção a fraudes e trilha de auditoria — legítimo interesse (art. 7º, IX).
          </li>
          <li>Cumprimento de obrigações legais e regulatórias (art. 7º, II).</li>
        </ul>

        <h2>5. Compartilhamento</h2>
        <p>
          Os dados são armazenados em provedores de infraestrutura contratados pelo JuriFlow
          ([PROVEDORES — ex.: Supabase (banco de dados), hospedagem do aplicativo, servidor de envio
          de WhatsApp]). Não vendemos dados. Compartilhamos apenas quando necessário para prestar o
          serviço ou por obrigação legal.
        </p>

        <h2>6. Retenção</h2>
        <p>
          Mantemos os dados enquanto o contrato com o escritório estiver ativo e, depois, pelo prazo
          necessário ao cumprimento de obrigações legais: [PRAZOS DE RETENÇÃO]. Registros de
          auditoria são imutáveis durante esse período.
        </p>

        <h2>7. Direitos do titular</h2>
        <p>
          Você pode solicitar confirmação de tratamento, acesso, correção, anonimização,
          portabilidade, eliminação e informações sobre compartilhamento (art. 18). Se você é
          cliente de um escritório, faça o pedido ao próprio escritório (controlador); nós o
          apoiaremos no atendimento. Para dados da sua conta, escreva para [E-MAIL DO ENCARREGADO].
        </p>

        <h2>8. Segurança</h2>
        <p>
          Isolamento dos dados de cada escritório no banco de dados, controle de acesso por papel,
          conexões criptografadas e trilha de auditoria de todas as operações.
        </p>
      } @else {
        <h1>Termos de Uso</h1>
        <p class="legal__meta">Última atualização: [DATA]</p>

        <h2>1. O serviço</h2>
        <p>
          O JuriFlow é uma plataforma para escritórios de advocacia cadastrarem processos e
          clientes, acompanharem movimentações processuais públicas e enviarem avisos por WhatsApp.
        </p>

        <h2>2. Contas e acesso</h2>
        <p>
          O acesso é feito por convite do escritório. Cada usuário é responsável por manter a senha
          em sigilo e pelas ações realizadas com a sua conta. O administrador do escritório define
          quem tem acesso e com qual papel.
        </p>

        <h2>3. Responsabilidades do escritório</h2>
        <ul>
          <li>Ter base legal para cadastrar e notificar seus clientes (LGPD).</li>
          <li>Manter corretos os dados cadastrados, em especial telefones de notificação.</li>
          <li>Usar o envio de WhatsApp apenas para comunicações relacionadas aos processos.</li>
        </ul>

        <h2>4. Limitações</h2>
        <p>
          As movimentações vêm de consultas às fontes públicas dos tribunais e podem sofrer atrasos
          ou indisponibilidades dessas fontes. O JuriFlow é uma ferramenta de apoio e não substitui
          o acompanhamento oficial dos prazos processuais pelo advogado responsável.
        </p>

        <h2>5. Dados pessoais</h2>
        <p>
          O tratamento de dados segue a <a routerLink="/privacidade">Política de Privacidade</a>.
        </p>

        <h2>6. Contato</h2>
        <p>[RAZÃO SOCIAL] — [E-MAIL DE CONTATO].</p>
      }
    </main>
  `,
  styles: [
    `
      .legal {
        max-width: 46rem;
        margin: 0 auto;
        padding: 2.5rem 1rem 4rem;
        line-height: 1.6;
        color: var(--jf-text, #0f172a);
      }
      .legal__back {
        display: inline-block;
        margin-bottom: 1.5rem;
      }
      h1 {
        font-size: 1.6rem;
        margin: 0 0 0.25rem;
      }
      h2 {
        font-size: 1.05rem;
        margin: 1.75rem 0 0.5rem;
      }
      .legal__meta {
        color: var(--jf-text-muted, #64748b);
        font-size: 0.85rem;
        margin: 0;
      }
      ul {
        padding-left: 1.25rem;
      }
    `,
  ],
})
export class LegalPageComponent {
  protected readonly kind: 'privacy' | 'terms' =
    inject(ActivatedRoute).snapshot.data['kind'] === 'terms' ? 'terms' : 'privacy';
}
