/**
 * Titan IMAP worker
 *
 * - Polls Titan catch-all every 7s
 * - Reads unseen + the last 24h of messages
 * - Re-attempts unmatched mails when new inboxes appear
 * - Matches by multiple recipient headers, extracts OTP, saves under user_id
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { ImapFlow } from 'imapflow';
import { convert } from 'html-to-text';
import { fileURLToPath } from 'node:url';
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser';
import { bodyPreview, extractOtp } from '../src/lib/shared/otp';
import { extractRecipientCandidates } from '../src/lib/shared/recipients';

const {
	PUBLIC_SUPABASE_URL,
	SUPABASE_SERVICE_ROLE_KEY,
	TITAN_IMAP_HOST = 'imap.titan.email',
	TITAN_IMAP_PORT = '993',
	TITAN_IMAP_USER,
	TITAN_IMAP_PASSWORD,
	TEMP_MAIL_DOMAIN
} = process.env;

const POLL_INTERVAL_MS = 3_000;
const FETCH_BATCH_SIZE = 15;
const OTP_WINDOW_MINUTES = 10;
const MAX_BACKOFF_MS = 60_000;

if (!PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
	throw new Error('PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
}
if (!TITAN_IMAP_USER || !TITAN_IMAP_PASSWORD || !TEMP_MAIL_DOMAIN) {
	throw new Error('TITAN_IMAP_USER, TITAN_IMAP_PASSWORD, and TEMP_MAIL_DOMAIN are required.');
}

const DOMAIN = TEMP_MAIL_DOMAIN.trim().toLowerCase();
const EMAIL_REGEX = /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/gi;
const LOCAL_PART_REGEX = /^[a-z0-9._-]{3,64}$/;
const LOCAL_PART_STOPWORDS = new Set([
	'from',
	'received',
	'with',
	'for',
	'by',
	'id',
	'esmtps',
	'esmtp',
	'smtp',
	'http',
	'https',
	'localhost',
	'unknown'
]);

const supabase = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
	auth: { autoRefreshToken: false, persistSession: false }
});

type InboxRow = {
	id: string;
	user_id: string;
	email_address: string;
	local_part: string;
	expires_at: string | null;
	status: string;
};

type MatchStatus = 'matched' | 'no_match' | 'ambiguous_match' | 'duplicate' | 'error';

type MatchResult =
	| { status: 'matched'; inbox: InboxRow; method: string }
	| { status: 'no_match'; reason: string }
	| { status: 'ambiguous_match'; method: string; matches: InboxRow[]; reason: string };

async function logWorker(action: string, metadata: Record<string, unknown>) {
	const { error } = await supabase.from('audit_logs').insert({ action, metadata });
	if (error) console.warn('[worker] audit log failed:', error.message);
}

/** Terminal states that never need to be re-processed. Unmatched messages are deliberately retryable. */
const TERMINAL_STATUSES = new Set(['saved', 'matched', 'duplicate']);

async function isTerminal(messageId: string): Promise<boolean> {
	const { data } = await supabase
		.from('processed_messages')
		.select('status')
		.eq('message_id', messageId)
		.maybeSingle();
	return data ? TERMINAL_STATUSES.has(data.status) : false;
}

async function recordProcessed(messageId: string, status: string, errorMessage?: string) {
	await supabase.from('processed_messages').upsert(
		{
			message_id: messageId,
			status,
			error_message: errorMessage ?? null,
			processed_at: new Date().toISOString()
		},
		{ onConflict: 'message_id' }
	);
}

async function logProcessing(input: {
	messageId: string;
	fromEmail?: string | null;
	subject?: string | null;
	receivedAt?: string | null;
	recipients: string[];
	scopedRecipients: string[];
	status: MatchStatus;
	matchedInbox?: InboxRow;
	matchedMethod?: string;
	detectedCode?: string | null;
	reason?: string;
	rawDebugPreview?: string;
}) {
	const { error } = await supabase.from('email_processing_logs').insert({
		message_id: input.messageId,
		from_email: input.fromEmail ?? null,
		subject: input.subject ?? null,
		received_at: input.receivedAt ?? null,
		all_detected_recipients: input.recipients,
		matched_inbox_id: input.matchedInbox?.id ?? null,
		matched_email_address: input.matchedInbox?.email_address ?? null,
		matched_method: input.matchedMethod ?? null,
		detected_code: input.detectedCode ?? null,
		match_status: input.status,
		error_message: input.reason ?? null,
		raw_debug_preview: input.rawDebugPreview ?? null
	});

	if (error) {
		console.warn('[worker] email_processing_logs insert failed:', error.message);
	}
}

async function fetchActiveInboxes(): Promise<InboxRow[]> {
	const now = new Date().toISOString();
	const { data, error } = await supabase
		.from('temp_inboxes')
		.select('id,user_id,email_address,local_part,expires_at,status')
		.eq('status', 'active')
		.ilike('email_address', `%@${DOMAIN}`)
		.or(`expires_at.is.null,expires_at.gt.${now}`)
		.order('created_at', { ascending: false });

	if (error) throw error;

	const inboxes = (data ?? []).map((row) => ({
		...row,
		email_address: row.email_address.toLowerCase(),
		local_part: row.local_part.toLowerCase()
	}));
	const nullExpiry = inboxes.filter((row) => row.expires_at === null).length;
	const validExpiry = inboxes.length - nullExpiry;
	console.log(
		`[worker] active inbox count=${inboxes.length} expires_at: null=${nullExpiry} valid=${validExpiry}`
	);
	return inboxes;
}

function normalizeRecipientValue(value: string) {
	return value
		.trim()
		.toLowerCase()
		.replace(/[<>"']/g, '')
		.replace(/^[,;:()\[\]\s]+|[,;:()\[\]\s]+$/g, '');
}

function stringifyHeaderValue(value: unknown): string {
	if (value == null) return '';
	if (typeof value === 'string') return value;
	if (Array.isArray(value)) return value.map((item) => stringifyHeaderValue(item)).join(' ');
	if (value instanceof Date) return value.toISOString();
	if (typeof value === 'object') {
		const obj = value as { text?: string; value?: unknown; address?: string; html?: string };
		if (typeof obj.text === 'string') return obj.text;
		if (typeof obj.address === 'string') return obj.address;
		if (typeof obj.html === 'string') return obj.html;
		if (obj.value !== undefined) return stringifyHeaderValue(obj.value);
	}
	return String(value);
}

function extractEmailsFromText(value: string): string[] {
	const recipients = new Set<string>();
	for (const match of value.matchAll(EMAIL_REGEX)) {
		const email = normalizeRecipientValue(match[0]);
		recipients.add(email);
		recipients.add(email.split('@')[0]);
	}
	return [...recipients];
}

function maybeAddLocalPart(value: string, recipients: Set<string>) {
	const normalized = normalizeRecipientValue(value);
	if (!normalized || normalized.includes('@')) return;
	if (!LOCAL_PART_REGEX.test(normalized)) return;
	if (LOCAL_PART_STOPWORDS.has(normalized)) return;
	recipients.add(normalized);
}

function addRecipientValuesFromHeader(
	value: unknown,
	recipients: Set<string>,
	includeBareLocalParts = true
) {
	const raw = stringifyHeaderValue(value);
	if (!raw) return;

	for (const emailOrLocal of extractEmailsFromText(raw)) {
		recipients.add(emailOrLocal);
	}

	if (!includeBareLocalParts) return;

	for (const token of raw.split(/[\s,;]+/)) {
		maybeAddLocalPart(token, recipients);
	}
}

function addAddressObjectValues(
	value: AddressObject | AddressObject[] | undefined,
	recipients: Set<string>
) {
	if (!value) return;
	const objects = Array.isArray(value) ? value : [value];

	for (const object of objects) {
		addRecipientValuesFromHeader(object.text, recipients);
		for (const address of object.value ?? []) {
			addRecipientValuesFromHeader(address.address, recipients);
			addRecipientValuesFromHeader(address.name, recipients);
		}
	}
}

function rawSearchText(source: Buffer, mail: ParsedMail): string {
	const headerText = [...mail.headers.entries()]
		.map(([key, value]) => `${key}: ${stringifyHeaderValue(value)}`)
		.join('\n');
	return [
		headerText,
		mail.subject ?? '',
		mail.text ?? '',
		typeof mail.html === 'string' ? mail.html : '',
		source.toString('utf8')
	]
		.join('\n')
		.toLowerCase()
		.replace(/[<>"'\r]/g, ' ')
		.replace(/\s+/g, ' ');
}

function extractHeaderRecipientValuesFromRaw(source: Buffer, recipients: Set<string>) {
	const headerText = source.toString('utf8').split(/\r?\n\r?\n/, 1)[0] ?? '';
	for (const line of headerText.split(/\r?\n/)) {
		const match = line.match(
			/^(to|cc|bcc|delivered-to|x-original-to|envelope-to|x-envelope-to|original-recipient|final-recipient):\s*(.+)$/i
		);
		if (match?.[2]) addRecipientValuesFromHeader(match[2], recipients);
	}
}

function extractAllRecipients(mail: ParsedMail, source: Buffer, rawText: string) {
	const recipients = new Set<string>();
	const headerNames = [
		'to',
		'cc',
		'bcc',
		'delivered-to',
		'x-original-to',
		'envelope-to',
		'x-envelope-to',
		'original-recipient',
		'final-recipient',
		'return-path',
		'received'
	];

	for (const recipient of extractRecipientCandidates(mail)) {
		for (const emailOrLocal of extractEmailsFromText(recipient)) {
			recipients.add(emailOrLocal);
		}
	}

	addAddressObjectValues(mail.to, recipients);
	addAddressObjectValues(mail.cc, recipients);
	addAddressObjectValues(mail.bcc, recipients);

	for (const headerName of headerNames) {
		addRecipientValuesFromHeader(
			mail.headers.get(headerName),
			recipients,
			headerName !== 'received'
		);
	}

	for (const email of extractEmailsFromText(rawText)) {
		recipients.add(email);
	}

	extractHeaderRecipientValuesFromRaw(source, recipients);

	const normalizedRecipients = [...recipients].filter(Boolean).sort();
	const scopedRecipients = normalizedRecipients.filter((recipient) =>
		recipient.endsWith(`@${DOMAIN}`)
	);
	const localRecipients = normalizedRecipients.filter((recipient) => !recipient.includes('@'));

	return { normalizedRecipients, scopedRecipients, localRecipients };
}

function containsToken(source: string, token: string) {
	const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`(^|[^a-z0-9._-])${escaped}([^a-z0-9._-]|$)`, 'i').test(source);
}

function cleanedFullBody(mail: ParsedMail, preview: string) {
	if (mail.text) return mail.text;
	if (typeof mail.html === 'string') {
		return convert(mail.html, {
			wordwrap: false,
			selectors: [
				{ selector: 'a', options: { ignoreHref: true } },
				{ selector: 'img', format: 'skip' },
				{ selector: 'style', format: 'skip' },
				{ selector: 'script', format: 'skip' }
			]
		})
			.replace(/\s+/g, ' ')
			.trim();
	}
	return preview;
}

function uniqueMatches(inboxes: InboxRow[], predicate: (inbox: InboxRow) => boolean) {
	const matches = new Map<string, InboxRow>();
	for (const inbox of inboxes) {
		if (predicate(inbox)) matches.set(inbox.id, inbox);
	}
	return [...matches.values()];
}

function chooseMatch(matches: InboxRow[], method: string): MatchResult | null {
	if (matches.length === 0) return null;
	if (matches.length === 1) return { status: 'matched', inbox: matches[0], method };
	return {
		status: 'ambiguous_match',
		method,
		matches,
		reason: `${matches.length} active inboxes matched by ${method}`
	};
}

function matchInbox(
	inboxes: InboxRow[],
	normalizedRecipients: string[],
	scopedRecipients: string[],
	localRecipients: string[],
	rawText: string
): MatchResult {
	if (inboxes.length === 0) {
		return { status: 'no_match', reason: `No active inboxes under @${DOMAIN}` };
	}

	const exactRecipients = new Set(scopedRecipients);
	const exactLocalParts = new Set(localRecipients);
	const matchStages: Array<{ method: string; predicate: (inbox: InboxRow) => boolean }> = [
		{
			method: 'full_email_header',
			predicate: (inbox) => exactRecipients.has(inbox.email_address)
		},
		{
			method: 'local_part_header',
			predicate: (inbox) => exactLocalParts.has(inbox.local_part)
		},
		{
			method: 'full_email_raw',
			predicate: (inbox) => rawText.includes(inbox.email_address)
		},
		{
			method: 'local_part_raw',
			predicate: (inbox) => containsToken(rawText, inbox.local_part)
		}
	];

	for (const stage of matchStages) {
		const result = chooseMatch(uniqueMatches(inboxes, stage.predicate), stage.method);
		if (result) return result;
	}

	return {
		status: 'no_match',
		reason:
			scopedRecipients.length > 0
				? `No active inbox matched scoped recipients: ${scopedRecipients.join(', ')}`
				: `No active inbox matched normalized recipients: ${normalizedRecipients.join(', ')}`
	};
}

async function processMessage(
	source: Buffer
): Promise<'matched' | 'skipped' | 'no_match' | 'ambiguous_match'> {
	const mail = await simpleParser(source);
	const messageId =
		mail.messageId ||
		`${mail.date?.toISOString() ?? Date.now()}-${(mail.subject ?? 'no-subject').slice(0, 80)}`;
	const receivedAt = mail.date?.toISOString() ?? new Date().toISOString();
	const recentCutoff = Date.now() - OTP_WINDOW_MINUTES * 60 * 1000;

	if (new Date(receivedAt).getTime() < recentCutoff) {
		return 'skipped';
	}

	if (await isTerminal(messageId)) return 'skipped';

	const rawText = rawSearchText(source, mail);
	const { normalizedRecipients, scopedRecipients, localRecipients } = extractAllRecipients(
		mail,
		source,
		rawText
	);
	const activeInboxes = await fetchActiveInboxes();
	const match = matchInbox(
		activeInboxes,
		normalizedRecipients,
		scopedRecipients,
		localRecipients,
		rawText
	);
	const sender = mail.from?.value?.[0]?.address ?? mail.from?.text ?? null;
	const rawDebugPreview = rawText.slice(0, 500);

	console.log(`[worker] msgId=${messageId.slice(0, 60)}`);
	console.log(
		`[worker]   extracted recipients: ${JSON.stringify([...scopedRecipients, ...localRecipients])}`
	);
	console.log(`[worker]   normalized recipients: ${JSON.stringify(normalizedRecipients)}`);
	console.log(`[worker]   scoped to ${DOMAIN}: ${JSON.stringify(scopedRecipients)}`);

	if (match.status === 'no_match') {
		console.log(`[worker] NO_MATCH reason=${match.reason}`);
		await logProcessing({
			messageId,
			fromEmail: sender,
			subject: mail.subject ?? null,
			receivedAt,
			recipients: normalizedRecipients,
			scopedRecipients,
			status: 'no_match',
			reason: match.reason,
			rawDebugPreview
		});
		return 'no_match';
	}

	if (match.status === 'ambiguous_match') {
		console.log(
			`[worker] AMBIGUOUS method=${match.method} matches=${match.matches
				.map((inbox) => inbox.email_address)
				.join(', ')}`
		);
		await logProcessing({
			messageId,
			fromEmail: sender,
			subject: mail.subject ?? null,
			receivedAt,
			recipients: normalizedRecipients,
			scopedRecipients,
			status: 'ambiguous_match',
			matchedMethod: match.method,
			reason: match.reason,
			rawDebugPreview
		});
		return 'ambiguous_match';
	}

	const inbox = match.inbox;
	console.log(
		`[worker] MATCHED email=${inbox.email_address} method=${match.method} expires_at=${
			inbox.expires_at ?? 'null'
		}`
	);
	const detectedCode = extractOtp({
		subject: mail.subject,
		text: mail.text,
		html: typeof mail.html === 'string' ? mail.html : null
	});
	console.log(`[worker]   detected OTP: ${detectedCode ?? 'none'}`);

	const preview = bodyPreview(mail.text, typeof mail.html === 'string' ? mail.html : null);
	const fullBody = cleanedFullBody(mail, preview);

	const { error } = await supabase.from('received_emails').insert({
		user_id: inbox.user_id,
		inbox_id: inbox.id,
		recipient_email: inbox.email_address,
		sender_email: sender,
		subject: mail.subject ?? null,
		body_preview: preview,
		full_body: fullBody,
		detected_code: detectedCode,
		message_id: messageId,
		received_at: receivedAt
	});

	if (error) {
		if (error.code === '23505') {
			await recordProcessed(messageId, 'duplicate');
			await logProcessing({
				messageId,
				fromEmail: sender,
				subject: mail.subject ?? null,
				receivedAt,
				recipients: normalizedRecipients,
				scopedRecipients,
				status: 'duplicate',
				matchedInbox: inbox,
				matchedMethod: match.method,
				detectedCode,
				reason: 'received_emails.message_id already exists',
				rawDebugPreview
			});
			return 'skipped';
		}
		await recordProcessed(messageId, 'error', error.message);
		await logProcessing({
			messageId,
			fromEmail: sender,
			subject: mail.subject ?? null,
			receivedAt,
			recipients: normalizedRecipients,
			scopedRecipients,
			status: 'error',
			matchedInbox: inbox,
			matchedMethod: match.method,
			detectedCode,
			reason: error.message,
			rawDebugPreview
		});
		throw error;
	}

	await recordProcessed(messageId, 'matched');
	await logProcessing({
		messageId,
		fromEmail: sender,
		subject: mail.subject ?? null,
		receivedAt,
		recipients: normalizedRecipients,
		scopedRecipients,
		status: 'matched',
		matchedInbox: inbox,
		matchedMethod: match.method,
		detectedCode,
		rawDebugPreview
	});
	return 'matched';
}

async function safeDisconnect(client: ImapFlow) {
	try {
		const socket = (client as unknown as { socket?: { destroyed?: boolean } }).socket;
		if (!client.usable || socket?.destroyed) return;
		client.close();
	} catch (err) {
		console.warn(
			'[worker] imap close skipped/failed:',
			err instanceof Error ? err.message : String(err)
		);
	}
}

export async function pollOnce() {
	const client = new ImapFlow({
		host: TITAN_IMAP_HOST,
		port: Number(TITAN_IMAP_PORT),
		secure: true,
		auth: { user: TITAN_IMAP_USER!, pass: TITAN_IMAP_PASSWORD! },
		logger: false,
		socketTimeout: 60_000
	});

	client.on('error', (err) => {
		console.warn('[worker] imap socket error (will reconnect):', err.message);
	});

	await client.connect();
	try {
		const lock = await client.getMailboxLock('INBOX');
		try {
			const since = new Date(Date.now() - OTP_WINDOW_MINUTES * 60 * 1000);
			// Only recent mail can produce a returned OTP.
			const uids = await client.search({ since });
			if (!uids || uids.length === 0) return;

			const recent = uids.slice(-FETCH_BATCH_SIZE).reverse();
			let matched = 0;
			let noMatch = 0;
			let ambiguous = 0;
			let skipped = 0;

			for await (const message of client.fetch(recent, { source: true, uid: true })) {
				if (!message.source) continue;
				try {
					const status = await processMessage(Buffer.from(message.source));
					if (status === 'matched') matched++;
					else if (status === 'no_match') noMatch++;
					else if (status === 'ambiguous_match') ambiguous++;
					else skipped++;
				} catch (err) {
					console.error(`[worker] message failed uid=${message.uid}`, err);
					await logWorker('worker.message.error', {
						uid: message.uid,
						message: err instanceof Error ? err.message : String(err)
					});
				}
			}

			if (matched + noMatch + ambiguous > 0) {
				console.log(
					`[worker] scanned latest=${recent.length} newest-first matched=${matched} no_match=${noMatch} ambiguous=${ambiguous} skipped=${skipped}`
				);
			}
		} finally {
			lock.release();
		}
	} finally {
		await safeDisconnect(client);
	}
}

async function runForever() {
	console.log(`[worker] Titan IMAP worker started for domain ${DOMAIN}`);
	console.log(
		`[worker] OTP window: last ${OTP_WINDOW_MINUTES} minutes, poll every ${POLL_INTERVAL_MS}ms`
	);
	let backoff = POLL_INTERVAL_MS;

	for (;;) {
		try {
			await pollOnce();
			backoff = POLL_INTERVAL_MS;
		} catch (err) {
			console.error('[worker] poll failed', err);
			await logWorker('worker.poll.error', {
				message: err instanceof Error ? err.message : String(err)
			});
			backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
		}
		await new Promise<void>((r) => setTimeout(r, backoff));
	}
}

let shuttingDown = false;
function shutdown(signal: string) {
	if (shuttingDown) return;
	shuttingDown = true;
	console.log(`[worker] received ${signal}, shutting down…`);
	process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

const isCliRun = fileURLToPath(import.meta.url) === process.argv[1];

if (isCliRun) {
	runForever().catch((err) => {
		console.error('[worker] fatal', err);
		process.exit(1);
	});
}
