import { auditLog } from '$lib/server/audit';
import { clientIp, rateLimit } from '$lib/server/rate-limit';
import { requireUser } from '$lib/server/auth';
import { json, error } from '@sveltejs/kit';

export async function DELETE(event) {
  const { user } = await requireUser(event);
  const ip = clientIp(event.request);
  const limited = rateLimit(`delete:${user.id}`, 10, 60 * 60 * 1000);

  if (!limited.ok) {
    throw error(429, `Too many delete requests. Try again in ${limited.retryAfter}s.`);
  }

  const { error: deleteError } = await event.locals.supabase
    .from('temp_inboxes')
    .delete()
    .eq('id', event.params.inboxId)
    .eq('user_id', user.id);

  if (deleteError) {
    throw error(400, deleteError.message);
  }

  await auditLog({
    userId: user.id,
    action: 'inbox.deleted',
    ipAddress: ip,
    userAgent: event.request.headers.get('user-agent'),
    metadata: { inboxId: event.params.inboxId }
  });

  return json({ ok: true });
}
