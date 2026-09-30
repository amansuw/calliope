<script lang="ts">
	import { enhance } from '$app/forms';
	import { CircleAlert, CircleCheck, LoaderCircle } from '@lucide/svelte';
	import AuthShell from '$lib/components/auth/AuthShell.svelte';

	let { data, form } = $props();
	let busy = $state(false);
</script>

<svelte:head><title>Set up · Calliope</title></svelte:head>

<AuthShell title="Welcome to Calliope" subtitle="Two folders and a password, and you're in." wide>
	<form
		method="POST"
		use:enhance={() => {
			busy = true;
			return async ({ update }) => {
				await update({ reset: false });
				busy = false;
			};
		}}
		class="space-y-5"
	>
		<div>
			<label class="label" for="libraryDir">Music library folder</label>
			<input
				id="libraryDir"
				name="libraryDir"
				class="input font-mono"
				value={form?.libraryDir ?? data.paths.libraryDir}
				required
			/>
			<p class="hint">
				Finished tracks are filed here. Existing music in this folder gets indexed too.
			</p>
		</div>
		<div>
			<label class="label" for="stagingDir">Staging folder</label>
			<input
				id="stagingDir"
				name="stagingDir"
				class="input font-mono"
				value={form?.stagingDir ?? data.paths.stagingDir}
				required
			/>
			<p class="hint">Scratch space for downloads in progress. A fast local disk is ideal.</p>
		</div>
		<div class="grid gap-3 sm:grid-cols-2">
			<div>
				<label class="label" for="password">Password</label>
				<input
					id="password"
					name="password"
					type="password"
					class="input"
					autocomplete="new-password"
					minlength="8"
					required
				/>
			</div>
			<div>
				<label class="label" for="confirm">Confirm</label>
				<input
					id="confirm"
					name="confirm"
					type="password"
					class="input"
					autocomplete="new-password"
					minlength="8"
					required
				/>
			</div>
		</div>

		<div class="rounded-lg border border-white/6 bg-ink-900/50 p-3">
			<div class="panel-title mb-2">Dependencies</div>
			<ul class="space-y-1.5 text-xs">
				{#each data.binaries as b (b.name)}
					<li class="flex items-center gap-2">
						{#if b.error}
							<CircleAlert class="h-3.5 w-3.5 {b.required ? 'text-bad' : 'text-warn'}" />
						{:else}
							<CircleCheck class="h-3.5 w-3.5 text-ok" />
						{/if}
						<span class="text-ink-200">{b.label}</span>
						<span class="ml-auto truncate font-mono text-ink-400"
							>{b.error ? (b.required ? 'missing' : 'optional · missing') : b.version}</span
						>
					</li>
				{/each}
			</ul>
			{#if data.binaries.some((b) => b.required && b.error)}
				<p class="mt-2 text-xs text-warn">
					Missing tools can be pointed to later in Settings › Binaries.
				</p>
			{/if}
		</div>

		{#if form?.error}<p class="text-sm text-bad">{form.error}</p>{/if}
		<button class="btn btn-primary h-10 w-full" disabled={busy}>
			{#if busy}<LoaderCircle class="h-4 w-4 animate-spin" />{/if} Create library
		</button>
	</form>
</AuthShell>
