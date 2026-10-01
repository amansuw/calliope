<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { untrack } from 'svelte';
	import {
		CircleAlert,
		CircleCheck,
		Cpu,
		Download,
		FolderTree,
		KeyRound,
		LoaderCircle,
		Plug,
		RefreshCw,
		Save,
		SlidersHorizontal,
		Terminal
	} from '@lucide/svelte';
	import { api } from '$lib/client/api';
	import { toasts } from '$lib/client/toasts.svelte';
	import { FORMAT_PRESETS } from '$lib/formats';
	import Field from '$lib/components/settings/Field.svelte';
	import Section from '$lib/components/settings/Section.svelte';
	import Switch from '$lib/components/Switch.svelte';
	import type { BinaryStatus } from '$lib/types';

	let { data } = $props();

	type S = typeof data.settings;
	let draft = $state<S>(untrack(() => structuredClone(data.settings)));
	let saved = $state(untrack(() => JSON.stringify(data.settings)));
	$effect.pre(() => {
		draft = structuredClone(data.settings);
		saved = JSON.stringify(data.settings);
	});
	const dirty = $derived(JSON.stringify(draft) !== saved);
	let saving = $state(false);

	const NAV = [
		{ key: 'library', label: 'Library & paths', icon: FolderTree },
		{ key: 'pipeline', label: 'Pipeline & format', icon: SlidersHorizontal },
		{ key: 'downloader', label: 'yt-dlp flags', icon: Terminal },
		{ key: 'binaries', label: 'Binaries', icon: Cpu },
		{ key: 'integrations', label: 'Integrations', icon: Plug },
		{ key: 'account', label: 'Account & data', icon: KeyRound }
	];

	async function save() {
		saving = true;
		try {
			const next = await api.patch<S>('/api/settings', draft);
			draft = structuredClone(next);
			saved = JSON.stringify(next);
			toasts.push({ level: 'success', title: 'Settings saved' });
			invalidateAll();
		} finally {
			saving = false;
		}
	}

	// --- live previews -------------------------------------------------------------
	let preview = $state<{ flags: string[]; rejected: string[]; paths: string[] } | null>(null);
	let previewTimer: ReturnType<typeof setTimeout>;
	$effect(() => {
		const template = draft.pipeline.pathTemplate;
		const preset = draft.pipeline.formatPreset;
		clearTimeout(previewTimer);
		previewTimer = setTimeout(async () => {
			preview = await api.get(
				`/api/settings/preview?template=${encodeURIComponent(template)}&preset=${preset}`,
				{ quiet: true }
			);
		}, 250);
	});

	// --- binaries -------------------------------------------------------------------
	let binaries = $state<BinaryStatus[]>([]);
	$effect.pre(() => {
		binaries = data.binaries;
	});
	let refreshing = $state(false);
	let updating = $state(false);
	let updateOutput = $state('');
	async function updateYtdlp() {
		updating = true;
		try {
			const res = await api.post<{ ok: boolean; output: string; statuses: BinaryStatus[] }>(
				'/api/settings/binaries/update'
			);
			binaries = res.statuses;
			updateOutput = res.output;
			toasts.push({
				level: res.ok ? 'success' : 'warning',
				title: res.ok ? 'yt-dlp is up to date' : 'Update did not complete',
				message: res.output.split('\n').at(-1)
			});
		} finally {
			updating = false;
		}
	}
	/** yt-dlp versions are dates; YouTube tends to break anything older than a couple of months. */
	function ytdlpAgeDays(version: string | null) {
		const m = version?.match(/^(\d{4})\.(\d{2})\.(\d{2})/);
		return m ? Math.floor((Date.now() - Date.UTC(+m[1], +m[2] - 1, +m[3])) / 86_400_000) : null;
	}
	async function refreshBinaries() {
		refreshing = true;
		try {
			binaries = await api.get<BinaryStatus[]>('/api/settings/binaries?refresh');
		} finally {
			refreshing = false;
		}
	}

	// --- integration tests ------------------------------------------------------------
	let testing = $state<string | null>(null);
	let testResult = $state<Record<string, { ok: boolean; message: string }>>({});
	async function test(target: 'spotify' | 'navidrome' | 'discord' | 'soulseek') {
		if (dirty) await save();
		testing = target;
		try {
			const res = await api.post<{ message: string }>(
				'/api/settings/test',
				{ target },
				{ quiet: true }
			);
			testResult[target] = { ok: true, message: res.message };
		} catch (err) {
			testResult[target] = { ok: false, message: (err as Error).message };
		} finally {
			testing = null;
		}
	}

	// --- account ------------------------------------------------------------------------
	let pw = $state({ current: '', next: '', confirm: '' });
	async function changePassword() {
		if (pw.next !== pw.confirm)
			return toasts.push({ level: 'error', title: 'Passwords do not match' });
		await api.post('/api/auth/password', { current: pw.current, next: pw.next });
		pw = { current: '', next: '', confirm: '' };
		toasts.push({
			level: 'success',
			title: 'Password changed',
			message: 'Other sessions were signed out.'
		});
	}

	let legacyPath = $state('');
	$effect.pre(() => {
		legacyPath = data.legacyDb ?? '';
	});
	let importing = $state(false);
	async function runImport() {
		importing = true;
		try {
			const r = await api.post<{ sources: number; skippedSources: number; tracks: number }>(
				'/api/settings/import',
				{ path: legacyPath }
			);
			toasts.push({
				level: 'success',
				title: 'Import complete',
				message: `${r.sources} sources (${r.skippedSources} skipped), ${r.tracks} download records`
			});
		} finally {
			importing = false;
		}
	}

	const SPONSOR_CATEGORIES = [
		['music_offtopic', 'Non-music section'],
		['intro', 'Intro'],
		['outro', 'Outro'],
		['sponsor', 'Sponsor'],
		['selfpromo', 'Self-promotion'],
		['interaction', 'Interaction reminder'],
		['preview', 'Preview/recap']
	] as const;

	function toggleCategory(cat: string) {
		const cats = draft.ytdlp.sponsorblockCategories;
		draft.ytdlp.sponsorblockCategories = cats.includes(cat)
			? cats.filter((c: string) => c !== cat)
			: [...cats, cat];
	}

	const pathKeys = [
		[
			'libraryDir',
			'Music library',
			'Where finished tracks are filed and what the Library Explorer indexes.'
		],
		[
			'stagingDir',
			'Staging',
			'Scratch space for in-progress downloads. Put it on a fast local disk.'
		],
		[
			'quarantineDir',
			'Quarantine',
			'Duplicates you remove are moved here instead of being deleted.'
		]
	] as const;
</script>

<svelte:head><title>Settings · Calliope</title></svelte:head>

<header class="flex items-end justify-between gap-3 pt-6 pb-4">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight text-ink-50">Settings</h1>
		<p class="mt-1 text-sm text-ink-400">Pipeline configuration, folder rules and integrations.</p>
	</div>
</header>

<div class="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
	<nav class="flex gap-1 overflow-x-auto lg:sticky lg:top-3 lg:h-fit lg:flex-col">
		{#each NAV as n (n.key)}
			<a
				href="/settings/{n.key}"
				class="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-[13px] transition
				{data.section === n.key
					? 'bg-white/[0.07] text-ink-50'
					: 'text-ink-300 hover:bg-white/[0.04] hover:text-ink-100'}"
			>
				<n.icon class="h-4 w-4 {data.section === n.key ? 'text-amber' : 'text-ink-400'}" />
				{n.label}
			</a>
		{/each}
	</nav>

	<div class="min-w-0 space-y-4 pb-20">
		{#if data.section === 'library'}
			<Section
				title="Folders"
				description="Paths as seen by the Calliope process (inside the container when using Docker)."
			>
				{#each pathKeys as [key, label, hint] (key)}
					{@const check = data.pathChecks?.[key]}
					<Field {label} {hint}>
						<div class="flex items-center gap-2">
							<input class="input font-mono" bind:value={draft.paths[key]} />
							{#if check && draft.paths[key] === data.settings.paths[key]}
								<span
									class="chip shrink-0 {check.ok
										? 'border-ok/30 bg-ok/10 text-ok'
										: 'border-bad/30 bg-bad/10 text-bad'}"
									title={check.message}
								>
									{check.ok ? (check.exists ? 'OK' : 'New') : 'Error'}
								</span>
							{/if}
						</div>
					</Field>
				{/each}
			</Section>

			<Section
				title="Organization"
				description="How new downloads are laid out inside the library folder."
			>
				<Field
					label="Folder & filename template"
					hint="Fields: {'{artist} {albumartist} {album} {title} {track} {disc} {year} {genre}'}. Use | for fallbacks, :02 to pad, and [ ] for optional parts."
				>
					<input class="input font-mono" bind:value={draft.pipeline.pathTemplate} />
					{#if preview}
						<div class="mt-2 space-y-1 rounded-lg border border-white/5 bg-ink-950/60 p-2.5">
							{#each preview.paths as p (p)}<div
									class="truncate font-mono text-[11px] text-amber-glow/90"
								>
									{p}
								</div>{/each}
						</div>
					{/if}
				</Field>
			</Section>

			<Section title="Library scanning">
				<Field row label="Scan on startup" hint="Index new and changed files when Calliope starts.">
					<Switch bind:checked={draft.library.scanOnStartup} label="Scan on startup" />
				</Field>
				<Field row label="Rescan interval" hint="Pick up files added outside Calliope. 0 disables.">
					<div class="flex items-center gap-2">
						<input
							type="number"
							min="0"
							step="30"
							class="input !w-24 text-right font-mono"
							bind:value={draft.library.rescanIntervalMinutes}
						/>
						<span class="text-xs text-ink-400">min</span>
					</div>
				</Field>
				<Field
					row
					label="Loudness-normalized playback"
					hint="Player evens out volume between tracks using measured loudness."
				>
					<Switch bind:checked={draft.library.normalizePlayback} label="Normalize playback" />
				</Field>
			</Section>
		{:else if data.section === 'pipeline'}
			<Section
				title="Output format"
				description="Applied to new downloads. Sources and one-off downloads can override it."
			>
				<div class="grid gap-2 py-3.5 sm:grid-cols-2 xl:grid-cols-3">
					{#each Object.entries(FORMAT_PRESETS) as [id, p] (id)}
						<button
							class="rounded-xl border p-3 text-left transition {draft.pipeline.formatPreset === id
								? 'border-amber/50 bg-amber/10 shadow-[0_0_24px_-10px_rgb(245_165_36/0.8)]'
								: 'border-white/8 bg-white/[0.02] hover:border-white/15'}"
							onclick={() =>
								(draft.pipeline.formatPreset = id as typeof draft.pipeline.formatPreset)}
						>
							<div
								class="text-sm font-semibold {draft.pipeline.formatPreset === id
									? 'text-amber-glow'
									: 'text-ink-100'}"
							>
								{p.label}
							</div>
							<div class="mt-0.5 text-xs text-ink-400">{p.detail}</div>
						</button>
					{/each}
				</div>
				{#if data.formatOverrides.length}
					<p class="pb-3 text-xs text-warn/90">
						{data.formatOverrides.length === 1 ? 'This source uses' : 'These sources use'} their own format
						instead of this one:
						{#each data.formatOverrides as s, i (s.id)}{i ? ', ' : ''}<a
								class="underline hover:text-warn"
								href="/sources/{s.id}"
								>{s.name} ({FORMAT_PRESETS[s.formatPreset as keyof typeof FORMAT_PRESETS]?.label ??
									s.formatPreset})</a
							>{/each}. Set a source's format to Default to follow this setting.
					</p>
				{/if}
				{#if draft.soulseek.enabled && draft.pipeline.preferredSource === 'soulseek'}
					<p class="pb-3 text-xs text-ink-300">
						Files found on Soulseek keep their own lossless format whatever is chosen here. This
						format is used for tracks that fall back to YouTube{draft.pipeline.formatPreset ===
						'flac'
							? ', whose audio is lossy — FLAC only makes those files larger'
							: ''}.
					</p>
				{:else if draft.pipeline.formatPreset === 'flac'}
					<p class="pb-3 text-xs text-warn/90">
						YouTube audio is lossy (Opus/AAC ~128–160 kbps). FLAC preserves it exactly but can't add
						quality back — files are just larger. For real lossless files, enable Soulseek and make
						it the preferred source below.
					</p>
				{/if}
			</Section>

			<Section title="Workers & matching">
				<Field
					row
					label="Parallel downloads"
					hint="Worker slots. 2–3 is a good balance against YouTube throttling."
				>
					<div class="flex items-center gap-3">
						<input
							type="range"
							min="1"
							max="8"
							class="w-32 accent-amber"
							bind:value={draft.pipeline.concurrency}
						/>
						<span class="w-4 font-mono text-sm text-amber-glow">{draft.pipeline.concurrency}</span>
					</div>
				</Field>
				<Field
					row
					label="Preferred source"
					hint={draft.pipeline.preferredSource === 'soulseek'
						? draft.soulseek.enabled
							? 'Look for a real lossless (FLAC) copy on Soulseek first. Tracks it cannot find come from YouTube in the output format above.'
							: 'Soulseek is turned off under Integrations, so tracks come from YouTube until it is enabled.'
						: `${
								draft.pipeline.preferredSource === 'ytmusic'
									? 'Take the top YouTube Music song result first — usually the official audio.'
									: 'Use plain YouTube search only.'
							}${draft.soulseek.enabled ? ' Tracks YouTube cannot deliver are looked up on Soulseek.' : ''}`}
				>
					<select class="input !w-44" bind:value={draft.pipeline.preferredSource}>
						<option value="soulseek"
							>Soulseek{draft.soulseek.enabled ? '' : ' (not enabled)'}</option
						>
						<option value="ytmusic">YouTube Music</option>
						<option value="youtube">YouTube search</option>
					</select>
				</Field>
				<Field
					row
					label="Enrich from MusicBrainz"
					hint="Look up the studio album, track numbers, original year, genres and album cover art for each download. YouTube uploads otherwise only carry the video's thumbnail."
				>
					<Switch bind:checked={draft.pipeline.enrichMusicBrainz} label="Enrich from MusicBrainz" />
				</Field>
				<Field
					row
					label="Skip tracks already in the library"
					hint="Matches by artist + title against the library index."
				>
					<Switch bind:checked={draft.pipeline.skipExisting} label="Skip existing" />
				</Field>
				<Field
					row
					label="Low-confidence threshold"
					hint="Matches below this still download but are flagged “Check match”."
				>
					<div class="flex items-center gap-3">
						<input
							type="range"
							min="0"
							max="1"
							step="0.05"
							class="w-32 accent-amber"
							bind:value={draft.pipeline.lowConfidenceScore}
						/>
						<span class="w-9 font-mono text-sm"
							>{Math.round(draft.pipeline.lowConfidenceScore * 100)}%</span
						>
					</div>
				</Field>
				<Field
					row
					label="Reject threshold"
					hint="Matches below this fail instead of downloading a probably-wrong song."
				>
					<div class="flex items-center gap-3">
						<input
							type="range"
							min="0"
							max="1"
							step="0.05"
							class="w-32 accent-amber"
							bind:value={draft.pipeline.rejectScore}
						/>
						<span class="w-9 font-mono text-sm"
							>{Math.round(draft.pipeline.rejectScore * 100)}%</span
						>
					</div>
				</Field>
				<Field
					row
					label="Attempts per track"
					hint="Transient failures retry with exponential backoff."
				>
					<input
						type="number"
						min="1"
						max="10"
						class="input !w-20 text-right font-mono"
						bind:value={draft.pipeline.maxAttempts}
					/>
				</Field>
			</Section>

			<Section title="Lyrics" description="Fetched from LRCLIB and embedded in the file.">
				<Field row label="Fetch lyrics"
					><Switch bind:checked={draft.lyrics.enabled} label="Fetch lyrics" /></Field
				>
				<Field
					row
					label="Prefer synced (LRC) lyrics"
					hint="Timestamped lyrics for players that support karaoke-style display."
				>
					<Switch bind:checked={draft.lyrics.preferSynced} label="Prefer synced" />
				</Field>
				<Field row label="Also write .lrc sidecar files"
					><Switch bind:checked={draft.lyrics.writeLrcFile} label="Write LRC" /></Field
				>
			</Section>
		{:else if data.section === 'downloader'}
			<Section
				title="SponsorBlock"
				description="Cut non-music segments out of music videos using community timestamps."
			>
				<Field row label="Remove segments"
					><Switch bind:checked={draft.ytdlp.sponsorblock} label="SponsorBlock" /></Field
				>
				{#if draft.ytdlp.sponsorblock}
					<div class="flex flex-wrap gap-1.5 py-3.5">
						{#each SPONSOR_CATEGORIES as [cat, label] (cat)}
							{@const on = draft.ytdlp.sponsorblockCategories.includes(cat)}
							<button
								class="rounded-full border px-2.5 py-1 text-xs transition {on
									? 'border-violet/50 bg-violet/15 text-violet-glow'
									: 'border-white/8 text-ink-400 hover:text-ink-200'}"
								onclick={() => toggleCategory(cat)}>{label}</button
							>
						{/each}
					</div>
				{/if}
			</Section>

			<Section
				title="Authentication"
				description="Needed for age-restricted or members-only uploads, and helps with bot checks."
			>
				<Field
					label="Cookies file"
					hint="Netscape cookies.txt export. Copied per run, so a read-only mount is fine."
				>
					<input
						class="input font-mono"
						placeholder="/config/cookies.txt"
						bind:value={draft.ytdlp.cookiesFile}
					/>
				</Field>
				<Field
					label="…or cookies from browser"
					hint="Only works when Calliope runs on the same machine as the browser."
				>
					<select class="input" bind:value={draft.ytdlp.cookiesFromBrowser}>
						<option value="">None</option>
						{#each ['firefox', 'chrome', 'chromium', 'brave', 'edge', 'safari', 'vivaldi', 'opera'] as b (b)}<option
								value={b}>{b}</option
							>{/each}
					</select>
				</Field>
			</Section>

			<Section title="Network">
				<Field row label="Rate limit" hint="e.g. 2M or 500K. Empty for unlimited.">
					<input
						class="input !w-28 font-mono"
						placeholder="unlimited"
						bind:value={draft.ytdlp.rateLimit}
					/>
				</Field>
				<Field row label="Concurrent fragments" hint="Parallel chunk downloads per track.">
					<input
						type="number"
						min="1"
						max="16"
						class="input !w-20 text-right font-mono"
						bind:value={draft.ytdlp.concurrentFragments}
					/>
				</Field>
				<Field
					label="Extra flags"
					hint="Appended verbatim. Output, exec and extraction flags are controlled by Calliope and ignored here."
				>
					<input
						class="input font-mono"
						placeholder="--geo-bypass --force-ipv4"
						bind:value={draft.ytdlp.extraArgs}
					/>
				</Field>
			</Section>

			<Section
				title="Command preview"
				description="What the pipeline runs for each track (cookies and output path omitted). Save to refresh."
			>
				<div class="py-3.5">
					<pre
						class="overflow-x-auto rounded-lg border border-white/5 bg-ink-950/80 p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-ink-200"><span
							class="text-violet-glow">yt-dlp</span
						> {#each preview?.flags ?? [] as f, i (i)}<span
								class={f.startsWith('-') ? 'text-amber-glow' : 'text-ink-200'}>{f}</span
							>{' '}{/each}<span class="text-ink-500"
							>-o &lt;staging&gt;/&lt;id&gt;.%(ext)s &lt;url&gt;</span
						></pre>
					{#if preview?.rejected.length}
						<p class="mt-2 flex items-center gap-1.5 text-xs text-warn">
							<CircleAlert class="h-3.5 w-3.5" /> Ignored flags: {preview.rejected.join(' ')}
						</p>
					{/if}
				</div>
			</Section>
		{:else if data.section === 'binaries'}
			<Section
				title="External tools"
				description="Resolved from PATH unless overridden. The Docker image ships all of them."
			>
				{#snippet actions()}
					<button class="btn btn-sm" onclick={refreshBinaries} disabled={refreshing}>
						<RefreshCw class="h-3 w-3 {refreshing ? 'animate-spin' : ''}" /> Re-check
					</button>
				{/snippet}
				{#each binaries as b (b.name)}
					<div class="py-4">
						<div class="flex items-center gap-2">
							{#if b.error}
								<CircleAlert class="h-4 w-4 {b.required ? 'text-bad' : 'text-warn'}" />
							{:else}
								<CircleCheck class="h-4 w-4 text-ok" />
							{/if}
							<span class="text-[13px] font-medium text-ink-100">{b.label}</span>
							{#if !b.required}<span class="chip border-white/8 text-ink-400">optional</span>{/if}
							<span class="ml-auto font-mono text-xs {b.error ? 'text-bad' : 'text-ink-300'}"
								>{b.error ?? b.version}</span
							>
						</div>
						<div class="mt-2 flex items-center gap-2 pl-6">
							<input
								class="input font-mono !text-xs"
								placeholder={b.path ?? `auto (${b.name})`}
								bind:value={draft.binaries[b.name]}
							/>
						</div>
						{#if b.name === 'ytdlp' && !b.error}
							{@const age = ytdlpAgeDays(b.version)}
							<div class="mt-2 flex flex-wrap items-center gap-3 pl-6">
								<button class="btn btn-sm" onclick={updateYtdlp} disabled={updating}>
									{#if updating}<LoaderCircle class="h-3 w-3 animate-spin" />{:else}<RefreshCw
											class="h-3 w-3"
										/>{/if} Update yt-dlp
								</button>
								{#if age !== null && age > 60}
									<span class="text-xs text-warn"
										>{age} days old — YouTube downloads often fail (HTTP 403) on outdated versions.</span
									>
								{/if}
							</div>
							{#if updateOutput}<pre
									class="mt-2 ml-6 max-h-32 overflow-auto rounded-lg bg-ink-950/80 p-2 font-mono text-[11px] text-ink-300">{updateOutput}</pre>{/if}
						{/if}
						{#if b.name === 'fpcalc'}
							<p class="hint pl-6">
								Enables acoustic fingerprint matching for duplicates and MusicBrainz lookups.
							</p>
						{/if}
					</div>
				{/each}
			</Section>
		{:else if data.section === 'integrations'}
			<Section
				title="Spotify Web API"
				description="Optional. Public playlists are read in full without it. With credentials, album and track lookups gain album names, track numbers and release dates."
			>
				{#snippet actions()}
					<button
						class="btn btn-sm"
						onclick={() => test('spotify')}
						disabled={testing === 'spotify' || !draft.spotify.clientId}
					>
						{#if testing === 'spotify'}<LoaderCircle class="h-3 w-3 animate-spin" />{/if} Test
					</button>
				{/snippet}
				<Field label="Client ID"
					><input class="input font-mono" bind:value={draft.spotify.clientId} /></Field
				>
				<Field label="Client secret"
					><input
						class="input font-mono"
						type="password"
						bind:value={draft.spotify.clientSecret}
					/></Field
				>
				{#if testResult.spotify}<p
						class="py-2 text-xs {testResult.spotify.ok ? 'text-ok' : 'text-bad'}"
					>
						{testResult.spotify.message}
					</p>{/if}
			</Section>

			<Section
				title="Navidrome"
				description="Trigger a library rescan shortly after downloads finish."
			>
				{#snippet actions()}
					<button
						class="btn btn-sm"
						onclick={() => test('navidrome')}
						disabled={testing === 'navidrome' || !draft.navidrome.url}
					>
						{#if testing === 'navidrome'}<LoaderCircle class="h-3 w-3 animate-spin" />{/if} Test
					</button>
				{/snippet}
				<Field row label="Enabled"
					><Switch bind:checked={draft.navidrome.enabled} label="Navidrome" /></Field
				>
				<Field label="Server URL"
					><input
						class="input font-mono"
						placeholder="http://navidrome:4533"
						bind:value={draft.navidrome.url}
					/></Field
				>
				<div class="grid gap-x-4 sm:grid-cols-2">
					<Field label="User"><input class="input" bind:value={draft.navidrome.user} /></Field>
					<Field label="Password"
						><input class="input" type="password" bind:value={draft.navidrome.password} /></Field
					>
				</div>
				{#if testResult.navidrome}<p
						class="py-2 text-xs {testResult.navidrome.ok ? 'text-ok' : 'text-bad'}"
					>
						{testResult.navidrome.message}
					</p>{/if}
			</Section>

			<Section
				title="Soulseek"
				description="Search the Soulseek network and download files in their original format, such as real FLAC. Calliope signs in with its own built-in client, so use an account no other Soulseek app is signed in to — one account can only be online in one place."
			>
				{#snippet actions()}
					<button
						class="btn btn-sm"
						onclick={() => test('soulseek')}
						disabled={testing === 'soulseek' || !draft.soulseek.enabled || !draft.soulseek.username}
					>
						{#if testing === 'soulseek'}<LoaderCircle class="h-3 w-3 animate-spin" />{/if} Test
					</button>
				{/snippet}
				<Field row label="Enabled"
					><Switch bind:checked={draft.soulseek.enabled} label="Soulseek" /></Field
				>
				<div class="grid gap-x-4 sm:grid-cols-2">
					<Field label="Username"
						><input class="input" autocomplete="off" bind:value={draft.soulseek.username} /></Field
					>
					<Field label="Password"
						><input
							class="input"
							type="password"
							autocomplete="new-password"
							bind:value={draft.soulseek.password}
						/></Field
					>
				</div>
				<Field
					row
					label="Listening port"
					hint="Other users connect here to answer searches and send files. Works without it, but forwarding this TCP port on your router (and publishing it in Docker) gives more results."
				>
					<input
						type="number"
						min="1024"
						max="65535"
						class="input !w-24 text-right font-mono"
						bind:value={draft.soulseek.listenPort}
					/>
				</Field>
				<Field
					row
					label="Wait for a queued download"
					hint="Busy peers put you in a queue. After this long without the transfer starting, the download is dropped and retried later."
				>
					<div class="flex items-center gap-2">
						<input
							type="number"
							min="1"
							max="720"
							class="input !w-20 text-right font-mono"
							bind:value={draft.soulseek.queueTimeoutMinutes}
						/>
						<span class="text-xs text-ink-400">min</span>
					</div>
				</Field>
				<Field
					row
					label="Prefer hi-res"
					hint="When several peers share the same track, take a 24-bit or high sample rate copy over the CD rip. Most music only exists in CD quality (16-bit / 44.1 kHz), and hi-res files are several times larger."
				>
					<Switch bind:checked={draft.soulseek.preferHiRes} label="Prefer hi-res" />
				</Field>
				{#if testResult.soulseek}<p
						class="py-2 text-xs {testResult.soulseek.ok ? 'text-ok' : 'text-bad'}"
					>
						{testResult.soulseek.message}
					</p>{/if}
			</Section>

			<Section
				title="Discord"
				description="Batch summaries of completed downloads, new tracks found by monitors, and failures."
			>
				{#snippet actions()}
					<button
						class="btn btn-sm"
						onclick={() => test('discord')}
						disabled={testing === 'discord'}
					>
						{#if testing === 'discord'}<LoaderCircle class="h-3 w-3 animate-spin" />{/if} Send test
					</button>
				{/snippet}
				<Field row label="Enabled"
					><Switch bind:checked={draft.discord.enabled} label="Discord" /></Field
				>
				<Field
					label="Webhook URL"
					hint="Simplest option: Channel settings › Integrations › Webhooks."
				>
					<input
						class="input font-mono"
						type="password"
						placeholder="https://discord.com/api/webhooks/…"
						bind:value={draft.discord.webhookUrl}
					/>
				</Field>
				<div class="grid gap-x-4 sm:grid-cols-2">
					<Field label="…or bot token"
						><input
							class="input font-mono"
							type="password"
							bind:value={draft.discord.botToken}
						/></Field
					>
					<Field label="Channel ID"
						><input class="input font-mono" bind:value={draft.discord.channelId} /></Field
					>
				</div>
				<Field row label="Completed downloads"
					><Switch bind:checked={draft.discord.notifyCompleted} label="Completed" /></Field
				>
				<Field row label="New tracks detected"
					><Switch bind:checked={draft.discord.notifyNewTracks} label="New tracks" /></Field
				>
				<Field row label="Failures"
					><Switch bind:checked={draft.discord.notifyErrors} label="Failures" /></Field
				>
				{#if testResult.discord}<p
						class="py-2 text-xs {testResult.discord.ok ? 'text-ok' : 'text-bad'}"
					>
						{testResult.discord.message}
					</p>{/if}
			</Section>

			<Section
				title="AcoustID"
				description="Identifies tracks by their audio (Chromaprint fingerprint) instead of their tags — the most precise way to pick the right recording. Used by downloads, Auto-tag and the Studio when fpcalc is installed."
			>
				<Field
					label="Application API key"
					hint="Register an application (free, instant) at acoustid.org/new-application and paste its key. The key on your acoustid.org account page is a user key for submitting fingerprints and won't work for lookups."
					><input
						class="input font-mono"
						type="password"
						bind:value={draft.acoustid.apiKey}
					/></Field
				>
			</Section>
		{:else if data.section === 'account'}
			<Section title="Password">
				<div class="grid gap-x-4 py-1 sm:grid-cols-3">
					<Field label="Current"
						><input
							class="input"
							type="password"
							autocomplete="current-password"
							bind:value={pw.current}
						/></Field
					>
					<Field label="New"
						><input
							class="input"
							type="password"
							autocomplete="new-password"
							bind:value={pw.next}
						/></Field
					>
					<Field label="Confirm"
						><input
							class="input"
							type="password"
							autocomplete="new-password"
							bind:value={pw.confirm}
						/></Field
					>
				</div>
				<div class="py-3">
					<button class="btn" disabled={!pw.current || pw.next.length < 8} onclick={changePassword}
						>Change password</button
					>
				</div>
			</Section>

			<Section
				title="Import from Calliope v1"
				description="Brings over monitored playlists and finished download history, so monitors don't re-download what you already have. Safe to run more than once."
			>
				<Field
					label="Path to calliope.db"
					hint={data.legacyDb
						? 'Pre-filled from LEGACY_DB.'
						: 'Mount the old data volume and point here, e.g. /legacy/calliope.db'}
				>
					<div class="flex gap-2">
						<input
							class="input font-mono"
							bind:value={legacyPath}
							placeholder="/legacy/calliope.db"
						/>
						<button class="btn shrink-0" onclick={runImport} disabled={!legacyPath || importing}>
							{#if importing}<LoaderCircle class="h-3.5 w-3.5 animate-spin" />{:else}<Download
									class="h-3.5 w-3.5"
								/>{/if} Import
						</button>
					</div>
				</Field>
			</Section>

			<Section title="Data">
				<Field row label="Data directory" hint="Database and internal state. Back this up."
					><span class="font-mono text-xs text-ink-300">{data.dataDir}</span></Field
				>
			</Section>
		{/if}
	</div>
</div>

{#if dirty && data.section !== 'account'}
	<div class="fixed right-0 bottom-4 left-0 z-40 flex justify-center px-4 lg:left-64">
		<div class="glass flex animate-rise items-center gap-3 !bg-ink-850/95 py-2 pr-2 pl-4">
			<span class="text-[13px] text-ink-200">Unsaved changes</span>
			<button
				class="btn btn-ghost btn-sm"
				onclick={() => (draft = structuredClone(JSON.parse(saved)))}>Discard</button
			>
			<button class="btn btn-primary btn-sm" onclick={save} disabled={saving}>
				{#if saving}<LoaderCircle class="h-3 w-3 animate-spin" />{:else}<Save
						class="h-3 w-3"
					/>{/if} Save
			</button>
		</div>
	</div>
{/if}
