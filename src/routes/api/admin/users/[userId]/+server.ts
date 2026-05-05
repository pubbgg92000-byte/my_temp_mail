import { adminSupabase } from '$lib/server/admin';
import { auditLog } from '$lib/server/audit';
import { requireMainAdmin } from '$lib/server/auth';
import { purgeExpiredReceivedEmails } from '$lib/server/cleanup';
import { clientIp, rateLimit } from '$lib/server/rate-limit';
import { error, json } from '@sveltejs/kit';

export async function GET(event) {
	const { user: admin } = await requireMainAdmin(event);
	await purgeExpiredReceivedEmails();
	const limited = rateLimit(`main-admin-user-detail:${admin.id}`, 80, 60 * 1000);
	if (!limited.ok) {
		throw error(429, `Too many requests. Try again in ${limited.retryAfter}s.`);
	}

	const userId = event.params.userId;
	const [profileResponse, authResponse, inboxResponse, emailResponse, usageResponse] = await Promise.all([
		adminSupabase
			.from('profiles')
			.select('id,email,full_name,avatar_url,role,dashboard_access,is_blocked,created_at')
			.eq('id', userId)
			.single(),
		adminSupabase.auth.admin.getUserById(userId),
		adminSupabase
			.from('temp_inboxes')
			.select('id,email_address,local_part,canonical_local_part,status,created_at,expires_at,ip_address,user_agent')
			.eq('user_id', userId)
			.order('created_at', { ascending: false })
			.limit(100),
		adminSupabase
			.from('received_emails')
			.select('id,inbox_id,recipient_email,sender_email,subject,body_preview,detected_code,message_id,received_at,created_at')
			.eq('user_id', userId)
			.order('received_at', { ascending: false })
			.limit(50),
		adminSupabase
			.from('inbox_usage_stats')
			.select('inbox_id,email_address,received_count,otp_count,last_received_at,last_otp_at')
			.eq('user_id', userId)
	]);

	if (profileResponse.error) {
		throw error(404, 'User profile not found.');
	}
	if (inboxResponse.error || emailResponse.error || usageResponse.error) {
		throw error(500, 'Unable to load user data.');
	}

	const statsByInbox = new Map(
		(usageResponse.data ?? []).map((usage) => [
			usage.inbox_id,
			{
				emailAddress: usage.email_address,
				receivedCount: usage.received_count ?? 0,
				otpCount: usage.otp_count ?? 0,
				lastReceivedAt: usage.last_received_at,
				lastOtpAt: usage.last_otp_at
			}
		])
	);
	const totals = [...statsByInbox.values()].reduce(
		(acc, usage) => ({
			receivedCount: acc.receivedCount + usage.receivedCount,
			otpCount: acc.otpCount + usage.otpCount
		}),
		{ receivedCount: 0, otpCount: 0 }
	);

	await auditLog({
		userId: admin.id,
		action: 'main_admin.user.view',
		ipAddress: clientIp(event.request),
		userAgent: event.request.headers.get('user-agent'),
		metadata: { targetUserId: userId }
	});

	return json({
		profile: profileResponse.data,
		authUser: authResponse.data.user
			? {
					id: authResponse.data.user.id,
					email: authResponse.data.user.email,
					createdAt: authResponse.data.user.created_at,
					updatedAt: authResponse.data.user.updated_at,
					lastSignInAt: authResponse.data.user.last_sign_in_at,
					emailConfirmedAt: authResponse.data.user.email_confirmed_at,
					bannedUntil: authResponse.data.user.banned_until
				}
			: null,
		inboxes: inboxResponse.data ?? [],
		stats: {
			mailCreatedCount: inboxResponse.data?.length ?? 0,
			inboxesWithOtpCount: [...statsByInbox.values()].filter((usage) => usage.otpCount > 0).length,
			receivedCount: totals.receivedCount,
			otpCount: totals.otpCount,
			byInbox: Object.fromEntries(statsByInbox)
		},
		recentEmails: emailResponse.data ?? []
	});
}
