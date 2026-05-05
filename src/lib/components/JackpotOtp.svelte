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
	let reelSpinning = $state<boolean[]>([]);
	let spinTimer: ReturnType<typeof setInterval> | undefined;
	let stopTimers: ReturnType<typeof setTimeout>[] = [];

	const reelIndexes = $derived(Array.from({ length }, (_, index) => index));
	const normalizedCode = $derived(
		String(code || '')
			.replace(/\D/g, '')
			.padStart(length, '0')
			.slice(0, length)
	);
	const spinDuration = $derived(
		spinning && spinStartedAt
			? Math.max(0.38, 1.05 - Math.min(0.55, ((animationNow - spinStartedAt) / 20000) * 0.55))
			: 0.7
	);

	function reelStyle(index: number) {
		const target = Number(normalizedCode[index] || 0);
		const speedOffset = [0.08, -0.04, 0.12, -0.02, 0.06, 0.1][index % 6];

		return [
			`--target: ${target}`,
			`--spin-duration: ${Math.max(0.32, spinDuration + speedOffset)}s`,
			`--spin-phase: ${index * -0.13}s`,
			`--settle-delay: ${0.08 + index * 0.13}s`,
			`--settle-duration: ${0.9 + index * 0.08}s`
		].join('; ');
	}

	$effect(() => {
		if (spinning) {
			stopTimers.forEach(clearTimeout);
			stopTimers = [];
			reelSpinning = Array.from({ length }, () => true);
			spinStartedAt ??= Date.now();
			animationNow = Date.now();

			if (spinTimer) clearInterval(spinTimer);
			spinTimer = setInterval(() => {
				animationNow = Date.now();
			}, 250);
		} else {
			if (spinTimer) clearInterval(spinTimer);
			spinTimer = undefined;
			stopTimers.forEach(clearTimeout);

			stopTimers = reelIndexes.map((_, index) =>
				setTimeout(() => {
					reelSpinning = reelSpinning.map((value, reelIndex) =>
						reelIndex === index ? false : value
					);

					if (index === reelIndexes.length - 1) {
						spinStartedAt = null;
					}
				}, 240 + index * 330)
			);
		}

		return () => {
			if (spinTimer) clearInterval(spinTimer);
			spinTimer = undefined;
			stopTimers.forEach(clearTimeout);
			stopTimers = [];
		};
	});
</script>

<div
	class="jackpot-shell mx-auto w-full max-w-5xl rounded-[2rem] border p-4 shadow-2xl sm:p-6"
	style={`--reel-count: ${length}`}
	aria-label={spinning ? 'Verification code reels spinning' : `Verification code ${normalizedCode}`}
>
	<div class="jackpot-glow"></div>

	<div class="jackpot-frame">
		{#each reelIndexes as _, index}
			<div class="reel-body" aria-hidden="true">
				<div class="reel-strip" class:spin={reelSpinning[index]} style={reelStyle(index)}>
					{#each [...digits, ...digits, ...digits] as digit}
						<div class="digit-cell">
							<span>{digit}</span>
						</div>
					{/each}
				</div>

				<div class="reel-shine"></div>
				<div class="reel-vignette"></div>
			</div>
		{/each}
	</div>

	<div class="sr-only">
		{#if spinning}
			Verification code loading
		{:else}
			Verification code is {normalizedCode}
		{/if}
	</div>
</div>

<style>
	.jackpot-shell {
		position: relative;
		overflow: hidden;
		border-color: color-mix(in srgb, var(--otp-digit, #49dfaa) 46%, transparent);
		background:
			radial-gradient(circle at 50% 0%, color-mix(in srgb, var(--otp-digit, #49dfaa) 28%, transparent), transparent 42%),
			radial-gradient(circle at 50% 115%, color-mix(in srgb, var(--otp-digit, #49dfaa) 34%, transparent), transparent 48%),
			linear-gradient(180deg, color-mix(in srgb, var(--otp-bg, #101827) 88%, #ffffff 5%), color-mix(in srgb, var(--otp-bg, #101827) 96%, #000000 12%));
		box-shadow:
			0 0 24px color-mix(in srgb, var(--otp-digit, #49dfaa) 30%, transparent),
			0 22px 90px color-mix(in srgb, var(--otp-glow, rgba(52, 211, 153, 0.32)) 76%, transparent);
	}

	.jackpot-glow {
		position: absolute;
		inset: auto 8% -35% 8%;
		height: 45%;
		border-radius: 9999px;
		background: color-mix(in srgb, var(--otp-digit, #49dfaa) 46%, transparent);
		filter: blur(46px);
		pointer-events: none;
	}

	.jackpot-frame {
		position: relative;
		display: grid;
		grid-template-columns: repeat(var(--reel-count, 6), minmax(0, 1fr));
		align-items: center;
		gap: clamp(0.35rem, 1.2vw, 0.9rem);
		border-radius: 1.6rem;
		border: 1px solid color-mix(in srgb, var(--otp-digit, #49dfaa) 36%, transparent);
		background:
			linear-gradient(90deg, color-mix(in srgb, var(--otp-digit, #49dfaa) 12%, transparent), transparent 10%, transparent 90%, color-mix(in srgb, var(--otp-digit, #49dfaa) 12%, transparent)),
			linear-gradient(180deg, color-mix(in srgb, var(--otp-bg, #101827) 94%, #ffffff 4%), color-mix(in srgb, var(--otp-bg, #101827) 98%, #000000 22%));
		box-shadow:
			inset 0 0 38px rgba(0, 0, 0, 0.88),
			inset 0 0 42px color-mix(in srgb, var(--otp-digit, #49dfaa) 22%, transparent),
			0 0 22px color-mix(in srgb, var(--otp-digit, #49dfaa) 42%, transparent),
			0 0 54px color-mix(in srgb, var(--otp-glow, rgba(52, 211, 153, 0.32)) 74%, transparent);
		padding: clamp(0.55rem, 1.7vw, 1.2rem);
	}

	.reel-body {
		--digit-size: clamp(4.3rem, 11vw, 8.5rem);

		position: relative;
		height: var(--digit-size);
		min-width: 0;
		overflow: hidden;
		border-radius: 1.1rem;
		border-left: 2px solid color-mix(in srgb, var(--otp-digit, #49dfaa) 42%, #ffffff 32%);
		border-right: 2px solid color-mix(in srgb, var(--otp-digit, #49dfaa) 42%, #ffffff 32%);
		background:
			radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--otp-digit, #49dfaa) 16%, transparent), transparent 58%),
			linear-gradient(180deg, color-mix(in srgb, var(--otp-bg, #101827) 80%, #ffffff 8%), color-mix(in srgb, var(--otp-bg, #101827) 98%, #000000 28%));
		box-shadow:
			inset 0 0 22px rgba(0, 0, 0, 0.9),
			inset 12px 0 24px color-mix(in srgb, var(--otp-digit, #49dfaa) 22%, transparent),
			inset -12px 0 24px color-mix(in srgb, var(--otp-digit, #49dfaa) 22%, transparent),
			0 0 20px color-mix(in srgb, var(--otp-digit, #49dfaa) 46%, transparent),
			0 0 44px color-mix(in srgb, var(--otp-glow, rgba(52, 211, 153, 0.32)) 66%, transparent);
	}

	.reel-body::before,
	.reel-body::after {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		width: 10px;
		z-index: 6;
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--otp-digit, #49dfaa) 20%, transparent),
			color-mix(in srgb, var(--otp-digit, #49dfaa) 45%, #ffffff 48%),
			color-mix(in srgb, var(--otp-digit, #49dfaa) 20%, transparent)
		);
		box-shadow:
			0 0 16px color-mix(in srgb, var(--otp-digit, #49dfaa) 84%, transparent),
			0 0 34px color-mix(in srgb, var(--otp-glow, rgba(52, 211, 153, 0.75)) 92%, transparent);
		pointer-events: none;
	}

	.reel-body::before {
		left: 0;
	}

	.reel-body::after {
		right: 0;
	}

	.reel-strip {
		transform: translateY(calc((var(--target) + 10) * var(--digit-size) * -1));
		transition:
			transform var(--settle-duration, 1s) cubic-bezier(0.12, 0.78, 0.2, 1.08),
			filter 0.35s ease;
		transition-delay: var(--settle-delay, 0s);
		will-change: transform;
	}

	.digit-cell {
		height: var(--digit-size);
		display: grid;
		place-items: center;
		position: relative;
	}

	.digit-cell::before {
		content: '';
		position: absolute;
		inset: 12%;
		border-radius: 0.9rem;
		border: 1px solid color-mix(in srgb, var(--otp-digit, #49dfaa) 18%, transparent);
		background: rgba(3, 10, 14, 0.26);
		box-shadow: inset 0 0 16px rgba(0, 0, 0, 0.46);
	}

	.digit-cell span {
		position: relative;
		z-index: 2;
		font-size: clamp(3rem, 8.5vw, 7rem);
		font-weight: 950;
		line-height: 1;
		color: var(--otp-digit, #49dfaa);
		letter-spacing: 0;
		-webkit-text-stroke: clamp(1px, 0.08em, 5px) rgba(0, 0, 0, 0.72);
		paint-order: stroke fill;
		text-shadow:
			0 1px 0 rgba(255, 255, 255, 0.34),
			0 0 4px color-mix(in srgb, var(--otp-digit, #49dfaa) 86%, #ffffff 18%),
			0 0 10px color-mix(in srgb, var(--otp-digit, #49dfaa) 68%, transparent),
			1px 2px 0 rgba(0, 0, 0, 0.82),
			-1px -1px 0 rgba(0, 0, 0, 0.58);
	}

	.reel-shine {
		position: absolute;
		inset: 0;
		z-index: 7;
		background:
			linear-gradient(90deg, rgba(255, 255, 255, 0.16), transparent 18%, transparent 78%, rgba(255, 255, 255, 0.12)),
			linear-gradient(180deg, rgba(255, 255, 255, 0.12), transparent 28%, transparent 70%, color-mix(in srgb, var(--otp-digit, #49dfaa) 18%, transparent));
		mix-blend-mode: screen;
		pointer-events: none;
	}

	.reel-vignette {
		position: absolute;
		inset: 0;
		z-index: 8;
		background:
			linear-gradient(to bottom, rgba(2, 6, 10, 0.86), transparent 32%, transparent 68%, rgba(2, 6, 10, 0.86)),
			radial-gradient(circle at center, transparent 45%, rgba(0, 0, 0, 0.38));
		pointer-events: none;
	}

	.spin {
		animation: jackpot-spin var(--spin-duration, 0.45s) linear infinite;
		animation-delay: var(--spin-phase, 0s);
		filter: blur(1.4px);
	}

	@keyframes jackpot-spin {
		from {
			transform: translateY(calc(-10 * var(--digit-size)));
		}

		to {
			transform: translateY(calc(-20 * var(--digit-size)));
		}
	}

	@media (max-width: 640px) {
		.jackpot-frame {
			gap: 0.35rem;
			padding: 0.5rem;
			border-radius: 1.1rem;
		}

		.reel-body {
			--digit-size: clamp(3.1rem, 14vw, 4.4rem);
			border-radius: 0.8rem;
		}

		.digit-cell span {
			font-size: clamp(2.4rem, 11vw, 3.6rem);
		}

		.reel-body::before,
		.reel-body::after {
			width: 5px;
		}
	}

	@media (max-width: 420px) {
		.jackpot-shell {
			border-radius: 1.1rem;
			padding: 0.45rem;
		}

		.jackpot-frame {
			gap: 0.22rem;
			padding: 0.35rem;
		}

		.reel-body {
			--digit-size: clamp(2.45rem, 12.2vw, 3rem);
			border-left-width: 1px;
			border-right-width: 1px;
		}

		.digit-cell span {
			font-size: clamp(1.85rem, 9vw, 2.55rem);
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
