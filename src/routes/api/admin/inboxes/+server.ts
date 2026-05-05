import { adminSupabase } from '$lib/server/admin';
import { auditLog } from '$lib/server/audit';
import { requireMainAdmin } from '$lib/server/auth';
import { clientIp, rateLimit } from '$lib/server/rate-limit';
import { extractOtp } from '$lib/shared/otp';
import { error, json } from '@sveltejs/kit';

type InboxRow = {
	id: string;
	user_id: string;
	email_address: string;
	local_part: string;
	status: string | null;
	created_at: string;
	expires_at: string | null;
};

type MessageRow = {
	id: string;
	user_id: string;
	inbox_id: string;
	sender_email: string | null;
	subject: string | null;
	body_preview: string | null;
	full_body: string | null;
	detected_code: string | null;
	received_at: string | null;
	created_at: string;
};

export async function GET(event) {
	const { user } = await requireMainAdmin(event);
	const limited = rateLimit(`main-admin-inboxes:${user.id}`, 60, 60 * 1000);
	if (!limited.ok) {
		throw error(429, `Too many requests. Try again in ${limited.retryAfter}s.`);
	}

	const { data: inboxes, error: inboxError } = await adminSupabase
		.from('temp_inboxes')
		.select('id,user_id,email_address,local_part,status,created_at,expires_at')
		.order('created_at', { ascending: false })
		.limit(100);

	if (inboxError) {
		throw error(500, 'Unable to load inboxes.');
	}

	const rows = (inboxes ?? []) as InboxRow[];
	const inboxIds = rows.map((inbox) => inbox.id);
	const userIds = [...new Set(rows.map((inbox) => inbox.user_id))];

	const [profilesResponse, messagesResponse] = await Promise.all([
		userIds.length
			? adminSupabase.from('profiles').select('id,email,role,dashboard_access').in('id', userIds)
			: Promise.resolve({ data: [], error: null }),
		inboxIds.length
			? adminSupabase
					.from('received_emails')
					.select('id,user_id,inbox_id,sender_email,subject,body_preview,full_body,detected_code,received_at,created_at')
					.in('inbox_id', inboxIds)
					.order('received_at', { ascending: false })
					.limit(300)
			: Promise.resolve({ data: [], error: null })
	]);

	if (profilesResponse.error || messagesResponse.error) {
		throw error(500, 'Unable to load admin mail data.');
	}

	const profilesById = new Map((profilesResponse.data ?? []).map((profile) => [profile.id, profile]));
	const latestMessageByInbox = new Map<string, MessageRow>();
	for (const message of (messagesResponse.data ?? []) as MessageRow[]) {
		if (!latestMessageByInbox.has(message.inbox_id)) {
			latestMessageByInbox.set(message.inbox_id, message);
		}
	}

	await auditLog({
		userId: user.id,
		action: 'main_admin.inboxes.view',
		ipAddress: clientIp(event.request),
		userAgent: event.request.headers.get('user-agent'),
		metadata: { inboxCount: rows.length }
	});

	return json({
		inboxes: rows.map((inbox) => {
			const owner = profilesById.get(inbox.user_id);
			const message = latestMessageByInbox.get(inbox.id);
			const code =
				message?.detected_code ??
				extractOtp({
					subject: message?.subject,
					text: message?.body_preview ?? message?.full_body
				});

			return {
				id: inbox.id,
				userId: inbox.user_id,
				ownerEmail: owner?.email ?? null,
				ownerRole: owner?.role ?? 'user',
				emailAddress: inbox.email_address,
				status: inbox.status,
				createdAt: inbox.created_at,
				expiresAt: inbox.expires_at,
				latestMessage: message
					? {
							id: message.id,
							from: message.sender_email,
							subject: message.subject,
							preview: message.body_preview,
							code,
							receivedAt: message.received_at ?? message.created_at
						}
					: null
			};
		})
	});
}
