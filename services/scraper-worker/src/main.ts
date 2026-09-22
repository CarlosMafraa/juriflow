import cron from 'node-cron';
import { SourceRegistry } from '@juriflow/collectors-core';
import { loadConfig } from './config.js';
import { createLogger } from './infra/logger.js';
import { createSupabaseClient } from './infra/supabase-client.js';
import { SupabaseProcessRepository } from './infra/supabase-process.repository.js';
import { SupabaseMovementRepository } from './infra/supabase-movement.repository.js';
import { SupabaseRecipientResolver } from './infra/supabase-recipient-resolver.js';
import { SupabaseNotificationLog } from './infra/supabase-notification-log.js';
import { WahaNotifier } from './infra/waha-notifier.js';
import { GeneralMovementTemplate } from './domain/message-template.js';
import { TjamProjudiAdapter } from './adapters/tjam-projudi.adapter.js';
import { TrackProcessUseCase } from './usecases/track-process.usecase.js';
import { DailyCheckJob } from './jobs/daily-check.job.js';
import { createHttpServer } from './http/server.js';

/**
 * Composition root: o único lugar que conhece Supabase, Playwright e WAHA ao
 * mesmo tempo. Todo o resto do código (usecases/, domain/, ports/) só conhece
 * interfaces — trocar Supabase por outro backend, ou WAHA por outro canal,
 * muda só este arquivo e a classe concreta correspondente.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  const supabase = createSupabaseClient(config);
  const processRepository = new SupabaseProcessRepository(supabase);
  const movementRepository = new SupabaseMovementRepository(supabase);
  const recipientResolver = new SupabaseRecipientResolver(supabase);
  const notificationLog = new SupabaseNotificationLog(supabase);
  const notifier = new WahaNotifier(config.wahaBaseUrl, config.wahaApiKey, config.wahaSession);
  const messageTemplate = new GeneralMovementTemplate();

  const tjamAdapter = new TjamProjudiAdapter({
    baseUrl: config.tjamProjudiBaseUrl,
    headless: config.scraperHeadless,
    logger,
  });

  const sourceRegistry = new SourceRegistry();
  // Único ponto de registro de fontes (ADR-0004). Uma nova fonte = 1 linha aqui.
  sourceRegistry.register('projudi_tjam', () => tjamAdapter);

  const useCase = new TrackProcessUseCase(
    sourceRegistry,
    processRepository,
    movementRepository,
    recipientResolver,
    notifier,
    notificationLog,
    messageTemplate,
    logger,
  );

  const dailyJob = new DailyCheckJob(useCase, processRepository, logger, config.scraperThrottleMs);
  cron.schedule(config.dailyCheckCron, () => {
    dailyJob
      .run()
      .catch((error) =>
        logger.error('Rotina diária falhou de forma inesperada.', { error: String(error) }),
      );
  });
  logger.info('Rotina diária agendada.', { cron: config.dailyCheckCron });

  const server = createHttpServer(useCase, processRepository, logger);
  server.listen(config.httpPort, () => logger.info('Worker no ar.', { port: config.httpPort }));

  const shutdown = async (): Promise<void> => {
    logger.info('Encerrando worker...');
    server.close();
    await tjamAdapter.dispose();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('Falha fatal ao iniciar o worker:', error);
  process.exit(1);
});
