import fs from 'node:fs';
import path from 'node:path';

export interface PathCheck {
	ok: boolean;
	exists: boolean;
	writable: boolean;
	message: string;
}

/** Check a directory is usable, creating it if the parent exists. */
export function checkDir(dir: string, create = false): PathCheck {
	if (!dir.trim()) return { ok: false, exists: false, writable: false, message: 'Path is empty' };
	const resolved = path.resolve(dir);
	if (!fs.existsSync(resolved)) {
		if (!create) {
			const parentOk = fs.existsSync(path.dirname(resolved));
			return {
				ok: parentOk,
				exists: false,
				writable: parentOk,
				message: parentOk ? 'Will be created' : 'Parent directory does not exist'
			};
		}
		try {
			fs.mkdirSync(resolved, { recursive: true });
		} catch (err) {
			return { ok: false, exists: false, writable: false, message: (err as Error).message };
		}
	}
	if (!fs.statSync(resolved).isDirectory())
		return { ok: false, exists: true, writable: false, message: 'Not a directory' };
	try {
		fs.accessSync(resolved, fs.constants.W_OK);
		return { ok: true, exists: true, writable: true, message: 'Writable' };
	} catch {
		return {
			ok: false,
			exists: true,
			writable: false,
			message: 'Not writable by the Calliope process'
		};
	}
}
