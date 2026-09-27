/**
 * Executa tarefas uma de cada vez, na ordem de chegada. A rotina diária e a
 * fila de "consultar agora" dividem o mesmo navegador (Playwright) e a mesma
 * fonte (Projudi) — nunca devem coletar em paralelo.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
