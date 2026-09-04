/**
 * JuriFlow — smoke test MANUAL do adapter DataJud (Acompanhamento-B).
 *
 * NÃO faz parte da suíte automatizada e NUNCA deve rodar em CI: é a única via
 * que faz uma chamada REAL à API Pública do DataJud (CNJ), e só quando você
 * fornece explicitamente um número de processo.
 *
 * Uso:
 *   DATAJUD_API_KEY=<sua-chave> node scripts/datajud-smoke.mjs \
 *     --cnj 0000000-00.0000.0.00.0000 --alias api_publica_tjam
 *
 * Sem `DATAJUD_API_KEY`  → informa que o smoke está indisponível e sai com 0
 *                          (não quebra nenhum fluxo).
 * A chave NUNCA é impressa. Nada é persistido. Nenhuma escrita no banco.
 */
import { DataJudAdapter } from '@juriflow/adapter-datajud';

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const apiKey = process.env.DATAJUD_API_KEY;
const cnj = arg('cnj');
const alias = arg('alias', 'api_publica_tjam');

if (!apiKey) {
  console.error('DATAJUD_API_KEY não definido — smoke test indisponível. Nada a fazer.');
  process.exit(0);
}
if (!cnj) {
  console.error(
    'Informe --cnj <numero> (com ou sem máscara). Ex.: --cnj 0000000-00.0000.8.04.0001',
  );
  process.exit(2);
}

const adapter = new DataJudAdapter({
  apiKey,
  resolveStrategy: () => ({ alias, timeoutMs: 30000, maxMovements: 5000 }),
  logger: (level, message) => console.error(`[${level}] ${message}`),
});

console.error(`Consultando o DataJud (alias=${alias})… — chamada REAL, apenas leitura.`);

try {
  const result = await adapter.fetch({
    target: { cnjNumber: cnj, courtId: 'smoke', params: {} },
    requestId: 'smoke',
  });

  const dates = result.movements
    .map((m) => m.occurredAt)
    .filter(Boolean)
    .sort();
  const ctx = result.movements[0]?.raw?.processo ?? {};

  console.error('--- resultado (somente informações não sensíveis) ---');
  console.error(
    JSON.stringify(
      {
        movimentos: result.movements.length,
        partial: result.partial === true,
        primeiroMovimento: dates[0] ?? null,
        ultimoMovimento: dates[dates.length - 1] ?? null,
        tribunal: ctx.tribunal ?? null,
        grau: ctx.grau ?? null,
        dataHoraUltimaAtualizacao: ctx.dataHoraUltimaAtualizacao ?? null,
      },
      null,
      2,
    ),
  );
  if (result.movements.length === 0) {
    console.error('(zero movimentos: processo ausente no índice do DataJud — não é erro.)');
  }
} catch (err) {
  console.error(
    `Falha classificada: code=${err.code ?? 'unknown'} retriable=${err.retriable ?? '?'}`,
  );
  console.error(`Mensagem: ${err.message}`);
  process.exit(1);
}
