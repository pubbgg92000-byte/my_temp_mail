export const load = async ({ locals }) => {
  const { user } = await locals.safeGetSession();
  if (!user) {
    return { user: null, profile: null };
  }

  const { data: profile } = await locals.supabase
    .from('profiles')
    .select('full_name,emoji,role,dashboard_access,is_blocked')
    .eq('id', user.id)
    .single();

  return {
    user,
    profile: profile
      ? {
          fullName: profile.full_name ?? null,
          emoji: profile.emoji ?? '⚡',
          role: profile.role ?? 'user',
          dashboardAccess: profile.dashboard_access === true,
          isBlocked: profile.is_blocked === true
        }
      : null
  };
};
