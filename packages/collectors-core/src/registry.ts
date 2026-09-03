import { SourceAlreadyRegisteredError, SourceNotRegisteredError } from './errors.js';
import type {
  ProcessDataSource,
  ProcessDataSourceFactory,
  SourceKind,
  SourceTarget,
} from './source.js';

/**
 * Registro de fontes de acompanhamento. É o único ponto que conhece o conjunto
 * de estratégias disponíveis; o núcleo resolve fontes por aqui e nunca com
 * `if (kind === 'tjam')`.
 */
export class SourceRegistry {
  private readonly factories = new Map<SourceKind, ProcessDataSourceFactory>();

  register(kind: SourceKind, factory: ProcessDataSourceFactory): this {
    if (this.factories.has(kind)) {
      throw new SourceAlreadyRegisteredError(kind);
    }
    this.factories.set(kind, factory);
    return this;
  }

  has(kind: SourceKind): boolean {
    return this.factories.has(kind);
  }

  kinds(): SourceKind[] {
    return [...this.factories.keys()];
  }

  create(kind: SourceKind): ProcessDataSource {
    const factory = this.factories.get(kind);
    if (!factory) {
      throw new SourceNotRegisteredError(kind);
    }
    return factory();
  }

  /** Primeira fonte registrada capaz de tratar o alvo, se houver. */
  resolveFor(kind: SourceKind, target: SourceTarget): ProcessDataSource {
    const source = this.create(kind);
    if (!source.canHandle(target)) {
      throw new SourceNotRegisteredError(kind);
    }
    return source;
  }
}
