<script lang="ts">
	import { rate } from '$lib/client/format';

	let { samples, height = 72 }: { samples: number[]; height?: number } = $props();

	const width = 480;
	const max = $derived(Math.max(256 * 1024, ...samples) * 1.15);
	const points = $derived(
		samples.map(
			(v, i) => [(i / (samples.length - 1)) * width, height - (v / max) * (height - 4)] as const
		)
	);
	const line = $derived(
		points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('')
	);
	const area = $derived(`${line}L${width},${height}L0,${height}Z`);
	const peak = $derived(Math.max(...samples));
</script>

<div class="relative">
	<svg
		viewBox="0 0 {width} {height}"
		preserveAspectRatio="none"
		class="block h-[72px] w-full"
		style="height:{height}px"
	>
		<defs>
			<linearGradient id="speed-fill" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0%" stop-color="var(--color-amber)" stop-opacity="0.35" />
				<stop offset="100%" stop-color="var(--color-violet)" stop-opacity="0" />
			</linearGradient>
			<linearGradient id="speed-line" x1="0" y1="0" x2="1" y2="0">
				<stop offset="0%" stop-color="var(--color-violet-glow)" />
				<stop offset="100%" stop-color="var(--color-amber-glow)" />
			</linearGradient>
		</defs>
		{#each [0.25, 0.5, 0.75] as g (g)}
			<line
				x1="0"
				x2={width}
				y1={height * g}
				y2={height * g}
				stroke="rgb(255 255 255 / 0.04)"
				vector-effect="non-scaling-stroke"
			/>
		{/each}
		<path d={area} fill="url(#speed-fill)" />
		<path
			d={line}
			fill="none"
			stroke="url(#speed-line)"
			stroke-width="1.75"
			vector-effect="non-scaling-stroke"
			stroke-linejoin="round"
		/>
	</svg>
	<div class="pointer-events-none absolute top-1 right-2 font-mono text-[10px] text-ink-400">
		peak {rate(peak)}
	</div>
</div>
