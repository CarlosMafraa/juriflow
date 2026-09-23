import { describe, expect, it } from 'vitest';
import { resolveEffectiveConfig, type RawNotificationConfig } from './notification-config.js';

describe('resolveEffectiveConfig', () => {
  it('sem config de espaço nem de processo, usa o padrão embutido (notifica os dois, template genérico)', () => {
    expect(resolveEffectiveConfig(null, null)).toEqual({
      notifyResponsible: true,
      notifyClients: true,
      responsibleTemplateId: null,
      clientTemplateId: null,
    });
  });

  it('usa a config do espaço quando não há override no processo', () => {
    const space: RawNotificationConfig = {
      notifyResponsible: false,
      notifyClients: true,
      responsibleTemplateId: 'tpl-resp',
      clientTemplateId: null,
    };
    expect(resolveEffectiveConfig(space, null)).toEqual({
      notifyResponsible: false,
      notifyClients: true,
      responsibleTemplateId: 'tpl-resp',
      clientTemplateId: null,
    });
  });

  it('o override do processo prevalece campo a campo sobre a config do espaço', () => {
    const space: RawNotificationConfig = {
      notifyResponsible: true,
      notifyClients: true,
      responsibleTemplateId: 'tpl-resp-espaco',
      clientTemplateId: 'tpl-cli-espaco',
    };
    const process: RawNotificationConfig = {
      notifyResponsible: false, // explicitamente desligado só para este processo
      notifyClients: null, // sem override -> herda do espaço
      responsibleTemplateId: null, // sem override -> herda do espaço
      clientTemplateId: 'tpl-cli-processo', // override
    };
    expect(resolveEffectiveConfig(space, process)).toEqual({
      notifyResponsible: false,
      notifyClients: true,
      responsibleTemplateId: 'tpl-resp-espaco',
      clientTemplateId: 'tpl-cli-processo',
    });
  });

  it('processo com todos os campos nulos herda 100% do espaço', () => {
    const space: RawNotificationConfig = {
      notifyResponsible: false,
      notifyClients: false,
      responsibleTemplateId: null,
      clientTemplateId: null,
    };
    const process: RawNotificationConfig = {
      notifyResponsible: null,
      notifyClients: null,
      responsibleTemplateId: null,
      clientTemplateId: null,
    };
    expect(resolveEffectiveConfig(space, process)).toEqual({
      notifyResponsible: false,
      notifyClients: false,
      responsibleTemplateId: null,
      clientTemplateId: null,
    });
  });
});
