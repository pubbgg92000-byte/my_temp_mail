import { requireAdmin } from '$lib/server/auth';

export const load = async (event) => {
  const { user, profile } = await requireAdmin(event);
  return { email: user.email ?? '', role: profile.role ?? 'admin' };
};
