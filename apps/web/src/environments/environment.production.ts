/**
 * Ambiente de produção. Os valores são injetados no processo de build/deploy
 * (variáveis de ambiente do pipeline), nunca commitados. Apenas valores públicos.
 */
export const environment = {
  production: true,
  appName: 'JuriFlow',
  supabaseUrl: '__WEB_SUPABASE_URL__',
  supabaseAnonKey: '__WEB_SUPABASE_ANON_KEY__',
  requestIdHeader: 'x-request-id',
  logLevel: 'warn' as 'debug' | 'info' | 'warn' | 'error',
};
