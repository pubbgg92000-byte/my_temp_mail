<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { supabase } from '$lib/supabase/client';
  import { onMount } from 'svelte';

  let email = $state('');
  let password = $state('');
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

  async function login() {
    errorMessage = '';
    loading = true;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    loading = false;

    if (error) {
      errorMessage = error.message;
      return;
    }

    const redirectTo = $page.url.searchParams.get('redirectTo');
    if (redirectTo) {
      await goto(redirectTo);
      return;
    }

    const landing = await fetch('/api/auth/landing');
    const payload = landing.ok ? await landing.json() : { path: '/quick' };
    await goto(payload.path || '/quick');
  }
</script>

<svelte:head>
  <title>Log in | OtpNest</title>
  <meta name="description" content="Log in to OtpNest to manage private temporary inboxes and verification codes." />
</svelte:head>

<main class="app-shell grid min-h-screen items-center md:max-w-96 lg:grid-cols-[1fr_440px]">
  <section class="hidden max-w-2xl lg:block">
    <a href="/" class="flex items-center gap-3 font-black">
      <span aria-hidden="true">⚡</span>
      <span>OtpNest</span>
    </a>
    <p class="kicker mt-12">Secure workspace</p>
    <h1 class="mt-4 text-[clamp(2.6rem,6vw,5.2rem)] font-black leading-none">Codes stay tied to the inbox you created.</h1>
    <p class="mt-5 text-lg leading-8 muted">Use your account to isolate aliases, messages, and verification codes in one calm workspace.</p>
  </section>

  <section class="panel p-5 sm:p-6" aria-labelledby="login-title">
    <div class="mb-8 flex items-center justify-between">
      <a href="/" class="font-black lg:hidden">OtpNest</a>
      <button class="btn btn-secondary" onclick={toggleTheme}>{dark ? 'Day' : 'Night'}</button>
    </div>
    <p class="kicker">Welcome back</p>
    <h1 id="login-title" class="mt-2 text-3xl font-black">Log in</h1>
    <form class="mt-6 space-y-4" onsubmit={(event) => { event.preventDefault(); login(); }}>
      <label class="block text-sm font-semibold">
        Email
        <input class="input mt-2" bind:value={email} type="email" autocomplete="email" required />
      </label>
      <label class="block text-sm font-semibold">
        Password
        <input class="input mt-2" bind:value={password} type="password" autocomplete="current-password" required />
      </label>
      {#if errorMessage}
        <p class="rounded-md border px-3 py-2 text-sm" style="border-color: color-mix(in srgb, var(--danger) 28%, transparent); background: var(--danger-soft); color: var(--danger);">{errorMessage}</p>
      {/if}
      <button class="btn btn-primary w-full" disabled={loading}>{loading ? 'Logging in...' : 'Log in'}</button>
    </form>
    <p class="mt-5 text-sm muted">
      New here? <a class="font-semibold" style="color: var(--accent);" href="/signup">Create an account</a>
    </p>
  </section>
</main>
