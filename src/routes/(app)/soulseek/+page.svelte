<script lang="ts">
	import {
		Check,
		Download,
		FolderDown,
		LoaderCircle,
		Search,
		Settings2,
		User,
		Zap
	} from '@lucide/svelte';
	import { onMount, untrack } from 'svelte';
	import { api } from '$lib/client/api';
	import { bytes, duration } from '$lib/client/format';
	import { toasts } from '$lib/client/toasts.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import type { SlskFile, SlskFormat, SlskGroup } from '$lib/soulseek';

	let { data } = $props();

	const ready = $derived(data.status.enabled && data.status.configured);
	const FORMATS: [SlskFormat, string][] = [
		['flac', 'FLAC only'],
		['lossless', 'Any lossless'],
		['any', 'Any format']
	];
	const COLLAPSED = 8;

	let query = $state(untrack(() => data.q));
	let format = $state<SlskFormat>('flac');
	let freeOnly = $state(false);
	let searching = $state(false);
	let searched = $state<string | null>(null);
	let groups = $state<SlskGroup[]>([]);
	let total = $state(0);
	let error = $state<string | null>(null);
	let expanded = $state<Record<string, boolean>>({});
	/** Files already sent to the pipeline from this page */
	let queued = $state<Record<string, boolean>>({});

	const fileKey = (f: SlskFile) => `${f.user}\u0000${f.file}`;
	const shown = $derived(freeOnly ? groups.filter((g) => g.freeSlot) : groups);
	const shownFiles = $derived(shown.reduce((n, g) => n + g.files.length, 0));

	const quality = (f: SlskFile) =>
		f.lossless
			? `${f.ext.toUpperCase()}${f.bitDepth && f.sampleRate ? ` ${f.bitDepth}/${f.sampleRate / 1000}` : ''}`
			: `${f.ext.toUpperCase()}${f.bitrate ? ` ${f.bitrate}k` : ''}`;

	async function search() {
		const q = query.trim();
		if (q.length < 2 || searching) return;
		searching = true;
		error = null;
		try {
			const res = await api.post<{ groups: SlskGroup[]; total: number }>(
				'/api/soulseek/search',
				{ query: q, format },
				{ quiet: true }
			);
			groups = res.groups;
			total = res.total;
			expanded = {};
			searched = q;
		} catch (err) {
			error = (err as Error).message;
		} finally {
			searching = false;
		}
	}

	async function download(files: SlskFile[]) {
		const fresh = files.filter((f) => !queued[fileKey(f)]);
		if (!fresh.length) return;
		for (const f of fresh) queued[fileKey(f)] = true;
		try {
			const res = await api.post<{ queued: number; alreadyQueued: number }>(
				'/api/soulseek/download',
				{
					files: fresh.map((f) => ({
						user: f.user,
						file: f.file,
						size: f.size,
						durationSec: f.durationSec
					}))
				}
			);
			toasts.push({
				level: 'success',
				title: res.queued
					? `Queued ${res.queued} file${res.queued === 1 ? '' : 's'}`
					: 'Already in the queue',
				message: 'Follow the transfer in the Pipeline.',
				href: '/pipeline'
			});
		} catch {
			for (const f of fresh) delete queued[fileKey(f)];
		}
	}

	onMount(() => {
		if (ready && query.trim().length >= 2) void search();
	});
</script>

<svelte:head><title>Soulseek · Calliope</title></svelte:head>

<header class="flex flex-wrap items-end justify-between gap-3 pt-6 pb-4">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight text-ink-50">Soulseek</h1>
		<p class="mt-1 text-sm text-ink-400">
			{#if ready}
				Search what other users share and download files in their original format · signed in as
				<span class="text-ink-200">{data.status.username}</span>
			{:else}
				Search what other users share and download files in their original format.
			{/if}
		</p>
	</div>
	<a class="btn btn-ghost" href="/settings/integrations"
		><Settings2 class="h-3.5 w-3.5" /> Settings</a
	>
</header>

{#if !ready}
	<div class="glass">
		<EmptyState icon={Search} title="Soulseek isn't set up yet">
			Add a Soulseek username and password under Settings › Integrations and turn it on. Use an
			account that no other Soulseek app is signed in to.
			<div class="mt-4">
				<a class="btn btn-primary" href="/settings/integrations"
					><Settings2 class="h-3.5 w-3.5" /> Open settings</a
				>
			</div>
		</EmptyState>
	</div>
{:else}
	<form
		class="glass flex flex-wrap items-center gap-2 p-3"
		onsubmit={(e) => {
			e.preventDefault();
			void search();
		}}
	>
		<div class="relative min-w-56 flex-1">
			<Search class="pointer-events-none absolute top-2.5 left-3 h-3.5 w-3.5 text-ink-400" />
			<input
				class="input pl-9"
				placeholder="Artist and album or track, e.g. gorillaz cracker island"
				bind:value={query}
			/>
		</div>
		<div class="flex gap-1 text-xs">
			{#each FORMATS as [key, label] (key)}
				<button
					type="button"
					class="rounded-full border px-3 py-1 transition {format === key
						? 'border-amber/40 bg-amber/10 text-amber-glow'
						: 'border-white/8 text-ink-300 hover:text-ink-100'}"
					onclick={() => (format = key)}>{label}</button
				>
			{/each}
		</div>
		<button class="btn btn-primary" disabled={searching || query.trim().length < 2}>
			{#if searching}<LoaderCircle class="h-3.5 w-3.5 animate-spin" />{:else}<Search
					class="h-3.5 w-3.5"
				/>{/if} Search
		</button>
	</form>

	{#if searching}
		<p class="mt-4 flex items-center gap-2 text-xs text-ink-400">
			<LoaderCircle class="h-3 w-3 animate-spin" /> Collecting answers from peers — this takes about ten
			seconds.
		</p>
	{/if}
	{#if error}<p class="mt-4 text-sm text-bad">{error}</p>{/if}

	{#if searched !== null && !searching}
		<div class="mt-4 mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-400">
			<span>
				{shownFiles.toLocaleString()} file{shownFiles === 1 ? '' : 's'} in {shown.length} folder{shown.length ===
				1
					? ''
					: 's'} for “{searched}”{total ? ` · ${total.toLocaleString()} raw results` : ''}
			</span>
			<label class="flex items-center gap-1.5 text-ink-300">
				<input type="checkbox" class="accent-amber" bind:checked={freeOnly} /> Only peers that can send
				now
			</label>
		</div>

		{#if !shown.length}
			<div class="glass">
				<EmptyState icon={Search} title="Nothing found">
					{groups.length
						? 'Every match is on a peer with a queue. Untick the filter to see them.'
						: 'Try fewer words, a different spelling, or a wider format filter. Results also depend on who is online right now.'}
				</EmptyState>
			</div>
		{/if}

		<div class="space-y-3">
			{#each shown as g (g.key)}
				{@const open = expanded[g.key] || g.files.length <= COLLAPSED}
				{@const allQueued = g.files.every((f) => queued[fileKey(f)])}
				<section class="glass overflow-hidden">
					<div
						class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/5 px-4 py-3"
					>
						<div class="min-w-0 flex-1">
							<div class="truncate text-[13px] font-medium text-ink-50" title={g.dir}>
								{g.label}
							</div>
							<div class="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-400">
								<span class="flex items-center gap-1"><User class="h-3 w-3" />{g.user}</span>
								<span
									>{g.files.length} file{g.files.length === 1 ? '' : 's'} · {bytes(
										g.totalSize
									)}</span
								>
								{#if g.speed > 0}<span>{bytes(g.speed, 0)}/s</span>{/if}
							</div>
						</div>
						{#if g.freeSlot}
							<span class="chip border-ok/30 bg-ok/5 text-ok"
								><Zap class="h-3 w-3" /> Free slot</span
							>
						{:else}
							<span
								class="chip border-warn/30 bg-warn/10 text-warn"
								title="This peer is busy: downloads wait in its queue"
								>Queue{g.queueLength ? ` ${g.queueLength}` : ''}</span
							>
						{/if}
						<button class="btn btn-sm" onclick={() => download(g.files)} disabled={allQueued}>
							{#if allQueued}<Check class="h-3 w-3" /> Queued{:else}<FolderDown class="h-3 w-3" />
								Download {g.files.length === 1 ? 'file' : `all ${g.files.length}`}{/if}
						</button>
					</div>
					<table class="w-full table-fixed text-xs">
						<tbody>
							{#each open ? g.files : g.files.slice(0, COLLAPSED) as f (f.file)}
								{@const done = queued[fileKey(f)]}
								<tr class="border-t border-white/[0.04] first:border-t-0">
									<td class="truncate py-1.5 pr-2 pl-4 text-ink-100" title={f.file}>{f.name}</td>
									<td class="w-28 px-2 py-1.5 font-mono text-[11px] text-ink-300"
										><span class={f.lossless ? 'text-ok' : ''}>{quality(f)}</span></td
									>
									<td class="w-14 px-2 py-1.5 text-right font-mono text-[11px] text-ink-400"
										>{f.durationSec ? duration(f.durationSec * 1000) : ''}</td
									>
									<td class="w-20 px-2 py-1.5 text-right font-mono text-[11px] text-ink-400"
										>{bytes(f.size)}</td
									>
									<td class="w-12 py-1 pr-3 text-right">
										<button
											class="btn btn-ghost btn-icon btn-sm"
											title={done ? 'Queued' : 'Download this file'}
											aria-label={done ? 'Queued' : `Download ${f.name}`}
											disabled={done}
											onclick={() => download([f])}
										>
											{#if done}<Check class="h-3.5 w-3.5 text-ok" />{:else}<Download
													class="h-3.5 w-3.5"
												/>{/if}
										</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
					{#if !open}
						<button
							class="w-full border-t border-white/[0.04] py-2 text-[11px] text-ink-400 hover:text-ink-200"
							onclick={() => (expanded[g.key] = true)}
						>
							Show all {g.files.length} files
						</button>
					{/if}
				</section>
			{/each}
		</div>
	{/if}
{/if}
