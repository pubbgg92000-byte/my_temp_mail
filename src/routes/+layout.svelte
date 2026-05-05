<script lang="ts">
  import '../app.css';
  import { goto, invalidateAll } from '$app/navigation';
  import { browser } from '$app/environment';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase/client';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();
  let dark = $state(false);
  const role = $derived(data.profile?.role ?? 'user');
  const roleLabel = $derived(role === 'main_admin' ? 'main admin' : role === 'admin' ? 'admin' : 'user');
  const canUseDashboard = $derived(data.profile?.dashboardAccess || role === 'dashboard_user' || role === 'admin' || role === 'main_admin');
  const canUseAdmin = $derived(role === 'admin' || role === 'main_admin');
  const profileLabel = $derived(data.profile?.fullName || data.user?.email || 'Account');
  const showAppNav = $derived(
    Boolean(data.user) &&
      page.url.pathname !== '/login' &&
      page.url.pathname !== '/signup' &&
      page.url.pathname !== '/dashboard'
  );

  onMount(() => {
    const storedTheme = localStorage.getItem('theme');
    dark = storedTheme ? storedTheme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.dataset.palette = localStorage.getItem('palette') ?? 'teal';
  });

  function toggleTheme() {
    dark = !dark;
    if (browser) {
      document.documentElement.classList.toggle('dark', dark);
      localStorage.setItem('theme', dark ? 'dark' : 'light');
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    await invalidateAll();
    await goto('/login');
  }
</script>

{#if showAppNav}
  <nav class="global-app-nav" aria-label="App navigation">
    <a href="/quick" class="global-profile" title={data.user?.email ?? 'Signed in'}>
      <span class="global-avatar" aria-hidden="true">{data.profile?.emoji ?? '⚡'}</span>
      <span class="min-w-0">
        <span class="block truncate font-black">{profileLabel}</span>
        <span class="block truncate text-xs muted">{roleLabel}{data.user?.email ? ` · ${data.user.email}` : ''}</span>
      </span>
    </a>
    <div class="global-links">
      <a href="/quick">Quick</a>
      {#if canUseDashboard}<a href="/dashboard">Dashboard</a>{/if}
      {#if canUseAdmin}
        <a href="/admin">Admin</a>
        <a href="/admin/users">Users</a>
        <a href="/admin/inboxes">Inboxes</a>
        <a href="/admin/system">System</a>
      {/if}
    </div>
    <div class="global-actions">
      <button
        class="icon-btn has-tooltip"
        onclick={toggleTheme}
        aria-label="Toggle day and night mode"
        data-tooltip={dark ? 'Day mode' : 'Night mode'}
        title={dark ? 'Day mode' : 'Night mode'}>{dark ? '☀' : '☾'}</button>
      <button
        class="icon-btn danger-icon has-tooltip"
        onclick={logout}
        aria-label="Log out"
        data-tooltip="Log out"
        title="Log out">⇥</button>
    </div>
  </nav>
{/if}

{@render children()}
