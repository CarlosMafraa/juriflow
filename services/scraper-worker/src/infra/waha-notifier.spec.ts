import { afterEach, describe, expect, it, vi } from 'vitest';
import { WahaNotifier } from './waha-notifier.js';

const SPACE = 'ebc8f36c-985b-495f-8e2e-22e50df6a62b';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('WahaNotifier', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('envia para o chat que o WhatsApp informa (celular antigo sem o nono dígito / LID)', async () => {
    const fetchMock = vi.fn(async (input: string | URL) =>
      String(input).includes('check-exists')
        ? json({ numberExists: true, chatId: '225207197413409@lid' })
        : json({ id: 'msg-1' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const notifier = new WahaNotifier('http://waha:3000', 'key', { sleep: async () => {} });
    await notifier.sendText(SPACE, '+5592985276297', 'oi');
    await notifier.sendText(SPACE, '+5592985276297', 'oi de novo');

    const checks = fetchMock.mock.calls.filter(([u]) => String(u).includes('check-exists'));
    expect(checks).toHaveLength(1); // resposta guardada: não pergunta a cada mensagem
    expect(String(checks[0][0])).toContain('phone=5592985276297');
    const send = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/api/sendText'));
    const body = JSON.parse(String((send?.[1] as RequestInit).body));
    expect(body).toEqual({
      session: 'space_ebc8f36c985b495f8e2e22e50df6a62b',
      chatId: '225207197413409@lid',
      text: 'oi',
    });
  });

  it('número sem WhatsApp vira erro claro, sem tentar enviar', async () => {
    const fetchMock = vi.fn(async () => json({ numberExists: false }));
    vi.stubGlobal('fetch', fetchMock);

    const notifier = new WahaNotifier('http://waha:3000', 'key', { sleep: async () => {} });
    await expect(notifier.sendText(SPACE, '+5592900000000', 'oi')).rejects.toThrow(
      'não tem conta no WhatsApp',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('anti-bloqueio: digitando antes de enviar e 30–60 s entre mensagens', async () => {
    const paths: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        paths.push(new URL(String(input)).pathname);
        return String(input).includes('check-exists')
          ? json({ numberExists: true, chatId: '1@lid' })
          : json({});
      }),
    );
    let clock = 1_000_000;
    const sleeps: number[] = [];
    const notifier = new WahaNotifier('http://waha:3000', 'key', {
      minIntervalMs: 30_000,
      maxIntervalMs: 60_000,
      random: () => 0.5,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });

    await notifier.sendText(SPACE, '+5592900000001', 'primeira');
    await notifier.sendText(SPACE, '+5592900000001', 'segunda');

    expect(paths.filter((p) => p !== '/api/contacts/check-exists')).toEqual([
      '/api/startTyping',
      '/api/stopTyping',
      '/api/sendText',
      '/api/startTyping',
      '/api/stopTyping',
      '/api/sendText',
    ]);
    // 1ª: só o digitando (2 s); 2ª: espera 45 s desde a anterior, depois digita.
    expect(sleeps).toEqual([2_000, 45_000, 2_000]);
  });
});
