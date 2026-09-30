<script lang="ts">
	import { FileText, ImageUp, LoaderCircle } from '@lucide/svelte';
	import { api } from '$lib/client/api';
	import { studio } from '$lib/client/studio.svelte';
	import { toasts } from '$lib/client/toasts.svelte';

	let url = $state('');
	let uploading = $state(false);
	let fetchingLyrics = $state(false);
	let input: HTMLInputElement;

	const missingArt = $derived(
		studio.targets.filter((t) => !t.hasArtwork && !studio.artwork[t.id]).length
	);
	const missingLyrics = $derived(studio.targets.filter((t) => !t.hasLyrics).length);

	function stageUrl() {
		for (const t of studio.targets) studio.artwork[t.id] = url;
		url = '';
	}

	async function upload(file: File) {
		uploading = true;
		try {
			const form = new FormData();
			form.set('image', file);
			form.set('ids', JSON.stringify(studio.targets.map((t) => t.id)));
			const res = await fetch('/api/studio/artwork', { method: 'POST', body: form });
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? 'Upload failed');
			toasts.push({
				level: 'success',
				title: `Artwork written to ${data.count} file${data.count === 1 ? '' : 's'}`
			});
			await studio.reload(studio.targets.map((t) => t.id));
			studio.artVersion++;
		} catch (err) {
			toasts.push({
				level: 'error',
				title: 'Artwork upload failed',
				message: (err as Error).message
			});
		} finally {
			uploading = false;
		}
	}

	async function lyrics() {
		fetchingLyrics = true;
		try {
			const ids = studio.targets.filter((t) => !t.hasLyrics).map((t) => t.id);
			const res = await api.post<{ found: number; total: number }>('/api/studio/lyrics', { ids });
			toasts.push({
				level: 'success',
				title: `Lyrics found for ${res.found} of ${res.total}`,
				message: 'Written directly to the files.'
			});
			await studio.reload(ids);
		} finally {
			fetchingLyrics = false;
		}
	}
</script>

<div class="label">Artwork</div>
<p class="mb-2 text-xs text-ink-400">
	{missingArt} of {studio.targets.length} target files have no cover. Auto-match on the Match tab can
	find covers from the Cover Art Archive.
</p>
<div class="flex gap-2">
	<input class="input !h-8 font-mono !text-xs" placeholder="https://…/cover.jpg" bind:value={url} />
	<button class="btn btn-sm shrink-0" disabled={!/^https?:\/\//.test(url)} onclick={stageUrl}
		>Stage</button
	>
</div>
<input
	bind:this={input}
	type="file"
	accept="image/jpeg,image/png"
	class="hidden"
	onchange={(e) => e.currentTarget.files?.[0] && upload(e.currentTarget.files[0])}
/>
<button
	class="mt-2 flex w-full flex-col items-center gap-1 rounded-lg border border-dashed border-white/10 py-5 text-xs text-ink-400 transition hover:border-amber/40 hover:text-ink-200"
	onclick={() => input.click()}
	ondragover={(e) => e.preventDefault()}
	ondrop={(e) => {
		e.preventDefault();
		const f = e.dataTransfer?.files[0];
		if (f) upload(f);
	}}
	disabled={uploading || !studio.targets.length}
>
	{#if uploading}<LoaderCircle class="h-5 w-5 animate-spin" />{:else}<ImageUp
			class="h-5 w-5"
		/>{/if}
	Drop an image or click to upload — writes immediately to {studio.targets.length} file{studio
		.targets.length === 1
		? ''
		: 's'}
</button>

<div class="mt-5 border-t border-white/5 pt-4">
	<div class="label">Lyrics</div>
	<p class="mb-2 text-xs text-ink-400">
		{missingLyrics} of {studio.targets.length} target files have no embedded lyrics.
	</p>
	<button class="btn btn-sm w-full" onclick={lyrics} disabled={fetchingLyrics || !missingLyrics}>
		{#if fetchingLyrics}<LoaderCircle class="h-3 w-3 animate-spin" />{:else}<FileText
				class="h-3 w-3"
			/>{/if} Fetch from LRCLIB
	</button>
</div>
