import { requireAdmin } from '$lib/server/auth';

export const load = async (event) => {
  const user = await requireAdmin(event);
  return { email: user.email ?? '' };
};
