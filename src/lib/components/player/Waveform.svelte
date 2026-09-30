<script lang="ts">
	import { duration as fmt } from '$lib/client/format';

	let {
		peaks,
		progress,
		duration,
		onseek,
		height = 36
	}: {
		peaks: number[] | null;
		progress: number;
		duration: number;
		onseek: (sec: number) => void;
		height?: number;
	} = $props();

	let canvas: HTMLCanvasElement;
	let width = $state(0);
	let hover = $state<number | null>(null);

	$effect(() => {
		if (!canvas || !width) return;
		const dpr = window.devicePixelRatio || 1;
		canvas.width = width * dpr;
		canvas.height = height * dpr;
		const g = canvas.getContext('2d')!;
		g.scale(dpr, dpr);
		g.clearRect(0, 0, width, height);

		const bars = Math.max(1, Math.floor(width / 3));
		const data = peaks?.length
			? peaks
			: Array.from({ length: bars }, (_, i) => 30 + 20 * Math.sin(i / 3));
		const played = progress * width;
		const hoverX = hover !== null ? hover * width : null;

		const playedGrad = g.createLinearGradient(0, 0, width, 0);
		playedGrad.addColorStop(0, '#8b5cf6');
		playedGrad.addColorStop(1, '#ffb547');

		for (let i = 0; i < bars; i++) {
			const v = data[Math.floor((i / bars) * data.length)] / 255;
			const h = Math.max(2, v * (height - 4));
			const x = i * 3;
			const y = (height - h) / 2;
			if (x < played) g.fillStyle = playedGrad;
			else if (hoverX !== null && x < hoverX) g.fillStyle = 'rgba(255,181,71,0.35)';
			else g.fillStyle = peaks ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)';
			g.fillRect(x, y, 2, h);
		}
	});

	const pos = (e: MouseEvent) => {
		const r = canvas.getBoundingClientRect();
		return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
	};
</script>

<div class="relative w-full" bind:clientWidth={width}>
	<canvas
		bind:this={canvas}
		style="width:{width}px;height:{height}px"
		class="block cursor-pointer"
		onpointermove={(e) => (hover = pos(e))}
		onpointerleave={() => (hover = null)}
		onclick={(e) => onseek(pos(e) * duration)}
	></canvas>
	{#if hover !== null}
		<div
			class="pointer-events-none absolute -top-6 -translate-x-1/2 rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] text-ink-100 shadow"
			style="left:{hover * 100}%"
		>
			{fmt(hover * duration * 1000)}
		</div>
	{/if}
</div>
