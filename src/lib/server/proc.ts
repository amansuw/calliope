import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

/**
 * Directories where the tools Calliope drives usually live. Services (launchd, systemd, dev servers
 * started from IDEs) often run with a minimal PATH; yt-dlp in particular needs to find a JavaScript
 * runtime (deno/node) itself, or YouTube downloads start failing with 403s.
 */
export const EXTRA_PATH = [
	'/opt/homebrew/bin',
	'/usr/local/bin',
	'/usr/bin',
	path.join(os.homedir(), '.local/bin'),
	path.join(os.homedir(), '.deno/bin')
];

function childEnv(): NodeJS.ProcessEnv {
	const parts = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
	for (const dir of EXTRA_PATH) if (!parts.includes(dir)) parts.push(dir);
	return { ...process.env, PATH: parts.join(path.delimiter) };
}

export interface RunOptions {
	signal?: AbortSignal;
	timeoutMs?: number;
	/** Called for every complete line on stdout/stderr */
	onLine?: (line: string, stream: 'stdout' | 'stderr') => void;
	cwd?: string;
	/** Keep at most this many bytes of each stream in the result */
	maxBuffer?: number;
}

export interface RunResult {
	code: number | null;
	stdout: string;
	stderr: string;
}

export class ProcessError extends Error {
	constructor(
		message: string,
		public result: RunResult
	) {
		super(message);
	}
}

export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
	const max = opts.maxBuffer ?? 64 * 1024 * 1024;
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, {
			cwd: opts.cwd,
			env: childEnv(),
			stdio: ['ignore', 'pipe', 'pipe']
		});
		const out: Record<'stdout' | 'stderr', string> = { stdout: '', stderr: '' };
		const partial: Record<'stdout' | 'stderr', string> = { stdout: '', stderr: '' };
		let timer: NodeJS.Timeout | undefined;

		const kill = () => {
			child.kill('SIGTERM');
			setTimeout(() => child.exitCode === null && child.kill('SIGKILL'), 3000).unref();
		};

		const onData = (stream: 'stdout' | 'stderr') => (chunk: Buffer) => {
			const text = chunk.toString();
			if (out[stream].length < max) out[stream] += text;
			if (!opts.onLine) return;
			// yt-dlp redraws progress with \r; treat it as a line break too.
			const lines = (partial[stream] + text).split(/\r?\n|\r/);
			partial[stream] = lines.pop() ?? '';
			for (const line of lines) if (line) opts.onLine(line, stream);
		};
		child.stdout.on('data', onData('stdout'));
		child.stderr.on('data', onData('stderr'));

		if (opts.signal) {
			if (opts.signal.aborted) kill();
			opts.signal.addEventListener('abort', kill, { once: true });
		}
		if (opts.timeoutMs) timer = setTimeout(kill, opts.timeoutMs);

		child.on('error', (err) => {
			clearTimeout(timer);
			reject(err);
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			opts.signal?.removeEventListener('abort', kill);
			for (const stream of ['stdout', 'stderr'] as const) {
				if (partial[stream] && opts.onLine) opts.onLine(partial[stream], stream);
			}
			resolve({ code, ...out });
		});
	});
}

/** run() that throws unless the exit code is 0. */
export async function runOk(cmd: string, args: string[], opts: RunOptions = {}) {
	const result = await run(cmd, args, opts);
	if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
	if (result.code !== 0) {
		const tail = result.stderr.trim().split('\n').slice(-3).join(' | ');
		throw new ProcessError(`${cmd} exited ${result.code}: ${tail}`, result);
	}
	return result;
}
