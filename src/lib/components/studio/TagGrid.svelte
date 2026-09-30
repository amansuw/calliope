<script lang="ts">
	import { ImageOff, X } from '@lucide/svelte';
	import { FIELDS, studio, type StudioFile } from '$lib/client/studio.svelte';
	import Artwork from '../Artwork.svelte';

	let lastIndex = -1;
	const allSelected = $derived(
		studio.files.length > 0 && studio.selected.length === studio.files.length
	);

	function toggle(e: MouseEvent, f: StudioFile, i: number) {
		const set = new Set(studio.selected);
		if (e.shiftKey && lastIndex >= 0) {
			const [a, b] = [Math.min(lastIndex, i), Math.max(lastIndex, i)];
			for (const x of studio.files.slice(a, b + 1)) set.add(x.id);
		} else if (set.has(f.id)) set.delete(f.id);
		else set.add(f.id);
		studio.selected = [...set];
		lastIndex = i;
	}

	/** Enter commits and moves down the column, like a spreadsheet. */
	function onkeydown(e: KeyboardEvent, row: number, col: string) {
		if (e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
		if (e.key !== 'Enter' && !(e.altKey || e.metaKey)) return;
		e.preventDefault();
		const next = row + (e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey) ? -1 : 1);
		(e.currentTarget as HTMLInputElement).blur();
		document.querySelector<HTMLInputElement>(`[data-cell="${next}:${col}"]`)?.focus();
	}

	const art = (f: StudioFile) =>
		studio.artwork[f.id] ??
		(f.hasArtwork ? `/api/library/${f.id}/art?v=${studio.artVersion}` : null);
</script>

<div class="overflow-auto">
	<table class="w-max min-w-full border-separate border-spacing-0 text-[12.5px]">
		<thead class="sticky top-0 z-10 bg-ink-850/95 backdrop-blur">
			<tr class="text-left text-[10.5px] tracking-wider text-ink-400 uppercase">
				<th class="sticky left-0 z-10 w-9 border-b border-white/5 bg-ink-850 py-2 pl-3">
					<input
						type="checkbox"
						class="accent-amber"
						checked={allSelected}
						onchange={() => (studio.selected = allSelected ? [] : studio.files.map((f) => f.id))}
					/>
				</th>
				<th class="sticky left-9 z-10 w-64 border-b border-white/5 bg-ink-850 py-2 pr-3 font-medium"
					>File</th
				>
				{#each FIELDS as f (f.key)}<th
						class="border-b border-white/5 px-1 py-2 font-medium {f.width}">{f.label}</th
					>{/each}
				<th class="w-8 border-b border-white/5"></th>
			</tr>
		</thead>
		<tbody>
			{#each studio.files as file, i (file.id)}
				{@const sel = studio.selected.includes(file.id)}
				{@const focus = studio.focusId === file.id}
				<tr
					class="group {sel ? 'bg-amber/[0.05]' : ''} {focus ? 'bg-violet/[0.06]' : ''}"
					onfocusin={() => (studio.focusId = file.id)}
				>
					<td
						class="sticky left-0 border-b border-white/[0.04] py-1.5 pl-3 {sel
							? 'bg-[#15130f]'
							: 'bg-ink-850'}"
					>
						<input
							type="checkbox"
							class="accent-amber"
							checked={sel}
							onclick={(e) => toggle(e, file, i)}
						/>
					</td>
					<td
						class="sticky left-9 border-b border-white/[0.04] py-1.5 pr-3 {sel
							? 'bg-[#15130f]'
							: 'bg-ink-850'}"
					>
						<button
							class="flex w-64 items-center gap-2 text-left"
							onclick={() => (studio.focusId = file.id)}
						>
							<div class="relative">
								<Artwork
									src={art(file)}
									title={String(studio.value(file, 'album') ?? studio.value(file, 'title') ?? '')}
									size={30}
									rounded="rounded"
								/>
								{#if studio.artwork[file.id]}<span
										class="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full border-2 border-ink-850 bg-amber"
									></span>{/if}
								{#if !file.hasArtwork && !studio.artwork[file.id]}<ImageOff
										class="absolute -right-1 -bottom-1 h-3 w-3 text-bad/80"
									/>{/if}
							</div>
							<div class="min-w-0">
								<div class="truncate font-mono text-[10.5px] text-ink-300" title={file.relPath}>
									{file.relPath.split('/').pop()}
								</div>
								<div class="truncate font-mono text-[10px] text-ink-500">
									{file.format?.toUpperCase()}{studio.mb[file.id]
										? ' · MB ✓'
										: file.mbRecordingId
											? ' · MB'
											: ''}
								</div>
							</div>
						</button>
					</td>
					{#each FIELDS as f (f.key)}
						{@const dirty = studio.isDirty(file, f.key)}
						<td class="border-b border-white/[0.04] px-0.5 py-1">
							<input
								data-cell="{i}:{f.key}"
								class="h-7 {f.width} rounded-md border px-2 transition outline-none {f.numeric
									? 'text-right font-mono text-[11.5px]'
									: ''}
									{dirty
									? 'border-amber/40 bg-amber/10 text-amber-glow'
									: 'border-transparent bg-transparent text-ink-100 hover:border-white/8 focus:border-violet/50 focus:bg-ink-900'}"
								value={studio.value(file, f.key) ?? ''}
								placeholder={dirty ? '(clear)' : ''}
								inputmode={f.numeric ? 'numeric' : undefined}
								onchange={(e) => studio.set(file.id, f.key, e.currentTarget.value)}
								onkeydown={(e) => onkeydown(e, i, f.key)}
							/>
						</td>
					{/each}
					<td class="border-b border-white/[0.04] pr-2">
						<button
							class="btn btn-ghost btn-icon btn-sm opacity-0 group-hover:opacity-100"
							title="Remove from working set"
							onclick={() => studio.remove([file.id])}
						>
							<X class="h-3 w-3" />
						</button>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
