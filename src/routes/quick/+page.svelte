<script lang="ts">
  import JackpotOtp from '$lib/components/JackpotOtp.svelte';
  import type { InboxMessage, TempInbox } from '$lib/types';
  import { goto, invalidateAll } from '$app/navigation';
  import { supabase } from '$lib/supabase/client';
  import { onDestroy, onMount } from 'svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  type Toast = { message: string; tone: 'success' | 'error' | 'info' };

  function initialState() {
    return {
      inboxes: data.inboxes,
      selectedId: data.inboxes[0]?.id ?? null,
      toast: data.loadError ? ({ message: data.loadError, tone: 'error' } satisfies Toast) : null
    };
  }

  const initial = initialState();

  let inboxes = $state<TempInbox[]>(initial.inboxes);
  let selectedId = $state<string | null>(initial.selectedId);
  let customLocalPart = $state('');
  let latestCode = $state<string | null>(null);
  let latestMessage = $state<InboxMessage | null>(null);
  let creating = $state(false);
  let checking = $state(false);
  let refreshing = $state(false);
  let dark = $state(false);
  let mailNotes = $state<Record<string, string>>({});
  let deleteTarget = $state<TempInbox | null>(null);
  let toast = $state<Toast | null>(initial.toast);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  const selectedInbox = $derived(inboxes.find((inbox) => inbox.id === selectedId) ?? null);

  function showToast(message: string, tone: Toast['tone'] = 'success') {
    toast = { message, tone };
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), 3000);
  }

  function cleanLocalPart(value: string) {
    return value.trim().split('@')[0].toLowerCase().replace(/[^a-z0-9_+-]/g, '');
  }

  function formatDate(value: string | null) {
    if (!value) return 'Unknown';
    const date = new Date(value);
    const day = date.getDate().toString().padStart(2, '0');
    const month = date.toLocaleString('en-US', { month: 'short' });
    const year = date.getFullYear().toString().slice(-2);
    return `${day}-${month}-${year}`;
  }

  function formatDateTime(value: string | null) {
    if (!value) return 'Unknown';
    const date = new Date(value);
    const day = date.getDate().toString().padStart(2, '0');
    const month = date.toLocaleString('en-US', { month: 'short' });
    const year = date.getFullYear().toString().slice(-2);
    const hour = date.getHours().toString().padStart(2, '0');
    const minute = date.getMinutes().toString().padStart(2, '0');
    return `${day}-${month}-${year} ${hour}:${minute}`;
  }

  async function readResponseError(response: Response) {
    try {
      const body = await response.json();
      return body.message || body.error || response.statusText;
    } catch {
      return response.statusText;
    }
  }

  async function copyText(value: string, message: string) {
    await navigator.clipboard.writeText(value);
    showToast(message);
  }

  async function reloadInboxes(selectId?: string) {
    const response = await fetch('/api/inboxes');
    if (!response.ok) {
      showToast(await readResponseError(response), 'error');
      return;
    }

    const body = await response.json();
    inboxes = body.inboxes ?? [];
    if (selectId) selectedId = selectId;
    else if (selectedId && !inboxes.some((inbox) => inbox.id === selectedId)) selectedId = inboxes[0]?.id ?? null;
    else if (!selectedId) selectedId = inboxes[0]?.id ?? null;
  }

  async function createCustom() {
    if (creating) return;
    const localPart = cleanLocalPart(customLocalPart);
    if (!localPart) {
      showToast('Enter a mail name first.', 'error');
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
    latestCode = null;
    latestMessage = null;
    await reloadInboxes(body.inboxId);
    showToast('Mail selected', 'info');
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
    latestCode = null;
    latestMessage = null;
    await reloadInboxes(body.inboxId);
    showToast('Mail selected', 'info');
  }

  async function refreshMessages(inboxId = selectedInbox?.id) {
    if (!inboxId) return;
    refreshing = true;
    const response = await fetch(`/api/inbox/${inboxId}/messages`);
    refreshing = false;

    if (!response.ok) {
      showToast(await readResponseError(response), 'error');
      return;
    }

    const body = await response.json();
    latestCode = body.latestCode ?? body.messages?.[0]?.code ?? null;
    latestMessage = body.messages?.[0] ?? null;
  }

  async function fetchCode() {
    if (!selectedInbox || checking) return;
    checking = true;
    const response = await fetch(`/api/inbox/${selectedInbox.id}/sync`, { method: 'POST' });
    checking = false;

    if (!response.ok && response.status !== 202) {
      showToast(await readResponseError(response), 'error');
      return;
    }

    await refreshMessages(selectedInbox.id);
  }

  async function selectInbox(inbox: TempInbox) {
    selectedId = inbox.id;
    latestCode = null;
    latestMessage = null;
    await navigator.clipboard.writeText(inbox.emailAddress).catch(() => undefined);
    showToast('Mail selected and copied', 'info');
    await refreshMessages(inbox.id);
  }

  async function deleteInbox(inbox: TempInbox) {
    const response = await fetch(`/api/inbox/${inbox.id}`, { method: 'DELETE' });
    if (!response.ok) {
      showToast(await readResponseError(response), 'error');
      return;
    }

    if (selectedId === inbox.id) {
      selectedId = null;
      latestCode = null;
      latestMessage = null;
    }
    deleteTarget = null;
    await reloadInboxes();
    showToast('Mail deleted');
  }

  function saveNote(inboxId: string, value: string) {
    const nextNotes = { ...mailNotes, [inboxId]: value };
    mailNotes = nextNotes;
    localStorage.setItem('av-mail-notes', JSON.stringify(nextNotes));
    localStorage.setItem(`alias-note-${inboxId}`, value);
  }

  function toggleTheme() {
    dark = !dark;
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }

  async function logout() {
    await supabase.auth.signOut();
    await invalidateAll();
    await goto('/login');
  }

  onMount(() => {
    const storedTheme = localStorage.getItem('theme');
    dark = storedTheme ? storedTheme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', dark);

    try {
      mailNotes = JSON.parse(localStorage.getItem('av-mail-notes') ?? '{}') as Record<string, string>;
    } catch {
      mailNotes = {};
    }
  });

  onDestroy(() => {
    if (toastTimer) clearTimeout(toastTimer);
  });
</script>

<svelte:head>
  <title>Quick Mail | OtpNest</title>
  <meta name="description" content="Create a private temporary mail and copy only the received OTP code." />
</svelte:head>

<main class="quick-shell">
  <section class="quick-card" aria-labelledby="quick-title">
    <header class="quick-header">
      <div>
        <p class="kicker">Quick mail</p>
        <h1 id="quick-title">Create mail. Fetch code.</h1>
      </div>
    </header>

    <form class="quick-section" onsubmit={(event) => { event.preventDefault(); createCustom(); }}>
      <label class="field-label" for="custom-local">Custom mail</label>
      <div class="quick-domain-input">
        <input
          id="custom-local"
          value={customLocalPart}
          oninput={(event) => (customLocalPart = cleanLocalPart(event.currentTarget.value))}
          onpaste={(event) => {
            event.preventDefault();
            customLocalPart = cleanLocalPart(event.clipboardData?.getData('text') ?? '');
          }}
          placeholder="enter name here"
          maxlength="32"
          autocomplete="off"
          autocapitalize="off"
        />
        <span>@{data.domain}</span>
      </div>
      <button class="btn btn-primary w-full" disabled={creating}>{creating ? 'Creating...' : 'Create Mail'}</button>
      <div class="quick-or">or</div>
      <button class="btn btn-secondary w-full" type="button" onclick={createRandom} disabled={creating}>
        Generate Random
      </button>
    </form>

    <section class="quick-section" aria-label="Current mail">
      <p class="field-label">Your mail</p>
      {#if selectedInbox}
        <div class="current-mail">
          <strong>{selectedInbox.emailAddress}</strong>
          <button class="icon-button has-tooltip" onclick={() => copyText(selectedInbox.emailAddress, 'Mail copied')} aria-label="Copy mail" data-tooltip="Copy mail" title="Copy mail">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          </button>
        </div>
      {:else}
        <p class="muted text-sm">Create or select a mail first.</p>
      {/if}
      <div class="quick-actions">
        <button class="btn btn-primary" onclick={fetchCode} disabled={!selectedInbox || checking}>
          {checking ? 'Fetching...' : 'Fetch Code'}
        </button>
        <button class="btn btn-secondary" onclick={() => refreshMessages()} disabled={!selectedInbox || refreshing}>
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
    </section>

    <section class="otp-card" aria-label="Latest code">
      <p class="field-label">Latest Code</p>
      <div class="quick-jackpot-shell mt-3">
        <JackpotOtp code={latestCode} spinning={checking || refreshing} length={6} />
        {#if latestCode}
          <button class="icon-button otp-copy quick-jackpot-copy has-tooltip" onclick={() => copyText(latestCode ?? '', 'OTP copied')} aria-label="Copy OTP code" data-tooltip="Copy OTP" title="Copy OTP">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          </button>
        {/if}
      </div>
      {#if !latestCode}
        <p class="empty-code">No code yet. Click Fetch Code after requesting the OTP.</p>
      {/if}

      {#if latestMessage}
        <div class="message-meta">
          <p>From: {latestMessage.from ?? 'Unknown'}</p>
          <p>Subject: {latestMessage.subject ?? 'No subject'}</p>
          <p>Received: {formatDateTime(latestMessage.receivedAt)}</p>
        </div>
      {/if}
    </section>

    <section class="quick-section" aria-labelledby="recent-title">
      <h2 id="recent-title">Recent mails</h2>
      {#if inboxes.length === 0}
        <p class="muted text-sm">No mails yet.</p>
      {:else}
        <div class="recent-list">
          {#each inboxes as inbox}
            <article class="recent-row" class:selected-row={selectedInbox?.id === inbox.id}>
              <div class="recent-main">
                <strong>{inbox.emailAddress}</strong>
                <span>Created {formatDate(inbox.createdAt)}</span>
                <input
                  class="note-input"
                  value={mailNotes[inbox.id] ?? ''}
                  placeholder="Add number or notes"
                  maxlength="120"
                  aria-label={`Add number or notes for ${inbox.emailAddress}`}
                  oninput={(event) => saveNote(inbox.id, event.currentTarget.value)}
                />
              </div>
              <div class="row-actions">
                <button class="icon-button has-tooltip" onclick={() => selectInbox(inbox)} aria-label={`Select ${inbox.emailAddress}`} data-tooltip="Select mail" title="Select">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m20 6-11 11-5-5"></path></svg>
                </button>
                <button class="icon-button has-tooltip" onclick={() => copyText(inbox.emailAddress, 'Mail copied')} aria-label={`Copy ${inbox.emailAddress}`} data-tooltip="Copy mail" title="Copy">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                </button>
                <button class="icon-button danger-icon has-tooltip" onclick={() => (deleteTarget = inbox)} aria-label={`Delete ${inbox.emailAddress}`} data-tooltip="Delete mail" title="Delete">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M6 6l1 14h10l1-14"></path><path d="M10 11v5"></path><path d="M14 11v5"></path></svg>
                </button>
              </div>
            </article>
          {/each}
        </div>
      {/if}
    </section>

    <p class="terms-note">Use only for accounts and domains you own. Abuse is not allowed.</p>
  </section>

  {#if toast}
    <div class="quick-toast quick-toast-{toast.tone}" role={toast.tone === 'error' ? 'alert' : 'status'}>{toast.message}</div>
  {/if}

  {#if deleteTarget}
    <div class="modal-backdrop" role="presentation">
      <div class="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title">
        <h2 id="delete-title" class="text-2xl font-black">Delete this mail?</h2>
        <p class="muted mt-2 truncate text-sm">{deleteTarget.emailAddress}</p>
        <div class="mt-5 grid gap-2 sm:grid-cols-2">
          <button class="btn btn-secondary" onclick={() => (deleteTarget = null)}>Cancel</button>
          <button class="btn btn-danger" onclick={() => deleteTarget && deleteInbox(deleteTarget)}>Delete</button>
        </div>
      </div>
    </div>
  {/if}
</main>

<style>
  .quick-shell {
    min-height: 100vh;
    display: grid;
    place-items: start center;
    padding: 1rem;
  }

  .quick-card {
    width: min(100%, 42rem);
    margin-top: 1rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: color-mix(in srgb, var(--surface) 96%, transparent);
    box-shadow: var(--shadow-tight);
    padding: 1rem;
  }

  .quick-header {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .header-actions {
    display: flex;
    flex: 0 0 auto;
    gap: 0.45rem;
  }

  .quick-header h1 {
    margin: 0.25rem 0 0;
    font-size: clamp(1.8rem, 7vw, 3rem);
    line-height: 1;
    font-weight: 900;
  }

  .quick-section,
  .otp-card {
    border-top: 1px solid var(--border);
    padding-top: 1rem;
    margin-top: 1rem;
  }

  .field-label,
  .quick-section h2 {
    display: block;
    margin: 0 0 0.5rem;
    font-size: 0.84rem;
    font-weight: 900;
  }

  .quick-domain-input,
  .current-mail {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface-soft);
    padding: 0.55rem 0.7rem;
    margin-bottom: 0.75rem;
  }

  .quick-domain-input input {
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text);
  }

  .quick-domain-input span,
  .recent-main span,
  .message-meta,
  .terms-note {
    color: var(--muted);
    font-size: 0.82rem;
  }

  .quick-or {
    margin: 0.75rem 0;
    color: var(--muted);
    text-align: center;
    font-size: 0.8rem;
    font-weight: 800;
  }

  .quick-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  .icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 2.25rem;
    min-height: 2.25rem;
    border: 1px solid var(--border);
    border-radius: 0.45rem;
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
  }

  .icon-button svg {
    width: 1rem;
    height: 1rem;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 2;
  }

  .otp-card {
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface-soft);
    padding: 1rem;
  }

  .quick-jackpot-shell {
    position: relative;
  }

  .quick-jackpot-copy {
    position: absolute;
    right: clamp(0.75rem, 2vw, 1.25rem);
    bottom: clamp(0.75rem, 2vw, 1.25rem);
    z-index: 3;
    background: color-mix(in srgb, var(--surface) 88%, transparent);
    border-color: color-mix(in srgb, var(--accent) 42%, var(--border));
    box-shadow: 0 12px 34px color-mix(in srgb, var(--bg) 36%, transparent);
  }

  .otp-copy {
    width: 3rem;
    height: 3rem;
    color: var(--accent);
  }

  .empty-code {
    margin: 1rem 0 0;
    color: var(--muted);
    font-weight: 700;
  }

  .message-meta {
    margin-top: 0.75rem;
    display: grid;
    gap: 0.15rem;
  }

  .message-meta p {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .recent-list {
    display: grid;
    gap: 0.5rem;
    max-height: 13rem;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding-right: 0.2rem;
    scrollbar-width: thin;
  }

  .recent-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.75rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    padding: 0.7rem;
    background: var(--surface);
    min-height: 6rem;
  }

  .selected-row {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  }

  .recent-main {
    min-width: 0;
    display: grid;
    gap: 0.25rem;
  }

  .recent-main strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .note-input {
    width: 100%;
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    background: var(--surface-soft);
    color: var(--text);
    padding: 0.35rem 0.45rem;
    font-size: 0.82rem;
    outline: 0;
  }

  .note-input:focus {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  }

  .row-actions {
    display: flex;
    flex: 0 0 auto;
    gap: 0.35rem;
    opacity: 0;
    transition: opacity 140ms ease;
  }

  .recent-row:hover .row-actions,
  .recent-row:focus-within .row-actions {
    opacity: 1;
  }

  .danger-icon {
    color: var(--danger);
  }

  .terms-note {
    margin: 1rem 0 0;
  }

  .quick-toast {
    position: fixed;
    right: 1rem;
    bottom: 1rem;
    z-index: 50;
    max-width: min(24rem, calc(100vw - 2rem));
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface);
    padding: 0.75rem 1rem;
    box-shadow: var(--shadow-tight);
    font-weight: 800;
  }

  .quick-toast-error {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger-soft) 80%, var(--surface));
  }

  .quick-toast-info {
    color: var(--accent);
  }

  @media (hover: none) {
    .row-actions {
      opacity: 1;
    }
  }

  @media (max-width: 560px) {
    .quick-shell {
      padding: 0.75rem;
    }

    .quick-card {
      margin-top: 0;
      padding: 0.85rem;
    }

    .quick-domain-input {
      grid-template-columns: minmax(0, 1fr);
      gap: 0.25rem;
    }

    .recent-list {
      max-height: 12.5rem;
      padding-right: 0;
    }

    .recent-row {
      grid-template-columns: minmax(0, 1fr);
      gap: 0.5rem;
      min-height: 6rem;
    }

    .row-actions {
      justify-content: flex-end;
      opacity: 1;
    }

    .row-actions .icon-button {
      min-width: 2rem;
      min-height: 2rem;
    }
  }
</style>
