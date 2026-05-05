import { rateLimit } from '$lib/server/rate-limit';
import { requireUser } from '$lib/server/auth';
import { purgeExpiredReceivedEmails } from '$lib/server/cleanup';
import { extractOtp } from '$lib/shared/otp';
import { json, error } from '@sveltejs/kit';

const OTP_WINDOW_MINUTES = 20;

export async function GET(event) {
	const { user } = await requireUser(event);
	await purgeExpiredReceivedEmails();
	const limited = rateLimit(`refresh:${user.id}`, 1, 5 * 1000);

	if (!limited.ok) {
		throw error(429, `Refresh is limited to once every 5 seconds.`);
	}

	const inboxId = event.params.inboxId;
	const { data: inbox, error: inboxError } = await event.locals.supabase
		.from('temp_inboxes')
		.select('id,email_address,expires_at')
		.eq('id', inboxId)
		.eq('user_id', user.id)
		.single();

	if (inboxError || !inbox) {
		throw error(404, 'Inbox not found.');
	}

	const { data: olderMessages } = await event.locals.supabase
		.from('received_emails')
		.select('id')
		.eq('inbox_id', inboxId)
		.eq('user_id', user.id)
		.order('received_at', { ascending: false })
		.range(5, 500);

	const olderIds = (olderMessages ?? []).map((message) => message.id);
	if (olderIds.length > 0) {
		await event.locals.supabase
			.from('received_emails')
			.delete()
			.in('id', olderIds)
			.eq('user_id', user.id);
	}

	const { data: messages, error: messageError } = await event.locals.supabase
		.from('received_emails')
		.select('id,sender_email,subject,body_preview,full_body,detected_code,received_at')
		.eq('inbox_id', inboxId)
		.eq('user_id', user.id)
		.order('received_at', { ascending: false })
		.limit(5);

	if (messageError) {
		throw error(400, messageError.message);
	}

	const mapped = (messages ?? []).map((message) => ({
		id: message.id,
		from: message.sender_email,
		subject: message.subject,
		code:
			message.detected_code ??
			extractOtp({ subject: message.subject, text: message.full_body ?? message.body_preview }),
		bodyPreview: message.body_preview,
		receivedAt: message.received_at
	}));

	const recentCodeCutoff = Date.now() - OTP_WINDOW_MINUTES * 60 * 1000;
	const latestRecentCode =
		mapped.find((message) => {
			if (!message.code || !message.receivedAt) return false;
			return new Date(message.receivedAt).getTime() >= recentCodeCutoff;
		})?.code ?? null;

	return json({
		inbox: { id: inbox.id, email: inbox.email_address, expiresAt: inbox.expires_at },
		latestCode: latestRecentCode,
		messages: mapped
	});
}
