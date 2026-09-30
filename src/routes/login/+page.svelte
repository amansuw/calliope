<script lang="ts">
	import { enhance } from '$app/forms';
	import { LoaderCircle } from '@lucide/svelte';
	import AuthShell from '$lib/components/auth/AuthShell.svelte';

	let { form } = $props();
	let busy = $state(false);
</script>

<svelte:head><title>Sign in · Calliope</title></svelte:head>

<AuthShell title="Calliope" subtitle="Sign in to your library">
	<form
		method="POST"
		use:enhance={() => {
			busy = true;
			return async ({ update }) => {
				await update();
				busy = false;
			};
		}}
		class="space-y-4"
	>
		<div>
			<label class="label" for="password">Password</label>
			<!-- svelte-ignore a11y_autofocus -->
			<input
				id="password"
				name="password"
				type="password"
				class="input"
				autocomplete="current-password"
				autofocus
				required
			/>
			{#if form?.error}<p class="mt-2 text-xs text-bad">{form.error}</p>{/if}
		</div>
		<button class="btn btn-primary h-10 w-full" disabled={busy}>
			{#if busy}<LoaderCircle class="h-4 w-4 animate-spin" />{/if} Sign in
		</button>
	</form>
</AuthShell>
