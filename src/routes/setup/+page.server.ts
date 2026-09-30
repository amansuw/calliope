import { fail, redirect } from '@sveltejs/kit';
import { createSession, hasPassword, setPassword } from '$lib/server/auth';
import { checkBinaries } from '$lib/server/binaries';
import { scanLibrary } from '$lib/server/library/scanner';
import { checkDir } from '$lib/server/paths';
import { getSettings, updateSettings } from '$lib/server/settings';

export const load = async () => {
	if (hasPassword()) redirect(303, '/login');
	const { paths } = getSettings();
	return { paths, binaries: await checkBinaries(true) };
};

export const actions = {
	default: async ({ request, cookies, url }) => {
		if (hasPassword()) redirect(303, '/login');
		const form = await request.formData();
		const password = String(form.get('password') ?? '');
		const confirm = String(form.get('confirm') ?? '');
		const libraryDir = String(form.get('libraryDir') ?? '').trim();
		const stagingDir = String(form.get('stagingDir') ?? '').trim();
		const values = { libraryDir, stagingDir };

		if (password.length < 8)
			return fail(400, { ...values, error: 'Use at least 8 characters for the password' });
		if (password !== confirm) return fail(400, { ...values, error: 'Passwords do not match' });
		for (const [label, dir] of [
			['Library', libraryDir],
			['Staging', stagingDir]
		] as const) {
			const check = checkDir(dir, true);
			if (!check.ok) return fail(400, { ...values, error: `${label} folder: ${check.message}` });
		}

		updateSettings({ paths: { libraryDir, stagingDir } });
		await setPassword(password);
		void scanLibrary();
		createSession(cookies, url.protocol === 'https:');
		redirect(303, '/pipeline');
	}
};
