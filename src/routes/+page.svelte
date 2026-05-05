<script lang="ts">
  import { onMount } from 'svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  onMount(() => {
    const storedTheme = localStorage.getItem('theme');
    const dark = storedTheme ? storedTheme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', dark);
  });
</script>

<svelte:head>
  <title>OtpNest | Temporary inboxes for verification codes</title>
  <meta name="description" content="Create private temporary email inboxes and view verification codes securely with OtpNest." />
</svelte:head>

<main class="app-shell flex flex-col">
  {#if !data.user}
    <header class="flex min-w-0 justify-end py-2">
      <nav class="flex items-center gap-5 text-sm font-black" aria-label="Public navigation">
        <a class="public-text-link" href="/login">Log in</a>
        <a class="public-text-link" href="/signup">Sign up</a>
      </nav>
    </header>
  {/if}

  <section class="flex flex-1 items-center py-8 lg:py-14">
    <div class="min-w-0">
      <p class="kicker">Private catch-all inboxes</p>
      <h1 class="mt-4 max-w-4xl text-[clamp(2.4rem,7vw,6rem)] font-black leading-none tracking-normal">
        Verification codes without inbox clutter.
      </h1>
      <p class="mt-5 max-w-2xl text-[clamp(1rem,2vw,1.18rem)] leading-8 muted">
        Generate private aliases, receive verification mail, and keep every code scoped to the user who created the inbox.
      </p>
      {#if data.user}
        <div class="mt-7">
          <a class="public-text-link text-base" href="/quick">Open quick mail</a>
        </div>
      {/if}
    </div>
  </section>
</main>
