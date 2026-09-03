/**
 * Ambiente de desenvolvimento. Apenas valores PÚBLICOS.
 * Nunca colocar service_role key, secrets ou credenciais aqui.
 * Para valores locais reais, gere com `supabase status` e ajuste este arquivo
 * (ele não é versionado com segredos porque não contém nenhum).
 */
export const environment = {
  production: false,
  appName: 'JuriFlow',
  supabaseUrl: 'http://127.0.0.1:55321',
  // anon key local padrão do Supabase CLI (chave pública, não é segredo).
  supabaseAnonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
  requestIdHeader: 'x-request-id',
  logLevel: 'debug' as 'debug' | 'info' | 'warn' | 'error',
};
