import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = publicEnv.PUBLIC_SUPABASE_URL || 'http://localhost:54321';
const serviceRoleKey = privateEnv.SUPABASE_SERVICE_ROLE_KEY || 'missing-service-role-key';

if (!privateEnv.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('SUPABASE_SERVICE_ROLE_KEY is not set. Backend admin features will fail until configured.');
}

export const adminSupabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});
