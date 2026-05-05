import { requireUser } from '$lib/server/auth';
import { json } from '@sveltejs/kit';

export async function GET(event) {
	const { user } = await requireUser(event);
	const { data: profile } = await event.locals.supabase
		.from('profiles')
		.select('role,dashboard_access')
		.eq('id', user.id)
		.single();

	const role = profile?.role ?? 'user';
	const path =
		role === 'main_admin'
			? '/admin'
			: role === 'admin' || role === 'dashboard_user' || profile?.dashboard_access
				? '/dashboard'
				: '/quick';

	return json({ path, role });
}
