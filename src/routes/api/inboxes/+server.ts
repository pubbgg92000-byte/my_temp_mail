import { requireUser } from '$lib/server/auth';
import { json, error } from '@sveltejs/kit';

export async function GET(event) {
	const { user } = await requireUser(event);
	const { data, error: queryError } = await event.locals.supabase
		.from('temp_inboxes')
		.select('id,email_address,local_part,status,created_at,expires_at')
		.eq('user_id', user.id)
		.order('created_at', { ascending: false });
	if (queryError) throw error(400, queryError.message);

	return json({
		inboxes: (data ?? []).map((inbox) => ({
			id: inbox.id,
			emailAddress: inbox.email_address,
			localPart: inbox.local_part,
			status: inbox.status,
			createdAt: inbox.created_at,
			expiresAt: inbox.expires_at // null = permanent
		}))
	});
}
