import fs from 'node:fs';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { dbPath, env } from '../env';
import * as schema from './schema';

export type DB = BetterSQLite3Database<typeof schema>;

declare global {
	var __calliope_db__: { db: DB; sqlite: Database.Database } | undefined;
}

function open() {
	fs.mkdirSync(env.dataDir, { recursive: true });
	const sqlite = new Database(dbPath());
	sqlite.pragma('journal_mode = WAL');
	sqlite.pragma('synchronous = NORMAL');
	sqlite.pragma('foreign_keys = ON');
	sqlite.pragma('busy_timeout = 5000');
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: env.migrationsDir });
	return { db, sqlite };
}

// Opened on first use (not at import, so `vite build` never touches the database), and kept on
// globalThis to survive Vite HMR in dev without opening a second handle per reload.
const handle = () => (globalThis.__calliope_db__ ??= open());

function lazy<T extends object>(get: () => T): T {
	return new Proxy({} as T, {
		get(_, prop) {
			const target = get();
			const value = Reflect.get(target, prop, target);
			return typeof value === 'function' ? value.bind(target) : value;
		}
	});
}

export const db = lazy(() => handle().db);
export const sqlite = lazy(() => handle().sqlite);
export { schema };
