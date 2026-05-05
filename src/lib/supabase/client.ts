import { env } from '$env/dynamic/public';
import { createBrowserClient } from '@supabase/ssr';

export const supabase = createBrowserClient(
  env.PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  env.PUBLIC_SUPABASE_ANON_KEY || 'missing-anon-key'
);
