import { requireUser } from '$lib/server/auth';

export const load = async (event) => {
	const { user } = await requireUser(event);

	const { data: profile } = await event.locals.supabase
		.from('profiles')
		.select('full_name, emoji, role')
		.eq('id', user.id)
		.single();

	return {
		email: user.email ?? '',
		displayName: profile?.full_name ?? 'Guest',
		emoji: profile?.emoji ?? '✨',
		role: profile?.role ?? 'user'
	};
};