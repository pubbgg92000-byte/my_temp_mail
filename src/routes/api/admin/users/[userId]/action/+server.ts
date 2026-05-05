import { adminSupabase } from '$lib/server/admin';
import { auditLog } from '$lib/server/audit';
import { requireMainAdmin } from '$lib/server/auth';
import { clientIp, rateLimit } from '$lib/server/rate-limit';
import { error, json } from '@sveltejs/kit';

const ACTIONS = new Set(['grant_admin', 'grant_dashboard', 'remove_access', 'block', 'unblock', 'delete']);

export async function POST(event) {
	const { user: admin } = await requireMainAdmin(event);
	const limited = rateLimit(`main-admin-user-action:${admin.id}`, 30, 60 * 60 * 1000);
	if (!limited.ok) {
		throw error(429, `Too many user actions. Try again in ${limited.retryAfter}s.`);
	}

	const targetUserId = event.params.userId;
	if (targetUserId === admin.id) {
		throw error(400, 'You cannot change your own main admin account here.');
	}

	const body = await event.request.json().catch(() => null);
	const action = String(body?.action ?? '');
	if (!ACTIONS.has(action)) {
		throw error(400, 'Unsupported action.');
	}

	const { data: target, error: targetError } = await adminSupabase
		.from('profiles')
		.select('id,email,role')
		.eq('id', targetUserId)
		.single();

	if (targetError || !target) {
		throw error(404, 'User profile not found.');
	}
	if (target.role === 'main_admin') {
		throw error(400, 'Main admin accounts can only be changed from the database.');
	}

	if (action === 'delete') {
		const { error: deleteError } = await adminSupabase.auth.admin.deleteUser(targetUserId);
		if (deleteError) {
			throw error(500, 'Unable to delete user.');
		}
		await auditLog({
			userId: admin.id,
			action: 'main_admin.user.delete',
			ipAddress: clientIp(event.request),
			userAgent: event.request.headers.get('user-agent'),
			metadata: { targetUserId, targetEmail: target.email }
		});
		return json({ deleted: true });
	}

	const patch =
		action === 'grant_admin'
			? { role: 'admin', dashboard_access: true }
			: action === 'grant_dashboard'
				? { role: 'dashboard_user', dashboard_access: true }
				: action === 'remove_access'
					? { role: 'user', dashboard_access: false }
					: action === 'block'
						? { is_blocked: true }
						: { is_blocked: false };

	const { data: profile, error: updateError } = await adminSupabase
		.from('profiles')
		.update(patch)
		.eq('id', targetUserId)
		.select('id,email,role,dashboard_access,is_blocked')
		.single();

	if (updateError) {
		throw error(500, 'Unable to update user.');
	}

	await auditLog({
		userId: admin.id,
		action: `main_admin.user.${action}`,
		ipAddress: clientIp(event.request),
		userAgent: event.request.headers.get('user-agent'),
		metadata: { targetUserId, targetEmail: target.email }
	});

	return json({ profile });
}
