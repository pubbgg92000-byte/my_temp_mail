import { json, error } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { rateLimit } from '$lib/server/rate-limit';
import { pollOnce } from '../../../../../../worker/titan-imap-worker';

const runningSyncs = new Set<string>();

export async function POST(event) {
	const { user } = await requireUser(event);
	const inboxId = event.params.inboxId;
	if (!inboxId) throw error(400, 'Inbox id is required.');

	const limited = rateLimit(`sync:${user.id}:${inboxId}`, 1, 8_000);
	if (!limited.ok) {
		return json(
			{ status: 'cooldown', message: `Please wait ${limited.retryAfter}s before checking again.`, retryAfter: limited.retryAfter },
			{ status: 429 }
		);
	}

	const { data: inbox, error: inboxError } = await event.locals.supabase
		.from('temp_inboxes')
		.select('id,user_id,email_address,status,expires_at')
		.eq('id', inboxId)
		.eq('user_id', user.id)
		.maybeSingle();

	if (inboxError) throw error(400, inboxError.message);
	if (!inbox) throw error(404, 'Inbox not found.');
	if (inbox.status !== 'active') throw error(400, 'This inbox is not active.');

	const syncKey = `${user.id}:${inboxId}`;
	if (runningSyncs.has(syncKey)) {
		return json({ status: 'already_running', message: 'A mail check is already running for this inbox.' }, { status: 202 });
	}

	runningSyncs.add(syncKey);
	try {
		await pollOnce();
		return json({ status: 'checked', inboxId, email: inbox.email_address });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Could not check mail.';
		throw error(500, message);
	} finally {
		runningSyncs.delete(syncKey);
	}
}
