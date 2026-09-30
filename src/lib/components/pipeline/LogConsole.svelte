<script lang="ts">
	let { lines, height = 'h-48' }: { lines: string[]; height?: string } = $props();
	let el: HTMLDivElement;
	let stick = true;

	$effect(() => {
		lines;
		if (el && stick) el.scrollTop = el.scrollHeight;
	});

	function classify(line: string) {
		if (/^ERROR|Error:|failed/i.test(line)) return 'text-bad';
		if (/^WARNING/.test(line)) return 'text-warn';
		if (/^\$ /.test(line)) return 'text-violet-glow';
		if (/^\[(ExtractAudio|SponsorBlock|download)\]/.test(line)) return 'text-amber-glow/90';
		if (/^\s+\d\.\d\d\s/.test(line)) return 'text-ink-200';
		return 'text-ink-300';
	}
</script>

<div
	bind:this={el}
	onscroll={() => (stick = el.scrollHeight - el.scrollTop - el.clientHeight < 24)}
	class="{height} overflow-auto rounded-lg border border-white/5 bg-ink-950/80 p-2.5 font-mono text-[11px] leading-[1.6]"
>
	{#each lines as line, i (i)}
		<div class="break-all whitespace-pre-wrap {classify(line)}">{line}</div>
	{:else}
		<div class="text-ink-500">Waiting for output…</div>
	{/each}
</div>
