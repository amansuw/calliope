<script lang="ts">
	import { STAGE_LABELS, type TrackStatus } from '$lib/status';

	let { status, label }: { status: TrackStatus | 'library' | 'new'; label?: string } = $props();

	const tone: Record<string, string> = {
		queued: 'border-ink-500/60 bg-ink-700/50 text-ink-200',
		resolving: 'border-violet/40 bg-violet/10 text-violet-glow',
		matching: 'border-violet/40 bg-violet/10 text-violet-glow',
		downloading: 'border-amber/40 bg-amber/10 text-amber-glow',
		processing: 'border-amber/40 bg-amber/10 text-amber-glow',
		tagging: 'border-violet/40 bg-violet/10 text-violet-glow',
		moving: 'border-amber/40 bg-amber/10 text-amber-glow',
		done: 'border-ok/30 bg-ok/10 text-ok',
		library: 'border-ok/30 bg-ok/10 text-ok',
		failed: 'border-bad/40 bg-bad/10 text-bad',
		skipped: 'border-ink-500/60 bg-ink-700/40 text-ink-300',
		cancelled: 'border-ink-500/60 bg-ink-700/40 text-ink-400',
		new: 'border-violet/40 bg-violet/10 text-violet-glow'
	};
	const active = $derived(
		['resolving', 'matching', 'downloading', 'processing', 'tagging', 'moving'].includes(status)
	);
	const text = $derived(
		label ?? (status === 'library' ? 'In library' : status === 'new' ? 'New' : STAGE_LABELS[status])
	);
</script>

<span class="chip {tone[status]}">
	{#if active}<span class="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-current"></span>{/if}
	{text}
</span>
