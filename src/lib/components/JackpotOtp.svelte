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
	const reelIndexes = $derived(Array.from({ length }, (_, index) => index));
	const normalizedCode = $derived(
		String(code || '')
			.replace(/\D/g, '')
			.padStart(length, '0')
			.slice(0, length)
	);
</script>

<div
	class="mx-auto flex max-w-full flex-wrap items-center justify-center gap-2 rounded-lg border border-emerald-400/30 bg-slate-950/60 p-3 shadow-[0_0_60px_rgba(52,211,153,0.13)] sm:gap-3 sm:p-4"
	aria-label={spinning ? 'Verification code reels spinning' : `Verification code ${normalizedCode}`}
>
	{#each reelIndexes as _, index}
		<div class="reel-window" aria-hidden="true">
			<div
				class:spin={spinning}
				class="reel-strip"
				style={`--target: ${Number(normalizedCode[index] || 0)}; --delay: ${index * 0.15}s`}
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
		border: 2px solid rgba(52, 211, 153, 0.45);
		background:
			radial-gradient(circle at center, rgba(52, 211, 153, 0.16), transparent 60%),
			linear-gradient(180deg, #101827, #1f2937);
		box-shadow:
			inset 0 0 30px rgba(0, 0, 0, 0.7),
			0 0 28px rgba(52, 211, 153, 0.15);
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
		background: linear-gradient(to bottom, rgba(15, 23, 42, 0.95), transparent);
	}

	.reel-window::after {
		bottom: 0;
		background: linear-gradient(to top, rgba(15, 23, 42, 0.95), transparent);
	}

	.reel-strip {
		--digit-size: clamp(3.15rem, 8vw, 7.75rem);

		transform: translateY(calc(var(--target) * var(--digit-size) * -1));
		transition:
			transform 1.2s cubic-bezier(0.12, 0.75, 0.2, 1.1),
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
		color: #49dfaa;
		text-shadow:
			0 0 18px rgba(52, 211, 153, 0.7),
			0 8px 18px rgba(0, 0, 0, 0.5);
	}

	.spin {
		animation: jackpot-reel-spin 0.28s linear infinite;
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
