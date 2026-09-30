<script lang="ts">
	import { goto } from '$app/navigation';
	import { Download, Link2, LoaderCircle, Radio } from '@lucide/svelte';
	import { api } from '$lib/client/api';
	import { toasts } from '$lib/client/toasts.svelte';
	import { FORMAT_PRESETS, POLL_INTERVALS } from '$lib/formats';
	import type { SourceDTO } from '$lib/types';
	import Switch from './Switch.svelte';

	let input = $state('');
	let busy = $state<'download' | 'monitor' | null>(null);
	let format = $state('');
	let top = $state(false);
	let interval = $state(60);
	let autoQueue = $state(true);
	let focused = $state(false);
	let el: HTMLTextAreaElement;

	const lines = $derived(input.split(/[\s,]+/).filter(Boolean).length);
	const looksCollection = $derived(/playlist|album|\/@|\/channel\/|list=/.test(input));
	const showOptions = $derived(focused || input.length > 0);

	async function download() {
		if (!input.trim() || busy) return;
		busy = 'download';
		try {
			const res = await api.post<{ queued: number; invalid: string[]; errors: string[] }>(
				'/api/pipeline/add',
				{
					input,
					formatPreset: format || null,
					top
				}
			);
			toasts.push({
				level: 'success',
				title: `Queued ${res.queued} track${res.queued === 1 ? '' : 's'}`
			});
			for (const e of res.errors)
				toasts.push({ level: 'error', title: 'Could not add', message: e });
			if (res.invalid.length)
				toasts.push({
					level: 'warning',
					title: 'Ignored unrecognized input',
					message: res.invalid.join('\n')
				});
			input = '';
		} finally {
			busy = null;
		}
	}

	async function monitor() {
		if (!input.trim() || busy) return;
		busy = 'monitor';
		try {
			const urls = input.split(/[\s,]+/).filter(Boolean);
			for (const url of urls) {
				const s = await api.post<SourceDTO>('/api/sources', {
					url,
					intervalMinutes: interval,
					autoQueue,
					formatPreset: format || null
				});
				toasts.push({
					level: 'success',
					title: `Monitoring ${s.name}`,
					message: `${s.itemCount} tracks · ${s.missingCount} missing`,
					href: `/sources/${s.id}`
				});
				if (urls.length === 1) goto(`/sources/${s.id}`);
			}
			input = '';
		} finally {
			busy = null;
		}
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			download();
		}
		if (e.key === 'Escape') el.blur();
	}

	function globalKey(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			el.focus();
		}
	}
</script>

<svelte:window onkeydown={globalKey} />

<div class="glass relative p-2 transition {focused ? 'ring-1 ring-amber/30' : ''}">
	<div class="flex items-start gap-2">
		<Link2 class="mt-2 ml-1.5 h-4 w-4 shrink-0 text-ink-400" />
		<textarea
			bind:this={el}
			bind:value={input}
			{onkeydown}
			onfocus={() => (focused = true)}
			onblur={() => (focused = false)}
			rows={Math.min(5, Math.max(1, input.split('\n').length))}
			placeholder="Paste Spotify or YouTube links — tracks, playlists, albums, channels…"
			class="min-h-8 flex-1 resize-none bg-transparent py-1.5 text-[13px] text-ink-50 outline-none placeholder:text-ink-400"
		></textarea>
		<div class="flex shrink-0 items-center gap-1.5">
			{#if !input}<span class="kbd mr-1 hidden sm:inline-flex">⌘K</span>{/if}
			<button
				class="btn btn-violet"
				disabled={!input.trim() || !!busy}
				onclick={monitor}
				title="Watch this playlist/channel for new tracks"
			>
				{#if busy === 'monitor'}<LoaderCircle class="h-3.5 w-3.5 animate-spin" />{:else}<Radio
						class="h-3.5 w-3.5"
					/>{/if}
				<span class="hidden sm:inline">Monitor</span>
			</button>
			<button class="btn btn-primary" disabled={!input.trim() || !!busy} onclick={download}>
				{#if busy === 'download'}<LoaderCircle class="h-3.5 w-3.5 animate-spin" />{:else}<Download
						class="h-3.5 w-3.5"
					/>{/if}
				<span class="hidden sm:inline">Download{lines > 1 ? ` ${lines}` : ''}</span>
			</button>
		</div>
	</div>
	{#if showOptions}
		<!-- mousedown preventDefault keeps focus in the textarea while tweaking options -->
		<div
			role="toolbar"
			tabindex="-1"
			class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/5 px-1.5 pt-2 text-xs text-ink-300"
			onmousedown={(e) => (e.target as HTMLElement).tagName !== 'SELECT' && e.preventDefault()}
		>
			<label class="flex items-center gap-2">
				Format
				<select bind:value={format} class="input !h-7 !w-auto !py-0 !text-xs">
					<option value="">Default</option>
					{#each Object.entries(FORMAT_PRESETS) as [id, p] (id)}<option value={id}>{p.label}</option
						>{/each}
				</select>
			</label>
			<label class="flex items-center gap-2">
				<Switch bind:checked={top} label="Queue at top" /> Queue at top
			</label>
			{#if looksCollection}
				<span class="h-4 w-px bg-white/10"></span>
				<span class="text-violet-glow/80">Monitor:</span>
				<label class="flex items-center gap-2">
					Check
					<select bind:value={interval} class="input !h-7 !w-auto !py-0 !text-xs">
						{#each POLL_INTERVALS as p (p.minutes)}<option value={p.minutes}>{p.label}</option
							>{/each}
					</select>
				</label>
				<label class="flex items-center gap-2"
					><Switch bind:checked={autoQueue} label="Auto-queue new tracks" /> Auto-queue new</label
				>
			{/if}
		</div>
	{/if}
</div>
