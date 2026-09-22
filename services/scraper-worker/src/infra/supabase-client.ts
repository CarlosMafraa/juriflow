import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { WorkerConfig } from '../config.js';

/**
 * Cliente único, com a service_role key — bypassa RLS por design (o worker
 * roda fora do contexto de um usuário autenticado). NUNCA reutilizar esta key
 * no frontend (ver .env.example).
 */
export function createSupabaseClient(config: WorkerConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
