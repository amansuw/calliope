<script lang="ts">
	let {
		src,
		title = '',
		size = 40,
		rounded = 'rounded-md',
		class: cls = ''
	}: {
		src?: string | null;
		title?: string | null;
		size?: number;
		rounded?: string;
		class?: string;
	} = $props();

	let failed = $state(false);
	$effect(() => {
		src;
		failed = false;
	});

	// Stable hue per title so placeholders don't all look identical
	const hue = $derived([...(title ?? '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 17));
	const initials = $derived(
		(title ?? '?')
			.split(/\s+/)
			.slice(0, 2)
			.map((w) => w[0])
			.join('')
			.toUpperCase()
	);
</script>

<div
	class="relative shrink-0 overflow-hidden {rounded} border border-white/8 bg-ink-800 {cls}"
	style="width:{size}px;height:{size}px"
>
	{#if src && !failed}
		<img
			{src}
			alt=""
			loading="lazy"
			class="h-full w-full object-cover"
			onerror={() => (failed = true)}
			referrerpolicy="no-referrer"
		/>
	{:else}
		<div
			class="flex h-full w-full items-center justify-center font-semibold text-white/70"
			style="background: linear-gradient(135deg, hsl({hue} 45% 22%), hsl({(hue + 60) %
				360} 50% 14%)); font-size:{Math.max(9, size / 3.2)}px"
		>
			{initials}
		</div>
	{/if}
</div>
