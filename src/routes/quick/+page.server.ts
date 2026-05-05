import { env } from '$env/dynamic/private';
import { redirect } from '@sveltejs/kit';

export const load = async (event) => {
  const {
    data: { user },
    error: authError
  } = await event.locals.supabase.auth.getUser();

  if (authError || !user) {
    throw redirect(303, '/login?redirectTo=/quick');
  }

  const { data: inboxes, error: inboxError } = await event.locals.supabase
    .from('temp_inboxes')
    .select('id,email_address,local_part,status,created_at,expires_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(10);

  if (inboxError) {
    return {
      email: user.email ?? '',
      domain: env.TEMP_MAIL_DOMAIN?.trim().toLowerCase() || 'avmail.online',
      inboxes: [],
      loadError: inboxError.message
    };
  }

  return {
    email: user.email ?? '',
    domain: env.TEMP_MAIL_DOMAIN?.trim().toLowerCase() || 'avmail.online',
    inboxes: (inboxes ?? []).map((inbox) => ({
      id: inbox.id,
      emailAddress: inbox.email_address,
      localPart: inbox.local_part,
      status: inbox.status,
      createdAt: inbox.created_at,
      expiresAt: inbox.expires_at
    })),
    loadError: null
  };
};
