import { adminSupabase } from '$lib/server/admin';
import { auditLog } from '$lib/server/audit';
import { requireMainAdmin } from '$lib/server/auth';
import { clientIp, rateLimit } from '$lib/server/rate-limit';
import { error, json } from '@sveltejs/kit';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACCESS_LEVELS = new Set(['dashboard', 'admin']);

export async function GET(event) {
	const { user: admin } = await requireMainAdmin(event);
	const limited = rateLimit(`admin-access-list:${admin.id}`, 30, 60 * 1000);
	if (!limited.ok) {
		throw error(429, `Too many requests. Try again in ${limited.retryAfter}s.`);
	}

	const { data, error: profileError } = await adminSupabase
		.from('profiles')
		.select('id,email,role,dashboard_access,is_blocked,created_at')
		.order('created_at', { ascending: false })
		.limit(50);

	if (profileError) {
		throw error(500, 'Unable to load users.');
	}

	const profiles = data ?? [];
	const userIds = profiles.map((profile) => profile.id);
	const [inboxResponse, usageResponse] = await Promise.all([
		userIds.length
			? adminSupabase.from('temp_inboxes').select('id,user_id').in('user_id', userIds)
			: Promise.resolve({ data: [], error: null }),
		userIds.length
			? adminSupabase.from('inbox_usage_stats').select('user_id,received_count,otp_count').in('user_id', userIds)
			: Promise.resolve({ data: [], error: null })
	]);

	if (inboxResponse.error || usageResponse.error) {
		throw error(500, 'Unable to load user activity.');
	}

	const activityByUser = new Map<
		string,
		{ mailCreatedCount: number; receivedCount: number; otpCount: number }
	>();
	for (const userId of userIds) {
		activityByUser.set(userId, { mailCreatedCount: 0, receivedCount: 0, otpCount: 0 });
	}
	for (const inbox of inboxResponse.data ?? []) {
		const activity = activityByUser.get(inbox.user_id);
		if (activity) activity.mailCreatedCount += 1;
	}
	for (const usage of usageResponse.data ?? []) {
		const activity = activityByUser.get(usage.user_id);
		if (activity) {
			activity.receivedCount += usage.received_count ?? 0;
			activity.otpCount += usage.otp_count ?? 0;
		}
	}

	return json({
		profiles: profiles.map((profile) => ({
			...profile,
			activity: activityByUser.get(profile.id) ?? {
				mailCreatedCount: 0,
				receivedCount: 0,
				otpCount: 0
			}
		}))
	});
}

export async function POST(event) {
	const { user: admin } = await requireMainAdmin(event);
	const limited = rateLimit(`admin-access-grant:${admin.id}`, 10, 60 * 60 * 1000);
	if (!limited.ok) {
		throw error(429, `Too many access changes. Try again in ${limited.retryAfter}s.`);
	}

	const body = await event.request.json().catch(() => null);
	const email = String(body?.email ?? '').trim().toLowerCase();
	const access = String(body?.access ?? 'dashboard').trim().toLowerCase();

	if (!EMAIL_PATTERN.test(email)) {
		throw error(400, 'Enter a valid user email.');
	}

	if (!ACCESS_LEVELS.has(access)) {
		throw error(400, 'Choose dashboard or admin access.');
	}

	const patch =
		access === 'admin'
			? { role: 'admin', dashboard_access: true }
			: { role: 'dashboard_user', dashboard_access: true };

	const { data: profile, error: updateError } = await adminSupabase
		.from('profiles')
		.update(patch)
		.eq('email', email)
		.select('id,email,role,dashboard_access,is_blocked')
		.single();

	if (updateError) {
		const status = updateError.code === 'PGRST116' ? 404 : 500;
		throw error(status, status === 404 ? 'No profile found for that email.' : 'Unable to grant access.');
	}

	await auditLog({
		userId: admin.id,
		action: access === 'admin' ? 'admin.access.grant_admin' : 'admin.access.grant_dashboard',
		ipAddress: clientIp(event.request),
		userAgent: event.request.headers.get('user-agent'),
		metadata: { targetUserId: profile.id, targetEmail: profile.email }
	});

	return json({ profile });
}
