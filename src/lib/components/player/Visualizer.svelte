<script lang="ts">
	import { player } from '$lib/client/player.svelte';

	let {
		bars = 18,
		width = 72,
		height = 28
	}: { bars?: number; width?: number; height?: number } = $props();
	let canvas: HTMLCanvasElement;

	$effect(() => {
		if (!canvas) return;
		const dpr = window.devicePixelRatio || 1;
		canvas.width = width * dpr;
		canvas.height = height * dpr;
		const g = canvas.getContext('2d')!;
		g.scale(dpr, dpr);
		let raf = 0;
		let buf: Uint8Array<ArrayBuffer> | null = null;
		const levels = new Float32Array(bars);

		const draw = () => {
			const a = player.analyser;
			if (a && !buf) buf = new Uint8Array(a.frequencyBinCount);
			if (a && buf && player.playing) a.getByteFrequencyData(buf);
			g.clearRect(0, 0, width, height);
			const w = width / bars;
			for (let i = 0; i < bars; i++) {
				// Log-ish spread so bass doesn't hog every bar
				const bin = buf ? Math.floor(Math.pow(i / bars, 1.6) * (buf.length * 0.75)) : 0;
				const target = buf && player.playing ? buf[bin] / 255 : 0;
				levels[i] += (target - levels[i]) * (target > levels[i] ? 0.5 : 0.12);
				const h = Math.max(2, levels[i] * height);
				const grad = g.createLinearGradient(0, height, 0, height - h);
				grad.addColorStop(0, '#8b5cf6');
				grad.addColorStop(1, '#ffb547');
				g.fillStyle = grad;
				g.fillRect(i * w + 1, height - h, w - 2, h);
			}
			raf = requestAnimationFrame(draw);
		};
		raf = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(raf);
	});
</script>

<canvas bind:this={canvas} style="width:{width}px;height:{height}px" class="block"></canvas>
