import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../infra/logger.js';
import type { WahaSessionGateway, WahaSessionStatus } from '../infra/waha-session-gateway.js';
import type { WhatsappSessionRow } from '../ports/whatsapp-session-repository.port.js';
import { WhatsappSessionJob } from './whatsapp-session.job.js';

function buildLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function buildRow(overrides: Partial<WhatsappSessionRow>): WhatsappSessionRow {
  return {
    spaceId: 'space-1',
    sessionName: 'space_1',
    status: 'connecting',
    pendingAction: null,
    ...overrides,
  };
}

function buildGateway(status: WahaSessionStatus | null): WahaSessionGateway {
  return {
    getStatus: vi.fn(async () => status),
    start: vi.fn(async () => {}),
    getQrBase64: vi.fn(async () => 'data:image/png;base64,QVFS'),
    logoutAndDelete: vi.fn(async () => {}),
  } as unknown as WahaSessionGateway;
}

interface MockRepository {
  listActionable: ReturnType<typeof vi.fn>;
  markConnecting: ReturnType<typeof vi.fn>;
  markQrReady: ReturnType<typeof vi.fn>;
  markConnected: ReturnType<typeof vi.fn>;
  markDisconnected: ReturnType<typeof vi.fn>;
  markFailed: ReturnType<typeof vi.fn>;
}

function buildRepository(): MockRepository {
  return {
    listActionable: vi.fn(async () => []),
    markConnecting: vi.fn(async () => {}),
    markQrReady: vi.fn(async () => {}),
    markConnected: vi.fn(async () => {}),
    markDisconnected: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
  };
}

describe('WhatsappSessionJob', () => {
  it('pending_action=connect: inicia a sessão no WAHA e marca connecting, sem consultar status ainda', async () => {
    const gateway = buildGateway('STARTING');
    const repository = buildRepository();
    repository.listActionable.mockResolvedValueOnce([
      buildRow({ pendingAction: 'connect', status: 'disconnected' }),
    ]);

    await new WhatsappSessionJob(gateway, repository, buildLogger()).tick();

    expect(gateway.start).toHaveBeenCalledWith('space_1');
    expect(repository.markConnecting).toHaveBeenCalledWith('space-1');
    expect(gateway.getStatus).not.toHaveBeenCalled();
  });

  it('pending_action=disconnect: faz logout+delete no WAHA e marca disconnected', async () => {
    const gateway = buildGateway('WORKING');
    const repository = buildRepository();
    repository.listActionable.mockResolvedValueOnce([
      buildRow({ pendingAction: 'disconnect', status: 'connected' }),
    ]);

    await new WhatsappSessionJob(gateway, repository, buildLogger()).tick();

    expect(gateway.logoutAndDelete).toHaveBeenCalledWith('space_1');
    expect(repository.markDisconnected).toHaveBeenCalledWith('space-1');
  });

  it('sem ação pendente e status SCAN_QR_CODE: busca o QR e marca qr_ready', async () => {
    const gateway = buildGateway('SCAN_QR_CODE');
    const repository = buildRepository();
    repository.listActionable.mockResolvedValueOnce([buildRow({ status: 'connecting' })]);

    await new WhatsappSessionJob(gateway, repository, buildLogger()).tick();

    expect(gateway.getQrBase64).toHaveBeenCalledWith('space_1');
    expect(repository.markQrReady).toHaveBeenCalledWith('space-1', 'data:image/png;base64,QVFS');
  });

  it('sem ação pendente e status WORKING: marca connected', async () => {
    const gateway = buildGateway('WORKING');
    const repository = buildRepository();
    repository.listActionable.mockResolvedValueOnce([buildRow({ status: 'qr_ready' })]);

    await new WhatsappSessionJob(gateway, repository, buildLogger()).tick();

    expect(repository.markConnected).toHaveBeenCalledWith('space-1');
  });

  it('sessão não encontrada no WAHA (status null): marca failed', async () => {
    const gateway = buildGateway(null);
    const repository = buildRepository();
    repository.listActionable.mockResolvedValueOnce([buildRow({ status: 'connecting' })]);

    await new WhatsappSessionJob(gateway, repository, buildLogger()).tick();

    expect(repository.markFailed).toHaveBeenCalledWith(
      'space-1',
      expect.stringContaining('inexistente'),
    );
  });

  it('status STARTING: não faz nada, só espera o próximo tick', async () => {
    const gateway = buildGateway('STARTING');
    const repository = buildRepository();
    repository.listActionable.mockResolvedValueOnce([buildRow({ status: 'connecting' })]);

    await new WhatsappSessionJob(gateway, repository, buildLogger()).tick();

    expect(repository.markConnected).not.toHaveBeenCalled();
    expect(repository.markQrReady).not.toHaveBeenCalled();
    expect(repository.markFailed).not.toHaveBeenCalled();
  });

  it('erro inesperado ao processar uma linha: marca failed com a mensagem, sem interromper as demais', async () => {
    const gateway = buildGateway('WORKING');
    (gateway.getStatus as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('timeout'));
    const repository = buildRepository();
    repository.listActionable.mockResolvedValueOnce([
      buildRow({ spaceId: 'space-a', sessionName: 'space_a', status: 'connecting' }),
      buildRow({ spaceId: 'space-b', sessionName: 'space_b', status: 'qr_ready' }),
    ]);

    await new WhatsappSessionJob(gateway, repository, buildLogger()).tick();

    expect(repository.markFailed).toHaveBeenCalledWith('space-a', 'timeout');
    expect(repository.markConnected).toHaveBeenCalledWith('space-b');
  });
});
