<script lang="ts">
  import { onMount } from 'svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
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
</script>

<svelte:head>
  <title>OtpNest | Temporary inboxes for verification codes</title>
  <meta name="description" content="Create private temporary email inboxes and view verification codes securely with OtpNest." />
</svelte:head>

<main class="app-shell flex flex-col">
  <header class="topbar">
    <a href="/" class="flex items-center gap-3 font-black">
      <span aria-hidden="true">⚡</span>
      <span>OtpNest</span>
    </a>
    <nav class="flex items-center gap-2" aria-label="Public navigation">
      <button class="btn btn-secondary" onclick={toggleTheme}>{dark ? 'Day' : 'Night'}</button>
      {#if data.user}
        <a class="btn btn-primary" href="/quick">Quick mail</a>
      {:else}
        <a class="btn btn-secondary" href="/login">Log in</a>
        <a class="btn btn-primary" href="/signup">Sign up</a>
      {/if}
    </nav>
  </header>

  <section class="flex flex-1 items-center py-8 lg:py-14">
    <div class="min-w-0">
      <p class="kicker">Private catch-all inboxes</p>
      <h1 class="mt-4 max-w-4xl text-[clamp(2.4rem,7vw,6rem)] font-black leading-none tracking-normal">
        Verification codes without inbox clutter.
      </h1>
      <p class="mt-5 max-w-2xl text-[clamp(1rem,2vw,1.18rem)] leading-8 muted">
        Generate private aliases, receive verification mail, and keep every code scoped to the user who created the inbox.
      </p>
      <div class="mt-7 flex flex-wrap gap-3">
        <a class="btn btn-primary" href={data.user ? '/quick' : '/signup'}>Create an inbox</a>
        <a class="btn btn-secondary" href="/login">Log in</a>
      </div>
    </div>
  </section>
</main>
