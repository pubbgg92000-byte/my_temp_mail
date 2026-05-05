import { env } from '$env/dynamic/private';
import { auditLog } from '$lib/server/audit';
import { adminSupabase } from '$lib/server/admin';
import { throwSchemaSetupErrorIfNeeded } from '$lib/server/db-errors';
import { clientIp, rateLimit } from '$lib/server/rate-limit';
import { requireUser } from '$lib/server/auth';
import { canonicalLocalPart, RESERVED_LOCAL_PARTS } from '$lib/shared/inbox';
import { customAlphabet } from 'nanoid';
import { json, error } from '@sveltejs/kit';

const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
const nanoid = customAlphabet(alphabet);
const randomLocalPart = () => nanoid(8 + Math.floor(Math.random() * 5));

export async function POST(event) {
	const { user } = await requireUser(event);
	const ip = clientIp(event.request);
	const limited = rateLimit(`random:${user.id}`, 10, 60 * 60 * 1000);
	if (!limited.ok) throw error(429, `Too many requests. Try again in ${limited.retryAfter}s.`);

	const domain = env.TEMP_MAIL_DOMAIN?.trim().toLowerCase();
	if (!domain) throw error(500, 'TEMP_MAIL_DOMAIN is not configured.');

	let localPart = randomLocalPart();
	let canonical = canonicalLocalPart(localPart);
	let emailAddress = `${localPart}@${domain}`;

	for (let attempt = 0; attempt < 8; attempt++) {
		const { data: blocked } = await adminSupabase
			.from('blocked_local_parts').select('local_part').eq('local_part', localPart).maybeSingle();
		if (!RESERVED_LOCAL_PARTS.includes(localPart) && !blocked) {
			const { data: existing, error: existingError } = await adminSupabase
				.from('temp_inboxes')
				.select('id')
				.or(`email_address.eq.${emailAddress},canonical_local_part.eq.${canonical}`)
				.maybeSingle();
			throwSchemaSetupErrorIfNeeded(existingError);
			if (existingError) throw error(400, existingError.message);
			if (!existing) break;
		}
		localPart = randomLocalPart();
		canonical = canonicalLocalPart(localPart);
		emailAddress = `${localPart}@${domain}`;
	}

	const { data, error: insertError } = await event.locals.supabase
		.from('temp_inboxes')
		.insert({
			user_id: user.id,
			email_address: emailAddress,
			local_part: localPart,
			canonical_local_part: canonical,
			expires_at: null,
			ip_address: ip,
			user_agent: event.request.headers.get('user-agent')
		})
		.select('id,email_address')
		.single();

	throwSchemaSetupErrorIfNeeded(insertError);
	if (insertError) throw error(400, insertError.message);

	await auditLog({
		userId: user.id, action: 'inbox.random.created',
		ipAddress: ip, userAgent: event.request.headers.get('user-agent'),
		metadata: { inboxId: data.id, emailAddress }
	});

	return json({ inboxId: data.id, email: data.email_address, expiresAt: null });
}
