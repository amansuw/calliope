<script lang="ts">
	let {
		value,
		size = 44,
		stroke = 3.5,
		indeterminate = false,
		tone = 'amber'
	}: {
		value: number;
		size?: number;
		stroke?: number;
		indeterminate?: boolean;
		tone?: 'amber' | 'violet';
	} = $props();

	const r = $derived((size - stroke) / 2);
	const c = $derived(2 * Math.PI * r);
	const offset = $derived(c * (1 - Math.min(100, Math.max(0, value)) / 100));
	const color = $derived(tone === 'amber' ? 'var(--color-amber)' : 'var(--color-violet-glow)');
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 {size} {size}"
	class={indeterminate ? 'animate-spin [animation-duration:1.4s]' : ''}
>
	<circle
		cx={size / 2}
		cy={size / 2}
		{r}
		fill="none"
		stroke="rgb(255 255 255 / 0.07)"
		stroke-width={stroke}
	/>
	<circle
		cx={size / 2}
		cy={size / 2}
		{r}
		fill="none"
		stroke={color}
		stroke-width={stroke}
		stroke-linecap="round"
		stroke-dasharray={c}
		stroke-dashoffset={indeterminate ? c * 0.72 : offset}
		transform="rotate(-90 {size / 2} {size / 2})"
		style="transition: stroke-dashoffset 0.6s ease; filter: drop-shadow(0 0 4px {color})"
	/>
</svg>
