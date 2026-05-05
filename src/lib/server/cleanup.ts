import { adminSupabase } from './admin';

const OTP_RETENTION_MINUTES = 20;

export async function purgeExpiredReceivedEmails() {
	const cutoff = new Date(Date.now() - OTP_RETENTION_MINUTES * 60 * 1000).toISOString();
	const { error } = await adminSupabase
		.from('received_emails')
		.update({
			subject: null,
			body_preview: null,
			full_body: null,
			detected_code: null
		})
		.lt('created_at', cutoff)
		.or('subject.not.is.null,body_preview.not.is.null,full_body.not.is.null,detected_code.not.is.null');

	if (error) {
		console.warn('Failed to scrub expired received email content:', error.message);
	}
}
