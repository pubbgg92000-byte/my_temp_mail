import { env } from '$env/dynamic/private';
import { auditLog } from '$lib/server/audit';
import { adminSupabase } from '$lib/server/admin';
import { clientIp, rateLimit } from '$lib/server/rate-limit';
import { requireUser } from '$lib/server/auth';
import { customLocalPartSchema } from '$lib/shared/inbox';
import { json, error } from '@sveltejs/kit';

export async function POST(event) {
	const { user } = await requireUser(event);
	const ip = clientIp(event.request);
	const limited = rateLimit(`custom:${user.id}`, 10, 60 * 60 * 1000);
	if (!limited.ok) throw error(429, `Too many requests. Try again in ${limited.retryAfter}s.`);

	const body = await event.request.json().catch(() => ({}));
	const parsed = customLocalPartSchema.safeParse(body.localPart);
	if (!parsed.success) throw error(400, parsed.error.issues[0]?.message ?? 'Invalid local part.');

	const domain = env.TEMP_MAIL_DOMAIN?.trim().toLowerCase();
	if (!domain) throw error(500, 'TEMP_MAIL_DOMAIN is not configured.');

	const localPart = parsed.data;
	const emailAddress = `${localPart}@${domain}`;

	const { data: blocked } = await adminSupabase
		.from('blocked_local_parts').select('local_part').eq('local_part', localPart).maybeSingle();
	if (blocked) throw error(400, 'That name is reserved.');

	// If this user already has this address, just return it (reuse flow)
	const { data: mine } = await event.locals.supabase
		.from('temp_inboxes').select('id,email_address').eq('email_address', emailAddress)
		.eq('user_id', user.id).maybeSingle();
	if (mine) return json({ inboxId: mine.id, email: mine.email_address, expiresAt: null });

	const { data: taken } = await adminSupabase
		.from('temp_inboxes').select('id').eq('email_address', emailAddress).maybeSingle();
	if (taken) throw error(409, 'That email address is taken by another user.');

	const { data, error: insertError } = await event.locals.supabase
		.from('temp_inboxes')
		.insert({
			user_id: user.id,
			email_address: emailAddress,
			local_part: localPart,
			expires_at: null,
			ip_address: ip,
			user_agent: event.request.headers.get('user-agent')
		})
		.select('id,email_address')
		.single();

	if (insertError) throw error(400, insertError.message);

	await auditLog({
		userId: user.id, action: 'inbox.custom.created',
		ipAddress: ip, userAgent: event.request.headers.get('user-agent'),
		metadata: { inboxId: data.id, emailAddress }
	});

	return json({ inboxId: data.id, email: data.email_address, expiresAt: null });
}