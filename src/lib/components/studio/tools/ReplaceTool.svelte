<script lang="ts">
	import { FIELDS, studio, type Field } from '$lib/client/studio.svelte';
	import { applyCase, applyReplace, validRegex, type CaseMode } from '$lib/studio-transforms';

	const TEXT_FIELDS = FIELDS.filter((f) => !f.numeric);
	let fields = $state<Field[]>(['title']);
	let find = $state('');
	let replace = $state('');
	let regex = $state(false);
	let caseSensitive = $state(false);

	const regexError = $derived(regex && find ? validRegex(find) : null);
	const preview = $derived.by(() => {
		if (!find || regexError) return [];
		const out: { before: string; after: string }[] = [];
		for (const t of studio.targets) {
			for (const f of fields) {
				const before = String(studio.value(t, f) ?? '');
				const after = applyReplace(before, find, replace, { regex, caseSensitive });
				if (after !== before) out.push({ before, after });
			}
		}
		return out;
	});

	const toggle = (f: Field) =>
		(fields = fields.includes(f) ? fields.filter((x) => x !== f) : [...fields, f]);

	function applyFindReplace() {
		for (const f of fields)
			studio.transform(f, (v) => applyReplace(v, find, replace, { regex, caseSensitive }));
	}
	function fixCase(mode: CaseMode) {
		for (const f of fields) studio.transform(f, (v) => (v ? applyCase(v, mode) : null));
	}
	function trimAll() {
		for (const f of fields) studio.transform(f, (v) => v.replace(/\s+/g, ' ').trim() || null);
	}
</script>

<div class="mb-3">
	<div class="label">Fields</div>
	<div class="flex flex-wrap gap-1">
		{#each TEXT_FIELDS as f (f.key)}
			<button
				class="rounded-full border px-2.5 py-0.5 text-xs transition {fields.includes(f.key)
					? 'border-amber/40 bg-amber/10 text-amber-glow'
					: 'border-white/8 text-ink-300'}"
				onclick={() => toggle(f.key)}>{f.label}</button
			>
		{/each}
	</div>
</div>

<div class="space-y-2">
	<input
		class="input !h-8 font-mono {regexError ? '!border-bad/50' : ''}"
		placeholder="Find"
		bind:value={find}
	/>
	<input
		class="input !h-8 font-mono"
		placeholder={regex ? 'Replace ($1 for groups)' : 'Replace with'}
		bind:value={replace}
	/>
	<div class="flex gap-4 text-xs text-ink-300">
		<label class="flex items-center gap-1.5"
			><input type="checkbox" class="accent-amber" bind:checked={regex} /> Regex</label
		>
		<label class="flex items-center gap-1.5"
			><input type="checkbox" class="accent-amber" bind:checked={caseSensitive} /> Match case</label
		>
	</div>
	{#if regexError}<p class="text-xs text-bad">{regexError}</p>{/if}
</div>

{#if preview.length}
	<div
		class="mt-3 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-white/5 bg-ink-950/60 p-2 font-mono text-[11px]"
	>
		{#each preview.slice(0, 30) as p, i (i)}
			<div class="truncate">
				<span class="text-bad/80 line-through">{p.before}</span> →
				<span class="text-ok">{p.after || '(empty)'}</span>
			</div>
		{/each}
		{#if preview.length > 30}<div class="text-ink-500">…{preview.length - 30} more</div>{/if}
	</div>
{/if}
<div class="mt-3 flex justify-end">
	<button class="btn btn-primary btn-sm" disabled={!preview.length} onclick={applyFindReplace}
		>Replace in {preview.length}</button
	>
</div>

<div class="mt-5 border-t border-white/5 pt-4">
	<div class="label">Fix casing & whitespace</div>
	<div class="grid grid-cols-2 gap-1.5">
		<button class="btn btn-sm" onclick={() => fixCase('title')}>Title Case</button>
		<button class="btn btn-sm" onclick={() => fixCase('sentence')}>Sentence case</button>
		<button class="btn btn-sm" onclick={() => fixCase('upper')}>UPPERCASE</button>
		<button class="btn btn-sm" onclick={() => fixCase('lower')}>lowercase</button>
		<button class="btn btn-sm col-span-2" onclick={trimAll}>Trim & collapse spaces</button>
	</div>
	<p class="hint">
		Applies to the selected fields on {studio.targets.length} file{studio.targets.length === 1
			? ''
			: 's'}.
	</p>
</div>
