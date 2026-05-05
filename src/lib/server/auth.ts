import { error as kitError, redirect, type RequestEvent } from '@sveltejs/kit';

export async function requireUser(event: RequestEvent) {
  const {
    data: { user },
    error: authError
  } = await event.locals.supabase.auth.getUser();

  if (authError || !user) {
    throw kitError(401, 'Unauthorized');
  }

  const { data: profile } = await event.locals.supabase
    .from('profiles')
    .select('is_blocked')
    .eq('id', user.id)
    .single();

  if (profile?.is_blocked === true) {
    throw kitError(403, 'Account blocked');
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

  if (profile?.role !== 'admin' && profile?.role !== 'main_admin') {
    throw kitError(403, 'Admin access required');
  }

  return { user, profile };
}

export async function requireMainAdmin(event: RequestEvent) {
  const { user } = await requireUser(event);
  const { data: profile } = await event.locals.supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'main_admin') {
    throw kitError(403, 'Main admin access required');
  }

  return { user, profile };
}

export async function requireDashboardAccess(event: RequestEvent) {
  const { user } = await requireUser(event);
  const { data: profile } = await event.locals.supabase
    .from('profiles')
    .select('role,dashboard_access')
    .eq('id', user.id)
    .single();

  const role = profile?.role ?? 'user';
  if (
    profile?.dashboard_access === true ||
    role === 'admin' ||
    role === 'main_admin' ||
    role === 'dashboard_user'
  ) {
    return { user, profile };
  }

  throw redirect(303, '/quick');
}
