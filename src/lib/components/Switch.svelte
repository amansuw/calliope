<script lang="ts">
	let {
		checked = $bindable(false),
		label,
		disabled = false,
		onchange
	}: {
		checked?: boolean;
		label?: string;
		disabled?: boolean;
		onchange?: (v: boolean) => void;
	} = $props();
</script>

<button
	type="button"
	role="switch"
	aria-checked={checked}
	aria-label={label}
	{disabled}
	onclick={() => {
		checked = !checked;
		onchange?.(checked);
	}}
	class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition disabled:opacity-40
		{checked
		? 'border-amber/50 bg-amber/80 shadow-[0_0_12px_-2px_rgb(245_165_36/0.6)]'
		: 'border-white/10 bg-ink-700'}"
>
	<span
		class="inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition {checked
			? 'translate-x-[18px]'
			: 'translate-x-[3px]'}"
	></span>
</button>
