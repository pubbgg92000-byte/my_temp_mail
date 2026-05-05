<script lang="ts">
  import { goto } from '$app/navigation';
  import { supabase } from '$lib/supabase/client';
  import { onMount } from 'svelte';

  let email = $state('');
  let password = $state('');
  let confirmPassword = $state('');
  let errorMessage = $state('');
  let successMessage = $state('');
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

  async function signUp() {
    errorMessage = '';
    successMessage = '';

    if (password.length < 6) {
      errorMessage = 'Password must be at least 6 characters.';
      return;
    }

    if (password !== confirmPassword) {
      errorMessage = 'Passwords do not match.';
      return;
    }

    loading = true;
    const { error } = await supabase.auth.signUp({ email, password });
    loading = false;

    if (error) {
      errorMessage = error.message;
      return;
    }

    successMessage = 'Account created. Check your email if confirmation is enabled.';
    await goto('/dashboard');
  }
</script>

<svelte:head>
  <title>Sign up | OtpNest</title>
  <meta name="description" content="Create an OtpNest account to generate private temporary inboxes for verification codes." />
</svelte:head>

<main class="app-shell grid min-h-screen items-center lg:grid-cols-[1fr_460px]">
  <section class="hidden max-w-2xl lg:block">
    <a href="/" class="flex items-center gap-3 font-black">
      <span aria-hidden="true">⚡</span>
      <span>OtpNest</span>
    </a>
    <p class="kicker mt-12">Start clean</p>
    <h1 class="mt-4 text-[clamp(2.6rem,6vw,5.2rem)] font-black leading-none">Generate aliases with a calmer dashboard.</h1>
    <p class="mt-5 text-lg leading-8 muted">Create private inboxes, copy addresses quickly, and watch incoming codes from a responsive workspace.</p>
  </section>

  <section class="panel p-5 sm:p-6" aria-labelledby="signup-title">
    <div class="mb-8 flex items-center justify-between">
      <a href="/" class="font-black lg:hidden">OtpNest</a>
      <button class="btn btn-secondary" onclick={toggleTheme}>{dark ? 'Day' : 'Night'}</button>
    </div>
    <p class="kicker">New account</p>
    <h1 id="signup-title" class="mt-2 text-3xl font-black">Create your account</h1>
    <form class="mt-6 space-y-4" onsubmit={(event) => { event.preventDefault(); signUp(); }}>
      <label class="block text-sm font-semibold">
        Email
        <input class="input mt-2" bind:value={email} type="email" autocomplete="email" required />
      </label>
      <label class="block text-sm font-semibold">
        Password
        <input class="input mt-2" bind:value={password} type="password" autocomplete="new-password" required />
      </label>
      <label class="block text-sm font-semibold">
        Confirm password
        <input class="input mt-2" bind:value={confirmPassword} type="password" autocomplete="new-password" required />
      </label>
      {#if errorMessage}
        <p class="rounded-md border px-3 py-2 text-sm" style="border-color: color-mix(in srgb, var(--danger) 28%, transparent); background: var(--danger-soft); color: var(--danger);">{errorMessage}</p>
      {/if}
      {#if successMessage}
        <p class="rounded-md border px-3 py-2 text-sm" style="border-color: color-mix(in srgb, var(--success) 28%, transparent); background: var(--success-soft); color: var(--success);">{successMessage}</p>
      {/if}
      <button class="btn btn-primary w-full" disabled={loading}>{loading ? 'Creating...' : 'Sign up'}</button>
    </form>
    <p class="mt-5 text-sm muted">
      Already have an account? <a class="font-semibold" style="color: var(--accent);" href="/login">Log in</a>
    </p>
  </section>
</main>
