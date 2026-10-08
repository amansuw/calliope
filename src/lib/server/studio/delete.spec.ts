import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'calliope-delete-'));
const libraryDir = path.join(tmp, 'music');

describe('deleting a library file', () => {
	beforeAll(async () => {
		process.env.CALLIOPE_DATA_DIR = path.join(tmp, 'data');
		process.env.CALLIOPE_MIGRATIONS_DIR = path.resolve('drizzle');
		const { updateSettings } = await import('../settings');
		updateSettings({ paths: { libraryDir } });
	});
	afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

	async function index(file: string) {
		const { db, schema } = await import('../db');
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, 'audio');
		const id = crypto.randomUUID();
		db.insert(schema.libraryFiles)
			.values({ id, path: file, relPath: path.relative(libraryDir, file), size: 5, mtimeMs: 0 })
			.run();
		return id;
	}

	it('removes the file, its index row and the folders it leaves empty', async () => {
		const { db, schema } = await import('../db');
		const { deleteLibraryFile } = await import('./service');
		const gone = await index(path.join(libraryDir, 'Artist', 'Album', '01 - One.flac'));
		const kept = await index(path.join(libraryDir, 'Artist', 'Other', '01 - Two.flac'));

		expect(deleteLibraryFile(gone)).toBe(true);

		expect(fs.existsSync(path.join(libraryDir, 'Artist', 'Album'))).toBe(false);
		expect(fs.existsSync(path.join(libraryDir, 'Artist', 'Other', '01 - Two.flac'))).toBe(true);
		expect(
			db
				.select({ id: schema.libraryFiles.id })
				.from(schema.libraryFiles)
				.all()
				.map((r) => r.id)
		).toEqual([kept]);
		expect(db.select().from(schema.fileOps).all()).toMatchObject([
			{ kind: 'delete', fromPath: path.join(libraryDir, 'Artist', 'Album', '01 - One.flac') }
		]);
		expect(deleteLibraryFile(gone)).toBe(false);
	});

	it('refuses a file outside the library folder', async () => {
		const { deleteLibraryFile } = await import('./service');
		const outside = path.join(tmp, 'elsewhere', 'keep.flac');
		const id = await index(outside);
		expect(() => deleteLibraryFile(id)).toThrow(/outside the library/);
		expect(fs.existsSync(outside)).toBe(true);
	});
});
