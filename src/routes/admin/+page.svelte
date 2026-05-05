<script lang="ts">
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  type AuditLog = {
    id: string;
    user_id: string | null;
    action: string;
    created_at: string;
  };

  type AdminStats = {
    totalUsers: number;
    activeInboxCount: number;
    expiredInboxCount: number;
    receivedEmailCount: number;
    processedEmailCount: number;
    recentLogs: AuditLog[];
  };

  type ProfileAccess = {
    id: string;
    email: string;
    role: string | null;
    dashboard_access: boolean | null;
    is_blocked: boolean | null;
    created_at: string;
    activity?: {
      mailCreatedCount: number;
      receivedCount: number;
      otpCount: number;
    };
  };

  type AdminInbox = {
    id: string;
    userId: string;
    ownerEmail: string | null;
    ownerRole: string | null;
    emailAddress: string;
    status: string | null;
    createdAt: string;
    stats: {
      receivedCount: number;
      otpCount: number;
      lastReceivedAt: string | null;
      lastOtpAt: string | null;
    };
    latestMessage: {
      id: string;
      from: string | null;
      subject: string | null;
      preview: string | null;
      code: string | null;
      receivedAt: string;
    } | null;
  };

  type UserDetail = {
    profile: ProfileAccess & {
      full_name: string | null;
      avatar_url: string | null;
    };
    authUser: {
      id: string;
      email: string | null;
      createdAt: string;
      updatedAt: string | null;
      lastSignInAt: string | null;
      emailConfirmedAt: string | null;
      bannedUntil: string | null;
    } | null;
    inboxes: Array<{
      id: string;
      email_address: string;
      local_part: string;
      canonical_local_part: string | null;
      status: string | null;
      created_at: string;
      expires_at: string | null;
      ip_address: string | null;
      user_agent: string | null;
    }>;
    stats: {
      mailCreatedCount: number;
      inboxesWithOtpCount: number;
      receivedCount: number;
      otpCount: number;
      byInbox: Record<string, {
        emailAddress: string;
        receivedCount: number;
        otpCount: number;
        lastReceivedAt: string | null;
        lastOtpAt: string | null;
      }>;
    };
    recentEmails: Array<{
      id: string;
      inbox_id: string;
      recipient_email: string;
      sender_email: string | null;
      subject: string | null;
      body_preview: string | null;
      detected_code: string | null;
      message_id: string | null;
      received_at: string | null;
      created_at: string;
    }>;
  };

  let stats = $state<AdminStats | null>(null);
  let profiles = $state<ProfileAccess[]>([]);
  let adminInboxes = $state<AdminInbox[]>([]);
  let selectedUser = $state<UserDetail | null>(null);
  let errorMessage = $state('');
  let accessMessage = $state('');
  let accessError = $state('');
  let mailError = $state('');
  let userError = $state('');
  let loading = $state(false);
  let accessLoading = $state(false);
  let mailLoading = $state(false);
  let userLoading = $state(false);
  let grantEmail = $state('');
  let grantLevel = $state<'dashboard' | 'admin'>('dashboard');
  let dark = $state(false);
  const isMainAdmin = $derived(data.role === 'main_admin');
  const adminView = $derived(
    page.url.pathname.endsWith('/users')
      ? 'users'
      : page.url.pathname.endsWith('/inboxes')
        ? 'inboxes'
        : page.url.pathname.endsWith('/system')
          ? 'system'
          : 'overview'
  );
  const showUsersView = $derived(adminView === 'overview' || adminView === 'users');
  const showInboxesView = $derived(adminView === 'overview' || adminView === 'inboxes');
  const showSystemView = $derived(adminView === 'overview' || adminView === 'system');

  function toggleTheme() {
    dark = !dark;
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }

  onMount(() => {
    const storedTheme = localStorage.getItem('theme');
    dark = storedTheme ? storedTheme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', dark);
  });

  async function loadStats() {
    loading = true;
    errorMessage = '';
    const response = await fetch('/api/admin/stats');
    loading = false;

    if (!response.ok) {
      errorMessage = await response.text();
      return;
    }

    stats = (await response.json()) as AdminStats;
  }

  async function loadProfiles() {
    if (!isMainAdmin) return;
    const response = await fetch('/api/admin/access');

    if (!response.ok) {
      accessError = await response.text();
      return;
    }

    const payload = (await response.json()) as { profiles: ProfileAccess[] };
    profiles = payload.profiles;
  }

  async function loadAdminInboxes() {
    if (!isMainAdmin) return;
    mailLoading = true;
    mailError = '';
    const response = await fetch('/api/admin/inboxes');
    mailLoading = false;

    if (!response.ok) {
      mailError = await response.text();
      return;
    }

    const payload = (await response.json()) as { inboxes: AdminInbox[] };
    adminInboxes = payload.inboxes;
  }

  async function grantAccess() {
    accessLoading = true;
    accessMessage = '';
    accessError = '';

    const response = await fetch('/api/admin/access', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: grantEmail, access: grantLevel })
    });

    accessLoading = false;

    if (!response.ok) {
      accessError = await response.text();
      return;
    }

    const payload = (await response.json()) as { profile: ProfileAccess };
    accessMessage =
      grantLevel === 'admin'
        ? `${payload.profile.email} can now use /admin and /dashboard.`
        : `${payload.profile.email} can now use /dashboard.`;
    grantEmail = '';
    await loadProfiles();
  }

  async function openUser(userId: string) {
    userLoading = true;
    userError = '';
    const response = await fetch(`/api/admin/users/${userId}`);
    userLoading = false;

    if (!response.ok) {
      userError = await response.text();
      return;
    }

    selectedUser = (await response.json()) as UserDetail;
  }

  async function runUserAction(action: string) {
    if (!selectedUser) return;
    const labels: Record<string, string> = {
      grant_admin: 'grant admin access to',
      grant_dashboard: 'grant dashboard access to',
      remove_access: 'remove access from',
      block: 'block',
      unblock: 'unblock',
      delete: 'delete'
    };
    if (!confirm(`Are you sure you want to ${labels[action] ?? action} ${selectedUser.profile.email}?`)) {
      return;
    }

    userLoading = true;
    userError = '';
    const response = await fetch(`/api/admin/users/${selectedUser.profile.id}/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action })
    });
    userLoading = false;

    if (!response.ok) {
      userError = await response.text();
      return;
    }

    if (action === 'delete') {
      selectedUser = null;
    } else {
      await openUser(selectedUser.profile.id);
    }
    await Promise.all([loadProfiles(), loadAdminInboxes(), loadStats()]);
  }

  async function refreshAll() {
    await Promise.all([loadStats(), loadProfiles(), loadAdminInboxes()]);
  }

  $effect(() => {
    loadStats();
    if (isMainAdmin) {
      loadProfiles();
      loadAdminInboxes();
    }
  });
</script>

<svelte:head>
  <title>Admin | OtpNest</title>
  <meta name="description" content="OtpNest admin dashboard for system counts and audit logs." />
</svelte:head>

<main class="app-shell space-y-4">
  <header class="topbar">
    <div>
      <a href="/dashboard" class="flex items-center gap-2 font-black"><span aria-hidden="true">⚡</span><span>OtpNest</span></a>
      <p class="mt-1 text-sm muted">Admin: {data.email}</p>
      <p class="mt-1 text-xs muted">Role: {data.role === 'main_admin' ? 'Main admin' : 'Admin'}</p>
    </div>
    <div class="flex gap-2">
      <button class="btn btn-secondary" onclick={toggleTheme}>{dark ? 'Day' : 'Night'}</button>
      <a class="btn btn-secondary" href="/quick">Quick</a>
      <a class="btn btn-secondary" href="/dashboard">Dashboard</a>
      <a class="btn btn-secondary" href="/admin/users">Users</a>
      <a class="btn btn-secondary" href="/admin/inboxes">Inboxes</a>
      <a class="btn btn-secondary" href="/admin/system">System</a>
      <button class="btn btn-primary" onclick={refreshAll} disabled={loading || mailLoading}>{loading || mailLoading ? 'Refreshing...' : 'Refresh'}</button>
    </div>
  </header>

  {#if errorMessage}
    <p class="rounded-md border px-4 py-3 text-sm" style="border-color: color-mix(in srgb, var(--danger) 28%, transparent); background: var(--danger-soft); color: var(--danger);">{errorMessage}</p>
  {/if}

  {#if isMainAdmin && showUsersView}
  <section class="panel p-4 sm:p-5" aria-labelledby="access-title">
    <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p class="kicker">Access</p>
        <h1 id="access-title" class="mt-1 text-2xl font-black">Grant admin access</h1>
        <p class="mt-2 text-sm muted">Only main admins can grant access. Main-admin promotion stays database-only.</p>
      </div>
      <form class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]" onsubmit={(event) => { event.preventDefault(); grantAccess(); }}>
        <input
          class="input"
          type="email"
          bind:value={grantEmail}
          placeholder="user@example.com"
          aria-label="User email"
          autocomplete="off"
          required
        />
        <select class="input" bind:value={grantLevel} aria-label="Access level">
          <option value="dashboard">Dashboard</option>
          <option value="admin">Admin</option>
        </select>
        <button class="btn btn-primary" type="submit" disabled={accessLoading}>
          {accessLoading ? 'Granting...' : 'Grant'}
        </button>
      </form>
    </div>

    {#if accessMessage}
      <p class="mt-3 rounded-md border px-4 py-3 text-sm" style="border-color: color-mix(in srgb, var(--success) 28%, transparent); background: color-mix(in srgb, var(--success) 12%, transparent); color: var(--success);">{accessMessage}</p>
    {/if}

    {#if accessError}
      <p class="mt-3 rounded-md border px-4 py-3 text-sm" style="border-color: color-mix(in srgb, var(--danger) 28%, transparent); background: var(--danger-soft); color: var(--danger);">{accessError}</p>
    {/if}

    <div class="mt-4 overflow-hidden rounded-lg border" style="border-color: var(--border);">
      {#each profiles as profile}
        <button class="grid w-full gap-2 border-b p-3 text-left text-sm last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto_auto]" style="border-color: var(--border);" onclick={() => openUser(profile.id)}>
          <span class="min-w-0">
            <span class="block truncate font-semibold">{profile.email}</span>
            <span class="mt-1 block text-xs muted">
              Mails {profile.activity?.mailCreatedCount ?? 0} · Received {profile.activity?.receivedCount ?? 0} · OTPs {profile.activity?.otpCount ?? 0}
            </span>
          </span>
          <span class="badge">Mails {profile.activity?.mailCreatedCount ?? 0}</span>
          <span class="badge">{profile.dashboard_access ? 'Dashboard' : 'Quick only'}</span>
          <span class="badge" class:danger-text={profile.is_blocked}>{profile.is_blocked ? 'Blocked' : 'Active'}</span>
          <span class="badge">{profile.role ?? 'user'}</span>
          <span class="font-semibold" style="color: var(--accent);">View profile</span>
        </button>
      {:else}
        <p class="p-3 text-sm muted">No users found.</p>
      {/each}
    </div>
  </section>
  {:else if !isMainAdmin && showUsersView}
    <section class="panel p-4 sm:p-5">
      <p class="kicker">Access</p>
      <h1 class="mt-1 text-2xl font-black">Admin access</h1>
      <p class="mt-2 text-sm muted">You can use the admin dashboard. Only the database-defined main admin can grant admins or view all verification codes.</p>
    </section>
  {/if}

  {#if isMainAdmin && showUsersView}
    <section class="panel p-4 sm:p-5" aria-labelledby="user-title">
      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="kicker">Users</p>
          <h1 id="user-title" class="mt-1 text-2xl font-black">Selected user data</h1>
        </div>
        {#if userLoading}<span class="badge">Loading</span>{/if}
      </div>

      {#if userError}
        <p class="mt-3 rounded-md border px-4 py-3 text-sm" style="border-color: color-mix(in srgb, var(--danger) 28%, transparent); background: var(--danger-soft); color: var(--danger);">{userError}</p>
      {/if}

      {#if selectedUser}
        <div class="mt-4 grid gap-3 lg:grid-cols-[1fr_1.2fr]">
          <div class="panel-muted p-4">
            <h2 class="text-lg font-black">{selectedUser.profile.email}</h2>
            <p class="mt-2 text-sm muted">ID: {selectedUser.profile.id}</p>
            <p class="mt-2 text-sm muted">Role: {selectedUser.profile.role ?? 'user'}</p>
            <p class="mt-2 text-sm muted">Dashboard: {selectedUser.profile.dashboard_access ? 'yes' : 'no'}</p>
            <p class="mt-2 text-sm muted">
              <span class:danger-text={selectedUser.profile.is_blocked}>Blocked: {selectedUser.profile.is_blocked ? 'yes' : 'no'}</span>
            </p>
            <p class="mt-2 text-sm muted">Created: {new Date(selectedUser.profile.created_at).toLocaleString()}</p>
            <div class="mt-4 grid grid-cols-2 gap-2 text-sm">
              <div class="rounded-md border p-3" style="border-color: var(--border);">
                <p class="muted">Mails created</p>
                <p class="text-2xl font-black">{selectedUser.stats.mailCreatedCount}</p>
              </div>
              <div class="rounded-md border p-3" style="border-color: var(--border);">
                <p class="muted">Mails with OTP</p>
                <p class="text-2xl font-black">{selectedUser.stats.inboxesWithOtpCount}</p>
              </div>
              <div class="rounded-md border p-3" style="border-color: var(--border);">
                <p class="muted">Total received</p>
                <p class="text-2xl font-black">{selectedUser.stats.receivedCount}</p>
              </div>
              <div class="rounded-md border p-3" style="border-color: var(--border);">
                <p class="muted">Total OTPs</p>
                <p class="text-2xl font-black">{selectedUser.stats.otpCount}</p>
              </div>
            </div>
            {#if selectedUser.stats.mailCreatedCount === 0}
              <p class="mt-3 rounded-md border px-3 py-2 text-sm muted" style="border-color: var(--border);">
                This user has not created any temp mails yet. Select a user with a non-zero mail count to view their created mails, received count, and OTP stats.
              </p>
            {/if}
            {#if selectedUser.authUser}
              <p class="mt-2 text-sm muted">Last sign-in: {selectedUser.authUser.lastSignInAt ? new Date(selectedUser.authUser.lastSignInAt).toLocaleString() : 'never'}</p>
              <p class="mt-2 text-sm muted">Email confirmed: {selectedUser.authUser.emailConfirmedAt ? 'yes' : 'no'}</p>
            {/if}
            <div class="mt-4 flex flex-wrap gap-2">
              <button class="btn btn-secondary" onclick={() => runUserAction('grant_dashboard')}>Dashboard</button>
              <button class="btn btn-secondary" onclick={() => runUserAction('grant_admin')}>Admin</button>
              <button class="btn btn-danger" onclick={() => runUserAction('remove_access')}>Remove access</button>
              <button class={selectedUser.profile.is_blocked ? 'btn btn-secondary' : 'btn btn-danger'} onclick={() => runUserAction(selectedUser?.profile.is_blocked ? 'unblock' : 'block')}>
                {selectedUser.profile.is_blocked ? 'Unblock' : 'Block'}
              </button>
              <button class="btn btn-danger" onclick={() => runUserAction('delete')}>Delete</button>
            </div>
          </div>
          <div class="panel-muted p-4">
            <h2 class="text-lg font-black">Detailed profile data</h2>
            <dl class="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div class="rounded-md border p-3" style="border-color: var(--border);">
                <dt class="muted">Profile email</dt>
                <dd class="mt-1 break-words font-semibold">{selectedUser.profile.email}</dd>
              </div>
              <div class="rounded-md border p-3" style="border-color: var(--border);">
                <dt class="muted">Full name</dt>
                <dd class="mt-1 break-words font-semibold">{selectedUser.profile.full_name ?? 'Not set'}</dd>
              </div>
              <div class="rounded-md border p-3" style="border-color: var(--border);">
                <dt class="muted">User ID</dt>
                <dd class="mt-1 break-all font-semibold">{selectedUser.profile.id}</dd>
              </div>
              <div class="rounded-md border p-3" style="border-color: var(--border);">
                <dt class="muted">Auth email</dt>
                <dd class="mt-1 break-words font-semibold">{selectedUser.authUser?.email ?? 'Not available'}</dd>
              </div>
              <div class="rounded-md border p-3" style="border-color: var(--border);">
                <dt class="muted">Account created</dt>
                <dd class="mt-1 font-semibold">{selectedUser.authUser?.createdAt ? new Date(selectedUser.authUser.createdAt).toLocaleString() : new Date(selectedUser.profile.created_at).toLocaleString()}</dd>
              </div>
              <div class="rounded-md border p-3" style="border-color: var(--border);">
                <dt class="muted">Last sign-in</dt>
                <dd class="mt-1 font-semibold">{selectedUser.authUser?.lastSignInAt ? new Date(selectedUser.authUser.lastSignInAt).toLocaleString() : 'Never'}</dd>
              </div>
              <div class="rounded-md border p-3" style="border-color: var(--border);">
                <dt class="muted">Email confirmed</dt>
                <dd class="mt-1 font-semibold">{selectedUser.authUser?.emailConfirmedAt ? 'Yes' : 'No'}</dd>
              </div>
              <div class="rounded-md border p-3" style="border-color: var(--border);">
                <dt class="muted">Banned until</dt>
                <dd class="mt-1 font-semibold">{selectedUser.authUser?.bannedUntil ? new Date(selectedUser.authUser.bannedUntil).toLocaleString() : 'Not banned'}</dd>
              </div>
            </dl>
          </div>
        </div>

        <div class="mt-4 grid gap-4 lg:grid-cols-2">
          <section>
            <h2 class="text-lg font-black">Created mails</h2>
            <div class="mt-3 max-h-80 overflow-auto rounded-lg border" style="border-color: var(--border);">
              {#each selectedUser.inboxes as inbox}
                <article class="border-b p-3 text-sm last:border-b-0" style="border-color: var(--border);">
                  <p class="font-black">{inbox.email_address}</p>
                  <p class="mt-1 muted">{inbox.status ?? 'unknown'} · {new Date(inbox.created_at).toLocaleString()}</p>
                  <p class="mt-1 muted">IP: {inbox.ip_address ?? 'unknown'}</p>
                  {#if selectedUser.stats.byInbox[inbox.id]}
                    <p class="mt-1 muted">Used {selectedUser.stats.byInbox[inbox.id].receivedCount} times · OTP {selectedUser.stats.byInbox[inbox.id].otpCount} times</p>
                  {/if}
                </article>
              {:else}
                <p class="p-3 text-sm muted">No mails created.</p>
              {/each}
            </div>
          </section>
          <section>
            <h2 class="text-lg font-black">Recent mail and codes</h2>
            <div class="mt-3 max-h-80 overflow-auto rounded-lg border" style="border-color: var(--border);">
              {#each selectedUser.recentEmails as mail}
                <article class="border-b p-3 text-sm last:border-b-0" style="border-color: var(--border);">
                  <p class="font-black">{mail.detected_code ?? 'No code'}</p>
                  <p class="mt-1 font-semibold">{mail.subject ?? 'No subject'}</p>
                  <p class="mt-1 muted">{mail.sender_email ?? 'unknown'} → {mail.recipient_email}</p>
                  <p class="mt-1 muted">{mail.received_at ? new Date(mail.received_at).toLocaleString() : new Date(mail.created_at).toLocaleString()}</p>
                  <p class="mt-2 muted">{mail.body_preview ?? 'No preview'}</p>
                </article>
              {:else}
                <p class="p-3 text-sm muted">No recent mail content. OTP text is scrubbed after 20 minutes, but counts stay available.</p>
              {/each}
            </div>
          </section>
        </div>
      {:else}
        <p class="mt-3 rounded-lg border p-3 text-sm muted" style="border-color: var(--border);">Click a user in the access list to view complete profile, inbox, and mail data.</p>
      {/if}
    </section>
  {/if}

  {#if isMainAdmin && showInboxesView}
    <section class="panel p-4 sm:p-5" aria-labelledby="mail-title">
      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="kicker">Main admin</p>
          <h1 id="mail-title" class="mt-1 text-2xl font-black">All inboxes and latest codes</h1>
          <p class="mt-2 text-sm muted">Code access is limited to main admin. Raw bodies, headers, and attachments are not exposed here.</p>
        </div>
        {#if mailLoading}<span class="badge">Loading</span>{/if}
      </div>

      {#if mailError}
        <p class="mt-3 rounded-md border px-4 py-3 text-sm" style="border-color: color-mix(in srgb, var(--danger) 28%, transparent); background: var(--danger-soft); color: var(--danger);">{mailError}</p>
      {/if}

      <div class="mt-4 max-h-[28rem] overflow-auto rounded-lg border" style="border-color: var(--border);">
        {#each adminInboxes as inbox}
          <article class="grid gap-3 border-b p-3 text-sm last:border-b-0 lg:grid-cols-[1.1fr_1fr_1.4fr_auto]" style="border-color: var(--border);">
            <div>
              <p class="font-black">{inbox.emailAddress}</p>
              <p class="mt-1 muted">{new Date(inbox.createdAt).toLocaleString()}</p>
            </div>
            <div>
              <p class="font-semibold">{inbox.ownerEmail ?? inbox.userId}</p>
              <p class="mt-1 muted">{inbox.ownerRole ?? 'user'} · {inbox.status ?? 'unknown'}</p>
              <p class="mt-1 muted">Used {inbox.stats.receivedCount} times · OTP {inbox.stats.otpCount} times</p>
            </div>
            <div>
              {#if inbox.latestMessage}
                <p class="truncate font-semibold">{inbox.latestMessage.subject ?? 'No subject'}</p>
                <p class="mt-1 truncate muted">{inbox.latestMessage.from ?? 'Unknown sender'}</p>
                <p class="mt-1 truncate muted">{inbox.latestMessage.preview ?? 'No preview'}</p>
              {:else}
                <p class="muted">No received mail yet.</p>
              {/if}
            </div>
            <div class="text-left lg:text-right">
              {#if inbox.latestMessage?.code}
                <p class="text-3xl font-black tracking-wide">{inbox.latestMessage.code}</p>
                <p class="mt-1 muted">{new Date(inbox.latestMessage.receivedAt).toLocaleString()}</p>
              {:else}
                <span class="badge">No code</span>
              {/if}
            </div>
          </article>
        {:else}
          <p class="p-3 text-sm muted">No inboxes found.</p>
        {/each}
      </div>
    </section>
  {/if}

  {#if showSystemView}
  <section class="panel p-4 sm:p-5" aria-labelledby="system-title">
    <div class="flex items-center justify-between gap-3">
      <div>
        <p class="kicker">Operations</p>
        <h1 id="system-title" class="mt-1 text-[clamp(1.8rem,4vw,3rem)] font-black leading-none">System status</h1>
      </div>
      {#if loading}<span class="badge">Loading</span>{/if}
    </div>

    {#if stats}
      <div class="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div class="panel-muted p-4"><p class="text-sm muted">Users</p><p class="mt-2 text-3xl font-black">{stats.totalUsers}</p></div>
        <div class="panel-muted p-4"><p class="text-sm muted">Active</p><p class="mt-2 text-3xl font-black">{stats.activeInboxCount}</p></div>
        <div class="panel-muted p-4"><p class="text-sm muted">Expired</p><p class="mt-2 text-3xl font-black">{stats.expiredInboxCount}</p></div>
        <div class="panel-muted p-4"><p class="text-sm muted">Emails</p><p class="mt-2 text-3xl font-black">{stats.receivedEmailCount}</p></div>
        <div class="panel-muted p-4"><p class="text-sm muted">Processed</p><p class="mt-2 text-3xl font-black">{stats.processedEmailCount}</p></div>
      </div>

      <section class="mt-8" aria-labelledby="audit-title">
        <h2 id="audit-title" class="text-lg font-black">Recent audit logs</h2>
        <div class="mt-3 overflow-hidden rounded-lg border" style="border-color: var(--border);">
          {#each stats.recentLogs as log}
            <article class="grid gap-2 border-b p-3 text-sm last:border-b-0 sm:grid-cols-[1fr_1fr_1.3fr]" style="border-color: var(--border);">
              <span class="font-semibold">{log.action}</span>
              <span class="truncate muted">{log.user_id || 'system'}</span>
              <time class="muted" datetime={log.created_at}>{new Date(log.created_at).toLocaleString()}</time>
            </article>
          {/each}
        </div>
      </section>
    {:else}
      <div class="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {#each Array(5) as _}
          <div class="skeleton-card">
            <div class="skeleton skeleton-line w-1/2"></div>
            <div class="skeleton skeleton-line mt-4 h-8 w-2/3"></div>
          </div>
        {/each}
      </div>
    {/if}
  </section>
  {/if}
</main>
