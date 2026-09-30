<script lang="ts">
	let { provider, kind }: { provider: 'spotify' | 'youtube'; kind?: string } = $props();
</script>

<span
	class="chip {provider === 'spotify'
		? 'border-[#1db954]/30 bg-[#1db954]/10 text-[#4ade80]'
		: 'border-[#ff4e45]/30 bg-[#ff4e45]/10 text-[#ff7a73]'}"
>
	{provider === 'spotify' ? 'Spotify' : 'YouTube'}{kind ? ` · ${kind}` : ''}
</span>
