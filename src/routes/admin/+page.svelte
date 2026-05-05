<script lang="ts">
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

  let stats = $state<AdminStats | null>(null);
  let errorMessage = $state('');
  let loading = $state(false);
  let dark = $state(false);

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

  $effect(() => {
    loadStats();
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
    </div>
    <div class="flex gap-2">
      <button class="btn btn-secondary" onclick={toggleTheme}>{dark ? 'Day' : 'Night'}</button>
      <a class="btn btn-secondary" href="/dashboard">Dashboard</a>
      <button class="btn btn-primary" onclick={loadStats} disabled={loading}>{loading ? 'Refreshing...' : 'Refresh'}</button>
    </div>
  </header>

  {#if errorMessage}
    <p class="rounded-md border px-4 py-3 text-sm" style="border-color: color-mix(in srgb, var(--danger) 28%, transparent); background: var(--danger-soft); color: var(--danger);">{errorMessage}</p>
  {/if}

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
</main>
