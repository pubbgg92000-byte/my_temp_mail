<script lang="ts">
  import '../app.css';
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();
  let dark = $state(false);

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
</script>

{@render children()}
