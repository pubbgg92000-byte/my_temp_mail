<svelte:head>
  <title>Privacy | OtpNest</title>
  <meta name="description" content="OtpNest privacy information for temporary inboxes and OTP messages." />
</svelte:head>

<main class="app-shell max-w-4xl space-y-4">
  <header class="topbar">
    <a href="/quick" class="font-black">⚡ OtpNest</a>
    <a class="btn btn-secondary" href="/quick">Quick mail</a>
  </header>

  <section class="section-card">
    <p class="kicker">Privacy</p>
    <h1 class="mt-2 text-[clamp(2rem,5vw,4rem)] font-black leading-none">Simple, scoped inbox privacy.</h1>
    <div class="mt-6 space-y-4 text-sm leading-7 muted">
      <p>OtpNest stores generated aliases and received emails needed to show OTP codes in your quick route.</p>
      <p>No email sending is included in the MVP, and attachment downloads are not supported in the MVP.</p>
      <p>Users can only see their own inboxes and messages through the app’s authenticated quick route.</p>
      <p>Operational logs may be used to debug matching, delivery, abuse prevention, and reliability.</p>
    </div>
  </section>
</main>
