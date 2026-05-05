<script lang="ts">
	let {
		code = '',
		spinning = false,
		length = 6
	} = $props<{
		code?: string | null;
		spinning?: boolean;
		length?: number;
	}>();

	const digits = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
	let spinStartedAt = $state<number | null>(null);
	let animationNow = $state(Date.now());
	let spinTimer: ReturnType<typeof setInterval> | undefined;
	const reelIndexes = $derived(Array.from({ length }, (_, index) => index));
	const normalizedCode = $derived(
		String(code || '')
			.replace(/\D/g, '')
			.padStart(length, '0')
			.slice(0, length)
	);
	const spinDuration = $derived(
		spinning && spinStartedAt
			? Math.max(0.14, 0.82 - Math.min(0.58, ((animationNow - spinStartedAt) / 30000) * 0.58))
			: 0.28
	);

	function reelStyle(index: number) {
		const target = Number(normalizedCode[index] || 0);
		const speedOffset = [0.04, -0.03, 0.08, -0.06, 0.02, -0.01, 0.06, -0.04][index % 8];
		const spinSpeed = Math.max(0.12, spinDuration + speedOffset);
		const settleDelay = 0.08 + index * 0.18 + (index % 2) * 0.06;
		const settleDuration = 0.7 + (index % 3) * 0.18;
		return [
			`--target: ${target}`,
			`--delay: ${settleDelay}s`,
			`--settle-duration: ${settleDuration}s`,
			`--spin-duration: ${spinSpeed}s`,
			`--spin-phase: ${index * -0.11}s`
		].join('; ');
	}

	$effect(() => {
		if (!spinning) {
			spinStartedAt = null;
			if (spinTimer) clearInterval(spinTimer);
			spinTimer = undefined;
			return;
		}

		spinStartedAt ??= Date.now();
		animationNow = Date.now();
		spinTimer = setInterval(() => {
			animationNow = Date.now();
		}, 300);

		return () => {
			if (spinTimer) clearInterval(spinTimer);
			spinTimer = undefined;
		};
	});
</script>

<div
	class="mx-auto flex max-w-full flex-wrap items-center justify-center gap-2 rounded-lg border p-3 sm:gap-3 sm:p-4"
	aria-label={spinning ? 'Verification code reels spinning' : `Verification code ${normalizedCode}`}
>
	{#each reelIndexes as _, index}
		<div class="reel-window" aria-hidden="true">
			<div
				class:spin={spinning}
				class="reel-strip"
				style={reelStyle(index)}
			>
				{#each digits as digit}
					<div class="digit">{digit}</div>
				{/each}
			</div>
		</div>
	{/each}
</div>

<style>
	.reel-window {
		position: relative;
		width: clamp(3.15rem, 8vw, 7.75rem);
		height: clamp(3.15rem, 8vw, 7.75rem);
		overflow: hidden;
		border-radius: 9999px;
		border: 2px solid color-mix(in srgb, var(--otp-digit, #49dfaa) 42%, transparent);
		background:
			radial-gradient(circle at 50% 26%, color-mix(in srgb, var(--otp-digit, #49dfaa) 22%, transparent), transparent 58%),
			linear-gradient(180deg, color-mix(in srgb, var(--otp-bg, #101827) 88%, #ffffff 4%), var(--otp-bg, #101827));
		box-shadow:
			inset 0 0 30px rgba(0, 0, 0, 0.7),
			0 0 28px var(--otp-glow, rgba(52, 211, 153, 0.15));
		flex: 0 0 auto;
	}

	.reel-window::before,
	.reel-window::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		z-index: 5;
		height: 35%;
		pointer-events: none;
	}

	.reel-window::before {
		top: 0;
		background: linear-gradient(to bottom, color-mix(in srgb, var(--otp-bg, #101827) 94%, transparent), transparent);
	}

	.reel-window::after {
		bottom: 0;
		background: linear-gradient(to top, color-mix(in srgb, var(--otp-bg, #101827) 94%, transparent), transparent);
	}

	.reel-strip {
		--digit-size: clamp(3.15rem, 8vw, 7.75rem);

		transform: translateY(calc(var(--target) * var(--digit-size) * -1));
		transition:
			transform var(--settle-duration, 1.2s) cubic-bezier(0.12, 0.75, 0.2, 1.1),
			filter 0.4s ease;
		transition-delay: var(--delay);
	}

	.digit {
		height: var(--digit-size);
		display: grid;
		place-items: center;
		font-size: clamp(2rem, 5.7vw, 5.15rem);
		font-weight: 950;
		line-height: 1;
		color: var(--otp-digit, #49dfaa);
		text-shadow:
			0 0 18px var(--otp-glow, rgba(52, 211, 153, 0.7)),
			0 8px 18px rgba(0, 0, 0, 0.5);
	}

	.spin {
		animation: jackpot-reel-spin var(--spin-duration, 0.28s) linear infinite;
		animation-delay: var(--spin-phase, 0s);
		filter: blur(1.5px);
	}

	@keyframes jackpot-reel-spin {
		from {
			transform: translateY(0);
		}

		to {
			transform: translateY(calc(-10 * var(--digit-size)));
		}
	}

	@media (max-width: 420px) {
		.reel-window {
			width: clamp(2.65rem, 13vw, 3.15rem);
			height: clamp(2.65rem, 13vw, 3.15rem);
		}

		.reel-strip {
			--digit-size: clamp(2.65rem, 13vw, 3.15rem);
		}

		.digit {
			font-size: clamp(1.75rem, 11vw, 2.1rem);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spin {
			animation: none;
			filter: none;
		}

		.reel-strip {
			transition-duration: 0.2s;
			transition-delay: 0s;
		}
	}
</style>
