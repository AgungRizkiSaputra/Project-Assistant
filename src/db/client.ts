import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Database } from './types.js';
import { loadConfig } from '../config/env.js';

let supabaseInstance: SupabaseClient<Database> | null = null;

export function getSupabaseClient(): SupabaseClient<Database> {
  if (supabaseInstance) {
    return supabaseInstance;
  }

  const config = loadConfig();
  supabaseInstance = createClient<Database>(
    config.SUPABASE_URL,
    config.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );

  return supabaseInstance;
}

