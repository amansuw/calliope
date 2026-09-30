import fs from 'node:fs';
import path from 'node:path';
import { FORMAT_PRESETS, type FormatPresetId } from '$lib/formats';
import { bin } from '../binaries';
import { run } from '../proc';
import { getSettings } from '../settings';
import { baseArgs } from '../sources/youtube';

export interface DownloadProgress {
	downloaded: number | null;
	total: number | null;
	speed: number | null;
	eta: number | null;
	percent: number;
}

export interface DownloadHooks {
	signal: AbortSignal;
	onProgress: (p: DownloadProgress) => void;
	onPostprocess: (step: string) => void;
	onLog: (line: string) => void;
}

const PROGRESS_TAG = 'RSPROG';
const BLOCKED_FLAGS = new Set([
	'-o',
	'--output',
	'-P',
	'--paths',
	'--exec',
	'--exec-before-download',
	'--config-location',
	'--config-locations',
	'-a',
	'--batch-file',
	'-x',
	'--extract-audio',
	'--audio-format'
]);

/** Shell-style split of the user's extra flags ("--foo 'a b'" → ['--foo', 'a b']). */
export function splitArgs(input: string): string[] {
	const out: string[] = [];
	const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
	for (const m of input.matchAll(re)) out.push(m[1] ?? m[2] ?? m[3]);
	return out;
}

export function extraArgs(): { args: string[]; rejected: string[] } {
	const args: string[] = [];
	const rejected: string[] = [];
	const parts = splitArgs(getSettings().ytdlp.extraArgs);
	for (let i = 0; i < parts.length; i++) {
		const flag = parts[i].split('=')[0];
		if (BLOCKED_FLAGS.has(flag)) {
			rejected.push(parts[i]);
			// drop its value too
			if (!parts[i].includes('=') && parts[i + 1] && !parts[i + 1].startsWith('-')) i++;
			continue;
		}
		args.push(parts[i]);
	}
	return { args, rejected };
}

/** The flags the pipeline passes to yt-dlp, minus per-call cookies/output. Shown in settings as a preview. */
export function buildDownloadFlags(preset: FormatPresetId): string[] {
	const s = getSettings();
	const [format, quality] = FORMAT_PRESETS[preset].ytdlp;
	const flags = [
		'-f',
		'bestaudio/best',
		'--extract-audio',
		'--audio-format',
		format,
		'--audio-quality',
		quality,
		'--no-playlist',
		'--no-mtime',
		'-N',
		String(s.ytdlp.concurrentFragments)
	];
	if (s.ytdlp.sponsorblock && s.ytdlp.sponsorblockCategories.length) {
		flags.push('--sponsorblock-remove', s.ytdlp.sponsorblockCategories.join(','));
	}
	if (s.ytdlp.rateLimit) flags.push('--limit-rate', s.ytdlp.rateLimit);
	return [...flags, ...extraArgs().args];
}

const num = (s: string | undefined) => {
	if (!s || s === 'NA' || s === 'None') return null;
	const n = Number(s);
	return Number.isFinite(n) ? n : null;
};

/**
 * Download + extract audio for one video into the staging dir.
 * Returns the path of the produced audio file.
 */
export async function downloadAudio(
	videoUrl: string,
	stem: string,
	preset: FormatPresetId,
	hooks: DownloadHooks
): Promise<string> {
	const staging = getSettings().paths.stagingDir;
	fs.mkdirSync(staging, { recursive: true });
	const base = baseArgs();
	const args = [
		...base.args,
		'--newline',
		'--ffmpeg-location',
		path.dirname(bin('ffmpeg')),
		'--progress-template',
		`download:${PROGRESS_TAG} %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s %(progress.eta)s`,
		...buildDownloadFlags(preset),
		'-o',
		path.join(staging, `${stem}.%(ext)s`),
		videoUrl
	];
	hooks.onLog(`$ yt-dlp ${args.filter((a) => !a.includes('cookies')).join(' ')}`);

	const errors: string[] = [];
	try {
		const res = await run(bin('ytdlp'), args, {
			signal: hooks.signal,
			timeoutMs: 30 * 60_000,
			onLine: (line) => {
				if (line.startsWith(PROGRESS_TAG)) {
					const [, dl, total, estimate, speed, eta] = line.split(' ');
					const downloaded = num(dl);
					const size = num(total) ?? num(estimate);
					hooks.onProgress({
						downloaded,
						total: size,
						speed: num(speed),
						eta: num(eta),
						percent: downloaded && size ? Math.min(100, (downloaded / size) * 100) : 0
					});
					return;
				}
				const pp = line.match(/^\[(ExtractAudio|SponsorBlock|ModifyChapters|FFmpeg\w*|Fixup\w*)\]/);
				if (pp) hooks.onPostprocess(pp[1]);
				if (/^ERROR:/.test(line)) errors.push(line.replace(/^ERROR:\s*/, ''));
				hooks.onLog(line);
			}
		});
		if (hooks.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
		if (res.code !== 0) throw new Error(errors.at(-1) ?? `yt-dlp exited with code ${res.code}`);
	} finally {
		base.cleanup();
	}

	const ext = FORMAT_PRESETS[preset].ext;
	const expected = path.join(staging, `${stem}.${ext}`);
	if (fs.existsSync(expected)) return expected;
	// yt-dlp may keep a different container (e.g. opus inside .webm when conversion is skipped)
	const produced = fs
		.readdirSync(staging)
		.filter((f) => f.startsWith(`${stem}.`) && !f.endsWith('.part') && !f.endsWith('.ytdl'))
		.map((f) => path.join(staging, f));
	if (!produced.length) throw new Error('yt-dlp finished but no audio file was produced');
	return produced[0];
}

export function cleanupStaging(stem: string) {
	const staging = getSettings().paths.stagingDir;
	if (!fs.existsSync(staging)) return;
	for (const f of fs.readdirSync(staging)) {
		if (f.startsWith(`${stem}.`)) fs.rmSync(path.join(staging, f), { force: true });
	}
}
