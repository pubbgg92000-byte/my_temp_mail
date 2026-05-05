import { error } from '@sveltejs/kit';

const SCHEMA_CACHE_MESSAGE =
  'Database schema is not ready. Run supabase/schema.sql, then refresh the Supabase/PostgREST schema cache or restart your local Supabase stack.';

export function throwSchemaSetupErrorIfNeeded(dbError: { message?: string; code?: string } | null) {
  if (!dbError?.message) return;

  const message = dbError.message.toLowerCase();
  if (
    dbError.code === 'PGRST204' ||
    (message.includes('schema cache') && message.includes('canonical_local_part')) ||
    message.includes("could not find the 'canonical_local_part'")
  ) {
    throw error(400, SCHEMA_CACHE_MESSAGE);
  }
}
