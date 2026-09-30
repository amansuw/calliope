<script lang="ts">
	import { AudioLines, Check, LoaderCircle, Search, Sparkles } from '@lucide/svelte';
	import { api } from '$lib/client/api';
	import { duration } from '$lib/client/format';
	import { studio, type StudioFile } from '$lib/client/studio.svelte';
	import { toasts } from '$lib/client/toasts.svelte';

	interface Release {
		id: string;
		title: string;
		date: string | null;
		year: number | null;
		country: string | null;
		status: string | null;
		primaryType: string | null;
		secondaryTypes: string[];
		releaseGroupId: string | null;
		albumArtist: string | null;
		trackNumber: number | null;
		trackCount: number | null;
		discNumber: number | null;
	}
	interface Candidate {
		recordingId: string;
		title: string;
		artist: string;
		artistId: string | null;
		durationMs: number | null;
		score: number;
		releases: Release[];
		source: 'search' | 'acoustid';
	}

	let candidates = $state<Candidate[]>([]);
	let busy = $state<'search' | 'identify' | 'auto' | null>(null);
	let withArt = $state(true);
	let autoProgress = $state({ done: 0, total: 0, matched: 0 });
	let forId = $state<string | null>(null);

	const file = $derived(studio.focused);

	async function search(f: StudioFile) {
		busy = 'search';
		forId = f.id;
		try {
			candidates = await api.post<Candidate[]>('/api/studio/musicbrainz', {
				title: String(studio.value(f, 'title') ?? ''),
				artist: studio.value(f, 'artist') ? String(studio.value(f, 'artist')).split(';')[0] : null,
				album: studio.value(f, 'album') ? String(studio.value(f, 'album')) : null,
				durationMs: f.durationMs
			});
		} finally {
			busy = null;
		}
	}

	async function identify(f: StudioFile) {
		busy = 'identify';
		forId = f.id;
		try {
			candidates = await api.post<Candidate[]>('/api/studio/identify', { id: f.id });
			if (!candidates.length)
				toasts.push({
					level: 'info',
					title: 'No acoustic match',
					message: 'AcoustID has no fingerprint for this recording.'
				});
		} finally {
			busy = null;
		}
	}

	async function apply(f: StudioFile, c: Candidate, r: Release | null) {
		studio.set(f.id, 'title', c.title);
		studio.set(f.id, 'artist', c.artist);
		if (r) {
			studio.set(f.id, 'album', r.title);
			studio.set(f.id, 'albumArtist', r.albumArtist ?? c.artist);
			if (r.year) studio.set(f.id, 'year', r.year);
			if (r.trackNumber) studio.set(f.id, 'trackNumber', r.trackNumber);
			if (r.trackCount) studio.set(f.id, 'trackTotal', r.trackCount);
			if (r.discNumber) studio.set(f.id, 'discNumber', r.discNumber);
		}
		studio.mb[f.id] = {
			recordingId: c.recordingId,
			releaseId: r?.id ?? null,
			artistId: c.artistId,
			label: `${c.artist} — ${r?.title ?? c.title}`
		};
		if (r && withArt && !f.hasArtwork) {
			const { url } = await api
				.post<{ url: string | null }>(
					'/api/studio/coverart',
					{ releaseId: r.id, releaseGroupId: r.releaseGroupId },
					{ quiet: true }
				)
				.catch(() => ({ url: null }));
			if (url) studio.artwork[f.id] = url;
		}
	}

	/** Search each target and stage the top result only when it's unambiguous. */
	async function autoMatch() {
		busy = 'auto';
		const targets = [...studio.targets];
		autoProgress = { done: 0, total: targets.length, matched: 0 };
		try {
			for (const f of targets) {
				const title = String(studio.value(f, 'title') ?? '');
				if (!title) {
					autoProgress.done++;
					continue;
				}
				const list = await api
					.post<Candidate[]>(
						'/api/studio/musicbrainz',
						{
							title,
							artist: studio.value(f, 'artist')
								? String(studio.value(f, 'artist')).split(';')[0]
								: null,
							durationMs: f.durationMs
						},
						{ quiet: true }
					)
					.catch(() => []);
				const top = list[0];
				const durOk =
					!f.durationMs || !top?.durationMs || Math.abs(top.durationMs - f.durationMs) < 7000;
				if (
					top &&
					top.score >= 0.9 &&
					durOk &&
					(list.length === 1 || list[1].score < top.score || list[1].title === top.title)
				) {
					const album = String(studio.value(f, 'album') ?? '').toLowerCase();
					await apply(
						f,
						top,
						top.releases.find((r) => album && r.title.toLowerCase() === album) ??
							top.releases[0] ??
							null
					);
					autoProgress.matched++;
				}
				autoProgress.done++;
			}
			toasts.push({
				level: 'success',
				title: `Auto-matched ${autoProgress.matched} of ${autoProgress.total}`,
				message: 'Review the highlighted cells, then save.'
			});
		} finally {
			busy = null;
		}
	}

	const releaseLabel = (r: Release) =>
		[r.primaryType, ...r.secondaryTypes].filter(Boolean).join(' · ') +
		(r.status && r.status !== 'Official' ? ` · ${r.status}` : '');
</script>

<div class="mb-4 rounded-lg border border-white/6 bg-white/[0.02] p-3">
	<div class="flex items-center justify-between gap-2">
		<div>
			<div class="text-[13px] font-medium text-ink-100">Auto-match</div>
			<div class="text-xs text-ink-400">
				Stage confident MusicBrainz matches for {studio.targets.length} file{studio.targets
					.length === 1
					? ''
					: 's'}.
			</div>
		</div>
		<button
			class="btn btn-violet btn-sm"
			onclick={autoMatch}
			disabled={!!busy || !studio.targets.length}
		>
			{#if busy === 'auto'}<LoaderCircle class="h-3 w-3 animate-spin" />
				{autoProgress.done}/{autoProgress.total}{:else}<Sparkles class="h-3 w-3" /> Run{/if}
		</button>
	</div>
	<label class="mt-2 flex items-center gap-1.5 text-xs text-ink-300">
		<input type="checkbox" class="accent-amber" bind:checked={withArt} /> Also fetch cover art for files
		without it
	</label>
	{#if busy === 'auto'}<p class="mt-1 text-[11px] text-ink-500">
			MusicBrainz allows one request per second — this takes a moment.
		</p>{/if}
</div>

{#if file}
	<div class="label">Focused file</div>
	<div class="mb-2 truncate text-[13px] text-ink-100">
		{studio.value(file, 'artist') ?? '?'} — {studio.value(file, 'title') ?? '?'}
	</div>
	<div class="flex gap-2">
		<button class="btn btn-sm flex-1" onclick={() => search(file)} disabled={!!busy}>
			{#if busy === 'search'}<LoaderCircle class="h-3 w-3 animate-spin" />{:else}<Search
					class="h-3 w-3"
				/>{/if} Search tags
		</button>
		<button
			class="btn btn-sm flex-1"
			onclick={() => identify(file)}
			disabled={!!busy}
			title="Fingerprint the audio with Chromaprint and look it up on AcoustID"
		>
			{#if busy === 'identify'}<LoaderCircle class="h-3 w-3 animate-spin" />{:else}<AudioLines
					class="h-3 w-3"
				/>{/if} Identify audio
		</button>
	</div>

	{#if forId === file.id && candidates.length}
		<div class="mt-3 space-y-2">
			{#each candidates.slice(0, 8) as c (c.recordingId)}
				<div class="rounded-lg border border-white/6 bg-ink-900/60 p-2.5">
					<div class="flex items-start justify-between gap-2">
						<div class="min-w-0">
							<div class="truncate text-[13px] text-ink-50">{c.title}</div>
							<div class="truncate text-xs text-ink-300">{c.artist} · {duration(c.durationMs)}</div>
						</div>
						<span
							class="chip shrink-0 {c.score >= 0.9
								? 'border-ok/30 bg-ok/10 text-ok'
								: 'border-white/10 text-ink-300'}"
						>
							{c.source === 'acoustid' ? 'Audio' : 'Score'}
							{Math.round(c.score * 100)}%
						</span>
					</div>
					<div class="mt-2 space-y-1">
						{#each c.releases.slice(0, 4) as r (r.id)}
							<button
								class="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-white/5"
								onclick={() => apply(file, c, r)}
							>
								<Check class="h-3 w-3 shrink-0 text-ink-500" />
								<span class="min-w-0 flex-1 truncate text-ink-200">{r.title}</span>
								<span class="shrink-0 text-ink-500"
									>{r.year ?? ''}
									{r.country ?? ''} · {releaseLabel(r)}{r.trackNumber
										? ` · #${r.trackNumber}`
										: ''}</span
								>
							</button>
						{:else}
							<button
								class="w-full rounded-md px-2 py-1 text-left text-xs text-ink-300 hover:bg-white/5"
								onclick={() => apply(file, c, null)}>Apply title/artist only</button
							>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{:else if forId === file.id && !busy}
		<p class="mt-3 text-xs text-ink-400">No candidates.</p>
	{/if}
{:else}
	<p class="text-xs text-ink-400">Click a row to look it up.</p>
{/if}
