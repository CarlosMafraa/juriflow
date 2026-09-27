/**
 * Cliente HTTP do ciclo de vida de sessão do WAHA (criar, status, QR code,
 * logout). Endpoints confirmados contra a imagem `devlikeapro/waha` em uso
 * (`GET/POST /api/sessions`, `GET /api/{session}/auth/qr`). Complementa o
 * `WahaNotifier`, que só cobre envio (`POST /api/sendText`).
 */
/** Sem timeout, um WAHA travado prende o polling para sempre. */
const WAHA_TIMEOUT_MS = 15_000;

export type WahaSessionStatus = 'STARTING' | 'SCAN_QR_CODE' | 'WORKING' | 'FAILED' | 'STOPPED';

export class WahaSessionGateway {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  /** `null` se a sessão nunca foi criada no WAHA. */
  async getStatus(sessionName: string): Promise<WahaSessionStatus | null> {
    const response = await fetch(`${this.baseUrl}/api/sessions/${sessionName}`, {
      headers: { 'X-Api-Key': this.apiKey },
      signal: AbortSignal.timeout(WAHA_TIMEOUT_MS),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(await this.describeError(response, 'consultar sessão'));
    const body = (await response.json()) as { status: WahaSessionStatus };
    return body.status;
  }

  /** Cria (se não existir) e inicia a sessão. Idempotente no lado do WAHA. */
  async start(sessionName: string): Promise<void> {
    const exists = (await this.getStatus(sessionName)) !== null;
    const response = exists
      ? await fetch(`${this.baseUrl}/api/sessions/${sessionName}/start`, {
          method: 'POST',
          headers: { 'X-Api-Key': this.apiKey },
          signal: AbortSignal.timeout(WAHA_TIMEOUT_MS),
        })
      : await fetch(`${this.baseUrl}/api/sessions`, {
          method: 'POST',
          headers: { 'X-Api-Key': this.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: sessionName, start: true, config: {} }),
          signal: AbortSignal.timeout(WAHA_TIMEOUT_MS),
        });
    if (!response.ok) throw new Error(await this.describeError(response, 'iniciar sessão'));
  }

  /** PNG em base64 (data URL), só válido enquanto status=SCAN_QR_CODE. */
  async getQrBase64(sessionName: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/${sessionName}/auth/qr`, {
      headers: { 'X-Api-Key': this.apiKey },
      signal: AbortSignal.timeout(WAHA_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(await this.describeError(response, 'obter QR code'));
    const buffer = Buffer.from(await response.arrayBuffer());
    return `data:image/png;base64,${buffer.toString('base64')}`;
  }

  async logoutAndDelete(sessionName: string): Promise<void> {
    await fetch(`${this.baseUrl}/api/sessions/${sessionName}/logout`, {
      method: 'POST',
      headers: { 'X-Api-Key': this.apiKey },
      signal: AbortSignal.timeout(WAHA_TIMEOUT_MS),
    }).catch(() => undefined);
    await fetch(`${this.baseUrl}/api/sessions/${sessionName}`, {
      method: 'DELETE',
      headers: { 'X-Api-Key': this.apiKey },
      signal: AbortSignal.timeout(WAHA_TIMEOUT_MS),
    }).catch(() => undefined);
  }

  private async describeError(response: Response, action: string): Promise<string> {
    const body = await response.text().catch(() => '');
    return `WAHA respondeu ${response.status} ao ${action}: ${body}`;
  }
}
