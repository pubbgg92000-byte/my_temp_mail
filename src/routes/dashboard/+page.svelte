<script lang="ts">
	import JackpotOtp from '$lib/components/JackpotOtp.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { supabase } from '$lib/supabase/client';
	import type { InboxMessage, TempInbox } from '$lib/types';
	import type { PageData } from './$types';
	import { browser } from '$app/environment';
	import { goto, invalidateAll } from '$app/navigation';
	import { onDestroy, onMount } from 'svelte';

	let { data }: { data: PageData } = $props();

	type ThemeMode = 'light' | 'dark' | 'system';
	type ToastTone = 'success' | 'error' | 'info';

	let inboxes = $state<TempInbox[]>([]);
	let selectedId = $state<string | null>(null);
	let messages = $state<InboxMessage[]>([]);
	let latestCode = $state<string | null>(null);
	let customLocalPart = $state('');
	let messageSearch = $state('');
	let loadingInboxes = $state(false);
	let creating = $state(false);
	let refreshing = $state(false);
	let checkingMail = $state(false);
	let isRefreshing = $state(false);
	let lastRefreshAt = 0;
	let syncCooldownUntil = $state(0);
	let smartCheckUntil = $state(0);
	let now = $state(Date.now());
	let themeMode = $state<ThemeMode>('system');
	let dark = $state(false);
	let palette = $state('default');
	let menuOpen = $state(false);
	let menuTab = $state<'pages' | 'theme' | 'more'>('pages');
	let profileOpen = $state(false);
	let expandedHelper = $state<string | null>(null);
	let expandedMessageId = $state<string | null>(null);
	let rowActionsOpenId = $state<string | null>(null);
	let showLastFiveMessages = $state(false);
	let editingNoteId = $state<string | null>(null);
	let noteDrafts = $state<Record<string, string>>({});
	let mailNotes = $state<Record<string, string>>({});
	let deleteTarget = $state<TempInbox | null>(null);
	let toast = $state<{ message: string; tone: ToastTone } | null>(null);
	let toastTimer: ReturnType<typeof setTimeout> | undefined;
	let clockTimer: ReturnType<typeof setInterval> | undefined;
	let smartCheckTimer: ReturnType<typeof setTimeout> | undefined;
	let scrollSaveTimer: ReturnType<typeof setTimeout> | undefined;
	let systemThemeQuery: MediaQueryList | undefined;
	let systemThemeListener: ((event: MediaQueryListEvent) => void) | undefined;
	let menuWrapper: HTMLDivElement | null = null;

	const cuteProfiles = [
		{ name: 'Pixel Pilot', emoji: '🚀' },
		{ name: 'Inbox Buddy', emoji: '📬' },
		{ name: 'Code Sprout', emoji: '🌱' },
		{ name: 'Signal Star', emoji: '✨' },
		{ name: 'Alias Ace', emoji: '⚡' }
	];

	const palettes = [
		{ id: 'default', label: 'Default', swatch: 'linear-gradient(135deg,#00ADB5,#EEEEEE)', tone: 'Two tone' },
		{ id: 'ocean', label: 'Ocean', swatch: 'linear-gradient(135deg,#38BDF8,#172033)', tone: 'Two tone' },
		{ id: 'forest', label: 'Forest', swatch: 'linear-gradient(135deg,#34D399,#18251F)', tone: 'Two tone' },
		{ id: 'rose', label: 'Rose', swatch: 'linear-gradient(135deg,#F472B6,#2D1B2F)', tone: 'Two tone' },
		{ id: 'slate', label: 'Slate', swatch: 'linear-gradient(135deg,#60A5FA,#222831)', tone: 'Two tone' },
		{ id: 'lagoon', label: 'Lagoon', swatch: 'linear-gradient(135deg,#2DD4BF,#7DD3FC,#102926)', tone: 'Multi tone' },
		{ id: 'sunset', label: 'Sunset', swatch: 'linear-gradient(135deg,#FB7185,#FBBF24,#2B1F2F)', tone: 'Multi tone' },
		{ id: 'citrus', label: 'Citrus', swatch: 'linear-gradient(135deg,#A3E635,#2DD4BF,#172419)', tone: 'Multi tone' },
		{ id: 'prism', label: 'Prism', swatch: 'linear-gradient(135deg,#A78BFA,#22D3EE,#F472B6)', tone: 'Multi tone' },
		{ id: 'neon', label: 'Neon Glass', swatch: 'linear-gradient(135deg,#45D89E,#9258FF,#10141D)', tone: 'Multi tone' }
	];
	const OTP_CHECK_WINDOW_MS = 60 * 1000;
	const OTP_CHECK_INTERVAL_MS = 4_000;

	const selectedInbox = $derived(
		inboxes.find((inbox) => inbox.id === selectedId) ?? inboxes[0] ?? null
	);
	const profileSeed = $derived(
		[...(data.email || data.displayName || 'otpnest')].reduce(
			(sum, char) => sum + char.charCodeAt(0),
			0
		)
	);
	const cuteProfile = $derived(cuteProfiles[profileSeed % cuteProfiles.length]);
	const displayProfileName = $derived(
		data.displayName === 'Guest' ? cuteProfile.name : data.displayName || cuteProfile.name
	);
	const canUseAdmin = $derived(data.role === 'admin' || data.role === 'main_admin');
	const syncCooldownRemaining = $derived(Math.max(0, Math.ceil((syncCooldownUntil - now) / 1000)));
	const smartCheckRemaining = $derived(Math.max(0, Math.ceil((smartCheckUntil - now) / 1000)));
	const smartCheckActive = $derived(smartCheckRemaining > 0 && !latestCode);
	const filteredMessages = $derived(
		messages.filter((message) => {
			const query = messageSearch.trim().toLowerCase();
			if (!query) return true;
			return [message.from, message.subject, message.bodyPreview, message.code]
				.filter(Boolean)
				.some((value) => String(value).toLowerCase().includes(query));
		})
	);

	function timeRemaining(expiresAt: string | null) {
		if (!expiresAt) return 'Active';
		const remaining = new Date(expiresAt).getTime() - now;
		if (remaining <= 0) return 'Expired';
		const minutes = Math.floor(remaining / 60000);
		const seconds = Math.floor((remaining % 60000) / 1000);
		return `${minutes}:${seconds.toString().padStart(2, '0')}`;
	}

	function formatDate(value: string | null) {
		return value ? new Date(value).toLocaleString() : 'Unknown time';
	}

	function formatShortDate(value: string | null) {
		if (!value) return 'Unknown date';
		const date = new Date(value);
		const day = date.getDate().toString().padStart(2, '0');
		const month = date.toLocaleString('en-US', { month: 'short' });
		const year = date.getFullYear().toString().slice(-2);
		return `${day}-${month}-${year}`;
	}

	function showToast(message: string, tone: ToastTone = 'success') {
		toast = { message, tone };
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = null), 3000);
	}

	async function readResponseError(response: Response) {
		try {
			const body = await response.json();
			return body.message || body.error || response.statusText;
		} catch {
			return await response.text();
		}
	}

	async function loadInboxes() {
		loadingInboxes = true;
		const response = await fetch('/api/inboxes');
		loadingInboxes = false;

		if (!response.ok) {
			showToast(await readResponseError(response), 'error');
			return [];
		}

		const body = await response.json();
		inboxes = body.inboxes;

		if (!selectedId && inboxes.length > 0) selectedId = inboxes[0].id;
		if (selectedId && !inboxes.some((inbox) => inbox.id === selectedId))
			selectedId = inboxes[0]?.id ?? null;
		return inboxes;
	}

	async function refreshMessages(force = false, inboxId = selectedInbox?.id) {
		if (!inboxId || isRefreshing) return;

		const refreshStartedAt = Date.now();
		if (!force && refreshStartedAt - lastRefreshAt < 5000) return;

		isRefreshing = true;
		lastRefreshAt = refreshStartedAt;
		refreshing = true;
		try {
			const response = await fetch(`/api/inbox/${inboxId}/messages`);

			if (!response.ok) {
				if (response.status === 429)
					showToast('Please wait a few seconds before refreshing again.', 'error');
				else showToast('Could not refresh messages.', 'error');
				return;
			}

			const body = await response.json();
			latestCode = body.latestCode;
			messages = (body.messages ?? []).slice(0, 5);
		} finally {
			isRefreshing = false;
			refreshing = false;
		}
	}

	function cleanLocalPart(value: string) {
		return value
			.trim()
			.split('@')[0]
			.toLowerCase()
			.replace(/[^a-z0-9._+-]/g, '');
	}

	function handleCustomInput(value: string) {
		customLocalPart = cleanLocalPart(value);
	}

	async function copyToClipboard(value: string, label: string) {
		await navigator.clipboard.writeText(value);
		showToast(`${label} copied`);
	}

	async function createRandom() {
		if (creating) return;
		creating = true;
		const response = await fetch('/api/inbox/random', { method: 'POST' });
		creating = false;

		if (!response.ok) {
			showToast(await readResponseError(response), 'error');
			return;
		}

		const body = await response.json();
		await loadInboxes();
		selectedId = body.inboxId;
		messages = [];
		latestCode = null;
		await navigator.clipboard.writeText(body.email).catch(() => undefined);
		showToast('Mail created and copied');
		startSmartCheck(body.inboxId);
	}

	async function createCustom() {
		if (creating) return;
		const localPart = cleanLocalPart(customLocalPart);
		if (!localPart) {
			showToast('Enter a local part first.', 'error');
			return;
		}

		creating = true;
		const response = await fetch('/api/inbox/custom', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ localPart })
		});
		creating = false;

		if (!response.ok) {
			showToast(await readResponseError(response), 'error');
			return;
		}

		const body = await response.json();
		customLocalPart = '';
		await loadInboxes();
		selectedId = body.inboxId;
		messages = [];
		latestCode = null;
		await navigator.clipboard.writeText(body.email).catch(() => undefined);
		showToast('Mail created and copied');
		startSmartCheck(body.inboxId);
	}

	async function checkMailForInbox(inboxId: string, silent = false) {
		if (checkingMail || syncCooldownRemaining > 0) return false;

		checkingMail = true;
		syncCooldownUntil = Date.now() + 8_000;
		if (!silent) showToast('Checking mail...', 'info');
		try {
			const response = await fetch(`/api/inbox/${inboxId}/sync`, { method: 'POST' });
			if (!response.ok && response.status !== 202) {
				if (response.status === 429) {
					const body = await response.json().catch(() => ({ retryAfter: 8 }));
					syncCooldownUntil = Date.now() + Number(body.retryAfter ?? 8) * 1000;
					if (!silent) showToast(body.message ?? 'Please wait before checking again.', 'error');
					return false;
				}
				if (!silent) showToast(await readResponseError(response), 'error');
				return false;
			}
			await refreshMessages(true, inboxId);
			if (!silent) showToast('Mail checked');
			return true;
		} finally {
			checkingMail = false;
		}
	}

	async function checkMail() {
		if (!selectedInbox) return;
		latestCode = null;
		startSmartCheck(selectedInbox.id);
	}

	function startSmartCheck(inboxId: string) {
		if (smartCheckTimer) clearTimeout(smartCheckTimer);
		smartCheckUntil = Date.now() + OTP_CHECK_WINDOW_MS;

		const runOnce = async () => {
			if (selectedId !== inboxId || latestCode || Date.now() >= smartCheckUntil) {
				smartCheckUntil = 0;
				return;
			}

			const startedAt = Date.now();
			await checkMailForInbox(inboxId, true);
			await refreshMessages(true, inboxId);
			const elapsed = Date.now() - startedAt;

			if (selectedId !== inboxId || latestCode || Date.now() >= smartCheckUntil) {
				smartCheckUntil = 0;
				return;
			}

			smartCheckTimer = setTimeout(runOnce, Math.max(0, OTP_CHECK_INTERVAL_MS - elapsed));
		};

		smartCheckTimer = setTimeout(runOnce, 250);
	}

	function stopSmartCheck() {
		if (smartCheckTimer) clearTimeout(smartCheckTimer);
		smartCheckUntil = 0;
		checkingMail = false;
		showToast('OTP checking stopped', 'info');
	}

	async function selectInbox(inbox: TempInbox) {
		selectedId = inbox.id;
		rowActionsOpenId = inbox.id;
		messages = [];
		latestCode = null;
		await navigator.clipboard.writeText(inbox.emailAddress).catch(() => undefined);
		startSmartCheck(inbox.id);
		showToast('Mail selected and copied', 'info');
	}

	async function deleteInbox(id: string) {
		const response = await fetch(`/api/inbox/${id}`, { method: 'DELETE' });

		if (!response.ok) {
			showToast(await readResponseError(response), 'error');
			return;
		}

		messages = selectedId === id ? [] : messages;
		latestCode = selectedId === id ? null : latestCode;
		selectedId = selectedId === id ? null : selectedId;
		await loadInboxes();
		showToast('Alias deleted');
	}

	function startNote(inbox: TempInbox) {
		editingNoteId = inbox.id;
		noteDrafts = { ...noteDrafts, [inbox.id]: mailNotes[inbox.id] ?? '' };
	}

	function saveNote(inboxId: string) {
		const value = (noteDrafts[inboxId] ?? '').trim();
		mailNotes = { ...mailNotes, [inboxId]: value };
		localStorage.setItem(`alias-note-${inboxId}`, value);
		localStorage.setItem('av-mail-notes', JSON.stringify(mailNotes));
		editingNoteId = null;
		showToast('Note saved');
	}

	function cancelNote() {
		editingNoteId = null;
	}

	async function logout() {
		await supabase.auth.signOut();
		await invalidateAll();
		await goto('/login');
	}

	function systemPrefersDark() {
		return window.matchMedia('(prefers-color-scheme: dark)').matches;
	}

	function applyTheme(mode: ThemeMode) {
		themeMode = mode;
		const shouldDark = mode === 'dark' || (mode === 'system' && systemPrefersDark());
		dark = shouldDark;
		document.documentElement.classList.toggle('dark', shouldDark);
		localStorage.setItem('theme', mode);
	}

	function setPalette(nextPalette: string) {
		palette = nextPalette;
		document.documentElement.dataset.palette = nextPalette;
		localStorage.setItem('palette', nextPalette);
	}

	function closeOverlays() {
		menuOpen = false;
		profileOpen = false;
		deleteTarget = null;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') closeOverlays();
	}

	function handleDocumentPointerdown(event: PointerEvent) {
		if (!menuOpen || !menuWrapper) return;
		const target = event.target;
		if (target instanceof Node && !menuWrapper.contains(target)) menuOpen = false;
	}

	function handleScroll() {
		if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
		scrollSaveTimer = setTimeout(() => {
			sessionStorage.setItem('scroll-position-dashboard', String(window.scrollY));
		}, 120);
	}

	$effect(() => {
		if (!browser) return;
		document.body.style.overflow = menuOpen ? 'hidden' : '';

		return () => {
			document.body.style.overflow = '';
		};
	});

	onMount(() => {
		const storedTheme = (localStorage.getItem('theme') as ThemeMode | null) ?? 'system';
		systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
		systemThemeListener = () => {
			if (themeMode === 'system') applyTheme('system');
		};
		systemThemeQuery.addEventListener('change', systemThemeListener);
		applyTheme(storedTheme);
		setPalette(localStorage.getItem('palette') ?? 'default');

		const storedNotes = JSON.parse(localStorage.getItem('av-mail-notes') ?? '{}') as Record<
			string,
			string
		>;
		mailNotes = storedNotes;
		loadInboxes().then((loadedInboxes) => {
			const inboxId = selectedId ?? loadedInboxes[0]?.id;
			if (inboxId) refreshMessages(true, inboxId);
			const savedScroll = Number(sessionStorage.getItem('scroll-position-dashboard') ?? 0);
			if (savedScroll > 0)
				requestAnimationFrame(() => window.scrollTo({ top: savedScroll, behavior: 'auto' }));
		});
		clockTimer = setInterval(() => (now = Date.now()), 1000);
		window.addEventListener('keydown', handleKeydown);
		window.addEventListener('pointerdown', handleDocumentPointerdown, true);
		window.addEventListener('scroll', handleScroll, { passive: true });
	});

	onDestroy(() => {
		if (toastTimer) clearTimeout(toastTimer);
		if (clockTimer) clearInterval(clockTimer);
		if (smartCheckTimer) clearTimeout(smartCheckTimer);
		if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
		if (!browser) return;
		if (systemThemeQuery && systemThemeListener)
			systemThemeQuery.removeEventListener('change', systemThemeListener);
		window.removeEventListener('keydown', handleKeydown);
		window.removeEventListener('pointerdown', handleDocumentPointerdown, true);
		window.removeEventListener('scroll', handleScroll);
	});
</script>

<svelte:head>
	<title>Private OTP Inbox Dashboard</title>
	<meta
		name="description"
		content="Generate temporary email aliases, receive verification messages, and copy OTP codes from a secure dashboard."
	/>
</svelte:head>

<div class="app-shell">
	{#if toast}
		<div
			class="toast-message toast-{toast.tone}"
			role={toast.tone === 'error' ? 'alert' : 'status'}
		>
			{toast.message}
		</div>
	{/if}

	<main class="mt-4 space-y-4">
		<section class="compact-helper-grid" aria-label="Quick account and help">
			{#each [{ id: 'how', icon: '⚡', title: 'How it works', summary: 'Private OTP inboxes, made simple.', body: 'Create an alias, use it for verification, then copy the OTP when it arrives.', steps: ['Create a custom alias', 'Use it in the app or website', 'Click Get Verification Code', 'Copy the OTP'] }, { id: 'account', icon: '👤', title: 'Account details', summary: `${inboxes.length} aliases · ${messages.length} messages`, body: `Signed in as ${data.email || displayProfileName}. Your inboxes and messages stay scoped to your account.`, steps: ['Pick or create an alias', 'Keep useful notes locally', 'Delete aliases you no longer need'] }, { id: 'tips', icon: '💡', title: 'Quick tips', summary: 'Use your alias, then check mail.', body: 'OtpNest checks automatically for about 1 minute after you create or select an alias. If the code still has not arrived, press Get Verification Code.', steps: ['Create or select alias', 'Request OTP on the other site', 'Wait for smart check', 'Use manual check if needed'] }] as card}
				<article
					class="compact-helper-card"
					class:compact-helper-expanded={expandedHelper === card.id}
					onmouseenter={() => (expandedHelper = card.id)}
					onmouseleave={() => (expandedHelper = null)}
				>
					<button
						class="w-full text-left"
						onclick={() => (expandedHelper = expandedHelper === card.id ? null : card.id)}
						aria-expanded={expandedHelper === card.id}
					>
						<span class="text-xl" aria-hidden="true">{card.icon}</span>
						<span class="ml-2 font-black">{card.title}</span>
						<span class="muted mt-1 block truncate text-sm">{card.summary}</span>
					</button>
					<div class="compact-helper-body">
						<p>{card.body}</p>
						<ol>
							{#each card.steps as step}
								<li>{step}</li>
							{/each}
						</ol>
					</div>
				</article>
			{/each}
		</section>

		<section id="generate" class="dashboard-section" aria-labelledby="create-inbox-title">
			<div class="section-card">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div>
						<p class="kicker">Mail Generator</p>
						<h1
							id="create-inbox-title"
							class="mt-1 text-[clamp(1.7rem,4vw,3rem)] leading-tight font-black"
						>
							Create a custom alias
						</h1>
						<p class="muted mt-2 text-sm">
							Type only the local part. The app appends @avmail.online for you.
						</p>
					</div>
					{#if creating}<span class="badge">Creating alias</span>{/if}
				</div>

				<form
					class="mt-5 max-w-3xl"
					onsubmit={(event) => {
						event.preventDefault();
						createCustom();
					}}
				>
					<label class="text-sm font-black" for="custom-local-part">Custom mail</label>
					<div class="domain-input mt-2">
						<input
							id="custom-local-part"
							class="input border-0"
							value={customLocalPart}
							oninput={(event) => handleCustomInput(event.currentTarget.value)}
							onpaste={(event) => {
								event.preventDefault();
								handleCustomInput(event.clipboardData?.getData('text') ?? '');
							}}
							placeholder="Enter the custom mail id"
							pattern="[a-zA-Z0-9._+-]+"
							maxlength="32"
							autocapitalize="off"
							autocomplete="off"
							aria-describedby="custom-mail-hint"
						/>
						<span>@avmail.online</span>
					</div>
					<p id="custom-mail-hint" class="muted mt-2 text-xs">
						Use letters, numbers, dots, hyphens, underscores, or plus signs.
					</p>
					<button class="btn btn-primary mt-4 w-full sm:w-auto" disabled={creating}
						>{creating ? 'Creating...' : 'Create custom mail'}</button
					>
				</form>

				<div
					class="mt-4 max-w-3xl border-t pt-4 text-center sm:text-left"
					style="border-color: var(--border);"
				>
					<p class="muted mb-3 text-xs font-black uppercase">or</p>
					<button class="btn btn-secondary" onclick={createRandom} disabled={creating}>
						<span aria-hidden="true">✨</span>
						<span>{creating ? 'Generating...' : 'Generate random mail'}</span>
					</button>
					{#if creating}
						<div class="mt-4 max-w-md space-y-2">
							<div class="skeleton skeleton-line w-full"></div>
							<div class="skeleton skeleton-line w-2/3"></div>
						</div>
					{/if}
				</div>
			</div>
		</section>

		<section id="otp" class="dashboard-section" aria-labelledby="otp-title">
			<div class="section-card">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div class="min-w-0">
						<p class="kicker">OTP Viewer</p>
						<h2 id="otp-title" class="mt-1 text-2xl font-black">Latest verification code</h2>
						{#if selectedInbox}
							<div class="mt-1 flex min-w-0 items-center gap-2">
								<p class="muted truncate text-sm">{selectedInbox.emailAddress}</p>
								<button
									class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition hover:-translate-y-0.5"
									style="border-color: var(--border); color: var(--accent); background: var(--accent-soft);"
									onclick={() => copyToClipboard(selectedInbox.emailAddress, 'Mail')}
									aria-label="Copy selected mail"
									title="Copy mail"
								>
									<Icon name="copy" size={16} />
								</button>
							</div>
						{:else}
							<p class="muted mt-1 text-sm">Create or select an alias to check mail.</p>
						{/if}
					</div>
					<div class="flex flex-wrap gap-2">
						{#if selectedInbox}<button
								class="btn btn-secondary"
								onclick={() => copyToClipboard(selectedInbox.emailAddress, 'Mail')}
								aria-label="Copy selected mail">Copy mail</button
							>{/if}
						<button
							class="btn btn-primary"
							onclick={checkMail}
							disabled={!selectedInbox ||
								checkingMail ||
								smartCheckActive ||
								syncCooldownRemaining > 0}
						>
							{#if checkingMail}
								Checking<span class="checking-dots" aria-hidden="true"></span>
							{:else if smartCheckActive}
								Auto-checking {smartCheckRemaining}s
							{:else if syncCooldownRemaining > 0}
								Wait {syncCooldownRemaining}s
							{:else}
								Get Code
							{/if}
						</button>
						{#if checkingMail || smartCheckActive}
							<button
								class="btn btn-secondary"
								onclick={stopSmartCheck}
								aria-label="Stop OTP checking animation"
								title="Stop OTP checking"
							>
								<Icon name="pause" size={16} />
								<span>Stop</span>
							</button>
						{/if}
					</div>
				</div>

				<div class="otp-focus mt-5">
					<div
						class="otp-result-shell"
						aria-label={latestCode ? `Fetched OTP ${latestCode}` : 'OTP jackpot viewer'}
					>
						<JackpotOtp code={latestCode} spinning={checkingMail || smartCheckActive} length={6} />
						{#if latestCode}
							<button
								class="otp-copy-button has-tooltip"
								onclick={() => copyToClipboard(latestCode ?? '', 'OTP')}
								aria-label={`Copy OTP ${latestCode}`}
								data-tooltip="Copy OTP"
								title="Copy OTP"
							>
								<Icon name="copy" size={20} />
							</button>
						{/if}
					</div>
					<p class="muted mt-4 text-center text-sm">
						{#if checkingMail || smartCheckActive}
							Waiting for verification code...
						{:else if latestCode}
							Code received: {latestCode}
						{:else}
							Click Get Code to start jackpot animation.
						{/if}
					</p>
					{#if messages[0]}
						<p class="muted mt-5 text-center text-sm">
							From {messages[0].from ?? 'Unknown'} · {messages[0].subject ?? 'No subject'} · {formatDate(
								messages[0].receivedAt
							)}
						</p>
					{/if}
				</div>
			</div>
		</section>

		<section id="messages" class="dashboard-section" aria-labelledby="messages-title">
			<div class="section-card">
				<div class="flex flex-wrap items-center justify-between gap-3">
					<div>
						<p class="kicker">Message Viewer</p>
						<h2 id="messages-title" class="mt-1 text-2xl font-black">Messages</h2>
						<p class="muted mt-1 text-sm">Incoming verification emails will appear here.</p>
					</div>
					<label class="min-w-[min(100%,20rem)]">
						<span class="sr-only">Search messages</span>
						<input class="input" bind:value={messageSearch} placeholder="Search messages..." />
					</label>
				</div>

				{#if refreshing && messages.length === 0}
					<div class="mt-4 space-y-3">
						{#each Array(4) as _}
							<div class="skeleton-card">
								<div class="skeleton skeleton-line w-2/3"></div>
								<div class="skeleton skeleton-line mt-3 w-full"></div>
								<div class="skeleton skeleton-line mt-2 w-1/2"></div>
							</div>
						{/each}
					</div>
				{:else if messages.length === 0}
					<p class="empty-state">
						No messages yet. Request a code and click Get Verification Code.
					</p>
				{:else if filteredMessages.length === 0}
					<p class="empty-state">No messages match your search.</p>
				{:else}
					<div class="message-list">
						{#each filteredMessages.slice(0, 1) as message}
							<article class="message-card">
								<button
									class="min-w-0 flex-1 text-left"
									onclick={() =>
										(expandedMessageId = expandedMessageId === message.id ? null : message.id)}
									aria-expanded={expandedMessageId === message.id}
									aria-label={`Toggle details for ${message.subject ?? 'message'}`}
								>
									<span class="block truncate text-sm font-black"
										>{message.subject ?? 'No subject'}</span
									>
									<span class="muted mt-1 block truncate text-xs"
										>From {message.from ?? 'Unknown'} · {formatDate(message.receivedAt)}</span
									>
									<span class="muted mt-2 block text-sm leading-6"
										>{message.bodyPreview ?? 'No preview available.'}</span
									>
								</button>
								<div class="flex shrink-0 items-start gap-2">
									{#if message.code}<button
											class="badge"
											onclick={() => copyToClipboard(message.code ?? '', 'OTP')}
											aria-label={`Copy code ${message.code}`}>{message.code}</button
										>{/if}
								</div>
								{#if expandedMessageId === message.id}
									<div class="message-details">
										<p><strong>Sender:</strong> {message.from ?? 'Unknown'}</p>
										<p><strong>Subject:</strong> {message.subject ?? 'No subject'}</p>
										<p><strong>Detected OTP:</strong> {message.code ?? 'None detected'}</p>
									</div>
								{/if}
							</article>
						{/each}
						{#if filteredMessages.length > 1}
							<button
								class="btn btn-secondary w-full"
								onclick={() => (showLastFiveMessages = !showLastFiveMessages)}
							>
								{showLastFiveMessages ? 'Hide last 5 messages' : 'Show last 5 messages'}
							</button>
							{#if showLastFiveMessages}
								<div class="last-five-panel">
									{#each filteredMessages.slice(0, 5) as message}
										<article class="last-five-row">
											<div class="min-w-0">
												<p class="truncate text-sm font-black">{message.subject ?? 'No subject'}</p>
												<p class="muted truncate text-xs">
													{message.from ?? 'Unknown'} · {formatDate(message.receivedAt)}
												</p>
											</div>
											{#if message.code}
												<button
													class="badge"
													onclick={() => copyToClipboard(message.code ?? '', 'OTP')}
													aria-label={`Copy code ${message.code}`}>{message.code}</button
												>
											{/if}
										</article>
									{/each}
								</div>
							{/if}
						{/if}
					</div>
				{/if}
			</div>
		</section>

		<section id="history" class="dashboard-section" aria-labelledby="history-title">
			<div class="section-card">
				<div class="flex flex-wrap items-center justify-between gap-3">
					<div>
						<p class="kicker">Previous Inboxes</p>
						<h2 id="history-title" class="mt-1 text-2xl font-black">Alias history</h2>
					</div>
					{#if loadingInboxes}<span class="badge">Loading inboxes</span>{/if}
				</div>

				{#if loadingInboxes && inboxes.length === 0}
					<div class="history-grid mt-4">
						{#each Array(4) as _}
							<div class="skeleton-card">
								<div class="skeleton skeleton-line w-4/5"></div>
								<div class="skeleton skeleton-line mt-3 w-1/2"></div>
								<div class="skeleton skeleton-line mt-3 w-full"></div>
							</div>
						{/each}
					</div>
				{:else if inboxes.length === 0}
					<p class="empty-state">No inboxes yet. Create your first alias above.</p>
				{:else}
					<div class="history-scroll">
						{#each inboxes as inbox}
							{@const remaining = timeRemaining(inbox.expiresAt)}
							<article
								class="history-card"
								class:history-card-selected={selectedInbox?.id === inbox.id}
								onmouseenter={() => (rowActionsOpenId = inbox.id)}
								onmouseleave={() => (rowActionsOpenId = null)}
							>
								<div class="min-w-0 flex-1 text-left">
									<span class="block truncate text-sm font-black">{inbox.emailAddress}</span>
									<span class="muted mt-1 block text-xs"
										>Created {formatShortDate(inbox.createdAt)}{remaining === 'Expired'
											? ' · expired'
											: ''}</span
									>
									{#if mailNotes[inbox.id]}<span class="mt-2 block truncate text-xs"
											>{mailNotes[inbox.id]}</span
										>{/if}
								</div>
								<span class="badge">{remaining === 'Expired' ? 'expired' : 'active'}</span>
								<button
									class="icon-action has-tooltip md:hidden"
									onclick={() =>
										(rowActionsOpenId = rowActionsOpenId === inbox.id ? null : inbox.id)}
									aria-label="Open alias actions"
									data-tooltip="Actions"
									title="Actions"><Icon name="more" size={16} /></button
								>

								{#if rowActionsOpenId === inbox.id}
									<div class="history-actions">
										<button
											class="icon-action has-tooltip"
											onclick={() => copyToClipboard(inbox.emailAddress, 'Mail')}
											aria-label="Copy mail"
											data-tooltip="Copy mail"
											title="Copy mail"
										>
											<Icon name="copy" size={16} />
										</button>
										<button
											class="icon-action has-tooltip"
											onclick={() => selectInbox(inbox)}
											aria-label="Select mail"
											data-tooltip="Select mail"
											title="Select mail"
										>
											<Icon name="check" size={16} />
										</button>
										<button
											class="icon-action danger has-tooltip"
											onclick={() => (deleteTarget = inbox)}
											aria-label="Delete alias"
											data-tooltip="Delete alias"
											title="Delete alias"
										>
											<Icon name="trash" size={16} />
										</button>
									</div>
								{/if}

								<div class="col-span-full mt-3 w-full">
									{#if editingNoteId === inbox.id}
										<textarea
											class="input min-h-20 resize-none py-2"
											value={noteDrafts[inbox.id] ?? ''}
											placeholder="Add phone, order ID, purpose, note..."
											maxlength="120"
											oninput={(event) =>
												(noteDrafts = { ...noteDrafts, [inbox.id]: event.currentTarget.value })}
										></textarea>
										<div class="mt-2 flex gap-2">
											<button
												class="btn btn-primary min-h-8 px-3 py-1 text-xs"
												onclick={() => saveNote(inbox.id)}>Save note</button
											>
											<button
												class="btn btn-secondary min-h-8 px-3 py-1 text-xs"
												onclick={cancelNote}>Cancel</button
											>
										</div>
									{:else}
										<button
											class="text-xs font-semibold"
											style="color: var(--accent);"
											onclick={() => startNote(inbox)}
										>
											{mailNotes[inbox.id] ? 'Edit note' : 'Add more data'}
										</button>
									{/if}
								</div>
							</article>
						{/each}
					</div>
				{/if}
			</div>
		</section>
	</main>

	<footer
		class="mt-4 grid gap-3 rounded-lg border px-4 py-5 text-sm sm:grid-cols-[1fr_auto]"
		style="border-color: var(--border); background: var(--surface);"
	>
		<p class="muted">© 2026. Private OTP inboxes, made simple.</p>
		<nav class="flex flex-wrap gap-4" aria-label="Footer navigation">
			<a href="/privacy">Privacy</a>
			<a href="/terms">Terms</a>
			<a href="/support">Support</a>
			<a href="/contact">Contact</a>
		</nav>
	</footer>

	{#if deleteTarget}
		<div class="modal-backdrop" role="presentation">
			<div class="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title">
				<p class="kicker">Delete alias</p>
				<h2 id="delete-title" class="mt-2 text-2xl font-black">Delete this alias?</h2>
				<p class="muted mt-2 text-sm">This cannot be undone.</p>
				<p
					class="mt-4 truncate rounded-md border p-3 text-sm font-semibold"
					style="border-color: var(--border);"
				>
					{deleteTarget.emailAddress}
				</p>
				<div class="mt-5 grid gap-2 sm:grid-cols-2">
					<button class="btn btn-secondary" onclick={() => (deleteTarget = null)}>Cancel</button>
					<button
						class="btn btn-danger"
						onclick={async () => {
							const target = deleteTarget;
							deleteTarget = null;
							if (target) await deleteInbox(target.id);
						}}
					>
						Delete
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>
