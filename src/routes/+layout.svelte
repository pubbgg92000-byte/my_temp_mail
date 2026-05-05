<script lang="ts">
  import '../app.css';
  import Icon from '$lib/components/Icon.svelte';
  import { browser } from '$app/environment';
  import { goto, invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase/client';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

  type ThemeMode = 'light' | 'dark' | 'system';

  let dark = $state(false);
  let menuOpen = $state(false);
  let menuTab = $state<'pages' | 'theme' | 'more'>('pages');
  let menuWrapper = $state<HTMLDivElement | null>(null);
  let themeMode = $state<ThemeMode>('system');
  let palette = $state('default');
  let clientUser = $state<{ id: string; email?: string | null } | null>(null);
  let clientProfile = $state<{
    fullName: string | null;
    emoji: string;
    role: string;
    dashboardAccess: boolean;
    isBlocked: boolean;
  } | null>(null);

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

  const effectiveUser = $derived(data.user ?? clientUser);
  const effectiveProfile = $derived(data.profile ?? clientProfile);
  const role = $derived(effectiveProfile?.role ?? 'user');
  const roleLabel = $derived(role === 'main_admin' ? 'main admin' : role === 'admin' ? 'admin' : 'user');
  const canUseDashboard = $derived(effectiveProfile?.dashboardAccess || role === 'dashboard_user' || role === 'admin' || role === 'main_admin');
  const canUseAdmin = $derived(role === 'admin' || role === 'main_admin');
  const profileLabel = $derived(effectiveProfile?.fullName || effectiveUser?.email || 'Account');
  const showAppNav = $derived(
    Boolean(effectiveUser) &&
      page.url.pathname !== '/' &&
      page.url.pathname !== '/login' &&
      page.url.pathname !== '/signup'
  );

  function systemPrefersDark() {
    return browser && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function applyTheme(mode: ThemeMode) {
    themeMode = mode;
    dark = mode === 'dark' || (mode === 'system' && systemPrefersDark());
    if (!browser) return;
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('theme', mode);
  }

  function setPalette(nextPalette: string) {
    palette = nextPalette;
    if (!browser) return;
    document.documentElement.dataset.palette = nextPalette;
    localStorage.setItem('palette', nextPalette);
  }

  async function hydrateNavFromClientAuth() {
    if (data.user) return;
    const {
      data: { user }
    } = await supabase.auth.getUser();
    clientUser = user ? { id: user.id, email: user.email } : null;
    if (!user) {
      clientProfile = null;
      return;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name,emoji,role,dashboard_access,is_blocked')
      .eq('id', user.id)
      .single();

    clientProfile = profile
      ? {
          fullName: profile.full_name ?? null,
          emoji: profile.emoji ?? '⚡',
          role: profile.role ?? 'user',
          dashboardAccess: profile.dashboard_access === true,
          isBlocked: profile.is_blocked === true
        }
      : null;
  }

  onMount(() => {
    const storedTheme = (localStorage.getItem('theme') as ThemeMode | null) ?? 'system';
    applyTheme(storedTheme);
    setPalette(localStorage.getItem('palette') ?? 'default');
    hydrateNavFromClientAuth();

    const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const systemThemeListener = () => {
      if (themeMode === 'system') applyTheme('system');
    };
    systemThemeQuery.addEventListener('change', systemThemeListener);

    const { data: authSubscription } = supabase.auth.onAuthStateChange((_event, session) => {
      clientUser = session?.user ? { id: session.user.id, email: session.user.email } : null;
      if (!session?.user) clientProfile = null;
      else hydrateNavFromClientAuth();
    });

    return () => {
      systemThemeQuery.removeEventListener('change', systemThemeListener);
      authSubscription.subscription.unsubscribe();
    };
  });

  $effect(() => {
    if (!browser) return;
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  });

  async function logout() {
    await supabase.auth.signOut();
    await invalidateAll();
    await goto('/login');
  }

  function closeMenuOnOutsideClick(event: PointerEvent) {
    if (!menuOpen || !menuWrapper) return;
    const target = event.target;
    if (target instanceof Node && !menuWrapper.contains(target)) menuOpen = false;
  }
</script>

<svelte:document onpointerdown={closeMenuOnOutsideClick} />

{#if showAppNav}
  <nav class="global-app-nav" aria-label="App navigation">
    <div class="global-menu-slot relative" bind:this={menuWrapper}>
      <button
        class="menu-button global-menu-trigger"
        onclick={() => (menuOpen = !menuOpen)}
        aria-label="Menu"
        aria-expanded={menuOpen}
        title="Menu"
      >
        <Icon name="menu" size={18} />
        <span>Menu</span>
      </button>

      {#if menuOpen}
        <button class="menu-backdrop" type="button" aria-label="Close menu" onclick={() => (menuOpen = false)}></button>
        <nav class="menu-popover global-menu-popover" aria-label="Menu">
          <div class="menu-tabs" role="tablist" aria-label="Menu sections">
            <button class:menu-tab-active={menuTab === 'pages'} role="tab" aria-selected={menuTab === 'pages'} onclick={() => (menuTab = 'pages')}>Pages</button>
            <button class:menu-tab-active={menuTab === 'theme'} role="tab" aria-selected={menuTab === 'theme'} onclick={() => (menuTab = 'theme')}>Theme</button>
            <button class:menu-tab-active={menuTab === 'more'} role="tab" aria-selected={menuTab === 'more'} onclick={() => (menuTab = 'more')}>More</button>
          </div>

          <div class="menu-panel">
            {#if menuTab === 'pages'}
              <a class="menu-item" href="/quick" onclick={() => (menuOpen = false)}><span class="menu-icon"><Icon name="mail" /></span><span>Quick mail</span><span class="menu-chevron">›</span></a>
              {#if canUseDashboard}
                <a class="menu-item" href="/dashboard" onclick={() => (menuOpen = false)}><span class="menu-icon"><Icon name="home" /></span><span>Dashboard</span><span class="menu-chevron">›</span></a>
              {/if}
              {#if canUseAdmin}
                <a class="menu-item" href="/admin" onclick={() => (menuOpen = false)}><span class="menu-icon"><Icon name="shield" /></span><span>Admin</span><span class="menu-chevron">›</span></a>
                <a class="menu-item" href="/admin/users" onclick={() => (menuOpen = false)}><span class="menu-icon"><Icon name="user" /></span><span>Users</span><span class="menu-chevron">›</span></a>
                <a class="menu-item" href="/admin/inboxes" onclick={() => (menuOpen = false)}><span class="menu-icon"><Icon name="history" /></span><span>Inboxes</span><span class="menu-chevron">›</span></a>
                <a class="menu-item" href="/admin/system" onclick={() => (menuOpen = false)}><span class="menu-icon"><Icon name="settings" /></span><span>System status</span><span class="menu-chevron">›</span></a>
              {/if}
            {:else if menuTab === 'theme'}
              <div class="menu-group">
                <p>Mode</p>
                <div class="grid grid-cols-3 gap-2">
                  <button class="palette-option {themeMode === 'light' ? 'palette-option-active' : ''}" onclick={() => applyTheme('light')}><span class="menu-icon"><Icon name="sun" /></span><span>Light</span></button>
                  <button class="palette-option {themeMode === 'dark' ? 'palette-option-active' : ''}" onclick={() => applyTheme('dark')}><span class="menu-icon"><Icon name="moon" /></span><span>Dark</span></button>
                  <button class="palette-option {themeMode === 'system' ? 'palette-option-active' : ''}" onclick={() => applyTheme('system')}><span class="menu-icon"><Icon name="monitor" /></span><span>System</span></button>
                </div>
              </div>

              <div class="menu-group">
                <p>Palette</p>
                <div class="palette-scroll">
                  {#each palettes as option}
                    <button class="palette-option {palette === option.id ? 'palette-option-active' : ''}" onclick={() => setPalette(option.id)} aria-label={`Use ${option.label} palette`}>
                      <span class="palette-swatch" style={`background: ${option.swatch};`}></span>
                      <span class="min-w-0">
                        <span class="block truncate">{option.label}</span>
                        <span class="muted block text-xs">{option.tone}</span>
                      </span>
                    </button>
                  {/each}
                </div>
              </div>
            {:else}
              <div class="menu-item pointer-events-none">
                <span class="menu-icon">{effectiveProfile?.emoji ?? '⚡'}</span>
                <span class="min-w-0">
                  <span class="block truncate">{profileLabel}</span>
                  <span class="muted block truncate text-xs">{roleLabel}{effectiveUser?.email ? ` · ${effectiveUser.email}` : ''}</span>
                </span>
              </div>
              <a class="menu-item" href="/privacy" onclick={() => (menuOpen = false)}><span class="menu-icon"><Icon name="shield" /></span><span>Privacy</span></a>
              <a class="menu-item" href="/terms" onclick={() => (menuOpen = false)}><span class="menu-icon"><Icon name="file" /></span><span>Terms</span></a>
              <a class="menu-item" href="/support" onclick={() => (menuOpen = false)}><span class="menu-icon"><Icon name="message" /></span><span>Support</span></a>
              <a class="menu-item" href="/contact" onclick={() => (menuOpen = false)}><span class="menu-icon"><Icon name="send" /></span><span>Contact</span></a>
              <button class="menu-item danger-text w-full" onclick={logout}><span class="menu-icon"><Icon name="log-out" /></span><span>Logout</span></button>
            {/if}
          </div>
        </nav>
      {/if}
    </div>

    <div class="global-links" aria-label="Primary pages">
      <a href="/quick">Quick</a>
      {#if canUseDashboard}<a href="/dashboard">Dashboard</a>{/if}
      {#if canUseAdmin}
        <a href="/admin">Admin</a>
        <a href="/admin/users">Users</a>
        <a href="/admin/inboxes">Inboxes</a>
      {/if}
    </div>

    <a href="/dashboard" class="global-profile" title={effectiveUser?.email ?? 'Signed in'}>
      <span class="global-avatar" aria-hidden="true">{effectiveProfile?.emoji ?? '⚡'}</span>
      <span class="min-w-0 text-left">
        <span class="block truncate font-black">{profileLabel}</span>
        <span class="block truncate text-xs muted">{roleLabel}{effectiveUser?.email ? ` · ${effectiveUser.email}` : ''}</span>
      </span>
    </a>
  </nav>
{/if}

{@render children()}
