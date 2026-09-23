/**
 * Nome de sessão WAHA namespaced por espaço (RN seção 22 / F12). Precisa bater
 * exatamente com o cálculo em `app.request_whatsapp_connect` (migração 0026).
 */
export function wahaSessionNameForSpace(spaceId: string): string {
  return `space_${spaceId.replace(/-/g, '')}`;
}
