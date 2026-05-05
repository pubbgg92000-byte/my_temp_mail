import { adminSupabase } from './admin';

export async function auditLog(input: {
  userId?: string | null;
  action: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const { error } = await adminSupabase.from('audit_logs').insert({
    user_id: input.userId ?? null,
    action: input.action,
    ip_address: input.ipAddress ?? null,
    user_agent: input.userAgent ?? null,
    metadata: input.metadata ?? {}
  });

  if (error) {
    console.warn('Failed to write audit log:', error.message);
  }
}
