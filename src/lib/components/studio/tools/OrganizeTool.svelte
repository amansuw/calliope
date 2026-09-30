<script lang="ts">
	import { FolderTree, LoaderCircle } from '@lucide/svelte';
	import { untrack } from 'svelte';
	import { api } from '$lib/client/api';
	import { studio } from '$lib/client/studio.svelte';
	import { toasts } from '$lib/client/toasts.svelte';
	import { library } from '$lib/client/library.svelte';

	let { template: initial }: { template: string } = $props();
	let template = $state(untrack(() => initial));

	type Plan = { id: string; from: string; to: string; changed: boolean }[];
	let plan = $state<Plan | null>(null);
	let busy = $state(false);

	const changes = $derived(plan?.filter((p) => p.changed) ?? []);

	async function preview() {
		if (studio.dirtyIds.length)
			return toasts.push({
				level: 'warning',
				title: 'Save tag changes first',
				message: 'Organizing uses the tags stored in the files.'
			});
		busy = true;
		try {
			plan = (
				await api.post<{ plan: Plan }>('/api/studio/organize', {
					ids: studio.targets.map((t) => t.id),
					template,
					dryRun: true
				})
			).plan;
		} finally {
			busy = false;
		}
	}

	async function run() {
		busy = true;
		try {
			const res = await api.post<{ moved: number }>('/api/studio/organize', {
				ids: studio.targets.map((t) => t.id),
				template,
				dryRun: false
			});
			toasts.push({
				level: 'success',
				title: `Moved ${res.moved} file${res.moved === 1 ? '' : 's'}`
			});
			plan = null;
			await studio.reload(studio.targets.map((t) => t.id));
			void library.load(true);
		} finally {
			busy = false;
		}
	}

	const short = (p: string) => p.split('/').slice(-3).join('/');
</script>

<p class="mb-3 text-xs text-ink-400">
	Rename and move files so their paths follow a template. Empty folders left behind are removed.
</p>
<input class="input !h-8 font-mono !text-xs" bind:value={template} oninput={() => (plan = null)} />
<button class="btn btn-sm mt-2 w-full" onclick={preview} disabled={busy || !studio.targets.length}>
	{#if busy && !plan}<LoaderCircle class="h-3 w-3 animate-spin" />{:else}<FolderTree
			class="h-3 w-3"
		/>{/if} Preview {studio.targets.length} file{studio.targets.length === 1 ? '' : 's'}
</button>

{#if plan}
	<div
		class="mt-3 max-h-64 space-y-2 overflow-y-auto rounded-lg border border-white/5 bg-ink-950/60 p-2 font-mono text-[10.5px]"
	>
		{#each changes.slice(0, 50) as p (p.id)}
			<div>
				<div class="truncate text-ink-500 line-through">{short(p.from)}</div>
				<div class="truncate text-ok">{short(p.to)}</div>
			</div>
		{:else}
			<div class="text-ink-400">Everything already matches the template.</div>
		{/each}
	</div>
	{#if changes.length}
		<button class="btn btn-primary btn-sm mt-3 w-full" onclick={run} disabled={busy}
			>Move {changes.length} file{changes.length === 1 ? '' : 's'}</button
		>
	{/if}
{/if}
