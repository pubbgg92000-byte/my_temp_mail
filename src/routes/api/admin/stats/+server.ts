import { adminSupabase } from '$lib/server/admin';
import { auditLog } from '$lib/server/audit';
import { purgeExpiredReceivedEmails } from '$lib/server/cleanup';
import { clientIp } from '$lib/server/rate-limit';
import { requireAdmin } from '$lib/server/auth';
import { json, error } from '@sveltejs/kit';

async function countRows(table: string, apply?: (query: any) => any) {
  const base = adminSupabase.from(table).select('*', { count: 'exact', head: true });
  const { count, error: countError } = await (apply ? apply(base) : base);
  if (countError) throw countError;
  return count ?? 0;
}

export async function GET(event) {
  const { user } = await requireAdmin(event);
  await purgeExpiredReceivedEmails();

  try {
    const now = new Date().toISOString();
    const [
      totalUsers,
      activeInboxCount,
      expiredInboxCount,
      receivedEmailCount,
      processedEmailCount,
      recentLogs
    ] = await Promise.all([
      countRows('profiles'),
      countRows('temp_inboxes', (query) =>
        query.eq('status', 'active').or(`expires_at.is.null,expires_at.gt.${now}`)
      ),
      countRows('temp_inboxes', (query) => query.lte('expires_at', now)),
      countRows('received_emails'),
      countRows('processed_messages'),
      adminSupabase
        .from('audit_logs')
        .select('id,user_id,action,created_at,metadata')
        .order('created_at', { ascending: false })
        .limit(20)
    ]);

    return json({
      totalUsers,
      activeInboxCount,
      expiredInboxCount,
      receivedEmailCount,
      processedEmailCount,
      recentLogs: recentLogs.data ?? []
    });
  } catch (statsError) {
    await auditLog({
      userId: user.id,
      action: 'admin.stats.error',
      ipAddress: clientIp(event.request),
      userAgent: event.request.headers.get('user-agent'),
      metadata: { message: statsError instanceof Error ? statsError.message : String(statsError) }
    });
    throw error(500, 'Unable to load admin stats.');
  }
}
