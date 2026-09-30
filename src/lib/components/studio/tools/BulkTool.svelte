<script lang="ts">
	import { FIELDS, studio, type Field } from '$lib/client/studio.svelte';

	// Fields shown as "(mixed)" when targets disagree; blank inputs are left alone.
	let values = $state<Partial<Record<Field, string>>>({});

	const common = $derived.by(() => {
		const out: Partial<Record<Field, string>> = {};
		for (const f of FIELDS) {
			const vals = new Set(studio.targets.map((t) => String(studio.value(t, f.key) ?? '')));
			out[f.key] = vals.size === 1 ? [...vals][0] : '';
		}
		return out;
	});
	const mixed = (key: Field) =>
		new Set(studio.targets.map((t) => String(studio.value(t, key) ?? ''))).size > 1;

	function apply() {
		for (const [key, v] of Object.entries(values)) {
			if (v === undefined) continue;
			for (const t of studio.targets) studio.set(t.id, key as Field, v);
		}
		values = {};
	}
</script>

<p class="mb-3 text-xs text-ink-400">
	Set fields on {studio.targets.length} file{studio.targets.length === 1 ? '' : 's'} at once. Untouched
	fields keep their values.
</p>
<div class="grid grid-cols-2 gap-x-3 gap-y-2.5">
	{#each FIELDS as f (f.key)}
		<label class={f.numeric ? '' : 'col-span-2'}>
			<span class="label !mb-1">{f.label}</span>
			<input
				class="input !h-8 {values[f.key] !== undefined ? '!border-amber/40' : ''}"
				placeholder={mixed(f.key) ? '(mixed)' : (common[f.key] ?? '')}
				value={values[f.key] ?? ''}
				oninput={(e) => (values[f.key] = e.currentTarget.value)}
			/>
		</label>
	{/each}
</div>
<div class="mt-4 flex justify-end gap-2">
	<button
		class="btn btn-ghost btn-sm"
		onclick={() => (values = {})}
		disabled={!Object.keys(values).length}>Reset</button
	>
	<button
		class="btn btn-primary btn-sm"
		onclick={apply}
		disabled={!Object.keys(values).length || !studio.targets.length}>Stage changes</button
	>
</div>
