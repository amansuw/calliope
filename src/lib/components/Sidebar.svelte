<script lang="ts">
	import { page } from '$app/state';
	import {
		AudioWaveform,
		Copy,
		Gauge,
		Library,
		ListMusic,
		LogOut,
		Radio,
		Settings2,
		WandSparkles
	} from '@lucide/svelte';
	import { api } from '$lib/client/api';
	import { live } from '$lib/client/live.svelte';

	let { onnavigate }: { onnavigate?: () => void } = $props();

	const t = $derived(live.telemetry);
	const sections = $derived([
		{
			title: 'Sync Hub',
			items: [
				{
					href: '/pipeline',
					label: 'Pipeline',
					icon: Gauge,
					badge: t ? t.counts.active + t.counts.queued : 0,
					live: (t?.counts.active ?? 0) > 0
				},
				{
					href: '/sources',
					label: 'Sources',
					icon: Radio,
					badge: live.sources.size,
					live: [...live.sources.values()].some((s) => s.syncing)
				}
			]
		},
		{
			title: 'Library',
			items: [
				{
					href: '/library',
					label: 'Explorer',
					icon: Library,
					badge: live.library?.fileCount ?? 0,
					live: !!live.library?.scanning
				},
				{ href: '/studio', label: 'Metadata Studio', icon: WandSparkles, badge: 0, live: false },
				{ href: '/duplicates', label: 'Duplicates', icon: Copy, badge: 0, live: false }
			]
		},
		{
			title: 'System',
			items: [{ href: '/settings', label: 'Settings', icon: Settings2, badge: 0, live: false }]
		}
	]);

	async function logout() {
		await api.post('/api/auth/logout');
		location.href = '/login';
	}
</script>

<nav class="flex h-full flex-col">
	<a href="/pipeline" class="group flex items-center gap-2.5 px-5 pt-5 pb-6" onclick={onnavigate}>
		<div
			class="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber to-violet shadow-[0_0_24px_-4px_rgb(245_165_36/0.5)]"
		>
			<AudioWaveform class="h-4.5 w-4.5 text-ink-950" strokeWidth={2.5} />
		</div>
		<div>
			<div class="text-[15px] leading-none font-semibold tracking-tight text-ink-50">Calliope</div>
			<div class="mt-1 text-[10px] tracking-[0.18em] text-ink-400 uppercase">Music harvester</div>
		</div>
	</a>

	<div class="flex-1 space-y-6 overflow-y-auto px-3">
		{#each sections as section (section.title)}
			<div>
				<div class="panel-title mb-1.5 px-2.5 !text-[10px] !text-ink-400">{section.title}</div>
				{#each section.items as item (item.href)}
					{@const active = page.url.pathname.startsWith(item.href)}
					<a
						href={item.href}
						onclick={onnavigate}
						class="group relative mb-0.5 flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition
							{active ? 'bg-white/[0.07] text-ink-50' : 'text-ink-300 hover:bg-white/[0.04] hover:text-ink-100'}"
					>
						{#if active}<span
								class="absolute top-2 bottom-2 -left-3 w-[3px] rounded-r bg-gradient-to-b from-amber to-violet"
							></span>{/if}
						<item.icon
							class="h-4 w-4 {active ? 'text-amber' : 'text-ink-400 group-hover:text-ink-200'}"
						/>
						<span class="flex-1">{item.label}</span>
						{#if item.badge}
							<span
								class="rounded-md px-1.5 py-0.5 font-mono text-[10px] {item.live
									? 'bg-amber/15 text-amber-glow'
									: 'bg-white/[0.05] text-ink-400'}">{item.badge.toLocaleString()}</span
							>
						{/if}
					</a>
				{/each}
			</div>
		{/each}
	</div>

	<div class="m-3 rounded-xl border border-white/6 bg-white/[0.02] p-3">
		<div class="flex items-center justify-between text-[11px] text-ink-400">
			<span class="flex items-center gap-1.5">
				<span
					class="h-1.5 w-1.5 rounded-full {live.connected
						? 'bg-ok shadow-[0_0_6px] shadow-ok'
						: 'bg-bad'}"
				></span>
				{live.connected ? (t?.paused ? 'Paused' : 'Live') : 'Reconnecting…'}
			</span>
			<button class="btn btn-ghost btn-icon btn-sm" onclick={logout} title="Sign out"
				><LogOut class="h-3.5 w-3.5" /></button
			>
		</div>
		{#if t}
			<div class="mt-2 flex gap-1" title="Worker slots">
				{#each Array(t.concurrency) as _, i (i)}
					<div
						class="h-1.5 flex-1 rounded-full {i < t.counts.active
							? 'bg-gradient-to-r from-amber to-amber-glow shadow-[0_0_6px] shadow-amber/60'
							: 'bg-white/[0.07]'}"
					></div>
				{/each}
			</div>
			<div class="mt-1.5 flex justify-between font-mono text-[10px] text-ink-400">
				<span>{t.counts.active}/{t.concurrency} workers</span>
				<span>{t.doneToday} today</span>
			</div>
		{/if}
	</div>
</nav>
