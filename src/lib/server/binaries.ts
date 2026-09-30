import fs from 'node:fs';
import path from 'node:path';
import type { BinaryStatus } from '$lib/types';
import { EXTRA_PATH, run } from './proc';
import { getSettings } from './settings';

type Name = BinaryStatus['name'];

const META: Record<Name, { label: string; exe: string; versionArgs: string[]; required: boolean }> =
	{
		ytdlp: { label: 'yt-dlp', exe: 'yt-dlp', versionArgs: ['--version'], required: true },
		ffmpeg: { label: 'FFmpeg', exe: 'ffmpeg', versionArgs: ['-version'], required: true },
		ffprobe: { label: 'FFprobe', exe: 'ffprobe', versionArgs: ['-version'], required: true },
		fpcalc: {
			label: 'Chromaprint fpcalc',
			exe: 'fpcalc',
			versionArgs: ['-version'],
			required: false
		}
	};

function findOnPath(exe: string): string | null {
	const dirs = [...(process.env.PATH ?? '').split(path.delimiter), ...EXTRA_PATH];
	const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
	for (const dir of dirs) {
		for (const ext of exts) {
			const candidate = path.join(dir, exe + ext);
			try {
				fs.accessSync(candidate, fs.constants.X_OK);
				return candidate;
			} catch {
				/* keep looking */
			}
		}
	}
	return null;
}

/** Absolute path to a binary: the configured override, else PATH lookup, else the bare name. */
export function bin(name: Name): string {
	const configured = getSettings().binaries[name];
	if (configured) return configured;
	return findOnPath(META[name].exe) ?? META[name].exe;
}

let cached: { at: number; statuses: BinaryStatus[] } | null = null;

export async function checkBinaries(force = false): Promise<BinaryStatus[]> {
	if (!force && cached && Date.now() - cached.at < 60_000) return cached.statuses;
	const statuses = await Promise.all(
		(Object.keys(META) as Name[]).map(async (name): Promise<BinaryStatus> => {
			const meta = META[name];
			const configured = getSettings().binaries[name];
			const resolved = configured || findOnPath(meta.exe);
			const base = { name, label: meta.label, required: meta.required, path: resolved };
			if (!resolved) return { ...base, version: null, error: 'Not found on PATH' };
			try {
				const res = await run(resolved, meta.versionArgs, { timeoutMs: 10_000 });
				const text = (res.stdout || res.stderr).trim();
				if (res.code !== 0)
					return { ...base, version: null, error: text.split('\n')[0] || `exit ${res.code}` };
				return { ...base, version: parseVersion(name, text), error: null };
			} catch (err) {
				return { ...base, version: null, error: (err as Error).message };
			}
		})
	);
	cached = { at: Date.now(), statuses };
	return statuses;
}

function parseVersion(name: Name, text: string) {
	const first = text.split('\n')[0];
	if (name === 'ffmpeg' || name === 'ffprobe') return first.match(/version (\S+)/)?.[1] ?? first;
	if (name === 'fpcalc') return first.match(/version (\S+)/)?.[1] ?? first;
	return first;
}
