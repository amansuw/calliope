<script lang="ts">
	import { beforeNavigate } from '$app/navigation';
	import {
		FileAudio,
		FolderTree,
		Image,
		LoaderCircle,
		Plus,
		Replace,
		Save,
		Sparkles,
		SquarePen,
		Trash2,
		Undo2,
		WandSparkles
	} from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { studio } from '$lib/client/studio.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import FilePicker from '$lib/components/studio/FilePicker.svelte';
	import TagGrid from '$lib/components/studio/TagGrid.svelte';
	import ArtLyricsTool from '$lib/components/studio/tools/ArtLyricsTool.svelte';
	import BulkTool from '$lib/components/studio/tools/BulkTool.svelte';
	import FilenameTool from '$lib/components/studio/tools/FilenameTool.svelte';
	import MatchTool from '$lib/components/studio/tools/MatchTool.svelte';
	import OrganizeTool from '$lib/components/studio/tools/OrganizeTool.svelte';
	import ReplaceTool from '$lib/components/studio/tools/ReplaceTool.svelte';

	let { data } = $props();
	let picker = $state(false);

	const TOOLS = [
		{ key: 'match', label: 'Match', icon: Sparkles },
		{ key: 'bulk', label: 'Bulk edit', icon: SquarePen },
		{ key: 'replace', label: 'Replace & case', icon: Replace },
		{ key: 'filename', label: 'From filename', icon: FileAudio },
		{ key: 'art', label: 'Art & lyrics', icon: Image },
		{ key: 'organize', label: 'Organize', icon: FolderTree }
	] as const;
	let tool = $state<(typeof TOOLS)[number]['key']>('match');

	onMount(() => {
		// Files handed over from the Library Explorer
		try {
			const ids = JSON.parse(sessionStorage.getItem('calliope:studio-ids') ?? '[]') as string[];
			sessionStorage.removeItem('calliope:studio-ids');
			if (ids.length) void studio.add(ids);
		} catch {
			/* storage unavailable */
		}
	});

	beforeNavigate(({ cancel }) => {
		if (
			studio.dirtyIds.length &&
			!confirm(
				`Leave with ${studio.dirtyIds.length} unsaved file change(s)? They stay staged until you come back or reload.`
			)
		)
			cancel();
	});

	function onkeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 's') {
			e.preventDefault();
			void studio.save();
		}
	}
</script>

<svelte:window {onkeydown} />
<svelte:head><title>Metadata Studio · Calliope</title></svelte:head>

<header class="flex flex-wrap items-end justify-between gap-3 pt-6 pb-4">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight text-ink-50">Metadata Studio</h1>
		<p class="mt-1 text-sm text-ink-400">
			{studio.files.length} file{studio.files.length === 1 ? '' : 's'} in the working set{studio
				.selected.length
				? ` · ${studio.selected.length} selected (tools apply to these)`
				: ''}
		</p>
	</div>
	<div class="flex items-center gap-2">
		<button class="btn" onclick={() => (picker = true)}
			><Plus class="h-3.5 w-3.5" /> Add files</button
		>
		{#if studio.files.length}
			<button
				class="btn btn-ghost"
				onclick={() => studio.clear()}
				disabled={!!studio.dirtyIds.length}><Trash2 class="h-3.5 w-3.5" /> Clear</button
			>
		{/if}
		{#if studio.dirtySelected.length && studio.dirtySelected.length < studio.dirtyIds.length}
			<button
				class="btn btn-ghost"
				onclick={() => studio.revert(studio.dirtySelected)}
				title="Discard staged changes on the selected rows only"
				><Undo2 class="h-3.5 w-3.5" /> Revert selected {studio.dirtySelected.length}</button
			>
		{/if}
		<button
			class="btn btn-ghost"
			onclick={() => studio.revert()}
			disabled={!studio.dirtyIds.length}
			title="Discard every staged change"><Undo2 class="h-3.5 w-3.5" /> Revert all</button
		>
		<label
			class="flex items-center gap-1.5 px-1 text-xs text-ink-300"
			title="After saving, rename and move files so their folders follow the template in Settings › Library & paths"
		>
			<input type="checkbox" class="accent-amber" bind:checked={studio.organizeOnSave} /> Move files to
			match folder template
		</label>
		<button
			class="btn btn-primary"
			onclick={() => studio.save()}
			disabled={!studio.dirtyIds.length || studio.saving}
			title="⌘S"
		>
			{#if studio.saving}<LoaderCircle class="h-3.5 w-3.5 animate-spin" />{:else}<Save
					class="h-3.5 w-3.5"
				/>{/if}
			Save {studio.dirtyIds.length || ''}
		</button>
	</div>
</header>

{#if !studio.files.length}
	<div class="glass">
		<EmptyState
			icon={WandSparkles}
			title={studio.loading ? 'Loading files…' : 'No files in the studio'}
		>
			Add tracks from your library, or select rows in the Library Explorer and choose <b
				class="text-violet-glow">Edit tags</b
			>. Changes are staged here and written only when you save.
			<div class="mt-4">
				<button class="btn btn-primary" onclick={() => (picker = true)}
					><Plus class="h-3.5 w-3.5" /> Add files</button
				>
			</div>
		</EmptyState>
	</div>
{:else}
	<div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_360px]">
		<section class="glass min-w-0 overflow-hidden">
			<div class="max-h-[calc(100dvh-190px)] overflow-auto"><TagGrid /></div>
		</section>
		<aside class="glass h-fit overflow-hidden xl:sticky xl:top-3">
			<div class="grid grid-cols-3 gap-1 border-b border-white/5 p-1.5">
				{#each TOOLS as t (t.key)}
					<button
						class="flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10.5px] transition {tool ===
						t.key
							? 'bg-white/[0.07] text-amber-glow'
							: 'text-ink-400 hover:bg-white/[0.03] hover:text-ink-200'}"
						onclick={() => (tool = t.key)}
					>
						<t.icon class="h-4 w-4" />{t.label}
					</button>
				{/each}
			</div>
			<div class="max-h-[calc(100dvh-280px)] overflow-y-auto p-4">
				{#if tool === 'match'}<MatchTool />
				{:else if tool === 'bulk'}<BulkTool />
				{:else if tool === 'replace'}<ReplaceTool />
				{:else if tool === 'filename'}<FilenameTool />
				{:else if tool === 'art'}<ArtLyricsTool />
				{:else}<OrganizeTool template={data.template} />{/if}
			</div>
		</aside>
	</div>
{/if}

{#if picker}
	<FilePicker
		onclose={() => (picker = false)}
		onpick={(ids) => {
			picker = false;
			void studio.add(ids);
		}}
	/>
{/if}
