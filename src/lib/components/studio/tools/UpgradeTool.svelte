<script lang="ts">
	import { CircleArrowUp, LoaderCircle } from '@lucide/svelte';
	import { live } from '$lib/client/live.svelte';
	import { studio } from '$lib/client/studio.svelte';
	import { toasts } from '$lib/client/toasts.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { FINISHED_STATUSES } from '$lib/status';

	let { soulseekReady }: { soulseekReady: boolean } = $props();
	let busy = $state(false);

	const jobs = $derived(
		studio.upgrades.map((j) => ({ ...j, track: live.tracks.get(j.trackId) ?? null }))
	);
	const running = $derived(
		new Set(
			jobs
				.filter((j) => j.track && !FINISHED_STATUSES.includes(j.track.status))
				.map((j) => j.fileId)
		)
	);
	const lossless = $derived(studio.targets.filter((f) => f.lossless).length);
	const candidates = $derived(studio.targets.filter((f) => !f.lossless && !running.has(f.id)));
	const finished = $derived(
		jobs.filter((j) => !j.track || FINISHED_STATUSES.includes(j.track.status))
	);

	async function run() {
		if (candidates.some((f) => studio.dirtyIds.includes(f.id)))
			return toasts.push({
				level: 'warning',
				title: 'Save tag changes first',
				message: 'The search uses the tags stored in the files.'
			});
		busy = true;
		try {
			const res = await studio.upgrade(candidates);
			const n = res.queued.length;
			toasts.push({
				level: n ? 'success' : 'warning',
				title: n ? `Looking for ${n} lossless cop${n === 1 ? 'y' : 'ies'}` : 'Nothing to upgrade',
				message: [...new Set(res.skipped.map((s) => s.reason))].join('\n') || undefined
			});
		} finally {
			busy = false;
		}
	}

	function clearFinished() {
		const gone = new Set(finished.map((j) => j.trackId));
		studio.upgrades = studio.upgrades.filter((j) => !gone.has(j.trackId));
	}
</script>

<p class="mb-3 text-xs text-ink-400">
	Look on Soulseek for a lossless copy of each lossy file. A copy that is found keeps the file's
	tags, cover and lyrics and takes its place in the library; the old file moves to quarantine.
</p>
{#if !soulseekReady}
	<div class="mb-3 rounded-lg border border-amber/25 bg-amber/5 p-2.5 text-xs text-ink-300">
		Soulseek is not set up.
		<a class="text-amber-glow hover:underline" href="/settings/integrations">Open settings</a>
	</div>
{/if}
<button
	class="btn btn-sm btn-violet w-full"
	onclick={run}
	disabled={busy || !soulseekReady || !candidates.length}
>
	{#if busy}<LoaderCircle class="h-3 w-3 animate-spin" />{:else}<CircleArrowUp
			class="h-3 w-3"
		/>{/if}
	Upgrade {candidates.length} file{candidates.length === 1 ? '' : 's'} to FLAC
</button>
{#if lossless || running.size}
	<p class="mt-2 text-[11px] text-ink-500">
		{[
			lossless ? `${lossless} already lossless` : '',
			running.size ? `${running.size} in progress` : ''
		]
			.filter(Boolean)
			.join(' · ')}
	</p>
{/if}

{#if jobs.length}
	<div class="mt-4 mb-1.5 flex items-center justify-between">
		<div class="panel-title !text-[10px]">Upgrades</div>
		<div class="flex gap-3 text-[11px]">
			{#if finished.length}
				<button class="text-ink-400 hover:text-ink-200" onclick={clearFinished}
					>Clear finished</button
				>
			{/if}
			<a class="text-violet-glow hover:underline" href="/pipeline">Open pipeline</a>
		</div>
	</div>
	<div class="space-y-1.5">
		{#each jobs as j (j.trackId)}
			<div class="rounded-lg border border-white/5 bg-ink-950/60 px-2.5 py-2">
				<div class="flex items-center justify-between gap-2">
					<div class="min-w-0 truncate text-xs text-ink-200" title={j.label}>{j.label}</div>
					{#if j.track}<StatusBadge status={j.track.status} />{:else}<span
							class="text-[11px] text-ink-500">Removed</span
						>{/if}
				</div>
				{#if j.track?.status === 'failed' || j.track?.status === 'skipped'}
					<div class="mt-1 text-[11px] text-ink-400">
						{j.track.error ?? j.track.skipReason ?? ''}
					</div>
				{:else if j.track?.status === 'done' && j.track.matchTitle}
					<div
						class="mt-1 truncate font-mono text-[10.5px] text-ink-500"
						title={j.track.matchTitle}
					>
						{j.track.matchTitle}
					</div>
				{/if}
			</div>
		{/each}
	</div>
{/if}
