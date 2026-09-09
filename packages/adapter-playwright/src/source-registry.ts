/**
 * Cola da Etapa 11 — registra a fonte **real** `projudi_tjam` (Playwright + Edge)
 * num `SourceRegistry` do `@juriflow/collectors-core`, para o `runCollectorTick`
 * do `@juriflow/collector-engine` resolvê-la e persistir o resultado pelas RPCs
 * (`claim_pending_collection_run` / `submit_collection_result`).
 *
 * É só registro/composição: nenhuma lógica de coleta aqui. A coleta é do
 * `PlaywrightCollector` (Etapa 9) + `TjamProjudiEdgeRunner` (Etapa 10).
 */
import type { SourceKind, SourceRegistry } from '@juriflow/collectors-core';

import type { BrowserCaseRunner } from './browser-runner.js';
import { PlaywrightCollector } from './playwright-collector.js';
import { TjamProjudiEdgeRunner, type TjamProjudiEdgeRunnerOptions } from './tjam-projudi-runner.js';

export interface RegisterTjamProjudiOptions {
  /** `source_kind` sob o qual registrar. Default: `'projudi_tjam'`. */
  readonly kind?: SourceKind;
  /**
   * Runner já pronto. Se omitido, cria um `TjamProjudiEdgeRunner` com
   * `runnerOptions`. Serve para testes injetarem um `FakeBrowserCaseRunner`.
   */
  readonly runner?: BrowserCaseRunner;
  /** Opções do `TjamProjudiEdgeRunner` quando `runner` não é passado. */
  readonly runnerOptions?: TjamProjudiEdgeRunnerOptions;
}

/**
 * Registra `projudi_tjam` (ou `options.kind`) no `registry`. Cada `create()`
 * devolve um `PlaywrightCollector` novo; o runner (Edge) é reaproveitado quando
 * passado em `options.runner`, senão um novo `TjamProjudiEdgeRunner` por
 * `create()` — que abre e fecha o Edge dentro de cada `run()`.
 *
 * Devolve o mesmo `registry` para encadear.
 */
export function registerTjamProjudiSource(
  registry: SourceRegistry,
  options: RegisterTjamProjudiOptions = {},
): SourceRegistry {
  const kind: SourceKind = options.kind ?? 'projudi_tjam';
  registry.register(
    kind,
    () =>
      new PlaywrightCollector({
        kind,
        runner: options.runner ?? new TjamProjudiEdgeRunner(options.runnerOptions ?? {}),
      }),
  );
  return registry;
}
