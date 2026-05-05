import { error as kitError, type RequestEvent } from '@sveltejs/kit';

export async function requireUser(event: RequestEvent) {
  const {
    data: { user },
    error: authError
  } = await event.locals.supabase.auth.getUser();

  if (authError || !user) {
    throw kitError(401, 'Unauthorized');
  }

  return { user };
}

export async function requireAdmin(event: RequestEvent) {
  const { user } = await requireUser(event);
  const { data: profile } = await event.locals.supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'admin') {
    throw kitError(403, 'Admin access required');
  }

  return user;
}
