import { convert } from 'html-to-text';

const KEYWORD_PATTERN =
	/(otp|verification|verify|security|login|sign[\s-]?in|confirm|code|passcode|one[\s-]?time|pin)/i;
const CODE_PATTERN = /\b([0-9]{4,8}|[A-Z0-9]{2,4}-[A-Z0-9]{3,8}|[A-Z]{2,4}[0-9]{2,6})\b/g;
const PRIORITY_CODE_PATTERNS = [
	/Change Email using OTP:\s*([0-9]{4,8})/i,
	/using OTP:\s*([0-9]{4,8})/i,
	/OTP:\s*([0-9]{4,8})/i,
	/otp[^0-9]{0,20}([0-9]{4,8})/i,
	/code[^0-9]{0,20}([0-9]{4,8})/i,
	/\b([0-9]{4,8})\b/
];
const URL_PATTERN = /^https?:\/\//i;

function cleanHtml(html?: string | null): string {
	if (!html) return '';
	return convert(html, {
		wordwrap: false,
		selectors: [
			{ selector: 'a', options: { ignoreHref: true } },
			{ selector: 'img', format: 'skip' },
			{ selector: 'style', format: 'skip' },
			{ selector: 'script', format: 'skip' }
		]
	});
}

function scoreCandidate(candidate: string, source: string): number {
	if (URL_PATTERN.test(candidate)) return -100;
	if (/^(19|20)\d{2}$/.test(candidate)) return -20;
	if (candidate.length > 12) return -10;

	const index = source.indexOf(candidate);
	const nearby = source.slice(Math.max(0, index - 64), index + candidate.length + 64);
	let score = 0;

	if (/^[0-9]{6}$/.test(candidate)) score += 10;
	else if (/^[0-9]{4,8}$/.test(candidate)) score += 8;
	if (KEYWORD_PATTERN.test(nearby)) score += 12;
	if (candidate.includes('-')) score += 2;
	if (/\d{7,}/.test(candidate)) score -= 4;

	return score;
}

function extractFromSource(source?: string | null): string | null {
	if (!source) return null;
	for (const pattern of PRIORITY_CODE_PATTERNS) {
		const match = source.match(pattern);
		if (match?.[1]) return match[1].toUpperCase();
	}

	const normalized = source.replace(/\s+/g, ' ').trim().toUpperCase();
	const candidates = [...normalized.matchAll(CODE_PATTERN)]
		.map((m) => m[1])
		.filter(Boolean)
		.map((code) => ({ code, score: scoreCandidate(code, normalized) }))
		.filter((item) => item.score > 0)
		.sort((a, b) => b.score - a.score);
	return candidates[0]?.code ?? null;
}

export function extractOtp(input: {
	subject?: string | null;
	text?: string | null;
	html?: string | null;
}): string | null {
	return (
		extractFromSource(input.subject) ??
		extractFromSource(input.text) ??
		extractFromSource(cleanHtml(input.html))
	);
}

export function bodyPreview(text?: string | null, html?: string | null): string {
	const source = text || cleanHtml(html);
	return source.replace(/\s+/g, ' ').trim().slice(0, 240);
}
