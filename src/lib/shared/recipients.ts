import type { AddressObject, ParsedMail } from 'mailparser';
import { normalizeEmail } from './inbox';

const EMAIL_REGEX = /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/gi;

export function extractRecipientCandidates(mail: ParsedMail): string[] {
	const recipients = new Set<string>();

	const priorityHeaders = [
		'delivered-to',
		'x-original-to',
		'envelope-to',
		'x-forwarded-to',
		'x-rcpt-to'
	];
	for (const headerName of priorityHeaders) {
		addAddress(mail.headers.get(headerName), recipients);
	}

	addAddress(addressText(mail.to), recipients);
	addAddress(addressText(mail.cc), recipients);
	addAddress(addressText(mail.bcc), recipients);

	for (const headerName of ['to', 'cc', 'bcc']) {
		addAddress(mail.headers.get(headerName), recipients);
	}

	return [...recipients];
}

function addAddress(value: unknown, recipients: Set<string>) {
	if (!value) return;
	let raw: string;
	if (Array.isArray(value)) {
		raw = value.map((item) => stringifyHeaderValue(item)).join(',');
	} else {
		raw = stringifyHeaderValue(value);
	}
	const matches = raw.match(EMAIL_REGEX) ?? [];
	for (const email of matches) {
		recipients.add(normalizeEmail(email));
	}
}

function stringifyHeaderValue(value: unknown): string {
	if (value == null) return '';
	if (typeof value === 'string') return value;
	if (typeof value === 'object') {
		const obj = value as { text?: string; value?: unknown; address?: string };
		if (typeof obj.text === 'string') return obj.text;
		if (typeof obj.address === 'string') return obj.address;
		if (obj.value !== undefined) return stringifyHeaderValue(obj.value);
	}
	return String(value);
}

function addressText(value?: AddressObject | AddressObject[]): string {
	if (!value) return '';
	return Array.isArray(value) ? value.map((item) => item.text).join(',') : value.text;
}
